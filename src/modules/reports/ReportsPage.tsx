import { useState, useMemo, useEffect } from 'react';
import { useAppStore } from '@/store/appStore';
import { useCurrency } from '@/hooks/useCurrency';
import { DELIVERY_TYPES } from '@/config/constants';
import { PAYMENT_METHODS, fetchInvoicesByDateRange } from '@/modules/invoices/invoiceService';
import { exportSalesData } from '@/services/excelService';
import { calcDiscountAmount } from '@/utils/discountUtils';
import {
  BarChart3, TrendingUp, Download, Package, Filter, ChevronDown,
  ShoppingBag, DollarSign, Hash, Check, X as XIcon, Loader2, Megaphone,
} from 'lucide-react';
import { todayVE, toDate } from '@/utils/dateUtils';
import { isCountableSale } from '@/utils/invoiceStatus';
import { AdSpendReport } from './AdSpendReport';

type Tab = 'general' | 'products' | 'adSpend';

export function ReportsPage() {
  const invoices = useAppStore((s) => s.invoices);
  const products = useAppStore((s) => s.products);
  const clients = useAppStore((s) => s.clients);
  const users = useAppStore((s) => s.users);
  const { format } = useCurrency();

  const today = todayVE();
  const [tab, setTab] = useState<Tab>('general');
  const [showFilters, setShowFilters] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 15;

  // Draft filters
  const [dStart, setDStart] = useState(today);
  const [dEnd, setDEnd] = useState(today);
  const [dSeller, setDSeller] = useState('all');
  const [dMethod, setDMethod] = useState('all');
  const [dDelivery, setDDelivery] = useState('all');
  const [dGender, setDGender] = useState('all');
  const [dCategory, setDCategory] = useState('all');

  // Server-side fetched invoices (for full date range)
  const [serverInvoices, setServerInvoices] = useState<any[] | null>(null);
  const [fetchingServer, setFetchingServer] = useState(false);

  // Applied
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [sellerFilter, setSellerFilter] = useState('all');
  const [methodFilter, setMethodFilter] = useState('all');
  const [deliveryFilter, setDeliveryFilter] = useState('all');
  const [genderFilter, setGenderFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');

  // Auto-fetch today's invoices on mount
  useEffect(() => {
    (async () => {
      setFetchingServer(true);
      try {
        const results = await fetchInvoicesByDateRange(today, today);
        setServerInvoices(results);
      } catch { /* use store fallback */ }
      setFetchingServer(false);
    })();
  }, []);

  const categories = useMemo(() => {
    let prods = products;
    if (dGender !== 'all') prods = prods.filter((p) => p.gender === dGender);
    return ['all', ...new Set(prods.map((p) => p.category || 'Sin Categoría').filter(Boolean))];
  }, [products, dGender]);

  async function applyFilters() {
    setStartDate(dStart); setEndDate(dEnd); setSellerFilter(dSeller);
    setMethodFilter(dMethod); setDeliveryFilter(dDelivery);
    setGenderFilter(dGender); setCategoryFilter(dCategory);
    setCurrentPage(1);

    // Fetch all invoices for the date range from Firestore (no limit)
    setFetchingServer(true);
    try {
      const results = await fetchInvoicesByDateRange(dStart, dEnd);
      console.log(`[Informes] Fetched ${results.length} invoices for ${dStart} → ${dEnd}`);
      setServerInvoices(results);
    } catch (err) {
      console.error('[Informes] Error fetching invoices:', err);
      setServerInvoices(null);
    }
    setFetchingServer(false);
  }
  function clearFilters() {
    setDStart(today); setDEnd(today); setDSeller('all'); setDMethod('all');
    setDDelivery('all'); setDGender('all'); setDCategory('all');
    setStartDate(today); setEndDate(today); setSellerFilter('all');
    setMethodFilter('all'); setDeliveryFilter('all'); setGenderFilter('all'); setCategoryFilter('all');
    setCurrentPage(1);
    setServerInvoices(null);
  }
  const hasActive = sellerFilter !== 'all' || methodFilter !== 'all' || deliveryFilter !== 'all' || genderFilter !== 'all' || categoryFilter !== 'all';

  const filtered = useMemo(() => {
    // Merge inteligente: store (realtime via onSnapshot) + serverInvoices
    // (one-shot fetch). El store siempre tiene los últimos 500 invoices
    // actualizados en tiempo real. serverInvoices puede traer un rango
    // histórico más amplio. Priorizamos el store para IDs duplicados —
    // así una venta nueva, anulación o devolución se refleja al instante
    // sin necesidad de F5 / Aplicar.
    let source: any[];
    if (serverInvoices) {
      const storeIds = new Set(invoices.map((i: any) => i.id));
      source = [
        ...invoices,
        ...serverInvoices.filter((s: any) => !storeIds.has(s.id)),
      ];
    } else {
      source = invoices;
    }
    const s = new Date(startDate + 'T00:00:00'), e = new Date(endDate + 'T23:59:59');
    return source.filter((inv: any) => {
      if (!isCountableSale(inv.status)) return false;
      const d = toDate(inv.date); if (d && (d < s || d > e)) return false;
      if (sellerFilter !== 'all' && inv.sellerUid !== sellerFilter) return false;
      if (methodFilter !== 'all' && !(inv.payments?.some((p: any) => p.method === methodFilter))) return false;
      if (deliveryFilter !== 'all' && inv.deliveryType !== deliveryFilter) return false;
      if (genderFilter !== 'all' || categoryFilter !== 'all') {
        const ok = (inv.items || []).some((item: any) => {
          const p = products.find((pr) => pr.id === item.productId); if (!p) return false;
          if (genderFilter !== 'all' && p.gender !== genderFilter) return false;
          if (categoryFilter !== 'all' && (p.category || 'Sin Categoría') !== categoryFilter) return false;
          return true;
        }); if (!ok) return false;
      } return true;
    });
  }, [invoices, serverInvoices, startDate, endDate, sellerFilter, methodFilter, deliveryFilter, genderFilter, categoryFilter, products]);

  const generalTotals = useMemo(() => {
    let totalAll = 0, du = 0;
    filtered.forEach((inv: any) => {
      totalAll += Number(inv.total) || 0;
      du += Number(inv.deliveryCostUsd) || 0;
    });
    const su = totalAll - du;
    return { count: filtered.length, salesUsd: su, deliveryUsd: du, totalUsd: totalAll };
  }, [filtered]);

  const productsSummary = useMemo(() => {
    const summary: Record<string, { name: string; variant: string; quantity: number; totalUsd: number }> = {};
    let gt = 0, tq = 0, td = 0, oc = 0;
    filtered.forEach((inv: any) => {
      if (!inv.items) return;
      if (inv.status === 'Devolución' || inv.status === 'Cancelado' || inv.status === 'Devuelto' || inv.status === 'Anulado') return;
      const iDel = inv.deliveryCostUsd || 0, iReal = inv.total - iDel;
      let iSub = 0; let hasM = false;
      inv.items.forEach((item: any) => {
        const p = products.find((pr) => pr.id === item.productId); if (!p) return;
        const v = p.variants?.[item.variantIndex]; if (!v) return;
        const price = item.priceAtSale ?? v.price;
        const lineTotal = price * item.quantity;
        iSub += lineTotal - calcDiscountAmount(lineTotal, item.discount);
      });
      const factor = iSub > 0 ? iReal / iSub : 0;
      inv.items.forEach((item: any) => {
        const p = products.find((pr) => pr.id === item.productId); if (!p) return;
        if (genderFilter !== 'all' && p.gender !== genderFilter) return;
        if (categoryFilter !== 'all' && (p.category || 'Sin Categoría') !== categoryFilter) return;
        const v = p.variants?.[item.variantIndex]; if (!v) return;
        hasM = true;
        const price = item.priceAtSale ?? v.price;
        const lineTotal = price * item.quantity;
        const ib = lineTotal - calcDiscountAmount(lineTotal, item.discount);
        const net = ib * factor; gt += net; td += (price * item.quantity) - net; tq += item.quantity;
        const k = `${p.id}-${item.variantIndex}`;
        const label = item.variantLabel || `${v.size || 'N/A'} / ${v.color || 'N/A'}`;
        if (!summary[k]) summary[k] = { name: item.productName || p.name, variant: label, quantity: 0, totalUsd: 0 };
        summary[k].quantity += item.quantity; summary[k].totalUsd += net;
      });
      if (hasM) oc++;
    });
    return { items: Object.values(summary).sort((a, b) => b.quantity !== a.quantity ? b.quantity - a.quantity : b.totalUsd - a.totalUsd), grandTotal: gt, totalQty: tq, totalDiscount: td, orderCount: oc };
  }, [filtered, products, genderFilter, categoryFilter]);

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="card p-5">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-1 h-12 bg-rose-500 rounded-full" />
            <div><h1 className="text-xl font-display font-bold text-navy-900">Informes</h1>
              <p className="text-navy-400 text-sm">Reportes de ventas y productos</p></div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowFilters(!showFilters)}
              className={`btn-secondary text-sm ${showFilters ? 'border-rose-300 bg-rose-50' : ''}`}>
              <Filter size={14} /> Filtros <ChevronDown size={14} className={`transition-transform ${showFilters ? 'rotate-180' : ''}`} />
            </button>
            <button onClick={async () => { await exportSalesData(clients, startDate, endDate); }} className="btn-primary text-sm">
              <Download size={14} /> Excel
            </button>
          </div>
        </div>

        {showFilters && (
          <div className="mt-4 pt-4 border-t border-surface-200 animate-fade-up space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
              <div><label className="block text-[10px] font-display font-semibold text-navy-400 uppercase mb-1">Desde</label>
                <input type="date" value={dStart} onChange={(e) => setDStart(e.target.value)} className="input-field text-sm" /></div>
              <div><label className="block text-[10px] font-display font-semibold text-navy-400 uppercase mb-1">Hasta</label>
                <input type="date" value={dEnd} onChange={(e) => setDEnd(e.target.value)} className="input-field text-sm" /></div>
              <div><label className="block text-[10px] font-display font-semibold text-navy-400 uppercase mb-1">Vendedor</label>
                <select value={dSeller} onChange={(e) => setDSeller(e.target.value)} className="input-field text-sm">
                  <option value="all">Todos</option>{users.map((u: any) => <option key={u.uid || u.id} value={u.uid || u.id}>{u.nombre} {u.apellido}</option>)}</select></div>
              <div><label className="block text-[10px] font-display font-semibold text-navy-400 uppercase mb-1">Método</label>
                <select value={dMethod} onChange={(e) => setDMethod(e.target.value)} className="input-field text-sm">
                  <option value="all">Todos</option>{PAYMENT_METHODS.map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}</select></div>
              <div><label className="block text-[10px] font-display font-semibold text-navy-400 uppercase mb-1">Envío</label>
                <select value={dDelivery} onChange={(e) => setDDelivery(e.target.value)} className="input-field text-sm">
                  <option value="all">Todos</option>{DELIVERY_TYPES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}</select></div>
              <div><label className="block text-[10px] font-display font-semibold text-navy-400 uppercase mb-1">Género</label>
                <select value={dGender} onChange={(e) => { setDGender(e.target.value); setDCategory('all'); }} className="input-field text-sm">
                  <option value="all">Todos</option><option value="Hombre">Hombre</option><option value="Mujer">Mujer</option></select></div>
              <div><label className="block text-[10px] font-display font-semibold text-navy-400 uppercase mb-1">Categoría</label>
                <select value={dCategory} onChange={(e) => setDCategory(e.target.value)} className="input-field text-sm">
                  {categories.map((c) => <option key={c} value={c}>{c === 'all' ? 'Todas' : c}</option>)}</select></div>
              <div className="flex items-end gap-2">
                <button onClick={applyFilters} disabled={fetchingServer} className="btn-primary text-sm flex-1">{fetchingServer ? <><Loader2 size={14} className="animate-spin" /> Cargando...</> : <><Check size={14} /> Aplicar</>}</button>
                {hasActive && <button onClick={clearFilters} className="btn-ghost p-2.5 text-navy-400 hover:text-accent-red"><XIcon size={14} /></button>}
              </div>
            </div>
            {hasActive && (
              <div className="flex flex-wrap gap-2">
                {genderFilter !== 'all' && <span className="badge badge-blue">Género: {genderFilter}</span>}
                {categoryFilter !== 'all' && <span className="badge badge-amber">Categoría: {categoryFilter}</span>}
                {sellerFilter !== 'all' && <span className="badge badge-purple">Vendedor filtrado</span>}
                {methodFilter !== 'all' && <span className="badge badge-green">Método: {methodFilter}</span>}
                {deliveryFilter !== 'all' && <span className="badge badge-gray">Envío filtrado</span>}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-lg bg-white border border-surface-200">
        {([{ id: 'general' as Tab, label: 'Ventas Generales', icon: <TrendingUp size={14} /> },
           { id: 'products' as Tab, label: 'Productos Vendidos', icon: <Package size={14} /> },
           { id: 'adSpend' as Tab, label: 'Publicidad', icon: <Megaphone size={14} /> }]).map((t) => (
          <button key={t.id} onClick={() => { setTab(t.id); setCurrentPage(1); }}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-display font-semibold transition-all
              ${tab === t.id ? 'bg-navy-900 text-white shadow-sm' : 'text-navy-400 hover:text-navy-700'}`}>{t.icon} {t.label}</button>
        ))}
      </div>

      {/* GENERAL */}
      {tab === 'general' && (
        <div className="space-y-4 animate-fade-up">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[{ i: <Hash size={18} />, l: 'Pedidos', v: String(generalTotals.count), c: 'text-amber-600' },
              { i: <ShoppingBag size={18} />, l: 'Ventas (Sin Delivery)', v: format(generalTotals.salesUsd), c: 'text-navy-900' },
              { i: <BarChart3 size={18} />, l: 'Delivery', v: format(generalTotals.deliveryUsd), c: 'text-blue-600' },
              { i: <DollarSign size={18} />, l: 'Total General', v: format(generalTotals.totalUsd), c: 'text-emerald-600' }].map((c) => (
              <div key={c.l} className="card p-4 hover-lift"><div className="flex items-center gap-2 mb-2"><span className="text-navy-400">{c.i}</span>
                <span className="text-[10px] font-display font-semibold text-navy-400 uppercase">{c.l}</span></div>
                <p className={`text-xl font-mono font-bold ${c.c}`}>{c.v}</p></div>
            ))}
          </div>
          <div className="card overflow-hidden">
            {filtered.length === 0 ? (
              <div className="p-12 text-center"><BarChart3 size={40} className="mx-auto text-navy-200 mb-3" /><p className="text-navy-400 text-sm">Sin datos.</p></div>
            ) : (
              <>
                <div className="overflow-x-auto"><table className="w-full"><thead><tr className="border-b border-surface-200 bg-surface-50">
                  {['Fecha', 'Factura', 'Vendedor', 'Cliente', 'Método', 'Envío', 'Total'].map((h) => (
                    <th key={h} className="text-left text-[10px] font-display font-semibold text-navy-400 uppercase tracking-wider px-4 py-3">{h}</th>
                  ))}</tr></thead>
                  <tbody className="divide-y divide-surface-100">
                    {filtered.sort((a: any, b: any) => (toDate(b.date)?.getTime() || 0) - (toDate(a.date)?.getTime() || 0))
                      .slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)
                      .map((inv: any) => {
                        const d = toDate(inv.date); const cl = clients.find((c: any) => c.id === inv.clientId);
                        const dt = (DELIVERY_TYPES as any).find((t: any) => t.value === (inv as any).deliveryType || ((inv as any).deliveryType === 'local' && t.value === 'local'));
                        return (<tr key={inv.id} className="hover:bg-surface-50 transition-colors">
                          <td className="px-4 py-3 text-sm text-navy-500">{d?.toLocaleDateString('es-VE')}</td>
                          <td className="px-4 py-3 font-mono font-semibold text-sm text-navy-900">FACT-{String(inv.numericId).padStart(4, '0')}</td>
                          <td className="px-4 py-3 text-sm text-navy-500">{inv.sellerName || 'N/A'}</td>
                          <td className="px-4 py-3 text-sm text-navy-600 max-w-[120px] truncate">{(cl as any)?.name || inv.clientSnapshot?.name || 'General'}</td>
                          <td className="px-4 py-3 text-xs text-navy-400">{inv.payments?.map((p: any) => p.method).join(', ')}</td>
                          <td className="px-4 py-3 text-xs text-navy-400">{dt?.label || inv.deliveryType}</td>
                          <td className="px-4 py-3 font-mono font-semibold text-sm text-navy-900 text-right">{format(inv.total)}</td>
                        </tr>);
                      })}
                  </tbody></table></div>

                {/* Pagination Controls */}
                {filtered.length > itemsPerPage && (
                  <div className="px-4 py-3 bg-surface-50 border-t border-surface-200 flex items-center justify-between">
                    <p className="text-xs text-navy-400 font-display">
                      Mostrando <span className="font-semibold text-navy-700">{(currentPage - 1) * itemsPerPage + 1}</span> a <span className="font-semibold text-navy-700">{Math.min(currentPage * itemsPerPage, filtered.length)}</span> de <span className="font-semibold text-navy-700">{filtered.length}</span> ventas
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
              </>
            )}
          </div>
        </div>
      )}

      {/* PRODUCTS */}
      {tab === 'products' && (
        <div className="space-y-4 animate-fade-up">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[{ l: 'Total Neto', v: format(productsSummary.grandTotal), c: 'text-emerald-600' },
              { l: 'Descuentos', v: format(productsSummary.totalDiscount), c: 'text-accent-red' },
              { l: 'Ítems', v: String(productsSummary.totalQty), c: 'text-blue-600' },
              { l: 'Pedidos', v: String(productsSummary.orderCount), c: 'text-amber-600' }].map((c) => (
              <div key={c.l} className="card p-4 text-center hover-lift"><p className="text-[10px] font-display font-semibold text-navy-400 uppercase">{c.l}</p>
                <p className={`text-xl font-mono font-bold mt-1 ${c.c}`}>{c.v}</p></div>
            ))}
          </div>
          <div className="card overflow-hidden">
            {productsSummary.items.length === 0 ? (
              <div className="p-12 text-center"><Package size={40} className="mx-auto text-navy-200 mb-3" /><p className="text-navy-400 text-sm">Sin productos.</p></div>
            ) : (
              <div className="overflow-x-auto"><table className="w-full"><thead><tr className="border-b border-surface-200 bg-surface-50">
                {['#', 'Producto', 'Variante', 'Cantidad', 'Total Neto'].map((h) => (
                  <th key={h} className={`text-${['#', 'Cantidad', 'Total Neto'].includes(h) ? 'right' : 'left'} text-[10px] font-display font-semibold text-navy-400 uppercase tracking-wider px-4 py-3`}>{h}</th>
                ))}</tr></thead>
                <tbody className="divide-y divide-surface-100">
                  {productsSummary.items.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage).map((item, i) => (
                    <tr key={i} className="hover:bg-surface-50 transition-colors">
                      <td className="px-4 py-3 text-sm text-navy-300 text-right w-10">{(currentPage - 1) * itemsPerPage + i + 1}</td>
                      <td className="px-4 py-3 font-display font-semibold text-sm text-navy-900">{item.name}</td>
                      <td className="px-4 py-3 text-sm text-navy-500">{item.variant}</td>
                      <td className="px-4 py-3 font-mono font-semibold text-sm text-navy-900 text-right">{item.quantity}</td>
                      <td className="px-4 py-3 font-mono font-bold text-sm text-emerald-600 text-right">{format(item.totalUsd)}</td>
                    </tr>))}
                </tbody></table></div>
            )}

            {/* Pagination Controls */}
            {productsSummary.items.length > itemsPerPage && (
              <div className="px-4 py-3 bg-surface-50 border-t border-surface-200 flex items-center justify-between">
                <p className="text-xs text-navy-400 font-display">
                  Mostrando <span className="font-semibold text-navy-700">{(currentPage - 1) * itemsPerPage + 1}</span> a <span className="font-semibold text-navy-700">{Math.min(currentPage * itemsPerPage, productsSummary.items.length)}</span> de <span className="font-semibold text-navy-700">{productsSummary.items.length}</span> productos
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
                    {currentPage} / {Math.ceil(productsSummary.items.length / itemsPerPage)}
                  </div>
                  <button
                    onClick={() => setCurrentPage(prev => Math.min(prev + 1, Math.ceil(productsSummary.items.length / itemsPerPage)))}
                    disabled={currentPage >= Math.ceil(productsSummary.items.length / itemsPerPage)}
                    className="btn-secondary px-3 py-1.5 text-xs disabled:opacity-50"
                  >
                    Siguiente
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* PUBLICIDAD */}
      {tab === 'adSpend' && (
        <div className="animate-fade-up">
          <AdSpendReport />
        </div>
      )}
    </div>
  );
}
