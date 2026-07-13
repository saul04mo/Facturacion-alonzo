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

const iso = (d) => d.toISOString().slice(0, 10);
const parseIso = (s) => new Date(`${s}T00:00:00Z`);
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);

/**
 * Período inmediatamente anterior, del mismo largo, para comparar contra él.
 * Un rango de 7 días que va del 10 al 16 se compara con el 3 al 9.
 */
function previousPeriod(startIso, endIso) {
  const start = parseIso(startIso);
  const end = parseIso(endIso);
  const lenDays = Math.round((end - start) / 86400000) + 1;
  return {
    startDate: iso(addDays(start, -lenDays)),
    endDate: iso(addDays(start, -1)),
  };
}

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
    // Siempre se resuelve a fechas YYYY-MM-DD explícitas (no "7daysAgo") porque
    // el período anterior con el que comparamos se calcula restando días, y para
    // eso hace falta saber la fecha real de inicio.
    let startDate;
    let endDate;
    let range; // etiqueta para el front
    if (isDate(qp.start) && isDate(qp.end)) {
      startDate = qp.start;
      endDate = qp.end;
      range = 'custom';
    } else {
      const daysParam = Number(qp.days);
      const days = [7, 28, 90].includes(daysParam) ? daysParam : 28;
      const today = new Date();
      endDate = iso(today);
      startDate = iso(addDays(today, -(days - 1)));
      range = days;
    }
    const dateRanges = [{ startDate, endDate }];
    const prev = previousPeriod(startDate, endDate);

    const SUMMARY_METRICS = [
      { name: 'totalUsers' },
      { name: 'newUsers' },
      { name: 'sessions' },
      { name: 'screenPageViews' },
      { name: 'averageSessionDuration' },
    ];

    const [summary, prevSummary, timeseries, hourly, topPages, countries, devices, sources, rt] = await Promise.all([
      client.runReport({ property, dateRanges, metrics: SUMMARY_METRICS }),
      // Mismo bloque de métricas sobre el período anterior, para los deltas.
      client.runReport({
        property,
        dateRanges: [{ startDate: prev.startDate, endDate: prev.endDate }],
        metrics: SUMMARY_METRICS,
      }),
      // Serie diaria con TODAS las métricas, no solo visitantes: así el panel
      // puede graficar el rendimiento por día de cada una sin pedir más datos.
      client.runReport({
        property, dateRanges,
        dimensions: [{ name: 'date' }],
        metrics: SUMMARY_METRICS,
        orderBys: [{ dimension: { dimensionName: 'date' } }],
        limit: 400,
      }),
      // Distribución por hora del día (0-23): a qué hora entra la gente.
      client.runReport({
        property, dateRanges,
        dimensions: [{ name: 'hour' }],
        metrics: [{ name: 'sessions' }],
        orderBys: [{ dimension: { dimensionName: 'hour' } }],
        limit: 24,
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

    const toSummary = (m = []) => ({
      totalUsers: m[0] || 0,
      newUsers: m[1] || 0,
      sessions: m[2] || 0,
      pageViews: m[3] || 0,
      avgSessionSec: Math.round(m[4] || 0),
    });

    const payload = {
      range,
      start: startDate,
      end: endDate,
      summary: toSummary(rows(summary[0])[0]?.mets),
      previous: {
        ...toSummary(rows(prevSummary[0])[0]?.mets),
        start: prev.startDate,
        end: prev.endDate,
      },
      timeseries: rows(timeseries[0]).map((r) => ({
        date: r.dims[0],
        users: r.mets[0],
        newUsers: r.mets[1],
        sessions: r.mets[2],
        pageViews: r.mets[3],
        avgSessionSec: Math.round(r.mets[4] || 0),
      })),
      hourly: rows(hourly[0]).map((r) => ({ hour: Number(r.dims[0]), sessions: r.mets[0] })),
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

    // El orden importa: RESOURCE_EXHAUSTED va primero porque es el fallo más
    // común en uso normal (GA4 limita los tokens por propiedad y por hora) y
    // no requiere tocar nada — solo esperar. Antes caía en el mensaje genérico
    // y mandaba a revisar permisos de Google Cloud que estaban perfectos.
    let hint = 'Error consultando Google Analytics.';
    let statusCode = 500;
    if (/RESOURCE_EXHAUSTED|quota/i.test(msg)) {
      hint = 'Google Analytics agotó la cuota de consultas de esta hora. '
           + 'No hay nada que arreglar: vuelve a intentar en menos de una hora.';
      statusCode = 429;
    } else if (/has not been used|disabled|SERVICE_DISABLED/i.test(msg)) {
      hint = 'Falta habilitar "Google Analytics Data API" en Google Cloud.';
    } else if (/permission|PERMISSION_DENIED|403/i.test(msg)) {
      hint = 'La cuenta de servicio no tiene acceso de Lector en la propiedad GA4.';
    }
    return { statusCode, headers: HEADERS, body: JSON.stringify({ error: hint, detail: msg }) };
  }
};
