/**
 * ══════════════════════════════════════════════════════════════
 * ALONZO — Piezas compartidas por las APIs públicas del sistema
 * ══════════════════════════════════════════════════════════════
 *
 * Vive fuera de netlify/functions a propósito: todo archivo suelto dentro de
 * esa carpeta es una función, y esto es código compartido. Lo usan
 * `products.cjs` (catálogo: producto, URL, talla y precio) y
 * `availability.cjs` (tasa + stock por sucursal).
 *
 * Las dos APIs leen con la cuenta de servicio, así que NO les aplican las
 * reglas de Firestore: por eso van detrás de una llave (ver requireApiKey).
 */
const admin = require('firebase-admin');

// ── Inicialización singleton (reutiliza entre invocaciones "calientes") ──
function getDb() {
  if (!admin.apps.length) {
    let credential;
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      credential = admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
    } else {
      // Respaldo SOLO para desarrollo local con `netlify dev`. El require es
      // dinámico a propósito: así esbuild NO incrusta la llave en el bundle.
      const path = require('path');
      const keyPath = path.join(__dirname, '..', '..', 'serviceAccountKey.json');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      credential = admin.credential.cert(require(keyPath));
    }
    admin.initializeApp({ credential });
  }
  return admin.firestore();
}

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, x-api-key, Authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
};

function json(statusCode, body, extraHeaders) {
  return {
    statusCode,
    headers: { ...HEADERS, ...(extraHeaders || {}) },
    body: JSON.stringify(body),
  };
}

/**
 * Comparación de strings en tiempo constante.
 *
 * Un `===` normal corta en el primer carácter distinto, y esa diferencia de
 * microsegundos permite adivinar la llave carácter por carácter. Se comparan
 * los hashes para que ambos lados midan siempre lo mismo aunque los largos
 * difieran (timingSafeEqual exige buffers del mismo tamaño).
 */
