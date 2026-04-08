import { useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@/store/appStore';
import { useCurrency } from '@/hooks/useCurrency';
import { ROUTES } from '@/config/constants';
import {
  TrendingUp, TrendingDown, ShoppingCart, DollarSign, Package, AlertTriangle,
  CreditCard, Zap, ArrowUpRight, ArrowDownRight, Clock, Ticket, Filter,
  Plus, FileText, BarChart3, Eye, ChevronRight, Flame, Award, Star, Users, X as XIcon,
} from 'lucide-react';
import { fetchInvoicesByDateRange } from '@/modules/invoices/invoiceService';
import { useToast } from '@/components/Toast';
import type { Invoice, Product } from '@/types';

// ════════════════════════════════════════
// Helpers
// ════════════════════════════════════════
function toDate(d: any): Date {
  if (d?.toDate) return d.toDate();
  if (d instanceof Date) return d;
  return new Date(d);
}
function isSameDay(d1: Date, d2: Date): boolean {
  return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();
}
function isThisMonth(d: Date, now: Date): boolean {
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}
function isLastMonth(d: Date, now: Date): boolean {
  const last = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return d.getFullYear() === last.getFullYear() && d.getMonth() === last.getMonth();
}
function daysAgo(n: number): Date {
  const d = new Date(); d.setDate(d.getDate() - n); d.setHours(0, 0, 0, 0); return d;
}
function greetingByHour(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Buenos días';
  if (h < 18) return 'Buenas tardes';
  return 'Buenas noches';
}

// ════════════════════════════════════════
// Sparkline SVG
// ════════════════════════════════════════
function Sparkline({ data, color = '#3b82f6', height = 32, width = 80 }: { data: number[]; color?: string; height?: number; width?: number }) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  }).join(' ');
  const areaPoints = `0,${height} ${points} ${width},${height}`;
  return (
    <svg width={width} height={height} className="overflow-visible">
      <defs>
        <linearGradient id={`sg-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={areaPoints} fill={`url(#sg-${color.replace('#', '')})`} />
      <polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ════════════════════════════════════════
// Donut Chart SVG
// ════════════════════════════════════════
function DonutChart({ segments, size = 120 }: { segments: { value: number; color: string; label: string }[]; size?: number }) {
  const total = segments.reduce((s, seg) => s + seg.value, 0) || 1;
  const r = (size - 12) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  let offset = 0;

  return (
    <svg width={size} height={size} className="transform -rotate-90">
      {segments.map((seg, i) => {
        const pct = seg.value / total;
        const dash = pct * circumference;
        const gap = circumference - dash;
        const el = (
          <circle
            key={i} cx={cx} cy={cy} r={r}
            fill="none" stroke={seg.color} strokeWidth="10"
            strokeDasharray={`${dash} ${gap}`}
            strokeDashoffset={-offset}
            strokeLinecap="round"
            className="transition-all duration-700"
          />
        );
        offset += dash;
        return el;
      })}
    </svg>
  );
}

// ════════════════════════════════════════
// Dashboard Page
// ════════════════════════════════════════
export function DashboardPage() {
  const navigate = useNavigate();
  const storeInvoices = useAppStore((s) => s.invoices);
  const products = useAppStore((s) => s.products);
  const coupons = useAppStore((s) => s.coupons);
  const promotions = useAppStore((s) => s.promotions);
  const currentUser = useAppStore((s) => s.currentUser);
  const { format } = useCurrency();
  const toast = useToast();

  const [dStart, setDStart] = useState('');
  const [dEnd, setDEnd] = useState('');
  const [customInvoices, setCustomInvoices] = useState<Invoice[] | null>(null);
  const [loadingFilter, setLoadingFilter] = useState(false);

  const invoices = customInvoices || storeInvoices;
  const isCustomRange = customInvoices !== null;

  const [currentTime, setCurrentTime] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(t);
  }, []);

  const now = currentTime;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = daysAgo(1);

  // ── KPIs ──
  const kpis = useMemo(() => {
    const valid = invoices.filter((inv: any) => inv.status !== 'Cancelado' && inv.status !== 'Devolución');
    
    const pending = invoices.filter((inv: any) => inv.status === 'Pendiente de pago');
    const totalProducts = products.reduce((s: number, p: any) => s + (p.variants || []).reduce((vs: number, v: any) => vs + (typeof v.stock === 'string' ? parseInt(v.stock) : v.stock || 0), 0), 0);
    const pendingCount = pending.length;
    const pendingTotal = pending.reduce((s: number, inv: any) => s + (inv.total || 0), 0);
    const productCount = products.length;

    if (isCustomRange) {
      const revenue = valid.reduce((s: number, inv: any) => s + (inv.total || 0), 0);
      return {
        todayRevenue: revenue, todayCount: valid.length, todayAvg: valid.length > 0 ? revenue / valid.length : 0,
        yesterdayRevenue: 0, monthRevenue: 0, monthCount: 0, lastMonthRevenue: 0, dayGrowth: 0, monthGrowth: 0,
        pendingCount, pendingTotal, totalProducts, productCount,
      };
    }

    const todaySales = valid.filter((inv) => isSameDay(toDate(inv.date), today));
    const todayRevenue = todaySales.reduce((s, inv) => s + (inv.total || 0), 0);
    const yesterdaySales = valid.filter((inv) => isSameDay(toDate(inv.date), yesterday));
    const yesterdayRevenue = yesterdaySales.reduce((s, inv) => s + (inv.total || 0), 0);
    const monthSales = valid.filter((inv) => isThisMonth(toDate(inv.date), now));
    const monthRevenue = monthSales.reduce((s, inv) => s + (inv.total || 0), 0);
    const lastMonthSales = valid.filter((inv) => isLastMonth(toDate(inv.date), now));
    const lastMonthRevenue = lastMonthSales.reduce((s, inv) => s + (inv.total || 0), 0);
    const dayGrowth = yesterdayRevenue > 0 ? ((todayRevenue - yesterdayRevenue) / yesterdayRevenue) * 100 : 0;
    const monthGrowth = lastMonthRevenue > 0 ? ((monthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100 : 0;
    
    return {
      todayRevenue, todayCount: todaySales.length,
      todayAvg: todaySales.length > 0 ? todayRevenue / todaySales.length : 0,
      yesterdayRevenue, monthRevenue, monthCount: monthSales.length,
      lastMonthRevenue, dayGrowth, monthGrowth,
      pendingCount, pendingTotal, totalProducts, productCount,
    };
  }, [invoices, products, isCustomRange, today, yesterday, now]);

  // ── Daily revenue (last 7 days / range) ──
  const dailySales = useMemo(() => {
    const valid = invoices.filter((inv) => inv.status !== 'Cancelado' && inv.status !== 'Devolución');
    if (isCustomRange) {
      // Group by date string YYYY-MM-DD
      const map: Record<string, { label: string; day: number; revenue: number; count: number; dateValue: number }> = {};
      valid.forEach(inv => {
        const d = toDate(inv.date);
        const k = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
        if (!map[k]) {
          map[k] = { label: d.toLocaleDateString('es-VE', { weekday: 'short' }), day: d.getDate(), revenue: 0, count: 0, dateValue: d.getTime() };
        }
        map[k].revenue += (inv.total || 0);
        map[k].count += 1;
      });
      // Sort chronologically and take up to 7 items evenly distributed, or just last 7
      let sorted = Object.values(map).sort((a, b) => a.dateValue - b.dateValue);
      if (sorted.length === 0) {
        return [{ label: '-', day: 0, revenue: 0, count: 0 }];
      }
      return sorted;
    }
    
    return Array.from({ length: 7 }, (_, i) => {
      const d = daysAgo(6 - i);
      const dayInvs = valid.filter((inv) => isSameDay(toDate(inv.date), d));
      return {
        label: d.toLocaleDateString('es-VE', { weekday: 'short' }),
        day: d.getDate(),
        revenue: dayInvs.reduce((s, inv) => s + (inv.total || 0), 0),
        count: dayInvs.length,
      };
    });
  }, [invoices, isCustomRange]);
  const maxRev = Math.max(...dailySales.map((d) => d.revenue), 1);
  const sparklineData = dailySales.map((d) => d.revenue);

  // ── Top Products ──
  const topProducts = useMemo(() => {
    const valid = invoices.filter((inv) => inv.status !== 'Cancelado' && inv.status !== 'Devolución' && (isCustomRange ? true : isThisMonth(toDate(inv.date), now)));
    const map: Record<string, { name: string; qty: number; revenue: number }> = {};
    valid.forEach((inv) => (inv.items || []).forEach((item: any) => {
      const pid = item.productId;
      if (!pid) return;
      // Look up real product name from products array
      const realProduct = products.find((p) => p.id === pid);
      const displayName = realProduct?.name || item.productName || item.titulo || item.name || pid;
      if (!map[pid]) map[pid] = { name: displayName, qty: 0, revenue: 0 };
      map[pid].qty += item.quantity || item.qty || 0;
      const unitPrice = parseFloat(item.priceAtSale) || parseFloat(item.price) || parseFloat(item.precio) || 0;
      const qty = item.quantity || item.qty || 0;
      map[pid].revenue += item.rowTotal ? parseFloat(item.rowTotal) : (unitPrice * qty);
    }));
    return Object.values(map).sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  }, [invoices, products, isCustomRange, now]);
  const topMaxRev = topProducts[0]?.revenue || 1;

  // ── Top Clients ──
  const topClients = useMemo(() => {
    const valid = invoices.filter((inv) => inv.status !== 'Cancelado' && inv.status !== 'Devolución' && inv.clientSnapshot?.name && !inv.clientSnapshot.name.toLowerCase().includes('consumidor') && (isCustomRange ? true : isThisMonth(toDate(inv.date), now)));
    const map: Record<string, { name: string; qty: number; revenue: number }> = {};
    valid.forEach((inv) => {
      const cid = inv.clientId || inv.clientSnapshot?.id;
      if (!cid) return;
      const cname = inv.clientSnapshot?.name || 'Desconocido';
      if (!map[cid]) map[cid] = { name: cname, qty: 0, revenue: 0 };
      map[cid].qty += 1;
      map[cid].revenue += (inv.total || 0);
    });
    return Object.values(map).sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  }, [invoices]);
  const topMaxClientRev = topClients[0]?.revenue || 1;

  // ── Low Stock ──
  const lowStock = useMemo(() => {
    const alerts: { name: string; variant: string; stock: number }[] = [];
    products.forEach((p) => (p.variants || []).forEach((v: any) => {
      const s = typeof v.stock === 'string' ? parseInt(v.stock) : v.stock;
      if (s <= 3 && s >= 0) alerts.push({ name: p.name, variant: `${v.size} / ${v.color}`, stock: s });
    }));
    return alerts.sort((a, b) => a.stock - b.stock).slice(0, 8);
  }, [products]);

  // ── Payment Methods ──
  const paymentData = useMemo(() => {
    const valid = invoices.filter((inv) => inv.status !== 'Cancelado' && inv.status !== 'Devolución' && (isCustomRange ? true : isThisMonth(toDate(inv.date), now)));
    const map: Record<string, number> = {};
    valid.forEach((inv) => {
      const payments = inv.payments || [];
      if (payments.length === 0) return;
      if (payments.length === 1) {
        const n = payments[0].method || 'Otro';
        map[n] = (map[n] || 0) + (inv.total || 0);
      } else {
        // Multi-payment: safe proportioning to match inv.total
        let rawSum = 0;
        const vals = payments.map((p: any) => {
          const v = p.amountUsd || p.total || (p.amountVes ? p.amountVes / (inv.exchangeRate || 1) : 0);
          rawSum += v;
          return { name: p.method || 'Otro', val: v };
        });
        
        const invoiceTotal = inv.total || 0;
        vals.forEach(p => {
          const actualVal = rawSum > 0 ? (p.val / rawSum) * invoiceTotal : 0;
          map[p.name] = (map[p.name] || 0) + actualVal;
        });
      }
    });
    const colors = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#06b6d4', '#84cc16'];
    return Object.entries(map).sort((a, b) => b[1] - a[1]).map(([name, value], i) => ({
      name, value, color: colors[i % colors.length], label: name,
    }));
  }, [invoices, isCustomRange, now]);

  // ── Recent Invoices ──
  const recent = invoices.slice(0, 5);

  const activeCoupons = coupons.filter((c) => c.active).length;
  const activePromos = promotions.filter((p) => p.active).length;
  const totalCouponUses = coupons.reduce((s, c) => s + (c.usedCount || 0), 0);

  const userName = currentUser ? `${currentUser.nombre}` : '';

  async function handleFilter() {
    if (!dStart || !dEnd) return toast.warning('Selecciona ambas fechas.');
    if (new Date(dStart) > new Date(dEnd)) return toast.warning('La fecha inicio debe ser antes que la final.');
    setLoadingFilter(true);
    try {
      const results = await fetchInvoicesByDateRange(dStart, dEnd);
      if (results.length === 0) {
        toast.warning('No se encontraron facturas en ese rango.');
        setCustomInvoices(results);
      } else {
        setCustomInvoices(results);
        const totalRange = results.filter(i => i.status !== 'Cancelado' && i.status !== 'Devolución').reduce((s, i) => s + (i.total || 0), 0);
        toast.success(`${results.length} facturas encontradas · ${format(totalRange)} en ventas`);
      }
    } catch (err: any) {
      toast.error(err?.message || 'Error al filtrar.');
      console.error('Filter error:', err);
    } finally {
      setLoadingFilter(false);
    }
  }

  function clearFilter() {
    setCustomInvoices(null);
    setDStart('');
    setDEnd('');
  }

  return (
    <div className="space-y-6 animate-fade-up">
      {/* ═══ Welcome Header ═══ */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800 p-6 md:p-8 text-white">
        <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/3" />
        <div className="absolute bottom-0 left-1/2 w-40 h-40 bg-white/5 rounded-full translate-y-1/2" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <p className="text-blue-200 text-sm font-display">{greetingByHour()}</p>
            <h1 className="text-2xl md:text-3xl font-display font-bold mt-1">
              {userName ? `${userName} 👋` : 'Dashboard'}
            </h1>
            <p className="text-blue-200/80 text-sm mt-2 font-display">
              {now.toLocaleDateString('es-VE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              <span className="mx-2">·</span>
              {now.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })}
              {isCustomRange && (
                <span className="ml-3 px-2 py-0.5 rounded-full bg-white/20 text-white text-xs">
                  Modo Filtro Activo
                </span>
              )}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap items-center">
            <div className="flex flex-shrink-0 items-center gap-1 bg-white/10 rounded-lg p-1 mr-0 md:mr-2 border border-white/20">
              <input type="date" value={dStart} onChange={e => setDStart(e.target.value)} className="bg-transparent text-white text-xs p-1 outline-none [&::-webkit-calendar-picker-indicator]:invert" title="Fecha inicio" />
              <span className="text-white/50 text-xs">-</span>
              <input type="date" value={dEnd} onChange={e => setDEnd(e.target.value)} className="bg-transparent text-white text-xs p-1 outline-none [&::-webkit-calendar-picker-indicator]:invert" title="Fecha fin" />
              <button onClick={handleFilter} disabled={loadingFilter} className="bg-blue-500 hover:bg-blue-400 text-white p-1 rounded-md transition-colors" title="Filtrar">
                {loadingFilter ? <span className="px-1 font-bold">...</span> : <Filter size={14} />}
              </button>
              {isCustomRange && (
                <button onClick={clearFilter} className="bg-white/20 hover:bg-red-500 text-white p-1 rounded-md transition-colors" title="Quitar filtro">
                  <XIcon size={14} />
                </button>
              )}
            </div>
            
            <QuickAction icon={<ShoppingCart size={14} />} label="Nueva Venta" onClick={() => navigate(ROUTES.POS)} />
            <QuickAction icon={<Plus size={14} />} label="Añadir Producto" onClick={() => navigate(ROUTES.INVENTORY)} />
          </div>
        </div>
      </div>

      {/* ═══ KPI Cards ═══ */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          icon={<DollarSign size={18} />}
          gradient="from-emerald-500 to-green-600"
          title={isCustomRange ? "Ventas (Rango)" : "Ventas Hoy"}
          value={format(kpis.todayRevenue)}
          subtitle={`${kpis.todayCount} ventas realizadas`}
          trend={isCustomRange ? undefined : kpis.dayGrowth}
          trendLabel={isCustomRange ? undefined : "vs ayer"}
          sparkData={isCustomRange ? undefined : sparklineData}
          sparkColor="#10b981"
        />
        <KpiCard
          icon={<TrendingUp size={18} />}
          gradient="from-blue-500 to-indigo-600"
          title={isCustomRange ? "Promedio por Venta" : "Mes Actual"}
          value={isCustomRange ? format(kpis.todayAvg) : format(kpis.monthRevenue)}
          subtitle={isCustomRange ? "Calculado en rango" : `${kpis.monthCount} ventas · Promedio ${format(kpis.todayAvg)}`}
          trend={isCustomRange ? undefined : kpis.monthGrowth}
          trendLabel={isCustomRange ? undefined : "vs mes anterior"}
          sparkData={isCustomRange ? undefined : sparklineData}
          sparkColor="#3b82f6"
        />
        <KpiCard
          icon={<Package size={18} />}
          gradient="from-violet-500 to-purple-600"
          title="Inventario"
          value={`${kpis.totalProducts} uds`}
          subtitle={`${kpis.productCount} productos · ${lowStock.length} alertas`}
          badge={lowStock.length > 0 ? `${lowStock.length}` : undefined}
          badgeColor="bg-amber-500"
        />
        <KpiCard
          icon={<Clock size={18} />}
          gradient="from-amber-500 to-orange-600"
          title="Por Cobrar"
          value={format(kpis.pendingTotal)}
          subtitle={`${kpis.pendingCount} facturas pendientes`}
          badge={kpis.pendingCount > 0 ? `${kpis.pendingCount}` : undefined}
          badgeColor="bg-red-500"
        />
      </div>

      {/* ═══ Revenue Chart + Payment Methods ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Revenue Chart */}
        <div className="lg:col-span-2 card p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-base font-display font-bold text-navy-900">{isCustomRange ? 'Ingresos (Histórico del Rango)' : 'Ingresos — Últimos 7 Días'}</h2>
              <p className="text-xs text-navy-400 mt-0.5">{isCustomRange ? 'Ventas diarias generadas' : 'Comparativa diaria de ventas'}</p>
            </div>
            <div className="text-right">
              <p className="text-lg font-display font-bold text-navy-900">{format(dailySales.reduce((s, d) => s + d.revenue, 0))}</p>
              <p className="text-[10px] text-navy-400">{isCustomRange ? 'total del rango' : 'total 7 días'}</p>
            </div>
          </div>
          <div className={`flex items-end ${dailySales.length > 20 ? 'gap-[2px]' : dailySales.length > 10 ? 'gap-1.5' : 'gap-3'} pb-4`} style={{ height: '184px' }}>
            {dailySales.map((day, i) => {
              const barHeight = Math.max((day.revenue / maxRev) * 140, 6);
              const isLast = i === dailySales.length - 1;
              const isDense = dailySales.length > 14;
              return (
                <div key={i} className="flex-1 flex flex-col items-center justify-end group relative" style={{ height: '176px' }}>
                  <div className="absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-navy-900 text-white text-[9px] font-mono px-2 py-1 rounded-md whitespace-nowrap shadow-lg z-20 text-center pointer-events-none">
                    {format(day.revenue)} <br /> {day.count}v {isDense ? `| ${day.label}` : ''}
                  </div>
                  <div
                    className={`w-full ${isDense ? 'rounded-t-sm' : 'rounded-t-lg'} transition-all duration-700 ease-out ${
                      isLast
                        ? 'bg-gradient-to-t from-blue-600 to-blue-400 shadow-[0_0_12px_rgba(59,130,246,0.5)]'
                        : 'bg-gradient-to-t from-surface-300 to-surface-200 group-hover:from-blue-400 group-hover:to-blue-300'
                    }`}
                    style={{ height: `${barHeight}px` }}
                  />
                  <div className="text-center mt-2 flex-shrink-0 h-8 flex flex-col justify-start">
                    {!isDense && (
                      <p className={`text-[11px] font-display font-semibold leading-none mb-1 ${isLast ? 'text-blue-600' : 'text-navy-400'}`}>{day.label}</p>
                    )}
                    <p className={`text-[10px] font-mono leading-none ${isLast ? 'text-blue-500' : 'text-navy-300'} ${isDense && (i % 2 !== 0 && !isLast) ? 'opacity-0 md:opacity-100' : ''}`}>{day.day}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Payment Methods Donut */}
        <div className="card p-6">
          <h2 className="text-base font-display font-bold text-navy-900 mb-1">Métodos de Pago</h2>
          <p className="text-xs text-navy-400 mb-5">{isCustomRange ? 'Distribución del rango' : 'Distribución del mes'}</p>
          {paymentData.length === 0 ? (
            <p className="text-xs text-navy-400 py-8 text-center">Sin datos este mes.</p>
          ) : (
            <>
              <div className="flex justify-center mb-5">
                <div className="relative">
                  <DonutChart segments={paymentData} size={130} />
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <p className="text-lg font-display font-bold text-navy-900">{paymentData.length}</p>
                    <p className="text-[9px] text-navy-400">métodos</p>
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                {paymentData.slice(0, 5).map((m) => (
                  <div key={m.name} className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: m.color }} />
                    <span className="text-xs text-navy-600 flex-1 truncate">{m.name}</span>
                    <span className="text-xs font-mono font-semibold text-navy-900">{format(m.value)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ═══ Top Products + Alerts ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Top Products */}
        <div className="lg:col-span-2 card p-6">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <Flame size={16} className="text-orange-500" />
              <h2 className="text-base font-display font-bold text-navy-900">{isCustomRange ? 'Productos Top del Rango' : 'Productos Top del Mes'}</h2>
            </div>
            <button onClick={() => navigate(ROUTES.REPORTS)} className="text-xs text-blue-500 hover:text-blue-600 font-medium flex items-center gap-1">
              Ver reportes <ChevronRight size={12} />
            </button>
          </div>
          {topProducts.length === 0 ? (
            <p className="text-xs text-navy-400 py-8 text-center">Sin ventas este mes.</p>
          ) : (
            <div className="space-y-4">
              {topProducts.map((p, i) => {
                const pct = (p.revenue / topMaxRev) * 100;
                const medals = [
                  <Award key="g" size={16} className="text-amber-500" />,
                  <Award key="s" size={16} className="text-gray-400" />,
                  <Award key="b" size={16} className="text-amber-700" />,
                ];
                return (
                  <div key={i} className="group">
                    <div className="flex items-center gap-3 mb-1.5">
                      <div className="w-7 h-7 rounded-lg bg-surface-100 flex items-center justify-center flex-shrink-0">
                        {i < 3 ? medals[i] : <span className="text-[10px] font-bold text-navy-400">{i + 1}</span>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-display font-semibold text-navy-900 truncate">{p.name}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-mono font-bold text-navy-900">{format(p.revenue)}</p>
                        <p className="text-[10px] text-navy-400">{p.qty} uds</p>
                      </div>
                    </div>
                    <div className="ml-10 h-1.5 bg-surface-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all duration-700"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Column: Alerts + Promos */}
        <div className="space-y-6">
          {/* Low Stock */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <AlertTriangle size={15} className="text-amber-500" />
                <h2 className="text-sm font-display font-bold text-navy-900">Alertas de Stock</h2>
              </div>
              {lowStock.length > 0 && (
                <span className="w-5 h-5 rounded-full bg-amber-500 text-white text-[10px] font-bold flex items-center justify-center animate-pulse">
                  {lowStock.length}
                </span>
              )}
            </div>
            {lowStock.length === 0 ? (
              <div className="flex items-center gap-2 p-3 bg-emerald-50 rounded-lg">
                <Star size={14} className="text-emerald-500" />
                <p className="text-xs text-emerald-700 font-medium">Todo el inventario está bien</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-52 overflow-y-auto custom-scrollbar">
                {lowStock.map((a, i) => (
                  <div key={i} className="flex items-center justify-between p-2.5 rounded-lg bg-surface-50 border border-surface-100">
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-display font-semibold text-navy-900 truncate">{a.name}</p>
                      <p className="text-[9px] text-navy-400">{a.variant}</p>
                    </div>
                    <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-md flex-shrink-0 ${
                      a.stock === 0 ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                    }`}>
                      {a.stock === 0 ? 'AGOTADO' : `${a.stock} uds`}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Active Promos */}
          <div className="card p-5">
            <div className="flex items-center gap-2 mb-4">
              <Zap size={15} className="text-violet-500" />
              <h2 className="text-sm font-display font-bold text-navy-900">Marketing Activo</h2>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div className="bg-gradient-to-br from-violet-50 to-purple-50 border border-violet-100 rounded-xl p-3 text-center">
                <p className="text-2xl font-display font-bold text-violet-700">{activePromos}</p>
                <p className="text-[10px] text-violet-500 font-medium">Promociones</p>
              </div>
              <div className="bg-gradient-to-br from-pink-50 to-rose-50 border border-pink-100 rounded-xl p-3 text-center">
                <p className="text-2xl font-display font-bold text-pink-700">{activeCoupons}</p>
                <p className="text-[10px] text-pink-500 font-medium">Cupones</p>
              </div>
            </div>
            {totalCouponUses > 0 && (
              <div className="flex items-center gap-2 p-2.5 bg-surface-50 rounded-lg">
                <Ticket size={12} className="text-navy-400" />
                <p className="text-[10px] text-navy-500"><strong className="text-navy-700">{totalCouponUses}</strong> cupones canjeados</p>
              </div>
            )}
            <button onClick={() => navigate(ROUTES.OFFERS)}
              className="w-full mt-3 text-xs text-blue-500 hover:text-blue-600 font-medium flex items-center justify-center gap-1 py-2 rounded-lg hover:bg-blue-50 transition-colors">
              Gestionar ofertas <ChevronRight size={12} />
            </button>
          </div>
        </div>
      </div>

      {/* ═══ Bottom Row: Recent Activity & Top Clients ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Activity */}
        <div className="lg:col-span-2 card p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-base font-display font-bold text-navy-900">Actividad Reciente</h2>
            <button onClick={() => navigate(ROUTES.INVOICES)}
              className="text-xs text-blue-500 hover:text-blue-600 font-medium flex items-center gap-1">
              Ver todo <ChevronRight size={12} />
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-surface-200">
                  {['Factura', 'Cliente', 'Tipo', 'Total', 'Estado', 'Fecha'].map((h) => (
                    <th key={h} className="pb-3 pr-4 text-[10px] font-display font-bold text-navy-400 uppercase tracking-wider text-left">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recent.map((inv) => {
                  const sc: Record<string, { bg: string; text: string }> = {
                    'Finalizado': { bg: 'bg-emerald-50', text: 'text-emerald-700' },
                    'Pendiente de pago': { bg: 'bg-amber-50', text: 'text-amber-700' },
                    'Devolución': { bg: 'bg-gray-100', text: 'text-gray-600' },
                    'Cancelado': { bg: 'bg-red-50', text: 'text-red-600' },
                    'Creada': { bg: 'bg-blue-50', text: 'text-blue-700' },
                  };
                  const s = sc[inv.status] || sc['Creada'];
                  return (
                    <tr key={inv.id} className="border-b border-surface-100 hover:bg-surface-50/50 transition-colors">
                      <td className="py-3 pr-4">
                        <span className="font-mono text-xs font-bold text-navy-900">FACT-{String(inv.numericId).padStart(4, '0')}</span>
                      </td>
                      <td className="py-3 pr-4 text-xs text-navy-700 max-w-[120px] truncate">
                        {inv.clientSnapshot?.name || '—'}
                      </td>
                      <td className="py-3 pr-4">
                        <span className="text-[10px] text-navy-400 capitalize">{inv.deliveryType || '—'}</span>
                      </td>
                      <td className="py-3 pr-4">
                        <span className="font-mono text-xs font-bold text-navy-900">{format(inv.total)}</span>
                      </td>
                      <td className="py-3 pr-4">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold ${s.bg} ${s.text}`}>
                          {inv.status}
                        </span>
                      </td>
                      <td className="py-3 text-[10px] text-navy-400">
                        {toDate(inv.date).toLocaleDateString('es-VE', { day: '2-digit', month: 'short' })}{' '}
                        {toDate(inv.date).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Top Clients */}
        <div className="card p-6">
          <div className="flex items-center gap-2 mb-5">
            <Users size={16} className="text-blue-500" />
            <h2 className="text-base font-display font-bold text-navy-900">{isCustomRange ? 'Mejores Clientes del Rango' : 'Mejores Clientes del Mes'}</h2>
          </div>
          {topClients.length === 0 ? (
            <p className="text-xs text-navy-400 py-8 text-center">No hay datos suficientes.</p>
          ) : (
            <div className="space-y-4">
              {topClients.map((c, i) => {
                const pct = (c.revenue / topMaxClientRev) * 100;
                return (
                  <div key={i} className="group">
                    <div className="flex items-center gap-3 mb-1.5">
                      <div className="w-6 h-6 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center flex-shrink-0">
                        <span className="text-[10px] font-bold">{i + 1}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-display font-semibold text-navy-900 truncate" title={c.name}>{c.name}</p>
                      </div>
                      <div className="text-right flex-shrink-0 w-20">
                        <p className="text-sm font-mono font-bold text-navy-900">{format(c.revenue)}</p>
                        <p className="text-[10px] text-navy-400">{c.qty} pedidos</p>
                      </div>
                    </div>
                    <div className="ml-9 h-1.5 bg-surface-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-blue-500 transition-all duration-700"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════
// Sub-components
// ════════════════════════════════════════
function KpiCard({ icon, gradient, title, value, subtitle, trend, trendLabel, sparkData, sparkColor, badge, badgeColor }: {
  icon: React.ReactNode; gradient: string; title: string; value: string; subtitle: string;
  trend?: number; trendLabel?: string; sparkData?: number[]; sparkColor?: string;
  badge?: string; badgeColor?: string;
}) {
  const isPositive = (trend || 0) >= 0;
  return (
    <div className="card p-4 hover-lift transition-all group relative overflow-hidden">
      {/* Gradient accent */}
      <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${gradient} opacity-80`} />
      
      <div className="flex items-start justify-between mb-3">
        <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center text-white shadow-sm`}>
          {icon}
        </div>
        {sparkData && sparkData.length > 1 && (
          <div className="opacity-60 group-hover:opacity-100 transition-opacity">
            <Sparkline data={sparkData} color={sparkColor} width={60} height={24} />
          </div>
        )}
        {badge && (
          <span className={`w-5 h-5 rounded-full ${badgeColor || 'bg-red-500'} text-white text-[9px] font-bold flex items-center justify-center`}>
            {badge}
          </span>
        )}
      </div>
      <p className="text-[10px] font-display font-semibold text-navy-400 uppercase tracking-wider mb-1">{title}</p>
      <p className="text-xl font-display font-bold text-navy-900 leading-tight">{value}</p>
      <div className="flex items-center justify-between mt-2">
        <p className="text-[10px] text-navy-400 truncate pr-2">{subtitle}</p>
        {trend !== undefined && trend !== 0 && (
          <div className={`flex items-center gap-0.5 text-[10px] font-bold flex-shrink-0 px-1.5 py-0.5 rounded-md ${
            isPositive ? 'text-emerald-700 bg-emerald-50' : 'text-red-600 bg-red-50'
          }`}>
            {isPositive ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
            {Math.abs(trend).toFixed(0)}%
          </div>
        )}
      </div>
    </div>
  );
}

function QuickAction({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="flex items-center gap-2 px-3 py-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-lg text-xs text-white font-display font-medium transition-all backdrop-blur-sm">
      {icon} {label}
    </button>
  );
}
