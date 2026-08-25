import { config } from './config.js';

/** Margen para refrescar el token antes de que expire realmente. */
const TOKEN_REFRESH_BUFFER_MS = 30_000;

/** Tope de espera por el SSO y por la consulta de transacciones. */
const SSO_TIMEOUT_MS = 15_000;
const API_TIMEOUT_MS = 30_000;

/**
 * Códigos de falla que el front usa para decidir qué mensaje mostrarle al
 * cajero. Lo importante es distinguir "el banco está caído" (no es culpa de
 * nadie acá, hay que reintentar) de "está mal configurado" (hay que avisarle
 * a soporte) — el cajero no puede hacer nada con un "HTTP 502" pelado.
 */
export const BanescoErrorCode = {
  /** Falta configuración (credenciales/URLs vacías en el entorno). */
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  /** No se pudo abrir la conexión con el SSO o la API (DNS, TLS, red). */
  BANK_UNREACHABLE: 'BANK_UNREACHABLE',
  /** El banco no respondió dentro del tope de espera. */
  BANK_TIMEOUT: 'BANK_TIMEOUT',
  /** El banco respondió 502/503/504: está caído o en mantenimiento. */
  BANK_UNAVAILABLE: 'BANK_UNAVAILABLE',
  /** Credenciales rechazadas (401/403), incluso tras refrescar el token. */
  BANK_AUTH: 'BANK_AUTH',
  /** El banco rechazó la petición (4xx que no es de auth). */
  BANK_REJECTED: 'BANK_REJECTED',
  /** Cualquier otro error del lado del banco (5xx, respuesta ilegible). */
  BANK_ERROR: 'BANK_ERROR',
};

/**
 * Error de comunicación con Banesco. `status` guarda el código HTTP
 * devuelto por Banesco (si lo hubo), `details` el cuerpo de la respuesta y
 * `code` la categoría de falla (ver BanescoErrorCode).
 */
export class BanescoError extends Error {
  constructor(message, { code = BanescoErrorCode.BANK_ERROR, status = null, details = null, stage = null } = {}) {
    super(message);
    this.name = 'BanescoError';
    this.code = code;
    this.status = status;
    this.details = details;
    /** 'sso' | 'transactions' — en qué paso falló, útil para el log. */
    this.stage = stage;
  }
}

/** Traduce un status HTTP del banco a una categoría de falla. */
function codeFromStatus(status) {
  if (status === 401 || status === 403) return BanescoErrorCode.BANK_AUTH;
  if (status === 502 || status === 503 || status === 504) return BanescoErrorCode.BANK_UNAVAILABLE;
  if (status === 408 || status === 429) return BanescoErrorCode.BANK_TIMEOUT;
  if (status >= 400 && status < 500) return BanescoErrorCode.BANK_REJECTED;
  return BanescoErrorCode.BANK_ERROR;
}

/**
 * Traduce una excepción de `fetch` (no llegó a haber respuesta) a una
 * categoría: un abort es timeout, cualquier otra cosa es red caída.
 */
function codeFromFetchError(err) {
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return BanescoErrorCode.BANK_TIMEOUT;
  return BanescoErrorCode.BANK_UNREACHABLE;
}

/** Verifica que estén las credenciales antes de salir a la red. */
function assertConfigured() {
  const { ssoUrl, apiUrl, clientId, clientSecret, username, password } = config.banesco;
  const missing = Object.entries({ ssoUrl, apiUrl, clientId, clientSecret, username, password })
    .filter(([, v]) => !v)
    .map(([k]) => k);

  if (missing.length) {
    throw new BanescoError(
      `El validador no tiene configuradas las credenciales de Banesco (falta: ${missing.join(', ')})`,
      { code: BanescoErrorCode.NOT_CONFIGURED },
    );
  }
}

/** Caché del token OAuth en memoria. */
let tokenCache = {
  accessToken: null,
  expiresAt: 0,
};

/**
 * Solicita un nuevo token OAuth (grant_type=password con Basic Auth) y lo
 * guarda en caché. El tiempo de expiración se reduce con un buffer para
 * refrescar antes de que el token caduque del lado de Banesco.
 */
async function fetchToken() {
  assertConfigured();
  const { ssoUrl, clientId, clientSecret, username, password } = config.banesco;

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'password',
    username,
    password,
  });

  let res;
  try {
    res = await fetch(ssoUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: AbortSignal.timeout(SSO_TIMEOUT_MS),
    });
  } catch (err) {
    throw new BanescoError(`No se pudo conectar al SSO de Banesco: ${err.message}`, {
      code: codeFromFetchError(err),
      stage: 'sso',
    });
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new BanescoError(`Error obteniendo token OAuth (HTTP ${res.status})`, {
      code: codeFromStatus(res.status),
      status: res.status,
      details: text,
      stage: 'sso',
    });
  }

  const data = await res.json().catch(() => null);
  if (!data?.access_token) {
    throw new BanescoError('El SSO de Banesco respondió sin token de acceso', {
      code: BanescoErrorCode.BANK_ERROR,
      status: res.status,
      stage: 'sso',
    });
  }
  const expiresInMs = (data.expires_in ?? 300) * 1000;

  tokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + expiresInMs - TOKEN_REFRESH_BUFFER_MS,
  };

  return tokenCache.accessToken;
}

