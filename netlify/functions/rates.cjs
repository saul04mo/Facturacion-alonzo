/**
 * ══════════════════════════════════════════════════════════════
 * ALONZO — Netlify Function: tasas de AHORA (BCV, EUR y Binance P2P)
 * ══════════════════════════════════════════════════════════════
 *
 * Solo lee y devuelve: no escribe nada en Firestore. El panel la llama al
 * abrirse para pintar las tarjetas, y decide él si guarda la fila del día.
 * La captura automática de todos los días la hace `rates-daily.cjs`.
 *
 * Responde SIEMPRE 200 con lo que haya conseguido. Si una fuente falla, su
 * valor viene en null y el motivo en `errors` — así el panel muestra las
 * otras en vez de quedarse en blanco.
 *
 * GET /.netlify/functions/rates
 *   { bcv, eur, bcvDate, binance, binanceAds, fetchedAt, errors }
 */
const { readRates } = require('../lib/rate-sources.cjs');

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
  // La tasa cambia como mucho una vez al día, pero el panel puede pedirla
  // varias veces: un minuto de caché en el CDN alcanza para no golpear al
  // BCV en cada F5 y sigue siendo "del día".
  'Cache-Control': 'public, max-age=60',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: HEADERS, body: '' };
  }
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'Método no permitido' }) };
  }

  return {
    statusCode: 200,
    headers: HEADERS,
    body: JSON.stringify(await readRates()),
  };
};
