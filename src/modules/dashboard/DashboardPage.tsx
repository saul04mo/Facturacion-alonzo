import { useMemo } from 'react';
import { useAppStore } from '@/store/appStore';
import { useCurrency } from '@/hooks/useCurrency';
import {
  TrendingUp, TrendingDown, ShoppingCart, DollarSign, Package, AlertTriangle,
  Users, CreditCard, Tag, Zap, ArrowUpRight, ArrowDownRight, Clock, Ticket,
} from 'lucide-react';
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
  return d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate();
}

function isThisMonth(d: Date, now: Date): boolean {
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

function isLastMonth(d: Date, now: Date): boolean {
  const last = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return d.getFullYear() === last.getFullYear() && d.getMonth() === last.getMonth();
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

// ════════════════════════════════════════
// Dashboard Page
// ════════════════════════════════════════
export function DashboardPage() {
  const invoices = useAppStore((s) => s.invoices);
  const products = useAppStore((s) => s.products);
  const coupons = useAppStore((s) => s.coupons);
  const promotions = useAppStore((s) => s.promotions);
  const { format } = useCurrency();

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = daysAgo(1);

  // ── Computed KPIs ──
  const kpis = useMemo(() => {
    const validInvoices = invoices.filter((inv) => inv.status !== 'Cancelado' && inv.status !== 'Devolución');

    // Today
    const todaySales = validInvoices.filter((inv) => isSameDay(toDate(inv.date), today));
    const todayRevenue = todaySales.reduce((sum, inv) => sum + (inv.total || 0), 0);
    const todayCount = todaySales.length;
    const todayAvg = todayCount > 0 ? todayRevenue / todayCount : 0;

    // Yesterday
    const yesterdaySales = validInvoices.filter((inv) => isSameDay(toDate(inv.date), yesterday));
    const yesterdayRevenue = yesterdaySales.reduce((sum, inv) => sum + (inv.total || 0), 0);
    const yesterdayCount = yesterdaySales.length;

    // This month
    const monthSales = validInvoices.filter((inv) => isThisMonth(toDate(inv.date), now));
    const monthRevenue = monthSales.reduce((sum, inv) => sum + (inv.total || 0), 0);
    const monthCount = monthSales.length;

    // Last month
    const lastMonthSales = validInvoices.filter((inv) => isLastMonth(toDate(inv.date), now));
    const lastMonthRevenue = lastMonthSales.reduce((sum, inv) => sum + (inv.total || 0), 0);

    // Growth
    const dayGrowth = yesterdayRevenue > 0 ? ((todayRevenue - yesterdayRevenue) / yesterdayRevenue) * 100 : 0;
    const monthGrowth = lastMonthRevenue > 0 ? ((monthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100 : 0;

    // Pending payments
    const pendingInvoices = invoices.filter((inv) => inv.status === 'Pendiente de pago');
    const pendingTotal = pendingInvoices.reduce((sum, inv) => sum + (inv.total || 0), 0);

    return {
      todayRevenue, todayCount, todayAvg,
      yesterdayRevenue, yesterdayCount,
      monthRevenue, monthCount,
      lastMonthRevenue,
      dayGrowth, monthGrowth,
      pendingCount: pendingInvoices.length, pendingTotal,
    };
  }, [invoices]);

  // ── Top Products (this month) ──
  const topProducts = useMemo(() => {
    const validInvoices = invoices.filter((inv) =>
      inv.status !== 'Cancelado' && inv.status !== 'Devolución' && isThisMonth(toDate(inv.date), now)
    );

    const productMap: Record<string, { name: string; qty: number; revenue: number; img?: string }> = {};
    validInvoices.forEach((inv) => {
      (inv.items || []).forEach((item: any) => {
        const key = item.productId || item.productName || item.titulo;
        if (!productMap[key]) {
          productMap[key] = {
            name: item.productName || item.titulo || item.name || key,
            qty: 0,
            revenue: 0,
            img: item.img,
          };
        }
        productMap[key].qty += item.quantity || item.qty || 0;
        productMap[key].revenue += (item.priceAtSale || item.price || 0) * (item.quantity || item.qty || 0);
      });
    });

    return Object.values(productMap)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 8);
  }, [invoices]);

  // ── Low Stock Alerts ──
  const lowStockProducts = useMemo(() => {
    const alerts: { product: Product; variant: any; stock: number }[] = [];
    products.forEach((p) => {
      (p.variants || []).forEach((v: any) => {
        const stock = typeof v.stock === 'string' ? parseInt(v.stock) : v.stock;
        if (stock <= 3 && stock >= 0) {
          alerts.push({ product: p, variant: v, stock });
        }
      });
    });
    return alerts.sort((a, b) => a.stock - b.stock).slice(0, 10);
  }, [products]);

  // ── Payment Methods Breakdown (this month) ──
  const paymentBreakdown = useMemo(() => {
    const validInvoices = invoices.filter((inv) =>
      inv.status !== 'Cancelado' && inv.status !== 'Devolución' && isThisMonth(toDate(inv.date), now)
    );

    const methods: Record<string, { count: number; totalUsd: number }> = {};
    validInvoices.forEach((inv) => {
      (inv.payments || []).forEach((p: any) => {
        const name = p.method || 'Otro';
        if (!methods[name]) methods[name] = { count: 0, totalUsd: 0 };
        methods[name].count += 1;
        methods[name].totalUsd += p.amountUsd || (p.amountVes ? p.amountVes / (inv.exchangeRate || 1) : 0);
      });
    });

    return Object.entries(methods)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.totalUsd - a.totalUsd);
  }, [invoices]);

  // ── Daily Sales (last 7 days) ──
  const dailySales = useMemo(() => {
    const days: { label: string; revenue: number; count: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = daysAgo(i);
      const dayInvoices = invoices.filter((inv) =>
        inv.status !== 'Cancelado' && inv.status !== 'Devolución' && isSameDay(toDate(inv.date), d)
      );
      days.push({
        label: d.toLocaleDateString('es-VE', { weekday: 'short', day: 'numeric' }),
        revenue: dayInvoices.reduce((sum, inv) => sum + (inv.total || 0), 0),
        count: dayInvoices.length,
      });
    }
    return days;
  }, [invoices]);

  const maxDailyRevenue = Math.max(...dailySales.map((d) => d.revenue), 1);

  // ── Recent Invoices ──
  const recentInvoices = invoices.slice(0, 6);

  // ── Active promos/coupons stats ──
  const activeCoupons = coupons.filter((c) => c.active).length;
  const totalCouponUses = coupons.reduce((sum, c) => sum + (c.usedCount || 0), 0);
  const activePromos = promotions.filter((p) => p.active).length;

  return (
    <div className="space-y-6 animate-fade-up">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-1 h-12 bg-blue-500 rounded-full" />
        <div>
          <h1 className="text-xl font-display font-bold text-navy-900">Dashboard</h1>
          <p className="text-navy-400 text-sm">
            {now.toLocaleDateString('es-VE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
      </div>

      {/* ═══ KPI Cards ═══ */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          icon={<DollarSign size={20} />}
          iconColor="text-emerald-600"
          iconBg="bg-emerald-50"
          title="Ventas Hoy"
          value={format(kpis.todayRevenue)}
          subtitle={`${kpis.todayCount} ventas`}
          trend={kpis.dayGrowth}
          trendLabel="vs ayer"
        />
        <KpiCard
          icon={<TrendingUp size={20} />}
          iconColor="text-blue-600"
          iconBg="bg-blue-50"
          title="Ventas del Mes"
          value={format(kpis.monthRevenue)}
          subtitle={`${kpis.monthCount} ventas`}
          trend={kpis.monthGrowth}
          trendLabel="vs mes anterior"
        />
        <KpiCard
          icon={<ShoppingCart size={20} />}
          iconColor="text-violet-600"
          iconBg="bg-violet-50"
          title="Ticket Promedio"
          value={format(kpis.todayAvg)}
          subtitle="promedio por venta hoy"
        />
        <KpiCard
          icon={<Clock size={20} />}
          iconColor="text-amber-600"
          iconBg="bg-amber-50"
          title="Pagos Pendientes"
          value={format(kpis.pendingTotal)}
          subtitle={`${kpis.pendingCount} facturas por cobrar`}
        />
      </div>

      {/* ═══ Main Grid ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Daily Chart */}
        <div className="lg:col-span-2 card p-5">
          <h2 className="text-sm font-display font-bold text-navy-900 mb-4">Ventas Últimos 7 Días</h2>
          <div className="flex items-end gap-2 h-40">
            {dailySales.map((day, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <span className="text-[9px] font-mono text-navy-500">{format(day.revenue)}</span>
                <div
                  className="w-full bg-blue-500 rounded-t-md transition-all duration-500 min-h-[4px]"
                  style={{ height: `${(day.revenue / maxDailyRevenue) * 100}%` }}
                />
                <span className="text-[10px] text-navy-400 font-display">{day.label}</span>
                <span className="text-[9px] text-navy-300">{day.count}v</span>
              </div>
            ))}
          </div>
        </div>

        {/* Payment Methods */}
        <div className="card p-5">
          <h2 className="text-sm font-display font-bold text-navy-900 mb-4 flex items-center gap-2">
            <CreditCard size={14} className="text-navy-400" /> Métodos de Pago
          </h2>
          <div className="space-y-3">
            {paymentBreakdown.length === 0 ? (
              <p className="text-xs text-navy-400">Sin datos este mes.</p>
            ) : (
              paymentBreakdown.slice(0, 6).map((method) => {
                const pct = (method.totalUsd / (kpis.monthRevenue || 1)) * 100;
                return (
                  <div key={method.name}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-navy-700 font-medium">{method.name}</span>
                      <span className="text-navy-500 font-mono">{format(method.totalUsd)}</span>
                    </div>
                    <div className="w-full h-1.5 bg-surface-100 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500 rounded-full transition-all duration-500" style={{ width: `${Math.min(pct, 100)}%` }} />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* ═══ Second Row ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Top Products */}
        <div className="lg:col-span-2 card p-5">
          <h2 className="text-sm font-display font-bold text-navy-900 mb-4 flex items-center gap-2">
            <Package size={14} className="text-navy-400" /> Productos Más Vendidos (Este Mes)
          </h2>
          {topProducts.length === 0 ? (
            <p className="text-xs text-navy-400 py-4 text-center">Sin datos este mes.</p>
          ) : (
            <div className="space-y-2">
              {topProducts.map((p, i) => (
                <div key={i} className="flex items-center gap-3 p-2 rounded-lg hover:bg-surface-50 transition-colors">
                  <span className="w-6 h-6 rounded-full bg-surface-100 flex items-center justify-center text-[10px] font-bold text-navy-500 flex-shrink-0">
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-display font-semibold text-navy-900 truncate">{p.name}</p>
                    <p className="text-[10px] text-navy-400">{p.qty} unidades</p>
                  </div>
                  <span className="text-xs font-mono font-semibold text-navy-900 flex-shrink-0">{format(p.revenue)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Low Stock + Promo Stats */}
        <div className="space-y-6">
          {/* Low Stock */}
          <div className="card p-5">
            <h2 className="text-sm font-display font-bold text-navy-900 mb-3 flex items-center gap-2">
              <AlertTriangle size={14} className="text-amber-500" /> Stock Bajo
              {lowStockProducts.length > 0 && (
                <span className="badge badge-yellow text-[10px]">{lowStockProducts.length}</span>
              )}
            </h2>
            {lowStockProducts.length === 0 ? (
              <p className="text-xs text-emerald-600 py-2">Todo el inventario está bien.</p>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {lowStockProducts.map((alert, i) => (
                  <div key={i} className="flex items-center justify-between p-2 bg-amber-50/50 rounded-lg">
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-display font-semibold text-navy-900 truncate">{alert.product.name}</p>
                      <p className="text-[9px] text-navy-400">{alert.variant.size} / {alert.variant.color}</p>
                    </div>
                    <span className={`text-xs font-mono font-bold flex-shrink-0 px-2 py-0.5 rounded ${
                      alert.stock === 0 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                    }`}>
                      {alert.stock === 0 ? 'AGOTADO' : `${alert.stock} uds`}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Promo Stats */}
          <div className="card p-5">
            <h2 className="text-sm font-display font-bold text-navy-900 mb-3 flex items-center gap-2">
              <Zap size={14} className="text-violet-500" /> Promociones Activas
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-violet-50 rounded-lg p-3 text-center">
                <p className="text-lg font-display font-bold text-violet-700">{activePromos}</p>
                <p className="text-[10px] text-violet-500">Promociones</p>
              </div>
              <div className="bg-pink-50 rounded-lg p-3 text-center">
                <p className="text-lg font-display font-bold text-pink-700">{activeCoupons}</p>
                <p className="text-[10px] text-pink-500">Cupones</p>
              </div>
            </div>
            {totalCouponUses > 0 && (
              <p className="text-[10px] text-navy-400 mt-2 flex items-center gap-1">
                <Ticket size={10} /> {totalCouponUses} cupones usados en total
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ═══ Recent Invoices ═══ */}
      <div className="card p-5">
        <h2 className="text-sm font-display font-bold text-navy-900 mb-4">Últimas Ventas</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-navy-400 border-b border-surface-200">
                <th className="pb-2 pr-4 font-display font-semibold">#</th>
                <th className="pb-2 pr-4 font-display font-semibold">Cliente</th>
                <th className="pb-2 pr-4 font-display font-semibold">Total</th>
                <th className="pb-2 pr-4 font-display font-semibold">Estado</th>
                <th className="pb-2 font-display font-semibold">Fecha</th>
              </tr>
            </thead>
            <tbody>
              {recentInvoices.map((inv) => {
                const statusColors: Record<string, string> = {
                  'Finalizado': 'badge-green',
                  'Pendiente de pago': 'badge-yellow',
                  'Devolución': 'badge-gray',
                  'Cancelado': 'badge-gray',
                  'Creada': 'badge-blue',
                };
                return (
                  <tr key={inv.id} className="border-b border-surface-100 hover:bg-surface-50 transition-colors">
                    <td className="py-2.5 pr-4 font-mono font-semibold text-navy-900">
                      FACT-{String(inv.numericId).padStart(4, '0')}
                    </td>
                    <td className="py-2.5 pr-4 text-navy-700">
                      {inv.clientSnapshot?.name || 'Sin cliente'}
                    </td>
                    <td className="py-2.5 pr-4 font-mono font-semibold text-navy-900">{format(inv.total)}</td>
                    <td className="py-2.5 pr-4">
                      <span className={`badge ${statusColors[inv.status] || 'badge-gray'} text-[9px]`}>
                        {inv.status}
                      </span>
                    </td>
                    <td className="py-2.5 text-navy-400">
                      {toDate(inv.date).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════
// KPI Card Component
// ════════════════════════════════════════
function KpiCard({
  icon, iconColor, iconBg, title, value, subtitle, trend, trendLabel,
}: {
  icon: React.ReactNode;
  iconColor: string;
  iconBg: string;
  title: string;
  value: string;
  subtitle: string;
  trend?: number;
  trendLabel?: string;
}) {
  const isPositive = (trend || 0) >= 0;

  return (
    <div className="card p-4 hover-lift transition-all">
      <div className="flex items-center gap-3 mb-3">
        <div className={`w-10 h-10 rounded-xl ${iconBg} flex items-center justify-center ${iconColor}`}>
          {icon}
        </div>
        <p className="text-[11px] font-display font-semibold text-navy-500 uppercase tracking-wide">{title}</p>
      </div>
      <p className="text-xl font-display font-bold text-navy-900">{value}</p>
      <div className="flex items-center justify-between mt-1.5">
        <p className="text-[10px] text-navy-400">{subtitle}</p>
        {trend !== undefined && trend !== 0 && (
          <div className={`flex items-center gap-0.5 text-[10px] font-semibold ${isPositive ? 'text-emerald-600' : 'text-red-500'}`}>
            {isPositive ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
            {Math.abs(trend).toFixed(0)}%
            {trendLabel && <span className="text-navy-300 font-normal ml-0.5">{trendLabel}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
