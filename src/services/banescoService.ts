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

export interface ValidacionPagoMovil {
  found: boolean;
  match?: BanescoTransaction;
  /** Total de créditos revisados en el rango (para diagnóstico). */
  reviewed: number;
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
  const res = await fetch(`${BASE_URL}/api/pagos/consultar-por-fecha`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ startDt: opts.startDt, endDt: opts.endDt }),
  });

  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = body?.detail || body?.error || '';
    } catch { /* respuesta sin JSON */ }
    throw new Error(detail || `El validador respondió ${res.status}`);
  }

  const data: ConsultaResponse = await res.json();
  return data.dataResponse?.transactionDetail ?? [];
}

export interface Banco {
  code: string;
  name: string;
}

/** Catálogo de bancos venezolanos (GET /api/bancos). */
export async function getBancos(): Promise<Banco[]> {
  const res = await fetch(`${BASE_URL}/api/bancos`);
  if (!res.ok) throw new Error(`No se pudo cargar el catálogo de bancos (${res.status})`);
  const data = await res.json();
  return (data?.banks as Banco[]) ?? [];
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
  const res = await fetch(`${BASE_URL}/api/pagos/buscar-pago-movil`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      referenceNumber: opts.referenceNumber,
      phoneNum: normalizePhone(opts.phoneNum),
      bankId: opts.bankId,
      startDt: opts.startDt,
    }),
  });

  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = body?.detail || body?.error || '';
    } catch { /* sin JSON */ }
    throw new Error(detail || `El validador respondió ${res.status}`);
  }

  const data: ConsultaResponse = await res.json();
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
 * Valida un pago móvil buscando en las transacciones de Banesco del día
 * un crédito (CR) cuya referencia y monto coincidan con lo cargado en el POS.
 *
 * @param referenceNumber Referencia que escribió el cajero.
 * @param amountVes Monto en bolívares (0 = no se valida el monto, solo la referencia).
 * @param date Fecha a consultar (por defecto hoy).
 */
export async function validarPagoMovil(opts: {
  referenceNumber: string;
  amountVes?: number;
  date?: Date;
}): Promise<ValidacionPagoMovil> {
  const { referenceNumber, amountVes = 0, date = new Date() } = opts;
  const startDt = toApiDate(date);

  const res = await fetch(`${BASE_URL}/api/pagos/consultar-por-fecha`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ startDt, endDt: startDt }),
  });

  if (!res.ok) {
    throw new Error(`El validador respondió ${res.status}`);
  }

  const data: ConsultaResponse = await res.json();
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
