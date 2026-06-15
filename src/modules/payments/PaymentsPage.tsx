import { useState, useMemo, useCallback } from 'react';
import { consultarPagosPorFecha, type BanescoTransaction } from '@/services/banescoService';
import { useToast } from '@/components/Toast';
import { Landmark, Search, Loader2, ArrowDownLeft, ArrowUpRight, Calendar } from 'lucide-react';

/** Fecha 'YYYY-MM-DD' en hora local. */
function todayApi(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

const bs = new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function isCredit(t: BanescoTransaction): boolean {
  return t.trnType?.trim().toUpperCase() === 'CR';
}

export function PaymentsPage() {
  const toast = useToast();
  const [startDt, setStartDt] = useState(todayApi);
  const [endDt, setEndDt] = useState(todayApi);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<BanescoTransaction[] | null>(null);
  const [filter, setFilter] = useState('');

  const buscar = useCallback(async () => {
    if (!startDt || !endDt) {
      toast.warning('Seleccioná la fecha de inicio y fin.');
      return;
    }
    if (startDt > endDt) {
      toast.warning('La fecha de inicio no puede ser mayor que la de fin.');
      return;
    }
    setLoading(true);
    try {
      const data = await consultarPagosPorFecha({ startDt, endDt });
      setResults(data);
      if (data.length === 0) toast.info('No se encontraron movimientos en ese rango.');
    } catch (err: any) {
      toast.error(err?.message || 'No se pudieron consultar los pagos.');
      setResults(null);
    } finally {
      setLoading(false);
    }
  }, [startDt, endDt, toast]);

  const filtered = useMemo(() => {
    if (!results) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return results;
    return results.filter(
      (t) =>
        t.referenceNumber?.toLowerCase().includes(q) ||
        t.concept?.toLowerCase().includes(q),
    );
  }, [results, filter]);

  const summary = useMemo(() => {
    let totalCr = 0;
    let totalDb = 0;
    for (const t of filtered) {
      if (isCredit(t)) totalCr += t.amount;
      else totalDb += t.amount;
    }
    return { count: filtered.length, totalCr, totalDb };
  }, [filtered]);

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-6xl mx-auto">
      {/* Encabezado */}
      <div className="flex items-center gap-3">
        <div className="bg-blue-500 text-white p-2 rounded-xl shadow-sm">
          <Landmark size={22} />
        </div>
        <div>
          <h1 className="text-xl font-display font-bold text-navy-900">Pagos Banesco</h1>
          <p className="text-sm text-navy-500 font-display">Buscar movimientos de la cuenta por rango de fechas.</p>
        </div>
      </div>

      {/* Filtros de búsqueda */}
      <div className="bg-white rounded-xl border border-surface-200 p-4 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-end gap-3">
          <div className="flex-1">
            <label className="block text-xs font-display font-medium text-navy-500 mb-1">Desde</label>
            <div className="relative">
              <Calendar size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-navy-400" />
              <input type="date" value={startDt} onChange={(e) => setStartDt(e.target.value)}
                className="input-field text-sm py-2 pl-8 w-full" />
            </div>
          </div>
          <div className="flex-1">
            <label className="block text-xs font-display font-medium text-navy-500 mb-1">Hasta</label>
            <div className="relative">
              <Calendar size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-navy-400" />
              <input type="date" value={endDt} onChange={(e) => setEndDt(e.target.value)}
                className="input-field text-sm py-2 pl-8 w-full" />
            </div>
          </div>
          <button onClick={buscar} disabled={loading}
            className="btn-primary py-2 px-5 md:w-auto flex items-center justify-center gap-2">
            {loading ? (<><Loader2 size={16} className="animate-spin" /> Buscando...</>) : (<><Search size={16} /> Buscar</>)}
          </button>
        </div>
      </div>

      {/* Resumen */}
      {results && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="bg-white rounded-xl border border-surface-200 p-4 shadow-sm">
            <p className="text-xs font-display text-navy-500">Movimientos</p>
            <p className="text-2xl font-display font-bold text-navy-900">{summary.count}</p>
          </div>
          <div className="bg-emerald-50 rounded-xl border border-emerald-200 p-4 shadow-sm">
            <p className="text-xs font-display text-emerald-700 flex items-center gap-1"><ArrowDownLeft size={13} /> Recibido (CR)</p>
            <p className="text-2xl font-display font-bold text-emerald-700 font-mono">Bs {bs.format(summary.totalCr)}</p>
          </div>
          <div className="bg-red-50 rounded-xl border border-red-200 p-4 shadow-sm">
            <p className="text-xs font-display text-accent-red flex items-center gap-1"><ArrowUpRight size={13} /> Debitado (DB)</p>
            <p className="text-2xl font-display font-bold text-accent-red font-mono">Bs {bs.format(summary.totalDb)}</p>
          </div>
        </div>
      )}

      {/* Filtro por texto + tabla */}
      {results && (
        <div className="bg-white rounded-xl border border-surface-200 shadow-sm overflow-hidden">
          <div className="p-3 border-b border-surface-200">
            <div className="relative max-w-xs">
              <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-navy-400" />
              <input type="text" value={filter} onChange={(e) => setFilter(e.target.value)}
                placeholder="Filtrar por referencia o concepto" className="input-field text-sm py-1.5 pl-8 w-full" />
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="p-8 text-center text-navy-400 font-display text-sm">Sin movimientos para mostrar.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-surface-50 text-navy-500 font-display text-xs uppercase tracking-wide">
                    <th className="text-left px-4 py-2.5 font-medium">Fecha</th>
                    <th className="text-left px-4 py-2.5 font-medium">Hora</th>
                    <th className="text-left px-4 py-2.5 font-medium">Referencia</th>
                    <th className="text-left px-4 py-2.5 font-medium">Concepto</th>
                    <th className="text-center px-4 py-2.5 font-medium">Tipo</th>
                    <th className="text-right px-4 py-2.5 font-medium">Monto (Bs)</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((t, i) => {
                    const cr = isCredit(t);
                    return (
                      <tr key={`${t.referenceNumber}-${i}`} className="border-t border-surface-100 hover:bg-surface-50/60 transition-colors">
                        <td className="px-4 py-2.5 font-mono text-navy-700">{t.trnDate}</td>
                        <td className="px-4 py-2.5 font-mono text-navy-500">{t.trnTime?.trim()}</td>
                        <td className="px-4 py-2.5 font-mono text-navy-800">{t.referenceNumber?.trim()}</td>
                        <td className="px-4 py-2.5 text-navy-600">{t.concept?.trim()}</td>
                        <td className="px-4 py-2.5 text-center">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-display font-medium ${cr ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-accent-red'}`}>
                            {cr ? <ArrowDownLeft size={12} /> : <ArrowUpRight size={12} />}{cr ? 'CR' : 'DB'}
                          </span>
                        </td>
                        <td className={`px-4 py-2.5 text-right font-mono font-medium ${cr ? 'text-emerald-700' : 'text-accent-red'}`}>
                          {bs.format(t.amount)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Estado inicial */}
      {!results && !loading && (
        <div className="bg-white rounded-xl border border-dashed border-surface-300 p-10 text-center">
          <Landmark size={32} className="mx-auto text-navy-300 mb-2" />
          <p className="text-navy-500 font-display text-sm">Elegí un rango de fechas y tocá <strong>Buscar</strong> para ver los pagos.</p>
        </div>
      )}
    </div>
  );
}
