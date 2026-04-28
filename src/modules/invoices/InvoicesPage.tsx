import { useState, useMemo } from 'react';
import { useAppStore } from '@/store/appStore';
import { usePermissions } from '@/hooks/usePermissions';
import { useCurrency } from '@/hooks/useCurrency';
import { useToast } from '@/components/Toast';
import { DELIVERY_TYPES } from '@/config/constants';
import { Modal } from '@/components/Modal';
import { processReturn, cancelInvoice, approveWebOrder, confirmDeliveryPayment, addAbono, PAYMENT_METHODS, fetchInvoicesByDateRange, fetchInvoiceByNumericId, updateInvoiceCustomerData } from './invoiceService';
import { printReceipt, downloadReceiptPdf } from '@/services/receiptService';
import { calcDiscountAmount } from '@/utils/discountUtils';
import { todayVE, toDate } from '@/utils/dateUtils';
import type { Product, Invoice } from '@/types';
import {
  FileText, Filter, RotateCcw, XCircle, CheckCircle, DollarSign,
  Eye, ChevronDown, Check, X as XIcon, Printer, Download, ImageIcon, Hash, Edit2,
} from 'lucide-react';

const STATUS_BADGES: Record<string, { class: string; label: string }> = {
  'Finalizado': { class: 'badge-green', label: 'Finalizado' },
  'Pendiente de pago': { class: 'badge-amber', label: 'Pendiente de Pago' },
  'Devolución': { class: 'badge-red', label: 'Devolución' },
  'Cancelado': { class: 'badge-gray', label: 'Cancelado' },
  'Creada': { class: 'badge-blue', label: 'Creada' },
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
  const [dSeller, setDSeller] = useState('all');
  const [dMethod, setDMethod] = useState('all');
  const [dDelivery, setDDelivery] = useState('all');

  // Applied filters
  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [statusFilter, setStatusFilter] = useState('all');
  const [sellerFilter, setSellerFilter] = useState('all');
  const [methodFilter, setMethodFilter] = useState('all');
  const [deliveryFilter, setDeliveryFilter] = useState('all');

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
  // Editar datos del cliente / observación de una factura ya emitida
  const [editInvoice, setEditInvoice] = useState<Invoice | null>(null);
  const [editName, setEditName] = useState('');
  const [editRif, setEditRif] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editObs, setEditObs] = useState('');
  const [loading, setLoading] = useState(false);
  const [serverInvoices, setServerInvoices] = useState<any[] | null>(null);
  const [isSearchingServer, setIsSearchingServer] = useState(false);
  const [quickSearch, setQuickSearch] = useState('');
  const [isQuickSearching, setIsQuickSearching] = useState(false);

  async function handleQuickSearch() {
    const raw = quickSearch.trim().replace(/[^0-9]/g, '');
    if (!raw) return toast.warning('Escribe un número de factura.');
    const num = parseInt(raw);
    if (isNaN(num) || num <= 0) return toast.warning('Número de factura inválido.');
    setIsQuickSearching(true);
    try {
      // First check locally
      const local = invoices.find((inv: any) => inv.numericId === num);
      if (local) {
        setDetailInvoice(local);
        setQuickSearch('');
        return;
      }
      // If not found locally, search in Firestore
      const result = await fetchInvoiceByNumericId(num);
      if (result) {
        setDetailInvoice(result);
        setQuickSearch('');
      } else {
        toast.warning(`No se encontró la factura #${num}`);
      }
    } catch (err) {
      console.error('Quick search error:', err);
      toast.error('Error al buscar factura.');
    } finally {
      setIsQuickSearching(false);
    }
  }

  async function applyFilters() { 
    setSearch(dSearch); 
    setStartDate(dStart); 
    setEndDate(dEnd); 
    setStatusFilter(dStatus); 
    setSellerFilter(dSeller);
    setMethodFilter(dMethod);
    setDeliveryFilter(dDelivery);
    setCurrentPage(1); 
    
    if (dStart || dEnd) {
      setIsSearchingServer(true);
      try {
        const results = await fetchInvoicesByDateRange(dStart || '1970-01-01', dEnd || '2100-01-01');
        setServerInvoices(results);
      } catch (err) {
        toast.error('Error al descargar facturas del servidor.');
        setServerInvoices(null);
      } finally {
        setIsSearchingServer(false);
      }
    } else {
      setServerInvoices(null);
    }
  }

  function clearFilters() { 
    setDSearch(''); setDStart(today); setDEnd(today); setDStatus('all'); 
    setDSeller('all'); setDMethod('all'); setDDelivery('all');
    setSearch(''); setStartDate(today); setEndDate(today); setStatusFilter('all'); 
    setSellerFilter('all'); setMethodFilter('all'); setDeliveryFilter('all');
    setCurrentPage(1); 
    setServerInvoices(null);
  }
  const hasActive = search || startDate !== today || endDate !== today
    || statusFilter !== 'all' || sellerFilter !== 'all'
    || methodFilter !== 'all' || deliveryFilter !== 'all';

  // Lista de vendedores únicos derivada de las facturas en memoria/servidor
  const availableSellers = useMemo(() => {
    const set = new Set<string>();
    (serverInvoices || invoices).forEach((inv: any) => {
      if (inv.sellerName) set.add(inv.sellerName);
    });
    return Array.from(set).sort();
  }, [invoices, serverInvoices]);

  const filtered = useMemo(() => {
    let result = [...(serverInvoices || invoices)];
    
    // Solo filtramos localmente las fechas si no usamos el servidor
    if (!serverInvoices && startDate && endDate) {
      const s = new Date(startDate + 'T00:00:00'), e = new Date(endDate + 'T23:59:59');
      result = result.filter((inv: any) => { const d = toDate(inv.date); return d && d >= s && d <= e; });
    }
    
    if (statusFilter !== 'all') result = result.filter((inv: any) => inv.status === statusFilter);
    else result = result.filter((inv: any) => inv.status !== 'Cancelado' && inv.status !== 'Devolución');

    if (sellerFilter !== 'all') {
      result = result.filter((inv: any) => inv.sellerName === sellerFilter);
    }
    if (methodFilter !== 'all') {
      result = result.filter((inv: any) =>
        Array.isArray(inv.payments) && inv.payments.some((p: any) => p.method === methodFilter)
      );
    }
    if (deliveryFilter !== 'all') {
      result = result.filter((inv: any) => inv.deliveryType === deliveryFilter);
    }
    
    if (search) {
      const s = search.toLowerCase();
      result = result.filter((inv: any) => {
        const name = inv.clientSnapshot?.name || '';
        const id = `fact-${String(inv.numericId).padStart(4, '0')}`;
        return name.toLowerCase().includes(s) || id.includes(s) || (inv.clientSnapshot?.rif_ci || '').toLowerCase().includes(s);
      });
    }
    return result;
  }, [invoices, serverInvoices, startDate, endDate, statusFilter, sellerFilter, methodFilter, deliveryFilter, search]);

  const totals = useMemo(() => {
    let totalAll = 0, delivery = 0;
    filtered.forEach((inv: any) => {
      if (inv.status === 'Finalizado' || inv.status === 'Pendiente de pago') {
        totalAll += Number(inv.total) || 0;
        delivery += Number(inv.deliveryCostUsd) || 0;
      }
    });
    return { sales: totalAll - delivery, delivery, general: totalAll };
  }, [filtered]);

  async function refetchIfServer() {
    if (serverInvoices && startDate && endDate) {
      try {
        const results = await fetchInvoicesByDateRange(startDate, endDate);
        setServerInvoices(results);
      } catch (err) {}
    }
  }

  async function handleReturn() {
    if (!returnInvoice || !currentUser) return; setLoading(true);
    try { 
      await processReturn({ invoiceId: returnInvoice.id, invoice: returnInvoice, reason: returnReason, details: returnDetails, currentUser, products }); 
      setReturnInvoice(null); 
      toast.success('Devolución procesada.'); 
      await refetchIfServer();
    }
    catch (err: any) { console.error('processReturn error:', err); toast.error(`Error al procesar devolución: ${err?.message || err}`); } finally { setLoading(false); }
  }
  async function handleCancel(invoice: any) {
    if (!confirm('¿Cancelar factura? Stock será restaurado.')) return; setLoading(true);
    try { 
      await cancelInvoice({ invoice, products }); 
      setDetailInvoice(null); 
      toast.success('Factura cancelada.'); 
      await refetchIfServer();
    } catch { toast.error('Error al cancelar.'); } finally { setLoading(false); }
  }
  async function handleApproveWeb(invoice: any) { setLoading(true); try { await approveWebOrder(invoice.id); toast.success('Pedido web aprobado.'); await refetchIfServer(); } catch { toast.error('Error.'); } finally { setLoading(false); } }

  // Abre el modal de edición y precarga los valores actuales del snapshot
  function openEditModal(invoice: Invoice) {
    setEditInvoice(invoice);
    setEditName(invoice.clientSnapshot?.name || '');
    setEditRif(invoice.clientSnapshot?.rif_ci || '');
    setEditAddress(invoice.clientSnapshot?.address || '');
    setEditPhone(invoice.clientSnapshot?.phone || '');
    setEditObs(invoice.observation || '');
  }

  async function handleSaveEdit() {
    if (!editInvoice) return;
    if (!editName.trim()) { toast.warning('El nombre del cliente no puede estar vacío.'); return; }
    setLoading(true);
    try {
      await updateInvoiceCustomerData(editInvoice.id, {
        clientSnapshot: {
          ...(editInvoice.clientSnapshot || {}),
          name: editName.trim(),
          rif_ci: editRif.trim(),
          address: editAddress.trim(),
          phone: editPhone.trim(),
        },
        observation: editObs.trim() || null,
      });
      toast.success('Datos actualizados.');
      setEditInvoice(null);
      await refetchIfServer();
    } catch (e) {
      console.error(e);
      toast.error('Error al actualizar.');
    } finally {
      setLoading(false);
    }
  }
  
  async function handleMarkAsPaid(invoice: any) {
    if (!confirm('¿Marcar pago de delivery como completado y finalizar?')) return;
    setLoading(true); 
    try { 
      await confirmDeliveryPayment(invoice.id, invoice.status); 
      toast.success('Pago confirmado.'); 
      await refetchIfServer(); 
    } catch { toast.error('Error al confirmar pago.'); } finally { setLoading(false); } 
  }

  async function handleAbono() {
    if (!abonoInvoice) return; const amt = parseFloat(abonoAmount);
    if (isNaN(amt) || amt <= 0) return toast.warning('Monto inválido.'); setLoading(true);
    try { 
      await addAbono({ invoiceId: abonoInvoice.id, invoice: abonoInvoice, amount: amt, methodName: abonoMethod, ref: abonoRef || undefined, exchangeRate }); 
      setAbonoInvoice(null); 
      toast.success('Abono registrado.'); 
      await refetchIfServer();
    }
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
          <div className="flex gap-2 items-center w-full sm:w-auto">
            {/* Quick search by numericId */}
            <div className="relative flex-1 sm:flex-initial sm:w-52">
              <Hash size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-navy-300" />
              <input
                value={quickSearch}
                onChange={(e) => setQuickSearch(e.target.value.replace(/[^0-9]/g, ''))}
                onKeyDown={(e) => e.key === 'Enter' && handleQuickSearch()}
                className="input-field pl-8 pr-16 text-sm font-mono"
                placeholder="Nº factura..."
                inputMode="numeric"
              />
              <button
                onClick={handleQuickSearch}
                disabled={isQuickSearching}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 px-2 py-1 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-400 text-white text-[10px] font-display font-semibold rounded transition-colors"
              >
                {isQuickSearching ? '...' : 'Buscar'}
              </button>
            </div>
            <button onClick={() => setShowFilters(!showFilters)}
              className={`btn-secondary text-sm ${showFilters ? 'border-purple-300 bg-purple-50' : ''}`}>
              <Filter size={14} /> Filtros <ChevronDown size={14} className={`transition-transform ${showFilters ? 'rotate-180' : ''}`} />
            </button>
          </div>
        </div>

        {showFilters && (
          <div className="mt-4 pt-4 border-t border-surface-200 animate-fade-up">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
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
              <div><label className="block text-[10px] font-display font-semibold text-navy-400 uppercase mb-1">Vendedor</label>
                <select value={dSeller} onChange={(e) => setDSeller(e.target.value)} className="input-field text-sm">
                  <option value="all">Todos</option>
                  {availableSellers.map((s) => <option key={s} value={s}>{s}</option>)}
                </select></div>
              <div><label className="block text-[10px] font-display font-semibold text-navy-400 uppercase mb-1">Método de Pago</label>
                <select value={dMethod} onChange={(e) => setDMethod(e.target.value)} className="input-field text-sm">
                  <option value="all">Todos</option>
                  {PAYMENT_METHODS.filter((m) => m.currency !== 'none').map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}
                </select></div>
              <div><label className="block text-[10px] font-display font-semibold text-navy-400 uppercase mb-1">Entrega</label>
                <select value={dDelivery} onChange={(e) => setDDelivery(e.target.value)} className="input-field text-sm">
                  <option value="all">Todas</option>
                  {DELIVERY_TYPES.map((dt) => <option key={dt.value} value={dt.value}>{dt.label}</option>)}
                </select></div>
              <div className="flex items-end gap-2">
                <button onClick={applyFilters} disabled={isSearchingServer} className="btn-primary text-sm flex-1">
                  {isSearchingServer ? 'Buscando...' : <><Check size={14} /> Aplicar</>}
                </button>
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
      <div className="card overflow-hidden md:-mx-6 lg:-mx-12 xl:-mx-20 2xl:-mx-32">
        {filtered.length === 0 ? (
          <div className="p-12 text-center"><FileText size={40} className="mx-auto text-navy-200 mb-3" /><p className="text-navy-400 text-sm">Sin facturas.</p></div>
        ) : (
          <div>
            {/* ═══ MOBILE: Card layout ═══ */}
            <div className="md:hidden divide-y divide-surface-100">
              {filtered.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage).map((inv: any) => {
                const date = toDate(inv.date);
                const st = STATUS_BADGES[inv.status] || { class: 'badge-gray', label: inv.status || 'N/A' };
                const paymentImgUrl = inv.proofUrl || inv.img || inv.paymentImg || (inv.payments?.find?.((p: any) => p.proofUrl || p.img)?.proofUrl || inv.payments?.find?.((p: any) => p.proofUrl || p.img)?.img) || null;
                return (
                  <div key={inv.id} className="p-4 hover:bg-surface-50 transition-colors">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <span className="font-mono font-bold text-sm text-navy-900">{label(inv)}</span>
                        <span className={`badge text-[9px] px-1.5 py-0.5 ml-2 ${st.class}`}>{st.label}</span>
                      </div>
                      <span className="font-mono font-bold text-sm text-navy-900">{format(inv.total || 0)}</span>
                    </div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-xs text-navy-500 truncate max-w-[60%]">
                        {inv.clientSnapshot?.name || 'General'}
                      </div>
                      <span className="font-mono text-xs text-navy-400">{formatBoth(inv.total || 0).ves}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="text-[10px] text-navy-400">
                        {date?.toLocaleDateString('es-VE', { day: '2-digit', month: 'short' })}{' '}
                        {date?.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })}
                        <span className="mx-1">·</span>
                        {inv.sellerName?.split(' ')[0] || 'N/A'}
                        <span className="mx-1">·</span>
                        {inv.payments?.map((p: any) => p.method).join(', ') || 'N/A'}
                      </div>
                      <div className="flex gap-1">
                        <button onClick={() => setDetailInvoice(inv)} className="btn-ghost p-1.5 text-navy-400 hover:text-blue-600"><Eye size={14} /></button>
                        {paymentImgUrl && (
                          <a href={paymentImgUrl} target="_blank" rel="noopener noreferrer" className="btn-ghost p-1.5 text-navy-400 hover:text-purple-600"><ImageIcon size={14} /></a>
                        )}
                        <button onClick={() => printReceipt({ invoice: inv, products, clients, currentExchangeRate: exchangeRate })} className="btn-ghost p-1.5 text-navy-400 hover:text-navy-800"><Printer size={14} /></button>
                        {(inv.status === 'Finalizado' || inv.status === 'Pendiente de pago') && can('canEditInvoices') && (
                          <button onClick={() => openEditModal(inv)} className="btn-ghost p-1.5 text-navy-400 hover:text-blue-600" title="Editar datos"><Edit2 size={14} /></button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* ═══ DESKTOP: Table layout ═══ */}
            <div className="hidden md:block">
            <table className="w-full table-fixed">
              <thead><tr className="border-b border-surface-200 bg-surface-50">
                {[
                  { h: 'Factura', w: 'w-[6%]' }, { h: 'Vendedor', w: 'w-[7%]' }, { h: 'Cliente', w: 'w-[8%]' },
                  { h: 'Dirección', w: 'w-[12%]' }, { h: 'Obs.', w: 'w-[7%]' },
                  { h: 'Entrega', w: 'w-[6%]' }, { h: 'Envío', w: 'w-[5%]' },
                  { h: 'Pago', w: 'w-[6%]' }, { h: 'REF', w: 'w-[5%]' },
                  { h: 'Total $', w: 'w-[6%]' }, { h: 'Total Bs', w: 'w-[8%]' },
                  { h: 'Fecha', w: 'w-[8%]' }, { h: 'Estado', w: 'w-[7%]' }, { h: '', w: 'w-[9%]' },
                ].map((c) => (
                  <th key={c.h || 'actions'} className={`text-left text-[11px] font-display font-semibold text-navy-400 uppercase tracking-wide px-3 py-3 ${c.w}`}>{c.h}</th>
                ))}</tr></thead>
              <tbody className="divide-y divide-surface-100">
                {filtered.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage).map((inv: any) => {
                  const date = toDate(inv.date);
                  const st = STATUS_BADGES[inv.status] || { class: 'badge-gray', label: inv.status || 'N/A' };
                  const dt = (DELIVERY_TYPES as any).find((t: any) => t.value === inv.deliveryType || (inv.deliveryType === 'local' && t.value === 'local'));
                  const paymentImgUrl = inv.proofUrl || inv.img || inv.paymentImg || (inv.payments?.find?.((p: any) => p.proofUrl || p.img)?.proofUrl || inv.payments?.find?.((p: any) => p.proofUrl || p.img)?.img) || null;
                  
                  return (
                    <tr key={inv.id} className="hover:bg-surface-50 transition-colors">
                      <td className="px-3 py-3 font-mono font-semibold text-[12px] text-navy-900 break-all leading-tight">{label(inv)}</td>
                      <td className="px-3 py-3 text-[12px] text-navy-500 break-words leading-tight" title={inv.sellerName}>{inv.sellerName || 'N/A'}</td>
                      <td className="px-3 py-3 text-[12px] text-navy-600 break-words leading-tight" title={inv.clientSnapshot?.name}>{inv.clientSnapshot?.name || 'General'}</td>
                      <td className="px-3 py-3 text-[12px] text-navy-400 break-words leading-tight" title={inv.clientSnapshot?.address}>{inv.clientSnapshot?.address || 'N/A'}</td>
                      <td className="px-3 py-3 text-[12px] text-navy-400 break-words leading-tight" title={inv.observation || inv.notes}>{inv.observation || inv.notes || 'N/A'}</td>
                      <td className="px-3 py-3 text-[12px] text-navy-400 break-words leading-tight">{dt?.label || inv.deliveryType || 'N/A'}</td>
                      <td className="px-3 py-3 font-mono text-[12px] text-navy-900">{format(inv.deliveryCostUsd || 0)}</td>
                      <td className="px-3 py-3 text-[12px] text-navy-400 break-words leading-tight" title={inv.payments?.map((p: any) => p.method).join(', ')}>{inv.payments?.map((p: any) => p.method).join(', ') || 'N/A'}</td>
                      <td className="px-3 py-3 text-[12px] text-navy-400 break-all leading-tight" title={inv.payments?.map((p: any) => p.ref).filter(Boolean).join(', ')}>{inv.payments?.map((p: any) => p.ref).filter(Boolean).join(', ') || 'N/A'}</td>
                      <td className="px-3 py-3 font-mono font-bold text-[12px] text-navy-900">{format(inv.total || 0)}</td>
                      <td className="px-3 py-3 font-mono text-[12px] text-navy-500 break-all leading-tight">{formatBoth(inv.total || 0).ves}</td>
                      <td className="px-3 py-3 text-[11px] text-navy-500 leading-tight">{date?.toLocaleString('es-VE')}</td>
                      <td className="px-3 py-3"><span className={`badge text-[10px] px-2 py-0.5 ${st.class}`}>{st.label}</span></td>
                      <td className="px-3 py-3">
                        <div className="flex gap-1 flex-wrap">
                          <button onClick={() => setDetailInvoice(inv)} className="btn-ghost p-1 text-navy-400 hover:text-blue-600"><Eye size={14} /></button>
                          {paymentImgUrl && (
                            <a href={paymentImgUrl} target="_blank" rel="noopener noreferrer" className="btn-ghost p-1 text-navy-400 hover:text-purple-600" title="Ver comprobante de pago">
                              <ImageIcon size={12} />
                            </a>
                          )}
                          <button onClick={() => printReceipt({ invoice: inv, products, clients, currentExchangeRate: exchangeRate })} className="btn-ghost p-1 text-navy-400 hover:text-navy-800"><Printer size={12} /></button>
                          {(inv.status === 'Finalizado' || inv.status === 'Pendiente de pago') && can('canEditInvoices') && (
                            <button onClick={() => openEditModal(inv)} className="btn-ghost p-1 text-navy-400 hover:text-blue-600" title="Editar datos del cliente / observación"><Edit2 size={12} /></button>
                          )}
                          {inv.status === 'Finalizado' && can('canProcessReturns') && <button onClick={() => setReturnInvoice(inv)} className="btn-ghost p-1 text-navy-400 hover:text-amber-600"><RotateCcw size={12} /></button>}
                          {inv.status === 'Finalizado' && can('canEditInvoices') && <button onClick={() => handleCancel(inv)} className="btn-ghost p-1 text-navy-400 hover:text-accent-red"><XCircle size={12} /></button>}
                          {inv.status === 'Creada' && <button onClick={() => handleApproveWeb(inv)} className="btn-ghost p-1 text-navy-400 hover:text-emerald-600"><CheckCircle size={12} /></button>}
                          {inv.status === 'Pendiente de pago' && <button onClick={() => handleMarkAsPaid(inv)} className="btn-ghost p-1 text-navy-400 hover:text-emerald-600" title="Finalizar Pago"><CheckCircle size={12} /></button>}
                          {inv.status === 'Pendiente de pago' && can('canAddAbono') && <button onClick={() => { setAbonoInvoice(inv); setAbonoAmount(''); setAbonoRef(''); }} className="btn-ghost p-1 text-navy-400 hover:text-green-600"><DollarSign size={12} /></button>}
                        </div>
                      </td>
                    </tr>);
                })}
              </tbody>
            </table>
            </div>
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
            {(detailInvoice.payments?.length > 0 || detailInvoice.proofUrl || detailInvoice.img || detailInvoice.paymentImg) && (
              <div><p className="text-[10px] font-display font-semibold text-navy-400 uppercase mb-2">Comprobantes</p>
                <div className="flex flex-col gap-3">

                  {/* Renderizar las imágenes de los comprobantes */}
                  {((detailInvoice.payments?.some((p: any) => p.proofUrl || p.img)) || (detailInvoice.proofUrl || detailInvoice.img || detailInvoice.paymentImg)) && (
                    <div className="flex flex-wrap gap-3 mt-1">
                      {detailInvoice.payments?.filter((p: any) => p.proofUrl || p.img).map((p: any, i: number) => (
                        <a key={i} href={p.proofUrl || p.img} target="_blank" rel="noopener noreferrer" className="block border border-surface-200 rounded-lg overflow-hidden hover:border-purple-400 transition-colors bg-surface-100 flex-shrink-0 relative group shadow-sm" style={{ width: '160px', height: '220px' }} title="Clic para ampliar comprobante">
                          <img src={p.proofUrl || p.img} alt={`Comprobante ${p.method}`} className="w-full h-full object-cover opacity-95 group-hover:opacity-100 transition-opacity" />
                          <div className="absolute inset-x-0 bottom-0 bg-black/60 text-white text-[10px] font-medium text-center py-1.5 opacity-0 group-hover:opacity-100 transition-opacity font-display">Ver completo</div>
                        </a>
                      ))}
                      
                      {/* Mostrar comprobante global si no estaba dentro del array de pagos */}
                      {(!detailInvoice.payments?.some((p: any) => p.proofUrl || p.img)) && (detailInvoice.proofUrl || detailInvoice.img || detailInvoice.paymentImg) && (
                        <a href={detailInvoice.proofUrl || detailInvoice.img || detailInvoice.paymentImg} target="_blank" rel="noopener noreferrer" className="block border border-surface-200 rounded-lg overflow-hidden hover:border-purple-400 transition-colors bg-surface-100 flex-shrink-0 relative group shadow-sm" style={{ width: '160px', height: '220px' }} title="Clic para ampliar comprobante">
                          <img src={detailInvoice.proofUrl || detailInvoice.img || detailInvoice.paymentImg} alt="Comprobante" className="w-full h-full object-cover opacity-95 group-hover:opacity-100 transition-opacity" />
                          <div className="absolute inset-x-0 bottom-0 bg-black/60 text-white text-[10px] font-medium text-center py-1.5 opacity-0 group-hover:opacity-100 transition-opacity font-display">Ver completo</div>
                        </a>
                      )}
                    </div>
                  )}
                </div>
              </div>
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

            {/* Vuelto (cambio en efectivo) */}
            {(detailInvoice.changeGiven || 0) > 0 && (
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 flex justify-between items-center">
                <span className="text-sm font-display font-semibold text-amber-700 dark:text-amber-400">Vuelto entregado</span>
                <div className="text-right">
                  <p className="font-mono font-bold text-amber-700 dark:text-amber-400">Bs. {Number(detailInvoice.changeGiven).toLocaleString('es-VE', { minimumFractionDigits: 2 })}</p>
                  <p className="font-mono text-xs text-amber-500">{format(detailInvoice.changeGiven / (detailInvoice.exchangeRate || exchangeRate))}</p>
                </div>
              </div>
            )}

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

      {/* Modal: Editar Datos del Cliente / Observación */}
      {editInvoice && (
        <Modal open={!!editInvoice} onClose={() => setEditInvoice(null)} title="Editar Datos de la Factura" size="md">
          <div className="space-y-5">
            <div>
              <p className="text-xs text-navy-400 font-display uppercase tracking-wide mb-1">Factura</p>
              <p className="text-sm font-mono text-navy-700">#{editInvoice.numericId} · {format(editInvoice.total || 0)}</p>
            </div>

            {/* Datos del cliente */}
            <div className="space-y-3 pb-4 border-b border-surface-200">
              <h3 className="text-sm font-display font-bold text-navy-900">Datos del Cliente</h3>
              <div>
                <label className="block text-xs font-display font-medium text-navy-700 mb-1">Nombre</label>
                <input value={editName} onChange={(e) => setEditName(e.target.value)} className="input-field" placeholder="Nombre del cliente" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-display font-medium text-navy-700 mb-1">RIF / C.I.</label>
                  <input value={editRif} onChange={(e) => setEditRif(e.target.value)} className="input-field font-mono" placeholder="V12345678" />
                </div>
                <div>
                  <label className="block text-xs font-display font-medium text-navy-700 mb-1">Teléfono</label>
                  <input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} className="input-field font-mono" placeholder="04141234567" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-display font-medium text-navy-700 mb-1">Dirección</label>
                <input value={editAddress} onChange={(e) => setEditAddress(e.target.value)} className="input-field" placeholder="Dirección de envío" />
              </div>
            </div>

            {/* Observación */}
            <div>
              <h3 className="text-sm font-display font-bold text-navy-900 mb-2">Observación de la Venta</h3>
              <textarea
                value={editObs}
                onChange={(e) => setEditObs(e.target.value)}
                className="input-field min-h-[80px] resize-y"
                placeholder="Notas internas sobre la factura (envío, cambio pendiente, etc.)"
              />
            </div>

            <p className="text-[11px] text-navy-400 leading-relaxed">
              Estos cambios solo afectan al snapshot de esta factura. No modifican el registro maestro del cliente.
            </p>

            <div className="flex justify-end gap-3 pt-4 border-t border-surface-200">
              <button onClick={() => setEditInvoice(null)} className="btn-secondary" disabled={loading}>Cancelar</button>
              <button onClick={handleSaveEdit} disabled={loading} className="btn-primary">{loading ? 'Guardando...' : 'Guardar Cambios'}</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
