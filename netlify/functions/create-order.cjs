/**
 * ══════════════════════════════════════════════════════════════
 * ALONZO — API 3: finalizar la orden (crear la venta)
 * ══════════════════════════════════════════════════════════════
 *
 * Cierra el flujo del bot: catálogo (`products`) → disponibilidad
 * (`availability`) → ESTA, que crea la factura de verdad.
 *
 * Hace exactamente lo mismo que un cajero cerrando una venta en el POS,
 * en UNA SOLA transacción atómica:
 *   1. Toma el correlativo de config/invoiceCounter (el mismo que el POS).
 *   2. Descuenta el stock de la sucursal que corresponde al tipo de envío.
 *   3. Registra el cliente (lo crea o actualiza sus datos).
 *   4. Crea el documento en `invoices`.
 * Si cualquier paso falla, no queda nada a medias: ni factura sin stock
 * descontado, ni stock descontado sin factura.
 *
 * NADA de plata se toma del request: los precios y la tasa se leen del
 * servidor. El bot puede mandar `expectedTotalUsd` y si no cuadra con lo
 * que calcula el servidor, la venta se rechaza en vez de cobrar otra cosa.
 *
 * Autenticación: cabecera `x-api-key` (CATALOG_API_KEY), igual que las otras.
 *
 * POST /.netlify/functions/create-order
 *   Body: { idempotencyKey, client, items, deliveryType, deliveryCostUsd,
 *           payments, observation, sellerName, branch, expectedTotalUsd }
 *
 * Respuestas: 201 creada · 200 duplicada (idempotencia) · 400 datos malos
 *             · 401 llave · 409 sin stock o total no cuadra · 500 servidor
 */
const admin = require('firebase-admin');
const {
  getDb, HEADERS, json, requireApiKey, num, round2, sizeLabel, fold, formatBs,
} = require('../lib/api-common.cjs');

// Los métodos que acepta la caja. Copiados de PAYMENT_METHODS en
// src/modules/invoices/invoiceService.ts — si allá se agrega uno, hay que
// agregarlo acá. Se valida contra esta lista para que el cierre de caja no
// se encuentre con un método que no sabe clasificar.
const PAYMENT_METHODS = [
  { id: 'pago-movil', name: 'Pago movil', currency: 'ves' },
  { id: 'punto-debito', name: 'Punto de venta (Débito)', currency: 'ves' },
  { id: 'transferencia', name: 'Transferencia bancaria', currency: 'ves' },
  { id: 'efectivo-bs', name: 'Efectivo (Bs)', currency: 'ves' },
  { id: 'efectivo-usd', name: 'Efectivo ($)', currency: 'usd' },
  { id: 'zelle', name: 'Zelle', currency: 'usd' },
  { id: 'zinli', name: 'Zinli', currency: 'usd' },
  { id: 'binance', name: 'Binance', currency: 'usd' },
  { id: 'paypal', name: 'Paypal', currency: 'usd' },
  { id: 'credito', name: 'Crédito', currency: 'none' },
];

const DELIVERY_TYPES = ['showroom', 'pickup', 'pick-up', 'local', 'national', 'web'];

/**
 * De qué sucursal sale la mercancía, según cómo la recibe el cliente.
 * Mismo criterio que branchFromDeliveryType() en src/utils/branchUtils.ts:
 * si la retira en persona sale de la tienda, si se le envía sale del almacén.
 */
function branchFromDeliveryType(deliveryType) {
  return (deliveryType === 'showroom' || deliveryType === 'pickup' || deliveryType === 'pick-up')
    ? 'store'
    : 'warehouse';
}

/** Normaliza el método de pago: acepta el id ('zelle') o el nombre ('Zelle'). */
function resolvePaymentMethod(raw) {
  const wanted = fold(raw);
  return PAYMENT_METHODS.find((m) => fold(m.id) === wanted || fold(m.name) === wanted) || null;
}

/**
 * Ubica la variante que pidió el bot.
 *
 * Se acepta por `variantIndex` (lo que devuelven las otras APIs), por
 * talla + color, o por código de barras. El índice es lo que termina
 * guardado en la factura: así lo identifica el POS para devoluciones.
 */
