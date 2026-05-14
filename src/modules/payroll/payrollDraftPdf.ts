/**
 * PDF Generator del Cierre de Nómina (libre).
 *
 * Genera un HTML formal con header de la empresa, una sección por empleado
 * mostrando sus conceptos en tabla, total por empleado, total general del
 * período, y un footer con fecha de emisión. Se abre en una ventana nueva
 * con auto-print para que el usuario imprima a PDF.
 *
 * Mismo patrón que payrollReceiptPdf.ts del módulo de nómina formal —
 * no requiere librería externa (solo el diálogo de impresión del browser).
 */

import type { PayrollDraftPeriod } from '@/types';

interface BusinessInfo {
  razonSocial: string;
  rif: string;
  direccion: string;
  telefono: string;
  logoUrl?: string;
}

const DEFAULT_BUSINESS: BusinessInfo = {
  razonSocial: 'ALONZO C.A.',
  rif: 'J-502846239',
  direccion: 'Av La Salle & Avenida Lima, Plaza Venezuela, Torre Phelps Piso 25-B, Caracas',
  telefono: '04123380976',
};

function fmtNum(n: number): string {
  return n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return `${d}/${m}/${y}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function generatePayrollDraftHTML(
  period: PayrollDraftPeriod,
  business?: Partial<BusinessInfo>,
  /** Tasa EUR→VES (lo que el sistema llama exchangeRate). Si es 0 o
   *  undefined, las columnas/totales en Bs no se muestran. */
  exchangeRate?: number,
): string {
  const biz = { ...DEFAULT_BUSINESS, ...business };
  const emittedAt = new Date().toLocaleString('es-VE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
  const showBs = !!exchangeRate && exchangeRate > 0;
  const rate = exchangeRate || 0;

  const employeeBlocks = period.employees.map((emp) => {
    const rows = emp.items.map((item) => {
      const cantUnit = (item.quantity !== undefined && item.unitPrice !== undefined)
        ? `${fmtNum(item.quantity)} × ${fmtNum(item.unitPrice)}`
        : (item.quantity !== undefined ? fmtNum(item.quantity) : '—');
      const signClass = item.isDeduction ? 'amt-deduction' : 'amt-credit';
      const sign = item.isDeduction ? '−' : '';
      const bsAmount = item.amount * rate;
      return `
        <tr>
          <td class="lbl">${escapeHtml(item.label) || '<em>(sin nombre)</em>'}</td>
          <td class="cant">${cantUnit}</td>
          <td class="amt ${signClass}">${sign}$${fmtNum(item.amount)}</td>
          ${showBs ? `<td class="amt ${signClass}">${sign}Bs. ${fmtNum(bsAmount)}</td>` : ''}
        </tr>`;
    }).join('');

    const noteHtml = emp.note
      ? `<div class="note">Observación: ${escapeHtml(emp.note)}</div>`
      : '';

    const totalBs = emp.total * rate;

    // Bloque de firma con línea, nombre y cédula del empleado.
    const signatureBlock = `
      <div class="signature-block">
        <div class="sig-line"></div>
        <div class="sig-info">
          <div class="sig-label">Firma del empleado</div>
          <div class="sig-name">${escapeHtml(emp.employeeName)}</div>
          <div class="sig-ci">C.I.: ${emp.employeeCedula ? escapeHtml(emp.employeeCedula) : '________________'}</div>
        </div>
      </div>`;

    return `
      <section class="employee">
        <h3 class="employee-name">${escapeHtml(emp.employeeName)}</h3>
        ${emp.items.length === 0
          ? '<p class="empty">Sin conceptos en este período.</p>'
          : `<table class="items">
              <thead>
                <tr>
                  <th>Concepto</th>
                  <th class="cant">Detalle</th>
                  <th class="amt">Monto $</th>
                  ${showBs ? '<th class="amt">Monto Bs</th>' : ''}
                </tr>
              </thead>
              <tbody>${rows}</tbody>
              <tfoot>
                <tr>
                  <td colspan="2" class="total-lbl">TOTAL</td>
                  <td class="amt total-val">$${fmtNum(emp.total)}</td>
                  ${showBs ? `<td class="amt total-val">Bs. ${fmtNum(totalBs)}</td>` : ''}
                </tr>
              </tfoot>
            </table>`}
        ${noteHtml}
        ${signatureBlock}
      </section>`;
  }).join('');

  const grandTotalBs = period.grandTotal * rate;

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<title>Cierre de Nómina · ${escapeHtml(period.name)} · ${biz.razonSocial}</title>
<style>
  @page { margin: 18mm 15mm; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 11pt;
    color: #222;
    margin: 0;
    padding: 0;
    background: #fff;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 2px solid #111;
    padding-bottom: 8mm;
    margin-bottom: 6mm;
  }
  .biz {
    line-height: 1.4;
  }
  .biz .name {
    font-size: 16pt;
    font-weight: 700;
    letter-spacing: 0.5px;
    margin-bottom: 1mm;
  }
  .biz .meta {
    font-size: 9pt;
    color: #555;
  }
  .doc-meta {
    text-align: right;
    font-size: 9pt;
    color: #555;
    line-height: 1.5;
  }
  .doc-meta .doc-id {
    display: inline-block;
    background: #111;
    color: #fff;
    padding: 2mm 4mm;
    font-weight: 700;
    font-size: 10pt;
    letter-spacing: 0.5px;
    margin-bottom: 2mm;
  }
  .title {
    text-align: center;
    font-size: 13pt;
    font-weight: 700;
    margin: 4mm 0;
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  .period-info {
    text-align: center;
    font-size: 10pt;
    color: #555;
    margin-bottom: 6mm;
  }
  .employee {
    margin-bottom: 6mm;
    page-break-inside: avoid;
  }
  .employee-name {
    font-size: 12pt;
    font-weight: 700;
    background: #f1f1f1;
    padding: 2mm 3mm;
    margin: 0 0 1mm 0;
    border-left: 3mm solid #111;
  }
  table.items {
    width: 100%;
    border-collapse: collapse;
    font-size: 10pt;
  }
  table.items th {
    background: #fafafa;
    text-align: left;
    padding: 1.5mm 3mm;
    font-weight: 600;
    font-size: 9pt;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    color: #555;
    border-bottom: 1px solid #ddd;
  }
  table.items th.amt, table.items th.cant {
    text-align: right;
  }
  table.items td {
    padding: 1.5mm 3mm;
    border-bottom: 1px solid #f0f0f0;
  }
  table.items td.lbl { font-weight: 500; }
  table.items td.cant {
    text-align: right;
    color: #888;
    font-family: 'Courier New', monospace;
    font-size: 9pt;
  }
  table.items td.amt {
    text-align: right;
    font-family: 'Courier New', monospace;
    font-weight: 600;
  }
  .amt-deduction { color: #c0392b; }
  .amt-credit { color: #222; }
  table.items tfoot td {
    background: #111;
    color: #fff;
    padding: 2.5mm 3mm;
    border-bottom: none;
  }
  td.total-lbl { font-weight: 700; letter-spacing: 0.5px; font-size: 10pt; }
  td.total-val { font-size: 12pt; font-weight: 700; }
  .note {
    font-size: 9pt;
    color: #555;
    margin-top: 2mm;
    padding-left: 3mm;
    border-left: 2px solid #ddd;
    font-style: italic;
  }
  .empty {
    font-size: 9pt;
    color: #999;
    font-style: italic;
    padding: 2mm 3mm;
    margin: 0;
  }
  /* Bloque de firma al final de cada empleado.
     page-break-inside avoid para que no se corte entre páginas. */
  .signature-block {
    margin-top: 10mm;
    margin-bottom: 4mm;
    padding-left: 3mm;
    page-break-inside: avoid;
  }
  .signature-block .sig-line {
    border-bottom: 1px solid #333;
    width: 70mm;
    margin-bottom: 1.5mm;
  }
  .signature-block .sig-info {
    font-size: 9pt;
    line-height: 1.4;
  }
  .signature-block .sig-label {
    color: #888;
    font-size: 8pt;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .signature-block .sig-name {
    font-weight: 600;
    color: #222;
    margin-top: 0.5mm;
  }
  .signature-block .sig-ci {
    color: #555;
    font-family: 'Courier New', monospace;
    font-size: 9pt;
  }
  .grand-total {
    margin-top: 8mm;
    padding: 4mm;
    background: #111;
    color: #fff;
    border-radius: 1mm;
  }
  .grand-total .row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .grand-total .row + .row {
    margin-top: 2mm;
    padding-top: 2mm;
    border-top: 1px solid rgba(255,255,255,0.2);
  }
  .grand-total .lbl {
    font-size: 10pt;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.8px;
  }
  .grand-total .lbl.main {
    font-size: 11pt;
    font-weight: 700;
    letter-spacing: 1px;
  }
  .grand-total .val {
    font-size: 14pt;
    font-weight: 700;
    font-family: 'Courier New', monospace;
  }
  .grand-total .val.main {
    font-size: 16pt;
  }
  .rate-info {
    text-align: center;
    font-size: 8pt;
    color: #888;
    font-style: italic;
    margin-top: 2mm;
  }
  .footer {
    margin-top: 10mm;
    padding-top: 4mm;
    border-top: 1px solid #ddd;
    font-size: 8pt;
    color: #888;
    text-align: center;
  }
  @media print {
    body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
  }
</style>
</head>
<body>
  <div class="header">
    <div class="biz">
      <div class="name">${biz.razonSocial}</div>
      <div class="meta">RIF: ${biz.rif}</div>
      <div class="meta">${biz.direccion}</div>
      <div class="meta">Tel: ${biz.telefono}</div>
    </div>
    <div class="doc-meta">
      <div class="doc-id">PD-${period.numericId.toString().padStart(4, '0')}</div>
      <div>Emitido: ${emittedAt}</div>
      <div>Estado: ${period.status === 'closed' ? 'Cerrado' : 'Abierto'}</div>
    </div>
  </div>

  <div class="title">Cierre de Nómina</div>
  <div class="period-info">
    ${escapeHtml(period.name)} · Del ${fmtDate(period.startDate)} al ${fmtDate(period.endDate)}
  </div>

  ${employeeBlocks || '<p style="text-align:center;color:#999;font-style:italic;">Sin empleados en este período.</p>'}

  <div class="grand-total">
    <div class="row">
      <span class="lbl main">Total general del período</span>
      <span class="val main">$${fmtNum(period.grandTotal)}</span>
    </div>
    ${showBs ? `
    <div class="row">
      <span class="lbl">Equivalente en bolívares</span>
      <span class="val">Bs. ${fmtNum(grandTotalBs)}</span>
    </div>` : ''}
  </div>
  ${showBs ? `<div class="rate-info">Tasa aplicada: 1 € = ${fmtNum(rate)} Bs</div>` : ''}

  <div class="footer">
    Documento informativo · ${biz.razonSocial} · ${emittedAt}
  </div>
</body>
</html>`;
}

