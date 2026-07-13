import { useEffect, useState, useCallback } from 'react';
import {
  Users, UserPlus, MousePointerClick, Eye, Clock, Globe,
  Smartphone, Monitor, Tablet, RefreshCw, TrendingUp, Radio, AlertTriangle,
  ArrowUpRight, ArrowDownRight, BarChart3,
} from 'lucide-react';
import { fetchWebAnalytics, fetchLive, type WebAnalytics, type RealtimeData, type Range, type DayPoint } from './analyticsService';

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
function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}
function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
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
// Métricas graficables por día.
//
// Los tres colores están validados para daltonismo (separación ΔE 53 en el peor
// par, muy por encima del mínimo de 12) y todos contrastan >=3:1 contra el fondo
// blanco. El color pertenece a la MÉTRICA, no a su posición: si cambias de
// métrica, cada una conserva siempre el suyo.
// ════════════════════════════════════════
type MetricKey = 'users' | 'sessions' | 'pageViews';

const METRICS: { key: MetricKey; label: string; color: string; soft: string }[] = [
  { key: 'users', label: 'Visitantes', color: '#2563eb', soft: '#dbeafe' },
  { key: 'sessions', label: 'Sesiones', color: '#ea580c', soft: '#ffedd5' },
  { key: 'pageViews', label: 'Páginas vistas', color: '#0d9488', soft: '#ccfbf1' },
];

// "20240622" -> "sáb 22 jun"
function fmtDateLong(d: string): string {
  if (!d || d.length !== 8) return d;
  const days = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  const dt = new Date(Number(d.slice(0, 4)), Number(d.slice(4, 6)) - 1, Number(d.slice(6, 8)));
  return `${days[dt.getDay()]} ${fmtDate(d)}`;
}
function isWeekend(d: string): boolean {
  if (!d || d.length !== 8) return false;
  const dt = new Date(Number(d.slice(0, 4)), Number(d.slice(4, 6)) - 1, Number(d.slice(6, 8)));
  return dt.getDay() === 0 || dt.getDay() === 6;
}

