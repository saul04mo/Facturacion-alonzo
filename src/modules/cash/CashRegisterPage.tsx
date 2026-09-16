import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '@/store/appStore';
import { useToast } from '@/components/Toast';
import { PageLoading } from '@/components/LoadingScreen';
import { todayVE, formatDateTime } from '@/utils/dateUtils';
import {
  fetchCashCounts, fetchCashCountHistory, fetchCashCountAt, saveCashCount,
  denominationTotal, USD_DENOMINATIONS,
} from './cashService';
import type {
  Branch, CashCount, CashCountEntry, CashCountSlot, DenominationCount,
} from '@/types';
import {
  Wallet, Banknote, Save, RefreshCw, Store, Warehouse, History, ChevronDown,
  ArrowUpRight, ArrowDownRight, CalendarClock, X,
} from 'lucide-react';

const BRANCH_ORDER: Branch[] = ['store', 'warehouse'];
const BRANCH_LABEL: Record<Branch, string> = { store: 'Tienda', warehouse: 'Almacén' };

function fmtUsd(n: number): string {
  return `$ ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** DD/MM/AAAA a partir del dateKey, sin pasar por Date (evita corrimientos). */
function fmtDateKey(dateKey: string): string {
  const [y, m, d] = dateKey.split('-');
  return `${d}/${m}/${y}`;
}

/** Convierte el string de un input numérico a número, tolerando coma decimal. */
function parseAmount(raw: string): number {
  const n = parseFloat(raw.replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

export function CashRegisterPage() {
  const currentUser = useAppStore((s) => s.currentUser);
  const toast = useToast();

  /** Vacío = el efectivo de ahora (editable). Con fecha = cómo estaba ese día. */
  const [viewDate, setViewDate] = useState('');
  const readOnly = Boolean(viewDate);

  const [loading, setLoading] = useState(true);
  const [savingBranch, setSavingBranch] = useState<Branch | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const [drafts, setDrafts] = useState<Record<Branch, BranchCountDraft>>(
    () => ({ store: EMPTY_BRANCH_DRAFT, warehouse: EMPTY_BRANCH_DRAFT }),
  );
  const [saved, setSaved] = useState<Record<Branch, CashCount | null>>(
    () => ({ store: null, warehouse: null }),
  );
  /** Firma de lo último guardado: sirve para saber si hay cambios sin guardar. */
  const [baselines, setBaselines] = useState<Record<Branch, string>>(
    () => ({ store: '', warehouse: '' }),
  );
  const [history, setHistory] = useState<CashCountEntry[]>([]);
  /** Cómo quedó cada sucursal el día que se está mirando. */
  const [asOf, setAsOf] = useState<Record<Branch, CashCountEntry | null>>(
    () => ({ store: null, warehouse: null }),
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [counts, entries, at] = await Promise.all([
        fetchCashCounts(),
        fetchCashCountHistory(50),
        viewDate ? fetchCashCountAt(viewDate) : Promise.resolve(null),
      ]);

      // Con fecha elegida los recuadros muestran la foto de ese día; sin fecha,
      // el efectivo de ahora.
      const source: Record<Branch, { admin?: DenominationCount; counter?: DenominationCount } | null> =
        at ?? counts;

      const nextDrafts = {} as Record<Branch, BranchCountDraft>;
      const nextBaselines = {} as Record<Branch, string>;
      BRANCH_ORDER.forEach((b) => {
        nextDrafts[b] = {
          admin: countToDraft(source[b]?.admin),
          counter: countToDraft(source[b]?.counter),
        };
        nextBaselines[b] = draftSignature(nextDrafts[b]);
      });

      setSaved(counts);
      setDrafts(nextDrafts);
      setBaselines(nextBaselines);
      setHistory(entries);
      setAsOf(at ?? { store: null, warehouse: null });
    } catch (err: any) {
      console.error('Error cargando el conteo de efectivo:', err);
      toast.error(err?.message || 'No se pudo cargar el conteo.');
    } finally {
      setLoading(false);
    }
  }, [viewDate, toast]);

  useEffect(() => { load(); }, [load]);

  function handleChange(b: Branch, slot: CashCountSlot, draft: CountDraft) {
    setDrafts((prev) => ({ ...prev, [b]: { ...prev[b], [slot]: draft } }));
  }

  async function handleSave(b: Branch) {
    if (!currentUser || readOnly) return;
    setSavingBranch(b);
    try {
      const draft = drafts[b];
      const result = await saveCashCount({
        branch: b,
        admin: draftToCount(draft.admin),
        counter: draftToCount(draft.counter),
        user: currentUser,
      });

      // El baseline se recalcula sobre lo que se acaba de mandar: así el
      // botón vuelve a "sin cambios" sin tener que releer el documento.
      setBaselines((prev) => ({ ...prev, [b]: draftSignature(draft) }));
      setSaved((prev) => ({ ...prev, [b]: result.saved }));

      if (result.changed) {
        // El historial se relee para que la entrada nueva traiga su id real.
        setHistory(await fetchCashCountHistory(50));
        toast.success(`Efectivo de ${BRANCH_LABEL[b]} actualizado.`);
      } else {
        toast.info(`${BRANCH_LABEL[b]}: los números venían iguales, no se registró nada.`);
      }
    } catch (err: any) {
      toast.error(err?.message || 'No se pudo guardar el conteo.');
    } finally {
      setSavingBranch(null);
    }
  }

  const grandTotal = BRANCH_ORDER.reduce((sum, b) => sum + branchDraftTotal(drafts[b]), 0);

  return (
    <div className="space-y-5 animate-fade-up">
      {/* ── Encabezado ── */}
      <div className="card p-5">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-3 mr-auto">
            <div className="w-11 h-11 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0">
              <Wallet size={20} className="text-emerald-600" />
            </div>
            <div>
              <h1 className="text-lg font-display font-bold text-navy-900">Conteo de Efectivo</h1>
              <p className="text-navy-400 text-xs font-body">
                {readOnly
                  ? `Viendo cómo quedó el ${fmtDateKey(viewDate)}`
                  : 'El efectivo que hay ahora mismo'}
              </p>
            </div>
          </div>

          <div>
            <label className="block text-xs font-display font-medium text-navy-500 mb-1">Ver otro día</label>
            <div className="flex gap-1">
              <input type="date" value={viewDate} max={todayVE()}
                onChange={(e) => setViewDate(e.target.value)} className="input-field" />
              {readOnly && (
                <button type="button" onClick={() => setViewDate('')} className="btn-ghost text-sm"
                  title="Volver al efectivo de ahora">
                  <X size={14} /> Hoy
                </button>
              )}
            </div>
          </div>

          <div className="text-right">
            <p className="text-xs text-navy-400 font-display uppercase tracking-wide">
              {readOnly ? 'Total ese día' : 'Total en mano'}
            </p>
            <p className="font-mono text-xl font-bold text-navy-900">{fmtUsd(grandTotal)}</p>
          </div>

          <button onClick={load} disabled={loading || savingBranch !== null}
            className="btn-ghost p-2.5" title="Recargar">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {readOnly && (
        <div className="card p-4 border-l-4 border-l-blue-500 flex gap-3">
          <CalendarClock size={18} className="text-blue-500 flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-display font-medium text-navy-800">
              Estás viendo el {fmtDateKey(viewDate)} — solo lectura
            </p>
            <p className="text-navy-500 font-body mt-0.5">
              Son los últimos números registrados hasta ese día. Para volver a cargar
              efectivo tocá <strong>Hoy</strong>, arriba.
            </p>
          </div>
        </div>
      )}

      {loading ? (
        <PageLoading message="Cargando el efectivo..." />
      ) : (
        <>
          <div className="card overflow-hidden">
            <div className="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-surface-200">
              <Banknote size={18} className="text-emerald-600 flex-shrink-0" />
              <div>
                <h2 className="font-display font-bold text-navy-900">Conteo de dólares por billete</h2>
                <p className="text-navy-400 text-xs font-body mt-0.5">
                  Cuánto tienen los vendedores de cambio y cuánto hay en la caja de administración.
                </p>
              </div>
            </div>

            <div className="grid lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-surface-200">
              {BRANCH_ORDER.map((b) => (
                <BranchCountColumn
                  key={b}
                  branch={b}
                  draft={drafts[b]}
                  saved={saved[b]}
                  asOf={asOf[b]}
                  readOnly={readOnly}
                  dirty={!readOnly && draftSignature(drafts[b]) !== baselines[b]}
                  saving={savingBranch === b}
                  onChange={(slot, draft) => handleChange(b, slot, draft)}
                  onSave={() => handleSave(b)}
                />
              ))}
            </div>
          </div>

          <CashCountHistory
            entries={history}
            open={showHistory}
            onToggle={() => setShowHistory((v) => !v)}
            onPickDate={setViewDate}
          />
        </>
      )}
    </div>
  );
}

// ════════════════════════════════════════
// Conteo por denominación
// ════════════════════════════════════════

/**
 * El conteo mientras se edita: las cantidades viven como texto para que
 * borrar un campo no lo deje pegado en cero ni pise lo que el usuario
 * está tipeando.
 */
type CountDraft = { bills: Record<string, string>; loose: string };
type BranchCountDraft = Record<CashCountSlot, CountDraft>;

const EMPTY_BRANCH_DRAFT: BranchCountDraft = {
  admin: { bills: {}, loose: '' },
  counter: { bills: {}, loose: '' },
};

// El orden manda cómo se apilan los dos bloques en cada sucursal.
const SLOTS: { id: CashCountSlot; title: string; hint: string }[] = [
  { id: 'counter', title: 'Cambio en mostrador', hint: 'lo que tienen los vendedores' },
  { id: 'admin', title: 'En caja de administración', hint: 'lo que está guardado' },
];

function draftToCount(draft: CountDraft): DenominationCount {
  const bills: Record<string, number> = {};
  USD_DENOMINATIONS.forEach((den) => {
    const qty = parseInt(draft.bills[String(den)] ?? '', 10);
    if (Number.isFinite(qty) && qty > 0) bills[String(den)] = qty;
  });
  return { bills, loose: parseAmount(draft.loose) };
}

function countToDraft(count: DenominationCount | null | undefined): CountDraft {
  const bills: Record<string, string> = {};
  USD_DENOMINATIONS.forEach((den) => {
    const qty = count?.bills?.[String(den)];
    if (qty) bills[String(den)] = String(qty);
  });
  return { bills, loose: count?.loose ? String(count.loose) : '' };
}

/** Firma del borrador: sirve para detectar cambios sin guardar. */
function draftSignature(draft: BranchCountDraft): string {
  return JSON.stringify([draftToCount(draft.admin), draftToCount(draft.counter)]);
}

function branchDraftTotal(draft: BranchCountDraft): number {
  return SLOTS.reduce((sum, s) => sum + denominationTotal(draftToCount(draft[s.id])), 0);
}

function BranchCountColumn(props: {
  branch: Branch;
  draft: BranchCountDraft;
  saved: CashCount | null;
  asOf: CashCountEntry | null;
  readOnly: boolean;
  dirty: boolean;
  saving: boolean;
  onChange: (slot: CashCountSlot, draft: CountDraft) => void;
  onSave: () => void;
}) {
  const { branch, draft, saved, asOf, readOnly, dirty, saving } = props;
  const total = branchDraftTotal(draft);

  return (
    <div className="p-5">
      {/* El botón va acá arriba a propósito: al final de la columna quedaba
          fuera de pantalla y nadie lo encontraba. */}
      <div className="flex flex-wrap items-center gap-3">
        {branch === 'store'
          ? <Store size={16} className="text-navy-400 flex-shrink-0" />
          : <Warehouse size={16} className="text-navy-400 flex-shrink-0" />}
        <h3 className="font-display font-bold text-navy-900 uppercase text-sm tracking-wide">
          {BRANCH_LABEL[branch]}
        </h3>
        <span className="ml-auto font-mono font-bold text-navy-900">{fmtUsd(total)}</span>
        {!readOnly && (
          <button onClick={props.onSave} disabled={saving || !dirty}
            className="btn-primary text-sm px-4 py-2">
            <Save size={14} /> {saving ? 'Guardando...' : dirty ? 'Guardar' : 'Guardado'}
          </button>
        )}
      </div>

      <p className={`text-xs font-body mt-2 pb-3 border-b border-surface-200
        ${dirty ? 'text-amber-600 font-medium' : 'text-navy-400'}`}>
        {readOnly
          ? asOf
            ? `Último cambio hasta esa fecha · ${asOf.changedByName} · ${formatDateTime(asOf.changedAt)}`
            : 'Esta sucursal no tenía nada registrado a esa fecha.'
          : dirty
            ? 'Hay cambios sin guardar.'
            : saved
              ? `Actualizado por ${saved.updatedByName} · ${formatDateTime(saved.updatedAt)}`
              : 'Todavía no se guardó ningún conteo.'}
      </p>

      <div className="mt-4 space-y-5">
        {SLOTS.map((slot) => (
          <DenominationBlock
            key={slot.id}
            title={slot.title}
            hint={slot.hint}
            draft={draft[slot.id]}
            readOnly={readOnly}
            onChange={(d) => props.onChange(slot.id, d)}
          />
        ))}
      </div>
    </div>
  );
}

function DenominationBlock(props: {
  title: string;
  hint: string;
  draft: CountDraft;
  readOnly: boolean;
  onChange: (draft: CountDraft) => void;
}) {
  const { draft, readOnly } = props;
  const loose = parseAmount(draft.loose);
  const total = denominationTotal(draftToCount(draft));

  return (
    <div>
      <div className="flex items-baseline gap-2">
        <h4 className="text-sm font-display font-semibold text-navy-800">{props.title}</h4>
        <span className="text-xs text-navy-400 font-body">{props.hint}</span>
      </div>

      <table className="w-full mt-2 text-sm">
        <tbody className="divide-y divide-surface-100">
          <tr>
            <td className="py-1.5 text-navy-500 font-body">Encima</td>
            <td className="py-1.5 text-center text-navy-300 font-body text-xs">suelto</td>
            <td className="py-1.5 text-right">
              {readOnly ? (
                <span className="font-mono text-navy-700">{loose ? fmtUsd(loose) : '—'}</span>
              ) : (
                <input
                  type="number" step="0.01" min="0" inputMode="decimal"
                  value={draft.loose}
                  onChange={(e) => props.onChange({ ...draft, loose: e.target.value })}
                  className="input-field w-24 ml-auto px-2 py-1 text-right font-mono"
                  placeholder="0.00"
                />
              )}
            </td>
          </tr>

          {USD_DENOMINATIONS.map((den) => {
            const raw = draft.bills[String(den)] ?? '';
            const qty = parseInt(raw, 10);
            const subtotal = Number.isFinite(qty) && qty > 0 ? den * qty : 0;

            return (
              <tr key={den}>
                <td className="py-1.5 font-mono text-navy-600">{fmtUsd(den)}</td>
                <td className="py-1.5 text-center">
                  {readOnly ? (
                    <span className="font-mono font-semibold text-navy-800">{subtotal ? qty : 0}</span>
                  ) : (
                    <input
                      type="number" step="1" min="0" inputMode="numeric"
                      value={raw}
                      onChange={(e) => props.onChange({
                        ...draft,
                        bills: { ...draft.bills, [String(den)]: e.target.value },
                      })}
                      className="input-field w-16 mx-auto px-2 py-1 text-center font-mono font-semibold"
                      placeholder="0"
                    />
                  )}
                </td>
                <td className="py-1.5 text-right font-mono text-navy-700">
                  {subtotal ? fmtUsd(subtotal) : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-surface-200">
            <td colSpan={2} className="pt-2 font-display font-semibold text-navy-800">Subtotal</td>
            <td className="pt-2 text-right font-mono font-semibold text-navy-900">{fmtUsd(total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ════════════════════════════════════════
// Historial de cambios
// ════════════════════════════════════════

function CashCountHistory({ entries, open, onToggle, onPickDate }: {
  entries: CashCountEntry[];
  open: boolean;
  onToggle: () => void;
  onPickDate: (dateKey: string) => void;
}) {
  return (
    <div className="card overflow-hidden">
      <button onClick={onToggle}
        className="w-full flex items-center gap-3 px-5 py-4 hover:bg-surface-50 transition-colors">
        <History size={18} className="text-navy-400 flex-shrink-0" />
        <div className="text-left mr-auto">
          <h2 className="font-display font-bold text-navy-900">Historial de cambios</h2>
          <p className="text-navy-400 text-xs font-body mt-0.5">
            Tocá una fecha para ver los recuadros de ese día
          </p>
        </div>
        <span className="text-navy-400 font-body text-sm">{entries.length}</span>
        <ChevronDown size={16} className={`text-navy-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="border-t border-surface-200">
          {entries.length === 0 ? (
            <p className="px-5 py-8 text-center text-navy-400 text-sm font-body">
              Todavía no hay cambios registrados.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-50 text-navy-400 text-xs font-display uppercase tracking-wide">
                  <tr>
                    <th className="text-left px-5 py-2.5">Cuándo</th>
                    <th className="text-left px-5 py-2.5">Sucursal</th>
                    <th className="text-left px-5 py-2.5">Quién</th>
                    <th className="text-right px-5 py-2.5">Mostrador</th>
                    <th className="text-right px-5 py-2.5">Administración</th>
                    <th className="text-right px-5 py-2.5">Total</th>
                    <th className="text-right px-5 py-2.5">Diferencia</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-100">
                  {entries.map((e) => {
                    const delta = e.previousTotal === null ? null : e.total - e.previousTotal;
                    const up = delta !== null && delta > 0.005;
                    const down = delta !== null && delta < -0.005;
                    const dateKey = e.changedAtKey?.slice(0, 10);

                    return (
                      <tr key={e.id}>
                        <td className="px-5 py-2.5 whitespace-nowrap">
                          {dateKey ? (
                            <button type="button" onClick={() => onPickDate(dateKey)}
                              className="text-blue-600 font-body hover:underline"
                              title="Ver los recuadros de ese día">
                              {formatDateTime(e.changedAt)}
                            </button>
                          ) : (
                            <span className="text-navy-600 font-body">{formatDateTime(e.changedAt)}</span>
                          )}
                        </td>
                        <td className="px-5 py-2.5 text-navy-700 font-display font-medium">
                          {BRANCH_LABEL[e.branch]}
                        </td>
                        <td className="px-5 py-2.5 text-navy-500 font-body">{e.changedByName}</td>
                        <td className="px-5 py-2.5 text-right font-mono text-navy-600">
                          {fmtUsd(denominationTotal(e.counter))}
                        </td>
                        <td className="px-5 py-2.5 text-right font-mono text-navy-600">
                          {fmtUsd(denominationTotal(e.admin))}
                        </td>
                        <td className="px-5 py-2.5 text-right font-mono font-semibold text-navy-900">
                          {fmtUsd(e.total)}
                        </td>
                        <td className="px-5 py-2.5 text-right whitespace-nowrap">
                          {delta === null ? (
                            <span className="text-navy-300 font-body text-xs">primera carga</span>
                          ) : (
                            <span className={`inline-flex items-center gap-0.5 font-mono
                              ${up ? 'text-emerald-600' : down ? 'text-accent-red' : 'text-navy-300'}`}>
                              {up ? <ArrowUpRight size={12} /> : down ? <ArrowDownRight size={12} /> : null}
                              {up ? '+' : ''}{fmtUsd(delta)}
                            </span>
                          )}
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
    </div>
  );
}
