/**
 * Utilidades para manejar inventario por sucursal (Tienda + Almacén).
 *
 * El modelo de datos tiene 3 campos de stock por variante:
 *   - stockStore: en la tienda física
 *   - stockWarehouse: en el almacén central
 *   - stockInTransit: salieron de almacén pero aún no recibió tienda
 *
 * El campo legacy `stock` se mantiene como SUMA agregada para
 * compatibilidad con código viejo. Cualquier mutación de stock debe
 * recalcular este agregado vía `getTotalStock()`.
 */

import type { Branch, ProductVariant, Product, DeliveryType } from '@/types';

/**
 * Stock total de una variante (tienda + almacén + en tránsito).
 * Usar para mostrar "Stock total" o para chequeos de stock global.
 */
export function getTotalStock(variant: Pick<ProductVariant, 'stockStore' | 'stockWarehouse' | 'stockInTransit' | 'stock'>): number {
  // Si tiene los campos nuevos, sumamos los tres.
  if (variant.stockStore !== undefined || variant.stockWarehouse !== undefined) {
    return (variant.stockStore || 0) + (variant.stockWarehouse || 0) + (variant.stockInTransit || 0);
  }
  // Fallback al legacy (productos no migrados aún).
  return variant.stock || 0;
}

/**
 * Stock disponible para venta en una sucursal específica.
 * Excluye stock en tránsito porque NO está disponible para vender.
 */
export function getAvailableStock(variant: ProductVariant, branch: Branch): number {
  if (branch === 'store') return variant.stockStore ?? 0;
  return variant.stockWarehouse ?? 0;
}

/**
 * Etiqueta legible para mostrar al usuario.
 */
export function branchLabel(branch: Branch): string {
  return branch === 'store' ? 'Tienda' : 'Almacén';
}

/**
 * Determina la sucursal por defecto para una venta web según el tipo de entrega.
 *
 * Lógica de negocio definida con el cliente:
 *  - Retiro físico (showroom, pickup, pick-up) → tienda física
 *  - Envío (delivery local, envío nacional, web) → almacén
 */
export function branchFromDeliveryType(deliveryType: DeliveryType): Branch {
  if (deliveryType === 'showroom' || deliveryType === 'pickup' || deliveryType === 'pick-up') {
    return 'store';
  }
  return 'warehouse';
}

/**
 * Devuelve el campo de Firestore a actualizar para mutar stock de una sucursal.
 * Usar dentro de updateDoc / runTransaction.
 *
 * Ejemplo:
 *   const field = stockFieldPath(variantIndex, 'store');
 *   // → "variants.0.stockStore"
 *   await updateDoc(ref, { [field]: newValue });
 */
export function stockFieldPath(variantIndex: number, branch: Branch): string {
  const subfield = branch === 'store' ? 'stockStore' : 'stockWarehouse';
  return `variants.${variantIndex}.${subfield}`;
}

/**
 * Recalcula el campo agregado `stock` de una variante a partir de los
 * tres componentes. Útil después de cualquier mutación.
 */
export function syncTotalStock(variant: ProductVariant): ProductVariant {
  return {
    ...variant,
    stock: getTotalStock(variant),
  };
}

/**
 * Snapshot de stock para mostrar en UI (los 3 valores + total).
 */
export interface StockBreakdown {
  store: number;
  warehouse: number;
  inTransit: number;
  total: number;
}

export function getStockBreakdown(variant: ProductVariant): StockBreakdown {
  const store = variant.stockStore ?? 0;
  const warehouse = variant.stockWarehouse ?? 0;
  const inTransit = variant.stockInTransit ?? 0;
  return {
    store,
    warehouse,
    inTransit,
    total: store + warehouse + inTransit,
  };
}

/**
 * Suma los breakdowns de TODAS las variantes de un producto.
 * Útil para mostrar en cards del catálogo.
 */
export function getProductStockBreakdown(product: Product): StockBreakdown {
  return product.variants.reduce<StockBreakdown>(
    (acc, v) => {
      const b = getStockBreakdown(v);
      return {
        store: acc.store + b.store,
        warehouse: acc.warehouse + b.warehouse,
        inTransit: acc.inTransit + b.inTransit,
        total: acc.total + b.total,
      };
    },
    { store: 0, warehouse: 0, inTransit: 0, total: 0 }
  );
}