function resolveVariant(variants, item) {
  if (item.variantIndex !== undefined && item.variantIndex !== null && item.variantIndex !== '') {
    const idx = parseInt(item.variantIndex, 10);
    if (!Number.isInteger(idx) || idx < 0 || idx >= variants.length) return { error: `variantIndex ${item.variantIndex} fuera de rango.` };
    return { index: idx, variant: variants[idx] };
  }

  if (item.barcode) {
    const want = String(item.barcode).trim();
    const idx = variants.findIndex((v) => String(v.barcode || '').trim() === want);
    if (idx < 0) return { error: `Ninguna variante con el código ${want}.` };
    return { index: idx, variant: variants[idx] };
  }

  if (item.size || item.talla) {
    const wantSize = fold(sizeLabel(item.size || item.talla));
    const wantColor = fold(item.color || '');
    const idx = variants.findIndex((v) => {
      if (fold(sizeLabel(v.size)) !== wantSize) return false;
      // El color solo filtra si lo mandaron: un producto de un solo color
      // no debería obligar al bot a saber cuál es.
      return wantColor ? fold(v.color) === wantColor : true;
    });
    if (idx < 0) {
      const disponibles = [...new Set(variants.map((v) => sizeLabel(v.size)))].join(', ');
      return { error: `No existe la talla ${item.size || item.talla}${item.color ? ` en ${item.color}` : ''}. Tallas: ${disponibles}.` };
    }
    return { index: idx, variant: variants[idx] };
  }

  return { error: 'Falta identificar la variante: manda variantIndex, size (+color) o barcode.' };
}

