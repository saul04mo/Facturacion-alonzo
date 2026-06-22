/**
 * ══════════════════════════════════════════════════════════════
 * ALONZO — Netlify Function: analíticas de la web (Google Analytics 4)
 * ══════════════════════════════════════════════════════════════
 *
 * Corre en el SERVIDOR. Consulta la Google Analytics Data API con la cuenta
 * de servicio (la misma de Firebase) y devuelve métricas listas para pintar
 * en el panel del POS, así no hay que entrar a analytics.google.com.
 *
 * Credenciales: variable de entorno FIREBASE_SERVICE_ACCOUNT (JSON completo
 * de la llave de servicio). En `netlify dev` cae al serviceAccountKey.json
 * local como respaldo (igual que register-client).
 *
 * Requisitos en Google (una sola vez):
 *   1. Habilitar "Google Analytics Data API" en el proyecto de Google Cloud.
 *   2. Dar rol "Lector" a la cuenta de servicio en GA4 (Gestión de acceso).
 */
const { BetaAnalyticsDataClient } = require('@google-analytics/data');

// ID numérico de la propiedad GA4 (NO es el G-XXXX). Configurable por env.
const PROPERTY_ID = process.env.GA4_PROPERTY_ID || '501373411';

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
};

// ── Cliente singleton (reutiliza credenciales entre invocaciones calientes) ──
let _client;
function getClient() {
  if (_client) return _client;

  let creds;
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    creds = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } else {
    const path = require('path');
    const keyPath = path.join(__dirname, '..', '..', 'serviceAccountKey.json');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    creds = require(keyPath);
  }

  _client = new BetaAnalyticsDataClient({
    credentials: {
      client_email: creds.client_email,
      private_key: creds.private_key,
    },
    projectId: creds.project_id,
  });
  return _client;
}

// Convierte las filas de una respuesta runReport en objetos simples
function rows(resp) {
  return (resp.rows || []).map((r) => ({
    dims: (r.dimensionValues || []).map((d) => d.value),
    mets: (r.metricValues || []).map((m) => Number(m.value || 0)),
  }));
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: HEADERS, body: '' };
  }
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'Método no permitido' }) };
  }

  // Rango de días (7 / 28 / 90). Por defecto 28.
  const daysParam = Number(event.queryStringParameters?.days);
  const days = [7, 28, 90].includes(daysParam) ? daysParam : 28;
  const startDate = `${days}daysAgo`;
  const property = `properties/${PROPERTY_ID}`;

  try {
    const client = getClient();

    const [summary, timeseries, topPages, countries, devices, sources, realtime] = await Promise.all([
      // 1. Resumen del período
      client.runReport({
        property,
        dateRanges: [{ startDate, endDate: 'today' }],
        metrics: [
          { name: 'totalUsers' },
          { name: 'newUsers' },
          { name: 'sessions' },
          { name: 'screenPageViews' },
          { name: 'averageSessionDuration' },
        ],
      }),
      // 2. Usuarios por día (para el gráfico de tendencia)
      client.runReport({
        property,
        dateRanges: [{ startDate, endDate: 'today' }],
        dimensions: [{ name: 'date' }],
        metrics: [{ name: 'totalUsers' }],
        orderBys: [{ dimension: { dimensionName: 'date' } }],
      }),
      // 3. Páginas / productos más vistos (por título de página)
      client.runReport({
        property,
        dateRanges: [{ startDate, endDate: 'today' }],
        dimensions: [{ name: 'pageTitle' }],
        metrics: [{ name: 'screenPageViews' }],
        orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
        limit: 10,
      }),
      // 4. Países
      client.runReport({
        property,
        dateRanges: [{ startDate, endDate: 'today' }],
        dimensions: [{ name: 'country' }],
        metrics: [{ name: 'totalUsers' }],
        orderBys: [{ metric: { metricName: 'totalUsers' }, desc: true }],
        limit: 8,
      }),
      // 5. Dispositivos
      client.runReport({
        property,
        dateRanges: [{ startDate, endDate: 'today' }],
        dimensions: [{ name: 'deviceCategory' }],
        metrics: [{ name: 'totalUsers' }],
        orderBys: [{ metric: { metricName: 'totalUsers' }, desc: true }],
      }),
      // 6. De dónde llegan (canal)
      client.runReport({
        property,
        dateRanges: [{ startDate, endDate: 'today' }],
        dimensions: [{ name: 'sessionDefaultChannelGroup' }],
        metrics: [{ name: 'sessions' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 8,
      }),
      // 7. Tiempo real (usuarios activos ahora)
      client.runRealtimeReport({
        property,
        metrics: [{ name: 'activeUsers' }],
      }),
    ]);

    const s = rows(summary[0])[0]?.mets || [0, 0, 0, 0, 0];

    const payload = {
      range: days,
      summary: {
        totalUsers: s[0],
        newUsers: s[1],
        sessions: s[2],
        pageViews: s[3],
        avgSessionSec: Math.round(s[4]),
      },
      timeseries: rows(timeseries[0]).map((r) => ({ date: r.dims[0], users: r.mets[0] })),
      topPages: rows(topPages[0]).map((r) => ({ title: r.dims[0], views: r.mets[0] })),
      countries: rows(countries[0]).map((r) => ({ country: r.dims[0], users: r.mets[0] })),
      devices: rows(devices[0]).map((r) => ({ device: r.dims[0], users: r.mets[0] })),
      sources: rows(sources[0]).map((r) => ({ channel: r.dims[0], sessions: r.mets[0] })),
      activeNow: rows(realtime[0])[0]?.mets[0] || 0,
    };

    return { statusCode: 200, headers: HEADERS, body: JSON.stringify(payload) };
  } catch (err) {
    console.error('ga-analytics error:', err);
    // Mensajes útiles según el fallo más común
    const msg = String(err?.message || err);
    let hint = 'Error consultando Google Analytics.';
    if (/has not been used|disabled|SERVICE_DISABLED/i.test(msg)) {
      hint = 'Falta habilitar "Google Analytics Data API" en Google Cloud.';
    } else if (/permission|PERMISSION_DENIED|403/i.test(msg)) {
      hint = 'La cuenta de servicio no tiene acceso de Lector en la propiedad GA4.';
    }
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: hint, detail: msg }) };
  }
};
