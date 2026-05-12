/**
 * Servicio para el panel de gastos de publicidad.
 *
 * Dos fuentes de datos combinadas:
 *
 * 1. Gastos de publicidad (escritos a mano por el usuario, día por día)
 *    Colección Firestore: adSpend
 *    Doc ID: 'YYYY-MM-DD' (un doc por día)
 *    Campos: { date, spendMen, spendWomen, updatedAt, updatedByName }
 *
 * 2. Ventas por género (calculadas desde las facturas finalizadas)
 *    Se recorren los invoices del mes, se filtran por status 'Finalizado',
 *    y por cada item se busca el género del producto en el catálogo y
 *    se suma priceAtSale × quantity al género correspondiente.
 *
 *    NOTA IMPORTANTE: el monto que se suma es el BRUTO (precio × cantidad).
 *    NO se aplican descuentos de item, descuentos globales de invoice
 *    (totalDiscount), promociones, cupones, ni delivery. El reporte mide
 *    volumen de venta a precio de lista — no utilidad neta. Si hace
 *    falta una vista neta, hay que hacer otro reporte distinto.
 */

import {
  collection,
  doc,
  getDocs,
  query,
  where,
  setDoc,
  Timestamp,
} from 'firebase/firestore';
import { db } from '@/config/firebase';
import { toDate } from '@/utils/dateUtils';
import type { AppUser, Invoice, Product } from '@/types';

// ════════════════════════════════════════════════
// TIPOS
// ════════════════════════════════════════════════

export interface DayAdSpend {
  /** ID del documento = YYYY-MM-DD */
  date: string;
  spendMen: number;
  spendWomen: number;
  updatedAt?: Timestamp;
  updatedByName?: string;
}

export interface DaySales {
  /** Ingreso bruto por items de género 'Hombre' (con descuentos de item aplicados). */
  salesMen: number;
  salesWomen: number;
}

// ════════════════════════════════════════════════
// HELPERS DE FECHA
// ════════════════════════════════════════════════

/** Convierte un Date a YYYY-MM-DD usando fecha local. */
function dateToYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Devuelve un array con todas las fechas YYYY-MM-DD del mes. */
export function daysOfMonth(year: number, month: number): string[] {
  // month es 1-12
  const lastDay = new Date(year, month, 0).getDate();
  const days: string[] = [];
  const mm = String(month).padStart(2, '0');
  for (let d = 1; d <= lastDay; d++) {
    days.push(`${year}-${mm}-${String(d).padStart(2, '0')}`);
  }
  return days;
}

// ════════════════════════════════════════════════
// LEER GASTOS DEL MES
// ════════════════════════════════════════════════

/** Devuelve un Map<YYYY-MM-DD, DayAdSpend> con los gastos cargados del mes. */
export async function getMonthAdSpend(year: number, month: number): Promise<Map<string, DayAdSpend>> {
  const mm = String(month).padStart(2, '0');
  const lastDay = new Date(year, month, 0).getDate();
  const start = `${year}-${mm}-01`;
  const end = `${year}-${mm}-${String(lastDay).padStart(2, '0')}`;

  const snap = await getDocs(
    query(
      collection(db, 'adSpend'),
      where('date', '>=', start),
      where('date', '<=', end),
    ),
  );

  const map = new Map<string, DayAdSpend>();
  snap.forEach((d) => {
    const data = d.data() as DayAdSpend;
    map.set(data.date, data);
  });
  return map;
}

// ════════════════════════════════════════════════
// GUARDAR GASTO DE UN DÍA (upsert)
// ════════════════════════════════════════════════

export async function setDayAdSpend(
  date: string,
  spendMen: number,
  spendWomen: number,
  currentUser: AppUser | null,
): Promise<void> {
  if (spendMen < 0 || spendWomen < 0) {
    throw new Error('Los gastos no pueden ser negativos.');
  }
  // Sanitizar NaN
  const cleanMen = Number.isFinite(spendMen) ? spendMen : 0;
  const cleanWomen = Number.isFinite(spendWomen) ? spendWomen : 0;

  await setDoc(doc(db, 'adSpend', date), {
    date,
    spendMen: cleanMen,
    spendWomen: cleanWomen,
    updatedAt: Timestamp.now(),
    updatedByName: currentUser ? `${currentUser.nombre} ${currentUser.apellido}` : 'desconocido',
  });
}

// ════════════════════════════════════════════════
// CALCULAR VENTAS POR GÉNERO Y DÍA
// ════════════════════════════════════════════════

/**
 * Dado un set de facturas y el catálogo de productos, devuelve un mapa
 * { 'YYYY-MM-DD' → { salesMen, salesWomen } }.
 *
 * Solo cuenta invoices con status 'Finalizado'. Items con productos
 * eliminados del catálogo (lookup fallido) se descartan silenciosamente.
 */
export function computeDailySalesByGender(
  invoices: Invoice[],
  products: Product[],
): Map<string, DaySales> {
  // Lookup rápido productId → gender
  const genderByProduct = new Map<string, 'Hombre' | 'Mujer'>();
  for (const p of products) {
    if (p.gender === 'Hombre' || p.gender === 'Mujer') {
      genderByProduct.set(p.id, p.gender);
    }
  }

  const out = new Map<string, DaySales>();
  for (const inv of invoices) {
    if (inv.status !== 'Finalizado') continue;
    const d = toDate(inv.date);
    if (!d) continue;
    const ymd = dateToYMD(d);

    let bucket = out.get(ymd);
    if (!bucket) {
      bucket = { salesMen: 0, salesWomen: 0 };
      out.set(ymd, bucket);
    }

    for (const item of inv.items || []) {
      const gender = genderByProduct.get(item.productId);
      if (!gender) continue; // producto eliminado o sin género — se descarta
      // Monto BRUTO: precio × cantidad. NO aplicamos descuentos a nivel
      // item ni a nivel invoice porque el reporte de publicidad mide el
      // volumen de venta a precio de lista, no la utilidad neta.
      const lineGross = (item.priceAtSale ?? 0) * (item.quantity ?? 0);
      if (gender === 'Hombre') bucket.salesMen += lineGross;
      else bucket.salesWomen += lineGross;
    }
  }
  return out;
}

// ════════════════════════════════════════════════
// FORMATO HUMANO DE FECHA (es-VE)
// ════════════════════════════════════════════════

const WEEKDAY_ES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

/** Convierte 'YYYY-MM-DD' a { weekday: 'Lunes', short: '1/6/2026' }. */
export function describeDate(ymd: string): { weekday: string; short: string } {
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return {
    weekday: WEEKDAY_ES[date.getDay()],
    short: `${d}/${m}/${y}`,
  };
}
