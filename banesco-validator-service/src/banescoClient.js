import { config } from './config.js';

/** Margen para refrescar el token antes de que expire realmente. */
const TOKEN_REFRESH_BUFFER_MS = 30_000;

/**
 * Error de comunicación con Banesco. `status` guarda el código HTTP
 * devuelto por Banesco (si lo hubo) y `details` el cuerpo de la respuesta.
 */
export class BanescoError extends Error {
  constructor(message, status, details) {
    super(message);
    this.name = 'BanescoError';
    this.status = status;
    this.details = details;
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
    });
  } catch (err) {
    throw new BanescoError(`No se pudo conectar al SSO de Banesco: ${err.message}`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new BanescoError(`Error obteniendo token OAuth (HTTP ${res.status})`, res.status, text);
  }

  const data = await res.json();
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

/** Ejecuta la petición a transacciones con un token dado. */
function requestTransactions(token, payload) {
  return fetch(config.banesco.apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

/**
 * Consulta transacciones en Banesco. Si recibe 401 invalida el token y
 * reintenta una sola vez con un token nuevo.
 */
async function postTransactions(payload) {
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
    throw new BanescoError(`No se pudo conectar a la API de Banesco: ${err.message}`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new BanescoError(`Error consultando transacciones (HTTP ${res.status})`, res.status, text);
  }

  return res.json();
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
