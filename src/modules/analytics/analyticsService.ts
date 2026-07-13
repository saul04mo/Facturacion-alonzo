// Servicio que consume la función serverless /.netlify/functions/ga-analytics
// (que a su vez consulta la Google Analytics Data API con la cuenta de servicio).

const ENDPOINT = '/.netlify/functions/ga-analytics';

export interface LivePage { title: string; users: number; }
export interface LiveCountry { country: string; users: number; }

export interface RealtimeData {
  activeNow: number;
  livePages: LivePage[];
  liveCountries: LiveCountry[];
}

export interface Summary {
  totalUsers: number;
  newUsers: number;
  sessions: number;
  pageViews: number;
  avgSessionSec: number;
}

/** Un día de la serie: todas las métricas, no solo visitantes. */
export interface DayPoint extends Summary {
  date: string;
  users: number;
}

export interface WebAnalytics extends RealtimeData {
  range: number | 'custom';
  start: string;
  end: string;
  summary: Summary;
  /** Mismo bloque sobre el período anterior de igual largo (para los deltas). */
  previous: Summary & { start: string; end: string };
  timeseries: DayPoint[];
  /** Sesiones por hora del día (0-23). */
  hourly: { hour: number; sessions: number }[];
  topPages: { title: string; views: number }[];
  countries: { country: string; users: number }[];
  devices: { device: string; users: number }[];
  sources: { channel: string; sessions: number }[];
}

// Rango: un preset de días (7/28/90) o un rango personalizado { start, end }.
export type Range = 7 | 28 | 90 | { start: string; end: string };

async function get(qs: string): Promise<any> {
  const res = await fetch(`${ENDPOINT}?${qs}`);

  if (!res.ok) {
    let msg = 'No se pudieron cargar las analíticas de la web.';
    try {
      const e = await res.json();
      if (e?.error) msg = e.error;
    } catch { /* respuesta no-JSON */ }
    throw new Error(msg);
  }

  // Si la función serverless no está corriendo, el catch-all del SPA devuelve
  // index.html con status 200. Sin este chequeo, el res.json() de abajo falla
  // con "Unexpected token '<'" y parece un problema de Google Analytics cuando
  // en realidad la función ni siquiera se ejecutó (típico de `npm run dev`,
  // que levanta Vite sin las Netlify Functions).
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    throw new Error(
      'La función de analíticas no está corriendo. Levanta el proyecto con ' +
      '`npm run dev:netlify` (no `npm run dev`), que sirve las Netlify Functions.',
    );
  }

  return res.json();
}

export function fetchWebAnalytics(range: Range = 28): Promise<WebAnalytics> {
  const qs = typeof range === 'number'
    ? `days=${range}`
    : `start=${range.start}&end=${range.end}`;
  return get(qs);
}

// Solo tiempo real (rápido, para refrescar cada pocos segundos)
export function fetchLive(): Promise<RealtimeData> {
  return get('live=1');
}
