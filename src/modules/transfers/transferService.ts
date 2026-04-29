/**
 * Servicio para gestionar transferencias de stock entre sucursales.
 *
 * Flujo de estados:
 *   pending → in_transit → received
 *                       \→ cancelled (puede cancelarse antes de in_transit)
 *
 * Operaciones de stock por estado:
 *
 *   createTransfer (pending):
 *     No mueve stock. Solo registra la intención.
 *
 *   shipTransfer (pending → in_transit):
 *     stockWarehouse -= cantidad
 *     stockInTransit += cantidad
 *     (es como sacar el stock del estante del almacén pero todavía
 *     no entró a tienda — está en el camión, en el medio)
 *
 *   receiveTransfer (in_transit → received):
 *     stockInTransit -= cantidad enviada
 *     stockStore += cantidad recibida (puede ser != enviada si hubo
 *                                       rotura/extravío en el camino)
 *     Si hay diferencia, queda registrada en quantityReceived !=
 *     quantitySent. La diferencia (sent - received) se pierde — no
 *     vuelve al almacén porque ya salió y no llegó (mermas).
 *
 *   cancelTransfer (pending o in_transit → cancelled):
 *     Si estaba en pending: no mueve nada (no había salido del almacén).
 *     Si estaba en in_transit: stockInTransit -= cantidad y
 *                              stockWarehouse += cantidad (regresa al almacén).
 *
 * Todas las mutaciones de stock se hacen dentro de runTransaction para
 * garantizar atomicidad: o se actualizan TODOS los productos + el
 * documento de transfer, o no se actualiza nada.
 */

import {
  collection,
  doc,
  getDocs,
  query,
  orderBy,
  runTransaction,
  Timestamp,
  type DocumentData,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '@/config/firebase';
import { compressImage } from '@/utils/imageUtils';
import type {
  InventoryTransfer,
  TransferItem,
  TransferStatus,
  Product,
  AppUser,
} from '@/types';

// ════════════════════════════════════════════════
// LISTAR (con filtros)
// ════════════════════════════════════════════════

export interface ListTransfersOptions {
  status?: TransferStatus | 'all';
}

export async function listTransfers(opts: ListTransfersOptions = {}): Promise<InventoryTransfer[]> {
  const { status = 'all' } = opts;
  // Por simplicidad ordenamos en cliente (la colección no debería ser
  // gigante — habrá decenas o cientos por mes, no miles). Si crece
  // se puede paginar en server con orderBy('createdAt', 'desc') y limit.
  const snap = await getDocs(query(collection(db, 'inventoryTransfers'), orderBy('createdAt', 'desc')));
  let results: InventoryTransfer[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as DocumentData) } as InventoryTransfer));
  if (status !== 'all') {
    results = results.filter((t) => t.status === status);
  }
  return results;
}

// ════════════════════════════════════════════════
// CREAR (status = pending, no mueve stock)
// ════════════════════════════════════════════════

interface CreateTransferOptions {
  items: Array<{
    productId: string;
    productName: string;
    size: string;
    color: string;
    quantitySent: number;
  }>;
  proofFile?: File | null;
  observation?: string;
  currentUser: AppUser;
}