// ════════════════════════════════════════
// Rendimiento por día — barras con métrica seleccionable.
//
// Barras (no área) porque cada día es una magnitud discreta y comparable; el
// área invitaba a leer una tendencia continua y no dejaba ver el valor de un
// día concreto. Se añade tooltip al pasar el mouse (con TODAS las métricas de
// ese día), línea de promedio y etiqueta directa solo en el mejor día — nunca
// un número sobre cada barra.
// ════════════════════════════════════════
function DailyChart({ data }: { data: DayPoint[] }) {
  const [metric, setMetric] = useState<MetricKey>('users');
  const [hover, setHover] = useState<number | null>(null);

  if (data.length === 0) {
    return <div className="h-52 flex items-center justify-center text-navy-300 text-sm">Aún no hay datos en este período.</div>;
  }

  const m = METRICS.find((x) => x.key === metric)!;
  const values = data.map((d) => d[metric] || 0);
  const max = Math.max(...values, 1);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const bestIdx = values.indexOf(Math.max(...values));

  const H = 200;          // alto del área de trazado
  const AXIS = 22;        // franja inferior para las fechas
  const gap = data.length > 45 ? 1 : 2;   // separación entre barras (px del viewBox)
  const W = 900;
  const bw = Math.max(1, (W / data.length) - gap);

  const y = (v: number) => H - (v / max) * (H - 12);

  // Etiquetas del eje X: todas si son pocas; si no, ~8 repartidas.
  const step = Math.max(1, Math.ceil(data.length / 8));

  return (
    <div>
      {/* Selector de métrica */}
      <div className="flex flex-wrap items-center gap-1.5 mb-4">
        {METRICS.map((opt) => {
          const on = opt.key === metric;
          return (
            <button
              key={opt.key}
              onClick={() => setMetric(opt.key)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                on ? 'bg-white border-surface-300 text-navy-900 shadow-sm' : 'bg-transparent border-transparent text-navy-400 hover:text-navy-700'
              }`}
            >
              <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: opt.color }} />
              {opt.label}
            </button>
          );
        })}
        <span className="ml-auto text-[11px] text-navy-400">
          Promedio <strong className="text-navy-700 font-semibold">{fmt(Math.round(avg))}</strong> / día
        </span>
      </div>

      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H + AXIS}`} className="w-full h-56" preserveAspectRatio="none">
          {/* Rejilla recesiva: 4 líneas de referencia */}
          {[0.25, 0.5, 0.75, 1].map((f) => (
            <line key={f} x1="0" x2={W} y1={y(max * f)} y2={y(max * f)}
              stroke="#f1f5f9" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          ))}

          {/* Barras */}
          {data.map((d, i) => {
            const v = d[metric] || 0;
            const x = i * (W / data.length);
            const top = y(v);
            const isHover = hover === i;
            const isBest = i === bestIdx;
            return (
              <rect
                key={d.date}
                x={x} y={top} width={bw} height={Math.max(H - top, v > 0 ? 2 : 0)}
                rx={Math.min(3, bw / 2)}
                fill={isHover || isBest ? m.color : m.soft}
                stroke={isBest && !isHover ? m.color : 'none'}
                strokeWidth="1.5"
                vectorEffect="non-scaling-stroke"
                className="transition-[fill] duration-100"
              />
            );
          })}

          {/* Línea de promedio, por encima de las barras */}
          <line x1="0" x2={W} y1={y(avg)} y2={y(avg)}
            stroke="#64748b" strokeWidth="1.5" strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />

          {/* Zonas de hover: más anchas que la barra, para que sea fácil apuntar */}
          {data.map((d, i) => (
            <rect
              key={`h-${d.date}`}
              x={i * (W / data.length)} y={0}
              width={W / data.length} height={H}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover((h) => (h === i ? null : h))}
            />
          ))}

          {/* Fechas del eje X */}
          {data.map((d, i) => (
            i % step === 0 || i === data.length - 1 ? (
              <text
                key={`t-${d.date}`}
                x={i * (W / data.length) + bw / 2}
                y={H + 15}
                textAnchor="middle"
                className="fill-navy-300"
                style={{ fontSize: '11px' }}
              >
                {fmtDate(d.date)}
              </text>
            ) : null
          ))}
        </svg>

        {/* Tooltip: todas las métricas del día apuntado */}
        {hover !== null && data[hover] && (
          <div
            className="absolute z-10 pointer-events-none bg-white border border-surface-200 shadow-lg rounded-xl px-3 py-2 text-xs"
            style={{
              left: `${((hover + 0.5) / data.length) * 100}%`,
              transform: `translateX(${hover < data.length / 2 ? '8px' : 'calc(-100% - 8px)'})`,
              top: 0,
            }}
          >
            <p className="font-semibold text-navy-900 mb-1.5 whitespace-nowrap">
              {fmtDateLong(data[hover].date)}
              {isWeekend(data[hover].date) && <span className="ml-1.5 text-navy-300 font-normal">fin de semana</span>}
            </p>
            {METRICS.map((opt) => (
              <p key={opt.key} className="flex items-center gap-2 whitespace-nowrap leading-relaxed">
                <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: opt.color }} />
                <span className="text-navy-500">{opt.label}</span>
                <span className="ml-auto font-semibold text-navy-900">{fmt(data[hover][opt.key])}</span>
              </p>
            ))}
            <p className="flex items-center gap-2 whitespace-nowrap leading-relaxed border-t border-surface-100 mt-1.5 pt-1.5">
              <span className="text-navy-500">Sesión prom.</span>
              <span className="ml-auto font-semibold text-navy-900">{fmtDuration(data[hover].avgSessionSec)}</span>
            </p>
          </div>
        )}
      </div>

      <p className="text-[11px] text-navy-400 mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="flex items-center gap-1.5">
          <svg width="18" height="4"><line x1="0" y1="2" x2="18" y2="2" stroke="#64748b" strokeWidth="1.5" strokeDasharray="5 4" /></svg>
          promedio del período
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm border-[1.5px]" style={{ borderColor: m.color }} />
          mejor día: <strong className="text-navy-700 font-semibold">{fmtDateLong(data[bestIdx].date)}</strong> ({fmt(values[bestIdx])})
        </span>
      </p>
    </div>
  );
}

