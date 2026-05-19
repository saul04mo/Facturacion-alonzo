import {
  collection, doc, getDoc, runTransaction, updateDoc, Timestamp, writeBatch,
} from 'firebase/firestore';
import { db } from '@/config/firebase';
import { batchRestoreStock, batchApplyStockDeltas, validateStock } from '@/utils/stockUtils';
import { recordCouponUsage } from '@/services/promotionService';
import type { CurrentSale, AppUser, Product, Invoice, ClientSnapshot } from '@/types';

// ================================
// PAYMENT METHODS CONFIG
// ================================
export const PAYMENT_METHODS = [
  { id: 'pago-movil', name: 'Pago movil', currency: 'ves' as const, hasRef: true },
  { id: 'punto-debito', name: 'Punto de venta (Débito)', currency: 'ves' as const, hasRef: true },
  { id: 'efectivo-bs', name: 'Efectivo (Bs)', currency: 'ves' as const, hasRef: false },
  { id: 'efectivo-usd', name: 'Efectivo ($)', currency: 'usd' as const, hasRef: false },
  { id: 'zelle', name: 'Zelle', currency: 'usd' as const, hasRef: true },
  { id: 'zinli', name: 'Zinli', currency: 'usd' as const, hasRef: true },
  { id: 'binance', name: 'Binance', currency: 'usd' as const, hasRef: true },
  { id: 'paypal', name: 'Paypal', currency: 'usd' as const, hasRef: true },
  { id: 'credito', name: 'Crédito', currency: 'none' as const, hasRef: false },
] as const;

export type PaymentMethodId = (typeof PAYMENT_METHODS)[number]['id'];

export interface ActivePayment {
  method: string;
  amountVes: number;
  amountUsd: number;
  ref?: string;
}

