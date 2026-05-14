import { useState, useEffect, useMemo } from 'react';
import { useAppStore } from '@/store/appStore';
import { useToast } from '@/components/Toast';
import { Modal } from '@/components/Modal';
import {
  listPeriods, createPeriod, savePeriod, closePeriod, reopenPeriod, deletePeriod,
  recalcPeriod, calcEmployeeTotal,
} from './payrollDraftService';
import { printPayrollDraft } from './payrollDraftPdf';
import type { PayrollDraftPeriod, PayrollDraftEmployee, PayrollDraftItem } from '@/types';
import {
  Plus, Trash2, ChevronDown, ChevronRight, FileText, Printer, Save, Loader2,
  Lock, Unlock, Calendar, Wallet, X as XIcon, Calculator, AlertCircle,
} from 'lucide-react';

// Helper para generar IDs locales de items (no se persisten — Firestore guarda
// el array tal cual y la posición en el array es lo que identifica al item).
function uid(): string {
  return Math.random().toString(36).slice(2, 11);
}

function fmtMoney(n: number): string {
  return n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Quincena por defecto: del 1 al 15 del mes actual.
function defaultPeriodDates(): { name: string; startDate: string; endDate: string } {
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth() + 1;
  const monthNames = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const mm = String(m).padStart(2, '0');
  const day = today.getDate();
  // Si estamos antes del día 16, asumimos quincena 1 (1-15); si no, quincena 2 (16-fin de mes).
  if (day <= 15) {
    return {
      name: `Quincena 1 - ${monthNames[m - 1]} ${y}`,
      startDate: `${y}-${mm}-01`,
      endDate: `${y}-${mm}-15`,
    };
  }
  const lastDay = new Date(y, m, 0).getDate();
  return {
    name: `Quincena 2 - ${monthNames[m - 1]} ${y}`,
    startDate: `${y}-${mm}-16`,
    endDate: `${y}-${mm}-${String(lastDay).padStart(2, '0')}`,
  };
}

export function PayrollDraftPage() {
  const currentUser = useAppStore((s) => s.currentUser);
  const employees = useAppStore((s) => s.employees);
  const toast = useToast();

  const [periods, setPeriods] = useState<PayrollDraftPeriod[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  // Período actualmente seleccionado (estado local editable).
  const [draft, setDraft] = useState<PayrollDraftPeriod | null>(null);
  // Cuáles empleados están expandidos en el accordion.
  const [expandedEmps, setExpandedEmps] = useState<Set<string>>(new Set());

  // Cargar lista al montar
  async function reload() {
    setLoading(true);
    try {
      const list = await listPeriods();
      setPeriods(list);
      // Si ningún seleccionado, tomar el más reciente
      if (!selectedId && list.length > 0) setSelectedId(list[0].id);
      // Refrescar el draft si el período seleccionado existe en la lista
      if (selectedId) {
        const fresh = list.find((p) => p.id === selectedId);
        if (fresh) setDraft(fresh);
      }
    } catch (e: any) {
      toast.error(e?.message || 'Error al cargar períodos de nómina.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cuando cambia el seleccionado, cargar su contenido en el draft
  useEffect(() => {
    const found = periods.find((p) => p.id === selectedId);
    setDraft(found || null);
    // Resetear acordeón al cambiar de período
    setExpandedEmps(new Set());
  }, [selectedId, periods]);

  // ── Mutaciones locales del draft ─────────────
  function updateEmployee(employeeId: string, mut: (emp: PayrollDraftEmployee) => PayrollDraftEmployee) {
    if (!draft) return;
    const employees = draft.employees.map((e) => (e.employeeId === employeeId ? mut(e) : e));
    setDraft(recalcPeriod({ ...draft, employees }));
  }

  function addItem(employeeId: string) {
    updateEmployee(employeeId, (emp) => ({
      ...emp,
      items: [...emp.items, { id: uid(), label: '', amount: 0, isDeduction: false }],
    }));
  }

  function removeItem(employeeId: string, itemId: string) {
    updateEmployee(employeeId, (emp) => ({
      ...emp,
      items: emp.items.filter((i) => i.id !== itemId),
    }));
  }

  function patchItem(employeeId: string, itemId: string, patch: Partial<PayrollDraftItem>) {
    updateEmployee(employeeId, (emp) => ({
      ...emp,
      items: emp.items.map((i) => (i.id === itemId ? { ...i, ...patch } : i)),
    }));
  }

  function setEmployeeNote(employeeId: string, note: string) {
    updateEmployee(employeeId, (emp) => ({ ...emp, note }));
  }

  function removeEmployee(employeeId: string) {
    if (!draft) return;
    if (!confirm('¿Quitar este empleado del período? Sus conceptos se perderán.')) return;
    setDraft(recalcPeriod({
      ...draft,
      employees: draft.employees.filter((e) => e.employeeId !== employeeId),
    }));
    setExpandedEmps((prev) => {
      const next = new Set(prev);
      next.delete(employeeId);
      return next;
    });
  }

  function addEmployeeToPeriod(employeeId: string, employeeName: string) {
    if (!draft) return;
    if (draft.employees.some((e) => e.employeeId === employeeId)) {
      toast.warning('Ese empleado ya está en el período.');
      return;
    }
    const nextEmps = [...draft.employees, { employeeId, employeeName, items: [], total: 0 }];
    setDraft(recalcPeriod({ ...draft, employees: nextEmps }));
    // Auto-expandir el recién agregado
    setExpandedEmps((prev) => new Set(prev).add(employeeId));
  }

  function toggleExpanded(employeeId: string) {
    setExpandedEmps((prev) => {
      const next = new Set(prev);
      if (next.has(employeeId)) next.delete(employeeId);
      else next.add(employeeId);
      return next;
    });
  }

  // ── Persistencia ─────────────────────────────
  async function handleSave() {
    if (!draft) return;
    setSaving(true);
    try {
      await savePeriod(draft, currentUser);
      toast.success(`Período "${draft.name}" guardado.`);
      await reload();
    } catch (e: any) {
      toast.error(e?.message || 'Error al guardar.');
    } finally {
      setSaving(false);
    }
  }

  async function handleClose() {
    if (!draft) return;
    if (!confirm(`Cerrar el período "${draft.name}"? No vas a poder editarlo hasta reabrirlo.`)) return;
    try {
      await savePeriod(draft, currentUser); // Guardar cambios pendientes primero
      await closePeriod(draft.id, currentUser);
      toast.success('Período cerrado.');
      await reload();
    } catch (e: any) {
      toast.error(e?.message || 'Error al cerrar el período.');
    }
  }

  async function handleReopen() {
    if (!draft) return;
    try {
      await reopenPeriod(draft.id, currentUser);
      toast.success('Período reabierto. Ya podés editarlo.');
      await reload();
    } catch (e: any) {
      toast.error(e?.message || 'Error al reabrir.');
    }
  }

  async function handleDelete() {
    if (!draft) return;
    if (!confirm(`¿Borrar definitivamente "${draft.name}"? Esta acción no se puede deshacer.`)) return;
    try {
      await deletePeriod(draft.id);
      toast.success('Período eliminado.');
      setSelectedId(null);
      await reload();
    } catch (e: any) {
      toast.error(e?.message || 'Error al borrar.');
    }
  }

  function handlePrint() {
    if (!draft) return;
    printPayrollDraft(draft);
  }

  // Empleados activos del sistema que NO están aún en el período
  const availableEmployees = useMemo(() => {
    if (!draft) return [];
    const usedIds = new Set(draft.employees.map((e) => e.employeeId));
    return (employees || [])
      .filter((e: any) => !usedIds.has(e.id) && e.activo !== false)
      .map((e: any) => ({ id: e.id, name: `${e.nombre} ${e.apellido || ''}`.trim() }));
  }, [draft, employees]);

  const readOnly = draft?.status === 'closed';

  return (
    <div className="container-section">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Wallet size={22} className="text-blue-500" />
          <div>
            <h1 className="text-lg font-display font-bold text-navy-900 dark:text-gray-100">Cierre de Nómina</h1>
            <p className="text-xs text-navy-400 dark:text-gray-500">
              Conceptos libres por empleado, por período. Genera PDF al cierre.
            </p>
          </div>
        </div>
        <button onClick={() => setCreateOpen(true)} className="btn-primary text-sm">
          <Plus size={14} /> Nuevo período
        </button>
      </div>

      {loading ? (
        <div className="text-center py-10">
          <Loader2 size={28} className="animate-spin mx-auto text-blue-500" />
          <p className="text-xs text-navy-400 mt-2">Cargando períodos…</p>
        </div>
      ) : periods.length === 0 ? (
        <div className="border-2 border-dashed border-surface-200 dark:border-dark-300 rounded-xl p-10 text-center">
          <Calendar size={36} className="mx-auto text-navy-200 mb-3" />
          <p className="text-sm font-display text-navy-600 dark:text-gray-400 mb-1">No hay períodos creados todavía.</p>
          <p className="text-xs text-navy-400 dark:text-gray-500 mb-4">Crea uno para empezar a registrar el cierre de quincena.</p>
          <button onClick={() => setCreateOpen(true)} className="btn-primary text-sm">
            <Plus size={14} /> Crear primer período
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
          {/* Sidebar de períodos */}
          <aside className="bg-card border border-surface-200 dark:border-dark-300 rounded-xl overflow-hidden">
            <div className="px-3 py-2 bg-surface-50 dark:bg-dark-200/40 border-b border-surface-200 dark:border-dark-300 text-[10px] font-display font-semibold text-navy-500 dark:text-gray-400 uppercase tracking-wider">
              Períodos ({periods.length})
            </div>
            <div className="max-h-[600px] overflow-y-auto">
              {periods.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSelectedId(p.id)}
                  className={`w-full text-left px-3 py-2.5 border-b border-surface-100 dark:border-dark-300/40 transition-colors ${
                    p.id === selectedId
                      ? 'bg-blue-50 dark:bg-blue-900/30 border-l-4 border-l-blue-500'
                      : 'hover:bg-surface-50 dark:hover:bg-dark-200/30'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-mono font-bold text-navy-500 dark:text-gray-400">PD-{String(p.numericId).padStart(4, '0')}</span>
                    {p.status === 'closed' ? (
                      <span className="badge text-[9px] badge-gray inline-flex items-center gap-0.5">
                        <Lock size={9} /> Cerrado
                      </span>
                    ) : (
                      <span className="badge text-[9px] badge-green inline-flex items-center gap-0.5">
                        <Unlock size={9} /> Abierto
                      </span>
                    )}
                  </div>
                  <div className="text-sm font-display font-semibold text-navy-900 dark:text-gray-100 mt-0.5 truncate">{p.name}</div>
                  <div className="text-[10px] text-navy-400 dark:text-gray-500 mt-0.5 font-mono">
                    ${fmtMoney(p.grandTotal)} · {p.employees.length} {p.employees.length === 1 ? 'empleado' : 'empleados'}
                  </div>
                </button>
              ))}
            </div>
          </aside>

          {/* Panel principal */}
          <main className="bg-card border border-surface-200 dark:border-dark-300 rounded-xl overflow-hidden">
            {!draft ? (
              <div className="p-10 text-center text-navy-400">Seleccioná un período de la izquierda.</div>
            ) : (
              <>
                {/* Header del período */}
                <div className="px-4 py-3 bg-surface-50 dark:bg-dark-200/40 border-b border-surface-200 dark:border-dark-300 flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-bold text-navy-500 dark:text-gray-400">PD-{String(draft.numericId).padStart(4, '0')}</span>
                      <h2 className="text-base font-display font-bold text-navy-900 dark:text-gray-100">{draft.name}</h2>
                      {readOnly ? (
                        <span className="badge text-[10px] badge-gray inline-flex items-center gap-1">
                          <Lock size={10} /> Cerrado (solo lectura)
                        </span>
                      ) : (
                        <span className="badge text-[10px] badge-green inline-flex items-center gap-1">
                          <Unlock size={10} /> Editable
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-navy-500 dark:text-gray-400 mt-0.5">
                      Del {draft.startDate.split('-').reverse().join('/')} al {draft.endDate.split('-').reverse().join('/')}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {!readOnly && (
                      <button onClick={handleSave} disabled={saving} className="btn-secondary text-xs">
                        {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                        Guardar
                      </button>
                    )}
                    <button onClick={handlePrint} className="btn-secondary text-xs">
                      <Printer size={13} /> PDF
                    </button>
                    {readOnly ? (
                      <button onClick={handleReopen} className="btn-secondary text-xs">
                        <Unlock size={13} /> Reabrir
                      </button>
                    ) : (
                      <button onClick={handleClose} className="btn-secondary text-xs">
                        <Lock size={13} /> Cerrar
                      </button>
                    )}
                    <button onClick={handleDelete} className="btn-ghost p-1.5 text-navy-400 hover:text-red-600" title="Borrar período">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {/* Selector "Agregar empleado" */}
                {!readOnly && availableEmployees.length > 0 && (
                  <div className="px-4 py-2 bg-blue-50/40 dark:bg-blue-900/10 border-b border-surface-200 dark:border-dark-300 flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-display font-semibold text-navy-500 dark:text-gray-400 uppercase">Agregar:</span>
                    {availableEmployees.map((e) => (
                      <button
                        key={e.id}
                        onClick={() => addEmployeeToPeriod(e.id, e.name)}
                        className="text-[11px] px-2 py-0.5 rounded-md bg-white dark:bg-dark-300 border border-surface-200 dark:border-dark-400 hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                      >
                        <Plus size={10} className="inline -mt-0.5 mr-0.5" />
                        {e.name}
                      </button>
                    ))}
                  </div>
                )}

                {/* Lista de empleados */}
                <div className="divide-y divide-surface-100 dark:divide-dark-300/40">
                  {draft.employees.length === 0 ? (
                    <div className="p-10 text-center">
                      <AlertCircle size={28} className="mx-auto text-amber-400 mb-2" />
                      <p className="text-sm text-navy-500 dark:text-gray-400">Este período no tiene empleados aún.</p>
                      {!readOnly && (
                        <p className="text-xs text-navy-400 dark:text-gray-500 mt-1">
                          Agregalos desde la barra de arriba.
                        </p>
                      )}
                    </div>
                  ) : (
                    draft.employees.map((emp) => {
                      const expanded = expandedEmps.has(emp.employeeId);
                      const computedTotal = calcEmployeeTotal(emp);
                      return (
                        <div key={emp.employeeId}>
                          {/* Header empleado */}
                          <button
                            onClick={() => toggleExpanded(emp.employeeId)}
                            className="w-full px-4 py-3 flex items-center justify-between hover:bg-surface-50/60 dark:hover:bg-dark-200/30 transition-colors"
                          >
                            <div className="flex items-center gap-2">
                              {expanded ? <ChevronDown size={16} className="text-navy-400" /> : <ChevronRight size={16} className="text-navy-400" />}
                              <span className="font-display font-bold text-sm text-navy-900 dark:text-gray-100 uppercase tracking-wide">{emp.employeeName}</span>
                              <span className="text-[10px] text-navy-400">({emp.items.length} {emp.items.length === 1 ? 'concepto' : 'conceptos'})</span>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className={`font-mono font-bold text-sm ${computedTotal < 0 ? 'text-red-600' : 'text-emerald-600 dark:text-emerald-400'}`}>
                                ${fmtMoney(computedTotal)}
                              </span>
                              {!readOnly && (
                                <span
                                  onClick={(e) => { e.stopPropagation(); removeEmployee(emp.employeeId); }}
                                  className="p-1 text-navy-300 hover:text-red-500 cursor-pointer"
                                  title="Quitar empleado del período"
                                >
                                  <XIcon size={14} />
                                </span>
                              )}
                            </div>
                          </button>

                          {/* Detalle: tabla de items */}
                          {expanded && (
                            <div className="px-4 pb-4 space-y-2 bg-surface-50/30 dark:bg-dark-200/20">
                              {emp.items.length > 0 && (
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="text-left text-[10px] font-display font-semibold text-navy-500 dark:text-gray-400 uppercase">
                                      <th className="px-2 py-1.5">Concepto</th>
                                      <th className="px-2 py-1.5 text-right w-20">Cant.</th>
                                      <th className="px-2 py-1.5 text-right w-24">Unit.</th>
                                      <th className="px-2 py-1.5 text-right w-28">Monto</th>
                                      <th className="px-2 py-1.5 text-center w-20">Descuento</th>
                                      <th className="w-10"></th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {emp.items.map((item) => (
                                      <tr key={item.id} className="border-t border-surface-100 dark:border-dark-300/40">
                                        <td className="px-2 py-1">
                                          <input
                                            type="text"
                                            value={item.label}
                                            onChange={(e) => patchItem(emp.employeeId, item.id, { label: e.target.value })}
                                            placeholder="Ej: Días laborados"
                                            disabled={readOnly}
                                            className="w-full text-xs px-2 py-1 rounded border border-surface-200 dark:border-dark-400 bg-white dark:bg-dark-300 text-navy-800 dark:text-gray-100 focus:border-blue-400 focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed"
                                          />
                                        </td>
                                        <td className="px-2 py-1">
                                          <input
                                            type="number"
                                            step="0.01"
                                            value={item.quantity ?? ''}
                                            onChange={(e) => {
                                              const v = e.target.value === '' ? undefined : parseFloat(e.target.value);
                                              patchItem(emp.employeeId, item.id, { quantity: v });
                                            }}
                                            placeholder="—"
                                            disabled={readOnly}
                                            className="w-full text-xs px-1.5 py-1 rounded border border-surface-200 dark:border-dark-400 bg-white dark:bg-dark-300 text-navy-800 dark:text-gray-100 text-right font-mono focus:border-blue-400 focus:outline-none disabled:opacity-60"
                                          />
                                        </td>
                                        <td className="px-2 py-1">
                                          <input
                                            type="number"
                                            step="0.01"
                                            value={item.unitPrice ?? ''}
                                            onChange={(e) => {
                                              const v = e.target.value === '' ? undefined : parseFloat(e.target.value);
                                              patchItem(emp.employeeId, item.id, { unitPrice: v });
                                            }}
                                            placeholder="—"
                                            disabled={readOnly}
                                            className="w-full text-xs px-1.5 py-1 rounded border border-surface-200 dark:border-dark-400 bg-white dark:bg-dark-300 text-navy-800 dark:text-gray-100 text-right font-mono focus:border-blue-400 focus:outline-none disabled:opacity-60"
                                          />
                                        </td>
                                        <td className="px-2 py-1">
                                          <div className="relative">
                                            <input
                                              type="number"
                                              step="0.01"
                                              value={item.amount}
                                              onChange={(e) => patchItem(emp.employeeId, item.id, { amount: parseFloat(e.target.value) || 0 })}
                                              disabled={readOnly}
                                              className={`w-full text-xs pl-5 pr-1.5 py-1 rounded border bg-white dark:bg-dark-300 text-right font-mono font-bold focus:outline-none disabled:opacity-60 ${
                                                item.isDeduction
                                                  ? 'border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 focus:border-red-500'
                                                  : 'border-surface-200 dark:border-dark-400 text-navy-800 dark:text-gray-100 focus:border-blue-400'
                                              }`}
                                            />
                                            <span className={`absolute left-1.5 top-1/2 -translate-y-1/2 text-[10px] font-mono ${item.isDeduction ? 'text-red-500' : 'text-navy-400'}`}>$</span>
                                          </div>
                                        </td>
                                        <td className="px-2 py-1 text-center">
                                          <input
                                            type="checkbox"
                                            checked={item.isDeduction}
                                            onChange={(e) => patchItem(emp.employeeId, item.id, { isDeduction: e.target.checked })}
                                            disabled={readOnly}
                                            className="rounded text-red-500 focus:ring-red-400 disabled:opacity-60 cursor-pointer"
                                            title="Marcar como descuento (resta del total)"
                                          />
                                        </td>
                                        <td className="px-1 py-1">
                                          {!readOnly && (
                                            <button
                                              onClick={() => removeItem(emp.employeeId, item.id)}
                                              className="text-navy-300 hover:text-red-500 p-1"
                                              title="Quitar concepto"
                                            >
                                              <Trash2 size={12} />
                                            </button>
                                          )}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}

                              {!readOnly && (
                                <button
                                  onClick={() => addItem(emp.employeeId)}
                                  className="text-xs text-blue-600 hover:text-blue-700 font-display font-medium inline-flex items-center gap-1 mt-1"
                                >
                                  <Plus size={12} /> Agregar concepto
                                </button>
                              )}

                              {/* Observación */}
                              <div className="mt-2">
                                <label className="block text-[10px] font-display font-semibold text-navy-400 uppercase mb-0.5">Observación (opcional)</label>
                                <textarea
                                  value={emp.note || ''}
                                  onChange={(e) => setEmployeeNote(emp.employeeId, e.target.value)}
                                  disabled={readOnly}
                                  placeholder="Notas internas: motivo de descuentos, retención, etc."
                                  rows={2}
                                  className="w-full text-xs px-2 py-1.5 rounded border border-surface-200 dark:border-dark-400 bg-white dark:bg-dark-300 text-navy-800 dark:text-gray-100 focus:border-blue-400 focus:outline-none disabled:opacity-60 resize-none"
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Total general */}
                <div className="px-4 py-4 bg-navy-900 dark:bg-dark-200 text-white flex items-center justify-between border-t-2 border-navy-700 dark:border-dark-400">
                  <div className="flex items-center gap-2">
                    <Calculator size={18} className="text-blue-400" />
                    <span className="font-display font-bold text-sm uppercase tracking-wide">Total General del Período</span>
                  </div>
                  <span className={`font-mono font-bold text-2xl ${draft.grandTotal < 0 ? 'text-red-400' : 'text-emerald-300'}`}>
                    ${fmtMoney(draft.grandTotal)}
                  </span>
                </div>
              </>
            )}
          </main>
        </div>
      )}

      {/* Modal de creación */}
      {createOpen && (
        <CreatePeriodModal
          onClose={() => setCreateOpen(false)}
          onCreated={async (newId) => {
            setCreateOpen(false);
            await reload();
            setSelectedId(newId);
          }}
        />
      )}
    </div>
  );
}

// ════════════════════════════════════════════════
// MODAL: CREAR PERÍODO
// ════════════════════════════════════════════════
function CreatePeriodModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const currentUser = useAppStore((s) => s.currentUser);
  const employees = useAppStore((s) => s.employees);
  const toast = useToast();

  const defaults = useMemo(() => defaultPeriodDates(), []);
  const [name, setName] = useState(defaults.name);
  const [startDate, setStartDate] = useState(defaults.startDate);
  const [endDate, setEndDate] = useState(defaults.endDate);
  const [selectedEmpIds, setSelectedEmpIds] = useState<Set<string>>(() => new Set((employees || []).filter((e: any) => e.activo !== false).map((e: any) => e.id)));
  const [creating, setCreating] = useState(false);

  function toggleEmp(id: string) {
    setSelectedEmpIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleCreate() {
    if (!name.trim()) { toast.warning('El nombre es obligatorio.'); return; }
    if (!startDate || !endDate) { toast.warning('Las fechas son obligatorias.'); return; }
    if (startDate > endDate) { toast.warning('La fecha de inicio debe ser anterior a la de fin.'); return; }

    setCreating(true);
    try {
      const initialEmployees = (employees || [])
        .filter((e: any) => selectedEmpIds.has(e.id))
        .map((e: any) => ({ employeeId: e.id, employeeName: `${e.nombre} ${e.apellido || ''}`.trim() }));
      const newId = await createPeriod({ name, startDate, endDate, initialEmployees, currentUser });
      toast.success(`Período "${name}" creado.`);
      onCreated(newId);
    } catch (e: any) {
      toast.error(e?.message || 'Error al crear el período.');
    } finally {
      setCreating(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Nuevo Período de Nómina" size="md">
      <div className="space-y-3">
        <div>
          <label className="block text-[10px] font-display font-semibold text-navy-400 uppercase mb-1">Nombre del período</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input-field text-sm"
            placeholder="Ej: Quincena 1 - Mayo 2026"
            autoFocus
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-display font-semibold text-navy-400 uppercase mb-1">Desde</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="input-field text-sm" />
          </div>
          <div>
            <label className="block text-[10px] font-display font-semibold text-navy-400 uppercase mb-1">Hasta</label>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="input-field text-sm" />
          </div>
        </div>
        <div>
          <label className="block text-[10px] font-display font-semibold text-navy-400 uppercase mb-1">
            Empleados a incluir ({selectedEmpIds.size} de {(employees || []).filter((e: any) => e.activo !== false).length})
          </label>
          <div className="max-h-48 overflow-y-auto border border-surface-200 dark:border-dark-300 rounded-lg divide-y divide-surface-100 dark:divide-dark-300/40">
            {(employees || []).filter((e: any) => e.activo !== false).map((e: any) => (
              <label key={e.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-surface-50 dark:hover:bg-dark-200/30 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedEmpIds.has(e.id)}
                  onChange={() => toggleEmp(e.id)}
                  className="rounded text-blue-500 focus:ring-blue-400"
                />
                <span className="text-sm text-navy-700 dark:text-gray-300">{e.nombre} {e.apellido}</span>
              </label>
            ))}
            {(employees || []).filter((e: any) => e.activo !== false).length === 0 && (
              <div className="px-3 py-4 text-center text-xs text-navy-400">
                No hay empleados activos. Agregalos desde el módulo de Nómina.
              </div>
            )}
          </div>
          <p className="text-[10px] text-navy-400 mt-1">
            Podés agregar/quitar empleados después al período si hace falta.
          </p>
        </div>
        <div className="flex justify-end gap-2 pt-3 border-t border-surface-200 dark:border-dark-300">
          <button onClick={onClose} className="btn-secondary text-sm">Cancelar</button>
          <button onClick={handleCreate} disabled={creating} className="btn-primary text-sm">
            {creating ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
            Crear período
          </button>
        </div>
      </div>
    </Modal>
  );
}
