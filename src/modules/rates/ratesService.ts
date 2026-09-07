/**
 * Historial de tasas: BCV (dólar y euro) y P2P de Binance.
 *
 * OJO: este módulo NO toca `config/exchangeRate`. Esa es la tasa global con
 * la que se factura y se sigue cambiando desde Ventas o Configuración. Acá
 * solo se guarda una foto diaria de las tres tasas para poder compararlas.
 */
import {
  collection, doc, getDoc, getDocs, setDoc, query, where, orderBy, limit, Timestamp,
} from 'firebase/firestore';
import { db } from '@/config/firebase';
import type { AppUser, RateSnapshot } from '@/types';

export const RATE_HISTORY = 'rateHistory';

const ENDPOINT = '/.netlify/functions/rates';

/** Lo que devuelve la función serverless: tasas de AHORA, sin guardar. */
export interface LiveRates {
  bcv: number | null;
  eur: number | null;
  /** "Fecha Valor" que publica el BCV — puede ser el día siguiente. */
  bcvDate: string | null;
  binance: number | null;
  /** Los avisos del P2P que se usaron para la mediana, de menor a mayor. */
  binanceAds: number[];
  fetchedAt: string;
  /** Fuentes que fallaron. Vacío = las tres salieron bien. */
  errors: string[];
}

export async function fetchLiveRates(): Promise<LiveRates> {
  const res = await fetch(ENDPOINT);

  if (!res.ok) {
    let msg = 'No se pudieron consultar las tasas.';
    try {
      const e = await res.json();
      if (e?.error) msg = e.error;
    } catch { /* respuesta no-JSON */ }
    throw new Error(msg);
  }

  // Sin las Netlify Functions corriendo, el catch-all del SPA devuelve
  // index.html con status 200 y el res.json() falla con "Unexpected token '<'".
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    throw new Error(
      'La función de tasas no respondió. En local hay que levantar el proyecto con '
      + '`npm run dev:netlify` (no `npm run dev`), que sirve las Netlify Functions; '
      + 'en producción, hace falta un deploy que incluya netlify/functions/rates.cjs.',
    );
  }

  return res.json();
}

/** Las últimas N filas, de la más nueva a la más vieja. */
export async function fetchRateHistory(days = 60): Promise<RateSnapshot[]> {
  // orderBy sobre un solo campo, sin where: no hace falta índice compuesto.
  const snap = await getDocs(query(
    collection(db, RATE_HISTORY),
    orderBy('dateKey', 'desc'),
    limit(days),
  ));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as RateSnapshot);
}

/**
 * Las filas entre dos fechas, ambas incluidas, de la más nueva a la más vieja.
 *
 * El rango y el orden son sobre el MISMO campo (dateKey), así que Firestore lo
 * resuelve con el índice de un solo campo que ya existe — no hace falta crear
 * un índice compuesto.
 */
export async function fetchRateHistoryRange(from: string, to: string): Promise<RateSnapshot[]> {
  const snap = await getDocs(query(
    collection(db, RATE_HISTORY),
    where('dateKey', '>=', from),
    where('dateKey', '<=', to),
    orderBy('dateKey', 'desc'),
  ));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as RateSnapshot);
}

export async function getRateSnapshot(dateKey: string): Promise<RateSnapshot | null> {
  const snap = await getDoc(doc(db, RATE_HISTORY, dateKey));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as RateSnapshot;
}

export async function saveRateSnapshot(opts: {
  dateKey: string;
  rates: Pick<LiveRates, 'bcv' | 'eur' | 'binance'>;
  source: 'auto' | 'manual';
  user?: AppUser | null;
}): Promise<RateSnapshot> {
  const { dateKey, rates, source, user } = opts;

  const data = {
    dateKey,
    bcv: rates.bcv,
    eur: rates.eur,
    binance: rates.binance,
    source,
    capturedAt: Timestamp.now(),
    ...(user ? {
      capturedByUid: user.uid,
      capturedByName: `${user.nombre} ${user.apellido}`.trim(),
    } : {}),
  };

  await setDoc(doc(db, RATE_HISTORY, dateKey), data);
  return { id: dateKey, ...data } as RateSnapshot;
}

/**
 * Cuánto está por encima `quote` respecto de `base`, en porcentaje.
 * Con BCV 795 y Binance 934 da 17,48 % — la brecha del paralelo.
 */
export function gapPercent(base: number | null, quote: number | null): number | null {
  if (!base || !quote) return null;
  return ((quote / base) - 1) * 100;
}

/** Cómo se movió una tasa dentro del período filtrado. */
export interface SeriesStats {
  /** Valor del día más viejo del rango. */
  first: number | null;
  /** Valor del día más nuevo del rango. */
  last: number | null;
  /** last − first, en bolívares. */
  change: number | null;
  /** La misma variación en porcentaje. */
  changePct: number | null;
  min: number | null;
  max: number | null;
  avg: number | null;
  /** Cuántos días del rango tienen dato de esta tasa. */
  count: number;
}

export interface PeriodStats {
  /** Filas con al menos una tasa cargada. */
  days: number;
  firstDate: string | null;
  lastDate: string | null;
  bcv: SeriesStats;
  eur: SeriesStats;
  binance: SeriesStats;
  /** Brecha Binance/BCV promedio del período, en %. */
  avgGapBcv: number | null;
  /** Brecha Binance/EUR promedio del período, en %. */
  avgGapEur: number | null;
}

function seriesStats(values: (number | null)[]): SeriesStats {
  // Llegan de la más vieja a la más nueva.
  const nums = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (!nums.length) {
    return { first: null, last: null, change: null, changePct: null, min: null, max: null, avg: null, count: 0 };
  }

  const first = nums[0];
  const last = nums[nums.length - 1];
  return {
    first,
    last,
    change: last - first,
    changePct: first ? ((last / first) - 1) * 100 : null,
    min: Math.min(...nums),
    max: Math.max(...nums),
    avg: nums.reduce((a, b) => a + b, 0) / nums.length,
    count: nums.length,
  };
}

function average(values: (number | null)[]): number | null {
  const nums = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/**
 * Resume el período que se está viendo: cuánto se movió cada tasa entre la
 * primera y la última fila, sus mínimos/máximos/promedios y la brecha media.
 *
 * `rows` viene como lo devuelve Firestore, de la más nueva a la más vieja.
 */
export function computePeriodStats(rows: RateSnapshot[]): PeriodStats {
  const asc = [...rows].reverse();

  return {
    days: asc.length,
    firstDate: asc.length ? asc[0].dateKey : null,
    lastDate: asc.length ? asc[asc.length - 1].dateKey : null,
    bcv: seriesStats(asc.map((r) => r.bcv)),
    eur: seriesStats(asc.map((r) => r.eur)),
    binance: seriesStats(asc.map((r) => r.binance)),
    avgGapBcv: average(asc.map((r) => gapPercent(r.bcv, r.binance))),
    avgGapEur: average(asc.map((r) => gapPercent(r.eur, r.binance))),
  };
}