// ================================
// PROCESS SALE (CHECKOUT)
// ================================
// FIX: Single transaction for atomic counter + stock + invoice creation.
// FIX: Stores priceAtSale, productName, variantLabel per item.
// FIX: Validates stock before processing.
export async function processSale(opts: {
  sale: CurrentSale;
  payments: ActivePayment[];
  exchangeRate: number;
  currentUser: AppUser;
  products: Product[];
  clients: Array<{ id: string; name?: string; rif_ci?: string; phone?: string; address?: string }>;
  allowNegativeStock?: boolean;
  /**
   * Vuelto a entregar al cliente, en USD. Si los pagos en efectivo
   * superan el total, el cajero le devuelve la diferencia. Solo se
   * persiste si > 0.01 — facturas viejas o exactas no tienen el campo.
   */
  changeUsd?: number;
}): Promise<{ numericId: number }> {
  const { sale, payments, exchangeRate, currentUser, products, clients, allowNegativeStock, changeUsd } = opts;
  const isCreditSale = !sale.deliveryPaidInStore;

  // ── Pre-validation ──
  const stockError = validateStock(sale.items, products, allowNegativeStock, sale.branch || 'store');
  if (stockError) throw new Error(stockError);

  // ── Build item snapshots with priceAtSale ──
  const saleBranch = sale.branch || 'store';
  const itemSnapshots = sale.items.map((item) => {
    const product = products.find((p) => p.id === item.productId)!;
    const variant = product.variants[item.variantIndex];
    return {
      productId: item.productId,
      variantIndex: item.variantIndex,
      quantity: item.quantity,
      discount: item.discount,
      priceAtSale: variant.price,
      productName: product.name,
      variantLabel: `${variant.size || 'N/A'} / ${variant.color || 'N/A'}`,
      branch: saleBranch,
    };
  });

  // ── Client snapshot ──
  // Primero intentamos del array global (rápido, sin extra read).
  // Si no está ahí (los clientes ya no se cargan en masa para ahorrar
  // bandwidth), fetcheamos directo de Firestore por clientId.
  let clientObj: any = sale.clientId
    ? clients.find((c) => c.id === sale.clientId) || null
    : null;
  if (!clientObj && sale.clientId) {
    try {
      const clientDoc = await getDoc(doc(db, 'clients', sale.clientId));
      if (clientDoc.exists()) {
        clientObj = { id: clientDoc.id, ...clientDoc.data() };
      }
    } catch (err) {
      console.error('Error fetching client for snapshot:', err);
      // Continuamos sin snapshot — la factura se crea, pero queda sin
      // datos de cliente embebidos. Mejor que perder la venta.
    }
  }
  const clientSnapshot: ClientSnapshot | null = clientObj
    ? {
        name: (clientObj as any).name || (clientObj as any).nombre || '',
        rif_ci: (clientObj as any).rif_ci || (clientObj as any).cedula || '',
        phone: (clientObj as any).phone || '',
        address: (clientObj as any).address || (clientObj as any).direccion || '',
      }
    : null;

  // ── Single atomic transaction: counter + stock + invoice ──
  const newNumericId = await runTransaction(db, async (transaction) => {
    // 1. Get and increment counter
    const counterRef = doc(db, 'config', 'invoiceCounter');
    const counterDoc = await transaction.get(counterRef);
    const currentId = counterDoc.exists() ? (counterDoc.data().lastNumericId || 0) : 0;
    const nextId = currentId + 1;
    transaction.set(counterRef, { lastNumericId: nextId }, { merge: true });

    // 2. Deduct stock (inside the same transaction).
    // El descuento se hace contra el campo de la SUCURSAL ACTIVA
    // (stockStore o stockWarehouse), no contra el agregado. Después
    // del descuento se recalcula el agregado `stock` para mantener
    // sincronización con código legacy que aún lo lee.
    const productUpdates: Record<string, any[]> = {};
    sale.items.forEach((item) => {
      if (!productUpdates[item.productId]) {
        const product = products.find((p) => p.id === item.productId)!;
        productUpdates[item.productId] = JSON.parse(JSON.stringify(product.variants));
      }
      const variant = productUpdates[item.productId][item.variantIndex];
      if (variant) {
        if (saleBranch === 'store') {
          variant.stockStore = (variant.stockStore ?? 0) - item.quantity;
        } else {
          variant.stockWarehouse = (variant.stockWarehouse ?? 0) - item.quantity;
        }
        // Recalcular agregado total (legacy) para que reportes y otros
        // consumidores que aún leen `stock` vean el valor correcto.
        variant.stock = (variant.stockStore ?? 0) + (variant.stockWarehouse ?? 0) + (variant.stockInTransit ?? 0);
      }
    });
    for (const productId in productUpdates) {
      transaction.update(doc(db, 'products', productId), { variants: productUpdates[productId] });
    }

    // 3. Create invoice document
    const newInvoice = {
      numericId: nextId,
      clientId: sale.clientId || null,
      clientSnapshot,
      date: Timestamp.now(),
      items: itemSnapshots,
      totalDiscount: sale.totalDiscount,
      total: sale.total,
      exchangeRate,
      payments,
      // Status inicial según el tipo de venta:
      // - Crédito (pago a plazo) → 'Pendiente de pago' (su propio flujo)
      // - Showroom → 'Finalizado' (el cliente se la lleva al instante,
      //   no hay nada que preparar)
      // - Resto (pickup, local, national, web) → 'Por Preparar' (entra
      //   al flujo logístico Por Preparar → Preparado → Finalizado)
      status: isCreditSale
        ? 'Pendiente de pago'
        : sale.deliveryType === 'showroom'
          ? 'Finalizado'
          : 'Por Preparar',
      abonos: [],
      sellerName: `${currentUser.nombre} ${currentUser.apellido}`,
      sellerUid: currentUser.uid,
      deliveryType: sale.deliveryType,
      deliveryCostUsd: sale.deliveryCostUsd,
      deliveryPaidInStore: sale.deliveryPaidInStore,
      observation: sale.observation || null,
      // Sucursal de donde se descontó el stock
      branch: saleBranch,
      // ── Promo / Coupon audit trail ──
      appliedCoupon: sale.appliedCoupon || null,
      appliedPromotions: sale.appliedPromotions || [],
      stockDeducted: true, // Stock deducted in this transaction
      // Vuelto entregado al cliente (en USD). Solo se setea cuando hay
      // efectivo en exceso. Facturas que no lo tienen se interpretan
      // como vuelto = 0 (lectura defensiva en el cliente con ?? 0).
      ...((changeUsd ?? 0) > 0.01 ? { changeGiven: Number(changeUsd!.toFixed(2)) } : {}),
    };

    const newInvoiceRef = doc(collection(db, 'invoices'));
    transaction.set(newInvoiceRef, newInvoice);

    return nextId;
  });

  // ── Post-transaction: record coupon usage (non-critical) ──
  if (sale.appliedCoupon?.couponId) {
    try {
      await recordCouponUsage(sale.appliedCoupon.couponId, sale.clientId);
    } catch (err) {
      console.warn('Failed to record coupon usage:', err);
    }
  }

  return { numericId: newNumericId };
}

