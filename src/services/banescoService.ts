// ================================
// Cliente del microservicio validador de pagos Banesco (Cloud Run)
// ================================

const BASE_URL =
  import.meta.env.VITE_BANESCO_VALIDATOR_URL ??
  'https://banesco-validator-service-711733152496.us-central1.run.app';

export interface BanescoTransaction {
  referenceNumber: string;
  amount: number;
  currencyCode: string;
  accountId: string;
  trnDate: string;
  trnTime: string;
  sourceBankId: string;
  destBankId: string;
  concept: string;
  customerIdBen: string;
  trnType: string; // 'CR' = crédito (dinero recibido), 'DB' = débito
}

interface ConsultaResponse {
  httpStatus?: { statusCode?: string; statusDesc?: string };
  dataResponse?: { transactionDetail?: BanescoTransaction[] } | null;
}

// ================================
// Errores
// ================================

/**
 * Qué salió mal, en términos que le sirvan al cajero. La distinción que
 * importa es de quién es la culpa: si el banco está caído el pago igual pudo
 * haber llegado y hay que reintentar; si falta configuración hay que llamar a
 * soporte; y si no hay internet no se consultó nada.
 */
export type BanescoFailureKind =
  | 'validator_offline'  // el microservicio validador no está arriba (Cloud Run dormido/caído)
  | 'validator_error'    // el validador está arriba pero reventó
  | 'network'            // el navegador no pudo ni salir a la red
  | 'timeout'            // el validador no contestó a tiempo
  | 'bank_unavailable'   // Banesco caído o en mantenimiento
  | 'bank_timeout'       // Banesco no contestó a tiempo
  | 'bank_auth'          // Banesco rechazó las credenciales del validador
  | 'bank_rejected'      // Banesco rechazó los datos de la consulta
  | 'bank_error'         // otro error del lado de Banesco
  | 'not_configured'     // al validador le faltan credenciales
  | 'rate_limited'       // demasiadas consultas seguidas
  | 'bad_request'        // datos inválidos enviados desde la app
  | 'unknown';

/** De quién es el problema — define el tono con que se muestra en pantalla. */
export type BanescoFailureSource = 'bank' | 'validator' | 'network' | 'app';

interface FailureProfile {
  source: BanescoFailureSource;
  retryable: boolean;
  message: string;
  hint?: string;
}

/**
 * Mensaje al cajero por categoría. `hint` aclara qué significa para la venta:
 * cuando la consulta no se pudo hacer, lo importante es dejar claro que eso
 * NO quiere decir que el pago no llegó.
 */
const FAILURE_PROFILES: Record<BanescoFailureKind, FailureProfile> = {
  validator_offline: {
    source: 'validator',
    retryable: true,
    message: 'El validador de pagos no está disponible.',
    hint: 'No es el banco ni la referencia: el servicio de validación no está respondiendo. Probá de nuevo en un minuto y avisale a soporte si sigue igual.',
  },
  validator_error: {
    source: 'validator',
    retryable: true,
    message: 'El validador de pagos falló al procesar la consulta.',
    hint: 'Probá de nuevo. Si se repite, avisale a soporte.',
  },
  network: {
    source: 'network',
    retryable: true,
    message: 'Sin conexión con el validador de pagos.',
    hint: 'Revisá el internet del local y volvé a intentar.',
  },
  timeout: {
    source: 'validator',
    retryable: true,
    message: 'La consulta tardó demasiado y se canceló.',
    hint: 'El pago puede haber llegado igual. Volvé a intentar en un momento.',
  },
  bank_unavailable: {
    source: 'bank',
    retryable: true,
    message: 'Banesco no está respondiendo (su servicio está caído o en mantenimiento).',
    hint: 'Esto no dice nada sobre el pago: puede haber entrado perfectamente. Reintentá en unos minutos o verificá el pago en la app del banco.',
  },
  bank_timeout: {
    source: 'bank',
    retryable: true,
    message: 'Banesco tardó demasiado en responder.',
    hint: 'Su servicio está lento. Reintentá en un momento — el pago no se ve afectado.',
  },
  bank_auth: {
    source: 'validator',
    retryable: false,
    message: 'Banesco rechazó las credenciales del validador.',
    hint: 'Hay que renovar el usuario o la clave del servicio. Avisale a soporte: reintentar no sirve.',
  },
  bank_rejected: {
    source: 'app',
    retryable: false,
    message: 'Banesco rechazó la consulta.',
    hint: 'Revisá la fecha, la referencia y el banco emisor antes de reintentar.',
  },
  bank_error: {
    source: 'bank',
    retryable: true,
    message: 'Banesco devolvió un error al consultar los movimientos.',
    hint: 'Es un problema del banco, no del pago. Reintentá en unos minutos.',
  },
  not_configured: {
    source: 'validator',
    retryable: false,
    message: 'El validador no tiene configuradas las credenciales de Banesco.',
    hint: 'Es un problema de configuración del servicio. Avisale a soporte: reintentar no sirve.',
  },
  rate_limited: {
    source: 'bank',
    retryable: true,
    message: 'Se hicieron demasiadas consultas seguidas.',
    hint: 'Esperá unos segundos antes de volver a validar.',
  },
  bad_request: {
    source: 'app',
    retryable: false,
    message: 'La consulta se envió con datos incompletos.',
    hint: 'Revisá la referencia y la fecha.',
  },
  unknown: {
    source: 'validator',
    retryable: true,
    message: 'No se pudo consultar Banesco.',
    hint: 'Volvé a intentar. Si sigue fallando, avisale a soporte.',
  },
};

