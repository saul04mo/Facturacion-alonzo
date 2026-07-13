/**
 * ══════════════════════════════════════════════════════════════
 * ALONZO — Netlify Function: analíticas de la web (Google Analytics 4)
 * ══════════════════════════════════════════════════════════════
 *
 * Corre en el SERVIDOR. Consulta la Google Analytics Data API con la cuenta
 * de servicio (la misma de Firebase) y devuelve métricas listas para pintar
 * en el panel del POS, así no hay que entrar a analytics.google.com.
 *
 * Modos (query params):
 *   ?live=1                       -> SOLO datos en tiempo real (rápido, para polling)
 *   ?days=7|28|90                 -> reporte completo de un rango fijo
 *   ?start=YYYY-MM-DD&end=YYYY-MM-DD -> reporte completo de un rango personalizado
 *
 * Credenciales: variable de entorno FIREBASE_SERVICE_ACCOUNT (JSON completo
 * de la llave de servicio). En `netlify dev` cae al serviceAccountKey.json
 * local como respaldo (igual que register-client).
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

// Convierte las filas de una respuesta en objetos simples
function rows(resp) {
  return (resp.rows || []).map((r) => ({
    dims: (r.dimensionValues || []).map((d) => d.value),
    mets: (r.metricValues || []).map((m) => Number(m.value || 0)),
  }));
}

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');

// ── Bloque de tiempo real (últimos 30 min). Se usa en ambos modos. ──
async function getRealtime(client, property) {
  const [totalRt, pagesRt, countriesRt] = await Promise.all([
    client.runRealtimeReport({ property, metrics: [{ name: 'activeUsers' }] }),
    client.runRealtimeReport({
      property,
      dimensions: [{ name: 'unifiedScreenName' }],
      metrics: [{ name: 'activeUsers' }],
      orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
      limit: 8,
    }),
    client.runRealtimeReport({
      property,
      dimensions: [{ name: 'country' }],
      metrics: [{ name: 'activeUsers' }],
      orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
      limit: 6,
    }),
  ]);
  return {
    activeNow: rows(totalRt[0])[0]?.mets[0] || 0,
    livePages: rows(pagesRt[0]).map((r) => ({ title: r.dims[0], users: r.mets[0] })),
    liveCountries: rows(countriesRt[0]).map((r) => ({ country: r.dims[0], users: r.mets[0] })),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: HEADERS, body: '' };
  }
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'Método no permitido' }) };
  }

  const qp = event.queryStringParameters || {};
  const property = `properties/${PROPERTY_ID}`;

  try {
    const client = getClient();

    // ── Modo EN VIVO: solo tiempo real (rápido, para refrescar cada pocos seg) ──
    if (qp.live === '1') {
      const rt = await getRealtime(client, property);
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify(rt) };
    }

    // ── Rango: personalizado (start/end) o preset (days) ──
    let startDate;
    let endDate = 'today';
    let range; // etiqueta para el front
    if (isDate(qp.start) && isDate(qp.end)) {
      startDate = qp.start;
      endDate = qp.end;
      range = 'custom';
    } else {
      const daysParam = Number(qp.days);
      const days = [7, 28, 90].includes(daysParam) ? daysParam : 28;
      startDate = `${days}daysAgo`;
      range = days;
    }
    const dateRanges = [{ startDate, endDate }];

    const [summary, timeseries, topPages, countries, devices, sources, rt] = await Promise.all([
      client.runReport({
        property,
        dateRanges,
        metrics: [
          { name: 'totalUsers' },
          { name: 'newUsers' },
          { name: 'sessions' },
          { name: 'screenPageViews' },
          { name: 'averageSessionDuration' },
        ],
      }),
      client.runReport({
        property, dateRanges,
        dimensions: [{ name: 'date' }],
        metrics: [{ name: 'totalUsers' }],
        orderBys: [{ dimension: { dimensionName: 'date' } }],
      }),
      client.runReport({
        property, dateRanges,
        dimensions: [{ name: 'pageTitle' }],
        metrics: [{ name: 'screenPageViews' }],
        orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
        limit: 10,
      }),
      client.runReport({
        property, dateRanges,
        dimensions: [{ name: 'country' }],
        metrics: [{ name: 'totalUsers' }],
        orderBys: [{ metric: { metricName: 'totalUsers' }, desc: true }],
        limit: 8,
      }),
      client.runReport({
        property, dateRanges,
        dimensions: [{ name: 'deviceCategory' }],
        metrics: [{ name: 'totalUsers' }],
        orderBys: [{ metric: { metricName: 'totalUsers' }, desc: true }],
      }),
      client.runReport({
        property, dateRanges,
        dimensions: [{ name: 'sessionDefaultChannelGroup' }],
        metrics: [{ name: 'sessions' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 8,
      }),
      getRealtime(client, property),
    ]);

    const s = rows(summary[0])[0]?.mets || [0, 0, 0, 0, 0];

    const payload = {
      range,
      start: startDate,
      end: endDate,
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
      ...rt,
    };

    return { statusCode: 200, headers: HEADERS, body: JSON.stringify(payload) };
  } catch (err) {
    console.error('ga-analytics error:', err);
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
