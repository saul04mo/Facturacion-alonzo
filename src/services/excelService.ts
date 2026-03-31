import * as XLSX from 'xlsx';
import { fetchInvoicesByDateRange } from '@/modules/invoices/invoiceService';

export function exportToExcel(data: Record<string, any>[], sheetName: string, fileName: string) {
  if (data.length === 0) {
    throw new Error('No hay datos para exportar.');
  }
  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  XLSX.writeFile(workbook, fileName);
}

/**
 * Export sales to Excel — fetches ALL invoices in the date range
 * directly from Firestore (bypasses the 500-record listener limit).
 */
export async function exportSalesData(
  clients: any[],
  startDate: string,
  endDate: string,
): Promise<void> {
  const toDate = (d: any) => (d?.toDate ? d.toDate() : d instanceof Date ? d : new Date(d));

  const invoices = await fetchInvoicesByDateRange(startDate, endDate);

  if (invoices.length === 0) {
    throw new Error('No hay ventas en el rango seleccionado.');
  }

  const data = invoices.map((inv: any) => {
    const client = clients.find((c: any) => c.id === inv.clientId);
    const clientName = client?.name || inv.clientSnapshot?.name || 'Cliente General';
    const methods = inv.payments?.map((p: any) => p.method).join(', ') || 'N/A';
    const totalVes = inv.total * (inv.exchangeRate || 1);

    return {
      Fecha: toDate(inv.date).toLocaleString('es-VE'),
      Factura: `FACT-${String(inv.numericId).padStart(4, '0')}`,
      Cliente: clientName,
      'Método de Pago': methods,
      'Monto (USD)': inv.total.toFixed(2),
      'Monto (Bs.)': totalVes.toFixed(2),
      Estado: inv.status,
      Vendedor: inv.sellerName || 'N/A',
      'Tipo Envío': inv.deliveryType || 'N/A',
    };
  });

  exportToExcel(data, 'Ventas', `ventas_${startDate}_a_${endDate}.xlsx`);
}
