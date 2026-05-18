import { useState, useEffect, useMemo } from 'react';
import { useCurrency } from '@/hooks/useCurrency';
import { fetchInvoicesByDateRange } from '@/modules/invoices/invoiceService';
import { daysOfMonth, describeDate } from './adSpendService';
import { toDate } from '@/utils/dateUtils';
import { isCountableSale } from '@/utils/invoiceStatus';
import { Store, Truck, ChevronLeft, ChevronRight, Layers, Loader2 } from 'lucide-react';

// ─── Constantes de canal ──────────────────────────────────────────────────────

const STORE_TYPES = new Set(['showroom', 'pickup', 'pick-up']);
const DELIVERY_TYPES_SET = new Set(['local', 'national', 'web']);

const STORE_CHANNEL = [
  { value: 'showroom', label: 'Showroom' },
  { value: 'pickup', label: 'Retiro en Tienda' },
  { value: 'pick-up', label: 'Pick-Up' },
] as const;

const DELIVERY_CHANNEL = [
  { value: 'local', label: 'Delivery' },
  { value: 'national', label: 'Envío Nacional' },
  { value: 'web', label: 'Página Web' },
] as const;

const MONTH_NAMES_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface ChannelStats {
  orders: number;
  sales: number;   // total - deliveryCost
  delivery: number;
  total: number;
}

