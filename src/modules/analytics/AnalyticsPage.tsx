import { useEffect, useState, useCallback } from 'react';
import {
  Users, UserPlus, MousePointerClick, Eye, Clock, Globe,
  Smartphone, Monitor, Tablet, RefreshCw, TrendingUp, Radio, AlertTriangle,
} from 'lucide-react';
import { fetchWebAnalytics, type WebAnalytics } from './analyticsService';

// ════════════════════════════════════════
// Helpers
// ════════════════════════════════════════
function fmt(n: number): string {
  return new Intl.NumberFormat('es-VE').format(n || 0);
}
function fmtDuration(sec: number): string {
  if (!sec) return '0s';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m ? `${m}m ${s}s` : `${s}s`;
}
// "20240622" -> "22 jun"
function fmtDate(d: string): string {
  if (!d || d.length !== 8) return d;
  const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  return `${Number(d.slice(6, 8))} ${months[Number(d.slice(4, 6)) - 1]}`;
}
function deviceIcon(d: string) {
  if (/mobile/i.test(d)) return <Smartphone size={16} />;
  if (/tablet/i.test(d)) return <Tablet size={16} />;
  return <Monitor size={16} />;
}
function deviceLabel(d: string) {
  if (/mobile/i.test(d)) return 'Móvil';
  if (/tablet/i.test(d)) return 'Tablet';
  if (/desktop/i.test(d)) return 'Computadora';
  return d;
}