/**
 * Devuelve un token válido desde la caché o solicita uno nuevo si no existe,
 * está por expirar, o se fuerza el refresco.
 */
async function getToken({ forceRefresh = false } = {}) {
  const cached = tokenCache.accessToken && Date.now() < tokenCache.expiresAt;
  if (!forceRefresh && cached) {
    return tokenCache.accessToken;
  }
  return fetchToken();
}

/** Invalida la caché del token (p. ej. tras recibir un 401). */
function invalidateToken() {
  tokenCache = { accessToken: null, expiresAt: 0 };
}

/**
 * Código con el que Banesco reporta "no encontré nada" — lo manda con
 * HTTP 400, no con 200, así que hay que reconocerlo por el cuerpo.
 */
const NO_RESULTS_STATUS_CODE = '70001';

/**
 * Si el cuerpo de una respuesta fallida es en realidad un "sin resultados"
 * de Banesco, lo devuelve normalizado con la lista vacía. Si no, null.
 */
function asEmptyResult(text) {
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }

  if (String(body?.httpStatus?.statusCode) !== NO_RESULTS_STATUS_CODE) return null;

  return {
    httpStatus: body.httpStatus,
    dataResponse: { transactionDetail: [] },
  };
}

/** Ejecuta la petición a transacciones con un token dado. */
function requestTransactions(token, payload) {
  return fetch(config.banesco.apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
}

/**
 * Consulta transacciones en Banesco. Si recibe 401 invalida el token y
 * reintenta una sola vez con un token nuevo.
 */
async function postTransactions(payload) {
  assertConfigured();
  let token = await getToken();

  let res;
  try {
    res = await requestTransactions(token, payload);

    if (res.status === 401) {
      invalidateToken();
      token = await getToken({ forceRefresh: true });
      res = await requestTransactions(token, payload);
    }
  } catch (err) {
    if (err instanceof BanescoError) throw err;
    throw new BanescoError(`No se pudo conectar a la API de Banesco: ${err.message}`, {
      code: codeFromFetchError(err),
      stage: 'transactions',
    });
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');

    // Banesco devuelve HTTP 400 con statusCode 70001 para decir "no hay
    // movimientos en ese rango". Eso NO es un error: es un resultado vacío,
    // y tratarlo como falla hacía que un día sin pagos se viera igual que
    // el banco caído. Se normaliza a una respuesta vacía.
    const empty = asEmptyResult(text);
    if (empty) return empty;

    throw new BanescoError(`Error consultando transacciones (HTTP ${res.status})`, {
      code: codeFromStatus(res.status),
      status: res.status,
      details: text,
      stage: 'transactions',
    });
  }

  try {
    return await res.json();
  } catch {
    throw new BanescoError('Banesco respondió algo que no es JSON', {
      code: BanescoErrorCode.BANK_ERROR,
      status: res.status,
      stage: 'transactions',
    });
  }
}

/**
 * Comprueba que Banesco esté respondiendo pidiendo (o reusando) un token.
 * No consulta transacciones: es lo más barato que confirma que el banco está
 * en pie y que las credenciales siguen siendo válidas. Lanza BanescoError.
 */
export async function pingBanesco() {
  await getToken();
  return true;
}

/**
 * Envuelve un objeto `transaction` en el payload que espera Banesco:
 * `dataRequest` con los bloques `device`, `securityAuth` y `transaction`.
 * Cada modo arma su propio `transaction` con los campos que corresponden.
 */
function buildPayload(transaction) {
  const { device } = config.banesco;
  return {
    dataRequest: {
      device: {
        type: device.type,
        description: device.description,
        ipAddress: device.ipAddress,
      },
      securityAuth: {
        sessionId: '',
      },
      transaction,
    },
  };
}

/**
 * Modo 1: consulta por rango de fechas.
 * transaction lleva los 7 campos; referenceNumber/phoneNum/bankId van vacíos.
 */
export function consultarPorFecha({ startDt, endDt, amount }) {
  return postTransactions(
    buildPayload({
      referenceNumber: '',
      amount: amount ?? 0,
      accountId: config.banesco.accountId,
      startDt,
      endDt,
      phoneNum: '',
      bankId: '',
    }),
  );
}

/**
 * Modo 2: búsqueda de pago móvil por referencia.
 * transaction lleva solo referenceNumber, startDt, phoneNum y bankId
 * (sin accountId, amount ni endDt).
 */
export function buscarPagoMovil({ referenceNumber, phoneNum, bankId, startDt }) {
  return postTransactions(
    buildPayload({
      referenceNumber,
      startDt,
      phoneNum,
      bankId,
    }),
  );
}