// ================================
// RETURN INVOICE
// ================================
// FIX: Uses shared batchRestoreStock, proper typing
export async function processReturn(opts: {
  invoiceId: string;
  invoice: Invoice;
  reason: string;
  details: string;
  currentUser: AppUser;
  products: Product[];
  /** Items to return. If omitted, all items are returned (full return). */
  returnItems?: Array<{ productId: string; variantIndex: number; quantity: number }>;
}): Promise<void> {
  const { invoiceId, invoice, reason, details, currentUser, products, returnItems } = opts;
  const batch = writeBatch(db);

  // itemsToRestore preserves item.branch from the original invoice items
  // so each item is restored to the correct branch (store or warehouse).
  // Si el item no trae branch (facturas viejas pre-migración), el
  // defaultBranch=invoice.branch ('store' para facturas migradas) lo cubre.
  const itemsToRestore = returnItems || invoice.items.map((i) => ({
    productId: i.productId,
    variantIndex: i.variantIndex,
    quantity: i.quantity,
    branch: i.branch,
  }));

  // Restore stock (unless product is damaged)
  if (reason !== 'Producto Dañado (Merma)') {
    batchRestoreStock(batch, itemsToRestore, products, invoice.branch || 'store');
  }

  const isPartial = returnItems && returnItems.length < invoice.items.length;

  const returnDetailsData: Record<string, any> = {
    reason,
    details: details || null,
    date: Timestamp.now(),
    processedBy: `${currentUser.nombre} ${currentUser.apellido}`,
    partial: isPartial || false,
  };
  if (isPartial && returnItems) {
    returnDetailsData.returnedItems = returnItems;
  }

  batch.update(doc(db, 'invoices', invoiceId), {
    status: isPartial ? invoice.status : 'Devolución',
    returnDetails: returnDetailsData,
  });
  await batch.commit();
}

// ================================
// PROCESS EXCHANGE (CAMBIO DE TALLA / PRODUCTO)
// ================================
export async function processExchange(opts: {
  invoiceId: string;
  invoice: Invoice;
  returnedItems: Array<{ productId: string; variantIndex: number; quantity: number; priceAtSale: number; productName: string; variantLabel: string; branch?: any }>;
  newItems: Array<{ productId: string; variantIndex: number; quantity: number; priceAtSale: number; productName: string; variantLabel: string; branch?: any }>;
  reason: string;
  priceDiff: number;
  priceDiffMethod: string | null;
  newDeliveryCostUsd: number;
  deliveryMethod: string | null;
  currentUser: AppUser;
  products: Product[];
}): Promise<void> {
  const { invoiceId, invoice, returnedItems, newItems, reason, priceDiff, priceDiffMethod, newDeliveryCostUsd, deliveryMethod, currentUser, products } = opts;
  const batch = writeBatch(db);

  // Combinar devueltos (+) y nuevos (-) en un solo pase para evitar que
  // dos batch.update sobre el mismo producto se sobreescriban entre sí
  // (bug que ocurre cuando devuelven y llevan variantes del mismo producto).
  batchApplyStockDeltas(batch, [
    ...returnedItems.map((i) => ({ ...i, delta: +i.quantity })),
    ...newItems.map((i) => ({ ...i, delta: -i.quantity })),
  ], products, invoice.branch || 'store');

  batch.update(doc(db, 'invoices', invoiceId), {
    status: 'Cambio',
    exchangeDetails: {
      date: Timestamp.now(),
      processedBy: `${currentUser.nombre} ${currentUser.apellido}`,
      reason,
      returnedItems,
      newItems,
      priceDiff,
      priceDiffMethod: priceDiff !== 0 ? priceDiffMethod : null,
      newDeliveryCostUsd,
      deliveryMethod: (newDeliveryCostUsd > 0 || deliveryMethod) ? deliveryMethod : null,
    },
  });

  await batch.commit();
}

// ================================
// CANCEL INVOICE
// ================================
// FIX: Uses shared batchRestoreStock, proper typing
export async function cancelInvoice(opts: {
  invoice: Invoice;
  products: Product[];
}): Promise<void> {
  const { invoice, products } = opts;
  const batch = writeBatch(db);

  batchRestoreStock(batch, invoice.items, products, invoice.branch || 'store');
  batch.update(doc(db, 'invoices', invoice.id), { status: 'Cancelado' });
  await batch.commit();
}

// ================================
// APPROVE WEB ORDER
// ================================
export async function approveWebOrder(invoiceId: string): Promise<void> {
  await updateDoc(doc(db, 'invoices', invoiceId), { status: 'Finalizado' });
}

