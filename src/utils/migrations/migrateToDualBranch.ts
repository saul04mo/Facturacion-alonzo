/**
 * MIGRACIÓN A INVENTARIO DUAL (Tienda + Almacén)
 *
 * Este script lee todos los productos en Firestore y los migra al nuevo
 * modelo:
 *   - El stock actual pasa a `stockStore` (asumimos que toda la mercancía
 *     existente está en la tienda hasta que el usuario la transfiera)
 *   - `stockWarehouse` arranca en 0
 *   - `stockInTransit` arranca en 0
 *   - El campo legacy `stock` se mantiene = stockStore para compatibilidad
 *
 * También migra las facturas existentes asignándoles branch='store'.
 *
 * Es IDEMPOTENTE: si ya migraste un producto, detecta los campos nuevos
 * y lo saltea. Podés correrlo varias veces sin riesgo.
 *
 * USO: importar desde un componente admin temporal con un botón
 *   import { migrateToDualBranch } from '@/utils/migrations/migrateToDualBranch';
 *   await migrateToDualBranch();
 */

import { collection, getDocs, doc, writeBatch } from 'firebase/firestore';
import { db } from '@/config/firebase';

interface MigrationResult {
  productsScanned: number;
  productsMigrated: number;
  productsSkipped: number;
  invoicesScanned: number;
  invoicesMigrated: number;
  invoicesSkipped: number;
  errors: string[];
}

export async function migrateToDualBranch(
  onProgress?: (msg: string) => void
): Promise<MigrationResult> {
  const result: MigrationResult = {
    productsScanned: 0,
    productsMigrated: 0,
    productsSkipped: 0,
    invoicesScanned: 0,
    invoicesMigrated: 0,
    invoicesSkipped: 0,
    errors: [],
  };

  const log = (msg: string) => {
    console.log('[migrateToDualBranch]', msg);
    onProgress?.(msg);
  };

  // ================================
  // PRODUCTS
  // ================================
  log('Leyendo productos...');
  try {
    const productsSnap = await getDocs(collection(db, 'products'));
    result.productsScanned = productsSnap.size;
    log(`Productos a evaluar: ${productsSnap.size}`);

    // Firestore batch máximo 500 ops. Como cada producto es 1 op,
    // procesamos en chunks de 400 para tener margen.
    const docs = productsSnap.docs;
    const CHUNK_SIZE = 400;

    for (let i = 0; i < docs.length; i += CHUNK_SIZE) {
      const chunk = docs.slice(i, i + CHUNK_SIZE);
      const batch = writeBatch(db);
      let ops = 0;

      for (const productDoc of chunk) {
        const data = productDoc.data() as any;
        const variants = data.variants || [];

        // Detectar si ya fue migrado: si CUALQUIER variante tiene
        // stockStore o stockWarehouse definidos, asumimos migrado.
        const alreadyMigrated = variants.some(
          (v: any) => v.stockStore !== undefined || v.stockWarehouse !== undefined
        );
        if (alreadyMigrated) {
          result.productsSkipped++;
          continue;
        }

        const newVariants = variants.map((v: any) => ({
          ...v,
          stockStore: v.stock || 0,
          stockWarehouse: 0,
          stockInTransit: 0,
          // stock se mantiene = stockStore para compatibilidad
          stock: v.stock || 0,
        }));

        batch.update(doc(db, 'products', productDoc.id), {
          variants: newVariants,
        });
        ops++;
        result.productsMigrated++;
      }

      if (ops > 0) {
        log(`Commiteando lote de ${ops} productos (${i + ops}/${docs.length})...`);
        await batch.commit();
      }
    }
  } catch (e: any) {
    const msg = `Error migrando productos: ${e?.message || e}`;
    log(msg);
    result.errors.push(msg);
  }

  // ================================
  // INVOICES
  // ================================
  log('Leyendo facturas...');
  try {
    const invoicesSnap = await getDocs(collection(db, 'invoices'));
    result.invoicesScanned = invoicesSnap.size;
    log(`Facturas a evaluar: ${invoicesSnap.size}`);

    const docs = invoicesSnap.docs;
    const CHUNK_SIZE = 400;

    for (let i = 0; i < docs.length; i += CHUNK_SIZE) {
      const chunk = docs.slice(i, i + CHUNK_SIZE);
      const batch = writeBatch(db);
      let ops = 0;

      for (const invoiceDoc of chunk) {
        const data = invoiceDoc.data() as any;
        if (data.branch !== undefined) {
          result.invoicesSkipped++;
          continue;
        }
        // Toda factura sin branch se asume tienda (era la única antes)
        batch.update(doc(db, 'invoices', invoiceDoc.id), {
          branch: 'store',
        });
        ops++;
        result.invoicesMigrated++;
      }

      if (ops > 0) {
        log(`Commiteando lote de ${ops} facturas (${i + ops}/${docs.length})...`);
        await batch.commit();
      }
    }
  } catch (e: any) {
    const msg = `Error migrando facturas: ${e?.message || e}`;
    log(msg);
    result.errors.push(msg);
  }

  log('Migración finalizada.');
  log(JSON.stringify(result, null, 2));
  return result;
}