/** Stock vendible de una variante en una sucursal (nunca cuenta el tránsito). */
function branchStock(variant, branch) {
  if (variant.stockStore === undefined && variant.stockWarehouse === undefined) {
    // Producto sin migrar al modelo por sucursal: solo tiene el agregado.
    return num(variant.stock);
  }
  return branch === 'store' ? num(variant.stockStore) : num(variant.stockWarehouse);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { ...HEADERS, 'Access-Control-Allow-Methods': 'POST, OPTIONS' }, body: '' };
  }
  if (event.httpMethod !== 'POST') return json(405, { error: 'Método no permitido. Usa POST.' });

  const unauthorized = requireApiKey(event);
  if (unauthorized) return unauthorized;

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'JSON inválido.' });
  }

  // ── Validación de entrada ──
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) return json(400, { error: 'La orden no tiene items.' });
  if (items.length > 50) return json(400, { error: 'Máximo 50 items por orden.' });

  const client = body.client || {};
  const clientName = String(client.name || '').trim();
  const clientRif = String(client.rif_ci || client.cedula || '').replace(/\D/g, '');
  const clientPhone = String(client.phone || '').trim();

  if (clientName.length < 3) return json(400, { error: 'Falta el nombre del cliente.' });
  if (clientRif.length < 5) return json(400, { error: 'Falta la cédula del cliente (mínimo 5 dígitos).' });

  const deliveryType = String(body.deliveryType || 'web').trim();
  if (!DELIVERY_TYPES.includes(deliveryType)) {
    return json(400, { error: `Tipo de entrega inválido. Válidos: ${DELIVERY_TYPES.join(', ')}.` });
  }

  const deliveryCostUsd = num(body.deliveryCostUsd);
  if (deliveryCostUsd < 0 || deliveryCostUsd > 200) {
    return json(400, { error: 'Costo de envío fuera de rango (0 a 200).' });
  }

  // La sucursal sale del tipo de entrega, salvo que la manden explícita.
  const branch = body.branch === 'store' || body.branch === 'warehouse'
    ? body.branch
    : branchFromDeliveryType(deliveryType);

  // ── Métodos de pago ──
  const rawPayments = Array.isArray(body.payments) ? body.payments : [];
  const badMethod = rawPayments.find((p) => !resolvePaymentMethod(p.method));
  if (badMethod) {
    return json(400, {
      error: `Método de pago desconocido: "${badMethod.method}".`,
      validMethods: PAYMENT_METHODS.map((m) => m.name),
    });
  }

  const idempotencyKey = String(body.idempotencyKey || '').trim().slice(0, 200);

  try {
    const db = getDb();

    // La tasa la pone el SERVIDOR, no el bot: es con la que factura el POS.
    const rateSnap = await db.collection('config').doc('exchangeRate').get();
    const exchangeRate = num(rateSnap.data() && rateSnap.data().value) || 1;

    // Búsqueda del cliente fuera de la transacción para no meterle 3 queries
    // adentro. El set() de después va con merge, así que si alguien lo creó
    // en el medio no se pisa nada importante.
    const existingClientId = await findClient(db, clientRif, clientPhone);

    const result = await db.runTransaction(async (tx) => {
      // ══ TODAS LAS LECTURAS PRIMERO (Firestore lo exige) ══

      // 1. Idempotencia: si esta misma orden ya se creó, devolver aquella.
      //    Sin esto, un reintento del bot por timeout cobra dos veces.
      const keyRef = idempotencyKey ? db.collection('botOrders').doc(idempotencyKey) : null;
      if (keyRef) {
        const prev = await tx.get(keyRef);
        if (prev.exists) {
          const d = prev.data();
          return { duplicate: true, invoiceId: d.invoiceId, numericId: d.numericId, total: d.total };
        }
      }

      // 2. Productos (uno solo por id aunque venga en varios items).
      const productRefs = {};
      for (const item of items) {
        const pid = String(item.productId || '').trim();
        if (!pid) throw new HttpError(400, 'Hay un item sin productId.');
        if (!productRefs[pid]) {
          const ref = db.collection('products').doc(pid);
          const snap = await tx.get(ref);
          if (!snap.exists) throw new HttpError(404, `Producto no encontrado: ${pid}`);
          productRefs[pid] = { ref, data: snap.data(), variants: JSON.parse(JSON.stringify(snap.data().variants || [])) };
        }
      }

      // 3. Correlativo de factura (el mismo contador que usa el POS).
      const counterRef = db.collection('config').doc('invoiceCounter');
      const counterSnap = await tx.get(counterRef);
      const nextId = num(counterSnap.exists ? counterSnap.data().lastNumericId : 0) + 1;

      // ══ CÁLCULO (sin escribir todavía) ══
      let subtotal = 0;
      let offerDiscount = 0;
      const itemSnapshots = [];
      const faltantes = [];

      for (const item of items) {
        const pid = String(item.productId).trim();
        const entry = productRefs[pid];
        const resolved = resolveVariant(entry.variants, item);
        if (resolved.error) throw new HttpError(400, `${entry.data.name || pid}: ${resolved.error}`);

        const quantity = parseInt(item.quantity ?? item.qty ?? 1, 10);
        if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 99) {
          throw new HttpError(400, `Cantidad inválida para ${entry.data.name || pid}: ${item.quantity}`);
        }

        const variant = entry.variants[resolved.index];
        const disponible = branchStock(variant, branch);

        // Red de seguridad: el bot ya consultó disponibilidad, pero entre esa
        // consulta y este momento pudo entrar una venta por el POS.
        if (quantity > disponible) {
          faltantes.push({
            productId: pid,
            productName: entry.data.name || pid,
            size: sizeLabel(variant.size),
            color: variant.color || '',
            pedido: quantity,
            disponible,
            branch,
            // Dato útil para el bot: puede que sí haya, pero en la otra sede.
            enLaOtraSucursal: branch === 'store' ? num(variant.stockWarehouse) : num(variant.stockStore),
          });
          continue;
        }

        const basePrice = round2(num(variant.price));
        const lineTotal = basePrice * quantity;
        subtotal += lineTotal;

        // Oferta del producto, con la misma fórmula que usa la tienda web.
        const offer = entry.data.offer;
        if (offer && num(offer.value) > 0) {
          offerDiscount += offer.type === 'percentage'
            ? (lineTotal * num(offer.value)) / 100
            : Math.min(num(offer.value) * quantity, lineTotal);
        }

        // Descontar del clon en memoria; se persiste más abajo.
        if (variant.stockStore === undefined && variant.stockWarehouse === undefined) {
          variant.stock = num(variant.stock) - quantity;
        } else {
          if (branch === 'store') variant.stockStore = num(variant.stockStore) - quantity;
          else variant.stockWarehouse = num(variant.stockWarehouse) - quantity;
          // Recalcular el agregado legacy, igual que hace el POS.
          variant.stock = num(variant.stockStore) + num(variant.stockWarehouse) + num(variant.stockInTransit);
        }

        itemSnapshots.push({
          productId: pid,
          variantIndex: resolved.index,
          quantity,
          discount: { type: 'none', value: 0 },
          priceAtSale: basePrice,
          productName: entry.data.name || '',
          variantLabel: `${variant.size || 'N/A'} / ${variant.color || 'N/A'}`,
          branch,
        });
      }

      if (faltantes.length) {
        throw new HttpError(409, 'No hay stock suficiente para cerrar la orden.', {
          faltantes,
          text: faltantes.map((f) => `${f.productName} talla ${f.size}: pediste ${f.pedido} y quedan ${f.disponible} en ${f.branch === 'store' ? 'tienda' : 'almacén'}.`).join(' '),
        });
      }

      offerDiscount = round2(offerDiscount);
      const total = round2(Math.max(0, subtotal - offerDiscount + deliveryCostUsd));

      // Si el bot ya le dijo un precio al cliente, tiene que coincidir con lo
      // que calcula el servidor. Si cambió el precio en el medio, se cancela
      // en vez de cobrarle algo distinto a lo cotizado.
      if (body.expectedTotalUsd !== undefined && body.expectedTotalUsd !== null) {
        const expected = round2(num(body.expectedTotalUsd));
        if (Math.abs(expected - total) > 0.01) {
          throw new HttpError(409, 'El total cambió desde que se cotizó.', {
            expectedTotalUsd: expected,
            serverTotalUsd: total,
            text: `El precio cambió: cotizaste $${expected} y ahora son $${total}. Confirma de nuevo con el cliente.`,
          });
        }
      }

      // ── Pagos: se completa la moneda que falte usando la tasa del servidor ──
      const payments = rawPayments.map((p) => {
        const method = resolvePaymentMethod(p.method);
        const amountUsd = p.amountUsd !== undefined
          ? round2(num(p.amountUsd))
          : round2(num(p.amountVes) / (exchangeRate || 1));
        const amountVes = p.amountVes !== undefined
          ? round2(num(p.amountVes))
          : round2(num(p.amountUsd) * exchangeRate);
        return {
          method: method.name,
          amountVes,
          amountUsd,
          ...(p.ref ? { ref: String(p.ref).trim() } : {}),
          ...(p.proofUrl ? { proofUrl: String(p.proofUrl).trim() } : {}),
        };
      });

      const paidUsd = round2(payments.reduce((a, p) => a + p.amountUsd, 0));
      // "Pagada" con una tolerancia de un centavo por el redondeo de la tasa.
      const isPaid = paidUsd >= total - 0.01;

      // ── Modo ensayo ──
      // Valida todo (stock, precios, total) y NO escribe nada. Sirve para que
      // el bot confirme con el cliente antes de cobrar, y para probar la API
      // sin quemar un número de factura ni tocar el inventario.
      if (body.dryRun === true) {
        return {
          dryRun: true,
          wouldCreate: true,
          numericIdPreview: nextId,
          subtotal: round2(subtotal),
          offerDiscount,
          deliveryCostUsd,
          total,
          totalBs: round2(total * exchangeRate),
          exchangeRate,
          paidUsd,
          pendingUsd: round2(Math.max(0, total - paidUsd)),
          isPaid,
          branch,
          items: itemSnapshots,
          payments,
        };
      }

      // ══ ESCRITURAS ══

      tx.set(counterRef, { lastNumericId: nextId }, { merge: true });

      for (const pid of Object.keys(productRefs)) {
        tx.update(productRefs[pid].ref, { variants: productRefs[pid].variants });
      }

      // Cliente: se crea o se le actualizan los datos de contacto.
      const clientRef = existingClientId
        ? db.collection('clients').doc(existingClientId)
        : db.collection('clients').doc();
      const clientPayload = {
        name: clientName,
        rif_ci: clientRif,
        phone: clientPhone,
        address: String(client.address || '').trim(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      if (!existingClientId) {
        clientPayload.source = 'bot';
        clientPayload.email = '';
        clientPayload.createdAt = admin.firestore.FieldValue.serverTimestamp();
      }
      tx.set(clientRef, clientPayload, { merge: true });

      const invoiceRef = db.collection('invoices').doc();
      tx.set(invoiceRef, {
        numericId: nextId,
        clientId: clientRef.id,
        clientSnapshot: {
          name: clientName,
          rif_ci: clientRif,
          phone: clientPhone,
          address: String(client.address || '').trim(),
        },
        date: admin.firestore.Timestamp.now(),
        items: itemSnapshots,
        totalDiscount: offerDiscount > 0 ? { type: 'fixed', value: offerDiscount } : { type: 'none', value: 0 },
        offerDiscount,
        total,
        exchangeRate,
        payments,
        // Mismo criterio que el POS: sin pago entra al flujo de crédito;
        // showroom se cierra al instante porque el cliente se la lleva.
        status: !isPaid
          ? 'Pendiente de pago'
          : deliveryType === 'showroom' ? 'Finalizado' : 'Por Preparar',
        abonos: [],
        sellerName: String(body.sellerName || 'BOT').trim().slice(0, 60),
        sellerUid: 'BOT',
        deliveryType,
        deliveryCostUsd,
        // En este sistema el campo funciona como "ya está pagada"
        // (isPending = !deliveryPaidInStore en PaymentPanel).
        deliveryPaidInStore: isPaid,
        observation: String(body.observation || 'Pedido por bot').slice(0, 500),
        branch,
        appliedCoupon: null,
        appliedPromotions: [],
        stockDeducted: true, // ya se descontó acá: evita que se descuente de nuevo
        source: 'bot',
        ...(idempotencyKey ? { orderKey: idempotencyKey } : {}),
      });

      // Marca de idempotencia: guarda a qué factura corresponde esta llave.
      if (keyRef) {
        tx.set(keyRef, {
          invoiceId: invoiceRef.id,
          numericId: nextId,
          total,
          createdAt: admin.firestore.Timestamp.now(),
        });
      }

      return {
        duplicate: false,
        invoiceId: invoiceRef.id,
        numericId: nextId,
        subtotal: round2(subtotal),
        offerDiscount,
        deliveryCostUsd,
        total,
        totalBs: round2(total * exchangeRate),
        exchangeRate,
        paidUsd,
        pendingUsd: round2(Math.max(0, total - paidUsd)),
        isPaid,
        branch,
        clientId: clientRef.id,
        items: itemSnapshots,
        payments,
      };
    });

    if (result.dryRun) {
      return json(200, {
        ...result,
        text: `ENSAYO (no se creó nada). Total: $${result.total} (${formatBs(result.totalBs)}). Hay stock para todo.`,
      });
    }

    if (result.duplicate) {
      return json(200, {
        ...result,
        text: `Ese pedido ya estaba registrado: factura #${result.numericId}. No se cobró ni se descontó nada de nuevo.`,
      });
    }

    return json(201, { ...result, text: toText(result, clientName) });
  } catch (err) {
    if (err instanceof HttpError) {
      return json(err.status, { error: err.message, ...(err.extra || {}) });
    }
    console.error('create-order error:', err);
    return json(500, { error: 'Error del servidor al crear la orden.' });
  }
};

