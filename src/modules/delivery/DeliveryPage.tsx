import { useState, useMemo } from 'react';
import { useAppStore } from '@/store/appStore';
import { usePermissions } from '@/hooks/usePermissions';
import { useCurrency } from '@/hooks/useCurrency';
import { useToast } from '@/components/Toast';
import { confirmDeliveryPayment } from '@/modules/invoices/invoiceService';
import { Truck, CheckCircle, Clock, MapPin, Check, X as XIcon } from 'lucide-react';
import { todayVE, toDate } from '@/utils/dateUtils';

export function DeliveryPage() {
  const invoices = useAppStore((s) => s.invoices);
  const clients = useAppStore((s) => s.clients);
  const { can } = usePermissions();
  const { format } = useCurrency();
  const toast = useToast();

  const today = todayVE();
  const [dStart, setDStart] = useState(today);
  const [dEnd, setDEnd] = useState(today);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [confirming, setConfirming] = useState<string | null>(null);

  function applyFilters() { setStartDate(dStart); setEndDate(dEnd); }
  function clearFilters() { setDStart(today); setDEnd(today); setStartDate(today); setEndDate(today); }

  const deliveryOrders = useMemo(() => {
    let filtered = invoices.filter((inv: any) => inv.deliveryType === 'local' && (inv.status === 'Finalizado' || inv.status === 'Pendiente de pago'));
    if (startDate && endDate) {
      const s = new Date(startDate + 'T00:00:00'), e = new Date(endDate + 'T23:59:59');
      filtered = filtered.filter((inv: any) => { const d = toDate(inv.date); return d && d >= s && d <= e; });
    }
    return filtered.sort((a: any, b: any) => (toDate(b.date)?.getTime() || 0) - (toDate(a.date)?.getTime() || 0));
  }, [invoices, startDate, endDate]);

  const totalCost = deliveryOrders.reduce((acc: number, inv: any) => acc + (inv.deliveryCostUsd || 0), 0);
  const paidCount = deliveryOrders.filter((inv: any) => inv.deliveryPaidInStore).length;

  async function handleConfirm(id: string, currentStatus?: string) {
    if (!confirm('¿Confirmar pago de delivery?')) return;
    setConfirming(id);
    try { await confirmDeliveryPayment(id, currentStatus); toast.success('Pago de delivery confirmado.'); } catch { toast.error('Error al confirmar pago.'); } finally { setConfirming(null); }
  }

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="card p-5">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-1 h-12 bg-green-500 rounded-full" />
            <div><h1 className="text-xl font-display font-bold text-navy-900">Delivery</h1>
              <p className="text-navy-400 text-sm">Pedidos con delivery local</p></div>
          </div>
          <div className="flex items-center gap-2">
            <input type="date" value={dStart} onChange={(e) => setDStart(e.target.value)} className="input-field text-sm w-36" />
            <span className="text-navy-300">—</span>
            <input type="date" value={dEnd} onChange={(e) => setDEnd(e.target.value)} className="input-field text-sm w-36" />
            <button onClick={applyFilters} className="btn-primary text-sm"><Check size={14} /> Aplicar</button>
            <button onClick={clearFilters} className="btn-ghost p-2 text-navy-400 hover:text-accent-red"><XIcon size={14} /></button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="card p-4 hover-lift"><p className="text-[10px] font-display font-semibold text-navy-400 uppercase">Pedidos</p>
          <p className="text-2xl font-mono font-bold text-navy-900 mt-1">{deliveryOrders.length}</p></div>
        <div className="card p-4 hover-lift"><p className="text-[10px] font-display font-semibold text-navy-400 uppercase">Total</p>
          <p className="text-2xl font-mono font-bold text-emerald-600 mt-1">{format(totalCost)}</p></div>
        <div className="card p-4 hover-lift"><p className="text-[10px] font-display font-semibold text-navy-400 uppercase">Pagados</p>
          <p className="text-2xl font-mono font-bold text-navy-900 mt-1">{paidCount}</p></div>
        <div className="card p-4 hover-lift"><p className="text-[10px] font-display font-semibold text-navy-400 uppercase">Pendientes</p>
          <p className="text-2xl font-mono font-bold text-amber-500 mt-1">{deliveryOrders.length - paidCount}</p></div>
      </div>

      <div className="card overflow-hidden">
        {deliveryOrders.length === 0 ? (
          <div className="p-12 text-center"><Truck size={40} className="mx-auto text-navy-200 mb-3" /><p className="text-navy-400 text-sm">Sin pedidos en este rango.</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-surface-200 bg-surface-50">
                {['Factura', 'Cliente', 'Fecha', 'Dirección', 'Teléfono', 'Costo', 'Estado'].map((h) => (
                  <th key={h} className="text-left text-[10px] font-display font-semibold text-navy-400 uppercase tracking-wider px-4 py-3">{h}</th>
                ))}</tr></thead>
              <tbody className="divide-y divide-surface-100">
                {deliveryOrders.map((inv: any) => {
                  const cl: any = clients.find((c: any) => c.id === inv.clientId) || inv.clientSnapshot || {};
                  const isPaid = inv.deliveryPaidInStore;
                  return (
                    <tr key={inv.id} className="hover:bg-surface-50 transition-colors hover-lift">
                      <td className="px-4 py-3 font-mono font-semibold text-sm text-navy-900">FACT-{String(inv.numericId).padStart(4, '0')}</td>
                      <td className="px-4 py-3 text-sm text-navy-700">{cl.name || cl.nombre || 'General'}</td>
                      <td className="px-4 py-3 text-sm text-navy-500">{toDate(inv.date)?.toLocaleDateString('es-VE')}</td>
                      <td className="px-4 py-3"><div className="flex items-center gap-1.5 max-w-[180px]"><MapPin size={13} className="text-navy-300 flex-shrink-0" />
                        <span className="text-sm text-navy-500 truncate">{cl.address || 'N/A'}</span></div></td>
                      <td className="px-4 py-3 text-sm text-navy-500">{cl.phone || 'N/A'}</td>
                      <td className="px-4 py-3 font-mono font-semibold text-sm text-navy-900">{format(inv.deliveryCostUsd || 0)}</td>
                      <td className="px-4 py-3">{isPaid ? (
                        <span className="badge badge-green"><CheckCircle size={12} /> Pagado</span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="badge badge-amber"><Clock size={12} /> Pendiente</span>
                          {can('canConfirmDeliveryPayment') && (
                            <button onClick={() => handleConfirm(inv.id, inv.status)} disabled={confirming === inv.id}
                              className="btn-ghost text-[10px] text-emerald-600 hover:bg-emerald-50 px-2 py-1">
                              {confirming === inv.id ? '...' : 'Confirmar'}</button>
                          )}
                        </div>
                      )}</td>
                    </tr>);
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