/** Error tipado de cualquier llamada al validador. */
export class BanescoValidatorError extends Error {
  readonly kind: BanescoFailureKind;
  readonly source: BanescoFailureSource;
  readonly retryable: boolean;
  readonly hint?: string;
  /** Código HTTP del validador (null si no hubo respuesta). */
  readonly httpStatus: number | null;
  /** Código HTTP que devolvió Banesco al validador, si lo hubo. */
  readonly upstreamStatus: number | null;
  /** Detalle técnico para el log — no se muestra como mensaje principal. */
  readonly detail?: string;

  constructor(
    kind: BanescoFailureKind,
    opts: { httpStatus?: number | null; upstreamStatus?: number | null; detail?: string; message?: string } = {},
  ) {
    const profile = FAILURE_PROFILES[kind];
    super(opts.message ?? profile.message);
    this.name = 'BanescoValidatorError';
    this.kind = kind;
    this.source = profile.source;
    this.retryable = profile.retryable;
    this.hint = profile.hint;
    this.httpStatus = opts.httpStatus ?? null;
    this.upstreamStatus = opts.upstreamStatus ?? null;
    this.detail = opts.detail;
  }

  /** ¿La falla es del banco (y no nuestra)? */
  get isBankFault(): boolean {
    return this.source === 'bank';
  }
}

/**
 * Normaliza cualquier excepción a BanescoValidatorError para que la UI no
 * tenga que hacer `err?.message` a ciegas.
 */
export function toBanescoError(err: unknown): BanescoValidatorError {
  if (err instanceof BanescoValidatorError) return err;
  const detail = err instanceof Error ? err.message : String(err);
  return new BanescoValidatorError('unknown', { detail });
}

/** Códigos que emite el microservicio → categoría del front. */
const CODE_TO_KIND: Record<string, BanescoFailureKind> = {
  NOT_CONFIGURED: 'not_configured',
  BANK_UNREACHABLE: 'bank_unavailable',
  BANK_TIMEOUT: 'bank_timeout',
  BANK_UNAVAILABLE: 'bank_unavailable',
  BANK_AUTH: 'bank_auth',
  BANK_REJECTED: 'bank_rejected',
  BANK_ERROR: 'bank_error',
  INTERNAL: 'validator_error',
};

/**
 * Clasifica una respuesta HTTP fallida.
 *
 * El cuerpo manda: si viene JSON con `code`, es el validador hablando y se
 * confía en su clasificación. Si no hay JSON, la respuesta no la generó
 * nuestra app sino la infraestructura (Cloud Run devuelve un HTML de "service
 * unavailable" cuando el contenedor no está arriba), así que un 502/503/504
 * sin JSON significa que el validador está caído — no el banco.
 */