// ================================
// MARK INVOICE AS PAID (MANUAL OVERRIDE)
// ================================
export async function markInvoiceAsPaid(invoiceId: string): Promise<void> {
  await updateDoc(doc(db, 'invoices', invoiceId), { status: 'Finalizado' });
}

// ================================
// ADD ABONO (PARTIAL PAYMENT)
// ================================
export async function addAbono(opts: {
  invoiceId: string;
  invoice: Invoice;
  amount: number;
  methodName: string;
  ref?: string;
  exchangeRate: number;
}): Promise<void> {
  const { invoiceId, amount, methodName, ref: refValue, exchangeRate } = opts;
  const method = PAYMENT_METHODS.find((m) => m.name === methodName);

  let amountVes: number, amountUsd: number;
  if (method && method.currency === 'usd') {
    amountUsd = amount;
    amountVes = amount * exchangeRate;
  } else {
    amountVes = amount;
    amountUsd = amount / exchangeRate;
  }

  const newAbono = {
    amountVes, amountUsd, method: methodName, date: Timestamp.now(),
    ...(refValue ? { ref: refValue } : {}),
  };

  // Use transaction to prevent race conditions with concurrent abonos
  await runTransaction(db, async (transaction) => {
    const invoiceRef = doc(db, 'invoices', invoiceId);
    const invoiceSnap = await transaction.get(invoiceRef);
    if (!invoiceSnap.exists()) throw new Error('Factura no encontrada.');
    
    const invoiceData = invoiceSnap.data();
    const updatedAbonos = [...(invoiceData.abonos || []), newAbono];
    let totalAbonos = updatedAbonos.reduce((acc: number, a: any) => acc + a.amountVes, 0);

    // Include initial payments that aren't "Crédito"
    if (invoiceData.payments && Array.isArray(invoiceData.payments)) {
      totalAbonos += invoiceData.payments.reduce((acc: number, p: any) => {
        if (p.method === 'Crédito') return acc;
        return acc + (p.amountVes || 0);
      }, 0);
    }

    const totalVes = invoiceData.total * (invoiceData.exchangeRate || 1);
    let newStatus = invoiceData.status;
    if (totalAbonos >= totalVes - 0.01) newStatus = 'Finalizado';

    transaction.update(invoiceRef, {
      abonos: updatedAbonos,
      status: newStatus,
    });
  });
}

// ================================
// ================================
// UPDATE INVOICE CUSTOMER DATA + OBSERVATION
// Edita los datos del cliente snapshot y la observación de una factura
// existente. Útil cuando se cargó mal el RIF/dirección/teléfono al
// momento de facturar y se quiere corregir post-venta sin tener que
// anular la factura. NO toca el cliente original (clients/{id}); solo
// el snapshot embebido en la factura. Si el cajero también quiere
// actualizar el registro maestro del cliente, se hace por separado.
// ================================
export async function updateInvoiceCustomerData(
  invoiceId: string,
  patch: {
    clientSnapshot?: Partial<ClientSnapshot> | null;
    observation?: string | null;
  }
): Promise<void> {
  const updates: Record<string, any> = {};
  if (patch.clientSnapshot !== undefined) {
    updates.clientSnapshot = patch.clientSnapshot;
  }
  if (patch.observation !== undefined) {
    updates.observation = patch.observation;
  }
  if (Object.keys(updates).length === 0) return;
  await updateDoc(doc(db, 'invoices', invoiceId), updates);
}

// ================================
// CONFIRM DELIVERY PAYMENT
// ================================
export async function confirmDeliveryPayment(invoiceId: string, currentStatus?: string): Promise<void> {
  const updates: Record<string, any> = { deliveryPaidInStore: true };
  if (currentStatus === 'Pendiente de pago') {
    updates.status = 'Finalizado';
  }
  await updateDoc(doc(db, 'invoices', invoiceId), updates);
}

// ================================
// UPDATE PAYMENT REF
// ================================
/**
 * Actualiza la referencia (ref) de un pago específico de una factura.
 * Útil cuando el cajero olvidó cargar el N° de Pago Móvil al facturar
 * y lo agrega después desde el panel de Facturas.
 *
 * Cómo identificamos el pago: por su INDEX dentro del array payments.
 * Una factura puede tener varios pagos (mezcla de métodos), por eso
 * no alcanza con method+amount como identificador.
 *
 * Solo se permite actualizar pagos cuyo método tenga hasRef=true
 * (Pago Móvil, Zelle, Binance, etc.). Para efectivo el ref no aplica.
 */
