/**
 * MIGRACIÓN INVERSA: STOCK INICIAL EN ALMACÉN
 *
 * Contexto: la primera migración (migrateToDualBranch) asumió que todo
 * el stock existente estaba en la tienda física. Resulta que es al revés:
 * todo el stock está realmente en el almacén central, y la tienda arranca
 * en cero hasta que se hagan transferencias.
 *
 * Este script revierte la primera migración:
 *   - stockWarehouse += stockStore  (todo lo que estaba en tienda pasa a almacén)
 *   - stockStore = 0
 *   - stockInTransit se mantiene
 *   - stock (legacy) se recalcula
 *
 * IDEMPOTENCIA: detectamos productos que YA fueron movidos al almacén
 * mirando si stockStore es 0 Y stockWarehouse > 0. En ese caso, saltamos.
 * Esto permite correrlo varias veces sin riesgo.
 *
 * IMPORTANTE: NO toca facturas ni transferencias. Solo el stock de
 * productos. Si alguien ya facturó después de la primera migración con
 * branch=store, esa factura mantiene su branch — pero como aún no
 * implementamos descuento dual de stock al facturar, no hay
 * inconsistencias.
 */

import { collection, getDocs, doc, writeBatch } from 'firebase/firestore';
import { db } from '@/config/firebase';

interface MigrationResult {
  productsScanned: number;
  productsMigrated: number;
  productsSkipped: number;
  unitsMoved: number;
  errors: string[];
}

export async function migrateStockToWarehouse(
  onProgress?: (msg: string) => void
): Promise<MigrationResult> {
  const result: MigrationResult = {
    productsScanned: 0,
    productsMigrated: 0,
    productsSkipped: 0,
    unitsMoved: 0,
    errors: [],
  };

  const log = (msg: string) => {
    console.log('[migrateStockToWarehouse]', msg);
    onProgress?.(msg);
  };

  log('Leyendo productos...');
  try {
    const productsSnap = await getDocs(collection(db, 'products'));
    result.productsScanned = productsSnap.size;
    log(`Productos a evaluar: ${productsSnap.size}`);

    const docs = productsSnap.docs;
    const CHUNK_SIZE = 400;

    for (let i = 0; i < docs.length; i += CHUNK_SIZE) {
      const chunk = docs.slice(i, i + CHUNK_SIZE);
      const batch = writeBatch(db);
      let ops = 0;

      for (const productDoc of chunk) {
        const data = productDoc.data() as any;
        const variants = data.variants || [];

        // Detectar si este producto ya tiene el stock en almacén
        // (todas sus variantes tienen stockStore=0 y al menos una con
        // stockWarehouse>0). Si es así lo saltamos.
        const allStoreEmpty = variants.every((v: any) => (v.stockStore ?? 0) === 0);
        const someWarehouseFilled = variants.some((v: any) => (v.stockWarehouse ?? 0) > 0);
        if (allStoreEmpty && someWarehouseFilled) {
          result.productsSkipped++;
          continue;
        }

        // También saltamos productos sin stock alguno (no hay nada que mover)
        const totalAcrossVariants = variants.reduce((acc: number, v: any) => {
          return acc + (v.stockStore ?? 0) + (v.stockWarehouse ?? 0);
        }, 0);
        if (totalAcrossVariants === 0) {
          result.productsSkipped++;
          continue;
        }

        // Mover stockStore → stockWarehouse en cada variante
        let unitsThisProduct = 0;
        const newVariants = variants.map((v: any) => {
          const moveAmount = v.stockStore ?? 0;
          unitsThisProduct += moveAmount;
          const newWarehouse = (v.stockWarehouse ?? 0) + moveAmount;
          const inTransit = v.stockInTransit ?? 0;
          return {
            ...v,
            stockStore: 0,
            stockWarehouse: newWarehouse,
            stockInTransit: inTransit,
            // Recalcular agregado
            stock: 0 + newWarehouse + inTransit,
          };
        });

        batch.update(doc(db, 'products', productDoc.id), {
          variants: newVariants,
        });
        ops++;
        result.productsMigrated++;
        result.unitsMoved += unitsThisProduct;
      }

      if (ops > 0) {
        log(`Commiteando lote de ${ops} productos (${i + ops}/${docs.length})...`);
        await batch.commit();
      }
    }
  } catch (e: any) {
    const msg = `Error: ${e?.message || e}`;
    log(msg);
    result.errors.push(msg);
  }

  log('Migración finalizada.');
  log(JSON.stringify(result, null, 2));
  return result;
}
