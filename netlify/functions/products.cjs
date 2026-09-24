/**
 * ══════════════════════════════════════════════════════════════
 * ALONZO — API 1: catálogo (producto, URL, talla y precio)
 * ══════════════════════════════════════════════════════════════
 *
 * Responde QUÉ se vende y a cuánto. El stock NO va acá: eso lo da
 * `availability.cjs`, que además trae la tasa para convertir a bolívares.
 * La separación es a propósito — el catálogo cambia poco y se puede cachear,
 * el stock cambia con cada venta y no.
 *
 * Autenticación: cabecera `x-api-key` (o `Authorization: Bearer <llave>`)
 * con el valor de la variable de entorno CATALOG_API_KEY.
 *
 * GET /.netlify/functions/products
 *   ?q=camisa azul     búsqueda libre (nombre, categoría, color, género)
 *   ?id=abc123         un producto puntual por su ID de Firestore
 *   ?barcode=7501234   busca por el código de barras de una variante
 *   ?category=Camisas  filtro exacto de categoría
 *   ?gender=Hombre     filtro exacto de género
 *   ?size=M            solo productos que tengan esa talla
 *   ?disponible=1      solo los que tienen STOCK (tienda o almacén). Con
 *                      ?size=, stock EN ESA TALLA: es lo que usa el bot para
 *                      mandar "las fotos de lo que hay en tu talla"
 *   ?limit=20          máximo 50 (por defecto 10)
 *   ?includeHidden=1   incluye los ocultos en la web (uso interno)
 *
 * Alias en español aceptados: ?talla= ?categoria= ?genero= ?codigo= ?buscar=
 * ?enStock=
 *
 * Respuesta 200:
 *   { count, products: [...], text }
 * `text` viene ya redactado para que el bot lo lea tal cual por WhatsApp.
 */
const {
  json, HEADERS, requireApiKey, productUrl, sizeLabel, num, round2,
  offerPrice, loadCatalog, isPublic, filterProducts, rankByRelevance, param, intParam,
  stockBreakdown, fold,
} = require('../lib/api-common.cjs');

/**
 * Unidades disponibles (tienda + almacén) de un producto, en una talla o en
 * todas. Mismo cálculo que `availability.cjs` (`stockBreakdown`): si las dos
 * APIs contaran distinto, el bot mandaría la foto de algo que después dice
 * que está agotado.
 */
function disponibles(product, size) {
  const want = fold(size);
  return (product.variants || [])
    .filter((v) => !want || fold(sizeLabel(v.size)) === want)
    .reduce((acc, v) => acc + stockBreakdown(v).available, 0);
}

/** Arma la ficha pública de un producto: identidad, URL, tallas y precios. */
function shape(product, stockSize) {
  const variants = (product.variants || []).map((v) => {
    const price = round2(num(v.price));
    const sale = offerPrice(product, price);
    return {
      size: sizeLabel(v.size),
      color: v.color || '',
      price,
      // Precio final que paga el cliente: con oferta si la hay.
      finalPrice: sale === null ? price : sale,
      onSale: sale !== null,
      barcode: v.barcode || null,
    };
  });

  const prices = variants.map((v) => v.finalPrice).filter((p) => p > 0);

  // Tallas únicas conservando el orden en que las cargó el admin: ese orden
  // suele ser el natural (S, M, L) y reordenar alfabéticamente lo arruinaría.
  const sizes = [...new Set(variants.map((v) => v.size))];
  const colors = [...new Set(variants.map((v) => v.color).filter(Boolean))];

  return {
    id: product.id,
    name: product.name || '',
    category: product.category || '',
    gender: product.gender || '',
    description: product.description || '',
    url: productUrl(product),
    image: product.imageUrl || null,
    images: Array.isArray(product.imageUrls) ? product.imageUrls : [],
    sizes,
    colors,
    priceFrom: prices.length ? Math.min(...prices) : null,
    priceTo: prices.length ? Math.max(...prices) : null,
    // Sólo cuando se pidió `disponible=1`: cuántas hay (en la talla pedida,
    // o en total). Sin ese filtro no se calcula, y la ficha queda igual que
    // siempre.
    ...(stockSize !== undefined ? { available: disponibles(product, stockSize), availableSize: stockSize || null } : {}),
    offer: product.offer && num(product.offer.value) > 0
      ? { type: product.offer.type, value: num(product.offer.value) }
      : null,
    variants,
  };
}

