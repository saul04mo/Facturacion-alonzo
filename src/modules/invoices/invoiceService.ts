import {
  collection, doc, runTransaction, updateDoc, Timestamp, writeBatch,
} from 'firebase/firestore';
import { db } from '@/config/firebase';
import { batchRestoreStock, validateStock } from '@/utils/stockUtils';
import type { CurrentSale, AppUser, Product, Invoice, ClientSnapshot } from '@/types';

// ================================
// PAYMENT METHODS CONFIG
// ================================
export const PAYMENT_METHODS = [
  { id: 'pago-movil', name: 'Pago movil', currency: 'ves' as const, hasRef: true },
  { id: 'punto-debito', name: 'Punto de venta (Débito)', currency: 'ves' as const },
  { id: 'efectivo-bs', name: 'Efectivo (Bs)', currency: 'ves' as const },
  { id: 'efectivo-usd', name: 'Efectivo ($)', currency: 'usd' as const },
  { id: 'zelle', name: 'Zelle', currency: 'usd' as const },
  { id: 'zinli', name: 'Zinli', currency: 'usd' as const },
  { id: 'binance', name: 'Binance', currency: 'usd' as const },
  { id: 'paypal', name: 'Paypal', currency: 'usd' as const },
  { id: 'credito', name: 'Crédito', currency: 'none' as const },
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
}): Promise<{ numericId: number }> {
  const { sale, payments, exchangeRate, currentUser, products, clients } = opts;
  const isCreditSale = !sale.deliveryPaidInStore;

  // ── Pre-validation ──
  const stockError = validateStock(sale.items, products);
  if (stockError) throw new Error(stockError);

  // ── Build item snapshots with priceAtSale ──
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
    };
  });

  // ── Client snapshot ──
  const clientObj = sale.clientId
    ? clients.find((c) => c.id === sale.clientId) || null
    : null;
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

    // 2. Deduct stock (inside the same transaction)
    const productUpdates: Record<string, any[]> = {};
    sale.items.forEach((item) => {
      if (!productUpdates[item.productId]) {
        const product = products.find((p) => p.id === item.productId)!;
        productUpdates[item.productId] = JSON.parse(JSON.stringify(product.variants));
      }
      const variant = productUpdates[item.productId][item.variantIndex];
      if (variant) variant.stock -= item.quantity;
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
      status: isCreditSale ? 'Pendiente de pago' : 'Finalizado',
      abonos: [],
      sellerName: `${currentUser.nombre} ${currentUser.apellido}`,
      sellerUid: currentUser.uid,
      deliveryType: sale.deliveryType,
      deliveryCostUsd: sale.deliveryCostUsd,
      deliveryPaidInStore: sale.deliveryPaidInStore,
      observation: sale.observation || null,
    };

    const newInvoiceRef = doc(collection(db, 'invoices'));
    transaction.set(newInvoiceRef, newInvoice);

    return nextId;
  });

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

  const itemsToRestore = returnItems || invoice.items.map((i) => ({
    productId: i.productId,
    variantIndex: i.variantIndex,
    quantity: i.quantity,
  }));

  // Restore stock (unless product is damaged)
  if (reason !== 'Producto Dañado (Merma)') {
    batchRestoreStock(batch, itemsToRestore, products);
  }

  const isPartial = returnItems && returnItems.length < invoice.items.length;

  batch.update(doc(db, 'invoices', invoiceId), {
    status: isPartial ? invoice.status : 'Devolución',
    returnDetails: {
      reason,
      details: details || null,
      date: Timestamp.now(),
      processedBy: `${currentUser.nombre} ${currentUser.apellido}`,
      partial: isPartial || false,
      returnedItems: isPartial ? returnItems : undefined,
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

  batchRestoreStock(batch, invoice.items, products);
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
  const { invoiceId, invoice, amount, methodName, ref: refValue, exchangeRate } = opts;
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

  const updatedAbonos = [...(invoice.abonos || []), newAbono];
  let totalAbonos = updatedAbonos.reduce((acc, a) => acc + a.amountVes, 0);

  // Include initial payments that aren't "Crédito"
  if (invoice.payments && Array.isArray(invoice.payments)) {
    totalAbonos += invoice.payments.reduce((acc, p) => {
      if (p.method === 'Crédito') return acc;
      return acc + (p.amountVes || 0);
    }, 0);
  }

  const totalVes = invoice.total * (invoice.exchangeRate || 1);

  let newStatus = invoice.status;
  if (totalAbonos >= totalVes - 0.01) newStatus = 'Finalizado';

  await updateDoc(doc(db, 'invoices', invoiceId), {
    abonos: updatedAbonos,
    status: newStatus,
  });
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
// FETCH INVOICES BY DATE RANGE (no limit — for export/reports)
// ================================
export async function fetchInvoicesByDateRange(
  startDate: string,
  endDate: string,
): Promise<Invoice[]> {
  const { getDocs, query: q, where, orderBy: ob, collection: col, Timestamp: Ts } = await import('firebase/firestore');

  const start = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T23:59:59.999');

  const invoicesQuery = q(
    col(db, 'invoices'),
    ob('date', 'desc'),
    where('date', '>=', Ts.fromDate(start)),
    where('date', '<=', Ts.fromDate(end)),
  );

  const snap = await getDocs(invoicesQuery);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Invoice[];
}

// ================================
// UPDATE EXCHANGE RATE
// ================================
export async function updateExchangeRate(newRate: number): Promise<void> {
  const { setDoc } = await import('firebase/firestore');
  await setDoc(doc(db, 'config', 'exchangeRate'), { value: newRate }, { merge: true });
}
