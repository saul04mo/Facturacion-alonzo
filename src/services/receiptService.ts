/**
 * Invoice Receipt Generator
 *
 * FIX: Uses priceAtSale stored in the invoice instead of looking up current product prices.
 * FIX: Separate printReceipt (print dialog) and downloadReceiptPdf (save as PDF).
 * FIX: Uses shared calcDiscountAmount utility.
 */

import { calcDiscountAmount } from '@/utils/discountUtils';
import type { Invoice, Product } from '@/types';

interface ReceiptOptions {
  invoice: Invoice;
  products: Product[];
  clients: any[];
  currentExchangeRate: number;
  businessInfo?: {
    name?: string;
    rif?: string;
    address?: string[];
    phone?: string;
    logoUrl?: string;
  };
}

const DEFAULT_BUSINESS = {
  name: 'ALONZO',
  rif: 'J-502846239',
  address: ['Av La Salle & Avenida Lima', 'Plaza Venezuela', 'Torre Phelps Piso 25-B Caracas'],
  phone: '04123380976',
  logoUrl: '/images/logoAlonzo.png',
};

function toDate(d: any): Date {
  if (d?.toDate) return d.toDate();
  if (d instanceof Date) return d;
  return new Date(d);
}

/**
 * Resolve the unit price for an invoice item.
 * Uses priceAtSale if available (v2.1+), falls back to current product price for legacy invoices.
 */
function resolveItemPrice(item: any, products: Product[]): number {
  if (item.priceAtSale != null) return item.priceAtSale;
  // Legacy fallback
  const product = products.find((p) => p.id === item.productId);
  return product?.variants?.[item.variantIndex]?.price || 0;
}

function resolveItemLabel(item: any, products: Product[]): { name: string; size: string; color: string; barcode: string } {
  if (item.productName) {
    const parts = (item.variantLabel || '').split(' / ');
    return { name: item.productName, size: parts[0] || '-', color: parts[1] || '-', barcode: '' };
  }
  // Legacy fallback
  const product = products.find((p) => p.id === item.productId);
  const variant = product?.variants?.[item.variantIndex];
  return {
    name: product?.name || 'Eliminado',
    size: variant?.size || '-',
    color: variant?.color || '-',
    barcode: variant?.barcode || 'N/A',
  };
}

