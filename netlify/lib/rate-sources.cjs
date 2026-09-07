/**
 * ══════════════════════════════════════════════════════════════
 * ALONZO — Lectura de las tasas: BCV (dólar y euro) y Binance P2P
 * ══════════════════════════════════════════════════════════════
 *
 * Vive fuera de netlify/functions a propósito: todo archivo suelto dentro de
 * esa carpeta es una función, y esto es código compartido. Lo usan
 * `rates.cjs` (el panel lo pide al abrirse) y `rates-daily.cjs` (la tarea
 * programada), así los dos capturan exactamente lo mismo.
 *
 * Las dos fuentes se leen del SERVIDOR porque ninguna sirve desde el navegador:
 *   - Binance P2P no manda cabeceras CORS.
 *   - bcv.org.ve no envía la cadena intermedia de su certificado, así que Node
 *     corta con UNABLE_TO_VERIFY_LEAF_SIGNATURE. Se lee con TLS relajado: es
 *     una página pública y no se le manda ningún dato.
 */
const https = require('https');

const BCV_URL = 'https://www.bcv.org.ve/';
const BINANCE_URL = 'https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search';

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** YYYY-MM-DD en horario Venezuela — mismo criterio que todayVE() del front. */
function todayVE() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Caracas',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** GET de texto plano con el certificado del BCV aceptado a mano. */
function getInsecure(url, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      rejectUnauthorized: false,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AlonzoPOS/1.0)' },
    }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve(body));
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

/**
 * Saca un monto del recuadro de una moneda en la home del BCV.
 *
 * El HTML es <div id="dolar"> ... <strong class="strong-tb">794,99170000</strong>.
 * Se busca dentro de una ventana corta después del id para no agarrar el
 * <strong> de otra moneda si el BCV reordena los recuadros.
 */
function parseBcvAmount(html, id) {
  const start = html.indexOf(`id="${id}"`);
  if (start < 0) return null;
  const match = html.slice(start, start + 900).match(/<strong[^>]*>\s*([\d.]*\d,\d+)\s*<\/strong>/);
  if (!match) return null;
  const value = parseFloat(match[1].replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(value) && value > 0 ? value : null;
}

async function fetchBcv() {
  const html = await getInsecure(BCV_URL);
  const dateMatch = html.match(/content="(\d{4}-\d{2}-\d{2})T[^"]*"/);
  return {
    usd: parseBcvAmount(html, 'dolar'),
    eur: parseBcvAmount(html, 'euro'),
    // "Fecha Valor" que publica el BCV: puede ser el día siguiente al de hoy.
    valueDate: dateMatch ? dateMatch[1] : null,
  };
}

/**
 * Precio de referencia del P2P de Binance.
 *
 * Se pide el mismo cuerpo que usa la web de Binance (USDT/VES, anuncios de
 * VENTA) y se toma la MEDIANA de los primeros avisos, no el primero: el aviso
 * de arriba suele ser el más agresivo y salta varios bolívares de un minuto
 * a otro. La mediana da un número estable de un día para el otro.
 */
async function fetchBinance(rows = 10) {
  const res = await fetch(BINANCE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; AlonzoPOS/1.0)',
    },
    body: JSON.stringify({
      asset: 'USDT',
      fiat: 'VES',
      tradeType: 'SELL',
      page: 1,
      rows,
      payTypes: [],
      publisherType: null,
    }),
    signal: AbortSignal.timeout(12000),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const json = await res.json();
  const prices = (json.data || [])
    .map((d) => parseFloat(d?.adv?.price))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);

  if (!prices.length) throw new Error('Binance no devolvió anuncios');

  const mid = Math.floor(prices.length / 2);
  const median = prices.length % 2
    ? prices[mid]
    : (prices[mid - 1] + prices[mid]) / 2;

  return { price: round2(median), ads: prices.map(round2) };
}

/**
 * Consulta las dos fuentes en paralelo y devuelve lo que haya conseguido.
 * Nunca lanza: si una se cae, su valor viene en null y el motivo en `errors`,
 * así el que llama puede seguir con las otras.
 */
async function readRates() {
  const [bcvResult, binanceResult] = await Promise.allSettled([fetchBcv(), fetchBinance()]);

  const errors = [];
  let bcv = null, eur = null, bcvDate = null;
  if (bcvResult.status === 'fulfilled') {
    bcv = bcvResult.value.usd;
    eur = bcvResult.value.eur;
    bcvDate = bcvResult.value.valueDate;
    if (bcv === null) errors.push('No se encontró el dólar en la página del BCV.');
    if (eur === null) errors.push('No se encontró el euro en la página del BCV.');
  } else {
    errors.push(`BCV: ${bcvResult.reason?.message || 'no respondió'}`);
  }

  let binance = null, binanceAds = [];
  if (binanceResult.status === 'fulfilled') {
    binance = binanceResult.value.price;
    binanceAds = binanceResult.value.ads;
  } else {
    errors.push(`Binance: ${binanceResult.reason?.message || 'no respondió'}`);
  }

  return {
    bcv: bcv === null ? null : round2(bcv),
    eur: eur === null ? null : round2(eur),
    bcvDate,
    binance,
    binanceAds,
    fetchedAt: new Date().toISOString(),
    errors,
  };
}

module.exports = { readRates, todayVE, round2 };
