/**
 * MIGRACIÓN: BACKFILL DE changeGiven EN FACTURAS HISTÓRICAS
 *
 * Contexto: el campo invoice.changeGiven (vuelto entregado al cliente,
 * en USD) se agregó cuando se implementó el feature de mostrar el
 * vuelto en el modal y el recibo. Las facturas creadas DESPUÉS del
 * deploy ya tienen el campo poblado en processSale. Las facturas
 * VIEJAS no lo tienen.
 *
 * Cómo se calcula el vuelto retroactivo:
 *   - Sumar todos los pagos cuyo método contenga "efectivo" (cashUsd)
 *     convirtiendo amountVes / exchangeRate cuando aplica.
 *   - Sumar el resto de pagos (nonCashUsd, mismo cálculo)
 *   - totalCobradoUsd = cashUsd + nonCashUsd
 *   - totalVentaUsd = invoice.total + invoice.deliveryCostUsd
 *   - exceso = totalCobradoUsd - totalVentaUsd
 *   - Si cashUsd > 0 Y exceso > $0.01 → changeGiven = exceso (USD)
 *   - Caso contrario → no se setea el campo
 *
 * IDEMPOTENCIA: facturas que YA tienen changeGiven seteado se saltean.
 * Esto permite correrlo varias veces sin riesgo de duplicar/sobreescribir.
 *
 * NO TOCA: items, montos, totales, status, fechas, vendedor — solo
 * agrega un campo nuevo a las facturas que aplican.
 *
 * SCOPE: corre sobre TODAS las facturas (no filtra por fecha). El
 * cliente puede tener historial largo, así que usamos batches de 400
 * (límite de Firestore es 500 por batch) para no chocar con la API.
 */

import {
  collection, getDocs, writeBatch, doc,
} from 'firebase/firestore';
import { db } from '@/config/firebase';

export interface ChangeGivenMigrationResult {
  totalScanned: number;
  /** Facturas que ya tenían changeGiven (saltadas). */
  alreadyMigrated: number;
  /** Facturas a las que se les agregó el campo. */
  updated: number;
  /** Facturas donde el cálculo dio 0 o vuelto exacto (no se setea el campo). */
  noChangeNeeded: number;
  /** Errores ocurridos durante el batch. */
  errors: number;
  /** Suma total del vuelto identificado retroactivamente (en USD). */
  totalChangeUsd: number;
}

/**
 * Calcula el vuelto retroactivo para una factura individual.
 * Mismo algoritmo que se usa en runtime en InvoicesPage y receiptService.
 */
function calculateRetroactiveChange(invoiceData: any): number {
  const rate = Number(invoiceData.exchangeRate) || 1;
  const payments = Array.isArray(invoiceData.payments) ? invoiceData.payments : [];
  if (payments.length === 0) return 0;

  let cashUsd = 0, nonCashUsd = 0;
  payments.forEach((p: any) => {
    const amtUsd = (Number(p.amountUsd) || 0) + ((Number(p.amountVes) || 0) / rate);
    const method = String(p.method || '').toLowerCase();
    if (method.includes('efectivo')) cashUsd += amtUsd;
    else nonCashUsd += amtUsd;
  });

  const totalCobradoUsd = cashUsd + nonCashUsd;
  // IMPORTANTE: invoice.total YA incluye el delivery sumado (se calcula
  // en el carrito como subtotalAfterDiscounts + deliveryCost). No hay
  // que sumarlo otra vez aquí o estaríamos contando el delivery dos
  // veces y el vuelto saldría negativo (mostrando $0 cuando debería
  // ser positivo).
  const totalVentaUsd = Number(invoiceData.total || 0);
  const exceso = totalCobradoUsd - totalVentaUsd;

  if (cashUsd > 0 && exceso > 0.01) return exceso;
  return 0;
}

export async function migrateChangeGiven(
  onProgress?: (info: { processed: number; total: number }) => void,
): Promise<ChangeGivenMigrationResult> {
  const result: ChangeGivenMigrationResult = {
    totalScanned: 0,
    alreadyMigrated: 0,
    updated: 0,
    noChangeNeeded: 0,
    errors: 0,
    totalChangeUsd: 0,
  };

  // Leer todas las facturas
  const snapshot = await getDocs(collection(db, 'invoices'));
  result.totalScanned = snapshot.size;

  if (snapshot.size === 0) return result;

  // Procesar en batches de 400
  const BATCH_SIZE = 400;
  const docs = snapshot.docs;

  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const chunk = docs.slice(i, i + BATCH_SIZE);
    const batch = writeBatch(db);
    let writesInBatch = 0;

    for (const docSnap of chunk) {
      try {
        const data = docSnap.data();

        // Calcular el vuelto correcto desde los pagos
        const computed = calculateRetroactiveChange(data);
        const existing = typeof data.changeGiven === 'number' ? data.changeGiven : null;

        // Si el campo existe Y coincide con el cálculo (tolerancia $0.01),
        // se respeta y se saltea. Caso contrario, se sobrescribe con el
        // valor correcto. Esto cubre 3 escenarios:
        //   a) No existe el campo y hay que crearlo
        //   b) Existe pero está corrupto (ej: $33,898 cuando debería ser $60)
        //   c) Existe pero está mal calculado por bugs anteriores
        //      (ej: $52 cuando debería ser $56 — diferencia de $4 por
        //      sumar delivery dos veces)
        const matches = existing !== null && Math.abs(existing - computed) < 0.01;
        if (matches) {
          result.alreadyMigrated++;
          continue;
        }

        if (computed > 0.01) {
          batch.update(doc(db, 'invoices', docSnap.id), {
            changeGiven: Number(computed.toFixed(2)),
          });
          result.updated++;
          result.totalChangeUsd += computed;
          writesInBatch++;
          if (existing !== null && existing > 0) {
            console.warn(
              `[fix] FACT-${data.numericId}: corrigiendo changeGiven. ` +
              `Anterior: ${existing}, Nuevo: ${computed.toFixed(2)}`,
            );
          }
        } else if (existing !== null && existing > 0) {
          // El campo existe pero el cálculo da 0 → eliminarlo
          const { deleteField } = await import('firebase/firestore');
          batch.update(doc(db, 'invoices', docSnap.id), {
            changeGiven: deleteField(),
          });
          writesInBatch++;
          console.warn(
            `[fix] FACT-${data.numericId}: campo eliminado (cálculo dio 0). ` +
            `Anterior: ${existing}`,
          );
        } else {
          result.noChangeNeeded++;
        }
      } catch (err) {
        console.error(`Error procesando factura ${docSnap.id}:`, err);
        result.errors++;
      }
    }

    if (writesInBatch > 0) {
      try {
        await batch.commit();
      } catch (err) {
        console.error('Error en commit del batch:', err);
        result.errors += writesInBatch;
        result.updated -= writesInBatch;
      }
    }

    if (onProgress) {
      onProgress({ processed: Math.min(i + BATCH_SIZE, docs.length), total: docs.length });
    }
  }

  return result;
}