export async function createTransfer(opts: CreateTransferOptions): Promise<{ id: string; numericId: number }> {
  const { items, proofFile, observation, currentUser } = opts;

  if (items.length === 0) {
    throw new Error('La transferencia debe tener al menos un producto.');
  }
  if (items.some((i) => i.quantitySent <= 0)) {
    throw new Error('Todas las cantidades deben ser mayores que cero.');
  }

  // 1. Subir foto del despacho (si hay) — fuera de la transacción
  // porque las operaciones de Storage no pueden ir dentro.
  let proofUrl: string | undefined;
  if (proofFile) {
    const compressed = await compressImage(proofFile);
    const proofRef = ref(storage, `transfers/${Date.now()}_${compressed.name}`);
    const snapshot = await uploadBytes(proofRef, compressed);
    proofUrl = await getDownloadURL(snapshot.ref);
  }

  // 2. Atomic: counter + create
  const id = await runTransaction(db, async (tx) => {
    const counterRef = doc(db, 'config', 'transferCounter');
    const counterDoc = await tx.get(counterRef);
    const currentId = counterDoc.exists() ? (counterDoc.data().lastNumericId || 0) : 0;
    const nextId = currentId + 1;
    tx.set(counterRef, { lastNumericId: nextId }, { merge: true });

    const transferRef = doc(collection(db, 'inventoryTransfers'));
    const transferDoc: Omit<InventoryTransfer, 'id'> = {
      numericId: nextId,
      from: 'warehouse',
      to: 'store',
      status: 'pending',
      items: items.map((i): TransferItem => ({
        productId: i.productId,
        productName: i.productName,
        size: i.size,
        color: i.color,
        quantitySent: i.quantitySent,
      })),
      ...(proofUrl ? { proofUrl } : {}),
      ...(observation ? { observation } : {}),
      createdBy: currentUser.uid,
      createdByName: `${currentUser.nombre} ${currentUser.apellido}`,
      createdAt: Timestamp.now(),
    };
    tx.set(transferRef, transferDoc);

    return { id: transferRef.id, numericId: nextId };
  });

  return id;
}

// ════════════════════════════════════════════════
// ENVIAR (pending → in_transit)
// stockWarehouse -= qty, stockInTransit += qty
// ════════════════════════════════════════════════

interface ShipTransferOptions {
  transferId: string;
  products: Product[];
  currentUser: AppUser;
}

export async function shipTransfer(opts: ShipTransferOptions): Promise<void> {
  const { transferId, products, currentUser } = opts;

  await runTransaction(db, async (tx) => {
    const transferRef = doc(db, 'inventoryTransfers', transferId);
    const transferSnap = await tx.get(transferRef);
    if (!transferSnap.exists()) throw new Error('Transferencia no encontrada.');

    const transfer = transferSnap.data() as InventoryTransfer;
    if (transfer.status !== 'pending') {
      throw new Error(`No se puede enviar: la transferencia está en estado "${transfer.status}".`);
    }

    // Group items by product for one update per product
    const productUpdates: Record<string, any[]> = {};
    for (const item of transfer.items) {
      if (!productUpdates[item.productId]) {
        const product = products.find((p) => p.id === item.productId);
        if (!product) throw new Error(`Producto no encontrado: ${item.productName}`);
        productUpdates[item.productId] = JSON.parse(JSON.stringify(product.variants));
      }
      const variants = productUpdates[item.productId];
      const variantIndex = variants.findIndex(
        (v: any) => v.size === item.size && v.color === item.color,
      );
      if (variantIndex === -1) {
        throw new Error(`Variante no encontrada: ${item.productName} ${item.size}/${item.color}`);
      }
      const variant = variants[variantIndex];
      const available = variant.stockWarehouse ?? 0;
      if (available < item.quantitySent) {
        throw new Error(
          `Stock insuficiente en almacén para "${item.productName}" ${item.size}/${item.color}: disponible ${available}, solicitado ${item.quantitySent}`,
        );
      }
      variant.stockWarehouse = available - item.quantitySent;
      variant.stockInTransit = (variant.stockInTransit ?? 0) + item.quantitySent;
      // Recalc agregado (legacy)
      variant.stock =
        (variant.stockStore ?? 0) + (variant.stockWarehouse ?? 0) + (variant.stockInTransit ?? 0);
    }

    for (const productId in productUpdates) {
      tx.update(doc(db, 'products', productId), { variants: productUpdates[productId] });
    }

    tx.update(transferRef, {
      status: 'in_transit' as TransferStatus,
      shippedBy: currentUser.uid,
      shippedByName: `${currentUser.nombre} ${currentUser.apellido}`,
      shippedAt: Timestamp.now(),
    });
  });
}

