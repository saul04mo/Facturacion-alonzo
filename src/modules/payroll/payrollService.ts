import {
  collection, doc, addDoc, updateDoc, deleteDoc, getDocs, query,
  orderBy, where, writeBatch,
} from 'firebase/firestore';
import { db } from '@/config/firebase';
import type { Employee, PayrollPeriod, PayrollReceipt, EmployeeIncident } from '@/types';

// ================================
// EMPLOYEES
// ================================
export async function addEmployee(data: Omit<Employee, 'id'>): Promise<string> {
  const ref = await addDoc(collection(db, 'employees'), data);
  return ref.id;
}

export async function updateEmployee(id: string, data: Partial<Employee>): Promise<void> {
  await updateDoc(doc(db, 'employees', id), data as any);
}

export async function deactivateEmployee(id: string): Promise<void> {
  await updateDoc(doc(db, 'employees', id), {
    estado: 'egresado',
    fechaEgreso: new Date().toISOString().split('T')[0],
  });
}

// ================================
// INCIDENTS
// ================================
export async function addIncident(data: Omit<EmployeeIncident, 'id'>): Promise<string> {
  const ref = await addDoc(collection(db, 'employee_incidents'), data);
  return ref.id;
}

export async function deleteIncident(id: string): Promise<void> {
  await deleteDoc(doc(db, 'employee_incidents', id));
}

export async function getIncidentsForPeriod(
  fechaInicio: string,
  fechaFin: string
): Promise<EmployeeIncident[]> {
  const q = query(
    collection(db, 'employee_incidents'),
    where('fecha', '>=', fechaInicio),
    where('fecha', '<=', fechaFin),
    orderBy('fecha', 'desc')
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as EmployeeIncident);
}

// ================================
// PAYROLL PERIODS
// ================================
export async function createPeriod(data: Omit<PayrollPeriod, 'id'>): Promise<string> {
  const ref = await addDoc(collection(db, 'payroll_periods'), data);
  return ref.id;
}

export async function updatePeriod(id: string, data: Partial<PayrollPeriod>): Promise<void> {
  await updateDoc(doc(db, 'payroll_periods', id), data as any);
}

export async function getPayrollPeriods(): Promise<PayrollPeriod[]> {
  const q = query(collection(db, 'payroll_periods'), orderBy('fecha', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as PayrollPeriod);
}

// ================================
// RECEIPTS
// ================================
export async function saveReceipts(
  periodId: string,
  receipts: Omit<PayrollReceipt, 'id'>[],
  periodTotals: { totalAsignaciones: number; totalDeducciones: number; totalNeto: number }
): Promise<void> {
  const batch = writeBatch(db);

  // Delete existing receipts for this period first
  const existingSnap = await getDocs(
    query(collection(db, 'payroll_receipts'), where('periodId', '==', periodId))
  );
  existingSnap.docs.forEach((d) => batch.delete(d.ref));

  // Add new receipts
  receipts.forEach((receipt) => {
    const ref = doc(collection(db, 'payroll_receipts'));
    batch.set(ref, receipt);
  });

  // Update period status and totals
  batch.update(doc(db, 'payroll_periods', periodId), {
    estado: 'calculado',
    ...periodTotals,
  });

  await batch.commit();
}

export async function getReceiptsForPeriod(periodId: string): Promise<PayrollReceipt[]> {
  const q = query(
    collection(db, 'payroll_receipts'),
    where('periodId', '==', periodId),
    orderBy('employeeName')
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as PayrollReceipt);
}

export async function getReceiptsForEmployee(employeeId: string): Promise<PayrollReceipt[]> {
  const q = query(
    collection(db, 'payroll_receipts'),
    where('employeeId', '==', employeeId),
    orderBy('fecha', 'desc')
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as PayrollReceipt);
}

export async function markPeriodPaid(periodId: string): Promise<void> {
  const batch = writeBatch(db);
  batch.update(doc(db, 'payroll_periods', periodId), { estado: 'pagado' });

  const receiptsSnap = await getDocs(
    query(collection(db, 'payroll_receipts'), where('periodId', '==', periodId))
  );
  receiptsSnap.docs.forEach((d) => batch.update(d.ref, { estado: 'pagado' }));

  await batch.commit();
}
