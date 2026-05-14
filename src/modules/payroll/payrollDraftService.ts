/**
 * Servicio del módulo de Cierre de Nómina (libre/informal).
 *
 * Colección Firestore: payrollDraftPeriods
 * Doc ID: auto-generado por addDoc()
 *
 * Operaciones expuestas:
 *  - listPeriods()    → trae todos los períodos ordenados desc por createdAt
 *  - createPeriod()   → crea uno nuevo, asigna numericId incremental
 *  - savePeriod()     → upsert (guarda cambios de items/totales/etc.)
 *  - closePeriod()    → marca status = 'closed' (sigue siendo legible)
 *  - reopenPeriod()   → marca status = 'open'
 *  - deletePeriod()   → solo si está open (para borrar drafts vacíos)
 *
 * Los items NUNCA se persisten con signo negativo: el flag isDeduction
 * indica si se resta. Todo cálculo de totales pasa por calcEmployeeTotal
 * y calcGrandTotal para que la lógica de signos viva en un solo lugar.
 */

import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  query,
  orderBy,
  runTransaction,
  Timestamp,
} from 'firebase/firestore';
import { db } from '@/config/firebase';
import type { AppUser, PayrollDraftPeriod, PayrollDraftEmployee, PayrollDraftItem } from '@/types';

const COL = 'payrollDraftPeriods';

// ════════════════════════════════════════════════
// HELPERS DE CÁLCULO (única fuente de verdad)
// ════════════════════════════════════════════════

export function calcEmployeeTotal(emp: PayrollDraftEmployee): number {
  return emp.items.reduce((acc, item) => {
    const v = Number.isFinite(item.amount) ? item.amount : 0;
    return acc + (item.isDeduction ? -v : v);
  }, 0);
}

export function calcGrandTotal(period: PayrollDraftPeriod): number {
  return period.employees.reduce((acc, e) => acc + calcEmployeeTotal(e), 0);
}

/** Recalcula totales de empleados y grand total, devolviendo un período coherente. */
export function recalcPeriod(period: PayrollDraftPeriod): PayrollDraftPeriod {
  const employees = period.employees.map((e) => ({ ...e, total: calcEmployeeTotal(e) }));
  const grandTotal = employees.reduce((acc, e) => acc + e.total, 0);
  return { ...period, employees, grandTotal };
}

// ════════════════════════════════════════════════
// LISTAR PERÍODOS
// ════════════════════════════════════════════════

export async function listPeriods(): Promise<PayrollDraftPeriod[]> {
  const snap = await getDocs(query(collection(db, COL), orderBy('createdAt', 'desc')));
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PayrollDraftPeriod, 'id'>) }));
}

// ════════════════════════════════════════════════
// CREAR PERÍODO
// ════════════════════════════════════════════════

interface CreatePeriodOptions {
  name: string;
  startDate: string;
  endDate: string;
  initialEmployees?: Array<{ employeeId: string; employeeName: string; employeeCedula?: string }>;
  currentUser: AppUser | null;
}

export async function createPeriod(opts: CreatePeriodOptions): Promise<string> {
  const { name, startDate, endDate, initialEmployees = [], currentUser } = opts;
  if (!name.trim()) throw new Error('El nombre del período es obligatorio.');
  if (!startDate || !endDate) throw new Error('Las fechas de inicio y fin son obligatorias.');

  // Contador atómico para el numericId. Usamos la misma estrategia que
  // transfers / invoices: doc /config/payrollDraftCounter.
  const numericId = await runTransaction(db, async (tx) => {
    const counterRef = doc(db, 'config', 'payrollDraftCounter');
    const counterDoc = await tx.get(counterRef);
    const currentId = counterDoc.exists() ? counterDoc.data().lastNumericId || 0 : 0;
    const next = currentId + 1;
    tx.set(counterRef, { lastNumericId: next }, { merge: true });
    return next;
  });

  const employees: PayrollDraftEmployee[] = initialEmployees.map((e) => ({
    employeeId: e.employeeId,
    employeeName: e.employeeName,
    ...(e.employeeCedula ? { employeeCedula: e.employeeCedula } : {}),
    items: [],
    total: 0,
  }));

  const payload: Omit<PayrollDraftPeriod, 'id'> = {
    numericId,
    name: name.trim(),
    startDate,
    endDate,
    employees,
    grandTotal: 0,
    status: 'open',
    createdAt: Timestamp.now(),
    createdByName: currentUser ? `${currentUser.nombre} ${currentUser.apellido}` : 'desconocido',
  };

  const ref = await addDoc(collection(db, COL), payload);
  return ref.id;
}

