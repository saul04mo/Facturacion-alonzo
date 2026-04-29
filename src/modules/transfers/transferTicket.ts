/**
 * Generador de comanda térmica para órdenes de transferencia (TR).
 *
 * Formato 80mm (5.5cm útiles), idéntica disciplina visual al ticket
 * de venta (Helvetica, font-weight 500-700, color #000 forzado para
 * impresión térmica nítida).
 *
 * Una comanda contiene:
 *   - Logo ALONZO
 *   - "COMANDA DE TRANSFERENCIA" + N° TR
 *   - Origen → Destino (Almacén → Tienda)
 *   - Tabla de items: producto, talla, color, cantidad
 *   - Total de unidades
 *   - Observaciones
 *   - Firma de quien despacha
 *   - Firma de quien recibe (con nombre si ya está confirmada)
 *   - Pie con info de impresión (quién/cuándo)
 */

import type { InventoryTransfer } from '@/types';

const BUSINESS = {
  name: 'ALONZO',
  logoUrl: '/images/logoAlonzo.png',
};

function fmtDate(ts: any): string {
  if (!ts) return '—';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString('es-VE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const PRINT_CSS = `
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color: #000 !important; }
  body {
    font-family: "Helvetica", "Arial", sans-serif;
    font-size: 12px;
    font-weight: 500;
    color: #000;
    background: #fff;
    margin: 0;
    padding: 0;
    line-height: 1.4;
    -webkit-font-smoothing: antialiased;
  }
  @page { margin-top: 5mm; margin-bottom: 4mm; margin-left: 0mm; margin-right: 0mm; }
  .ticket { width: 5.5cm; max-width: 5.5cm; margin: auto; padding: 0; line-height: 1.4; }
  .ticket hr { border: none; border-top: 1px solid #000; margin: 4px 0; }
  .ticket .logo { display: block; margin: 0 auto 4px; max-width: 70%; max-height: 1.5cm; }
  .ticket .title { font-size: 13px; font-weight: 700; text-align: center; margin: 2px 0; letter-spacing: 0.5px; }
  .ticket .tr-num { font-size: 16px; font-weight: 700; text-align: center; margin: 4px 0; font-variant-numeric: tabular-nums; }
  .ticket .subtitle { font-size: 10px; font-weight: 500; text-align: center; margin: 1px 0; }
  .ticket .row { display: flex; justify-content: space-between; align-items: baseline; }
  .ticket .label { font-weight: 700; }
  .ticket table { width: 100%; border-collapse: collapse; font-size: 10px; font-weight: 500; }
  .ticket th { border-bottom: 1px solid #000; font-size: 10px; font-weight: 700; padding: 2px 1px; text-align: left; }
  .ticket td { padding: 2px 1px; word-break: break-word; vertical-align: top; font-size: 10px; }
  .ticket .qty-col { text-align: right; font-variant-numeric: tabular-nums; font-weight: 700; }
  .ticket .totals { font-size: 12px; font-weight: 700; margin-top: 4px; padding-top: 4px; border-top: 1px solid #000; }
  .ticket .obs-block { background: #f4f4f4; padding: 4px; margin: 4px 0; font-size: 10px; font-style: italic; border: 1px solid #ccc; }
  .ticket .signature-block { margin-top: 16px; }
  .ticket .signature-line {
    border-top: 1px solid #000;
    margin-top: 28px;
    padding-top: 2px;
    text-align: center;
    font-size: 9px;
    font-weight: 700;
  }
  .ticket .signature-line .who { font-size: 8px; font-weight: 500; margin-top: 1px; }
  .ticket .footer { text-align: center; font-size: 8px; font-weight: 500; margin-top: 6px; padding-top: 4px; border-top: 1px dashed #888; line-height: 1.3; }
`;

export function generateTransferTicketHTML(transfer: InventoryTransfer): string {
  const totalUnits = transfer.items.reduce((acc, it) => acc + it.quantitySent, 0);
  const totalDistinctItems = transfer.items.length;

  const itemsRows = transfer.items
    .map((it) => `
      <tr>
        <td>${escape(it.productName)}<br><span style="font-size:9px">${escape(it.size)} · ${escape(it.color)}</span></td>
        <td class="qty-col">${it.quantitySent}</td>
      </tr>
    `)
    .join('');

  const obsBlock = transfer.observation
    ? `<div class="obs-block"><strong>Obs:</strong> ${escape(transfer.observation)}</div>`
    : '';

  // Firma de Recibe: si ya hay receivedByName, mostrarlo bajo la línea.
  const recibeName = transfer.receivedByName
    ? `<div class="who">${escape(transfer.receivedByName)}</div>`
    : '<div class="who" style="color:#666 !important">________________________</div>';

  const printedAt = new Date().toLocaleString('es-VE');

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Comanda TR-${transfer.numericId}</title>
  <style>${PRINT_CSS}</style>
</head>
<body>
  <div class="ticket">
    <img src="${BUSINESS.logoUrl}" alt="${BUSINESS.name}" class="logo" />
    <div class="title">COMANDA DE TRANSFERENCIA</div>
    <div class="tr-num">TR-${transfer.numericId}</div>
    <div class="subtitle">${escape(BUSINESS.name)}</div>
    <hr>

    <div class="row"><span class="label">Origen:</span><span>${transfer.from === 'warehouse' ? 'Almacén' : 'Tienda'}</span></div>
    <div class="row"><span class="label">Destino:</span><span>${transfer.to === 'store' ? 'Tienda' : 'Almacén'}</span></div>
    <div class="row"><span class="label">Creada:</span><span>${fmtDate(transfer.createdAt)}</span></div>
    <div class="row"><span class="label">Por:</span><span>${escape(transfer.createdByName)}</span></div>

    <hr>
    <table>
      <thead>
        <tr>
          <th>Producto</th>
          <th class="qty-col">Cant.</th>
        </tr>
      </thead>
      <tbody>
        ${itemsRows}
      </tbody>
    </table>

    <div class="totals">
      <div class="row"><span>Items distintos:</span><span class="qty-col">${totalDistinctItems}</span></div>
      <div class="row"><span>Total unidades:</span><span class="qty-col">${totalUnits}</span></div>
    </div>

    ${obsBlock}

    <div class="signature-block">
      <div class="signature-line">
        DESPACHA
        <div class="who">${escape(transfer.createdByName)}</div>
      </div>
      <div class="signature-line">
        RECIBE
        ${recibeName}
      </div>
    </div>

    <div class="footer">
      Impresa: ${printedAt}<br>
      Esta comanda solo se imprime UNA vez.<br>
      Conserve este documento para auditoría.
    </div>
  </div>
  <script>
    window.onload = () => {
      setTimeout(() => { window.print(); }, 200);
      window.onafterprint = () => setTimeout(() => window.close(), 100);
    };
  </script>
</body>
</html>`;
}

/**
 * Escape HTML para evitar inyección via nombres de productos / observaciones.
 * Aunque los datos vienen de Firestore (controlado), un cliente con permiso
 * de escritura podría meter <script>; defensivo es gratis.
 */
function escape(str: string | undefined | null): string {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Abre la ventana de impresión con la comanda. NO toca la base de datos —
 * el caller debe llamar antes a markTransferPrinted() para asegurar
 * la regla de "solo una impresión".
 */
export function printTransferTicket(transfer: InventoryTransfer): void {
  const win = window.open('', '_blank', 'height=800,width=480');
  if (!win) {
    alert('No se pudo abrir la ventana de impresión. Habilitá los pop-ups para este sitio.');
    return;
  }
  win.document.write(generateTransferTicketHTML(transfer));
  win.document.close();
}