async function classifyResponse(res: Response): Promise<BanescoValidatorError> {
  const raw = await res.text().catch(() => '');
  let body: any = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    /* respuesta no-JSON (HTML de Cloud Run, proxy, etc.) */
  }

  const upstreamStatus: number | null = body?.upstreamStatus ?? null;
  const detail: string = body?.detail || body?.error || raw.slice(0, 200);
  const opts = { httpStatus: res.status, upstreamStatus, detail };

  if (body?.code && CODE_TO_KIND[body.code]) {
    return new BanescoValidatorError(CODE_TO_KIND[body.code], opts);
  }

  // Sin `code`: puede ser una versión vieja del validador o la infraestructura.
  const isOurJson = Boolean(body && (body.error || body.detail));

  switch (res.status) {
    case 400:
      return new BanescoValidatorError('bad_request', {
        ...opts,
        message: detail || undefined,
      });
    case 401:
    case 403:
      return new BanescoValidatorError('bank_auth', opts);
    case 404:
      // La ruta no existe: el validador desplegado no es el que espera la app.
      return new BanescoValidatorError('validator_offline', opts);
    case 429:
      // Sin JSON el 429 no es nuestro: Cloud Run lo devuelve cuando no puede
      // levantar instancias (pasa, por ejemplo, mientras se reactiva el
      // billing). Decirle al cajero "esperá unos segundos" ahí sería mentira.
      return new BanescoValidatorError(isOurJson ? 'rate_limited' : 'validator_offline', opts);
    case 502:
    case 504:
      // El validador viejo mandaba 502 con JSON para toda falla del banco.
      return new BanescoValidatorError(isOurJson ? 'bank_error' : 'validator_offline', opts);
    case 503:
      return new BanescoValidatorError(isOurJson ? 'bank_unavailable' : 'validator_offline', opts);
    case 500:
      return new BanescoValidatorError(isOurJson ? 'validator_error' : 'validator_offline', opts);
    default:
      return new BanescoValidatorError(res.status >= 500 ? 'validator_error' : 'unknown', opts);
  }
}

/**
 * Tope de espera del lado del navegador. Va por encima del tope interno del
 * validador (30 s) para que, cuando el banco cuelga, el mensaje que gane sea
 * el del validador ("Banesco no responde") y no un timeout genérico de acá.
 */
const REQUEST_TIMEOUT_MS = 40_000;

/**
 * Única puerta de salida hacia el validador: agrega el timeout y convierte
 * cualquier falla en un BanescoValidatorError ya clasificado.
 */
async function requestValidator<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err: any) {
    const kind: BanescoFailureKind =
      err?.name === 'TimeoutError' || err?.name === 'AbortError' ? 'timeout' : 'network';
    throw new BanescoValidatorError(kind, { detail: err?.message });
  }

  if (!res.ok) throw await classifyResponse(res);

  try {
    return (await res.json()) as T;
  } catch (err: any) {
    throw new BanescoValidatorError('validator_error', {
      httpStatus: res.status,
      detail: `Respuesta ilegible: ${err?.message}`,
    });
  }
}