// ════════════════════════════════════════════════
// RECIBIR (in_transit → received)
// stockInTransit -= qtySent, stockStore += qtyReceived
// ════════════════════════════════════════════════

interface ReceiveTransferOptions {
  transferId: string;
  products: Product[];
  currentUser: AppUser;
  /**
   * Cantidades efectivamente recibidas (key = índice del item).
   * Si no se pasa ningún override, se asume que se recibió todo lo enviado.
   */
  receivedQuantities?: Record<number, number>;
}

export async function receiveTransfer(opts: ReceiveTransferOptions): Promise<void> {
  const { transferId, products, currentUser, receivedQuantities = {} } = opts;

  await runTransaction(db, async (tx) => {
    const transferRef = doc(db, 'inventoryTransfers', transferId);
    const transferSnap = await tx.get(transferRef);
    if (!transferSnap.exists()) throw new Error('Transferencia no encontrada.');

    const transfer = transferSnap.data() as InventoryTransfer;
    if (transfer.status !== 'in_transit') {
      throw new Error(`No se puede recibir: la transferencia está en estado "${transfer.status}".`);
    }

    const updatedItems: TransferItem[] = transfer.items.map((item, idx) => {
      const received = receivedQuantities[idx] ?? item.quantitySent;
      if (received < 0) throw new Error(`La cantidad recibida no puede ser negativa.`);
      if (received > item.quantitySent) {
        throw new Error(
          `No se puede recibir más de lo enviado para ${item.productName} ${item.size}/${item.color} (enviado: ${item.quantitySent}, intentando recibir: ${received}).`,
        );
      }
      return { ...item, quantityReceived: received };
    });

    const productUpdates: Record<string, any[]> = {};
    for (let idx = 0; idx < transfer.items.length; idx++) {
      const item = transfer.items[idx];
      const received = updatedItems[idx].quantityReceived ?? 0;
      if (!productUpdates[item.productId]) {
        const product = products.find((p) => p.id === item.productId);
        if (!product) throw new Error(`Producto no encontrado: ${item.productName}`);
        productUpdates[item.productId] = JSON.parse(JSON.stringify(product.variants));
      }
      const variants = productUpdates[item.productId];
      const variantIndex = variants.findIndex(
        (v: any) => v.size === item.size && v.color === item.color,
      );
      if (variantIndex === -1) {
        throw new Error(`Variante no encontrada: ${item.productName} ${item.size}/${item.color}`);
      }
      const variant = variants[variantIndex];
      // Sale de in_transit lo enviado original
      variant.stockInTransit = (variant.stockInTransit ?? 0) - item.quantitySent;
      // Entra a tienda lo recibido (puede ser menos por mermas)
      variant.stockStore = (variant.stockStore ?? 0) + received;
      // Recalc agregado
      variant.stock =
        (variant.stockStore ?? 0) + (variant.stockWarehouse ?? 0) + (variant.stockInTransit ?? 0);
    }

    for (const productId in productUpdates) {
      tx.update(doc(db, 'products', productId), { variants: productUpdates[productId] });
    }

    tx.update(transferRef, {
      status: 'received' as TransferStatus,
      items: updatedItems,
      receivedBy: currentUser.uid,
      receivedByName: `${currentUser.nombre} ${currentUser.apellido}`,
      receivedAt: Timestamp.now(),
    });
  });
}

// ════════════════════════════════════════════════
// CANCELAR (pending o in_transit → cancelled)
// ════════════════════════════════════════════════

interface CancelTransferOptions {
  transferId: string;
  products: Product[];
  reason: string;
}

