import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAppStore } from '@/store/appStore';
import { usePermissions } from '@/hooks/usePermissions';
import { useToast } from '@/components/Toast';
import { Modal } from '@/components/Modal';
import { PageLoading } from '@/components/LoadingScreen';
import { todayVE, formatDateTime, formatDateLong } from '@/utils/dateUtils';
import {
  computeCashDay, expectedCash, buildSnapshot, getSession, getPreviousClose,
  openSession, closeSession, reopenSession, recordCashMovement, deleteMovement,
  type CashDayData,
} from './cashService';
import type { Branch, CashCurrency, CashMovement, CashSession } from '@/types';
import {
  Wallet, Lock, Unlock, Plus, Trash2, RefreshCw, AlertTriangle,
  ArrowDownCircle, ArrowUpCircle, ChevronDown, Store, Warehouse,
} from 'lucide-react';

const BRANCH_LABEL: Record<Branch, string> = { store: 'Tienda', warehouse: 'Almacén' };

function fmtBs(n: number): string {
  return `Bs ${n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtUsd(n: number): string {
  return `$ ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Convierte el string de un input numérico a número, tolerando coma decimal. */
function parseAmount(raw: string): number {
  const n = parseFloat(raw.replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

export function CashRegisterPage() {
  const currentUser = useAppStore((s) => s.currentUser);
  const exchangeRate = useAppStore((s) => s.exchangeRate);
  const { isAdmin } = usePermissions();
  const toast = useToast();

  const [dateKey, setDateKey] = useState(todayVE());
  const [branch, setBranch] = useState<Branch>('store');

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [session, setSession] = useState<CashSession | null>(null);
  const [day, setDay] = useState<CashDayData | null>(null);
  const [prevClose, setPrevClose] = useState<CashSession | null>(null);

  // Formulario de apertura
  const [openVes, setOpenVes] = useState('');
  const [openUsd, setOpenUsd] = useState('');
  const [openNote, setOpenNote] = useState('');

  // Formulario de cierre (arqueo)
  const [countedVes, setCountedVes] = useState('');
  const [countedUsd, setCountedUsd] = useState('');
  const [closeNote, setCloseNote] = useState('');

  const [movementModal, setMovementModal] = useState(false);
  const [showInvoices, setShowInvoices] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, d] = await Promise.all([
        getSession(dateKey, branch),
        computeCashDay(dateKey, branch),
      ]);
      setSession(s);
      setDay(d);

      if (!s) {
        // Sugerimos el fondo inicial con lo que quedó en el último cierre.
        const prev = await getPreviousClose(dateKey, branch);
        setPrevClose(prev);
        setOpenVes(prev?.snapshot ? String(prev.snapshot.countedVes) : '');
        setOpenUsd(prev?.snapshot ? String(prev.snapshot.countedUsd) : '');
      } else {
        setPrevClose(null);
      }
    } catch (err: any) {
      console.error('Error cargando la caja:', err);
      toast.error(err?.message || 'No se pudo cargar la caja.');
    } finally {
      setLoading(false);
    }
  }, [dateKey, branch, toast]);

  useEffect(() => { load(); }, [load]);

  const expected = useMemo(() => {
    if (!session || !day) return { expectedVes: 0, expectedUsd: 0 };
    return expectedCash(session, day);
  }, [session, day]);

  const diffVes = parseAmount(countedVes) - expected.expectedVes;
  const diffUsd = parseAmount(countedUsd) - expected.expectedUsd;

  async function handleOpen() {
    if (!currentUser) return;
    setBusy(true);
    try {
      await openSession({
        dateKey, branch,
        openingVes: parseAmount(openVes),
        openingUsd: parseAmount(openUsd),
        note: openNote,
        user: currentUser,
      });
      toast.success('Caja abierta.');
      setOpenNote('');
      await load();
    } catch (err: any) {
      toast.error(err?.message || 'No se pudo abrir la caja.');
    } finally {
      setBusy(false);
    }
  }

  async function handleClose() {
    if (!currentUser || !session || !day) return;
    if (countedVes.trim() === '' && countedUsd.trim() === '') {
      toast.warning('Contá el efectivo antes de cerrar: cargá al menos una de las dos gavetas.');
      return;
    }
    setBusy(true);
    try {
      await closeSession({
        dateKey, branch,
        snapshot: buildSnapshot({
          session, day,
          countedVes: parseAmount(countedVes),
          countedUsd: parseAmount(countedUsd),
          exchangeRate,
        }),
        note: closeNote,
        user: currentUser,
      });
      toast.success('Caja cerrada.');
      setCloseNote('');
      await load();
    } catch (err: any) {
      toast.error(err?.message || 'No se pudo cerrar la caja.');
    } finally {
      setBusy(false);
    }
  }

  async function handleReopen() {
    setBusy(true);
    try {
      await reopenSession(dateKey, branch);
      toast.success('Caja reabierta.');
      await load();
    } catch (err: any) {
      toast.error(err?.message || 'No se pudo reabrir la caja.');
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteMovement(m: CashMovement) {
    setBusy(true);
    try {
      await deleteMovement(m);
      toast.success('Movimiento eliminado.');
      await load();
    } catch (err: any) {
      toast.error(err?.message || 'No se pudo eliminar el movimiento.');
    } finally {
      setBusy(false);
    }
  }

  const isClosed = session?.status === 'closed';
  const snap = session?.snapshot;

  return (
    <div className="space-y-5 animate-fade-up">
      {/* ── Encabezado ── */}
      <div className="card p-5">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex items-center gap-3 mr-auto">
            <div className="w-11 h-11 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0">
              <Wallet size={20} className="text-emerald-600" />
            </div>
            <div>
              <h1 className="text-lg font-display font-bold text-navy-900">Cierre de Caja</h1>
              {/* Mediodía con offset de Venezuela: así el título muestra el
                  mismo día aunque la PC tenga otra zona horaria. */}
              <p className="text-navy-400 text-xs font-body">{formatDateLong(`${dateKey}T12:00:00-04:00`)}</p>
            </div>
          </div>

          <div>
            <label className="block text-xs font-display font-medium text-navy-500 mb-1">Fecha</label>
            <input type="date" value={dateKey} max={todayVE()}
              onChange={(e) => setDateKey(e.target.value)} className="input-field" />
          </div>

          <div>
            <label className="block text-xs font-display font-medium text-navy-500 mb-1">Sucursal</label>
            <div className="flex gap-1">
              {(['store', 'warehouse'] as Branch[]).map((b) => (
                <button key={b} type="button" onClick={() => setBranch(b)}
                  className={`px-3 py-2 rounded-lg text-sm font-display font-medium border transition-colors flex items-center gap-1.5
                    ${branch === b
                      ? 'bg-navy-900 text-white border-navy-900'
                      : 'bg-white text-navy-500 border-surface-200 hover:border-navy-300'}`}>
                  {b === 'store' ? <Store size={14} /> : <Warehouse size={14} />}
                  {BRANCH_LABEL[b]}
                </button>
              ))}
            </div>
          </div>

          <button onClick={load} disabled={loading || busy} className="btn-ghost p-2.5" title="Recargar">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {loading ? (
        <PageLoading message="Cargando movimientos de caja..." />
      ) : !session ? (
        /* ══════════ SIN CAJA ABIERTA ══════════ */
        <div className="card p-6 max-w-xl">
          <h2 className="font-display font-bold text-navy-900 flex items-center gap-2">
            <Unlock size={16} className="text-navy-400" />
            Abrir caja — {BRANCH_LABEL[branch]}
          </h2>
          <p className="text-navy-400 text-sm mt-1 font-body">
            Cuánto efectivo dejás en la gaveta al empezar el día.
          </p>

          {prevClose?.snapshot && (
            <div className="mt-4 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm">
              <p className="text-blue-800 font-display font-medium">
                Último cierre ({prevClose.dateKey})
              </p>
              <p className="text-blue-600 font-body mt-0.5">
                Quedaron {fmtBs(prevClose.snapshot.countedVes)} y {fmtUsd(prevClose.snapshot.countedUsd)}.
                Ya los cargamos abajo — corregilos si sacaste plata.
              </p>
            </div>
          )}

          <div className="grid sm:grid-cols-2 gap-4 mt-4">
            <div>
              <label className="block text-sm font-display font-medium text-navy-700 mb-1.5">Fondo inicial en Bs</label>
              <input type="number" step="0.01" min="0" value={openVes}
                onChange={(e) => setOpenVes(e.target.value)}
                className="input-field font-mono" placeholder="0.00" />
            </div>
            <div>
              <label className="block text-sm font-display font-medium text-navy-700 mb-1.5">Fondo inicial en $</label>
              <input type="number" step="0.01" min="0" value={openUsd}
                onChange={(e) => setOpenUsd(e.target.value)}
                className="input-field font-mono" placeholder="0.00" />
            </div>
          </div>

          <div className="mt-4">
            <label className="block text-sm font-display font-medium text-navy-700 mb-1.5">Nota (opcional)</label>
            <input type="text" value={openNote} onChange={(e) => setOpenNote(e.target.value)}
              className="input-field" placeholder="Ej: se dejó sencillo para vueltos" />
          </div>

          <button onClick={handleOpen} disabled={busy} className="btn-primary w-full py-3 mt-5">
            <Unlock size={16} /> Abrir caja
          </button>
        </div>
      ) : (
        /* ══════════ CAJA ABIERTA O CERRADA ══════════ */
        <>
          {isClosed && snap && (
            <div className="card p-4 border-l-4 border-l-emerald-500">
              <div className="flex flex-wrap items-center gap-3">
                <Lock size={16} className="text-emerald-600" />
                <p className="text-sm font-display font-medium text-navy-800 mr-auto">
                  Caja cerrada por {session.closedByName} · {formatDateTime(session.closedAt)}
                </p>
                {isAdmin && (
                  <button onClick={handleReopen} disabled={busy} className="btn-ghost text-sm">
                    <Unlock size={14} /> Reabrir
                  </button>
                )}
              </div>
              {session.closingNote && (
                <p className="text-navy-500 text-sm font-body mt-2">{session.closingNote}</p>
              )}
            </div>
          )}

          {day && day.changeUnassignedUsd > 0.01 && (
            <div className="card p-4 border-l-4 border-l-amber-500 flex gap-3">
              <AlertTriangle size={18} className="text-amber-500 flex-shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-display font-medium text-navy-800">
                  Vuelto sin moneda asignada: {fmtUsd(day.changeUnassignedUsd)}
                </p>
                <p className="text-navy-500 font-body mt-0.5">
                  Son facturas creadas antes de que el POS preguntara en qué moneda se entrega el
                  vuelto. No se descuentan de ninguna gaveta — restalos a mano de la que corresponda.
                </p>
              </div>
            </div>
          )}

          {/* ── Las dos gavetas ── */}
          <div className="grid lg:grid-cols-2 gap-5">
            <DrawerCard
              title="Efectivo en Bolívares" currency="ves" fmt={fmtBs}
              opening={session.openingVes}
              sales={snap ? snap.salesVes : day?.salesVes ?? 0}
              movementsIn={snap ? snap.movementsInVes : day?.movementsInVes ?? 0}
              change={snap ? snap.changeVes : day?.changeVes ?? 0}
              movementsOut={snap ? snap.movementsOutVes : day?.movementsOutVes ?? 0}
              expected={snap ? snap.expectedVes : expected.expectedVes}
              counted={snap ? snap.countedVes : parseAmount(countedVes)}
              countedRaw={countedVes} onCounted={setCountedVes}
              diff={snap ? snap.diffVes : diffVes}
              locked={isClosed}
            />
            <DrawerCard
              title="Efectivo en Dólares" currency="usd" fmt={fmtUsd}
              opening={session.openingUsd}
              sales={snap ? snap.salesUsd : day?.salesUsd ?? 0}
              movementsIn={snap ? snap.movementsInUsd : day?.movementsInUsd ?? 0}
              change={snap ? snap.changeUsd : day?.changeUsd ?? 0}
              movementsOut={snap ? snap.movementsOutUsd : day?.movementsOutUsd ?? 0}
              expected={snap ? snap.expectedUsd : expected.expectedUsd}
              counted={snap ? snap.countedUsd : parseAmount(countedUsd)}
              countedRaw={countedUsd} onCounted={setCountedUsd}
              diff={snap ? snap.diffUsd : diffUsd}
              locked={isClosed}
            />
          </div>

          {/* ── Cerrar caja ── */}
          {!isClosed && (
            <div className="card p-5">
              <h2 className="font-display font-bold text-navy-900 flex items-center gap-2">
                <Lock size={16} className="text-navy-400" /> Cerrar la caja del día
              </h2>
              <p className="text-navy-400 text-sm mt-1 font-body">
                Contá el efectivo de cada gaveta y cargalo arriba. Al cerrar, los números
                quedan congelados aunque después se edite una factura de hoy.
              </p>
              <div className="mt-4">
                <label className="block text-sm font-display font-medium text-navy-700 mb-1.5">
                  Observación del cierre (opcional)
                </label>
                <input type="text" value={closeNote} onChange={(e) => setCloseNote(e.target.value)}
                  className="input-field" placeholder="Ej: faltaron 2$, se descontará al vendedor" />
              </div>
              <button onClick={handleClose} disabled={busy} className="btn-primary w-full py-3 mt-4">
                <Lock size={16} /> Cerrar caja
              </button>
            </div>
          )}

          {/* ── Movimientos ── */}
          <div className="card overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-4 border-b border-surface-200">
              <h2 className="font-display font-bold text-navy-900 mr-auto">
                Movimientos de efectivo
                {day && day.movements.length > 0 && (
                  <span className="ml-2 text-navy-400 font-normal text-sm">({day.movements.length})</span>
                )}
              </h2>
              {!isClosed && (
                <button onClick={() => setMovementModal(true)} className="btn-ghost text-sm">
                  <Plus size={14} /> Agregar
                </button>
              )}
            </div>

            {!day || day.movements.length === 0 ? (
              <p className="px-5 py-8 text-center text-navy-400 text-sm font-body">
                Sin retiros, gastos ni abonos en efectivo registrados hoy.
              </p>
            ) : (
              <div className="divide-y divide-surface-100">
                {day.movements.map((m) => (
                  <div key={m.id} className="flex items-center gap-3 px-5 py-3">
                    {m.direction === 'in'
                      ? <ArrowDownCircle size={18} className="text-emerald-500 flex-shrink-0" />
                      : <ArrowUpCircle size={18} className="text-accent-red flex-shrink-0" />}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-display font-medium text-navy-800 truncate">{m.concept}</p>
                      <p className="text-xs text-navy-400 font-body">
                        {SOURCE_LABEL[m.source]} · {m.createdByName} · {formatDateTime(m.createdAt)}
                      </p>
                    </div>
                    <span className={`font-mono text-sm font-medium flex-shrink-0
                      ${m.direction === 'in' ? 'text-emerald-600' : 'text-accent-red'}`}>
                      {m.direction === 'in' ? '+' : '−'}{' '}
                      {m.currency === 'ves' ? fmtBs(m.amount) : fmtUsd(m.amount)}
                    </span>
                    {!isClosed && m.source === 'manual' && (
                      <button onClick={() => handleDeleteMovement(m)} disabled={busy}
                        className="btn-ghost p-1.5 text-accent-red" title="Eliminar">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Detalle de facturas ── */}
          <div className="card overflow-hidden">
            <button onClick={() => setShowInvoices((v) => !v)}
              className="w-full flex items-center gap-3 px-5 py-4 hover:bg-surface-50 transition-colors">
              <h2 className="font-display font-bold text-navy-900 mr-auto">
                Facturas con efectivo
                <span className="ml-2 text-navy-400 font-normal text-sm">
                  ({day?.invoiceLines.length ?? 0})
                </span>
              </h2>
              {day && day.cancelledCount > 0 && (
                <span className="text-xs text-navy-400 font-body">
                  {day.cancelledCount} anulada(s) excluida(s)
                </span>
              )}
              <ChevronDown size={16} className={`text-navy-400 transition-transform ${showInvoices ? 'rotate-180' : ''}`} />
            </button>

            {showInvoices && (
              <div className="border-t border-surface-200 overflow-x-auto">
                {!day || day.invoiceLines.length === 0 ? (
                  <p className="px-5 py-8 text-center text-navy-400 text-sm font-body">
                    Ninguna factura de este día cobró en efectivo.
                  </p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-surface-50 text-navy-400 text-xs font-display uppercase tracking-wide">
                      <tr>
                        <th className="text-left px-5 py-2.5">Factura</th>
                        <th className="text-left px-5 py-2.5">Vendedor</th>
                        <th className="text-right px-5 py-2.5">Efectivo Bs</th>
                        <th className="text-right px-5 py-2.5">Efectivo $</th>
                        <th className="text-right px-5 py-2.5">Vuelto</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-100">
                      {day.invoiceLines.map((l) => (
                        <tr key={l.invoiceId}>
                          <td className="px-5 py-2.5 font-mono text-navy-700">
                            FACT-{String(l.numericId).padStart(4, '0')}
                          </td>
                          <td className="px-5 py-2.5 text-navy-500 font-body">{l.sellerName}</td>
                          <td className="px-5 py-2.5 text-right font-mono text-navy-700">
                            {l.ves ? fmtBs(l.ves) : '—'}
                          </td>
                          <td className="px-5 py-2.5 text-right font-mono text-navy-700">
                            {l.usd ? fmtUsd(l.usd) : '—'}
                          </td>
                          <td className="px-5 py-2.5 text-right font-mono text-accent-red">
                            {l.changeVes ? `− ${fmtBs(l.changeVes)}` : ''}
                            {l.changeUsd ? `− ${fmtUsd(l.changeUsd)}` : ''}
                            {l.changeUnassignedUsd ? `? ${fmtUsd(l.changeUnassignedUsd)}` : ''}
                            {!l.changeVes && !l.changeUsd && !l.changeUnassignedUsd ? '—' : ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        </>
      )}

      <MovementModal
        open={movementModal}
        onClose={() => setMovementModal(false)}
        onSaved={async () => { setMovementModal(false); await load(); }}
        dateKey={dateKey}
        branch={branch}
      />
    </div>
  );
}

const SOURCE_LABEL: Record<CashMovement['source'], string> = {
  manual: 'Manual',
  abono: 'Abono',
  return: 'Devolución',
  exchange: 'Cambio',
};

// ════════════════════════════════════════
// Tarjeta de una gaveta
// ════════════════════════════════════════
function DrawerCard(props: {
  title: string;
  currency: CashCurrency;
  fmt: (n: number) => string;
  opening: number;
  sales: number;
  movementsIn: number;
  change: number;
  movementsOut: number;
  expected: number;
  counted: number;
  countedRaw: string;
  onCounted: (v: string) => void;
  diff: number;
  locked: boolean;
}) {
  const { fmt, diff, locked } = props;
  const hasDiff = Math.abs(diff) > 0.01;

  return (
    <div className="card p-5">
      <h2 className="font-display font-bold text-navy-900">{props.title}</h2>

      <div className="mt-4 space-y-2 text-sm font-body">
        <Row label="Fondo inicial" value={fmt(props.opening)} />
        <Row label="Ventas en efectivo" value={`+ ${fmt(props.sales)}`} positive />
        {props.movementsIn > 0.01 && (
          <Row label="Otros ingresos" value={`+ ${fmt(props.movementsIn)}`} positive />
        )}
        {props.change > 0.01 && (
          <Row label="Vuelto entregado" value={`− ${fmt(props.change)}`} negative />
        )}
        {props.movementsOut > 0.01 && (
          <Row label="Retiros y gastos" value={`− ${fmt(props.movementsOut)}`} negative />
        )}

        <div className="flex justify-between pt-2.5 border-t border-surface-200">
          <span className="font-display font-semibold text-navy-800">Debería haber</span>
          <span className="font-mono font-semibold text-navy-900">{fmt(props.expected)}</span>
        </div>
      </div>

      <div className="mt-4">
        <label className="block text-sm font-display font-medium text-navy-700 mb-1.5">
          Contado en la gaveta
        </label>
        {locked ? (
          <p className="input-field font-mono bg-surface-50 text-navy-700">{fmt(props.counted)}</p>
        ) : (
          <input type="number" step="0.01" min="0" value={props.countedRaw}
            onChange={(e) => props.onCounted(e.target.value)}
            className="input-field font-mono" placeholder="0.00" />
        )}
      </div>

      {(locked || props.countedRaw.trim() !== '') && (
        <div className={`mt-3 rounded-lg px-4 py-3 border
          ${!hasDiff ? 'bg-emerald-50 border-emerald-200'
            : diff > 0 ? 'bg-blue-50 border-blue-200' : 'bg-red-50 border-red-200'}`}>
          <div className="flex justify-between items-center">
            <span className={`text-sm font-display font-medium
              ${!hasDiff ? 'text-emerald-700' : diff > 0 ? 'text-blue-700' : 'text-accent-red'}`}>
              {!hasDiff ? 'Cuadra exacto' : diff > 0 ? 'Sobrante' : 'Faltante'}
            </span>
            <span className={`font-mono font-semibold
              ${!hasDiff ? 'text-emerald-700' : diff > 0 ? 'text-blue-700' : 'text-accent-red'}`}>
              {fmt(Math.abs(diff))}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, positive, negative }: {
  label: string; value: string; positive?: boolean; negative?: boolean;
}) {
  return (
    <div className="flex justify-between">
      <span className="text-navy-500">{label}</span>
      <span className={`font-mono ${positive ? 'text-emerald-600' : negative ? 'text-accent-red' : 'text-navy-700'}`}>
        {value}
      </span>
    </div>
  );
}

// ════════════════════════════════════════
// Modal de movimiento manual
// ════════════════════════════════════════
function MovementModal({ open, onClose, onSaved, dateKey, branch }: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  dateKey: string;
  branch: Branch;
}) {
  const currentUser = useAppStore((s) => s.currentUser);
  const toast = useToast();
  const [direction, setDirection] = useState<'in' | 'out'>('out');
  const [currency, setCurrency] = useState<CashCurrency>('ves');
  const [amount, setAmount] = useState('');
  const [concept, setConcept] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!currentUser) return;
    const value = parseAmount(amount);
    if (value < 0.01) {
      toast.warning('Cargá un monto mayor a cero.');
      return;
    }
    if (!concept.trim()) {
      toast.warning('Escribí un concepto — sirve para saber después a dónde fue la plata.');
      return;
    }
    setSaving(true);
    try {
      await recordCashMovement({
        dateKey, branch, direction, currency,
        amount: value,
        source: 'manual',
        concept: concept.trim(),
        user: {
          uid: currentUser.uid,
          name: `${currentUser.nombre} ${currentUser.apellido}`.trim(),
        },
      });
      toast.success('Movimiento registrado.');
      setAmount(''); setConcept(''); setDirection('out'); setCurrency('ves');
      await onSaved();
    } catch (err: any) {
      toast.error(err?.message || 'No se pudo registrar el movimiento.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Movimiento de efectivo" size="sm">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-display font-medium text-navy-700 mb-1.5">Tipo</label>
          <div className="grid grid-cols-2 gap-2">
            {([
              { id: 'out', label: 'Sale de caja', hint: 'Retiro, gasto, pago' },
              { id: 'in', label: 'Entra a caja', hint: 'Reposición, ingreso' },
            ] as const).map((opt) => (
              <button key={opt.id} type="button" onClick={() => setDirection(opt.id)}
                className={`px-3 py-2.5 rounded-lg border text-left transition-colors
                  ${direction === opt.id
                    ? 'bg-navy-900 text-white border-navy-900'
                    : 'bg-white text-navy-600 border-surface-200 hover:border-navy-300'}`}>
                <span className="block text-sm font-display font-medium">{opt.label}</span>
                <span className={`block text-xs ${direction === opt.id ? 'text-white/60' : 'text-navy-400'}`}>
                  {opt.hint}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-display font-medium text-navy-700 mb-1.5">Moneda</label>
          <div className="grid grid-cols-2 gap-2">
            {([{ id: 'ves', label: 'Bolívares' }, { id: 'usd', label: 'Dólares' }] as const).map((opt) => (
              <button key={opt.id} type="button" onClick={() => setCurrency(opt.id)}
                className={`px-3 py-2 rounded-lg border text-sm font-display font-medium transition-colors
                  ${currency === opt.id
                    ? 'bg-navy-900 text-white border-navy-900'
                    : 'bg-white text-navy-600 border-surface-200 hover:border-navy-300'}`}>
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-display font-medium text-navy-700 mb-1.5">Monto</label>
          <input type="number" step="0.01" min="0" value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="input-field font-mono" placeholder="0.00" autoFocus />
        </div>

        <div>
          <label className="block text-sm font-display font-medium text-navy-700 mb-1.5">Concepto</label>
          <input type="text" value={concept} onChange={(e) => setConcept(e.target.value)}
            className="input-field" placeholder="Ej: retiro para depósito bancario" />
        </div>

        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="btn-ghost flex-1 py-2.5">Cancelar</button>
          <button onClick={handleSave} disabled={saving} className="btn-primary flex-1 py-2.5">
            {saving ? 'Guardando...' : 'Registrar'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
