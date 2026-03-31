/**
 * Payroll Receipt PDF Generator
 * Generates a formal pay stub HTML and opens a print dialog.
 */

import type { PayrollReceipt } from '@/types';

interface BusinessInfo {
  razonSocial: string;
  rif: string;
  direccion: string;
  telefono: string;
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

export function generatePayrollReceiptHTML(
  receipt: PayrollReceipt,
  periodLabel: string,
  business?: Partial<BusinessInfo>
): string {
  const biz = { ...DEFAULT_BUSINESS, ...business };

  const assignmentRows = [
    { concepto: 'Sueldo Base', monto: receipt.salarioBase },
    { concepto: 'Cestaticket (Bono Alimentación)', monto: receipt.cestaticket },
    { concepto: 'Horas Extras Diurnas', monto: receipt.horasExtrasDiurnas },
    { concepto: 'Horas Extras Nocturnas', monto: receipt.horasExtrasNocturnas },
    { concepto: 'Bono Nocturno', monto: receipt.bonoNocturno },
    { concepto: 'Feriados Trabajados', monto: receipt.feriadosTrabajados },
    { concepto: 'Bono Vacacional (Prorrateo)', monto: receipt.bonoVacacional },
    { concepto: 'Utilidades (Prorrateo)', monto: receipt.utilidades },
    { concepto: 'Bonificación USD (en VED)', monto: receipt.bonificacionUsd },
    { concepto: 'Otras Asignaciones', monto: receipt.otrasAsignaciones },
  ].filter((r) => r.monto > 0);

  const deductionRows = [
    { concepto: 'IVSS (Seguro Social - 4%)', monto: receipt.ivss },
    { concepto: 'FAOV (Vivienda - 1%)', monto: receipt.faov },
    { concepto: 'RPE (Paro Forzoso - 0.5%)', monto: receipt.rpe },
    { concepto: 'INCES (0.5% s/ Utilidades)', monto: receipt.inces },
    { concepto: 'Otras Deducciones (Faltas)', monto: receipt.otrasDeducciones },
  ].filter((r) => r.monto > 0);

  const assignmentHTML = assignmentRows
    .map((r) => `<tr><td>${r.concepto}</td><td class="amt">${fmtNum(r.monto)}</td></tr>`)
    .join('');

  const deductionHTML = deductionRows
    .map((r) => `<tr><td>${r.concepto}</td><td class="amt">${fmtNum(r.monto)}</td></tr>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Recibo de Pago - ${receipt.employeeName}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px; color: #1a1a2e; background: #fff; }
    @page { size: letter; margin: 15mm; }
    .receipt { max-width: 720px; margin: 0 auto; padding: 20px; }
    .header { text-align: center; border-bottom: 2px solid #1a1a2e; padding-bottom: 10px; margin-bottom: 12px; }
    .header h1 { font-size: 16px; font-weight: 700; margin-bottom: 2px; }
    .header p { font-size: 10px; color: #555; }
    .title-bar { background: #1a1a2e; color: #fff; text-align: center; padding: 6px; font-size: 13px; font-weight: 700; margin-bottom: 12px; letter-spacing: 1px; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 20px; margin-bottom: 14px; font-size: 10.5px; }
    .info-grid .label { font-weight: 700; color: #333; }
    .info-grid .value { color: #555; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
    th { background: #f0f0f5; text-align: left; padding: 5px 8px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #ccc; }
    td { padding: 4px 8px; border-bottom: 1px solid #eee; font-size: 10.5px; }
    td.amt { text-align: right; font-family: 'Courier New', monospace; font-weight: 600; }
    .subtotal-row td { font-weight: 700; border-top: 2px solid #1a1a2e; background: #f8f8fc; font-size: 11px; }
    .net-row { background: #1a1a2e; color: #fff; }
    .net-row td { font-size: 13px; font-weight: 700; padding: 8px; border: none; }
    .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 50px; text-align: center; }
    .sig-line { border-top: 1px solid #333; padding-top: 4px; font-size: 10px; font-weight: 600; }
    .footer { text-align: center; margin-top: 20px; font-size: 9px; color: #888; border-top: 1px solid #ddd; padding-top: 8px; }
  </style>
</head>
<body>
  <div class="receipt">
    <div class="header">
      <h1>${biz.razonSocial}</h1>
      <p>RIF: ${biz.rif} | ${biz.direccion}</p>
      <p>Teléfono: ${biz.telefono}</p>
    </div>

    <div class="title-bar">RECIBO DE PAGO</div>

    <div class="info-grid">
      <div><span class="label">Empleado:</span> <span class="value">${receipt.employeeName}</span></div>
      <div><span class="label">Cédula:</span> <span class="value">${receipt.employeeCedula}</span></div>
      <div><span class="label">Cargo:</span> <span class="value">${receipt.employeeCargo}</span></div>
      <div><span class="label">Departamento:</span> <span class="value">${receipt.departamento}</span></div>
      <div><span class="label">Fecha Ingreso:</span> <span class="value">${receipt.fechaIngreso}</span></div>
      <div><span class="label">Período:</span> <span class="value">${periodLabel}</span></div>
      <div><span class="label">Tasa BCV:</span> <span class="value">${fmtNum(receipt.tasaBcv)} Bs/$</span></div>
    </div>

    <table>
      <thead><tr><th colspan="2">ASIGNACIONES</th></tr></thead>
      <tbody>
        ${assignmentHTML}
        <tr class="subtotal-row"><td>TOTAL ASIGNACIONES</td><td class="amt">${fmtNum(receipt.totalAsignaciones)}</td></tr>
      </tbody>
    </table>

    <table>
      <thead><tr><th colspan="2">DEDUCCIONES</th></tr></thead>
      <tbody>
        ${deductionHTML}
        <tr class="subtotal-row"><td>TOTAL DEDUCCIONES</td><td class="amt">${fmtNum(receipt.totalDeducciones)}</td></tr>
      </tbody>
    </table>

    <table>
      <tbody>
        <tr class="net-row"><td>NETO A PAGAR (Bs)</td><td class="amt" style="color:#fff">${fmtNum(receipt.netoAPagar)}</td></tr>
        <tr class="subtotal-row"><td>Referencial USD</td><td class="amt">$ ${fmtNum(receipt.netoUsd)}</td></tr>
      </tbody>
    </table>

    <div class="signatures">
      <div>
        <div class="sig-line">Firma del Trabajador</div>
        <p style="font-size:9px;color:#888;margin-top:2px">${receipt.employeeName}</p>
      </div>
      <div>
        <div class="sig-line">Firma del Empleador</div>
        <p style="font-size:9px;color:#888;margin-top:2px">${biz.razonSocial}</p>
      </div>
    </div>

    <div class="footer">
      Este recibo es un comprobante de pago. Conserve este documento para sus registros.
    </div>
  </div>
</body>
</html>`;
}

export function printPayrollReceipt(receipt: PayrollReceipt, periodLabel: string): void {
  const html = generatePayrollReceiptHTML(receipt, periodLabel);
  const win = window.open('', '', 'height=900,width=700');
  if (!win) {
    alert('No se pudo abrir la ventana. Verifica que no esté bloqueada por el navegador.');
    return;
  }
  win.document.write(html);
  win.document.close();
  setTimeout(() => win.print(), 500);
}
