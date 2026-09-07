import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc,
  query, where, orderBy, limit, Timestamp,
} from 'firebase/firestore';
import { db } from '@/config/firebase';
import { shiftDateKey } from '@/utils/dateUtils';
import type {
  AppUser, Branch, CashCount, CashCountEntry, CashCurrency, CashMovement,
  CashMovementSource, CashSession, CashSessionSnapshot, DenominationCount, Invoice,
} from '@/types';

export const CASH_SESSIONS = 'cashSessions';
export const CASH_MOVEMENTS = 'cashMovements';
export const CASH_COUNTS = 'cashCounts';
export const CASH_COUNT_HISTORY = 'cashCountHistory';

/** Nombres exactos de los métodos que mueven efectivo físico. */
export const CASH_METHOD_VES = 'Efectivo (Bs)';
export const CASH_METHOD_USD = 'Efectivo ($)';

/**
 * Devuelve la moneda de gaveta de un método de pago, o null si ese
 * método no toca efectivo (Zelle, Pago móvil, Crédito...).
 */
export function cashCurrencyOfMethod(methodName: string | null | undefined): CashCurrency | null {
  if (methodName === CASH_METHOD_VES) return 'ves';
  if (methodName === CASH_METHOD_USD) return 'usd';
  return null;
}

/** ¿Este método de pago existe y mueve efectivo? */
export function isCashMethod(methodName: string | null | undefined): boolean {
  return cashCurrencyOfMethod(methodName) !== null;
}

/** ID compartido por la caja y el arqueo de un día/sucursal. */
function dayBranchId(dateKey: string, branch: Branch): string {
  return `${dateKey}_${branch}`;
}

/**
 * Límites del día en horario Venezuela (UTC-4, sin horario de verano).
 *
 * Se fija el offset explícitamente en vez de usar `new Date('YYYY-MM-DDT00:00:00')`
 * para que el cierre dé lo mismo aunque la PC del cajero tenga mal la zona
 * horaria — un error tipográfico en la config de Windows no puede mover
 * ventas de un día a otro.
 */
function dayBounds(dateKey: string): { start: Date; end: Date } {
  return {
    start: new Date(`${dateKey}T00:00:00.000-04:00`),
    end: new Date(`${dateKey}T23:59:59.999-04:00`),
  };
}

// ════════════════════════════════════════
// SESIONES
// ════════════════════════════════════════

export async function getSession(dateKey: string, branch: Branch): Promise<CashSession | null> {
  const snap = await getDoc(doc(db, CASH_SESSIONS, dayBranchId(dateKey, branch)));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as CashSession;
}

/**
 * Busca el último cierre anterior para sugerir el fondo inicial.
 *
 * Camina hacia atrás día por día (hasta `maxDaysBack`) leyendo por ID en
 * vez de hacer una query ordenada. Son como mucho 7 lecturas puntuales y
 * evita tener que crear un índice compuesto en Firestore.
 */
export async function getPreviousClose(
  dateKey: string,
  branch: Branch,
  maxDaysBack = 7,
): Promise<CashSession | null> {
  for (let i = 1; i <= maxDaysBack; i++) {
    const prev = await getSession(shiftDateKey(dateKey, -i), branch);
    if (prev?.status === 'closed' && prev.snapshot) return prev;
  }
  return null;
}

export async function openSession(opts: {
  dateKey: string;
  branch: Branch;
  openingVes: number;
  openingUsd: number;
  note?: string;
  user: AppUser;
}): Promise<void> {
  const { dateKey, branch, openingVes, openingUsd, note, user } = opts;

  const existing = await getSession(dateKey, branch);
  if (existing) {
    throw new Error(
      existing.status === 'open'
        ? 'Ya hay una caja abierta para ese día y sucursal.'
        : 'La caja de ese día ya fue cerrada. Reábrela para modificarla.',
    );
  }

  const session: Omit<CashSession, 'id'> = {
    dateKey,
    branch,
    status: 'open',
    openingVes: round2(openingVes),
    openingUsd: round2(openingUsd),
    openedAt: Timestamp.now(),
    openedByUid: user.uid,
    openedByName: `${user.nombre} ${user.apellido}`.trim(),
    ...(note?.trim() ? { openingNote: note.trim() } : {}),
  };

  await setDoc(doc(db, CASH_SESSIONS, dayBranchId(dateKey, branch)), session);
}