/**
 * Abre el diálogo de impresión del browser con el HTML del cierre.
 *
 * Implementación: iframe oculto. Lo intentamos antes con window.open()
 * pero los browsers modernos lo bloquean por defecto como popup, incluso
 * cuando viene de un click de usuario (Chrome/Edge con popup blocker
 * activo, Brave, Safari en algunas configuraciones). El iframe oculto
 * NO requiere permisos de popup y funciona en todos los browsers.
 *
 * Flujo:
 *   1. Crear iframe invisible en la página actual.
 *   2. Escribir el HTML adentro.
 *   3. Esperar a que cargue.
 *   4. focus() + print() del iframe → dispara el diálogo de impresión.
 *   5. Quitar el iframe después de un delay (no antes, sino el diálogo
 *      se corta).
 */
export function printPayrollDraft(
  period: PayrollDraftPeriod,
  exchangeRate?: number,
  business?: Partial<BusinessInfo>,
): void {
  const html = generatePayrollDraftHTML(period, business, exchangeRate);

  // Si ya hay un iframe de impresión previo (porque el usuario hizo click
  // dos veces rápido), lo limpiamos antes de crear uno nuevo.
  const existing = document.getElementById('payroll-draft-print-frame');
  if (existing) existing.remove();

  const iframe = document.createElement('iframe');
  iframe.id = 'payroll-draft-print-frame';
  // Posicionado fuera de viewport pero sin display:none — algunos browsers
  // no renderizan ni imprimen contenido de iframes con display:none.
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.setAttribute('aria-hidden', 'true');
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument || iframe.contentWindow?.document;
  if (!doc) {
    document.body.removeChild(iframe);
    alert('No se pudo generar el PDF. Intentá recargar la página.');
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();

  // Esperar al load para que el CSS y el layout estén listos antes de
  // disparar el print, sino sale el diálogo con el HTML sin estilos.
  iframe.onload = () => {
    setTimeout(() => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch (e) {
        console.error('Error al imprimir:', e);
      }
      // Quitar el iframe después del print (con margen para que el
      // diálogo de impresión termine de pintarse).
      setTimeout(() => {
        if (document.body.contains(iframe)) document.body.removeChild(iframe);
      }, 2000);
    }, 250);
  };
}
