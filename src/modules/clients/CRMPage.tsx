import { useState, useMemo, useCallback } from 'react';
import { useAppStore } from '@/store/appStore';
import { useCurrency } from '@/hooks/useCurrency';
import { useToast } from '@/components/Toast';
import { Modal } from '@/components/Modal';
import {
  Users, Crown, TrendingUp, ShoppingBag, Phone, Mail, MapPin,
  Download, Search, ChevronRight, ArrowUpDown, MessageCircle,
  Calendar, Star, Flame, Clock, Gift, Filter, Eye,
} from 'lucide-react';

// ════════════════════════════════════════
// Types
// ════════════════════════════════════════
interface ClientOrder {
  numericId: number;
  date: Date;
  total: number;
  status: string;
  deliveryType: string;
  items: { name: string; qty: number; price: number; size?: string; color?: string }[];
}

interface ClientAnalytics {
  id: string;
  name: string;
  rif_ci: string;
  phone: string;
  email: string;
  address: string;
  orders: number;
  revenue: number;
  avgTicket: number;
  lastPurchase: Date | null;
  firstPurchase: Date | null;
  daysSinceLast: number;
  favoriteProducts: { name: string; qty: number }[];
  segment: 'vip' | 'frecuente' | 'regular' | 'nuevo' | 'inactivo';
  monthlySpend: { month: string; amount: number }[];
  orderHistory: ClientOrder[];
}