/**
 * La ficha CORTA, para `disponible=1`: lo que el bot necesita para mandar
 * "las fotos de lo que hay en tu talla" y nada más.
 *
 * La ficha completa pesa ~1.600 caracteres por producto (todas las variantes
 * y todas las fotos), y el bot recibe como mucho 4.000 por herramienta: con
 * seis productos veía tres enteros y mandaba tres fotos. Con ésta, seis
 * entran de sobra.
 */
function compacta(p) {
  return {
    id: p.id,
    name: p.name,
    category: p.category,
    url: p.url,
    image: p.image,
    price: p.priceFrom === p.priceTo ? p.priceFrom : { from: p.priceFrom, to: p.priceTo },
    ...(p.offer ? { offer: p.offer } : {}),
    available: p.available,
    availableSize: p.availableSize,
  };
}

/** Resumen en texto para que el bot lo mande sin tener que redactarlo. */
function toText(products, disponible, size) {
  if (!products.length) {
    return disponible && size
      ? `No hay productos con stock en talla ${size} para esa búsqueda.`
      : disponible
        ? 'No hay productos con stock para esa búsqueda.'
        : 'No encontré ningún producto con esos datos.';
  }

  return products.map((p) => {
    const precio = p.priceFrom === null ? 'precio no cargado'
      : p.priceFrom === p.priceTo ? `$${p.priceFrom}`
      : `desde $${p.priceFrom} hasta $${p.priceTo}`;

    const tallas = p.sizes.length ? `Tallas: ${p.sizes.join(', ')}.` : '';
    const colores = p.colors.length ? `Colores: ${p.colors.join(', ')}.` : '';
    const oferta = p.offer
      ? ` En oferta (${p.offer.type === 'percentage' ? `${p.offer.value}%` : `$${p.offer.value}`} de descuento).`
      : '';

    const stock = p.available !== undefined
      ? `Disponibles${p.availableSize ? ` en talla ${p.availableSize}` : ''}: ${p.available}.`
      : '';

    return [`${p.name} — ${precio}.${oferta}`, stock || tallas, colores, p.url]
      .filter(Boolean).join(' ');
  }).join('\n\n');
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
    size: param(event, 'size', 'talla'),
  };

  const hasFilter = Object.values(filters).some(Boolean);
  const limit = intParam(event, ['limit', 'limite'], 10, 50);
  const includeHidden = param(event, 'includeHidden', 'incluirOcultos') === '1';
  const disponible = param(event, 'disponible', 'enStock', 'inStock') === '1';

  try {
    const { products, hidden } = await loadCatalog();

    const visible = includeHidden ? products : products.filter((p) => isPublic(p, hidden));
    const filtrados = hasFilter ? filterProducts(visible, filters) : visible;
    // El stock filtra DESPUÉS de la búsqueda: `totalMatches` cuenta lo que
    // de verdad se puede vender, que es lo que el bot le promete al cliente.
    const matched = disponible
      ? filtrados.filter((p) => disponibles(p, filters.size) > 0)
      : filtrados;
    // No había exactamente lo pedido (ej. "chaqueta negra" sin negras): son
    // los más parecidos, y el bot tiene que decirlo así.
    const aproximado = Boolean(filtrados.aproximado);

    // Con búsqueda libre manda la relevancia (el match exacto primero); sin
    // ella, orden alfabético para que listar el catálogo sea predecible.
    const ordered = filters.q
      ? rankByRelevance(matched, filters.q)
      : [...matched].sort((a, b) => String(a.name).localeCompare(String(b.name), 'es'));

    const page = ordered.slice(0, limit).map((p) => shape(p, disponible ? filters.size : undefined));

    return json(200, {
      count: page.length,
      // Cuántos había en total antes de cortar por `limit`: le dice al bot si
      // vale la pena pedir más o si ya tiene todo.
      totalMatches: matched.length,
      ...(aproximado ? {
        aproximado: true,
        aviso: 'No hay exactamente lo que pidió: estos son los más parecidos (por ejemplo, la misma prenda en otro color). Decíselo así al cliente.',
      } : {}),
      products: disponible ? page.map(compacta) : page,
      text: toText(page, disponible, filters.size),
    }, {
      // El catálogo (nombres, tallas, precios) cambia pocas veces al día; el
      // stock no, así que con `disponible` la caché es corta y privada, igual
      // que en `availability.cjs`.
      'Cache-Control': disponible ? 'private, max-age=15' : 'public, max-age=60',
    });
  } catch (err) {
    console.error('products error:', err);
    return json(500, { error: 'Error del servidor al leer el catálogo.' });
  }
};