export function generateReceiptHTML(opts: ReceiptOptions): string {
  const { invoice, products, currentExchangeRate } = opts;
  const biz = opts.businessInfo || DEFAULT_BUSINESS;
  const rate = invoice.exchangeRate || currentExchangeRate;

  // Client (use snapshot stored in invoice)
  const clientName = invoice.clientSnapshot?.name || 'Cliente General';
  const clientRif = invoice.clientSnapshot?.rif_ci || 'N/A';
  const clientAddress = invoice.clientSnapshot?.address || 'N/A';
  const clientPhone = invoice.clientSnapshot?.phone || 'N/A';

  // Items — FIX: uses priceAtSale
  let subtotal = 0;
  let totalDiscountAmount = 0;
  let itemsHtml = '';

  (invoice.items || []).forEach((item: any) => {
    const price = resolveItemPrice(item, products);
    const label = resolveItemLabel(item, products);
    const itemTotal = price * item.quantity;
    subtotal += itemTotal;

    const itemDiscount = calcDiscountAmount(itemTotal, item.discount);
    totalDiscountAmount += itemDiscount;

    itemsHtml += `
      <tr>
        <td class="py-1">${label.barcode}</td>
        <td class="py-1" colspan="3">${label.name} (${label.size}, ${label.color})</td>
      </tr>
      <tr>
        <td></td>
        <td class="py-1 text-right" colspan="2">${item.quantity} x ${(price * rate).toFixed(2)}</td>
        <td class="py-1 text-right">${(itemTotal * rate).toFixed(2)}</td>
      </tr>`;

    if (itemDiscount > 0) {
      itemsHtml += `
        <tr>
          <td></td>
          <td colspan="3" class="py-1 text-right text-xs">Desc: -${(itemDiscount * rate).toFixed(2)}</td>
        </tr>`;
    }
  });

  // General discount (uses shared utility)
  const generalDiscount = calcDiscountAmount(subtotal - totalDiscountAmount, invoice.totalDiscount);
  totalDiscountAmount += generalDiscount;

  // Promo & coupon discounts
  const promoDiscount = (invoice.appliedPromotions || []).reduce((sum: number, p: any) => sum + (p.discountAmount || 0), 0);
  const couponDiscount = invoice.appliedCoupon?.discountAmount || 0;
  const couponFreeShipping = invoice.appliedCoupon?.freeShipping || false;
  const promoFreeShipping = (invoice.appliedPromotions || []).some((p: any) => p.type === 'free_shipping');

  const subtotalAfterDiscount = subtotal - totalDiscountAmount;
  const deliveryCost = (couponFreeShipping || promoFreeShipping) ? 0 : (invoice.deliveryCostUsd || 0);
  const grandTotalUSD = Math.max(0, subtotalAfterDiscount - promoDiscount - couponDiscount + deliveryCost);
  const grandTotalVES = grandTotalUSD * rate;

  // Build promo/coupon lines for receipt
  let promoHtml = '';
  if (invoice.appliedPromotions?.length) {
    invoice.appliedPromotions.forEach((p: any) => {
      promoHtml += `<tr><td class="label" style="color:#7c3aed;">⚡ ${p.name || 'Promo'}:</td><td class="value" style="color:#7c3aed;">-${(p.discountAmount * rate).toFixed(2)}</td></tr>`;
    });
  }
  if (invoice.appliedCoupon && couponDiscount > 0) {
    promoHtml += `<tr><td class="label" style="color:#059669;">🎟 Cupón ${invoice.appliedCoupon.code}:</td><td class="value" style="color:#059669;">-${(couponDiscount * rate).toFixed(2)}</td></tr>`;
  }

  // Payments
  let paymentsHtml = '';
  if (invoice.payments?.length) {
    invoice.payments.forEach((p: any) => {
      paymentsHtml += `<p>${p.method}: Bs. ${(p.amountVes || 0).toFixed(2)} / $ ${(p.amountUsd || 0).toFixed(2)}</p>`;
    });
  } else {
    paymentsHtml = '<p>No especificado</p>';
  }

  // Pago movil reference
  const pagoMovil = invoice.payments?.find((p: any) => p.method === 'Pago movil' && p.ref);
  const refHtml = pagoMovil ? `<tr><td class="label">Ref. Pago Móvil:</td><td class="value">${pagoMovil.ref}</td></tr>` : '';

  // Abonos
  const totalAbonos = (invoice.abonos || []).reduce((acc: number, a: any) => acc + (a.amountVes || 0), 0);
  const totalPaymentsVes = (invoice.payments || []).reduce((acc: number, p: any) => {
    return acc + (p.amountVes || 0) + (p.amountUsd || 0) * rate;
  }, 0);
  const totalPaid = totalPaymentsVes + totalAbonos;
  const saldoPendiente = Math.max(0, grandTotalVES - totalPaid);

  let abonosHtml = '';
  if (invoice.abonos?.length) {
    abonosHtml += '<hr class="border-dashed border-black my-2"><div><p><strong>Abonos Realizados:</strong></p>';
    invoice.abonos.forEach((a: any) => {
      const aDate = toDate(a.date).toLocaleDateString('es-VE');
      abonosHtml += `<p class="text-xs">${aDate} - ${a.method}: Bs. ${(a.amountVes || 0).toFixed(2)} / $${(a.amountUsd || 0).toFixed(2)}${a.ref ? ' • Ref: ' + a.ref : ''}</p>`;
    });
    abonosHtml += `<p class="font-bold">Total Abonado: Bs. ${totalAbonos.toFixed(2)}</p></div>`;
  }

  let saldoHtml = '';
  if (saldoPendiente > 0) {
    saldoHtml = `<div style="text-align:center;font-weight:bold;color:#c00;">Saldo Pendiente: Bs. ${saldoPendiente.toFixed(2)}</div>
      <div style="text-align:center;font-size:9px;color:#666;">Total: Bs. ${grandTotalVES.toFixed(2)} • Pagado: Bs. ${totalPaid.toFixed(2)}</div>`;
  }

  let changeHtml = '';
  if ((invoice as any).changeGiven && (invoice as any).changeGiven > 0) {
    const cg = (invoice as any).changeGiven;
    changeHtml = `
      <div class="flex justify-between" style="color:green"><p>Vuelto (Bs):</p><p>${cg.toFixed(2)}</p></div>
      <div class="flex justify-between" style="color:green"><p>Vuelto ($):</p><p>${(cg / rate).toFixed(2)}</p></div>`;
  }

  const deliveryRowHtml = deliveryCost > 0
    ? `<tr><td class="label">Envío:</td><td class="value">${(deliveryCost * rate).toFixed(2)}</td></tr>`
    : '';

  const invoiceDate = toDate(invoice.date);
  const expirationDate = new Date(invoiceDate);
  expirationDate.setDate(expirationDate.getDate() + 15);

  return `
    <div class="invoice-print-area">
      <div class="title" style="text-align:center;">
        ${biz.logoUrl ? `<img src="${biz.logoUrl}" alt="Logo" style="height:36px;display:block;margin:auto;" onerror="this.style.display='none'">` : ''}
        <div style="font-size:14px;font-weight:bold;margin-top:4px;">${biz.name}</div>
      </div>
      <div class="subtitle">RIF: ${biz.rif}</div>
      ${(biz.address || []).map((l) => `<div class="subtitle">${l}</div>`).join('')}
      <div class="subtitle">Telf. ${biz.phone}</div>
      <hr>
      <div class="datos-cliente">
        <span class="label">Cliente:</span> ${clientName}<br>
        <span class="label">RIF/C.I.:</span> ${clientRif}<br>
        <span class="label">Dirección:</span> ${clientAddress}<br>
        <span class="label">Teléfono:</span> ${clientPhone}<br>
        <span class="label">Vendedor:</span> ${invoice.sellerName || 'GENERICO'}<br>
        <span class="subtitle">Observación: ${invoice.observation || 'N/A'}</span>
      </div>
      <hr>
      <div class="subtitle">Ingreso No: ${String(invoice.numericId).padStart(8, '0')} - ${invoiceDate.toLocaleTimeString('es-VE')}</div>
      <div class="subtitle">Emitida el: ${invoiceDate.toLocaleDateString('es-VE')} Expira: ${expirationDate.toLocaleDateString('es-VE')}</div>
      <hr>
      <table>
        <thead><tr><th>Código</th><th>Descripción</th><th style="text-align:right;">Total</th></tr></thead>
        <tbody>${itemsHtml}</tbody>
      </table>
      <hr>
      <table class="totals-table">
        <tr><td class="label">SubTotal:</td><td class="value">${(subtotal * rate).toFixed(2)}</td></tr>
        <tr><td class="label">Descuento:</td><td class="value">${(totalDiscountAmount * rate).toFixed(2)}</td></tr>
        ${promoHtml}
        ${deliveryRowHtml}
        <tr class="total-row"><td class="label">Total Bs:</td><td class="value">${grandTotalVES.toFixed(2)}</td></tr>
        <tr class="total-row"><td class="label">REF:</td><td class="value">${grandTotalUSD.toFixed(2)}</td></tr>
        ${refHtml}
      </table>
      <hr>
      <div class="label">Forma de Pago:</div>
      <div>${paymentsHtml}</div>
      ${changeHtml}
      ${abonosHtml}
      <hr>
      <div class="footer">¡Gracias por su compra!</div>
      ${saldoHtml ? `<hr><div class="footer">${saldoHtml}</div>` : ''}
    </div>`;
}

