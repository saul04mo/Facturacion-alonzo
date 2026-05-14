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
): string {
  const biz = { ...DEFAULT_BUSINESS, ...business };
  const emittedAt = new Date().toLocaleString('es-VE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  const employeeBlocks = period.employees.map((emp) => {
    const rows = emp.items.map((item) => {
      const cantUnit = (item.quantity !== undefined && item.unitPrice !== undefined)
        ? `${fmtNum(item.quantity)} × ${fmtNum(item.unitPrice)}`
        : (item.quantity !== undefined ? fmtNum(item.quantity) : '—');
      const signClass = item.isDeduction ? 'amt-deduction' : 'amt-credit';
      const sign = item.isDeduction ? '−' : '';
      return `
        <tr>
          <td class="lbl">${escapeHtml(item.label) || '<em>(sin nombre)</em>'}</td>
          <td class="cant">${cantUnit}</td>
          <td class="amt ${signClass}">${sign}$${fmtNum(item.amount)}</td>
        </tr>`;
    }).join('');

    const noteHtml = emp.note
      ? `<div class="note">Observación: ${escapeHtml(emp.note)}</div>`
      : '';

    return `
      <section class="employee">
        <h3 class="employee-name">${escapeHtml(emp.employeeName)}</h3>
        ${emp.items.length === 0
          ? '<p class="empty">Sin conceptos en este período.</p>'
          : `<table class="items">
              <thead>
                <tr><th>Concepto</th><th class="cant">Detalle</th><th class="amt">Monto</th></tr>
              </thead>
              <tbody>${rows}</tbody>
              <tfoot>
                <tr>
                  <td colspan="2" class="total-lbl">TOTAL</td>
                  <td class="amt total-val">$${fmtNum(emp.total)}</td>
                </tr>
              </tfoot>
            </table>`}
        ${noteHtml}
      </section>`;
  }).join('');

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
  .grand-total {
    margin-top: 8mm;
    padding: 4mm;
    background: #111;
    color: #fff;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-radius: 1mm;
  }
  .grand-total .lbl {
    font-size: 11pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  .grand-total .val {
    font-size: 16pt;
    font-weight: 700;
    font-family: 'Courier New', monospace;
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
    <span class="lbl">Total general del período</span>
    <span class="val">$${fmtNum(period.grandTotal)}</span>
  </div>

  <div class="footer">
    Documento informativo · ${biz.razonSocial} · ${emittedAt}
  </div>
</body>
</html>`;
}

/** Abre una ventana con el HTML y dispara el diálogo de impresión (PDF). */
export function printPayrollDraft(period: PayrollDraftPeriod, business?: Partial<BusinessInfo>): void {
  const html = generatePayrollDraftHTML(period, business);
  const win = window.open('', '_blank', 'noopener,noreferrer');
  if (!win) {
    alert('No se pudo abrir la ventana de impresión. Verificá que el navegador no esté bloqueando popups.');
    return;
  }
  win.document.write(html);
  win.document.close();
  // Esperar a que cargue el CSS antes de imprimir
  win.onload = () => {
    setTimeout(() => win.print(), 100);
  };
}