interface DayChannelEntry {
  store: ChannelStats;
  delivery: ChannelStats;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function emptyStats(): ChannelStats {
  return { orders: 0, sales: 0, delivery: 0, total: 0 };
}

function addToStats(s: ChannelStats, inv: any) {
  const del = Number(inv.deliveryCostUsd) || 0;
  const tot = Number(inv.total) || 0;
  s.orders++;
  s.delivery += del;
  s.sales += tot - del;
  s.total += tot;
}

function dateToYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function computeStats(invoices: any[]) {
  const byType: Record<string, ChannelStats> = {};
  [...STORE_CHANNEL, ...DELIVERY_CHANNEL].forEach(({ value }) => { byType[value] = emptyStats(); });

  const daily = new Map<string, DayChannelEntry>();

  // ── Bucket de facturas que no caen en ninguna categoría conocida ───
  // Antes esas facturas se descartaban con `continue` silenciosamente,
  // lo cual generaba diferencias entre este panel y el total del mes
  // del panel de Facturas. Causas típicas: deliveryType undefined,
  // string vacío, o valor legacy que ya no se usa (ej. 'envio' viejo).
  const unclassified = emptyStats();
  const unclassifiedTypes = new Map<string, number>(); // valor → cantidad

  for (const inv of invoices) {
    if (!isCountableSale(inv.status)) continue;
    const dt = inv.deliveryType as string;
    const isStore = STORE_TYPES.has(dt);
    const isDelivery = DELIVERY_TYPES_SET.has(dt);

    if (!isStore && !isDelivery) {
      // Sumar al bucket "Sin clasificar" en vez de descartar
      addToStats(unclassified, inv);
      const key = dt && dt.trim() !== '' ? dt : '(sin deliveryType)';
      unclassifiedTypes.set(key, (unclassifiedTypes.get(key) || 0) + 1);
      continue;
    }

    if (byType[dt]) addToStats(byType[dt], inv);

    const d = toDate(inv.date);
    if (d) {
      const ymd = dateToYMD(d);
      if (!daily.has(ymd)) daily.set(ymd, { store: emptyStats(), delivery: emptyStats() });
      const entry = daily.get(ymd)!;
      if (isStore) addToStats(entry.store, inv);
      else addToStats(entry.delivery, inv);
    }
  }

  // Logueamos a consola para que sea fácil identificar el problema
  // si el banner del panel queda visible.
  if (unclassified.orders > 0) {
    console.warn(
      `[ChannelReport] ${unclassified.orders} facturas con deliveryType sin clasificar` +
      ` ($${unclassified.total.toFixed(2)}):`,
      Object.fromEntries(unclassifiedTypes),
    );
  }

  const storeAgg = STORE_CHANNEL.reduce((acc, { value }) => {
    const s = byType[value];
    return { orders: acc.orders + s.orders, sales: acc.sales + s.sales, delivery: acc.delivery + s.delivery, total: acc.total + s.total };
  }, emptyStats());

  const deliveryAgg = DELIVERY_CHANNEL.reduce((acc, { value }) => {
    const s = byType[value];
    return { orders: acc.orders + s.orders, sales: acc.sales + s.sales, delivery: acc.delivery + s.delivery, total: acc.total + s.total };
  }, emptyStats());

  return { byType, storeAgg, deliveryAgg, daily, unclassified, unclassifiedTypes };
}

// ─── Subcomponente: tarjeta resumen ───────────────────────────────────────────

interface SummaryCardProps {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  stats: ChannelStats;
  pct: number;
  borderColor: string;
  iconBg: string;
  iconColor: string;
  valueColor: string;
  format: (v: number) => string;
}

function SummaryCard({ title, subtitle, icon, stats, pct, borderColor, iconBg, iconColor, valueColor, format }: SummaryCardProps) {
  return (
    <div className={`card p-5 border-l-4 ${borderColor}`}>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl ${iconBg} flex items-center justify-center ${iconColor}`}>
            {icon}
          </div>
          <div>
            <h3 className="font-display font-bold text-navy-900 text-base">{title}</h3>
            <p className="text-xs text-navy-400">{subtitle}</p>
          </div>
        </div>
        <div className="text-right">
          <p className={`text-2xl font-mono font-bold ${valueColor}`}>{format(stats.total)}</p>
          <span className={`text-xs font-display font-semibold ${iconColor} ${iconBg} px-2 py-0.5 rounded-full`}>
            {pct.toFixed(1)}% del total
          </span>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 pt-3 border-t border-surface-100">
        <div className="text-center">
          <p className="text-[10px] font-display font-semibold text-navy-400 uppercase mb-0.5">Pedidos</p>
          <p className="text-xl font-mono font-bold text-navy-900">{stats.orders}</p>
        </div>
        <div className="text-center">
          <p className="text-[10px] font-display font-semibold text-navy-400 uppercase mb-0.5">Ventas</p>
          <p className="text-sm font-mono font-bold text-navy-700">{format(stats.sales)}</p>
        </div>
        <div className="text-center">
          <p className="text-[10px] font-display font-semibold text-navy-400 uppercase mb-0.5">Costo Envío</p>
          <p className={`text-sm font-mono font-bold ${valueColor}`}>{format(stats.delivery)}</p>
        </div>
      </div>
    </div>
  );
}

// ─── Subcomponente: desglose por tipo ─────────────────────────────────────────

interface BreakdownSectionProps {
  title: string;
  icon: React.ReactNode;
  types: readonly { value: string; label: string }[];
  byType: Record<string, ChannelStats>;
  sectionTotal: number;
  headerClass: string;
  dotColor: string;
  barColor: string;
  totalTextColor: string;
  format: (v: number) => string;
}

function BreakdownSection({ title, icon, types, byType, sectionTotal, headerClass, dotColor, barColor, totalTextColor, format }: BreakdownSectionProps) {
  return (
    <div className="card overflow-hidden">
      <div className={`px-5 py-3 flex items-center gap-2 ${headerClass}`}>
        {icon}
        <h4 className="font-display font-bold text-sm">{title}</h4>
        <span className={`ml-auto text-xs font-mono font-bold ${totalTextColor}`}>
          Total: {format(sectionTotal)}
        </span>
      </div>
      <div className="divide-y divide-surface-100">
        {types.map(({ value, label }) => {
          const s = byType[value];
          const pct = sectionTotal > 0 ? (s.total / sectionTotal) * 100 : 0;
          return (
            <div key={value} className="px-5 py-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className={`inline-block w-2 h-2 rounded-full ${dotColor}`} />
                  <span className="font-display font-semibold text-sm text-navy-800">{label}</span>
                  <span className="text-xs text-navy-400 font-mono">({s.orders} pedidos)</span>
                </div>
                <span className="font-mono font-bold text-sm text-navy-900">{format(s.total)}</span>
              </div>
              <div className="flex items-center gap-3 mb-2">
                <div className="flex-1 h-1.5 bg-surface-100 rounded-full overflow-hidden">
                  <div className={`h-full ${barColor} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                </div>
                <span className="text-[10px] font-mono text-navy-400 w-8 text-right">{pct.toFixed(0)}%</span>
              </div>
              <div className="flex gap-4 text-xs text-navy-500">
                <span>Ventas: <span className="font-mono font-semibold text-navy-700">{format(s.sales)}</span></span>
                {s.delivery > 0 && (
                  <span>Envío: <span className="font-mono font-semibold text-blue-600">{format(s.delivery)}</span></span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function ChannelReport() {
  const { format } = useCurrency();

  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);

  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  async function loadMonth(y: number, m: number) {
    setLoading(true);
    try {
      const mm = String(m).padStart(2, '0');
      const lastDay = new Date(y, m, 0).getDate();
      const startDate = `${y}-${mm}-01`;
      const endDate = `${y}-${mm}-${String(lastDay).padStart(2, '0')}`;
      const data = await fetchInvoicesByDateRange(startDate, endDate);
      setInvoices(data);
    } catch {
      setInvoices([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadMonth(year, month); }, [year, month]);

  function prevMonth() {
    if (month === 1) { setYear((y) => y - 1); setMonth(12); }
    else setMonth((m) => m - 1);
  }
  function nextMonth() {
    if (month === 12) { setYear((y) => y + 1); setMonth(1); }
    else setMonth((m) => m + 1);
  }

  const stats = useMemo(() => computeStats(invoices), [invoices]);
  const days = useMemo(() => daysOfMonth(year, month), [year, month]);

  const grandTotal = stats.storeAgg.total + stats.deliveryAgg.total;
  const storePct = grandTotal > 0 ? (stats.storeAgg.total / grandTotal) * 100 : 0;
  const delivPct = grandTotal > 0 ? (stats.deliveryAgg.total / grandTotal) * 100 : 0;

  // Totales de la tabla diaria
  const tableTotals = useMemo(() => {
    const s = { store: emptyStats(), delivery: emptyStats() };
    days.forEach((ymd) => {
      const e = stats.daily.get(ymd);
      if (!e) return;
      (['orders', 'sales', 'delivery', 'total'] as const).forEach((k) => {
        s.store[k] += e.store[k];
        s.delivery[k] += e.delivery[k];
      });
    });
    return s;
  }, [days, stats.daily]);

  const todayYMD = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  return (
    <div className="space-y-4 animate-fade-up">

      {/* ── Navegación de mes ── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Layers size={20} className="text-blue-500" />
          <h2 className="text-lg font-display font-bold text-navy-900">Canal de Ventas</h2>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} className="btn-ghost p-1.5" title="Mes anterior" type="button">
            <ChevronLeft size={16} />
          </button>
          <div className="font-display font-semibold text-navy-800 w-40 text-center">
            {MONTH_NAMES_ES[month - 1]} {year}
          </div>
          <button onClick={nextMonth} className="btn-ghost p-1.5" title="Mes siguiente" type="button">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="card p-12 flex flex-col items-center gap-3 text-navy-400">
          <Loader2 size={28} className="animate-spin text-blue-500" />
          <p className="text-sm font-display">Cargando datos del mes…</p>
        </div>
      ) : (
        <>
          {/* ── Aviso de facturas con deliveryType desconocido ── */}
          {stats.unclassified.orders > 0 && (
            <div className="rounded-lg border border-amber-300 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-900/20 px-4 py-3">
              <p className="text-sm font-display font-semibold text-amber-800 dark:text-amber-300">
                ⚠️ Hay {stats.unclassified.orders}{' '}
                {stats.unclassified.orders === 1 ? 'factura' : 'facturas'} sin canal de venta
                clasificado (${stats.unclassified.total.toFixed(2)})
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-400/80 mt-1">
                Estas facturas tienen valores de <code>deliveryType</code> que el panel no
                reconoce, así que no aparecen en ninguna de las dos secciones de abajo.
                Esto explica la diferencia con el total del panel de Facturas.
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {[...stats.unclassifiedTypes.entries()].map(([type, count]) => (
                  <span
                    key={type}
                    className="font-mono text-[11px] px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-800/40 text-amber-800 dark:text-amber-200"
                  >
                    {type}: {count}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* ── Cards resumen ── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <SummaryCard
              title="Tienda"
              subtitle="Showroom · Retiro en Tienda · Pick-Up"
              icon={<Store size={20} />}
              stats={stats.storeAgg}
              pct={storePct}
              borderColor="border-l-blue-500"
              iconBg="bg-blue-50"
              iconColor="text-blue-600"
              valueColor="text-blue-600"
              format={format}
            />
            <SummaryCard
              title="Delivery"
              subtitle="Delivery · Envío Nacional · Página Web"
              icon={<Truck size={20} />}
              stats={stats.deliveryAgg}
              pct={delivPct}
              borderColor="border-l-orange-500"
              iconBg="bg-orange-50"
              iconColor="text-orange-600"
              valueColor="text-orange-600"
              format={format}
            />
          </div>

          {/* ── Barra de distribución ── */}
          {grandTotal > 0 && (
            <div className="card p-4">
              <p className="text-[10px] font-display font-semibold text-navy-400 uppercase mb-2">
                Distribución de ventas
              </p>
              <div className="flex h-7 rounded-full overflow-hidden">
                <div
                  className="bg-blue-500 flex items-center justify-center text-white text-[10px] font-display font-bold transition-all"
                  style={{ width: `${storePct}%` }}
                >
                  {storePct >= 12 && `${storePct.toFixed(0)}%`}
                </div>
                <div
                  className="bg-orange-500 flex items-center justify-center text-white text-[10px] font-display font-bold transition-all"
                  style={{ width: `${delivPct}%` }}
                >
                  {delivPct >= 12 && `${delivPct.toFixed(0)}%`}
                </div>
              </div>
              <div className="flex justify-between mt-2">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block" />
                  <span className="text-xs text-navy-500 font-display">
                    Tienda — <span className="font-mono font-semibold text-navy-700">{format(stats.storeAgg.total)}</span>
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-navy-500 font-display">
                    Delivery — <span className="font-mono font-semibold text-navy-700">{format(stats.deliveryAgg.total)}</span>
                  </span>
                  <span className="w-2.5 h-2.5 rounded-full bg-orange-500 inline-block" />
                </div>
              </div>
            </div>
          )}

          {/* ── Desglose por tipo ── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <BreakdownSection
              title="Tienda"
              icon={<Store size={15} className="text-blue-600" />}
              types={STORE_CHANNEL}
              byType={stats.byType}
              sectionTotal={stats.storeAgg.total}
              headerClass="bg-blue-50 border-b border-blue-100 text-blue-900"
              dotColor="bg-blue-500"
              barColor="bg-blue-500"
              totalTextColor="text-blue-700"
              format={format}
            />
            <BreakdownSection
              title="Delivery"
              icon={<Truck size={15} className="text-orange-600" />}
              types={DELIVERY_CHANNEL}
              byType={stats.byType}
              sectionTotal={stats.deliveryAgg.total}
              headerClass="bg-orange-50 border-b border-orange-100 text-orange-900"
              dotColor="bg-orange-500"
              barColor="bg-orange-500"
              totalTextColor="text-orange-700"
              format={format}
            />
          </div>

          {/* ── Tabla diaria ── */}
          <div className="border border-surface-200 rounded-xl overflow-hidden bg-card">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  {/* Grupos */}
                  <tr className="bg-surface-50 border-b border-surface-200">
                    <th colSpan={2} className="px-2 py-1.5 text-left text-[10px] font-display font-semibold text-navy-500 uppercase">
                      Día
                    </th>
                    <th colSpan={3} className="px-2 py-1.5 text-center text-[11px] font-display font-bold text-blue-700 uppercase tracking-wide border-l-2 border-surface-300">
                      🏪 Tienda
                    </th>
                    <th colSpan={4} className="px-2 py-1.5 text-center text-[11px] font-display font-bold text-orange-700 uppercase tracking-wide border-l-2 border-surface-300">
                      🚚 Delivery
                    </th>
                    <th colSpan={3} className="px-2 py-1.5 text-center text-[11px] font-display font-bold text-emerald-700 uppercase tracking-wide border-l-2 border-surface-300">
                      ∑ Total
                    </th>
                  </tr>
                  <tr className="bg-surface-50 border-b border-surface-200 text-[10px] font-display font-semibold text-navy-500 uppercase">
                    <th className="px-2 py-1.5 text-left">Día</th>
                    <th className="px-2 py-1.5 text-left">Fecha</th>
                    {/* Tienda */}
                    <th className="px-2 py-1.5 text-right border-l-2 border-surface-300">Pedidos</th>
                    <th className="px-2 py-1.5 text-right">Ventas</th>
                    <th className="px-2 py-1.5 text-right">Total</th>
                    {/* Delivery */}
                    <th className="px-2 py-1.5 text-right border-l-2 border-surface-300">Pedidos</th>
                    <th className="px-2 py-1.5 text-right">Ventas</th>
                    <th className="px-2 py-1.5 text-right">Envío</th>
                    <th className="px-2 py-1.5 text-right">Total</th>
                    {/* Total */}
                    <th className="px-2 py-1.5 text-right border-l-2 border-surface-300">Pedidos</th>
                    <th className="px-2 py-1.5 text-right">Ventas</th>
                    <th className="px-2 py-1.5 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((ymd) => {
                    const entry = stats.daily.get(ymd);
                    const s = entry?.store ?? emptyStats();
                    const d = entry?.delivery ?? emptyStats();
                    const totalOrders = s.orders + d.orders;
                    const totalSales = s.sales + d.sales;
                    const grandRowTotal = s.total + d.total;
                    const hasData = totalOrders > 0;
                    const { weekday, short } = describeDate(ymd);
                    const isToday = ymd === todayYMD;

                    return (
                      <tr
                        key={ymd}
                        className={`border-b border-surface-100 ${
                          isToday
                            ? 'bg-amber-50/40'
                            : hasData
                            ? 'hover:bg-surface-50/60'
                            : 'opacity-50'
                        }`}
                      >
                        <td className="px-2 py-1.5 text-navy-700 font-display">{weekday.slice(0, 3)}</td>
                        <td className="px-2 py-1.5 font-mono text-navy-500">{short}</td>
                        {/* Tienda */}
                        <td className="px-2 py-1.5 text-right font-mono border-l-2 border-surface-300 text-blue-700">
                          {s.orders > 0 ? s.orders : '—'}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono text-navy-700">
                          {s.sales > 0 ? format(s.sales) : '—'}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono font-bold text-blue-700">
                          {s.total > 0 ? format(s.total) : '—'}
                        </td>
                        {/* Delivery */}
                        <td className="px-2 py-1.5 text-right font-mono border-l-2 border-surface-300 text-orange-700">
                          {d.orders > 0 ? d.orders : '—'}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono text-navy-700">
                          {d.sales > 0 ? format(d.sales) : '—'}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono text-blue-600">
                          {d.delivery > 0 ? format(d.delivery) : '—'}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono font-bold text-orange-700">
                          {d.total > 0 ? format(d.total) : '—'}
                        </td>
                        {/* Total */}
                        <td className="px-2 py-1.5 text-right font-mono border-l-2 border-surface-300 text-emerald-700">
                          {totalOrders > 0 ? totalOrders : '—'}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono text-navy-700">
                          {totalSales > 0 ? format(totalSales) : '—'}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono font-bold text-emerald-700">
                          {grandRowTotal > 0 ? format(grandRowTotal) : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {/* Fila de totales */}
                <tfoot>
                  <tr className="bg-navy-50 border-t-2 border-navy-300 text-xs font-display font-bold">
                    <td colSpan={2} className="px-2 py-2 text-navy-900 uppercase tracking-wide">
                      Total del mes
                    </td>
                    {/* Tienda */}
                    <td className="px-2 py-2 text-right font-mono text-blue-700 border-l-2 border-surface-300">
                      {tableTotals.store.orders}
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-blue-700">
                      {format(tableTotals.store.sales)}
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-blue-700">
                      {format(tableTotals.store.total)}
                    </td>
                    {/* Delivery */}
                    <td className="px-2 py-2 text-right font-mono text-orange-700 border-l-2 border-surface-300">
                      {tableTotals.delivery.orders}
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-orange-700">
                      {format(tableTotals.delivery.sales)}
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-blue-600">
                      {format(tableTotals.delivery.delivery)}
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-orange-700">
                      {format(tableTotals.delivery.total)}
                    </td>
                    {/* Total */}
                    <td className="px-2 py-2 text-right font-mono text-emerald-700 border-l-2 border-surface-300">
                      {tableTotals.store.orders + tableTotals.delivery.orders}
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-emerald-700">
                      {format(tableTotals.store.sales + tableTotals.delivery.sales)}
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-emerald-700">
                      {format(tableTotals.store.total + tableTotals.delivery.total)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
