/**
 * ══════════════════════════════════════════════════════════════
 * ALONZO — API 2: tasa + disponibilidad (tienda, almacén y total)
 * ══════════════════════════════════════════════════════════════
 *
 * Responde SI HAY y A CUÁNTO SALE EN BOLÍVARES. Complementa a `products.cjs`:
 * el bot primero busca el producto ahí y después pregunta acá por la talla.
 *
 * Dos tasas en la respuesta, y no es redundancia:
 *   - `bcv`: la que publica hoy bcv.org.ve (se lee en vivo).
 *   - `pos`: config/exchangeRate, LA QUE REALMENTE FACTURA el sistema.
 * El precio en bolívares se calcula con la del POS cuando existe, porque
 * cotizarle al cliente una cifra que después la caja no le va a cobrar es
 * peor que no cotizarle nada. Con `?rate=bcv` se fuerza la del BCV.
 *
 * Autenticación: cabecera `x-api-key` (o `Authorization: Bearer <llave>`)
 * con el valor de la variable de entorno CATALOG_API_KEY.
 *
 * GET /.netlify/functions/availability
 *   ?id=abc123         producto por ID (la vía recomendada)
 *   ?barcode=7501234   por código de barras de la variante
 *   ?q=camisa azul     búsqueda libre; si hay varios match, avisa y no adivina
 *   ?size=M            limita la respuesta a esa talla
 *   ?rate=bcv|pos      qué tasa usar para el precio en Bs. (por defecto: pos)
 *
 * Alias en español aceptados: ?talla= ?codigo= ?buscar= ?tasa=
 *
 * Respuesta 200:
 *   { rates, rateUsed, product, variants[], totals, text }
 * Cada variante trae { size, color, price, priceBs, stock:{store, warehouse,
 * inTransit, available, total} } y `totals` suma todas las tallas.
 */
const {
  json, HEADERS, requireApiKey, getDb, productUrl, sizeLabel, num, round2,
  offerPrice, stockBreakdown, loadCatalog, isPublic, fold, filterProducts,
  rankByRelevance, param, formatBs,
} = require('../lib/api-common.cjs');
const { readBcv } = require('../lib/rate-sources.cjs');

