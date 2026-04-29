import { doc, type WriteBatch } from 'firebase/firestore';
import { db } from '@/config/firebase';
import type { Product, Branch } from '@/types';

/**
 * Helper interno: aplica un delta a stockStore o stockWarehouse según
 * branch, y recalcula el agregado `stock`.
 */
function applyStockDelta(
  variant: any,
  branch: Branch,
  delta: number,
): void {
  if (branch === 'store') {
    variant.stockStore = (variant.stockStore ?? 0) + delta;
  } else {
    variant.stockWarehouse = (variant.stockWarehouse ?? 0) + delta;
  }
  variant.stock = (variant.stockStore ?? 0) + (variant.stockWarehouse ?? 0) + (variant.stockInTransit ?? 0);
}

/**
 * Batch-restore stock for all items in an invoice.
 * Used by both processReturn and cancelInvoice.
 * Mutations are added to the provided batch (not committed here).
 *
 * El stock se devuelve a la sucursal de la que salió (item.branch o
 * fallback a defaultBranch — típicamente invoice.branch o 'store'
 * para facturas viejas).
 */
export function batchRestoreStock(
  batch: WriteBatch,
  items: Array<{ productId: string; variantIndex: number; quantity: number; branch?: Branch }>,
  products: Product[],
  defaultBranch: Branch = 'store',
): void {
  const productUpdates: Record<string, Product['variants']> = {};

  items.forEach((item) => {
    const product = products.find((p) => p.id === item.productId);
    if (!product) return;
    if (!productUpdates[item.productId]) {
      productUpdates[item.productId] = JSON.parse(JSON.stringify(product.variants));
    }
    const variant = productUpdates[item.productId][item.variantIndex];
    if (variant) {
      const branch = item.branch || defaultBranch;
      applyStockDelta(variant, branch, +item.quantity);
    }
  });

  for (const productId in productUpdates) {
    batch.update(doc(db, 'products', productId), { variants: productUpdates[productId] });
  }
}

/**
 * Validate that all items have sufficient stock before processing a sale.
 * Returns null if valid, or an error message string if not.
 * If allowNegative is true, skips stock validation (allows negative stock).
 *
 * La validación se hace contra el stock de la sucursal `branch`. Si no
 * se pasa branch, usa el agregado total para mantener compatibilidad
 * con código viejo que aún no envía sucursal.
 */
export function validateStock(
  items: Array<{ productId: string; variantIndex: number; quantity: number }>,
  products: Product[],
  allowNegative = false,
  branch?: Branch,
): string | null {
  for (const item of items) {
    const product = products.find((p) => p.id === item.productId);
    if (!product) return `Producto no encontrado (ID: ${item.productId})`;
    const variant = product.variants[item.variantIndex];
    if (!variant) return `Variante no encontrada para "${product.name}"`;
    if (allowNegative) continue;

    const available = branch === 'store'
      ? (variant.stockStore ?? 0)
      : branch === 'warehouse'
        ? (variant.stockWarehouse ?? 0)
        : variant.stock; // sin branch → comportamiento legacy

    if (available < item.quantity) {
      const where = branch === 'store' ? ' en tienda' : branch === 'warehouse' ? ' en almacén' : '';
      return `Stock insuficiente${where} para "${product.name}" (${variant.size}/${variant.color}): disponible ${available}, solicitado ${item.quantity}`;
    }
  }
  return null;
}