// ════════════════════════════════════════
// Helpers
// ════════════════════════════════════════
function toDate(d: any): Date {
  if (d?.toDate) return d.toDate();
  if (d instanceof Date) return d;
  return new Date(d);
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor(Math.abs(b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

const SEGMENT_CONFIG = {
  vip: { label: 'VIP', color: 'bg-amber-100 text-amber-800', icon: Crown, desc: 'Top 10% en gasto' },
  frecuente: { label: 'Frecuente', color: 'bg-blue-100 text-blue-800', icon: Flame, desc: '5+ compras' },
  regular: { label: 'Regular', color: 'bg-gray-100 text-gray-700', icon: Users, desc: '2-4 compras' },
  nuevo: { label: 'Nuevo', color: 'bg-emerald-100 text-emerald-800', icon: Star, desc: 'Primera compra < 30 días' },
  inactivo: { label: 'Inactivo', color: 'bg-red-100 text-red-700', icon: Clock, desc: 'Sin compra en 60+ días' },
};

// ════════════════════════════════════════
// CRM Page
// ════════════════════════════════════════
export function CRMPage() {
  const invoices = useAppStore((s) => s.invoices);
  const products = useAppStore((s) => s.products);
  const { format } = useCurrency();
  const toast = useToast();

  const [search, setSearch] = useState('');
  const [segFilter, setSegFilter] = useState<string>('all');
  const [sortKey, setSortKey] = useState<'revenue' | 'orders' | 'lastPurchase' | 'name'>('revenue');
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');
  const [selectedClient, setSelectedClient] = useState<ClientAnalytics | null>(null);

  // ── Build client analytics from invoices ──
  const clientAnalytics = useMemo(() => {
    const now = new Date();
    const valid = invoices.filter((inv: any) => inv.status !== 'Cancelado' && inv.status !== 'Devolución');
    const map: Record<string, {
      name: string; rif_ci: string; phone: string; email: string; address: string;
      orders: number; revenue: number; dates: Date[]; products: Record<string, number>;
      monthlyMap: Record<string, number>; invoicesList: ClientOrder[];
    }> = {};

    valid.forEach((inv: any) => {
      // Identify client
      const clientId = inv.clientId || inv.clientSnapshot?.rif_ci || inv.clientSnapshot?.name || '';
      if (!clientId) return;
      const cs = inv.clientSnapshot || {};
      const name = cs.name || 'Desconocido';
      if (name.toLowerCase().includes('consumidor final') || name === 'Desconocido') return;

      if (!map[clientId]) {
        map[clientId] = {
          name: name, rif_ci: cs.rif_ci || cs.cedula || '', phone: cs.phone || '',
          email: cs.email || '', address: cs.address || cs.direccion || '',
          orders: 0, revenue: 0, dates: [], products: {}, monthlyMap: {}, invoicesList: [],
        };
      }

      const c = map[clientId];
      // Update with latest snapshot data
      if (cs.name && cs.name !== 'Desconocido') c.name = cs.name;
      if (cs.phone) c.phone = cs.phone;
      if (cs.email) c.email = cs.email;
      if (cs.address || cs.direccion) c.address = cs.address || cs.direccion;
      if (cs.rif_ci || cs.cedula) c.rif_ci = cs.rif_ci || cs.cedula;

      c.orders += 1;
      c.revenue += inv.total || 0;

      const d = toDate(inv.date);
      c.dates.push(d);

      // Monthly
      const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      c.monthlyMap[mk] = (c.monthlyMap[mk] || 0) + (inv.total || 0);

      // Products
      (inv.items || []).forEach((item: any) => {
        const pName = item.productName || item.titulo || item.name || 'Producto';
        const qty = item.quantity || item.qty || 1;
        c.products[pName] = (c.products[pName] || 0) + qty;
      });

      // Order history
      c.invoicesList.push({
        numericId: inv.numericId || 0,
        date: d,
        total: inv.total || 0,
        status: inv.status || 'Creada',
        deliveryType: inv.deliveryType || 'pickup',
        items: (inv.items || []).map((item: any) => ({
          name: item.productName || item.titulo || item.name || 'Producto',
          qty: item.quantity || item.qty || 1,
          price: parseFloat(item.priceAtSale) || parseFloat(item.price) || parseFloat(item.precio) || 0,
          size: item.size || item.selectedSize || '',
          color: item.color || item.selectedColor || '',
        })),
      });
    });

    // Calculate percentiles for VIP
    const revenues = Object.values(map).map((c) => c.revenue).sort((a, b) => b - a);
    const vipThreshold = revenues[Math.floor(revenues.length * 0.1)] || Infinity;

    return Object.entries(map).map(([id, c]): ClientAnalytics => {
      c.dates.sort((a, b) => b.getTime() - a.getTime());
      const lastPurchase = c.dates[0] || null;
      const firstPurchase = c.dates[c.dates.length - 1] || null;
      const daysSinceLast = lastPurchase ? daysBetween(lastPurchase, now) : 999;

      // Segment
      let segment: ClientAnalytics['segment'] = 'regular';
      if (c.revenue >= vipThreshold && c.orders >= 3) segment = 'vip';
      else if (c.orders >= 5) segment = 'frecuente';
      else if (firstPurchase && daysBetween(firstPurchase, now) <= 30) segment = 'nuevo';
      else if (daysSinceLast >= 60) segment = 'inactivo';
      else if (c.orders <= 1) segment = 'nuevo';

      // Fav products
      const favoriteProducts = Object.entries(c.products)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, qty]) => ({ name, qty }));

      // Monthly
      const monthlySpend = Object.entries(c.monthlyMap)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .slice(-6)
        .map(([month, amount]) => ({ month, amount }));

      return {
        id, name: c.name, rif_ci: c.rif_ci, phone: c.phone, email: c.email,
        address: c.address, orders: c.orders, revenue: c.revenue,
        avgTicket: c.orders > 0 ? c.revenue / c.orders : 0,
        lastPurchase, firstPurchase, daysSinceLast, favoriteProducts, segment, monthlySpend,
        orderHistory: c.invoicesList.sort((a, b) => b.date.getTime() - a.date.getTime()),
      };
    });
  }, [invoices]);

  // ── KPIs ──
  const kpis = useMemo(() => {
    const total = clientAnalytics.length;
    const totalRevenue = clientAnalytics.reduce((s, c) => s + c.revenue, 0);
    const avgRevenue = total > 0 ? totalRevenue / total : 0;
    const vipCount = clientAnalytics.filter((c) => c.segment === 'vip').length;
    const inactiveCount = clientAnalytics.filter((c) => c.segment === 'inactivo').length;
    const repeatRate = total > 0 ? (clientAnalytics.filter((c) => c.orders >= 2).length / total * 100) : 0;
    return { total, totalRevenue, avgRevenue, vipCount, inactiveCount, repeatRate };
  }, [clientAnalytics]);

  // ── Filtered + Sorted ──
  const filtered = useMemo(() => {
    let list = [...clientAnalytics];
    if (segFilter !== 'all') list = list.filter((c) => c.segment === segFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((c) =>
        c.name.toLowerCase().includes(q) ||
        c.rif_ci.includes(q) ||
        c.phone.includes(q)
      );
    }
    list.sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'revenue') cmp = a.revenue - b.revenue;
      else if (sortKey === 'orders') cmp = a.orders - b.orders;
      else if (sortKey === 'lastPurchase') cmp = (a.lastPurchase?.getTime() || 0) - (b.lastPurchase?.getTime() || 0);
      else cmp = a.name.localeCompare(b.name);
      return sortDir === 'desc' ? -cmp : cmp;
    });
    return list;
  }, [clientAnalytics, search, segFilter, sortKey, sortDir]);

  // ── Export CSV ──
  const handleExport = useCallback(() => {
    const headers = ['Nombre', 'Cédula/RIF', 'Teléfono', 'Email', 'Dirección', 'Pedidos', 'Gasto Total ($)', 'Ticket Promedio ($)', 'Última Compra', 'Segmento'];
    const rows = filtered.map((c) => [
      c.name, c.rif_ci, c.phone, c.email, `"${c.address}"`, c.orders,
      c.revenue.toFixed(2), c.avgTicket.toFixed(2),
      c.lastPurchase ? c.lastPurchase.toLocaleDateString('es-VE') : '—',
      SEGMENT_CONFIG[c.segment].label,
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `clientes-alonzo-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`${filtered.length} clientes exportados.`);
  }, [filtered, toast]);

  function handleSort(key: typeof sortKey) {
    if (sortKey === key) setSortDir((d) => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(key); setSortDir('desc'); }
  }

  function whatsappLink(phone: string, name: string) {
    const clean = phone.replace(/\D/g, '');
    const intl = clean.startsWith('0') ? '58' + clean.slice(1) : clean;
    const msg = encodeURIComponent(`Hola ${name.split(' ')[0]}! 👋 Te escribimos desde ALONZO.`);
    return `https://wa.me/${intl}?text=${msg}`;
  }

  return (
    <div className="space-y-6 animate-fade-up">
      {/* ═══ Header ═══ */}
      <div className="card p-5">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white">
              <Users size={20} />
            </div>
            <div>
              <h1 className="text-xl font-display font-bold text-navy-900">CRM — Panel de Clientes</h1>
              <p className="text-navy-400 text-sm">{kpis.total} clientes · Marketing & Retención</p>
            </div>
          </div>
          <button onClick={handleExport} className="btn-primary text-sm whitespace-nowrap">
            <Download size={14} /> Exportar CSV
          </button>
        </div>
      </div>

      {/* ═══ KPI Cards ═══ */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <MiniKpi icon={<Users size={16} />} color="from-blue-500 to-blue-600" label="Total Clientes" value={`${kpis.total}`} />
        <MiniKpi icon={<Crown size={16} />} color="from-amber-500 to-orange-600" label="Clientes VIP" value={`${kpis.vipCount}`} />
        <MiniKpi icon={<TrendingUp size={16} />} color="from-emerald-500 to-green-600" label="Tasa Recompra" value={`${kpis.repeatRate.toFixed(0)}%`} />
        <MiniKpi icon={<ShoppingBag size={16} />} color="from-violet-500 to-purple-600" label="Ticket Promedio" value={format(kpis.avgRevenue)} />
        <MiniKpi icon={<Clock size={16} />} color="from-red-500 to-rose-600" label="Inactivos" value={`${kpis.inactiveCount}`} />
      </div>

      {/* ═══ Segment Filter + Search ═══ */}
      <div className="card p-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex gap-2 flex-wrap flex-1">
            <SegBtn label="Todos" active={segFilter === 'all'} count={clientAnalytics.length} onClick={() => setSegFilter('all')} />
            {(Object.keys(SEGMENT_CONFIG) as Array<keyof typeof SEGMENT_CONFIG>).map((seg) => (
              <SegBtn key={seg} label={SEGMENT_CONFIG[seg].label} active={segFilter === seg}
                count={clientAnalytics.filter((c) => c.segment === seg).length}
                onClick={() => setSegFilter(seg)} />
            ))}
          </div>
          <div className="relative w-full sm:w-72">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-navy-300" />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              className="input-field pl-9 text-sm" placeholder="Buscar nombre, CI o teléfono..." />
          </div>
        </div>
      </div>

      {/* ═══ Ranking Table ═══ */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-surface-200 bg-surface-50">
                <th className="text-left px-4 py-3 w-8">
                  <span className="text-[10px] font-display font-semibold text-navy-400 uppercase">#</span>
                </th>
                <th className="text-left px-4 py-3">
                  <SortBtn label="Cliente" field="name" current={sortKey} dir={sortDir} onSort={handleSort} />
                </th>
                <th className="text-left px-4 py-3">
                  <span className="text-[10px] font-display font-semibold text-navy-400 uppercase tracking-wider">Segmento</span>
                </th>
                <th className="text-right px-4 py-3">
                  <SortBtn label="Gasto Total" field="revenue" current={sortKey} dir={sortDir} onSort={handleSort} />
                </th>
                <th className="text-right px-4 py-3">
                  <SortBtn label="Pedidos" field="orders" current={sortKey} dir={sortDir} onSort={handleSort} />
                </th>
                <th className="text-right px-4 py-3">
                  <span className="text-[10px] font-display font-semibold text-navy-400 uppercase tracking-wider">Ticket Prom.</span>
                </th>
                <th className="text-right px-4 py-3">
                  <SortBtn label="Última Compra" field="lastPurchase" current={sortKey} dir={sortDir} onSort={handleSort} />
                </th>
                <th className="text-right px-4 py-3 w-24">
                  <span className="text-[10px] font-display font-semibold text-navy-400 uppercase tracking-wider">Acción</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100">
              {filtered.slice(0, 50).map((c, i) => {
                const seg = SEGMENT_CONFIG[c.segment];
                return (
                  <tr key={c.id} className="hover:bg-surface-50 transition-colors group">
                    <td className="px-4 py-3">
                      <span className="text-xs font-mono text-navy-300">{i + 1}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-100 to-purple-100 flex items-center justify-center flex-shrink-0">
                          <span className="text-[10px] font-bold text-violet-700">{c.name.charAt(0)}</span>
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-display font-semibold text-navy-900 truncate">{c.name}</p>
                          <p className="text-[10px] text-navy-400 font-mono">{c.rif_ci || '—'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold ${seg.color}`}>
                        <seg.icon size={10} /> {seg.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-sm font-mono font-bold text-navy-900">{format(c.revenue)}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-sm font-mono text-navy-700">{c.orders}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-sm font-mono text-navy-500">{format(c.avgTicket)}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div>
                        <span className="text-xs text-navy-600">
                          {c.lastPurchase ? c.lastPurchase.toLocaleDateString('es-VE', { day: '2-digit', month: 'short' }) : '—'}
                        </span>
                        {c.daysSinceLast < 999 && (
                          <p className={`text-[9px] ${c.daysSinceLast <= 7 ? 'text-emerald-600' : c.daysSinceLast <= 30 ? 'text-navy-400' : 'text-red-500'}`}>
                            hace {c.daysSinceLast}d
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => setSelectedClient(c)} title="Ver detalle"
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-navy-400 hover:bg-blue-50 hover:text-blue-600 transition-colors">
                          <Eye size={14} />
                        </button>
                        {c.phone && (
                          <a href={whatsappLink(c.phone, c.name)} target="_blank" rel="noopener noreferrer" title="WhatsApp"
                            className="w-7 h-7 rounded-lg flex items-center justify-center text-navy-400 hover:bg-emerald-50 hover:text-emerald-600 transition-colors">
                            <MessageCircle size={14} />
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filtered.length > 50 && (
          <div className="p-3 text-center text-xs text-navy-400 border-t border-surface-100">
            Mostrando 50 de {filtered.length} clientes. Usa los filtros para refinar o exporta el CSV completo.
          </div>
        )}
        {filtered.length === 0 && (
          <div className="p-16 text-center">
            <Users size={40} className="mx-auto text-navy-200 mb-3" />
            <p className="text-navy-400 text-sm">No hay clientes con estos filtros.</p>
          </div>
        )}
      </div>

      {/* ═══ Client Detail Modal ═══ */}
      {selectedClient && (
        <ClientDetailModal client={selectedClient} format={format} onClose={() => setSelectedClient(null)} whatsappLink={whatsappLink} />
      )}
    </div>
  );
}

// ════════════════════════════════════════
// Client Detail Modal
// ════════════════════════════════════════
function ClientDetailModal({ client, format, onClose, whatsappLink }: {
  client: ClientAnalytics; format: (n: number) => string; onClose: () => void;
  whatsappLink: (phone: string, name: string) => string;
}) {
  const seg = SEGMENT_CONFIG[client.segment];
  const maxMonthly = Math.max(...client.monthlySpend.map((m) => m.amount), 1);
  const [expandedOrder, setExpandedOrder] = useState<number | null>(null);
  const STATUS_COLORS: Record<string, string> = {
    'Finalizado': 'bg-emerald-100 text-emerald-700',
    'Pendiente de pago': 'bg-amber-100 text-amber-700',
    'Creada': 'bg-blue-100 text-blue-700',
    'Cancelado': 'bg-red-100 text-red-600',
    'Devolución': 'bg-gray-100 text-gray-600',
  };

  return (
    <Modal open={true} onClose={onClose} title="">
      <div className="space-y-5 -mt-2 max-h-[75vh] overflow-y-auto pr-1 custom-scrollbar">
        {/* Header */}
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-gradient-to-br from-violet-100 to-purple-200 flex items-center justify-center flex-shrink-0">
            <span className="text-lg font-bold text-violet-700">{client.name.charAt(0)}</span>
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-display font-bold text-navy-900 truncate">{client.name}</h2>
            <div className="flex items-center gap-2 mt-1">
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold ${seg.color}`}>
                <seg.icon size={10} /> {seg.label}
              </span>
              {client.rif_ci && <span className="text-xs font-mono text-navy-400">CI: {client.rif_ci}</span>}
            </div>
          </div>
        </div>

        {/* Contact Info */}
        <div className="grid grid-cols-2 gap-2">
          {client.phone && (
            <div className="flex items-center gap-2 p-2.5 bg-surface-50 rounded-lg">
              <Phone size={13} className="text-navy-400" />
              <span className="text-sm text-navy-700">{client.phone}</span>
            </div>
          )}
          {client.email && (
            <div className="flex items-center gap-2 p-2.5 bg-surface-50 rounded-lg">
              <Mail size={13} className="text-navy-400" />
              <span className="text-sm text-navy-700 truncate">{client.email}</span>
            </div>
          )}
          {client.address && (
            <div className="col-span-2 flex items-center gap-2 p-2.5 bg-surface-50 rounded-lg">
              <MapPin size={13} className="text-navy-400 flex-shrink-0" />
              <span className="text-sm text-navy-700 truncate">{client.address}</span>
            </div>
          )}
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-4 gap-2">
          <div className="text-center p-2.5 bg-blue-50 rounded-xl">
            <p className="text-lg font-display font-bold text-blue-700">{client.orders}</p>
            <p className="text-[9px] text-blue-500 font-medium">Pedidos</p>
          </div>
          <div className="text-center p-2.5 bg-emerald-50 rounded-xl">
            <p className="text-base font-display font-bold text-emerald-700">{format(client.revenue)}</p>
            <p className="text-[9px] text-emerald-500 font-medium">Total</p>
          </div>
          <div className="text-center p-2.5 bg-violet-50 rounded-xl">
            <p className="text-base font-display font-bold text-violet-700">{format(client.avgTicket)}</p>
            <p className="text-[9px] text-violet-500 font-medium">Prom.</p>
          </div>
          <div className="text-center p-2.5 bg-amber-50 rounded-xl">
            <p className="text-base font-display font-bold text-amber-700">{client.daysSinceLast < 999 ? `${client.daysSinceLast}d` : '—'}</p>
            <p className="text-[9px] text-amber-500 font-medium">Últ. Compra</p>
          </div>
        </div>

        {/* Monthly Spend Chart */}
        {client.monthlySpend.length > 1 && (
          <div>
            <p className="text-[10px] font-display font-semibold text-navy-400 uppercase tracking-wider mb-2">Gasto Mensual</p>
            <div className="flex items-end gap-2 h-16">
              {client.monthlySpend.map((m, i) => {
                const h = Math.max((m.amount / maxMonthly) * 52, 4);
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full bg-gradient-to-t from-blue-500 to-blue-400 rounded-t transition-all"
                      style={{ height: `${h}px` }} title={format(m.amount)} />
                    <span className="text-[8px] text-navy-400">{m.month.split('-')[1]}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ═══ HISTORIAL DE PEDIDOS ═══ */}
        <div>
          <p className="text-[10px] font-display font-semibold text-navy-400 uppercase tracking-wider mb-3">
            Historial de Pedidos ({client.orderHistory.length})
          </p>
          <div className="space-y-2">
            {client.orderHistory.map((order, idx) => {
              const isOpen = expandedOrder === idx;
              const statusColor = STATUS_COLORS[order.status] || 'bg-gray-100 text-gray-600';
              return (
                <div key={idx} className={`border rounded-lg overflow-hidden transition-colors ${isOpen ? 'border-blue-300' : 'border-surface-200'}`}>
                  {/* Order header */}
                  <button
                    onClick={() => setExpandedOrder(isOpen ? null : idx)}
                    className={`w-full flex items-center justify-between px-3 py-2.5 text-left transition-colors ${isOpen ? 'bg-blue-50' : 'hover:bg-surface-50'}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="text-center w-14 flex-shrink-0">
                        <p className="text-[10px] font-bold text-navy-900 font-mono">#{String(order.numericId).padStart(4, '0')}</p>
                        <p className="text-[8px] text-navy-400">
                          {order.date.toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: '2-digit' })}
                        </p>
                      </div>
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold ${statusColor}`}>
                        {order.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <p className="text-sm font-mono font-bold text-navy-900">{format(order.total)}</p>
                        <p className="text-[9px] text-navy-400">{order.items.length} producto{order.items.length > 1 ? 's' : ''}</p>
                      </div>
                      <ChevronRight size={14} className={`text-navy-300 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                    </div>
                  </button>

                  {/* Order items (expandable) */}
                  {isOpen && (
                    <div className="px-3 py-2 border-t border-surface-100 bg-surface-50/50">
                      <div className="space-y-1.5">
                        {order.items.map((item, iIdx) => (
                          <div key={iIdx} className="flex items-center justify-between py-1">
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-display font-medium text-navy-900 truncate">{item.name}</p>
                              <p className="text-[9px] text-navy-400">
                                {item.size && <span>{item.size}</span>}
                                {item.size && item.color && <span> / </span>}
                                {item.color && <span>{item.color}</span>}
                                {(item.size || item.color) && <span> · </span>}
                                Cant: {item.qty}
                              </p>
                            </div>
                            <span className="text-xs font-mono font-semibold text-navy-700 ml-2">
                              {format(item.price * item.qty)}
                            </span>
                          </div>
                        ))}
                      </div>
                      <div className="flex justify-between mt-2 pt-2 border-t border-surface-200">
                        <span className="text-[10px] text-navy-400">
                          {order.deliveryType === 'delivery' ? '🚚 Delivery' : order.deliveryType === 'nacional' ? '📦 Nacional' : '🏪 Retiro'}
                        </span>
                        <span className="text-xs font-mono font-bold text-navy-900">Total: {format(order.total)}</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Favorite Products */}
        {client.favoriteProducts.length > 0 && (
          <div>
            <p className="text-[10px] font-display font-semibold text-navy-400 uppercase tracking-wider mb-2">Productos Más Comprados</p>
            <div className="space-y-1.5">
              {client.favoriteProducts.map((p, i) => (
                <div key={i} className="flex items-center justify-between py-1">
                  <div className="flex items-center gap-2">
                    <span className={`w-5 h-5 rounded flex items-center justify-center text-[9px] font-bold flex-shrink-0 ${
                      i === 0 ? 'bg-amber-100 text-amber-700' : i === 1 ? 'bg-gray-100 text-gray-600' : 'bg-surface-100 text-navy-400'
                    }`}>{i + 1}</span>
                    <span className="text-sm text-navy-700 truncate">{p.name}</span>
                  </div>
                  <span className="text-xs font-mono text-navy-400 ml-2">{p.qty} uds</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-3 border-t border-surface-200 sticky bottom-0 bg-[var(--bg-card)]">
          {client.phone && (
            <a href={whatsappLink(client.phone, client.name)} target="_blank" rel="noopener noreferrer"
              className="btn-primary text-sm flex-1 flex items-center justify-center gap-2">
              <MessageCircle size={14} /> WhatsApp
            </a>
          )}
          {client.email && (
            <a href={`mailto:${client.email}`}
              className="btn-secondary text-sm flex-1 flex items-center justify-center gap-2">
              <Mail size={14} /> Email
            </a>
          )}
          <button onClick={onClose} className="btn-secondary text-sm">Cerrar</button>
        </div>
      </div>
    </Modal>
  );
}

// ════════════════════════════════════════
// Sub-components
// ════════════════════════════════════════
function MiniKpi({ icon, color, label, value }: { icon: React.ReactNode; color: string; label: string; value: string }) {
  return (
    <div className="card p-4 relative overflow-hidden">
      <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${color}`} />
      <div className="flex items-center gap-3">
        <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${color} flex items-center justify-center text-white`}>{icon}</div>
        <div>
          <p className="text-[10px] text-navy-400 font-display uppercase tracking-wider">{label}</p>
          <p className="text-lg font-display font-bold text-navy-900">{value}</p>
        </div>
      </div>
    </div>
  );
}

function SegBtn({ label, active, count, onClick }: { label: string; active: boolean; count: number; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-xs font-display font-medium transition-all flex items-center gap-1.5
        ${active ? 'bg-navy-900 text-white' : 'bg-surface-100 text-navy-500 hover:bg-surface-200'}`}>
      {label}
      <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${active ? 'bg-white/20' : 'bg-surface-200'}`}>{count}</span>
    </button>
  );
}

function SortBtn({ label, field, current, dir, onSort }: {
  label: string; field: string; current: string; dir: string; onSort: (k: any) => void;
}) {
  const active = current === field;
  return (
    <button onClick={() => onSort(field)}
      className={`flex items-center gap-1 text-[10px] font-display font-semibold uppercase tracking-wider transition-colors
        ${active ? 'text-navy-900' : 'text-navy-400 hover:text-navy-600'}`}>
      {label} <ArrowUpDown size={10} className={active ? 'text-navy-700' : 'text-navy-300'} />
    </button>
  );
}