export async function closeSession(opts: {
  dateKey: string;
  branch: Branch;
  snapshot: CashSessionSnapshot;
  note?: string;
  user: AppUser;
}): Promise<void> {
  const { dateKey, branch, snapshot, note, user } = opts;

  const existing = await getSession(dateKey, branch);
  if (!existing) throw new Error('No hay caja abierta para ese día y sucursal.');
  if (existing.status === 'closed') throw new Error('Esa caja ya está cerrada.');

  await updateDoc(doc(db, CASH_SESSIONS, dayBranchId(dateKey, branch)), {
    status: 'closed',
    closedAt: Timestamp.now(),
    closedByUid: user.uid,
    closedByName: `${user.nombre} ${user.apellido}`.trim(),
    ...(note?.trim() ? { closingNote: note.trim() } : {}),
    snapshot,
  });
}

/** Reabre una caja cerrada (solo admin desde la UI). El snapshot queda descartado. */
export async function reopenSession(dateKey: string, branch: Branch): Promise<void> {
  const existing = await getSession(dateKey, branch);
  if (!existing) throw new Error('No existe esa caja.');
  if (existing.status === 'open') throw new Error('Esa caja ya está abierta.');

  const { deleteField } = await import('firebase/firestore');
  await updateDoc(doc(db, CASH_SESSIONS, dayBranchId(dateKey, branch)), {
    status: 'open',
    closedAt: deleteField(),
    closedByUid: deleteField(),
    closedByName: deleteField(),
    snapshot: deleteField(),
  });
}

// ════════════════════════════════════════
// MOVIMIENTOS
// ════════════════════════════════════════

/**
 * Registra un movimiento de efectivo.
 *
 * Se llama desde el panel de caja (manual) y desde invoiceService cuando
 * un abono, devolución o cambio mueve efectivo. Nunca se llama para las
 * ventas del día: esas se leen directo de las facturas.
 *
 * Nota: NO falla si no hay caja abierta. El movimiento queda registrado
 * igual con su dateKey y aparece cuando se abra/consulte esa caja —
 * preferible a bloquear una devolución porque nadie abrió la caja.
 */
export async function recordCashMovement(opts: {
  dateKey: string;
  branch: Branch;
  direction: 'in' | 'out';
  currency: CashCurrency;
  amount: number;
  source: CashMovementSource;
  concept: string;
  invoiceId?: string;
  invoiceNumericId?: number;
  user: { uid: string; name: string };
}): Promise<void> {
  const amount = round2(Math.abs(opts.amount));
  if (amount < 0.01) return; // nada que registrar

  await addDoc(collection(db, CASH_MOVEMENTS), {
    dateKey: opts.dateKey,
    branch: opts.branch,
    direction: opts.direction,
    currency: opts.currency,
    amount,
    source: opts.source,
    concept: opts.concept,
    ...(opts.invoiceId ? { invoiceId: opts.invoiceId } : {}),
    ...(opts.invoiceNumericId !== undefined ? { invoiceNumericId: opts.invoiceNumericId } : {}),
    createdAt: Timestamp.now(),
    createdByUid: opts.user.uid,
    createdByName: opts.user.name,
  });
}

export async function fetchMovements(dateKey: string, branch: Branch): Promise<CashMovement[]> {
  // Solo filtros de igualdad y orden en cliente: así no hace falta
  // crear un índice compuesto en Firestore.
  const snap = await getDocs(query(
    collection(db, CASH_MOVEMENTS),
    where('dateKey', '==', dateKey),
    where('branch', '==', branch),
  ));

  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as CashMovement)
    .sort((a, b) => (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0));
}

