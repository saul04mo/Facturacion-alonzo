import { useState, useMemo, useCallback, useEffect } from 'react';
import {
  consultarPagosPorFecha,
  buscarPagoMovil,
  getBancos,
  refMatches,
  toBanescoError,
  type BanescoTransaction,
  type Banco,
} from '@/services/banescoService';
import { BanescoErrorNotice } from '@/components/BanescoErrorNotice';
import { useToast } from '@/components/Toast';
import { Landmark, Search, Loader2, ArrowDownLeft, ArrowUpRight, Calendar, Smartphone, CheckCircle2, XCircle } from 'lucide-react';

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

/** 'YYYY-MM-DD' + 'HH:MM:SS' ordenan bien como texto: clave para ordenar por fecha/hora. */
function trnKey(t: BanescoTransaction): string {
  return `${(t.trnDate ?? '').trim()} ${(t.trnTime ?? '').trim()}`;
}

type Tab = 'fecha' | 'movil';

export function PaymentsPage() {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('fecha');

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-6xl mx-auto">
      {/* Encabezado */}
      <div className="flex items-center gap-3">
        <div className="bg-blue-500 text-white p-2 rounded-xl shadow-sm">
          <Landmark size={22} />
        </div>
        <div>
          <h1 className="text-xl font-display font-bold text-navy-900">Pagos Banesco</h1>
          <p className="text-sm text-navy-500 font-display">Consultá movimientos de la cuenta o verificá un pago móvil.</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-surface-200">
        <button onClick={() => setTab('fecha')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-display font-medium border-b-2 -mb-px transition-colors ${tab === 'fecha' ? 'border-blue-500 text-navy-900' : 'border-transparent text-navy-400 hover:text-navy-700'}`}>
          <Calendar size={16} /> Por fecha
        </button>
        <button onClick={() => setTab('movil')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-display font-medium border-b-2 -mb-px transition-colors ${tab === 'movil' ? 'border-blue-500 text-navy-900' : 'border-transparent text-navy-400 hover:text-navy-700'}`}>
          <Smartphone size={16} /> Por referencia / móvil
        </button>
      </div>

      {tab === 'fecha' ? <BuscarPorFecha toast={toast} /> : <BuscarPagoMovil toast={toast} />}
    </div>
  );
}

