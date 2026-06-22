// Servicio que consume la función serverless /.netlify/functions/ga-analytics
// (que a su vez consulta la Google Analytics Data API con la cuenta de servicio).

const ENDPOINT = '/.netlify/functions/ga-analytics';

export interface WebAnalytics {
  range: number;
  summary: {
    totalUsers: number;
    newUsers: number;
    sessions: number;
    pageViews: number;
    avgSessionSec: number;
  };
  timeseries: { date: string; users: number }[];
  topPages: { title: string; views: number }[];
  countries: { country: string; users: number }[];
  devices: { device: string; users: number }[];
  sources: { channel: string; sessions: number }[];
  activeNow: number;
}

export async function fetchWebAnalytics(days: 7 | 28 | 90 = 28): Promise<WebAnalytics> {
  const res = await fetch(`${ENDPOINT}?days=${days}`);
  if (!res.ok) {
    let msg = 'No se pudieron cargar las analíticas de la web.';
    try {
      const e = await res.json();
      if (e?.error) msg = e.error;
    } catch { /* respuesta no-JSON */ }
    throw new Error(msg);
  }
  return res.json();
}