/** Error con status HTTP, para cortar desde adentro de la transacción. */
class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

/**
 * Busca un cliente ya registrado por cédula o teléfono.
 * Mismo criterio que netlify/functions/register-client.cjs, incluido el
 * campo legacy `cedula` de los clientes viejos.
 */
async function findClient(db, rif, phone) {
  const clients = db.collection('clients');
  const queries = [
    clients.where('rif_ci', '==', rif).limit(1).get(),
    clients.where('cedula', '==', rif).limit(1).get(),
  ];
  if (phone) queries.push(clients.where('phone', '==', phone).limit(1).get());

  const results = await Promise.all(queries);
  for (const snap of results) {
    if (!snap.empty) return snap.docs[0].id;
  }
  return null;
}

/** Resumen para que el bot se lo mande al cliente tal cual. */
function toText(r, clientName) {
  const lineas = r.items.map(
    (i) => `• ${i.productName} ${i.variantLabel} x${i.quantity} — $${round2(i.priceAtSale * i.quantity)}`,
  );

  const partes = [
    `Pedido #${r.numericId} confirmado para ${clientName}.`,
    ...lineas,
  ];

  if (r.offerDiscount > 0) partes.push(`Descuento: -$${r.offerDiscount}`);
  if (r.deliveryCostUsd > 0) partes.push(`Envío: $${r.deliveryCostUsd}`);
  partes.push(`Total: $${r.total} (${formatBs(r.totalBs)})`);

  if (!r.isPaid) {
    partes.push(`Queda pendiente por pagar: $${r.pendingUsd}.`);
  } else {
    partes.push('Pago recibido, queda por verificar.');
  }

  return partes.join('\n');
}