/** Borra un movimiento. Solo se permite para los cargados a mano. */
export async function deleteMovement(movement: CashMovement): Promise<void> {
  if (movement.source !== 'manual') {
    throw new Error('Solo se pueden borrar los movimientos cargados a mano.');
  }
  await deleteDoc(doc(db, CASH_MOVEMENTS, movement.id));
}

// ════════════════════════════════════════
// CÁLCULO DEL DÍA
// ════════════════════════════════════════

export interface CashInvoiceLine {
  invoiceId: string;
  numericId: number;
  sellerName: string;
  ves: number;
  usd: number;
  changeVes: number;
  changeUsd: number;
  changeUnassignedUsd: number;
}

export interface CashDayData {
  dateKey: string;
  branch: Branch;
  salesVes: number;
  salesUsd: number;
  changeVes: number;
  changeUsd: number;
  changeUnassignedUsd: number;
  movementsInVes: number;
  movementsInUsd: number;
  movementsOutVes: number;
  movementsOutUsd: number;
  movements: CashMovement[];
  invoiceLines: CashInvoiceLine[];
  /** Facturas del día que se anularon — su efectivo NO se cuenta. */
  cancelledCount: number;
}

/**
 * Lee las facturas y movimientos del día y arma los totales de efectivo.
 *
 * Qué entra:
 *  - pagos con método 'Efectivo (Bs)' / 'Efectivo ($)' de facturas de ESE día
 *  - movimientos registrados con ese dateKey (abonos, devoluciones, cambios, manuales)
 * Qué sale:
 *  - el vuelto entregado (changeGiven), imputado a la gaveta según changeCurrency
 *
 * Las facturas 'Cancelado' se excluyen: la venta se deshizo y el stock
 * volvió, así que su efectivo no debería estar en la gaveta.
 */
export async function computeCashDay(dateKey: string, branch: Branch): Promise<CashDayData> {
  const { start, end } = dayBounds(dateKey);

  const [invoiceSnap, movements] = await Promise.all([
    getDocs(query(
      collection(db, 'invoices'),
      where('date', '>=', Timestamp.fromDate(start)),
      where('date', '<=', Timestamp.fromDate(end)),
    )),
    fetchMovements(dateKey, branch),
  ]);

  let salesVes = 0, salesUsd = 0;
  let changeVes = 0, changeUsd = 0, changeUnassignedUsd = 0;
  let cancelledCount = 0;
  const invoiceLines: CashInvoiceLine[] = [];

  invoiceSnap.docs.forEach((d) => {
    const inv = { id: d.id, ...d.data() } as Invoice;
    if ((inv.branch || 'store') !== branch) return;

    if (inv.status === 'Cancelado') {
      cancelledCount++;
      return;
    }

    let lineVes = 0, lineUsd = 0;
    (inv.payments || []).forEach((p) => {
      const currency = cashCurrencyOfMethod(p.method);
      if (currency === 'ves') lineVes += p.amountVes || 0;
      else if (currency === 'usd') lineUsd += p.amountUsd || 0;
    });

    // ── Vuelto: sale de la gaveta ──
    let lineChangeVes = 0, lineChangeUsd = 0, lineChangeUnassigned = 0;
    const change = inv.changeGiven || 0;
    if (change > 0.001) {
      if (inv.changeCurrency === 'usd') {
        lineChangeUsd = change;
      } else if (inv.changeCurrency === 'ves') {
        // changeGiven se guarda en USD; se convierte con la tasa de ESA factura.
        lineChangeVes = change * (inv.exchangeRate || 0);
      } else {
        // Factura anterior al selector de moneda: no adivinamos de qué
        // gaveta salió, se muestra aparte.
        lineChangeUnassigned = change;
      }
    }

    if (lineVes || lineUsd || lineChangeVes || lineChangeUsd || lineChangeUnassigned) {
      invoiceLines.push({
        invoiceId: inv.id,
        numericId: inv.numericId,
        sellerName: inv.sellerName || '—',
        ves: round2(lineVes),
        usd: round2(lineUsd),
        changeVes: round2(lineChangeVes),
        changeUsd: round2(lineChangeUsd),
        changeUnassignedUsd: round2(lineChangeUnassigned),
      });
    }

    salesVes += lineVes;
    salesUsd += lineUsd;
    changeVes += lineChangeVes;
    changeUsd += lineChangeUsd;
    changeUnassignedUsd += lineChangeUnassigned;
  });

  invoiceLines.sort((a, b) => b.numericId - a.numericId);

  let movementsInVes = 0, movementsInUsd = 0, movementsOutVes = 0, movementsOutUsd = 0;
  movements.forEach((m) => {
    const amt = m.amount || 0;
    if (m.direction === 'in') {
      if (m.currency === 'ves') movementsInVes += amt; else movementsInUsd += amt;
    } else {
      if (m.currency === 'ves') movementsOutVes += amt; else movementsOutUsd += amt;
    }
  });

  return {
    dateKey,
    branch,
    salesVes: round2(salesVes),
    salesUsd: round2(salesUsd),
    changeVes: round2(changeVes),
    changeUsd: round2(changeUsd),
    changeUnassignedUsd: round2(changeUnassignedUsd),
    movementsInVes: round2(movementsInVes),
    movementsInUsd: round2(movementsInUsd),
    movementsOutVes: round2(movementsOutVes),
    movementsOutUsd: round2(movementsOutUsd),
    movements,
    invoiceLines,
    cancelledCount,
  };
}

