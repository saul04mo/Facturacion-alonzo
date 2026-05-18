/**
 * Migración one-shot: backfill de `priceAtSale` en facturas viejas.
 *
 * Contexto:
 *   En algún momento del histórico del POS se agregó el snapshot de
 *   priceAtSale / productName / variantLabel en cada item de cada
 *   factura (ver el comentario "FIX: Stores priceAtSale, productName,
 *   variantLabel per item." en invoiceService.processSale). Pero las
 *   facturas creadas ANTES de ese fix no tienen esos campos, así que
 *   los reportes que calculan ventas por item (especialmente el panel
 *   de Publicidad) las contaban como $0 → días enteros aparecían
 *   vacíos.
 *
 *   Esta función recorre TODAS las facturas, identifica los items sin
 *   priceAtSale, y los enriquece usando el precio actual del producto
 *   en el catálogo + el nombre y la variante actuales. No es perfecto
 *   (si el producto cambió de precio desde la venta, el reporte usará
 *   el precio nuevo), pero es muchísimo mejor que contar como cero.
 *
 *   Una vez ejecutada esta migración, todos los cálculos futuros van a
 *   tener data completa. La migración es idempotente: si la corrés dos
 *   veces, la segunda no toca nada (porque ya está todo backfilled).
 *
 * Costos:
 *   - 1 read por cada factura (para chequear si necesita migración)
 *   - 1 write por cada factura que se modifica
 *   - Operaciones agrupadas en batches de 450 (límite Firestore: 500)
 *
 * Permisos:
 *   La regla `allow update: if isAuth()` en invoices permite esta
 *   migración sin necesidad de ajustes.
 */

import {
  collection,
  doc,
  getDocs,
  writeBatch,
} from 'firebase/firestore';
import { db } from '@/config/firebase';
import type { Product } from '@/types';

export interface MigrationProgress {
  total: number;
  processed: number;
  invoicesUpdated: number;
  itemsBackfilled: number;
  itemsAlreadyOk: number;
  itemsMissingProduct: number;
  itemsMissingVariant: number;
}

const EMPTY_STATS: MigrationProgress = {
  total: 0,
  processed: 0,
  invoicesUpdated: 0,
  itemsBackfilled: 0,
  itemsAlreadyOk: 0,
  itemsMissingProduct: 0,
  itemsMissingVariant: 0,
};

/**
 * Ejecuta el backfill. Llama a `onProgress` cada ~10 facturas para que
 * el UI muestre el avance en tiempo real.
 */
export async function migratePriceAtSale(
  products: Product[],
  onProgress?: (p: MigrationProgress) => void,
): Promise<MigrationProgress> {
  // Index productos por id para lookup O(1)
  const productById = new Map<string, Product>();
  for (const p of products) productById.set(p.id, p);

  const stats: MigrationProgress = { ...EMPTY_STATS };

  // Traer TODAS las invoices. Para tiendas con miles de facturas esto
  // puede tardar; pero es una operación one-shot.
  const snap = await getDocs(collection(db, 'invoices'));
  stats.total = snap.size;
  onProgress?.({ ...stats });

  // Batch writer — Firestore limita a 500 ops por batch, usamos 450 para
  // dejar margen.
  let batch = writeBatch(db);
  let batchOps = 0;
  const BATCH_LIMIT = 450;

  for (const docSnap of snap.docs) {
    stats.processed++;
    const inv = docSnap.data();

    if (!Array.isArray(inv.items) || inv.items.length === 0) {
      // Sin items = nada que migrar
      continue;
    }

    // Verificar si TODOS los items ya tienen priceAtSale (idempotencia)
    const allHavePrice = inv.items.every(
      (it: any) => typeof it.priceAtSale === 'number' && Number.isFinite(it.priceAtSale),
    );
    if (allHavePrice) {
      stats.itemsAlreadyOk += inv.items.length;
      continue;
    }

    // Construir items enriquecidos
    let modified = false;
    const newItems = inv.items.map((item: any) => {
      // Item ya tiene priceAtSale válido — no tocar
      if (typeof item.priceAtSale === 'number' && Number.isFinite(item.priceAtSale)) {
        stats.itemsAlreadyOk++;
        return item;
      }

      const product = productById.get(item.productId);
      if (!product) {
        // Producto eliminado del catálogo — no podemos recuperar el precio.
        // Marcamos con 0 para que al menos el campo exista. Los reportes
        // van a seguir descartando esos items pero al menos no van a
        // crashear con undefined.
        stats.itemsMissingProduct++;
        modified = true;
        return { ...item, priceAtSale: 0 };
      }

      const variants: any[] = (product as any).variants || [];
      const variant = variants[item.variantIndex];
      if (!variant) {
        // El producto existe pero la variante ya no — pasa cuando se
        // editan los talles/colores de un producto y los índices se
        // corren.
        stats.itemsMissingVariant++;
        modified = true;
        const enriched: any = { ...item, priceAtSale: 0 };
        if (!item.productName && product.name) enriched.productName = product.name;
        return enriched;
      }

      const price = Number(variant.price) || 0;
      const enriched: any = { ...item, priceAtSale: price };

      // De paso completamos productName y variantLabel si faltan —
      // son útiles para que el modal de detalle de la factura muestre
      // bien el nombre del producto incluso si después se elimina del
      // catálogo.
      if (!item.productName && product.name) {
        enriched.productName = product.name;
      }
      if (!item.variantLabel) {
        const size = variant.size || 'N/A';
        const color = variant.color || 'N/A';
        enriched.variantLabel = `${size} / ${color}`;
      }

      stats.itemsBackfilled++;
      modified = true;
      return enriched;
    });

    if (modified) {
      batch.update(doc(db, 'invoices', docSnap.id), { items: newItems });
      batchOps++;
      stats.invoicesUpdated++;

      // Commit del batch si alcanzamos el límite
      if (batchOps >= BATCH_LIMIT) {
        await batch.commit();
        batch = writeBatch(db);
        batchOps = 0;
      }
    }

    // Update de progreso cada 10 facturas o al terminar
    if (stats.processed % 10 === 0 || stats.processed === stats.total) {
      onProgress?.({ ...stats });
    }
  }

  // Commit del último batch (si quedaron ops pendientes)
  if (batchOps > 0) {
    await batch.commit();
  }

  onProgress?.({ ...stats });
  return stats;
}