// ════════════════════════════════════════
// Sesiones por hora del día — cuándo entra la gente a la tienda
// ════════════════════════════════════════
function HourlyChart({ data }: { data: { hour: number; sessions: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);

  // GA4 omite las horas sin tráfico: rellenamos las 24 para que el eje sea un
  // día completo y los huecos se lean como lo que son (cero), no como ausencia.
  const full = Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    sessions: data.find((d) => d.hour === h)?.sessions || 0,
  }));

  const max = Math.max(...full.map((d) => d.sessions), 1);
  const peak = full.reduce((a, b) => (b.sessions > a.sessions ? b : a), full[0]);

  if (max === 1 && peak.sessions === 0) {
    return <div className="h-40 flex items-center justify-center text-navy-300 text-sm">Sin datos en este período.</div>;
  }

  return (
    <div>
      <div className="flex items-end gap-[3px] h-40">
        {full.map((d) => {
          const on = hover === d.hour;
          return (
            <div
              key={d.hour}
              className="flex-1 flex flex-col justify-end h-full relative group"
              onMouseEnter={() => setHover(d.hour)}
              onMouseLeave={() => setHover(null)}
            >
              {on && (
                <div className="absolute -top-1 left-1/2 -translate-x-1/2 -translate-y-full z-10 pointer-events-none
                                bg-white border border-surface-200 shadow-lg rounded-lg px-2.5 py-1.5 text-xs whitespace-nowrap">
                  <span className="font-semibold text-navy-900">{fmt(d.sessions)}</span>
                  <span className="text-navy-500"> sesiones · {String(d.hour).padStart(2, '0')}:00</span>
                </div>
              )}
              <div
                className="w-full rounded-t transition-colors"
                style={{
                  height: `${Math.max((d.sessions / max) * 100, d.sessions > 0 ? 2 : 0)}%`,
                  background: on || d.hour === peak.hour ? '#2563eb' : '#dbeafe',
                }}
              />
            </div>
          );
        })}
      </div>
      {/* Eje: solo cada 3h, para que no se amontonen */}
      <div className="flex gap-[3px] mt-1.5">
        {full.map((d) => (
          <span key={d.hour} className="flex-1 text-center text-[10px] text-navy-300">
            {d.hour % 3 === 0 ? String(d.hour).padStart(2, '0') : ''}
          </span>
        ))}
      </div>
      <p className="text-[11px] text-navy-400 mt-2">
        Hora pico: <strong className="text-navy-700 font-semibold">{String(peak.hour).padStart(2, '0')}:00</strong> con {fmt(peak.sessions)} sesiones.
      </p>
    </div>
  );
}