// ════════════════════════════════════════════════
// GUARDAR PERÍODO (upsert de empleados/items)
// ════════════════════════════════════════════════

export async function savePeriod(period: PayrollDraftPeriod, currentUser: AppUser | null): Promise<void> {
  if (!period.id) throw new Error('Falta el id del período.');
  if (period.status === 'closed') {
    throw new Error('El período está cerrado. Reabrilo antes de editarlo.');
  }

  // Recalcular totales antes de guardar para evitar inconsistencias.
  const fresh = recalcPeriod(period);

  // Sanitizar items: aseguramos que amount sea número finito y que los
  // campos opcionales no se persistan como undefined (Firestore los rechaza).
  const cleanEmployees: PayrollDraftEmployee[] = fresh.employees.map((emp) => ({
    employeeId: emp.employeeId,
    employeeName: emp.employeeName,
    total: emp.total,
    ...(emp.employeeCedula ? { employeeCedula: emp.employeeCedula } : {}),
    ...(emp.note ? { note: emp.note } : {}),
    items: emp.items.map((item) => sanitizeItem(item)),
  }));

  await updateDoc(doc(db, COL, period.id), {
    name: fresh.name,
    startDate: fresh.startDate,
    endDate: fresh.endDate,
    employees: cleanEmployees,
    grandTotal: fresh.grandTotal,
    updatedAt: Timestamp.now(),
    updatedByName: currentUser ? `${currentUser.nombre} ${currentUser.apellido}` : 'desconocido',
  });
}

function sanitizeItem(item: PayrollDraftItem): PayrollDraftItem {
  const out: PayrollDraftItem = {
    id: item.id,
    label: item.label.trim(),
    amount: Number.isFinite(item.amount) ? item.amount : 0,
    isDeduction: !!item.isDeduction,
  };
  // Solo incluir quantity / unitPrice si tienen valor numérico finito.
  // Firestore no acepta `undefined` como valor.
  if (typeof item.quantity === 'number' && Number.isFinite(item.quantity)) {
    out.quantity = item.quantity;
  }
  if (typeof item.unitPrice === 'number' && Number.isFinite(item.unitPrice)) {
    out.unitPrice = item.unitPrice;
  }
  return out;
}

// ════════════════════════════════════════════════
// CERRAR / REABRIR / BORRAR
// ════════════════════════════════════════════════

export async function closePeriod(periodId: string, currentUser: AppUser | null): Promise<void> {
  await updateDoc(doc(db, COL, periodId), {
    status: 'closed',
    updatedAt: Timestamp.now(),
    updatedByName: currentUser ? `${currentUser.nombre} ${currentUser.apellido}` : 'desconocido',
  });
}

export async function reopenPeriod(periodId: string, currentUser: AppUser | null): Promise<void> {
  await updateDoc(doc(db, COL, periodId), {
    status: 'open',
    updatedAt: Timestamp.now(),
    updatedByName: currentUser ? `${currentUser.nombre} ${currentUser.apellido}` : 'desconocido',
  });
}

export async function deletePeriod(periodId: string): Promise<void> {
  // No verificamos status='open' acá; el caller (UI) puede decidir si quiere
  // permitir borrar cerrados (con confirmación reforzada). Si querés blindar
  // a nivel servicio, descomentá:
  // const ref = doc(db, COL, periodId);
  // const snap = await getDoc(ref);
  // if (snap.data()?.status === 'closed') throw new Error('No se puede borrar un período cerrado.');
  await deleteDoc(doc(db, COL, periodId));
}
