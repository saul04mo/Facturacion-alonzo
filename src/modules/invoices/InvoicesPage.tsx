import { useState, useMemo } from 'react';
import { useAppStore } from '@/store/appStore';
import { usePermissions } from '@/hooks/usePermissions';
import { useCurrency } from '@/hooks/useCurrency';
import { useToast } from '@/components/Toast';
import { DELIVERY_TYPES } from '@/config/constants';
import { Modal } from '@/components/Modal';
import { processReturn, cancelInvoice, approveWebOrder, addAbono, PAYMENT_METHODS } from './invoiceService';
import { printReceipt, downloadReceiptPdf } from '@/services/receiptService';
import { calcDiscountAmount } from '@/utils/discountUtils';
import { todayVE, toDate } from '@/utils/dateUtils';
import type { Product } from '@/types';
import {
  FileText, Filter, RotateCcw, XCircle, CheckCircle, DollarSign,
  Eye, ChevronDown, Check, X as XIcon, Printer, Download,
} from 'lucide-react';

const STATUS_BADGES: Record<string, { class: string; label: string }> = {
  'Finalizado': { class: 'badge-green', label: 'Finalizado' },
  'Pendiente de pago': { class: 'badge-amber', label: 'Pendiente de Pago' },
  'Devolución': { class: 'badge-red', label: 'Devolución' },
  'Cancelado': { class: 'badge-gray', label: 'Cancelado' },
  'Creada': { class: 'badge-blue', label: 'Web' },
};
const RETURN_REASONS = ['Cambio de Producto', 'Producto Dañado (Merma)', 'Cambio de Talla/Color', 'Insatisfacción del Cliente', 'Error en la Venta', 'Otro'];