/** POST con cuerpo JSON al validador. */
function postValidator<T>(path: string, body: unknown): Promise<T> {
  return requestValidator<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export interface ValidacionCredito {
  found: boolean;
  match?: BanescoTransaction;
  /** Total de créditos revisados en el rango (para diagnóstico). */
  reviewed: number;
}

/**
 * Métodos de pago que caen en la cuenta Banesco y por lo tanto se pueden
 * verificar contra el estado de cuenta. Tanto el pago móvil como la
 * transferencia bancaria llegan como crédito (trnType 'CR') con su
 * referencia, así que se validan con la misma consulta.
 *
 * Zelle/Binance/Paypal NO están acá: son cuentas externas que Banesco no ve.
 */
export const BANESCO_VALIDATABLE_METHODS = ['Pago movil', 'Transferencia bancaria'] as const;

/** ¿Este método de pago se puede verificar contra Banesco? */
export function isBanescoValidatable(methodName: string | null | undefined): boolean {
  const name = String(methodName ?? '');
  return /m[oó]vil/i.test(name) || /transferencia/i.test(name);
}

/** Formatea una fecha a 'YYYY-MM-DD' en hora local. */
function toApiDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Consulta todas las transacciones de la cuenta en un rango de fechas.
 * Devuelve el listado de movimientos (créditos y débitos).
 */
export async function consultarPagosPorFecha(opts: {
  startDt: string;
  endDt: string;
}): Promise<BanescoTransaction[]> {
  const data = await postValidator<ConsultaResponse>('/api/pagos/consultar-por-fecha', {
    startDt: opts.startDt,
    endDt: opts.endDt,
  });
  return data.dataResponse?.transactionDetail ?? [];
}

export interface Banco {
  code: string;
  name: string;
}

/**
 * Catálogo cacheado en memoria. El listado de bancos no cambia durante la
 * sesión y se usa para traducir el código del banco emisor ('0102') a un
 * nombre legible en cada resultado de validación — sin esto el cajero ve
 * solo el número. Si la consulta falla se limpia la caché para reintentar.
 */
let bancosCache: Promise<Banco[]> | null = null;

export function getBancosCached(): Promise<Banco[]> {
  if (!bancosCache) {
    bancosCache = getBancos().catch((err) => {
      bancosCache = null;
      throw err;
    });
  }
  return bancosCache;
}

/** Catálogo de bancos venezolanos (GET /api/bancos). */
export async function getBancos(): Promise<Banco[]> {
  const data = await requestValidator<{ banks?: Banco[] }>('/api/bancos');
  return data?.banks ?? [];
}

/**
 * Normaliza un teléfono al formato que espera Banesco: código de país 58 +
 * número sin el 0 inicial. Ej: "04143775031" -> "584143775031".
 */
export function normalizePhone(phone: string): string {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (digits.startsWith('58')) return digits;
  if (digits.startsWith('0')) return `58${digits.slice(1)}`;
  return `58${digits}`;
}

/**
 * Busca un pago móvil por referencia + teléfono + banco emisor + fecha
 * (POST /api/pagos/buscar-pago-movil). Devuelve las transacciones que
 * Banesco asocia a esa búsqueda.
 */
export async function buscarPagoMovil(opts: {
  referenceNumber: string;
  phoneNum: string;
  bankId: string;
  startDt: string;
}): Promise<BanescoTransaction[]> {
  const data = await postValidator<ConsultaResponse>('/api/pagos/buscar-pago-movil', {
    referenceNumber: opts.referenceNumber,
    phoneNum: normalizePhone(opts.phoneNum),
    bankId: opts.bankId,
    startDt: opts.startDt,
  });
  return data.dataResponse?.transactionDetail ?? [];
}

/** Normaliza una referencia: solo dígitos, sin espacios ni ceros de relleno a la izquierda quitados. */
function normalizeRef(ref: string): string {
  return (ref ?? '').replace(/\D/g, '');
}

/**
 * Compara dos referencias. Banesco devuelve la referencia completa
 * (p. ej. "12346050206") mientras el cajero suele anotar solo el tramo
 * final visible (p. ej. "050206"). Se consideran iguales si una termina
 * con la otra (con un mínimo de 4 dígitos para evitar falsos positivos).
 */
export function refMatches(entered: string, fromBank: string): boolean {
  const a = normalizeRef(entered);
  const b = normalizeRef(fromBank);
  if (a.length < 4 || b.length < 4) return false;
  return a === b || b.endsWith(a) || a.endsWith(b);
}

/**
 * Valida un pago recibido (pago móvil o transferencia bancaria) buscando en
 * las transacciones de Banesco del día un crédito (CR) cuya referencia y
 * monto coincidan con lo cargado en el POS.
 *
 * Sirve para ambos métodos porque el estado de cuenta no distingue el canal:
 * todo lo que entra a la cuenta aparece como crédito con su referencia.
 *
 * @param referenceNumber Referencia que escribió el cajero.
 * @param amountVes Monto en bolívares (0 = no se valida el monto, solo la referencia).
 * @param date Fecha a consultar (por defecto hoy).
 */
export async function validarCreditoBancario(opts: {
  referenceNumber: string;
  amountVes?: number;
  date?: Date;
}): Promise<ValidacionCredito> {
  const { referenceNumber, amountVes = 0, date = new Date() } = opts;
  const startDt = toApiDate(date);

  const data = await postValidator<ConsultaResponse>('/api/pagos/consultar-por-fecha', {
    startDt,
    endDt: startDt,
  });
  const detail = data.dataResponse?.transactionDetail ?? [];

  // Solo créditos (dinero recibido).
  const credits = detail.filter((t) => t.trnType?.trim().toUpperCase() === 'CR');

  const match = credits.find((t) => {
    if (!refMatches(referenceNumber, t.referenceNumber)) return false;
    if (amountVes > 0 && Math.abs(t.amount - amountVes) > 0.01) return false;
    return true;
  });

  return { found: Boolean(match), match, reviewed: credits.length };
}