const RECEIPT_STYLES = `
  body { font-family: "Courier New", "Source Code Pro", monospace; font-size: 12px; color: #000; background: #fff; margin: 0; padding: 0; line-height: 1.5; }
  @page { margin-top: 5mm; margin-bottom: 4mm; margin-left: 0mm; margin-right: 0mm; }
  .invoice-print-area { width: 5.5cm; max-width: 5.5cm; margin: auto; padding: 0; line-height: 1.5; font-size: 12px; }
  .invoice-print-area hr { border: none; border-top: 1px dashed #aaa; margin: 4px 0; }
  .invoice-print-area .title { font-size: 14px; font-weight: bold; text-align: center; margin-bottom: 2px; }
  .invoice-print-area .subtitle { font-size: 10px; text-align: center; margin-bottom: 1px; }
  .invoice-print-area .datos-cliente { font-size: 10px; margin-bottom: 2px; }
  .invoice-print-area .label { font-weight: bold; }
  .invoice-print-area table { width: 100%; border-collapse: collapse; font-size: 10px; margin-bottom: 2px; }
  .invoice-print-area th { border-bottom: 1px solid #aaa; font-size: 10px; font-weight: bold; padding: 2px 0; text-align: left; }
  .invoice-print-area td { padding: 2px 0; word-break: break-word; vertical-align: top; font-size: 11px; }
  .invoice-print-area .totals-table td { padding: 1px 0; }
  .invoice-print-area .totals-table .label { text-align: left; width: 60%; }
  .invoice-print-area .totals-table .value { text-align: right; width: 40%; }
  .invoice-print-area .total-row { font-weight: bold; border-top: 1px solid #aaa; }
  .invoice-print-area .footer { text-align: center; font-size: 10px; margin-top: 5px; }
  .flex { display: flex; } .justify-between { justify-content: space-between; }
  .text-right { text-align: right; } .text-xs { font-size: 9px; }
  .font-bold { font-weight: bold; } .py-1 { padding-top: 2px; padding-bottom: 2px; }
`;

function openReceiptWindow(opts: ReceiptOptions): Window | null {
  const content = generateReceiptHTML(opts);
  const printWindow = window.open('', '', 'height=800,width=600');
  if (!printWindow) return null;

  printWindow.document.write(`<html><head><title>Factura FACT-${String(opts.invoice.numericId).padStart(4, '0')}</title>
    <style>${RECEIPT_STYLES}</style>
  </head><body>`);
  printWindow.document.write(content);
  printWindow.document.write('</body></html>');
  printWindow.document.close();
  return printWindow;
}

/**
 * Open print dialog for the receipt.
 */
export function printReceipt(opts: ReceiptOptions): void {
  const printWindow = openReceiptWindow(opts);
  if (!printWindow) {
    alert('No se pudo abrir la ventana de impresión. Verifica que no esté bloqueada por el navegador.');
    return;
  }
  setTimeout(() => printWindow.print(), 600);
}

/**
 * Open receipt in a new window for "Save as PDF" (via browser print-to-PDF).
 * Does NOT auto-trigger print dialog — user can Ctrl+P or right-click > Save as PDF.
 */
export function downloadReceiptPdf(opts: ReceiptOptions): void {
  const printWindow = openReceiptWindow(opts);
  if (!printWindow) {
    alert('No se pudo abrir la ventana. Verifica que no esté bloqueada por el navegador.');
    return;
  }
  // Don't auto-print — user saves as PDF manually
}