// ════════════════════════════════════════
// Gráfico de área (usuarios por día)
// ════════════════════════════════════════
function AreaChart({ data }: { data: { date: string; users: number }[] }) {
  if (data.length < 2) {
    return <div className="h-40 flex items-center justify-center text-navy-300 text-sm">Aún no hay suficientes datos.</div>;
  }
  const W = 760, H = 160, pad = 8;
  const max = Math.max(...data.map((d) => d.users), 1);
  const pts = data.map((d, i) => {
    const x = (i / (data.length - 1)) * (W - pad * 2) + pad;
    const y = H - (d.users / max) * (H - pad * 2) - pad;
    return [x, y];
  });
  const line = pts.map((p) => p.join(',')).join(' ');
  const area = `${pad},${H} ${line} ${W - pad},${H}`;
  return (
    <div className="w-full overflow-hidden">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-40" preserveAspectRatio="none">
        <defs>
          <linearGradient id="ga-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={area} fill="url(#ga-area)" />
        <polyline points={line} fill="none" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="flex justify-between text-[10px] text-navy-300 px-1">
        <span>{fmtDate(data[0].date)}</span>
        <span>{fmtDate(data[data.length - 1].date)}</span>
      </div>
    </div>
  );
}

// ════════════════════════════════════════
// Lista con barras de proporción
// ════════════════════════════════════════
function BarList({ items }: { items: { label: React.ReactNode; value: number; sub?: string }[] }) {
  const max = Math.max(...items.map((i) => i.value), 1);
  if (items.length === 0) {
    return <div className="py-8 text-center text-navy-300 text-sm">Sin datos en este período.</div>;
  }
  return (
    <div className="flex flex-col gap-2.5">
      {items.map((it, idx) => (
        <div key={idx} className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-sm text-navy-700 truncate">{it.label}</span>
              <span className="text-sm font-semibold text-navy-900 flex-shrink-0">{fmt(it.value)}</span>
            </div>
            <div className="h-1.5 bg-surface-100 rounded-full overflow-hidden">
              <div className="h-full bg-blue-500 rounded-full" style={{ width: `${(it.value / max) * 100}%` }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ════════════════════════════════════════
// Tarjeta de métrica
// ════════════════════════════════════════
function StatCard({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent: string }) {
  return (
    <div className="bg-white border border-surface-200 rounded-2xl p-4 flex items-center gap-4">
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${accent}`}>{icon}</div>
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wider text-navy-400 font-display font-semibold">{label}</p>
        <p className="text-2xl font-bold text-navy-900 leading-tight">{value}</p>
      </div>
    </div>
  );
}

const RANGES: { v: 7 | 28 | 90; label: string }[] = [
  { v: 7, label: '7 días' },
  { v: 28, label: '28 días' },
  { v: 90, label: '90 días' },
];

// ════════════════════════════════════════
// Página
// ════════════════════════════════════════
export function AnalyticsPage() {
  const [days, setDays] = useState<7 | 28 | 90>(28);
  const [data, setData] = useState<WebAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback((d: 7 | 28 | 90) => {
    setLoading(true);
    setError('');
    fetchWebAnalytics(d)
      .then(setData)
      .catch((e) => setError(e.message || 'Error cargando analíticas'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(days); }, [days, load]);

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-navy-900 flex items-center gap-2">
            <TrendingUp className="text-blue-500" size={24} /> Tráfico Web
          </h1>
          <p className="text-sm text-navy-400">Analíticas de tu tienda online (Google Analytics)</p>
        </div>
        <div className="flex items-center gap-2">
          {data && (
            <span className="flex items-center gap-1.5 px-3 py-1.5 bg-green-50 text-green-700 rounded-lg text-sm font-medium">
              <Radio size={14} className="animate-pulse" /> {fmt(data.activeNow)} ahora
            </span>
          )}
          <div className="flex bg-surface-100 rounded-lg p-1">
            {RANGES.map((r) => (
              <button
                key={r.v}
                onClick={() => setDays(r.v)}
                className={`px-3 py-1 text-sm rounded-md transition-colors ${days === r.v ? 'bg-white text-navy-900 shadow-sm font-medium' : 'text-navy-500 hover:text-navy-800'}`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => load(days)}
            disabled={loading}
            className="p-2 bg-white border border-surface-200 rounded-lg text-navy-500 hover:text-navy-900 disabled:opacity-50"
            title="Actualizar"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 flex items-start gap-3 mb-6">
          <AlertTriangle className="text-amber-500 flex-shrink-0 mt-0.5" size={20} />
          <div>
            <p className="font-semibold text-amber-800">No se pudieron cargar las analíticas</p>
            <p className="text-sm text-amber-700 mt-1">{error}</p>
            <p className="text-xs text-amber-600 mt-2">
              Revisa que esté habilitada la "Google Analytics Data API" en Google Cloud y que la cuenta de servicio
              tenga acceso de Lector en la propiedad GA4.
            </p>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && !data && (
        <div className="flex items-center justify-center h-64 text-navy-300">
          <RefreshCw size={24} className="animate-spin mr-2" /> Cargando analíticas...
        </div>
      )}

      {/* Contenido */}
      {data && (
        <div className="flex flex-col gap-6">
          {/* Tarjetas resumen */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <StatCard icon={<Users size={20} className="text-blue-600" />} accent="bg-blue-50" label="Visitantes" value={fmt(data.summary.totalUsers)} />
            <StatCard icon={<UserPlus size={20} className="text-cyan-600" />} accent="bg-cyan-50" label="Nuevos" value={fmt(data.summary.newUsers)} />
            <StatCard icon={<MousePointerClick size={20} className="text-purple-600" />} accent="bg-purple-50" label="Sesiones" value={fmt(data.summary.sessions)} />
            <StatCard icon={<Eye size={20} className="text-amber-600" />} accent="bg-amber-50" label="Páginas vistas" value={fmt(data.summary.pageViews)} />
            <StatCard icon={<Clock size={20} className="text-teal-600" />} accent="bg-teal-50" label="Sesión prom." value={fmtDuration(data.summary.avgSessionSec)} />
          </div>

          {/* Tendencia */}
          <div className="bg-white border border-surface-200 rounded-2xl p-5">
            <h2 className="text-sm font-display font-semibold text-navy-700 mb-3">Visitantes por día</h2>
            <AreaChart data={data.timeseries} />
          </div>

          {/* Páginas + Países */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white border border-surface-200 rounded-2xl p-5">
              <h2 className="text-sm font-display font-semibold text-navy-700 mb-4 flex items-center gap-2">
                <Eye size={16} className="text-blue-500" /> Productos / páginas más vistas
              </h2>
              <BarList items={data.topPages.map((p) => ({ label: p.title || '(sin título)', value: p.views }))} />
            </div>
            <div className="bg-white border border-surface-200 rounded-2xl p-5">
              <h2 className="text-sm font-display font-semibold text-navy-700 mb-4 flex items-center gap-2">
                <Globe size={16} className="text-green-500" /> De dónde son tus visitantes
              </h2>
              <BarList items={data.countries.map((c) => ({ label: c.country || '(desconocido)', value: c.users }))} />
            </div>
          </div>

          {/* Dispositivos + Canales */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white border border-surface-200 rounded-2xl p-5">
              <h2 className="text-sm font-display font-semibold text-navy-700 mb-4 flex items-center gap-2">
                <Smartphone size={16} className="text-indigo-500" /> Dispositivos
              </h2>
              <BarList items={data.devices.map((d) => ({
                label: <span className="inline-flex items-center gap-2">{deviceIcon(d.device)} {deviceLabel(d.device)}</span>,
                value: d.users,
              }))} />
            </div>
            <div className="bg-white border border-surface-200 rounded-2xl p-5">
              <h2 className="text-sm font-display font-semibold text-navy-700 mb-4 flex items-center gap-2">
                <TrendingUp size={16} className="text-rose-500" /> Cómo llegan a tu tienda
              </h2>
              <BarList items={data.sources.map((s) => ({ label: s.channel || '(directo)', value: s.sessions }))} />
            </div>
          </div>

          <p className="text-xs text-navy-300 text-center">
            Datos de Google Analytics · los informes históricos pueden tardar hasta 24-48h en reflejar todo.
          </p>
        </div>
      )}
    </div>
  );
}
