import { doc, type WriteBatch } from 'firebase/firestore';
import { db } from '@/config/firebase';
import type { Product } from '@/types';

/**
 * Batch-restore stock for all items in an invoice.
 * Used by both processReturn and cancelInvoice.
 * Mutations are added to the provided batch (not committed here).
 */
export function batchRestoreStock(
  batch: WriteBatch,
  items: Array<{ productId: string; variantIndex: number; quantity: number }>,
  products: Product[],
): void {
  const productUpdates: Record<string, Product['variants']> = {};

  items.forEach((item) => {
    const product = products.find((p) => p.id === item.productId);
    if (!product) return;
    if (!productUpdates[item.productId]) {
      productUpdates[item.productId] = JSON.parse(JSON.stringify(product.variants));
    }
    const variant = productUpdates[item.productId][item.variantIndex];
    if (variant) variant.stock += item.quantity;
  });

  for (const productId in productUpdates) {
    batch.update(doc(db, 'products', productId), { variants: productUpdates[productId] });
  }
}

/**
 * Validate that all items have sufficient stock before processing a sale.
 * Returns null if valid, or an error message string if not.
 */
export function validateStock(
  items: Array<{ productId: string; variantIndex: number; quantity: number }>,
  products: Product[],
): string | null {
  for (const item of items) {
    const product = products.find((p) => p.id === item.productId);
    if (!product) return `Producto no encontrado (ID: ${item.productId})`;
    const variant = product.variants[item.variantIndex];
    if (!variant) return `Variante no encontrada para "${product.name}"`;
    if (variant.stock < item.quantity) {
      return `Stock insuficiente para "${product.name}" (${variant.size}/${variant.color}): disponible ${variant.stock}, solicitado ${item.quantity}`;
    }
  }
  return null;
}
