import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAppStore } from '@/store/appStore';
import { useToast } from '@/components/Toast';
import { PageLoading } from '@/components/LoadingScreen';
import { todayVE, shiftDateKey, formatDateTime } from '@/utils/dateUtils';
import {
  fetchLiveRates, fetchRateHistory, fetchRateHistoryRange, getRateSnapshot,
  saveRateSnapshot, gapPercent, computePeriodStats, type LiveRates, type SeriesStats,
} from './ratesService';
import type { RateSnapshot } from '@/types';
import {
  TrendingUp, RefreshCw, DollarSign, Euro, Bitcoin, AlertTriangle,
  ArrowUpRight, ArrowDownRight, Minus, CalendarRange, X,
} from 'lucide-react';

function fmtBs(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(n: number | null): string {
  if (n === null) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;
}

/** DD/MM/AAAA a partir del dateKey, sin pasar por Date (evita corrimientos). */
function fmtDateKey(dateKey: string | null): string {
  if (!dateKey) return '—';
  const [y, m, d] = dateKey.split('-');
  return `${d}/${m}/${y}`;
}

/**
 * Firestore contesta "Missing or insufficient permissions" sin decir qué
 * colección rebotó. Como acá la causa es siempre la misma —las reglas de
 * rateHistory sin publicar— se traduce a algo accionable.
 */
function describeError(err: any): string {
  const raw = String(err?.code || err?.message || '');
  if (/permission|insufficient/i.test(raw)) {
    return 'Firestore rechazó el guardado: falta publicar la regla de "rateHistory" '
      + 'en Firebase → Firestore → Reglas.';
  }
  return err?.message || 'No se pudo cargar el historial de tasas.';
}

/** Días que se muestran mientras no haya un rango elegido. */
const DEFAULT_DAYS = 30;

const PRESETS = [
  { label: '7 días', days: 7 },
  { label: '30 días', days: 30 },
  { label: '90 días', days: 90 },
];

export function RatesPage() {
  const currentUser = useAppStore((s) => s.currentUser);
  const toast = useToast();

  // Vacías a propósito: sin rango elegido el panel muestra los últimos días
  // y NO el cuadro de cálculo, que solo tiene sentido sobre un período.
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const rangeActive = Boolean(from && to && from <= to);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [history, setHistory] = useState<RateSnapshot[]>([]);
  const [live, setLive] = useState<LiveRates | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);

  /**
   * Trae el rango filtrado y las tasas de ahora. Si el día todavía no tiene
   * fila —o la tiene incompleta porque una fuente estaba caída— la guarda:
   * es la red de seguridad por si la tarea programada de las 6 PM falló.
   *
   * La fila de hoy se lee aparte del rango: si el filtro apunta a un período
   * viejo, `history` no la contiene y sin esa lectura se volvería a guardar
   * en cada cambio de fechas.
   *
   * Devuelve qué pasó en vez de tragarse los errores: quien la llama necesita
   * saberlo para no cantar un "guardado" que nunca ocurrió.
   */
  const load = useCallback(async (
    opts: { forceSave?: boolean } = {},
  ): Promise<'saved' | 'sin-tasas' | 'sin-cambios'> => {
    const dateKey = todayVE();

    const [rows, todayRow, liveRates] = await Promise.all([
      rangeActive ? fetchRateHistoryRange(from, to) : fetchRateHistory(DEFAULT_DAYS),
      getRateSnapshot(dateKey),
      fetchLiveRates().catch((err) => {
        setLiveError(err?.message || 'No se pudieron consultar las tasas.');
        return null;
      }),
    ]);

    setHistory(rows);
    setLive(liveRates);
    if (liveRates) setLiveError(null);
    if (!liveRates) return 'sin-tasas';

    const nothingLive = liveRates.bcv === null && liveRates.eur === null && liveRates.binance === null;
    if (nothingLive) return 'sin-tasas';

    const fills = (['bcv', 'eur', 'binance'] as const)
      .some((k) => liveRates[k] !== null && (!todayRow || todayRow[k] === null));
    if (!opts.forceSave && !fills) return 'sin-cambios';

    // Al reintentar no se pisa un valor bueno con un null de una fuente caída.
    const saved = await saveRateSnapshot({
      dateKey,
      rates: {
        bcv: liveRates.bcv ?? todayRow?.bcv ?? null,
        eur: liveRates.eur ?? todayRow?.eur ?? null,
        binance: liveRates.binance ?? todayRow?.binance ?? null,
      },
      source: opts.forceSave ? 'manual' : 'auto',
      user: currentUser,
    });

    // Solo se refleja en la tabla si el día cae dentro de lo que se está viendo.
    if (!rangeActive || (dateKey >= from && dateKey <= to)) {
      setHistory([saved, ...rows.filter((r) => r.dateKey !== dateKey)]);
    }
    return 'saved';
  }, [from, to, rangeActive, currentUser]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        await load();
      } catch (err: any) {
        console.error('Error cargando las tasas:', err);
        if (!cancelled) toast.error(describeError(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [load, toast]);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const result = await load({ forceSave: true });
      if (result === 'saved') toast.success('Tasas del día actualizadas.');
      else toast.warning('No se pudo consultar ninguna tasa — no se guardó nada.');
    } catch (err: any) {
      console.error('Error actualizando las tasas:', err);
      toast.error(describeError(err));
    } finally {
      setRefreshing(false);
    }
  }

  function applyPreset(days: number) {
    const end = todayVE();
    setFrom(shiftDateKey(end, -(days - 1)));
    setTo(end);
  }

  // Para las tarjetas de arriba: lo de ahora si la consulta salió, y si no
  // la última fila guardada, para no mostrar la pantalla vacía.
  const shown = useMemo(() => {
    if (live) return { bcv: live.bcv, eur: live.eur, binance: live.binance, fromHistory: false };
    const last = history[0];
    return {
      bcv: last?.bcv ?? null,
      eur: last?.eur ?? null,
      binance: last?.binance ?? null,
      fromHistory: Boolean(last),
    };
  }, [live, history]);

  const stats = useMemo(() => computePeriodStats(history), [history]);
  const rangeInvalid = Boolean(from && to && from > to);

  return (
    <div className="space-y-5 animate-fade-up">
      {/* ── Encabezado ── */}
      <div className="card p-5">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-3 mr-auto">
            <div className="w-11 h-11 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0">
              <TrendingUp size={20} className="text-emerald-600" />
            </div>
            <div>
              <h1 className="text-lg font-display font-bold text-navy-900">Variación de Tasas</h1>
              <p className="text-navy-400 text-xs font-body">
                BCV, euro y P2P de Binance · se guarda una fila por día a las 6 PM
              </p>
            </div>
          </div>

          <button onClick={handleRefresh} disabled={loading || refreshing} className="btn-ghost text-sm">
            <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
            Actualizar tasas de hoy
          </button>
        </div>
      </div>

      {/* ── Tasas de ahora ── */}
      <div className="grid sm:grid-cols-3 gap-5">
        <RateCard
          label="BCV — Dólar" value={shown.bcv}
          icon={<DollarSign size={18} className="text-emerald-600" />}
          hint={live?.bcvDate ? `Fecha valor ${fmtDateKey(live.bcvDate)}` : undefined}
        />
        <RateCard
          label="BCV — Euro" value={shown.eur}
          icon={<Euro size={18} className="text-blue-600" />}
        />
        <RateCard
          label="Binance P2P" value={shown.binance}
          icon={<Bitcoin size={18} className="text-amber-500" />}
          hint={live?.binanceAds?.length
            ? `Mediana de ${live.binanceAds.length} avisos de venta`
            : undefined}
        />
      </div>

      {/* ── Brechas de ahora ── */}
      <div className="grid sm:grid-cols-2 gap-5">
        <GapCard label="Binance sobre BCV" pct={gapPercent(shown.bcv, shown.binance)}
          detail={shown.bcv && shown.binance
            ? `${fmtBs(shown.binance - shown.bcv)} Bs de diferencia por dólar`
            : 'Falta alguna de las dos tasas'} />
        <GapCard label="Binance sobre Euro" pct={gapPercent(shown.eur, shown.binance)}
          detail={shown.eur && shown.binance
            ? `${fmtBs(shown.binance - shown.eur)} Bs de diferencia`
            : 'Falta alguna de las dos tasas'} />
      </div>

      {shown.fromHistory && (
        <p className="text-xs text-navy-400 font-body">
          Mostrando la última fila guardada — las tasas de ahora no se pudieron consultar.
        </p>
      )}

      {liveError && (
        <div className="card p-4 border-l-4 border-l-amber-500 flex gap-3">
          <AlertTriangle size={18} className="text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-display font-medium text-navy-800">No se pudieron consultar las tasas de ahora</p>
            <p className="text-navy-500 font-body mt-0.5">{liveError}</p>
          </div>
        </div>
      )}

      {live && live.errors.length > 0 && (
        <div className="card p-4 border-l-4 border-l-amber-500 flex gap-3">
          <AlertTriangle size={18} className="text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-display font-medium text-navy-800">Alguna fuente no respondió</p>
            <ul className="text-navy-500 font-body mt-0.5 list-disc list-inside">
              {live.errors.map((e) => <li key={e}>{e}</li>)}
            </ul>
          </div>
        </div>
      )}

      {/* ── Filtro por fecha ── */}
      <div className="card p-5">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex items-center gap-2 text-navy-500 mr-auto">
            <CalendarRange size={16} />
            <span className="text-sm font-display font-medium">Período</span>
          </div>

          <div>
            <label className="block text-xs font-display font-medium text-navy-500 mb-1">Desde</label>
            <input type="date" value={from} max={todayVE()}
              onChange={(e) => setFrom(e.target.value)} className="input-field" />
          </div>
          <div>
            <label className="block text-xs font-display font-medium text-navy-500 mb-1">Hasta</label>
            <input type="date" value={to} max={todayVE()}
              onChange={(e) => setTo(e.target.value)} className="input-field" />
          </div>

          <div className="flex gap-1">
            {PRESETS.map((p) => (
              <button key={p.days} type="button" onClick={() => applyPreset(p.days)}
                className="px-3 py-2 rounded-lg text-sm font-display font-medium border border-surface-200
                  bg-white text-navy-500 hover:border-navy-300 transition-colors">
                {p.label}
              </button>
            ))}
            {(from || to) && (
              <button type="button" onClick={() => { setFrom(''); setTo(''); }}
                className="btn-ghost text-sm" title="Quitar el filtro">
                <X size={14} /> Limpiar
              </button>
            )}
          </div>
        </div>

        {rangeInvalid ? (
          <p className="text-sm text-accent-red font-body mt-3">
            La fecha "Desde" es posterior a "Hasta" — no hay período que mostrar.
          </p>
        ) : !rangeActive && (
          <p className="text-xs text-navy-400 font-body mt-3">
            Elegí las dos fechas para ver el cuadro con la variación, los mínimos,
            los máximos y las brechas promedio del período.
          </p>
        )}
      </div>

      {loading ? (
        <PageLoading message="Consultando BCV y Binance..." />
      ) : (
        <>
          {/* ── Cálculo del período: solo cuando hay rango elegido ── */}
          {rangeActive && (
          <div className="card overflow-hidden">
            <div className="px-5 py-4 border-b border-surface-200">
              <h2 className="font-display font-bold text-navy-900">Resumen del período</h2>
              <p className="text-navy-400 text-xs font-body mt-0.5">
                {stats.days > 0
                  ? `${fmtDateKey(stats.firstDate)} → ${fmtDateKey(stats.lastDate)} · ${stats.days} día(s) con datos`
                  : 'Sin datos en el rango elegido'}
              </p>
            </div>

            {stats.days === 0 ? (
              <p className="px-5 py-8 text-center text-navy-400 text-sm font-body">
                No hay tasas guardadas en estas fechas.
              </p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-surface-50 text-navy-400 text-xs font-display uppercase tracking-wide">
                      <tr>
                        <th className="text-left px-5 py-2.5">Tasa</th>
                        <th className="text-right px-5 py-2.5">Inicio</th>
                        <th className="text-right px-5 py-2.5">Final</th>
                        <th className="text-right px-5 py-2.5">Variación</th>
                        <th className="text-right px-5 py-2.5">Mínimo</th>
                        <th className="text-right px-5 py-2.5">Máximo</th>
                        <th className="text-right px-5 py-2.5">Promedio</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-100">
                      <StatsRow label="BCV — Dólar" s={stats.bcv} />
                      <StatsRow label="BCV — Euro" s={stats.eur} />
                      <StatsRow label="Binance P2P" s={stats.binance} />
                    </tbody>
                  </table>
                </div>

                <div className="grid sm:grid-cols-2 gap-px bg-surface-200 border-t border-surface-200">
                  <div className="bg-card px-5 py-4">
                    <p className="text-xs text-navy-400 font-display uppercase tracking-wide">
                      Brecha promedio Binance / BCV
                    </p>
                    <p className="font-mono text-xl font-bold text-navy-900 mt-1">
                      {fmtPct(stats.avgGapBcv)}
                    </p>
                  </div>
                  <div className="bg-card px-5 py-4">
                    <p className="text-xs text-navy-400 font-display uppercase tracking-wide">
                      Brecha promedio Binance / Euro
                    </p>
                    <p className="font-mono text-xl font-bold text-navy-900 mt-1">
                      {fmtPct(stats.avgGapEur)}
                    </p>
                  </div>
                </div>
              </>
            )}
          </div>
          )}

          {/* ── Historial ── */}
          <div className="card overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-4 border-b border-surface-200">
              <div className="mr-auto">
                <h2 className="font-display font-bold text-navy-900">
                  Historial
                  <span className="ml-2 text-navy-400 font-normal text-sm">({history.length} días)</span>
                </h2>
                <p className="text-navy-400 text-xs font-body mt-0.5">
                  {rangeActive
                    ? `${fmtDateKey(from)} → ${fmtDateKey(to)}`
                    : `Últimos ${DEFAULT_DAYS} días`}
                </p>
              </div>
            </div>

            {history.length === 0 ? (
              <p className="px-5 py-8 text-center text-navy-400 text-sm font-body">
                {rangeActive
                  ? 'No hay tasas guardadas en estas fechas.'
                  : 'Todavía no hay tasas guardadas. Se guarda una fila por día a las 6 PM.'}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-surface-50 text-navy-400 text-xs font-display uppercase tracking-wide">
                    <tr>
                      <th className="text-left px-5 py-2.5">Fecha</th>
                      <th className="text-right px-5 py-2.5">BCV</th>
                      <th className="text-right px-5 py-2.5">EUR</th>
                      <th className="text-right px-5 py-2.5">Binance</th>
                      <th className="text-right px-5 py-2.5">Binance/BCV</th>
                      <th className="text-right px-5 py-2.5">Binance/EUR</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-100">
                    {history.map((row, i) => {
                      // history viene de la más nueva a la más vieja: la fila
                      // siguiente es el día anterior, contra el que se compara.
                      const prev = history[i + 1];
                      return (
                        <tr key={row.dateKey} className={i === 0 ? 'bg-emerald-50/40' : undefined}>
                          <td className="px-5 py-2.5 font-mono text-navy-700 whitespace-nowrap">
                            {fmtDateKey(row.dateKey)}
                            {row.capturedAt && (
                              <span className="block text-[11px] text-navy-300 font-body">
                                {formatDateTime(row.capturedAt)}
                              </span>
                            )}
                          </td>
                          <RateCell value={row.bcv} prev={prev?.bcv} />
                          <RateCell value={row.eur} prev={prev?.eur} />
                          <RateCell value={row.binance} prev={prev?.binance} />
                          <td className="px-5 py-2.5 text-right font-mono text-navy-700">
                            {fmtPct(gapPercent(row.bcv, row.binance))}
                          </td>
                          <td className="px-5 py-2.5 text-right font-mono text-navy-700">
                            {fmtPct(gapPercent(row.eur, row.binance))}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function RateCard({ label, value, icon, hint }: {
  label: string;
  value: number | null;
  icon: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="card p-5">
      <div className="flex items-center gap-2">
        {icon}
        <p className="text-sm font-display font-medium text-navy-500">{label}</p>
      </div>
      <p className="font-mono text-2xl font-bold text-navy-900 mt-2">
        {fmtBs(value)} <span className="text-sm font-body font-normal text-navy-400">Bs</span>
      </p>
      {hint && <p className="text-xs text-navy-400 font-body mt-1">{hint}</p>}
    </div>
  );
}

function GapCard({ label, pct, detail }: { label: string; pct: number | null; detail: string }) {
  return (
    <div className="card p-5">
      <p className="text-sm font-display font-medium text-navy-500">{label}</p>
      <p className={`font-mono text-2xl font-bold mt-2
        ${pct === null ? 'text-navy-400' : pct > 0 ? 'text-accent-red' : 'text-emerald-600'}`}>
        {fmtPct(pct)}
      </p>
      <p className="text-xs text-navy-400 font-body mt-1">{detail}</p>
    </div>
  );
}

/** Una tasa en la tabla de resumen: de cuánto a cuánto se movió en el período. */
function StatsRow({ label, s }: { label: string; s: SeriesStats }) {
  const up = s.change !== null && s.change > 0.005;
  const down = s.change !== null && s.change < -0.005;

  return (
    <tr>
      <td className="px-5 py-2.5 font-display font-medium text-navy-800 whitespace-nowrap">
        {label}
        {s.count > 0 && (
          <span className="block text-[11px] text-navy-300 font-body">{s.count} día(s)</span>
        )}
      </td>
      <td className="px-5 py-2.5 text-right font-mono text-navy-700">{fmtBs(s.first)}</td>
      <td className="px-5 py-2.5 text-right font-mono text-navy-800 font-semibold">{fmtBs(s.last)}</td>
      <td className="px-5 py-2.5 text-right whitespace-nowrap">
        <span className={`font-mono font-semibold
          ${up ? 'text-accent-red' : down ? 'text-emerald-600' : 'text-navy-400'}`}>
          {s.change === null ? '—' : `${up ? '+' : ''}${fmtBs(s.change)}`}
        </span>
        <span className={`block text-[11px] font-mono
          ${up ? 'text-accent-red' : down ? 'text-emerald-600' : 'text-navy-300'}`}>
          {fmtPct(s.changePct)}
        </span>
      </td>
      <td className="px-5 py-2.5 text-right font-mono text-navy-500">{fmtBs(s.min)}</td>
      <td className="px-5 py-2.5 text-right font-mono text-navy-500">{fmtBs(s.max)}</td>
      <td className="px-5 py-2.5 text-right font-mono text-navy-500">{fmtBs(s.avg)}</td>
    </tr>
  );
}

/** Celda de tasa con la variación respecto del día anterior. */
function RateCell({ value, prev }: { value: number | null; prev?: number | null }) {
  const delta = value !== null && prev !== null && prev !== undefined ? value - prev : null;
  const flat = delta !== null && Math.abs(delta) < 0.005;

  return (
    <td className="px-5 py-2.5 text-right whitespace-nowrap">
      <span className="font-mono text-navy-800">{fmtBs(value)}</span>
      {delta !== null && (
        <span className={`flex items-center justify-end gap-0.5 text-[11px] font-mono
          ${flat ? 'text-navy-300' : delta > 0 ? 'text-accent-red' : 'text-emerald-600'}`}>
          {flat ? <Minus size={10} /> : delta > 0 ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
          {flat ? 'igual' : fmtBs(Math.abs(delta))}
        </span>
      )}
    </td>
  );
}
