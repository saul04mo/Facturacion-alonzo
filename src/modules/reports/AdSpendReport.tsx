import { useState, useEffect, useMemo, useRef } from 'react';
import { useAppStore } from '@/store/appStore';
import { useCurrency } from '@/hooks/useCurrency';
import { useToast } from '@/components/Toast';
import { fetchInvoicesByDateRange } from '@/modules/invoices/invoiceService';
import {
  getMonthAdSpend, setDayAdSpend, computeDailySalesByGender,
  daysOfMonth, describeDate,
  type DayAdSpend, type DaySales,
} from './adSpendService';
import {
  ChevronLeft, ChevronRight, Loader2, Check, AlertCircle, Megaphone,
} from 'lucide-react';

const MONTH_NAMES_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export function AdSpendReport() {
  const products = useAppStore((s) => s.products);
  const currentUser = useAppStore((s) => s.currentUser);
  const { format } = useCurrency();
  const toast = useToast();

  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1); // 1-12

  const [spendMap, setSpendMap] = useState<Map<string, DayAdSpend>>(new Map());
  const [salesMap, setSalesMap] = useState<Map<string, DaySales>>(new Map());
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const saveTimerRef = useRef<number | null>(null);

  // ── Cargar datos del mes ─────────────────────
  async function loadMonth(y: number, m: number) {
    setLoading(true);
    try {
      const mm = String(m).padStart(2, '0');
      const lastDay = new Date(y, m, 0).getDate();
      const startDate = `${y}-${mm}-01`;
      const endDate = `${y}-${mm}-${String(lastDay).padStart(2, '0')}`;
      const [spend, invoices] = await Promise.all([
        getMonthAdSpend(y, m),
        fetchInvoicesByDateRange(startDate, endDate),
      ]);
      setSpendMap(spend);
      setSalesMap(computeDailySalesByGender(invoices, products));
      // Inicializar drafts desde lo que vino de Firestore. Hacemos esto
      // dentro de loadMonth (no en un useEffect dependiente de spendMap)
      // para evitar sobreescribir drafts cuando un save agrega un día
      // nuevo al spendMap durante la edición de otra fila.
      const m2 = new Map<string, { men: string; women: string }>();
      spend.forEach((v, k) => {
        m2.set(k, {
          men: v.spendMen ? String(v.spendMen) : '',
          women: v.spendWomen ? String(v.spendWomen) : '',
        });
      });
      setDrafts(m2);
    } catch (e: any) {
      toast.error(e?.message || 'Error al cargar el reporte de publicidad.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMonth(year, month);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month, products.length]);

  // ── Drafts (estado local de los inputs) ──────
  // El usuario puede tipear en cualquier celda; el draft es lo que se ve.
  // Al onBlur del input, guardamos a Firestore.
  const [drafts, setDrafts] = useState<Map<string, { men: string; women: string }>>(new Map());

  function getDraft(ymd: string): { men: string; women: string } {
    return drafts.get(ymd) || { men: '', women: '' };
  }

  function updateDraft(ymd: string, field: 'men' | 'women', value: string) {
    setDrafts((prev) => {
      const next = new Map(prev);
      const current = next.get(ymd) || { men: '', women: '' };
      next.set(ymd, { ...current, [field]: value });
      return next;
    });
  }

  async function saveDay(ymd: string) {
    const d = getDraft(ymd);
    const men = parseFloat(d.men) || 0;
    const women = parseFloat(d.women) || 0;

    const existing = spendMap.get(ymd);
    // No hacer nada si no cambió
    if (existing && existing.spendMen === men && existing.spendWomen === women) return;
    // No crear doc vacío de la nada
    if (!existing && men === 0 && women === 0) return;

    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    setSaveState('saving');
    try {
      await setDayAdSpend(ymd, men, women, currentUser);
      setSpendMap((prev) => {
        const next = new Map(prev);
        next.set(ymd, { date: ymd, spendMen: men, spendWomen: women });
        return next;
      });
      setSaveState('saved');
      saveTimerRef.current = window.setTimeout(() => setSaveState('idle'), 1800);
    } catch (e: any) {
      setSaveState('error');
      toast.error(e?.message || 'Error al guardar el gasto del día.');
    }
  }

  // ── Navegación de mes ────────────────────────
  function prevMonth() {
    if (month === 1) { setYear((y) => y - 1); setMonth(12); }
    else setMonth(month - 1);
  }
  function nextMonth() {
    if (month === 12) { setYear((y) => y + 1); setMonth(1); }
    else setMonth(month + 1);
  }

  // ── Filas del mes ────────────────────────────
  const days = useMemo(() => daysOfMonth(year, month), [year, month]);

  const rows = useMemo(() => {
    return days.map((ymd) => {
      const sales = salesMap.get(ymd) || { salesMen: 0, salesWomen: 0, salesTotal: 0 };
      const draft = drafts.get(ymd) || { men: '', women: '' };
      const spendMen = parseFloat(draft.men) || 0;
      const spendWomen = parseFloat(draft.women) || 0;

      const netMen = sales.salesMen - spendMen;
      const netWomen = sales.salesWomen - spendWomen;
      const pctMen = sales.salesMen > 0 ? (spendMen / sales.salesMen) * 100 : null;
      const pctWomen = sales.salesWomen > 0 ? (spendWomen / sales.salesWomen) * 100 : null;

      // ⚠️ Antes: salesTotal = salesMen + salesWomen → ignoraba productos
      // sin género asignado en el catálogo, así que días con ventas reales
      // aparecían vacíos en la columna JUNTOS.
      // Ahora: usamos sales.salesTotal del service que incluye TODAS las
      // ventas del día (Hombre + Mujer + sin clasificar). Si tenés
      // productos sin gender en Firestore, Hombre + Mujer puede ser MENOR
      // que JUNTOS — la diferencia son items sin clasificar.
      const salesTotal = sales.salesTotal;
      const spendTotal = spendMen + spendWomen;
      const netTotal = salesTotal - spendTotal;
      const pctTotal = salesTotal > 0 ? (spendTotal / salesTotal) * 100 : null;

      return {
        ymd,
        ...describeDate(ymd),
        salesMen: sales.salesMen, spendMen, netMen, pctMen,
        salesWomen: sales.salesWomen, spendWomen, netWomen, pctWomen,
        salesTotal, spendTotal, netTotal, pctTotal,
      };
    });
  }, [days, salesMap, drafts]);

  // ── Totales del mes ──────────────────────────
  const totals = useMemo(() => {
    const t = {
      salesMen: 0, spendMen: 0, netMen: 0,
      salesWomen: 0, spendWomen: 0, netWomen: 0,
      salesTotal: 0, spendTotal: 0, netTotal: 0,
    };
    for (const r of rows) {
      t.salesMen += r.salesMen; t.spendMen += r.spendMen; t.netMen += r.netMen;
      t.salesWomen += r.salesWomen; t.spendWomen += r.spendWomen; t.netWomen += r.netWomen;
      t.salesTotal += r.salesTotal; t.spendTotal += r.spendTotal; t.netTotal += r.netTotal;
    }
    return {
      ...t,
      pctMen: t.salesMen > 0 ? (t.spendMen / t.salesMen) * 100 : null,
      pctWomen: t.salesWomen > 0 ? (t.spendWomen / t.salesWomen) * 100 : null,
      pctTotal: t.salesTotal > 0 ? (t.spendTotal / t.salesTotal) * 100 : null,
    };
  }, [rows]);

  // ── Render ───────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Header con navegación de mes y status */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Megaphone size={20} className="text-blue-500" />
          <h2 className="text-lg font-display font-bold text-navy-900 dark:text-gray-100">
            Gasto de Publicidad
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} className="btn-ghost p-1.5" title="Mes anterior" type="button">
            <ChevronLeft size={16} />
          </button>
          <div className="font-display font-semibold text-navy-800 dark:text-gray-200 w-36 text-center">
            {MONTH_NAMES_ES[month - 1]} {year}
          </div>
          <button onClick={nextMonth} className="btn-ghost p-1.5" title="Mes siguiente" type="button">
            <ChevronRight size={16} />
          </button>
          {/* Save status */}
          <div className="ml-3 flex items-center gap-1.5 text-xs min-w-[110px]">
            {saveState === 'saving' && (
              <><Loader2 size={13} className="animate-spin text-blue-500" /><span className="text-navy-500 dark:text-gray-400">Guardando…</span></>
            )}
            {saveState === 'saved' && (
              <><Check size={13} className="text-emerald-500" /><span className="text-emerald-600 dark:text-emerald-400">Guardado</span></>
            )}
            {saveState === 'error' && (
              <><AlertCircle size={13} className="text-red-500" /><span className="text-red-600 dark:text-red-400">Error</span></>
            )}
          </div>
        </div>
      </div>

      {/* Tabla */}
      <div className="border border-surface-200 dark:border-dark-300 rounded-xl overflow-hidden bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              {/* Grupo Hombre / Mujer / Juntos */}
              <tr className="bg-surface-50 dark:bg-dark-200/40 border-b border-surface-200 dark:border-dark-300">
                <th colSpan={2} className="px-2 py-1.5 text-left text-[10px] font-display font-semibold text-navy-500 dark:text-gray-400 uppercase">Día</th>
                <th colSpan={4} className="px-2 py-1.5 text-center text-[11px] font-display font-bold text-blue-700 dark:text-blue-300 uppercase tracking-wide border-l-2 border-surface-300 dark:border-dark-400 bg-blue-50/50 dark:bg-blue-500/10">👔 Hombre</th>
                <th colSpan={4} className="px-2 py-1.5 text-center text-[11px] font-display font-bold text-rose-700 dark:text-rose-300 uppercase tracking-wide border-l-2 border-surface-300 dark:border-dark-400 bg-rose-50/50 dark:bg-rose-500/10">👗 Mujer</th>
                <th colSpan={4} className="px-2 py-1.5 text-center text-[11px] font-display font-bold text-emerald-700 dark:text-emerald-300 uppercase tracking-wide border-l-2 border-surface-300 dark:border-dark-400 bg-emerald-50/50 dark:bg-emerald-500/10">∑ Juntos</th>
              </tr>
              <tr className="bg-surface-50 dark:bg-dark-200/40 border-b border-surface-200 dark:border-dark-300 text-[10px] font-display font-semibold text-navy-500 dark:text-gray-400 uppercase">
                <th className="px-2 py-1.5 text-left">Día</th>
                <th className="px-2 py-1.5 text-left">Fecha</th>
                <th className="px-2 py-1.5 text-right border-l-2 border-surface-300 dark:border-dark-400 bg-blue-50/40 dark:bg-blue-500/[0.06]">Ventas</th>
                <th className="px-2 py-1.5 text-right bg-blue-50/40 dark:bg-blue-500/[0.06]">Pub.</th>
                <th className="px-2 py-1.5 text-right bg-blue-50/40 dark:bg-blue-500/[0.06]">Neto</th>
                <th className="px-2 py-1.5 text-right bg-blue-50/40 dark:bg-blue-500/[0.06]">%</th>
                <th className="px-2 py-1.5 text-right border-l-2 border-surface-300 dark:border-dark-400 bg-rose-50/40 dark:bg-rose-500/[0.06]">Ventas</th>
                <th className="px-2 py-1.5 text-right bg-rose-50/40 dark:bg-rose-500/[0.06]">Pub.</th>
                <th className="px-2 py-1.5 text-right bg-rose-50/40 dark:bg-rose-500/[0.06]">Neto</th>
                <th className="px-2 py-1.5 text-right bg-rose-50/40 dark:bg-rose-500/[0.06]">%</th>
                <th className="px-2 py-1.5 text-right border-l-2 border-surface-300 dark:border-dark-400 bg-emerald-50/40 dark:bg-emerald-500/[0.06]">Ventas</th>
                <th className="px-2 py-1.5 text-right bg-emerald-50/40 dark:bg-emerald-500/[0.06]">Pub.</th>
                <th className="px-2 py-1.5 text-right bg-emerald-50/40 dark:bg-emerald-500/[0.06]">Neto</th>
                <th className="px-2 py-1.5 text-right bg-emerald-50/40 dark:bg-emerald-500/[0.06]">%</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={14} className="text-center py-8">
                    <Loader2 size={20} className="animate-spin mx-auto text-blue-500" />
                    <p className="text-xs text-navy-400 mt-1">Cargando datos del mes…</p>
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const isToday = r.ymd === `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
                  const draft = getDraft(r.ymd);
                  return (
                    <tr key={r.ymd} className={`border-b border-surface-100 dark:border-dark-300/40 ${isToday ? 'bg-amber-50/40 dark:bg-amber-900/10' : 'hover:bg-surface-50/60 dark:hover:bg-dark-200/30'}`}>
                      <td className="px-2 py-1 text-navy-700 dark:text-gray-300 font-display">{r.weekday}</td>
                      <td className="px-2 py-1 font-mono text-navy-500 dark:text-gray-400">{r.short}</td>

                      {/* Hombre */}
                      <td className="px-2 py-1 text-right font-mono text-navy-800 dark:text-gray-200 border-l-2 border-surface-300 dark:border-dark-400 bg-blue-50/40 dark:bg-blue-500/[0.06]">{r.salesMen > 0 ? format(r.salesMen) : '—'}</td>
                      <td className="px-1 py-0.5 bg-blue-50/40 dark:bg-blue-500/[0.06]">
                        <input
                          type="number" min="0" step="0.01"
                          value={draft.men}
                          onChange={(e) => updateDraft(r.ymd, 'men', e.target.value)}
                          onBlur={() => saveDay(r.ymd)}
                          placeholder="0"
                          className="w-20 text-right text-xs font-mono px-1.5 py-0.5 rounded border border-surface-200 dark:border-dark-400 bg-white dark:bg-dark-300 text-navy-800 dark:text-gray-100 focus:border-blue-400 focus:outline-none"
                        />
                      </td>
                      <td className={`px-2 py-1 text-right font-mono bg-blue-50/40 dark:bg-blue-500/[0.06] ${r.netMen < 0 ? 'text-accent-red' : 'text-navy-800 dark:text-gray-200'}`}>{(r.spendMen > 0 || r.salesMen > 0) ? format(r.netMen) : '—'}</td>
                      <td className={`px-2 py-1 text-right font-mono bg-blue-50/40 dark:bg-blue-500/[0.06] ${r.pctMen !== null && r.pctMen > 50 ? 'text-accent-red font-bold' : 'text-navy-600 dark:text-gray-400'}`}>{r.pctMen !== null ? `${r.pctMen.toFixed(2)}%` : '—'}</td>

                      {/* Mujer */}
                      <td className="px-2 py-1 text-right font-mono text-navy-800 dark:text-gray-200 border-l-2 border-surface-300 dark:border-dark-400 bg-rose-50/40 dark:bg-rose-500/[0.06]">{r.salesWomen > 0 ? format(r.salesWomen) : '—'}</td>
                      <td className="px-1 py-0.5 bg-rose-50/40 dark:bg-rose-500/[0.06]">
                        <input
                          type="number" min="0" step="0.01"
                          value={draft.women}
                          onChange={(e) => updateDraft(r.ymd, 'women', e.target.value)}
                          onBlur={() => saveDay(r.ymd)}
                          placeholder="0"
                          className="w-20 text-right text-xs font-mono px-1.5 py-0.5 rounded border border-surface-200 dark:border-dark-400 bg-white dark:bg-dark-300 text-navy-800 dark:text-gray-100 focus:border-rose-400 focus:outline-none"
                        />
                      </td>
                      <td className={`px-2 py-1 text-right font-mono bg-rose-50/40 dark:bg-rose-500/[0.06] ${r.netWomen < 0 ? 'text-accent-red' : 'text-navy-800 dark:text-gray-200'}`}>{(r.spendWomen > 0 || r.salesWomen > 0) ? format(r.netWomen) : '—'}</td>
                      <td className={`px-2 py-1 text-right font-mono bg-rose-50/40 dark:bg-rose-500/[0.06] ${r.pctWomen !== null && r.pctWomen > 50 ? 'text-accent-red font-bold' : 'text-navy-600 dark:text-gray-400'}`}>{r.pctWomen !== null ? `${r.pctWomen.toFixed(2)}%` : '—'}</td>

                      {/* Juntos (calculados) */}
                      <td className="px-2 py-1 text-right font-mono font-bold text-emerald-700 dark:text-emerald-300 border-l-2 border-surface-300 dark:border-dark-400 bg-emerald-50/40 dark:bg-emerald-500/[0.06]">{r.salesTotal > 0 ? format(r.salesTotal) : '—'}</td>
                      <td className="px-2 py-1 text-right font-mono font-semibold text-navy-700 dark:text-gray-300 bg-emerald-50/40 dark:bg-emerald-500/[0.06]">{r.spendTotal > 0 ? format(r.spendTotal) : '—'}</td>
                      <td className={`px-2 py-1 text-right font-mono font-bold bg-emerald-50/40 dark:bg-emerald-500/[0.06] ${r.netTotal < 0 ? 'text-accent-red' : 'text-emerald-700 dark:text-emerald-300'}`}>{(r.spendTotal > 0 || r.salesTotal > 0) ? format(r.netTotal) : '—'}</td>
                      <td className={`px-2 py-1 text-right font-mono font-bold bg-emerald-50/40 dark:bg-emerald-500/[0.06] ${r.pctTotal !== null && r.pctTotal > 50 ? 'text-accent-red' : 'text-navy-700 dark:text-gray-300'}`}>{r.pctTotal !== null ? `${r.pctTotal.toFixed(2)}%` : '—'}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {/* Totales del mes */}
            {!loading && (
              <tfoot>
                <tr className="bg-navy-50 dark:bg-dark-200/60 border-t-2 border-navy-300 dark:border-dark-400 text-xs font-display font-bold">
                  <td className="px-2 py-2 text-navy-900 dark:text-gray-100 uppercase tracking-wide" colSpan={2}>Total del mes</td>
                  <td className="px-2 py-2 text-right font-mono text-blue-700 dark:text-blue-300 border-l-2 border-surface-300 dark:border-dark-400 bg-blue-50/60 dark:bg-blue-500/[0.12]">{format(totals.salesMen)}</td>
                  <td className="px-2 py-2 text-right font-mono text-blue-700 dark:text-blue-300 bg-blue-50/60 dark:bg-blue-500/[0.12]">{format(totals.spendMen)}</td>
                  <td className={`px-2 py-2 text-right font-mono bg-blue-50/60 dark:bg-blue-500/[0.12] ${totals.netMen < 0 ? 'text-accent-red' : 'text-blue-700 dark:text-blue-300'}`}>{format(totals.netMen)}</td>
                  <td className="px-2 py-2 text-right font-mono text-blue-700 dark:text-blue-300 bg-blue-50/60 dark:bg-blue-500/[0.12]">{totals.pctMen !== null ? `${totals.pctMen.toFixed(2)}%` : '—'}</td>
                  <td className="px-2 py-2 text-right font-mono text-rose-700 dark:text-rose-300 border-l-2 border-surface-300 dark:border-dark-400 bg-rose-50/60 dark:bg-rose-500/[0.12]">{format(totals.salesWomen)}</td>
                  <td className="px-2 py-2 text-right font-mono text-rose-700 dark:text-rose-300 bg-rose-50/60 dark:bg-rose-500/[0.12]">{format(totals.spendWomen)}</td>
                  <td className={`px-2 py-2 text-right font-mono bg-rose-50/60 dark:bg-rose-500/[0.12] ${totals.netWomen < 0 ? 'text-accent-red' : 'text-rose-700 dark:text-rose-300'}`}>{format(totals.netWomen)}</td>
                  <td className="px-2 py-2 text-right font-mono text-rose-700 dark:text-rose-300 bg-rose-50/60 dark:bg-rose-500/[0.12]">{totals.pctWomen !== null ? `${totals.pctWomen.toFixed(2)}%` : '—'}</td>
                  <td className="px-2 py-2 text-right font-mono text-emerald-700 dark:text-emerald-300 border-l-2 border-surface-300 dark:border-dark-400 bg-emerald-50/60 dark:bg-emerald-500/[0.12]">{format(totals.salesTotal)}</td>
                  <td className="px-2 py-2 text-right font-mono text-emerald-700 dark:text-emerald-300 bg-emerald-50/60 dark:bg-emerald-500/[0.12]">{format(totals.spendTotal)}</td>
                  <td className={`px-2 py-2 text-right font-mono bg-emerald-50/60 dark:bg-emerald-500/[0.12] ${totals.netTotal < 0 ? 'text-accent-red' : 'text-emerald-700 dark:text-emerald-300'}`}>{format(totals.netTotal)}</td>
                  <td className="px-2 py-2 text-right font-mono text-emerald-700 dark:text-emerald-300 bg-emerald-50/60 dark:bg-emerald-500/[0.12]">{totals.pctTotal !== null ? `${totals.pctTotal.toFixed(2)}%` : '—'}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      <p className="text-[11px] text-navy-400 dark:text-gray-500 italic">
        Las ventas (Hombre / Mujer) se calculan automáticamente desde las facturas finalizadas del mes,
        agrupadas por el género del producto. Los gastos de publicidad se ingresan a mano por día — al
        cambiar de celda se guardan automáticamente.
      </p>
    </div>
  );
}