/** La tasa con la que factura el POS (config/exchangeRate.value). */
async function readPosRate() {
  try {
    const snap = await getDb().collection('config').doc('exchangeRate').get();
    const value = num(snap.data() && snap.data().value);
    // El store del front arranca en 1 como placeholder mientras carga; un 1
    // guardado en base es casi seguro ese placeholder, no una tasa real.
    return value > 1 ? round2(value) : null;
  } catch (err) {
    console.error('availability: no se pudo leer config/exchangeRate:', err);
    return null;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: HEADERS, body: '' };
  if (event.httpMethod !== 'GET') return json(405, { error: 'Método no permitido' });

  const unauthorized = requireApiKey(event);
  if (unauthorized) return unauthorized;

  const filters = {
    id: param(event, 'id'),
    barcode: param(event, 'barcode', 'codigo'),
    q: param(event, 'q', 'buscar', 'search'),
    category: param(event, 'category', 'categoria'),
    gender: param(event, 'gender', 'genero'),
    size: '', // la talla NO filtra la búsqueda del producto: recorta la respuesta
  };
  const wantSize = param(event, 'size', 'talla');
  const rateChoice = param(event, 'rate', 'tasa').toLowerCase();

  if (!filters.id && !filters.barcode && !filters.q) {
    return json(400, { error: 'Falta identificar el producto: manda ?id=, ?barcode= o ?q=' });
  }

  try {
    // Las tres lecturas son independientes: en paralelo para no encadenar
    // la latencia del BCV con la de Firestore.
    const [catalog, bcvRates, posRate] = await Promise.all([
      loadCatalog(), readBcv(), readPosRate(),
    ]);

    const visible = catalog.products.filter((p) => isPublic(p, catalog.hidden));
    const matched = filterProducts(visible, filters);

    if (!matched.length) {
      return json(404, {
        error: 'Producto no encontrado.',
        text: 'No encontré ese producto en el catálogo.',
      });
    }

    const ranked = filters.q ? rankByRelevance(matched, filters.q) : matched;

    // Con varios match solo se resuelve solo cuando hay un ganador CLARO: el
    // nombre coincide exacto (>=1000) y ninguno más llega a ese puntaje. Si
    // hay empate se devuelven los candidatos en vez de adivinar — cotizar la
    // prenda equivocada es peor que pedirle al cliente que precise.
    if (ranked.length > 1) {
      const [first, second] = ranked;
      const clearWinner = filters.q && first._score >= 1000 && second._score < 1000;

      if (!clearWinner) {
        const options = ranked.slice(0, 10).map((p) => ({
          id: p.id, name: p.name, category: p.category, url: productUrl(p),
        }));
        return json(300, {
          error: 'Hay más de un producto que coincide.',
          matches: ranked.length,
          options,
          text: `Encontré ${ranked.length} productos que coinciden. ¿Cuál te interesa?\n`
            + options.map((o, i) => `${i + 1}. ${o.name}`).join('\n'),
        });
      }
    }

    const product = ranked[0];

    // Tasa efectiva: la del POS manda salvo que pidan explícitamente la del BCV.
    const useBcv = rateChoice === 'bcv' || posRate === null;
    const effective = useBcv ? bcvRates.bcv : posRate;
    const rateUsed = { source: useBcv ? 'bcv' : 'pos', value: effective };

    let variants = (product.variants || []).map((v) => {
      const price = round2(num(v.price));
      const sale = offerPrice(product, price);
      const finalPrice = sale === null ? price : sale;
      return {
        size: sizeLabel(v.size),
        color: v.color || '',
        price,
        finalPrice,
        onSale: sale !== null,
        barcode: v.barcode || null,
        // null (no 0) cuando no hay tasa: un 0 se lee como "es gratis".
        priceBs: effective ? round2(finalPrice * effective) : null,
        stock: stockBreakdown(v),
      };
    });

    if (wantSize) {
      const want = fold(wantSize);
      const filtered = variants.filter((v) => fold(v.size) === want);
      if (!filtered.length) {
        const disponibles = [...new Set(variants.map((v) => v.size))].join(', ');
        return json(404, {
          error: `El producto no maneja la talla ${wantSize}.`,
          availableSizes: [...new Set(variants.map((v) => v.size))],
          text: `${product.name} no tiene talla ${wantSize}. Las tallas que maneja son: ${disponibles}.`,
        });
      }
      variants = filtered;
    }

    // Totales sobre las variantes devueltas (si filtraron por talla, es el
    // total de esa talla; si no, el del producto completo).
    const totals = variants.reduce((acc, v) => ({
      store: acc.store + v.stock.store,
      warehouse: acc.warehouse + v.stock.warehouse,
      inTransit: acc.inTransit + v.stock.inTransit,
      available: acc.available + v.stock.available,
      total: acc.total + v.stock.total,
    }), { store: 0, warehouse: 0, inTransit: 0, available: 0, total: 0 });

    return json(200, {
      rates: {
        bcv: bcvRates.bcv,
        eur: bcvRates.eur,
        bcvDate: bcvRates.bcvDate,
        pos: posRate,
        fetchedAt: bcvRates.fetchedAt,
        errors: bcvRates.errors,
      },
      rateUsed,
      product: {
        id: product.id,
        name: product.name || '',
        category: product.category || '',
        gender: product.gender || '',
        url: productUrl(product),
        image: product.imageUrl || null,
      },
      variants,
      totals,
      inStock: totals.available > 0,
      text: toText(product, variants, totals, rateUsed),
    }, {
      // El stock cambia con cada venta: caché corta, y privada para que no
      // quede cacheado en el CDN detrás de una llave compartida.
      'Cache-Control': 'private, max-age=15',
    });
  } catch (err) {
    console.error('availability error:', err);
    return json(500, { error: 'Error del servidor al consultar disponibilidad.' });
  }
};

/** Resumen en texto para que el bot lo mande sin tener que redactarlo. */
function toText(product, variants, totals, rateUsed) {
  const head = `${product.name}${product.category ? ` (${product.category})` : ''}`;

  if (totals.available <= 0) {
    return `${head}: agotado por ahora, no hay unidades ni en tienda ni en almacén.`;
  }

  const lineas = variants
    .filter((v) => v.stock.available > 0)
    .map((v) => {
      const etiqueta = [v.size, v.color].filter(Boolean).join(' ');
      const bs = v.priceBs === null ? '' : ` (${formatBs(v.priceBs)})`;
      const donde = [
        v.stock.store > 0 ? `${v.stock.store} en tienda` : '',
        v.stock.warehouse > 0 ? `${v.stock.warehouse} en almacén` : '',
      ].filter(Boolean).join(' y ');
      return `• Talla ${etiqueta} — $${v.finalPrice}${bs} — ${donde} (total ${v.stock.available})`;
    });

  const tasa = rateUsed.value
    ? `\nTasa usada: ${formatBs(rateUsed.value)} por dólar${rateUsed.source === 'bcv' ? ' (BCV)' : ''}.`
    : '\nOJO: no se pudo obtener la tasa, los precios van solo en dólares.';

  return `${head}\n${lineas.join('\n')}\nDisponible en total: ${totals.available} unidades.${tasa}`;
}
