/**
 * Cuentas de la entrega, sin nada de Firestore.
 *
 * Vive aparte de deliveryService a propósito: acá está la única parte que
 * decide cuánta plata se le descuenta a una factura, y separarla de la
 * escritura permite probarla sola, sin levantar Firebase.
 */

import { calcDiscountAmount } from '@/utils/discountUtils';
import type { Invoice, InvoiceItem } from '@/types';

/** Neto de una línea: precio de venta por cantidad, menos su propio descuento. */
export function lineaNeta(item: Pick<InvoiceItem, 'priceAtSale' | 'quantity' | 'discount'>): number {
  const bruto = (item.priceAtSale ?? 0) * (item.quantity ?? 0);
  return Math.max(0, bruto - calcDiscountAmount(bruto, item.discount));
}

/**
 * Cuánto del costo de envío quedó realmente dentro del total de la factura.
 * Una promo o un cupón de envío gratis lo dejan en cero aunque
 * `deliveryCostUsd` tenga valor — replica la cuenta que hace el carrito.
 */
export function envioDentroDelTotal(invoice: Pick<Invoice, 'appliedPromotions' | 'appliedCoupon' | 'deliveryCostUsd'>): number {
  const gratis =
    (invoice.appliedPromotions || []).some((p: any) => p.type === 'free_shipping') ||
    invoice.appliedCoupon?.freeShipping === true;
  return gratis ? 0 : (invoice.deliveryCostUsd ?? 0);
}

/**
 * Qué se le descuenta al total por las prendas que volvieron.
 *
 * No alcanza con sumar el precio de lista de lo devuelto: entre el subtotal y
 * el total hay descuento global, promociones y cupón, y el cliente pagó el
 * precio ya rebajado. Si se devolviera el precio de lista, una factura con 20%
 * de descuento le estaría regalando ese 20% al cliente en cada prenda que
 * rechaza.
 *
 * Por eso se devuelve la parte proporcional de lo que efectivamente se cobró
 * por mercadería. El envío no entra en el reparto: el viaje se hizo igual.
 */
export function calcularAjuste(
  invoice: Pick<Invoice, 'items' | 'total' | 'appliedPromotions' | 'appliedCoupon' | 'deliveryCostUsd'>,
  devueltos: InvoiceItem[],
) {
  const subtotal = (invoice.items || []).reduce((a, i) => a + lineaNeta(i), 0);
  const devueltoBruto = devueltos.reduce((a, i) => a + lineaNeta(i), 0);

  const envio = envioDentroDelTotal(invoice);
  const mercaderia = Math.max(0, (invoice.total ?? 0) - envio);
  const factor = subtotal > 0 ? mercaderia / subtotal : 0;

  const credito = Number((devueltoBruto * factor).toFixed(2));
  const totalNuevo = Math.max(0, Number(((invoice.total ?? 0) - credito).toFixed(2)));

  return { credito, totalNuevo, subtotal, envio };
}

/** Lo ya pagado de una factura, en USD: pagos iniciales (sin crédito) + abonos. */
export function pagadoUsd(invoice: Pick<Invoice, 'payments' | 'abonos'>): number {
  const pagos = (invoice.payments || [])
    .filter((p: any) => p.method !== 'Crédito')
    .reduce((a: number, p: any) => a + (p.amountUsd || 0), 0);
  const abonos = (invoice.abonos || []).reduce((a: number, b: any) => a + (b.amountUsd || 0), 0);
  return Number((pagos + abonos).toFixed(2));
}