export async function cancelTransfer(opts: CancelTransferOptions): Promise<void> {
  const { transferId, products, reason } = opts;
  if (!reason.trim()) throw new Error('Debe indicar un motivo de cancelación.');

  await runTransaction(db, async (tx) => {
    const transferRef = doc(db, 'inventoryTransfers', transferId);
    const transferSnap = await tx.get(transferRef);
    if (!transferSnap.exists()) throw new Error('Transferencia no encontrada.');

    const transfer = transferSnap.data() as InventoryTransfer;
    if (transfer.status === 'received') {
      throw new Error('No se puede cancelar una transferencia ya recibida.');
    }
    if (transfer.status === 'cancelled') {
      throw new Error('La transferencia ya estaba cancelada.');
    }

    // Si estaba en pending: nada que devolver al stock (no había salido).
    // Si estaba en in_transit: devolver inTransit → warehouse.
    if (transfer.status === 'in_transit') {
      const productUpdates: Record<string, any[]> = {};
      for (const item of transfer.items) {
        if (!productUpdates[item.productId]) {
          const product = products.find((p) => p.id === item.productId);
          if (!product) continue; // Producto eliminado: no podemos devolver, seguimos
          productUpdates[item.productId] = JSON.parse(JSON.stringify(product.variants));
        }
        const variants = productUpdates[item.productId];
        const variantIndex = variants.findIndex(
          (v: any) => v.size === item.size && v.color === item.color,
        );
        if (variantIndex === -1) continue;
        const variant = variants[variantIndex];
        variant.stockInTransit = Math.max(0, (variant.stockInTransit ?? 0) - item.quantitySent);
        variant.stockWarehouse = (variant.stockWarehouse ?? 0) + item.quantitySent;
        variant.stock =
          (variant.stockStore ?? 0) + (variant.stockWarehouse ?? 0) + (variant.stockInTransit ?? 0);
      }
      for (const productId in productUpdates) {
        tx.update(doc(db, 'products', productId), { variants: productUpdates[productId] });
      }
    }

    tx.update(transferRef, {
      status: 'cancelled' as TransferStatus,
      cancelledAt: Timestamp.now(),
      cancelReason: reason.trim(),
    });
  });
}

// ════════════════════════════════════════════════
// MARCAR COMO IMPRESA (única vez por transferencia)
// ════════════════════════════════════════════════

interface MarkPrintedOptions {
  transferId: string;
  currentUser: AppUser;
}

/**
 * Marca una transferencia como impresa. Si ya tiene printedBy seteado,
 * lanza error — la comanda solo se puede imprimir UNA vez por seguridad
 * (queda registrado quién la imprimió y cuándo).
 *
 * Usa runTransaction para garantizar que si dos personas intentan
 * imprimir simultáneamente, solo una gana y la otra recibe el error.
 *
 * Devuelve los datos del print (printedByName + printedAt como Date)
 * para que el cliente los muestre sin tener que hacer otro fetch.
 */
export async function markTransferPrinted(
  opts: MarkPrintedOptions,
): Promise<{ printedByName: string; printedAt: Date }> {
  const { transferId, currentUser } = opts;

  return runTransaction(db, async (tx) => {
    const transferRef = doc(db, 'inventoryTransfers', transferId);
    const snap = await tx.get(transferRef);
    if (!snap.exists()) throw new Error('Transferencia no encontrada.');

    const data = snap.data() as InventoryTransfer;

    // Bloqueo de doble impresión
    if (data.printedBy) {
      const who = data.printedByName || 'usuario desconocido';
      const when = data.printedAt?.toDate
        ? data.printedAt.toDate().toLocaleString('es-VE')
        : 'fecha desconocida';
      throw new Error(`Esta comanda ya fue impresa por ${who} el ${when}. Solo se permite imprimir una vez.`);
    }

    const now = Timestamp.now();
    const printedByName = `${currentUser.nombre} ${currentUser.apellido}`;

    tx.update(transferRef, {
      printedBy: currentUser.uid,
      printedByName,
      printedAt: now,
    });

    return {
      printedByName,
      printedAt: now.toDate(),
    };
  });
}