// ════════════════════════════════════════
// Lista con barras de proporción
// ════════════════════════════════════════
function BarList({ items }: { items: { label: React.ReactNode; value: number }[] }) {
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
function StatCard({ icon, label, value, accent, current, prev }: {
  icon: React.ReactNode; label: string; value: string; accent: string;
  current?: number; prev?: number;
}) {
  // Delta contra el período anterior de igual largo. Si antes era 0 no hay
  // porcentaje que calcular (sería división por cero, no un "+100%").
  let delta: number | null = null;
  if (current !== undefined && prev !== undefined && prev > 0) {
    delta = ((current - prev) / prev) * 100;
  }
  const up = (delta ?? 0) >= 0;

  return (
    <div className="bg-white border border-surface-200 rounded-2xl p-4 flex items-center gap-4">
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${accent}`}>{icon}</div>
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wider text-navy-400 font-display font-semibold">{label}</p>
        <p className="text-2xl font-bold text-navy-900 leading-tight">{value}</p>
        {delta !== null && (
          <p
            className={`text-[11px] font-medium mt-0.5 flex items-center gap-0.5 ${up ? 'text-emerald-600' : 'text-rose-600'}`}
            title={`Período anterior: ${fmt(prev!)}`}
          >
            {up ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
            {Math.abs(delta).toFixed(delta >= 10 || delta <= -10 ? 0 : 1)}%
            <span className="text-navy-300 font-normal ml-0.5">vs. antes</span>
          </p>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════
// Sección EN VIVO (tiempo real, últimos 30 min)
// ════════════════════════════════════════
function LiveSection({ live }: { live: RealtimeData | null }) {
  return (
    <div className="bg-gradient-to-br from-green-50 to-white border border-green-200 rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-display font-semibold text-green-800 flex items-center gap-2">
          <Radio size={16} className="animate-pulse" /> En vivo · últimos 30 min
        </h2>
        <span className="text-[10px] text-green-600">se actualiza solo</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Usuarios ahora */}
        <div className="flex flex-col items-center justify-center py-2">
          <span className="text-5xl font-bold text-green-600 leading-none">{fmt(live?.activeNow || 0)}</span>
          <span className="text-xs text-navy-500 mt-2">usuarios navegando ahora</span>
        </div>
        {/* Qué ven ahora */}
        <div>
          <p className="text-xs font-semibold text-navy-500 mb-2 flex items-center gap-1.5"><Eye size={13} /> Viendo ahora</p>
          {live && live.livePages.length > 0 ? (
            <ul className="flex flex-col gap-1.5">
              {live.livePages.slice(0, 5).map((p, i) => (
                <li key={i} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-navy-700 truncate">{p.title || '(sin título)'}</span>
                  <span className="font-semibold text-navy-900 flex-shrink-0">{fmt(p.users)}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-navy-300">Nadie navegando ahora mismo.</p>}
        </div>
        {/* Países ahora */}
        <div>
          <p className="text-xs font-semibold text-navy-500 mb-2 flex items-center gap-1.5"><Globe size={13} /> Desde dónde</p>
          {live && live.liveCountries.length > 0 ? (
            <ul className="flex flex-col gap-1.5">
              {live.liveCountries.slice(0, 5).map((c, i) => (
                <li key={i} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-navy-700 truncate">{c.country || '(desconocido)'}</span>
                  <span className="font-semibold text-navy-900 flex-shrink-0">{fmt(c.users)}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-navy-300">—</p>}
        </div>
      </div>
    </div>
  );
}

const PRESETS: { v: 7 | 28 | 90; label: string }[] = [
  { v: 7, label: '7 días' },
  { v: 28, label: '28 días' },
  { v: 90, label: '90 días' },
];

// ════════════════════════════════════════
// Página
// ════════════════════════════════════════
export function AnalyticsPage() {
  const [preset, setPreset] = useState<7 | 28 | 90 | 'custom'>(28);
  const [customStart, setCustomStart] = useState(isoDaysAgo(28));
  const [customEnd, setCustomEnd] = useState(isoToday());
  const [data, setData] = useState<WebAnalytics | null>(null);
  const [live, setLive] = useState<RealtimeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    const range: Range = preset === 'custom' ? { start: customStart, end: customEnd } : preset;
    fetchWebAnalytics(range)
      .then((d) => {
        setData(d);
        setLive({ activeNow: d.activeNow, livePages: d.livePages, liveCountries: d.liveCountries });
      })
      .catch((e) => setError(e.message || 'Error cargando analíticas'))
      .finally(() => setLoading(false));
  }, [preset, customStart, customEnd]);

  // Carga inicial + al cambiar de preset (el rango personalizado se aplica con el botón)
  useEffect(() => {
    if (preset !== 'custom') load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset]);

  // Polling de tiempo real cada 30s
  useEffect(() => {
    const id = setInterval(() => {
      fetchLive().then(setLive).catch(() => { /* ignora fallos transitorios */ });
    }, 30000);
    return () => clearInterval(id);
  }, []);

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
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex bg-surface-100 rounded-lg p-1">
            {PRESETS.map((r) => (
              <button
                key={r.v}
                onClick={() => setPreset(r.v)}
                className={`px-3 py-1 text-sm rounded-md transition-colors ${preset === r.v ? 'bg-white text-navy-900 shadow-sm font-medium' : 'text-navy-500 hover:text-navy-800'}`}
              >
                {r.label}
              </button>
            ))}
            <button
              onClick={() => setPreset('custom')}
              className={`px-3 py-1 text-sm rounded-md transition-colors ${preset === 'custom' ? 'bg-white text-navy-900 shadow-sm font-medium' : 'text-navy-500 hover:text-navy-800'}`}
            >
              Personalizado
            </button>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="p-2 bg-white border border-surface-200 rounded-lg text-navy-500 hover:text-navy-900 disabled:opacity-50"
            title="Actualizar"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Selector de fechas personalizado */}
      {preset === 'custom' && (
        <div className="flex flex-wrap items-end gap-3 mb-6 bg-white border border-surface-200 rounded-2xl p-4">
          <div>
            <label className="block text-xs text-navy-400 mb-1">Desde</label>
            <input type="date" value={customStart} max={customEnd}
              onChange={(e) => setCustomStart(e.target.value)}
              className="border border-surface-200 rounded-lg px-3 py-1.5 text-sm text-navy-800" />
          </div>
          <div>
            <label className="block text-xs text-navy-400 mb-1">Hasta</label>
            <input type="date" value={customEnd} min={customStart} max={isoToday()}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="border border-surface-200 rounded-lg px-3 py-1.5 text-sm text-navy-800" />
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="px-4 py-1.5 bg-blue-500 hover:bg-blue-600 text-white text-sm rounded-lg disabled:opacity-50"
          >
            Aplicar
          </button>
        </div>
      )}

      {/* Sección en vivo (siempre visible) */}
      <div className="mb-6">
        <LiveSection live={live} />
      </div>

      {/* Error */}
      {error && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 flex items-start gap-3 mb-6">
          <AlertTriangle className="text-amber-500 flex-shrink-0 mt-0.5" size={20} />
          <div>
            <p className="font-semibold text-amber-800">No se pudieron cargar las analíticas</p>
            {/* El backend ya distingue cuota agotada, API deshabilitada y falta
                de permisos, así que mostramos SU mensaje. Antes había aquí un
                texto fijo sobre Google Cloud que se mostraba ante cualquier
                fallo y mandaba a revisar cosas que estaban bien. */}
            <p className="text-sm text-amber-700 mt-1">{error}</p>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && !data && (
        <div className="flex items-center justify-center h-64 text-navy-300">
          <RefreshCw size={24} className="animate-spin mr-2" /> Cargando analíticas...
        </div>
      )}

      {/* Contenido histórico */}
      {data && (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <StatCard icon={<Users size={20} className="text-blue-600" />} accent="bg-blue-50" label="Visitantes"
              value={fmt(data.summary.totalUsers)} current={data.summary.totalUsers} prev={data.previous?.totalUsers} />
            <StatCard icon={<UserPlus size={20} className="text-cyan-600" />} accent="bg-cyan-50" label="Nuevos"
              value={fmt(data.summary.newUsers)} current={data.summary.newUsers} prev={data.previous?.newUsers} />
            <StatCard icon={<MousePointerClick size={20} className="text-purple-600" />} accent="bg-purple-50" label="Sesiones"
              value={fmt(data.summary.sessions)} current={data.summary.sessions} prev={data.previous?.sessions} />
            <StatCard icon={<Eye size={20} className="text-amber-600" />} accent="bg-amber-50" label="Páginas vistas"
              value={fmt(data.summary.pageViews)} current={data.summary.pageViews} prev={data.previous?.pageViews} />
            <StatCard icon={<Clock size={20} className="text-teal-600" />} accent="bg-teal-50" label="Sesión prom."
              value={fmtDuration(data.summary.avgSessionSec)} current={data.summary.avgSessionSec} prev={data.previous?.avgSessionSec} />
          </div>

          <div className="bg-white border border-surface-200 rounded-2xl p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
              <h2 className="text-sm font-display font-semibold text-navy-700 flex items-center gap-2">
                <BarChart3 size={16} className="text-blue-500" /> Rendimiento por día
              </h2>
              <p className="text-[11px] text-navy-300">Pasa el mouse por un día para ver el detalle</p>
            </div>
            <DailyChart data={data.timeseries} />
          </div>

          <div className="bg-white border border-surface-200 rounded-2xl p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
              <h2 className="text-sm font-display font-semibold text-navy-700 flex items-center gap-2">
                <Clock size={16} className="text-blue-500" /> A qué hora te visitan
              </h2>
              <p className="text-[11px] text-navy-300">Sesiones acumuladas por hora del día</p>
            </div>
            <HourlyChart data={data.hourly || []} />
          </div>

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
            Los totales históricos pueden tardar hasta 24-48h en reflejar los días más recientes (es así también dentro
            de Google Analytics). La sección "En vivo" es instantánea.
          </p>
        </div>
      )}
    </div>
  );
}