// ================================
// Tab 1: búsqueda por rango de fechas
// ================================
function BuscarPorFecha({ toast }: { toast: ReturnType<typeof useToast> }) {
  const [startDt, setStartDt] = useState(todayApi);
  const [endDt, setEndDt] = useState(todayApi);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<BanescoTransaction[] | null>(null);
  const [filter, setFilter] = useState('');
  // La falla va inline (no en un toast): el toast se va solo y el cajero
  // se queda mirando una tabla vacía sin saber si el rango no tuvo
  // movimientos o si la consulta nunca llegó a hacerse.
  const [error, setError] = useState<unknown>(null);

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
    setError(null);
    try {
      const data = await consultarPagosPorFecha({ startDt, endDt });
      setResults(data);
      if (data.length === 0) toast.info('No se encontraron movimientos en ese rango.');
    } catch (err) {
      setError(err);
      setResults(null);
    } finally {
      setLoading(false);
    }
  }, [startDt, endDt, toast]);

  const filtered = useMemo(() => {
    if (!results) return [];
    const q = filter.trim().toLowerCase();
    const base = q
      ? results.filter(
          (t) => t.referenceNumber?.toLowerCase().includes(q) || t.concept?.toLowerCase().includes(q),
        )
      : results;
    // El banco devuelve los movimientos del mas viejo al mas nuevo; el cajero
    // necesita ver primero el ultimo que entro.
    return [...base].sort((a, b) => trnKey(b).localeCompare(trnKey(a)));
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
    <div className="space-y-5">
      <div className="bg-white rounded-xl border border-surface-200 p-4 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-end gap-3">
          <div className="flex-1">
            <label className="block text-xs font-display font-medium text-navy-500 mb-1">Desde</label>
            <div className="relative">
              <Calendar size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-navy-400" />
              <input type="date" value={startDt} onChange={(e) => setStartDt(e.target.value)} className="input-field text-sm py-2 pl-8 w-full" />
            </div>
          </div>
          <div className="flex-1">
            <label className="block text-xs font-display font-medium text-navy-500 mb-1">Hasta</label>
            <div className="relative">
              <Calendar size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-navy-400" />
              <input type="date" value={endDt} onChange={(e) => setEndDt(e.target.value)} className="input-field text-sm py-2 pl-8 w-full" />
            </div>
          </div>
          <button onClick={buscar} disabled={loading} className="btn-primary py-2 px-5 md:w-auto flex items-center justify-center gap-2">
            {loading ? (<><Loader2 size={16} className="animate-spin" /> Buscando...</>) : (<><Search size={16} /> Buscar</>)}
          </button>
        </div>
      </div>

      {error != null && <BanescoErrorNotice error={error} onRetry={buscar} />}

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

      {results && (
        <div className="bg-white rounded-xl border border-surface-200 shadow-sm overflow-hidden">
          <div className="p-3 border-b border-surface-200">
            <div className="relative max-w-xs">
              <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-navy-400" />
              <input type="text" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filtrar por referencia o concepto" className="input-field text-sm py-1.5 pl-8 w-full" />
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
                        <td className={`px-4 py-2.5 text-right font-mono font-medium ${cr ? 'text-emerald-700' : 'text-accent-red'}`}>{bs.format(t.amount)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {!results && !loading && (
        <div className="bg-white rounded-xl border border-dashed border-surface-300 p-10 text-center">
          <Landmark size={32} className="mx-auto text-navy-300 mb-2" />
          <p className="text-navy-500 font-display text-sm">Elegí un rango de fechas y tocá <strong>Buscar</strong> para ver los pagos.</p>
        </div>
      )}
    </div>
  );
}

// ================================
// Tab 2: búsqueda de pago móvil por referencia + teléfono + banco + monto
// ================================
type MovilResult = { match: BanescoTransaction | null; amountOk: boolean | null };

function BuscarPagoMovil({ toast }: { toast: ReturnType<typeof useToast> }) {
  const [referenceNumber, setReferenceNumber] = useState('');
  const [phoneNum, setPhoneNum] = useState('');
  const [bankId, setBankId] = useState('0134'); // Banesco por defecto
  const [startDt, setStartDt] = useState(todayApi);
  const [monto, setMonto] = useState('');
  const [bancos, setBancos] = useState<Banco[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<MovilResult | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    getBancos().then(setBancos).catch((err) => {
      // No bloquea la búsqueda: el select cae al default de Banesco.
      toast.error(`No se pudo cargar el catálogo de bancos. ${toBanescoError(err).message}`);
    });
  }, [toast]);

  const canSearch = referenceNumber.trim() && phoneNum.trim() && bankId && monto.trim() && startDt;

  const buscar = useCallback(async () => {
    if (!canSearch) {
      toast.warning('Completá referencia, teléfono, banco, monto y fecha.');
      return;
    }
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const txs = await buscarPagoMovil({ referenceNumber: referenceNumber.trim(), phoneNum, bankId, startDt });
      // Buscamos la transacción cuya referencia coincida; si no, tomamos la primera.
      const match = txs.find((t) => refMatches(referenceNumber, t.referenceNumber)) ?? txs[0] ?? null;
      const expected = parseFloat(monto) || 0;
      const amountOk = match ? Math.abs(match.amount - expected) <= 0.01 : null;
      setResult({ match, amountOk });
      if (!match) toast.info('Banesco no devolvió una transacción para esos datos.');
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [canSearch, referenceNumber, phoneNum, bankId, startDt, monto, toast]);

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-xl border border-surface-200 p-4 shadow-sm">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-display font-medium text-navy-500 mb-1">Referencia</label>
            <input type="text" value={referenceNumber} onChange={(e) => { setReferenceNumber(e.target.value); setResult(null); }} placeholder="Ej. 050206" className="input-field text-sm py-2 w-full font-mono" />
          </div>
          <div>
            <label className="block text-xs font-display font-medium text-navy-500 mb-1">Teléfono del pagador</label>
            <input type="tel" value={phoneNum} onChange={(e) => { setPhoneNum(e.target.value); setResult(null); }} placeholder="Ej. 04143775031" className="input-field text-sm py-2 w-full font-mono" />
          </div>
          <div>
            <label className="block text-xs font-display font-medium text-navy-500 mb-1">Banco emisor</label>
            <select value={bankId} onChange={(e) => { setBankId(e.target.value); setResult(null); }} className="input-field text-sm py-2 w-full">
              {bancos.length === 0 && <option value="0134">Banesco</option>}
              {bancos.map((b) => (
                <option key={b.code} value={b.code}>{b.code} — {b.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-display font-medium text-navy-500 mb-1">Monto (Bs) a verificar</label>
            <input type="number" step="0.01" value={monto} onChange={(e) => { setMonto(e.target.value); setResult(null); }} placeholder="Ej. 222.00" className="input-field text-sm py-2 w-full font-mono" />
          </div>
          <div>
            <label className="block text-xs font-display font-medium text-navy-500 mb-1">Fecha</label>
            <div className="relative">
              <Calendar size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-navy-400" />
              <input type="date" value={startDt} onChange={(e) => { setStartDt(e.target.value); setResult(null); }} className="input-field text-sm py-2 pl-8 w-full" />
            </div>
          </div>
          <div className="flex items-end">
            <button onClick={buscar} disabled={loading || !canSearch} className="btn-primary py-2 px-5 w-full flex items-center justify-center gap-2">
              {loading ? (<><Loader2 size={16} className="animate-spin" /> Buscando...</>) : (<><Search size={16} /> Buscar y verificar</>)}
            </button>
          </div>
        </div>
      </div>

      {error != null && <BanescoErrorNotice error={error} onRetry={buscar} />}

      {/* Resultado */}
      {result && result.match && (
        <div className="bg-white rounded-xl border border-surface-200 shadow-sm overflow-hidden">
          {/* Banner de verificación de monto */}
          <div className={`flex items-center gap-2 px-4 py-3 text-sm font-display font-medium ${result.amountOk ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-accent-red'}`}>
            {result.amountOk ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
            {result.amountOk
              ? `Pago encontrado y el monto coincide (Bs ${bs.format(result.match.amount)}).`
              : `Pago encontrado, pero el monto NO coincide. Banesco: Bs ${bs.format(result.match.amount)} · ingresado: Bs ${bs.format(parseFloat(monto) || 0)}.`}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-px bg-surface-100 text-sm">
            <Field label="Referencia" value={result.match.referenceNumber?.trim()} mono />
            <Field label="Monto" value={`Bs ${bs.format(result.match.amount)}`} mono />
            <Field label="Tipo" value={isCredit(result.match) ? 'Crédito (CR)' : 'Débito (DB)'} />
            <Field label="Fecha" value={result.match.trnDate} mono />
            <Field label="Hora" value={result.match.trnTime?.trim()} mono />
            <Field label="Banco origen" value={result.match.sourceBankId?.trim()} mono />
            <Field label="Concepto" value={result.match.concept?.trim()} />
            <Field label="Cuenta" value={result.match.accountId?.trim()} mono />
          </div>
        </div>
      )}

      {result && !result.match && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center text-accent-red font-display text-sm flex items-center justify-center gap-2">
          <XCircle size={18} /> No se encontró el pago móvil con esos datos.
        </div>
      )}

      {!result && !loading && (
        <div className="bg-white rounded-xl border border-dashed border-surface-300 p-10 text-center">
          <Smartphone size={32} className="mx-auto text-navy-300 mb-2" />
          <p className="text-navy-500 font-display text-sm">Ingresá la referencia, teléfono, banco y monto para verificar el pago móvil.</p>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value?: string; mono?: boolean }) {
  return (
    <div className="bg-white px-4 py-3">
      <p className="text-[11px] font-display text-navy-400 uppercase tracking-wide">{label}</p>
      <p className={`text-navy-800 ${mono ? 'font-mono' : 'font-display'}`}>{value || '—'}</p>
    </div>
  );
}