/**
 * Efectivo que DEBERÍA haber en la gaveta:
 *   fondo inicial + ventas en efectivo + ingresos − vuelto − egresos
 */
export function expectedCash(session: Pick<CashSession, 'openingVes' | 'openingUsd'>, day: CashDayData) {
  return {
    expectedVes: round2(
      session.openingVes + day.salesVes + day.movementsInVes - day.changeVes - day.movementsOutVes,
    ),
    expectedUsd: round2(
      session.openingUsd + day.salesUsd + day.movementsInUsd - day.changeUsd - day.movementsOutUsd,
    ),
  };
}

export function buildSnapshot(opts: {
  session: CashSession;
  day: CashDayData;
  countedVes: number;
  countedUsd: number;
  exchangeRate: number;
}): CashSessionSnapshot {
  const { session, day, countedVes, countedUsd, exchangeRate } = opts;
  const { expectedVes, expectedUsd } = expectedCash(session, day);

  return {
    salesVes: day.salesVes,
    salesUsd: day.salesUsd,
    changeVes: day.changeVes,
    changeUsd: day.changeUsd,
    changeUnassignedUsd: day.changeUnassignedUsd,
    movementsInVes: day.movementsInVes,
    movementsInUsd: day.movementsInUsd,
    movementsOutVes: day.movementsOutVes,
    movementsOutUsd: day.movementsOutUsd,
    expectedVes,
    expectedUsd,
    countedVes: round2(countedVes),
    countedUsd: round2(countedUsd),
    diffVes: round2(countedVes - expectedVes),
    diffUsd: round2(countedUsd - expectedUsd),
    exchangeRate,
    invoiceCount: day.invoiceLines.length,
  };
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ════════════════════════════════════════
// ARQUEO POR DENOMINACIÓN
// ════════════════════════════════════════

/** Billetes de dólar que se cuentan, de menor a mayor. */
export const USD_DENOMINATIONS = [1, 5, 10, 20, 50, 100] as const;

const BRANCHES: Branch[] = ['store', 'warehouse'];

export function emptyDenominationCount(): DenominationCount {
  return { bills: {}, loose: 0 };
}

/** Total de un fajo: suelto + Σ (denominación × cantidad). */
export function denominationTotal(count: DenominationCount | null | undefined): number {
  if (!count) return 0;
  const bills = USD_DENOMINATIONS.reduce(
    (sum, den) => sum + den * (count.bills?.[String(den)] || 0),
    0,
  );
  return round2(bills + (count.loose || 0));
}

/** Descarta cantidades negativas, decimales y ceros antes de guardar. */
function normalizeCount(count: DenominationCount): DenominationCount {
  const bills: Record<string, number> = {};
  USD_DENOMINATIONS.forEach((den) => {
    const qty = Math.floor(count.bills?.[String(den)] || 0);
    if (qty > 0) bills[String(den)] = qty;
  });
  return { bills, loose: round2(Math.max(0, count.loose || 0)) };
}

/** El efectivo que hay ahora en cada sucursal. Doc ID = la sucursal. */
export async function fetchCashCounts(): Promise<Record<Branch, CashCount | null>> {
  const snaps = await Promise.all(BRANCHES.map((b) => getDoc(doc(db, CASH_COUNTS, b))));

  const result = {} as Record<Branch, CashCount | null>;
  BRANCHES.forEach((b, i) => {
    const snap = snaps[i];
    result[b] = snap.exists() ? ({ id: snap.id, ...snap.data() } as CashCount) : null;
  });
  return result;
}

/** El total en dólares de una sucursal: mostrador + caja de administración. */
export function cashCountTotal(count: Pick<CashCount, 'admin' | 'counter'> | null): number {
  if (!count) return 0;
  return round2(denominationTotal(count.counter) + denominationTotal(count.admin));
}

/**
 * Guarda el conteo actual de una sucursal y, si cambió, deja la constancia
 * en el historial.
 *
 * Devuelve `changed: false` cuando los números vinieron iguales a lo que ya
 * estaba: así apretar Guardar dos veces no llena el historial de entradas
 * que no dicen nada.
 */
export async function saveCashCount(opts: {
  branch: Branch;
  admin: DenominationCount;
  counter: DenominationCount;
  user: AppUser;
}): Promise<{ saved: CashCount; changed: boolean }> {
  const { branch, user } = opts;

  const admin = normalizeCount(opts.admin);
  const counter = normalizeCount(opts.counter);

  const ref = doc(db, CASH_COUNTS, branch);
  const before = (await getDoc(ref)).data() as CashCount | undefined;

  const changed = !before
    || JSON.stringify([normalizeCount(before.admin), normalizeCount(before.counter)])
       !== JSON.stringify([admin, counter]);

  const userName = `${user.nombre} ${user.apellido}`.trim();
  const now = Timestamp.now();

  const saved: CashCount = {
    id: branch,
    branch,
    admin,
    counter,
    updatedAt: now,
    updatedByUid: user.uid,
    updatedByName: userName,
  };

  if (!changed) return { saved: before ? { ...before, id: branch } : saved, changed: false };

  const { id: _id, ...payload } = saved;
  await setDoc(ref, payload);

  await addDoc(collection(db, CASH_COUNT_HISTORY), {
    branch,
    admin,
    counter,
    total: cashCountTotal({ admin, counter }),
    previousTotal: before ? cashCountTotal(before) : null,
    changedAt: now,
    changedByUid: user.uid,
    changedByName: userName,
  });

  return { saved, changed: true };
}

/** Los últimos cambios de efectivo, del más nuevo al más viejo. */
export async function fetchCashCountHistory(limitNum = 50): Promise<CashCountEntry[]> {
  // orderBy sobre un solo campo, sin where: no hace falta índice compuesto.
  const snap = await getDocs(query(
    collection(db, CASH_COUNT_HISTORY),
    orderBy('changedAt', 'desc'),
    limit(limitNum),
  ));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as CashCountEntry);
}

/** Las cajas de las dos sucursales de un día, para saber cuáles están cerradas. */
export async function fetchSessions(dateKey: string): Promise<Record<Branch, CashSession | null>> {
  const sessions = await Promise.all(BRANCHES.map((b) => getSession(dateKey, b)));

  const result = {} as Record<Branch, CashSession | null>;
  BRANCHES.forEach((b, i) => { result[b] = sessions[i]; });
  return result;
}