function safeEqual(a, b) {
  const crypto = require('crypto');
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/**
 * Valida la llave de la petición. Devuelve null si todo está bien, o la
 * respuesta de error ya armada si hay que cortar.
 *
 * Se acepta en `x-api-key` o en `Authorization: Bearer <llave>`. NO se acepta
 * por query string a propósito: las URLs quedan escritas en los logs de
 * Netlify, en el historial del navegador y en los referrers.
 *
 * Si CATALOG_API_KEY no está configurada, corta con 500 en vez de dejar pasar:
 * un despliegue al que se le olvidó la variable NO debe quedar abierto.
 */
function requireApiKey(event) {
  const expected = process.env.CATALOG_API_KEY;
  if (!expected) {
    console.error('[api] falta la variable de entorno CATALOG_API_KEY');
    return json(500, { error: 'API sin configurar: falta CATALOG_API_KEY en el servidor.' });
  }

  const headers = event.headers || {};
  // Netlify normaliza las cabeceras a minúsculas, pero no cuesta nada cubrirlo.
  const raw = headers['x-api-key'] || headers['X-Api-Key'] || '';
  const auth = headers.authorization || headers.Authorization || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const provided = (raw || bearer).trim();

  if (!provided || !safeEqual(provided, expected)) {
    return json(401, { error: 'Llave inválida o ausente. Manda la cabecera x-api-key.' });
  }
  return null;
}

// ════════════════════════════════════════════════════════════
// URL pública del producto
// ════════════════════════════════════════════════════════════
//
// Tiene que dar EXACTAMENTE el mismo href que arma la tienda
// (alonzo-next/lib/productUrl.ts), o los enlaces que mande el bot caen en un
// 404. Formato: /product/{categoria}-{nombre}-{id}
const STORE_URL = (process.env.STORE_BASE_URL || 'https://alonzocollection.com').replace(/\/+$/, '');

function slugify(name) {
  return (name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quitar acentos
    .replace(/[^a-z0-9]+/g, '-')     // todo lo no alfanumérico -> guion
    .replace(/^-+|-+$/g, '');        // quitar guiones al inicio/fin
}

function productUrl(product) {
  const parts = [slugify(product.category || ''), slugify(product.name || '')].filter(Boolean);
  const slug = parts.join('-');
  return slug ? `${STORE_URL}/product/${slug}-${product.id}` : `${STORE_URL}/product/${product.id}`;
}

// ════════════════════════════════════════════════════════════
// Tallas y stock (mismo criterio que src/utils/branchUtils.ts)
// ════════════════════════════════════════════════════════════
const NO_SIZE_LABEL = 'S/T';
const LEGACY_NO_SIZE_LABELS = ['ÚNICA', 'UNICA'];

/** Normaliza cualquier variante "sin talla" (vacía o legacy) a 'S/T'. */
function sizeLabel(size) {
  const s = String(size ?? '').trim().toUpperCase();
  return (s === '' || s === NO_SIZE_LABEL || LEGACY_NO_SIZE_LABELS.includes(s))
    ? NO_SIZE_LABEL
    : String(size).trim();
}

function num(v) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Desglose de stock de una variante.
 *
 * `available` = lo que se puede vender HOY (tienda + almacén). Excluye el
 * tránsito a propósito: esa mercancía salió del almacén y la tienda todavía
 * no la recibió, así que no está disponible para comprometerla con un cliente.
 * `total` sí lo suma — es el inventario contable, igual que getTotalStock().
 */
function stockBreakdown(variant) {
  const hasBranchFields = variant.stockStore !== undefined || variant.stockWarehouse !== undefined;

  // Productos aún no migrados al modelo por sucursal: solo tienen `stock`.
  // Se reporta como almacén para no inventar existencias en la tienda.
  if (!hasBranchFields) {
    const legacy = num(variant.stock);
    return { store: 0, warehouse: legacy, inTransit: 0, available: legacy, total: legacy, legacy: true };
  }

  const store = num(variant.stockStore);
  const warehouse = num(variant.stockWarehouse);
  const inTransit = num(variant.stockInTransit);
  return {
    store,
    warehouse,
    inTransit,
    available: store + warehouse,
    total: store + warehouse + inTransit,
    legacy: false,
  };
}

/** Precio con la oferta del producto aplicada, o null si no hay oferta válida. */
function offerPrice(product, base) {
  const offer = product.offer;
  if (!offer || num(offer.value) <= 0) return null;
  const discounted = offer.type === 'percentage'
    ? base - (base * num(offer.value)) / 100
    : Math.max(0, base - num(offer.value));
  return (discounted < base && discounted > 0) ? round2(discounted) : null;
}

// ════════════════════════════════════════════════════════════
// Lectura del catálogo
// ════════════════════════════════════════════════════════════

/**
 * Caché en memoria del proceso. Netlify reutiliza el contenedor entre
 * invocaciones seguidas, así que una ráfaga de preguntas del bot sobre el
 * mismo producto se responde sin volver a leer toda la colección. 60 s es
 * suficientemente fresco para stock de una boutique y corta el costo de
 * lecturas de Firestore.
 */
const CACHE_TTL_MS = 60 * 1000;
let cache = { at: 0, products: null, hidden: null };

async function loadCatalog() {
  if (cache.products && Date.now() - cache.at < CACHE_TTL_MS) {
    return { products: cache.products, hidden: cache.hidden };
  }

  const db = getDb();
  const [snap, webSettings] = await Promise.all([
    db.collection('products').get(),
    db.collection('config').doc('webSettings').get(),
  ]);

  const products = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  // Categorías que el admin ocultó en la web desde el POS. Se respetan acá
  // también: si algo no se anuncia en la tienda, el bot tampoco lo ofrece.
  const data = webSettings.data();
  const hidden = new Set(Array.isArray(data && data.hiddenCategories) ? data.hiddenCategories : []);

  cache = { at: Date.now(), products, hidden };
  return { products, hidden };
}

/** True si el producto es visible para el público (web + categoría no oculta). */
function isPublic(product, hidden) {
  if (product.active === false) return false;
  return !hidden.has(`${product.gender}|||${product.category}`);
}

/** Quita acentos y baja a minúsculas para comparar búsquedas del usuario. */
function fold(s) {
  return String(s === undefined || s === null ? '' : s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

/**
 * Filtra el catálogo con los parámetros de la query.
 *
 * `q` hace match por TODOS los términos (AND) contra nombre, categoría,
 * género, color y código de barras: "camisa azul" no debe traer todas las
 * camisas.
 */
function filterProducts(products, params) {
  const { id, barcode, q, category, gender, size } = params;

  if (id) return products.filter((p) => p.id === id);

  if (barcode) {
    const b = String(barcode).trim();
    return products.filter((p) => (p.variants || []).some((v) => String(v.barcode || '').trim() === b));
  }

  const terms = fold(q).split(/\s+/).filter(Boolean);
  const wantCategory = fold(category);
  const wantGender = fold(gender);
  const wantSize = fold(size);

  return products.filter((p) => {
    if (wantCategory && fold(p.category) !== wantCategory) return false;
    if (wantGender && fold(p.gender) !== wantGender) return false;

    if (wantSize) {
      const sizes = (p.variants || []).map((v) => fold(sizeLabel(v.size)));
      if (!sizes.includes(wantSize)) return false;
    }

    if (terms.length) {
      const haystack = fold([
        p.name, p.category, p.gender,
        ...(p.variants || []).map((v) => `${v.color || ''} ${v.size || ''} ${v.barcode || ''}`),
      ].join(' '));
      if (!terms.every((t) => haystack.includes(t))) return false;
    }

    return true;
  });
}

/**
 * Puntaje de relevancia de un producto contra la búsqueda.
 *
 * Sin esto, "BLAZER BEIGE" devolvía primero "BLAZER ESTAMPADO BEIGE ROSE"
 * (los dos contienen ambos términos, y el orden lo decidía Firestore). Para
 * un bot que le cotiza a un cliente eso es responder otra prenda, así que el
 * nombre pesa mucho más que la categoría o el color, y el match exacto manda.
 */
function scoreProduct(product, terms, query) {
  const name = fold(product.name);
  const q = fold(query);
  let score = 0;

  if (q) {
    if (name === q) score += 1000;          // el nombre es exactamente lo buscado
    else if (name.startsWith(q)) score += 200;
    else if (name.includes(q)) score += 100; // la frase completa aparece en el nombre
  }

  const category = fold(product.category);
  const colors = fold((product.variants || []).map((v) => v.color || '').join(' '));
  for (const t of terms) {
    if (name.includes(t)) score += 10;
    if (category.includes(t)) score += 3;
    if (colors.includes(t)) score += 2;
  }

  // Desempate: a igual puntaje, el nombre más corto es el más específico
  // ("BLAZER BEIGE" antes que "BLAZER BEIGE ESTAMPADO EDICIÓN LIMITADA").
  return score - name.length / 1000;
}

/**
 * Ordena por relevancia. Devuelve una copia con `_score` para que quien
 * llame pueda decidir si el primero gana por goleada o hay empate.
 */
function rankByRelevance(products, query) {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return products.map((p) => ({ ...p, _score: 0 }));

  return products
    .map((p) => ({ ...p, _score: scoreProduct(p, terms, query) }))
    .sort((a, b) => b._score - a._score);
}

/** Lee `?param=` aceptando también alias en español. */
function param(event, ...names) {
  const qs = event.queryStringParameters || {};
  for (const n of names) {
    const v = qs[n];
    if (v !== undefined && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

function intParam(event, names, def, max) {
  const raw = param(event, ...names);
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(n, max);
}

/** Formatea bolívares como los muestra el POS: Bs. 8.550,00 */
function formatBs(amount) {
  return `Bs. ${amount.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

module.exports = {
  getDb,
  HEADERS,
  json,
  requireApiKey,
  STORE_URL,
  slugify,
  productUrl,
  NO_SIZE_LABEL,
  sizeLabel,
  num,
  round2,
  stockBreakdown,
  offerPrice,
  loadCatalog,
  isPublic,
  fold,
  filterProducts,
  rankByRelevance,
  param,
  intParam,
  formatBs,
};