export async function updatePaymentRef(
  invoiceId: string,
  paymentIndex: number,
  newRef: string,
): Promise<void> {
  const ref = doc(db, 'invoices', invoiceId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Factura no encontrada.');
  const inv = snap.data() as any;
  const payments = Array.isArray(inv.payments) ? [...inv.payments] : [];
  if (!payments[paymentIndex]) throw new Error('Pago no encontrado.');

  // Validar que el método del pago acepte ref
  const methodName = payments[paymentIndex].method;
  const methodConfig = PAYMENT_METHODS.find((m) => m.name === methodName);
  if (methodConfig && (methodConfig as any).hasRef === false) {
    throw new Error(`El método "${methodName}" no requiere referencia.`);
  }

  // Reemplazar inmutable
  payments[paymentIndex] = { ...payments[paymentIndex], ref: newRef.trim() || undefined };
  await updateDoc(ref, { payments });
}

// ================================
// FETCH INVOICES BY DATE RANGE (no limit — for export/reports)
// ================================
export async function fetchInvoicesByDateRange(
  startDate: string,
  endDate: string,
): Promise<Invoice[]> {
  const { getDocs, query: q, where, orderBy: ob, collection: col, Timestamp: Ts } = await import('firebase/firestore');

  const start = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T23:59:59.999');

  try {
    // where clauses MUST come before orderBy in Firestore v9+
    const invoicesQuery = q(
      col(db, 'invoices'),
      where('date', '>=', Ts.fromDate(start)),
      where('date', '<=', Ts.fromDate(end)),
      ob('date', 'desc'),
    );

    const snap = await getDocs(invoicesQuery);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Invoice[];
  } catch (err: any) {
    // If index is missing, Firestore throws with a link to create it
    console.error('fetchInvoicesByDateRange error:', err);
    if (err?.message?.includes('index')) {
      throw new Error('Se requiere un índice en Firestore. Revisa la consola del navegador para el link.');
    }
    throw err;
  }
}

// ================================
// UPDATE EXCHANGE RATE
// ================================
export async function updateExchangeRate(newRate: number, userName?: string): Promise<void> {
  const { collection: col, Timestamp: Ts, writeBatch } = await import('firebase/firestore');
  const { getAuth } = await import('firebase/auth');
  
  // Get previous rate
  const prev = await getDoc(doc(db, 'config', 'exchangeRate'));
  const prevRate = prev.exists() ? prev.data().value : null;

  // ATOMIC: Update rate + log history in one batch
  const batch = writeBatch(db);
  const auth = getAuth();

  batch.set(doc(db, 'config', 'exchangeRate'), { 
    value: newRate,
    source: 'manual',
    updatedAt: Ts.now(),
  }, { merge: true });

  const historyRef = doc(col(db, 'exchangeRateHistory'));
  batch.set(historyRef, {
    previousRate: prevRate,
    newRate: newRate,
    change: prevRate ? newRate - prevRate : 0,
    source: 'manual',
    method: 'manual',
    updatedBy: auth.currentUser?.uid || 'unknown',
    userName: userName || 'POS',
    timestamp: Ts.now(),
  });

  await batch.commit();
}

// ================================
// EXCHANGE RATE HISTORY
// ================================
export async function fetchExchangeRateHistory(limitNum = 30): Promise<any[]> {
  const { getDocs, query: q, orderBy: ob, limit: lim, collection: col } = await import('firebase/firestore');
  const snap = await getDocs(
    q(col(db, 'exchangeRateHistory'), ob('timestamp', 'desc'), lim(limitNum))
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// ================================
// FETCH INVOICE BY NUMERIC ID
// ================================
export async function fetchInvoiceByNumericId(numericId: number): Promise<any | null> {
  const { getDocs, query: q, where, collection: col } = await import('firebase/firestore');
  const snap = await getDocs(
    q(col(db, 'invoices'), where('numericId', '==', numericId))
  );
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}

// ================================
// UPDATE INVOICE STATUS (flujo de preparación)
// ================================
/**
 * Cambia el estado de una factura sin tocar nada más. Se usa para el
 * flujo manual 'Por Preparar' → 'Preparado' → 'Finalizado' que el
 * vendedor avanza desde el panel de Facturas. No mueve stock ni pagos:
 * solo actualiza el campo status del documento.
 */
export async function updateInvoiceStatus(
  invoiceId: string,
  newStatus: import('@/types').InvoiceStatus,
): Promise<void> {
  if (!invoiceId) throw new Error('Falta el id de la factura.');
  await updateDoc(doc(db, 'invoices', invoiceId), { status: newStatus });
}