export function InvoicesPage() {
  const invoices = useAppStore((s) => s.invoices);
  const products = useAppStore((s) => s.products);
  const clients = useAppStore((s) => s.clients);
  const currentUser = useAppStore((s) => s.currentUser);
  const exchangeRate = useAppStore((s) => s.exchangeRate);
  const { can } = usePermissions();
  const { format, formatBoth } = useCurrency();
  const toast = useToast();

  const today = todayVE();

  // Draft filters
  const [dSearch, setDSearch] = useState('');
  const [dStart, setDStart] = useState(today);
  const [dEnd, setDEnd] = useState(today);
  const [dStatus, setDStatus] = useState('all');

  // Applied filters
  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [statusFilter, setStatusFilter] = useState('all');

  const [showFilters, setShowFilters] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 15;
  const [detailInvoice, setDetailInvoice] = useState<any>(null);
  const [returnInvoice, setReturnInvoice] = useState<any>(null);
  const [returnReason, setReturnReason] = useState(RETURN_REASONS[0]);
  const [returnDetails, setReturnDetails] = useState('');
  const [abonoInvoice, setAbonoInvoice] = useState<any>(null);
  const [abonoAmount, setAbonoAmount] = useState('');
  const [abonoMethod, setAbonoMethod] = useState<string>(PAYMENT_METHODS[0].name);
  const [abonoRef, setAbonoRef] = useState('');
  const [loading, setLoading] = useState(false);

  function applyFilters() { setSearch(dSearch); setStartDate(dStart); setEndDate(dEnd); setStatusFilter(dStatus); setCurrentPage(1); }
  function clearFilters() { setDSearch(''); setDStart(today); setDEnd(today); setDStatus('all'); setSearch(''); setStartDate(today); setEndDate(today); setStatusFilter('all'); setCurrentPage(1); }
  const hasActive = search || startDate !== today || endDate !== today || statusFilter !== 'all';

  const filtered = useMemo(() => {
    let result = [...invoices];
    if (startDate && endDate) {
      const s = new Date(startDate + 'T00:00:00'), e = new Date(endDate + 'T23:59:59');
      result = result.filter((inv: any) => { const d = toDate(inv.date); return d && d >= s && d <= e; });
    }
    if (statusFilter !== 'all') result = result.filter((inv: any) => inv.status === statusFilter);
    else result = result.filter((inv: any) => inv.status !== 'Cancelado' && inv.status !== 'Devolución');
    if (search) {
      const s = search.toLowerCase();
      result = result.filter((inv: any) => {
        const name = inv.clientSnapshot?.name || '';
        const id = `fact-${String(inv.numericId).padStart(4, '0')}`;
        return name.toLowerCase().includes(s) || id.includes(s) || (inv.clientSnapshot?.rif_ci || '').toLowerCase().includes(s);
      });
    }
    return result;
  }, [invoices, startDate, endDate, statusFilter, search]);

  const totals = useMemo(() => {
    let sales = 0, delivery = 0;
    filtered.forEach((inv: any) => { if (inv.status === 'Finalizado' || inv.status === 'Pendiente de pago') { sales += inv.total || 0; delivery += inv.deliveryCostUsd || 0; } });
    return { sales, delivery, general: sales + delivery };
  }, [filtered]);

  async function handleReturn() {
    if (!returnInvoice || !currentUser) return; setLoading(true);
    try { await processReturn({ invoiceId: returnInvoice.id, invoice: returnInvoice, reason: returnReason, details: returnDetails, currentUser, products }); setReturnInvoice(null); toast.success('Devolución procesada.'); }
    catch { toast.error('Error al procesar devolución.'); } finally { setLoading(false); }
  }
  async function handleCancel(invoice: any) {
    if (!confirm('¿Cancelar factura? Stock será restaurado.')) return; setLoading(true);
    try { await cancelInvoice({ invoice, products }); setDetailInvoice(null); toast.success('Factura cancelada.'); } catch { toast.error('Error al cancelar.'); } finally { setLoading(false); }
  }
  async function handleApproveWeb(invoice: any) { setLoading(true); try { await approveWebOrder(invoice.id); toast.success('Pedido web aprobado.'); } catch { toast.error('Error.'); } finally { setLoading(false); } }
  async function handleAbono() {
    if (!abonoInvoice) return; const amt = parseFloat(abonoAmount);
    if (isNaN(amt) || amt <= 0) return toast.warning('Monto inválido.'); setLoading(true);
    try { await addAbono({ invoiceId: abonoInvoice.id, invoice: abonoInvoice, amount: amt, methodName: abonoMethod, ref: abonoRef || undefined, exchangeRate }); setAbonoInvoice(null); toast.success('Abono registrado.'); }
    catch { toast.error('Error al registrar abono.'); } finally { setLoading(false); }
  }
  function label(inv: any) { return `FACT-${String(inv.numericId).padStart(4, '0')}`; }

  return (
    <div className="space-y-6 animate-fade-up">
      {/* Header */}
      <div className="card p-5">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-1 h-12 bg-purple-500 rounded-full" />
            <div><h1 className="text-xl font-display font-bold text-navy-900">Historial de Facturas</h1>
              <p className="text-navy-400 text-sm">{filtered.length} facturas</p></div>
          </div>
          <button onClick={() => setShowFilters(!showFilters)}
            className={`btn-secondary text-sm ${showFilters ? 'border-purple-300 bg-purple-50' : ''}`}>
            <Filter size={14} /> Filtros <ChevronDown size={14} className={`transition-transform ${showFilters ? 'rotate-180' : ''}`} />
          </button>
        </div>

        {showFilters && (
          <div className="mt-4 pt-4 border-t border-surface-200 animate-fade-up">
            <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
              <div><label className="block text-[10px] font-display font-semibold text-navy-400 uppercase mb-1">Buscar</label>
                <input value={dSearch} onChange={(e) => setDSearch(e.target.value)} className="input-field text-sm" placeholder="Cliente, factura..." /></div>
              <div><label className="block text-[10px] font-display font-semibold text-navy-400 uppercase mb-1">Desde</label>
                <input type="date" value={dStart} onChange={(e) => setDStart(e.target.value)} className="input-field text-sm" /></div>
              <div><label className="block text-[10px] font-display font-semibold text-navy-400 uppercase mb-1">Hasta</label>
                <input type="date" value={dEnd} onChange={(e) => setDEnd(e.target.value)} className="input-field text-sm" /></div>
              <div><label className="block text-[10px] font-display font-semibold text-navy-400 uppercase mb-1">Estado</label>
                <select value={dStatus} onChange={(e) => setDStatus(e.target.value)} className="input-field text-sm">
                  <option value="all">Activas</option><option value="Finalizado">Finalizado</option>
                  <option value="Pendiente de pago">Crédito</option><option value="Devolución">Devolución</option>
                  <option value="Cancelado">Cancelado</option><option value="Creada">Web</option>
                </select></div>
              <div className="flex items-end gap-2">
                <button onClick={applyFilters} className="btn-primary text-sm flex-1"><Check size={14} /> Aplicar</button>
                {hasActive && <button onClick={clearFilters} className="btn-ghost p-2.5 text-navy-400 hover:text-accent-red"><XIcon size={14} /></button>}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        {[{ l: 'Ventas', v: totals.sales, c: 'text-navy-900' }, { l: 'Delivery', v: totals.delivery, c: 'text-blue-600' }, { l: 'Total', v: totals.general, c: 'text-emerald-600' }].map((i) => (
          <div key={i.l} className="card p-4 text-center hover-lift"><p className="text-[10px] font-display font-semibold text-navy-400 uppercase">{i.l}</p>
            <p className={`text-lg font-mono font-bold mt-1 ${i.c}`}>{format(i.v)}</p></div>
        ))}
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-12 text-center"><FileText size={40} className="mx-auto text-navy-200 mb-3" /><p className="text-navy-400 text-sm">Sin facturas.</p></div>
        ) : (
          <div>
            <table className="w-full table-fixed">
              <thead><tr className="border-b border-surface-200 bg-surface-50">
                {[
                  { h: 'Factura', w: 'w-[7%]' }, { h: 'Vendedor', w: 'w-[8%]' }, { h: 'Cliente', w: 'w-[9%]' },
                  { h: 'Dirección', w: 'w-[10%]' }, { h: 'Obs.', w: 'w-[7%]' },
                  { h: 'Entrega', w: 'w-[6%]' }, { h: 'Envío', w: 'w-[5%]' },
                  { h: 'Pago', w: 'w-[6%]' }, { h: 'REF', w: 'w-[5%]' },
                  { h: 'Total $', w: 'w-[6%]' }, { h: 'Total Bs', w: 'w-[7%]' },
                  { h: 'Fecha', w: 'w-[8%]' }, { h: 'Estado', w: 'w-[8%]' }, { h: '', w: 'w-[8%]' },
                ].map((c) => (
                  <th key={c.h || 'actions'} className={`text-left text-[9px] font-display font-semibold text-navy-400 uppercase tracking-wider px-2 py-2 ${c.w}`}>{c.h}</th>
                ))}</tr></thead>
              <tbody className="divide-y divide-surface-100">
                {filtered.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage).map((inv: any) => {
                  const date = toDate(inv.date);
                  const st = STATUS_BADGES[inv.status] || STATUS_BADGES['Finalizado'];
                  const dt = (DELIVERY_TYPES as any).find((t: any) => t.value === inv.deliveryType || (inv.deliveryType === 'local' && t.value === 'local'));
                  return (
                    <tr key={inv.id} className="hover:bg-surface-50 transition-colors">
                      <td className="px-2 py-2 font-mono font-semibold text-[11px] text-navy-900 truncate">{label(inv)}</td>
                      <td className="px-2 py-2 text-[10px] text-navy-500 truncate" title={inv.sellerName}>{inv.sellerName || 'N/A'}</td>
                      <td className="px-2 py-2 text-[10px] text-navy-600 truncate" title={inv.clientSnapshot?.name}>{inv.clientSnapshot?.name || 'General'}</td>
                      <td className="px-2 py-2 text-[10px] text-navy-400 break-words leading-tight" title={inv.clientSnapshot?.address}>{inv.clientSnapshot?.address || 'N/A'}</td>
                      <td className="px-2 py-2 text-[10px] text-navy-400 truncate" title={inv.notes}>{inv.notes || 'N/A'}</td>
                      <td className="px-2 py-2 text-[10px] text-navy-400 truncate">{dt?.label || inv.deliveryType || 'N/A'}</td>
                      <td className="px-2 py-2 font-mono text-[10px] text-navy-900">{format(inv.deliveryCostUsd || 0)}</td>
                      <td className="px-2 py-2 text-[9px] text-navy-400 truncate">{inv.payments?.map((p: any) => p.method).join(', ') || 'N/A'}</td>
                      <td className="px-2 py-2 text-[9px] text-navy-400 truncate">{inv.payments?.map((p: any) => p.ref).filter(Boolean).join(', ') || 'N/A'}</td>
                      <td className="px-2 py-2 font-mono font-bold text-[11px] text-navy-900">{format(inv.total || 0)}</td>
                      <td className="px-2 py-2 font-mono text-[10px] text-navy-500 truncate">{formatBoth(inv.total || 0).ves}</td>
                      <td className="px-2 py-2 text-[9px] text-navy-500 truncate">{date?.toLocaleString('es-VE')}</td>
                      <td className="px-2 py-2"><span className={`badge text-[9px] px-1.5 py-0.5 ${st.class}`}>{st.label}</span></td>
                      <td className="px-2 py-2">
                        <div className="flex gap-0.5">
                          <button onClick={() => setDetailInvoice(inv)} className="btn-ghost p-1 text-navy-400 hover:text-blue-600"><Eye size={12} /></button>
                          <button onClick={() => printReceipt({ invoice: inv, products, clients, currentExchangeRate: exchangeRate })} className="btn-ghost p-1 text-navy-400 hover:text-navy-800"><Printer size={12} /></button>
                          {inv.status === 'Finalizado' && can('canProcessReturns') && <button onClick={() => setReturnInvoice(inv)} className="btn-ghost p-1 text-navy-400 hover:text-amber-600"><RotateCcw size={12} /></button>}
                          {inv.status === 'Finalizado' && can('canEditInvoices') && <button onClick={() => handleCancel(inv)} className="btn-ghost p-1 text-navy-400 hover:text-accent-red"><XCircle size={12} /></button>}
                          {inv.status === 'Creada' && <button onClick={() => handleApproveWeb(inv)} className="btn-ghost p-1 text-navy-400 hover:text-emerald-600"><CheckCircle size={12} /></button>}
                          {inv.status === 'Pendiente de pago' && can('canAddAbono') && <button onClick={() => { setAbonoInvoice(inv); setAbonoAmount(''); setAbonoRef(''); }} className="btn-ghost p-1 text-navy-400 hover:text-green-600"><DollarSign size={12} /></button>}
                        </div>
                      </td>
                    </tr>);
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Controls */}
        {filtered.length > itemsPerPage && (
          <div className="px-4 py-3 bg-surface-50 border-t border-surface-200 flex items-center justify-between">
            <p className="text-xs text-navy-400 font-display">
              Mostrando <span className="font-semibold text-navy-700">{(currentPage - 1) * itemsPerPage + 1}</span> a <span className="font-semibold text-navy-700">{Math.min(currentPage * itemsPerPage, filtered.length)}</span> de <span className="font-semibold text-navy-700">{filtered.length}</span> facturas
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                disabled={currentPage === 1}
                className="btn-secondary px-3 py-1.5 text-xs disabled:opacity-50"
              >
                Anterior
              </button>
              <div className="flex items-center px-2 text-xs font-mono font-bold text-navy-900">
                {currentPage} / {Math.ceil(filtered.length / itemsPerPage)}
              </div>
              <button
                onClick={() => setCurrentPage(prev => Math.min(prev + 1, Math.ceil(filtered.length / itemsPerPage)))}
                disabled={currentPage >= Math.ceil(filtered.length / itemsPerPage)}
                className="btn-secondary px-3 py-1.5 text-xs disabled:opacity-50"
              >
                Siguiente
              </button>
            </div>
          </div>
        )}
      </div>

      {/* DETAIL MODAL */}
      {detailInvoice && (
        <Modal open={true} onClose={() => setDetailInvoice(null)} title={label(detailInvoice)} size="lg">
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[{ l: 'Cliente', v: detailInvoice.clientSnapshot?.name || 'General' }, { l: 'Fecha', v: toDate(detailInvoice.date)?.toLocaleDateString('es-VE') }, { l: 'Vendedor', v: detailInvoice.sellerName }, { l: 'Estado', v: detailInvoice.status }].map((i) => (
                <div key={i.l} className="bg-surface-50 rounded-lg p-3 hover-lift"><p className="text-[10px] font-display font-semibold text-navy-400 uppercase">{i.l}</p>
                  <p className="text-sm font-display font-medium text-navy-900 mt-0.5">{i.v}</p></div>
              ))}
            </div>
            <div><p className="text-[10px] font-display font-semibold text-navy-400 uppercase mb-2">Productos</p>
              <div className="space-y-1.5">{detailInvoice.items?.map((item: any, i: number) => {
                const p = products.find((pr: Product) => pr.id === item.productId); const v = p?.variants?.[item.variantIndex];
                const price = item.priceAtSale ?? v?.price ?? 0;
                const itemName = item.productName || p?.name || 'Eliminado';
                const itemLabel = item.variantLabel || (v ? `${v.size}, ${v.color}` : '');
                return (<div key={i} className="flex justify-between items-center text-sm p-2 bg-surface-50 rounded-lg hover-lift">
                  <div><span className="font-display font-medium text-navy-900">{itemName}</span>
                    {itemLabel && <span className="text-navy-400 ml-2 text-xs">({itemLabel})</span>}</div>
                  <div className="text-right font-mono"><span className="text-navy-500">{item.quantity}x</span>
                    <span className="ml-2 font-semibold text-navy-900">{format(price * item.quantity)}</span></div>
                </div>);
              })}</div>
            </div>
            {detailInvoice.payments?.length > 0 && (
              <div><p className="text-[10px] font-display font-semibold text-navy-400 uppercase mb-2">Pagos</p>
                <div className="flex flex-wrap gap-2">{detailInvoice.payments.map((p: any, i: number) => (
                  <span key={i} className="badge badge-blue">{p.method}: {p.amountUsd > 0 ? `$${p.amountUsd.toFixed(2)}` : `Bs.${p.amountVes.toFixed(2)}`}</span>
                ))}</div></div>
            )}
            
            <div className="bg-surface-50 rounded-lg p-4 space-y-2 text-sm">
              {(() => {
                let itemDiscountsTotal = 0;
                
                const subT = detailInvoice.items?.reduce((sum: number, item: any) => {
                  const p = products.find((pr: Product) => pr.id === item.productId);
                  const v = p?.variants?.[item.variantIndex];
                  const price = item.priceAtSale ?? v?.price ?? 0;
                  
                  const lineTotal = price * item.quantity;
                  itemDiscountsTotal += calcDiscountAmount(lineTotal, item.discount);
                  return sum + lineTotal;
                }, 0) || 0;

                const subTAfterItems = subT - itemDiscountsTotal;
                const genDiscount = calcDiscountAmount(subTAfterItems, detailInvoice.totalDiscount);

                return (
                  <>
                    <div className="flex justify-between text-navy-600">
                      <span>Subtotal (Sin descuentos)</span>
                      <span className="font-mono">{format(subT)}</span>
                    </div>
                    {itemDiscountsTotal > 0 && (
                      <div className="flex justify-between text-pink-600">
                        <span>Ahorro Ofertas (Por Producto)</span>
                        <span className="font-mono">-{format(itemDiscountsTotal)}</span>
                      </div>
                    )}
                    {genDiscount > 0 && (
                      <div className="flex justify-between text-accent-red">
                        <span>Descuento General</span>
                        <span className="font-mono">-{format(genDiscount)}</span>
                      </div>
                    )}
                    {(detailInvoice.deliveryCostUsd || 0) > 0 && (
                      <div className="flex justify-between text-navy-600">
                        <span>Delivery</span>
                        <span className="font-mono">+{format(detailInvoice.deliveryCostUsd)}</span>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>

            <div className="bg-navy-900 text-white rounded-lg p-4"><div className="flex justify-between"><span className="font-display">Total Pagado</span>
              <div className="text-right"><p className="font-mono font-bold text-lg">{formatBoth(detailInvoice.total || 0).usd}</p>
                <p className="font-mono text-sm text-white/60">{formatBoth(detailInvoice.total || 0).ves}</p></div></div></div>

            {/* Print / Download actions */}
            <div className="flex gap-2 pt-2">
              <button onClick={() => printReceipt({ invoice: detailInvoice, products, clients, currentExchangeRate: exchangeRate })}
                className="btn-primary flex-1">
                <Printer size={16} /> Imprimir Recibo
              </button>
              <button onClick={() => downloadReceiptPdf({ invoice: detailInvoice, products, clients, currentExchangeRate: exchangeRate })}
                className="btn-secondary flex-1">
                <Download size={16} /> Guardar PDF
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* RETURN MODAL */}
      {returnInvoice && (
        <Modal open={true} onClose={() => setReturnInvoice(null)} title={`Devolución — ${label(returnInvoice)}`} size="sm">
          <div className="space-y-4">
            <div><label className="block text-sm font-display font-medium text-navy-700 mb-1.5">Motivo</label>
              <select value={returnReason} onChange={(e) => setReturnReason(e.target.value)} className="input-field">
                {RETURN_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}</select></div>
            <div><label className="block text-sm font-display font-medium text-navy-700 mb-1.5">Detalles</label>
              <textarea value={returnDetails} onChange={(e) => setReturnDetails(e.target.value)} className="input-field" rows={3} /></div>
            <div className="flex justify-end gap-3 pt-4 border-t border-surface-200">
              <button onClick={() => setReturnInvoice(null)} className="btn-secondary">Cancelar</button>
              <button onClick={handleReturn} disabled={loading} className="btn-danger">{loading ? 'Procesando...' : 'Procesar Devolución'}</button></div>
          </div>
        </Modal>
      )}

      {/* ABONO MODAL */}
      {abonoInvoice && (
        <Modal open={true} onClose={() => setAbonoInvoice(null)} title={`Abono — ${label(abonoInvoice)}`} size="sm">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-surface-50 rounded-lg p-3"><p className="text-[10px] font-display font-semibold text-navy-400 uppercase">Total</p>
                <p className="font-mono font-bold text-navy-900">{format(abonoInvoice.total)}</p></div>
              <div className="bg-surface-50 rounded-lg p-3"><p className="text-[10px] font-display font-semibold text-navy-400 uppercase">Pendiente</p>
                <p className="font-mono font-bold text-accent-red">Bs. {((abonoInvoice.total * (abonoInvoice.exchangeRate || 1)) - (abonoInvoice.abonos || []).reduce((a: number, b: any) => a + b.amountVes, 0)).toFixed(2)}</p></div>
            </div>
            <div><label className="block text-sm font-display font-medium text-navy-700 mb-1.5">Método</label>
              <select value={abonoMethod} onChange={(e) => setAbonoMethod(e.target.value)} className="input-field">
                {PAYMENT_METHODS.filter((m) => m.currency !== 'none').map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}</select></div>
            <div><label className="block text-sm font-display font-medium text-navy-700 mb-1.5">Monto</label>
              <input type="number" step="0.01" value={abonoAmount} onChange={(e) => setAbonoAmount(e.target.value)} className="input-field font-mono" /></div>
            {abonoMethod === 'Pago movil' && <div><label className="block text-sm font-display font-medium text-navy-700 mb-1.5">Referencia</label>
              <input value={abonoRef} onChange={(e) => setAbonoRef(e.target.value)} className="input-field" /></div>}
            <div className="flex justify-end gap-3 pt-4 border-t border-surface-200">
              <button onClick={() => setAbonoInvoice(null)} className="btn-secondary">Cancelar</button>
              <button onClick={handleAbono} disabled={loading} className="btn-primary">{loading ? 'Guardando...' : 'Registrar Abono'}</button></div>
          </div>
        </Modal>
      )}
    </div>
  );
}
