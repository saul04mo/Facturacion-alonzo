import { useState, useMemo, useEffect } from 'react';
import { useAppStore } from '@/store/appStore';
import { useToast } from '@/components/Toast';
import { Modal } from '@/components/Modal';
import { Timestamp } from 'firebase/firestore';
import {
  Users, Calculator, AlertTriangle, FileText, Plus, Trash2, Edit, Search,
  Check, Loader2, Printer,
  UserMinus, Clock,
} from 'lucide-react';
import type { Employee, EmployeeIncident, PayrollPeriod, PayrollReceipt, IncidentType } from '@/types';
import {
  addEmployee, updateEmployee, deactivateEmployee,
  addIncident, deleteIncident, getIncidentsForPeriod,
  createPeriod, getPayrollPeriods,
  saveReceipts, getReceiptsForPeriod, markPeriodPaid,
} from './payrollService';
import { calculatePayroll, buildReceipt, countMondaysInMonth, type PeriodConfig } from './payrollEngine';
import { printPayrollReceipt } from './payrollReceiptPdf';
import { todayVE } from '@/utils/dateUtils';

type Tab = 'empleados' | 'nomina' | 'incidencias' | 'recibos';

const INCIDENT_LABELS: Record<IncidentType, string> = {
  falta: 'Falta',
  hora_extra_diurna: 'Hora Extra Diurna',
  hora_extra_nocturna: 'Hora Extra Nocturna',
  reposo: 'Reposo',
  feriado_trabajado: 'Feriado Trabajado',
  bono_nocturno: 'Bono Nocturno',
  permiso: 'Permiso',
};

const EMPTY_EMPLOYEE: Omit<Employee, 'id'> = {
  nombre: '', apellido: '', cedula: '', phone: '', email: '', direccion: '',
  fechaNacimiento: '', cargo: '', departamento: '', fechaIngreso: todayVE(),
  tipoContrato: 'fijo', jornadaLaboral: 'diurna', estado: 'activo',
  salarioBaseVed: 0, bonificacionUsd: 0, cuentaBancaria: '', banco: '', numIvss: '',
};

export function PayrollPage() {
  const employees = useAppStore((s) => s.employees);
  const currentUser = useAppStore((s) => s.currentUser);
  const exchangeRate = useAppStore((s) => s.exchangeRate);
  const toast = useToast();

  const [tab, setTab] = useState<Tab>('empleados');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);

  // Employee modal
  const [showEmpModal, setShowEmpModal] = useState(false);
  const [editEmp, setEditEmp] = useState<Partial<Employee>>(EMPTY_EMPLOYEE);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Incident modal
  const [showIncModal, setShowIncModal] = useState(false);
  const [incForm, setIncForm] = useState({ employeeId: '', tipo: 'hora_extra_diurna' as IncidentType, fecha: todayVE(), cantidad: 1, observacion: '' });

  // Payroll
  const [periods, setPeriods] = useState<PayrollPeriod[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState<PayrollPeriod | null>(null);
  const [incidents, setIncidents] = useState<EmployeeIncident[]>([]);
  const [receipts, setReceipts] = useState<PayrollReceipt[]>([]);

  // New period form
  const [showPeriodModal, setShowPeriodModal] = useState(false);
  const [periodForm, setPeriodForm] = useState({
    tipo: 'mensual' as 'semanal' | 'quincenal' | 'mensual',
    fechaInicio: todayVE().slice(0, 8) + '01',
    fechaFin: todayVE(),
    tasaBcv: exchangeRate,
    salarioMinimoVed: 130,
    cestaticketDiario: 40,
    diasUtilidades: 60,
  });

  // Load periods
  useEffect(() => {
    getPayrollPeriods().then(setPeriods).catch(console.error);
  }, []);

  // Load incidents & receipts when period selected
  useEffect(() => {
    if (!selectedPeriod) { setIncidents([]); setReceipts([]); return; }
    getIncidentsForPeriod(selectedPeriod.fechaInicio, selectedPeriod.fechaFin).then(setIncidents);
    getReceiptsForPeriod(selectedPeriod.id).then(setReceipts);
  }, [selectedPeriod]);

  const activeEmployees = useMemo(() => employees.filter((e) => e.estado !== 'egresado'), [employees]);

  const filteredEmployees = useMemo(() => {
    if (!search) return employees;
    const s = search.toLowerCase();
    return employees.filter((e) =>
      `${e.nombre} ${e.apellido}`.toLowerCase().includes(s) || e.cedula.includes(s) || e.cargo.toLowerCase().includes(s)
    );
  }, [employees, search]);

  // KPIs
  const kpis = useMemo(() => ({
    total: employees.length,
    activos: employees.filter((e) => e.estado === 'activo').length,
    reposo: employees.filter((e) => e.estado === 'reposo').length,
    egresados: employees.filter((e) => e.estado === 'egresado').length,
  }), [employees]);

  // ==================== Handlers ====================

  async function handleSaveEmployee() {
    if (!editEmp.nombre || !editEmp.apellido || !editEmp.cedula) return toast.warning('Complete los campos obligatorios.');
    setLoading(true);
    try {
      if (editingId) {
        await updateEmployee(editingId, editEmp);
      } else {
        await addEmployee(editEmp as Omit<Employee, 'id'>);
      }
      setShowEmpModal(false);
      setEditEmp(EMPTY_EMPLOYEE);
      setEditingId(null);
      toast.success(editingId ? 'Empleado actualizado.' : 'Empleado registrado.');
    } catch (err) {
      console.error(err);
      toast.error('Error al guardar empleado.');
    } finally {
      setLoading(false);
    }
  }

  async function handleDeactivate(emp: Employee) {
    if (!confirm(`¿Dar de baja a ${emp.nombre} ${emp.apellido}?`)) return;
    await deactivateEmployee(emp.id);
    toast.success('Empleado dado de baja.');
  }

  async function handleSaveIncident() {
    if (!incForm.employeeId) return toast.warning('Seleccione un empleado.');
    setLoading(true);
    try {
      await addIncident({
        ...incForm,
        creadoPor: currentUser?.uid || '',
        fechaCreacion: Timestamp.now(),
      });
      setShowIncModal(false);
      if (selectedPeriod) {
        const updated = await getIncidentsForPeriod(selectedPeriod.fechaInicio, selectedPeriod.fechaFin);
        setIncidents(updated);
      }
      toast.success('Incidencia registrada.');
    } catch (err) {
      console.error(err);
      toast.error('Error al registrar incidencia.');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreatePeriod() {
    setLoading(true);
    try {
      const startDate = new Date(periodForm.fechaInicio);
      const lunesDelMes = countMondaysInMonth(startDate.getFullYear(), startDate.getMonth());
      const id = await createPeriod({
        tipo: periodForm.tipo,
        fechaInicio: periodForm.fechaInicio,
        fechaFin: periodForm.fechaFin,
        estado: 'borrador',
        tasaBcv: periodForm.tasaBcv,
        salarioMinimoVed: periodForm.salarioMinimoVed,
        cestaticketDiario: periodForm.cestaticketDiario,
        lunesDelMes,
        totalAsignaciones: 0, totalDeducciones: 0, totalNeto: 0,
        creadoPor: currentUser?.uid || '',
        fecha: Timestamp.now(),
      } as Omit<PayrollPeriod, 'id'>);
      const newPeriods = await getPayrollPeriods();
      setPeriods(newPeriods);
      setSelectedPeriod(newPeriods.find((p) => p.id === id) || null);
      setShowPeriodModal(false);
      toast.success('Período creado.');
    } catch (err) {
      console.error(err);
      toast.error('Error al crear período.');
    } finally {
      setLoading(false);
    }
  }

  async function handleCalculatePayroll() {
    if (!selectedPeriod) return;
    if (activeEmployees.length === 0) return toast.warning('No hay empleados activos.');
    setLoading(true);
    try {
      const startDate = new Date(selectedPeriod.fechaInicio);
      const config: PeriodConfig = {
        tipo: selectedPeriod.tipo,
        fechaInicio: selectedPeriod.fechaInicio,
        fechaFin: selectedPeriod.fechaFin,
        tasaBcv: selectedPeriod.tasaBcv,
        salarioMinimoVed: selectedPeriod.salarioMinimoVed,
        cestaticketDiario: selectedPeriod.cestaticketDiario,
        lunesDelMes: selectedPeriod.lunesDelMes || countMondaysInMonth(startDate.getFullYear(), startDate.getMonth()),
        diasUtilidades: periodForm.diasUtilidades,
      };

      const allReceipts: Omit<PayrollReceipt, 'id'>[] = [];
      let totA = 0, totD = 0, totN = 0;

      activeEmployees.forEach((emp) => {
        const calc = calculatePayroll(emp, incidents, config);
        const receipt = buildReceipt(emp, calc, selectedPeriod.id, selectedPeriod.tasaBcv);
        allReceipts.push(receipt);
        totA += calc.totalAsignaciones;
        totD += calc.totalDeducciones;
        totN += calc.netoAPagar;
      });

      await saveReceipts(selectedPeriod.id, allReceipts, {
        totalAsignaciones: Math.round(totA * 100) / 100,
        totalDeducciones: Math.round(totD * 100) / 100,
        totalNeto: Math.round(totN * 100) / 100,
      });

      const updatedPeriods = await getPayrollPeriods();
      setPeriods(updatedPeriods);
      setSelectedPeriod(updatedPeriods.find((p) => p.id === selectedPeriod.id) || null);
      const updatedReceipts = await getReceiptsForPeriod(selectedPeriod.id);
      setReceipts(updatedReceipts);
      toast.success(`Nómina calculada: ${allReceipts.length} recibos generados.`);
    } catch (err) {
      console.error(err);
      toast.error('Error al calcular nómina.');
    } finally {
      setLoading(false);
    }
  }

  function getPeriodLabel(p: PayrollPeriod): string {
    return `${p.tipo.charAt(0).toUpperCase() + p.tipo.slice(1)} | ${p.fechaInicio} → ${p.fechaFin}`;
  }

  // ==================== RENDER ====================
  const TABS: { key: Tab; label: string; icon: any }[] = [
    { key: 'empleados', label: 'Empleados', icon: Users },
    { key: 'nomina', label: 'Nómina', icon: Calculator },
    { key: 'incidencias', label: 'Incidencias', icon: AlertTriangle },
    { key: 'recibos', label: 'Recibos', icon: FileText },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-navy-900">Nómina & RRHH</h1>
          <p className="text-sm text-navy-400 font-display">Gestión de empleados, nómina e incidencias laborales</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-surface-200 pb-0">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-display font-medium border-b-2 transition-colors
              ${tab === t.key ? 'border-teal-500 text-teal-600' : 'border-transparent text-navy-400 hover:text-navy-600'}`}>
            <t.icon size={16} /> {t.label}
          </button>
        ))}
      </div>

      {/* =================== TAB: EMPLEADOS =================== */}
      {tab === 'empleados' && (
        <div className="space-y-4">
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { l: 'Total', v: kpis.total, c: 'text-navy-900', icon: Users },
              { l: 'Activos', v: kpis.activos, c: 'text-emerald-600', icon: Check },
              { l: 'En Reposo', v: kpis.reposo, c: 'text-amber-600', icon: Clock },
              { l: 'Egresados', v: kpis.egresados, c: 'text-navy-400', icon: UserMinus },
            ].map((k) => (
              <div key={k.l} className="card p-4 hover-lift">
                <div className="flex items-center gap-2 mb-1">
                  <k.icon size={14} className="text-navy-300" />
                  <p className="text-[10px] font-display font-semibold text-navy-400 uppercase">{k.l}</p>
                </div>
                <p className={`text-2xl font-mono font-bold ${k.c}`}>{k.v}</p>
              </div>
            ))}
          </div>

          {/* Toolbar */}
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
            <div className="relative flex-1 max-w-sm">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-navy-300" />
              <input value={search} onChange={(e) => setSearch(e.target.value)}
                className="input-field pl-9 text-sm" placeholder="Buscar por nombre, cédula o cargo..." />
            </div>
            <button onClick={() => { setEditEmp(EMPTY_EMPLOYEE); setEditingId(null); setShowEmpModal(true); }}
              className="btn-primary gap-2 text-sm"><Plus size={14} /> Agregar Empleado</button>
          </div>

          {/* Table */}
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr className="border-b border-surface-200 bg-surface-50">
                  {['Nombre', 'Cédula', 'Cargo', 'Depto.', 'Jornada', 'Salario (Bs)', 'Bono USD', 'Estado', 'Acciones'].map((h) => (
                    <th key={h} className="text-left text-[10px] font-display font-semibold text-navy-400 uppercase tracking-wider px-4 py-3 whitespace-nowrap">{h}</th>
                  ))}
                </tr></thead>
                <tbody className="divide-y divide-surface-100">
                  {filteredEmployees.map((emp) => (
                    <tr key={emp.id} className="hover:bg-surface-50 transition-colors hover-lift">
                      <td className="px-4 py-3 text-sm font-display font-medium text-navy-900 whitespace-nowrap">{emp.nombre} {emp.apellido}</td>
                      <td className="px-4 py-3 text-sm font-mono text-navy-500">{emp.cedula}</td>
                      <td className="px-4 py-3 text-sm text-navy-500">{emp.cargo}</td>
                      <td className="px-4 py-3 text-xs text-navy-400">{emp.departamento}</td>
                      <td className="px-4 py-3 text-xs text-navy-400 capitalize">{emp.jornadaLaboral}</td>
                      <td className="px-4 py-3 font-mono text-sm text-navy-900">{emp.salarioBaseVed.toLocaleString('es-VE', { minimumFractionDigits: 2 })}</td>
                      <td className="px-4 py-3 font-mono text-sm text-emerald-600">${emp.bonificacionUsd.toFixed(2)}</td>
                      <td className="px-4 py-3">
                        <span className={`badge ${emp.estado === 'activo' ? 'badge-green' : emp.estado === 'reposo' ? 'badge-amber' : emp.estado === 'vacaciones' ? 'badge-blue' : 'badge-gray'}`}>
                          {emp.estado}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <button onClick={() => { setEditEmp(emp); setEditingId(emp.id); setShowEmpModal(true); }}
                            className="btn-ghost p-1.5 text-navy-400 hover:text-blue-600"><Edit size={14} /></button>
                          {emp.estado !== 'egresado' && (
                            <button onClick={() => handleDeactivate(emp)}
                              className="btn-ghost p-1.5 text-navy-400 hover:text-accent-red"><UserMinus size={14} /></button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filteredEmployees.length === 0 && (
              <div className="p-12 text-center"><Users size={40} className="mx-auto text-navy-200 mb-3" /><p className="text-navy-400 text-sm">Sin empleados registrados.</p></div>
            )}
          </div>
        </div>
      )}

      {/* =================== TAB: NÓMINA =================== */}
      {tab === 'nomina' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
            <div className="flex items-center gap-3 flex-1">
              <select value={selectedPeriod?.id || ''} onChange={(e) => setSelectedPeriod(periods.find((p) => p.id === e.target.value) || null)}
                className="input-field text-sm max-w-md">
                <option value="">— Seleccionar Período —</option>
                {periods.map((p) => <option key={p.id} value={p.id}>{getPeriodLabel(p)} ({p.estado})</option>)}
              </select>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowPeriodModal(true)} className="btn-secondary gap-2 text-sm"><Plus size={14} /> Nuevo Período</button>
              {selectedPeriod && selectedPeriod.estado !== 'pagado' && (
                <button onClick={handleCalculatePayroll} disabled={loading} className="btn-primary gap-2 text-sm">
                  {loading ? <Loader2 size={14} className="animate-spin" /> : <Calculator size={14} />}
                  Calcular Nómina
                </button>
              )}
              {selectedPeriod?.estado === 'calculado' && (
                <button onClick={async () => { await markPeriodPaid(selectedPeriod.id); const p = await getPayrollPeriods(); setPeriods(p); setSelectedPeriod(p.find((x) => x.id === selectedPeriod.id) || null); toast.success('Período marcado como pagado.'); }}
                  className="btn-primary gap-2 text-sm bg-emerald-600 hover:bg-emerald-700"><Check size={14} /> Marcar Pagado</button>
              )}
            </div>
          </div>

          {selectedPeriod && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { l: 'Total Asignaciones', v: selectedPeriod.totalAsignaciones, c: 'text-emerald-600' },
                { l: 'Total Deducciones', v: selectedPeriod.totalDeducciones, c: 'text-accent-red' },
                { l: 'Neto Total', v: selectedPeriod.totalNeto, c: 'text-navy-900' },
                { l: 'Lunes del Mes', v: selectedPeriod.lunesDelMes, c: 'text-blue-600', raw: true },
              ].map((k) => (
                <div key={k.l} className="card p-4 hover-lift">
                  <p className="text-[10px] font-display font-semibold text-navy-400 uppercase">{k.l}</p>
                  <p className={`text-lg font-mono font-bold mt-1 ${k.c}`}>
                    {(k as any).raw ? (k.v as number) : (k.v as number).toLocaleString('es-VE', { minimumFractionDigits: 2 })}
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* Receipts Table for this period */}
          {receipts.length > 0 && (
            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead><tr className="border-b border-surface-200 bg-surface-50">
                    {['Empleado', 'Cédula', 'Cargo', 'Asignaciones', 'Deducciones', 'Neto (Bs)', 'Neto (USD)', 'Acciones'].map((h) => (
                      <th key={h} className="text-left text-[10px] font-display font-semibold text-navy-400 uppercase tracking-wider px-4 py-3 whitespace-nowrap">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody className="divide-y divide-surface-100">
                    {receipts.map((r) => (
                      <tr key={r.id} className="hover:bg-surface-50 transition-colors hover-lift">
                        <td className="px-4 py-3 text-sm font-display font-medium text-navy-900">{r.employeeName}</td>
                        <td className="px-4 py-3 text-sm font-mono text-navy-500">{r.employeeCedula}</td>
                        <td className="px-4 py-3 text-xs text-navy-400">{r.employeeCargo}</td>
                        <td className="px-4 py-3 font-mono text-sm text-emerald-600">{r.totalAsignaciones.toLocaleString('es-VE', { minimumFractionDigits: 2 })}</td>
                        <td className="px-4 py-3 font-mono text-sm text-accent-red">{r.totalDeducciones.toLocaleString('es-VE', { minimumFractionDigits: 2 })}</td>
                        <td className="px-4 py-3 font-mono font-bold text-sm text-navy-900">{r.netoAPagar.toLocaleString('es-VE', { minimumFractionDigits: 2 })}</td>
                        <td className="px-4 py-3 font-mono text-sm text-emerald-600">${r.netoUsd.toFixed(2)}</td>
                        <td className="px-4 py-3">
                          <button onClick={() => selectedPeriod && printPayrollReceipt(r, getPeriodLabel(selectedPeriod))}
                            className="btn-ghost p-1.5 text-navy-400 hover:text-blue-600"><Printer size={14} /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* =================== TAB: INCIDENCIAS =================== */}
      {tab === 'incidencias' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-navy-500">
              {selectedPeriod
                ? `Incidencias del período ${selectedPeriod.fechaInicio} → ${selectedPeriod.fechaFin}`
                : 'Seleccione un período en la pestaña Nómina para ver incidencias.'
              }
            </p>
            <button onClick={() => setShowIncModal(true)} className="btn-primary gap-2 text-sm"><Plus size={14} /> Registrar Incidencia</button>
          </div>

          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr className="border-b border-surface-200 bg-surface-50">
                  {['Empleado', 'Tipo', 'Fecha', 'Cantidad', 'Observación', 'Acciones'].map((h) => (
                    <th key={h} className="text-left text-[10px] font-display font-semibold text-navy-400 uppercase tracking-wider px-4 py-3">{h}</th>
                  ))}
                </tr></thead>
                <tbody className="divide-y divide-surface-100">
                  {incidents.map((inc) => {
                    const emp = employees.find((e) => e.id === inc.employeeId);
                    return (
                      <tr key={inc.id} className="hover:bg-surface-50 transition-colors hover-lift">
                        <td className="px-4 py-3 text-sm font-display font-medium text-navy-900">{emp ? `${emp.nombre} ${emp.apellido}` : inc.employeeId}</td>
                        <td className="px-4 py-3 text-sm text-navy-500">{INCIDENT_LABELS[inc.tipo] || inc.tipo}</td>
                        <td className="px-4 py-3 text-sm font-mono text-navy-500">{inc.fecha}</td>
                        <td className="px-4 py-3 font-mono text-sm text-navy-900">{inc.cantidad}</td>
                        <td className="px-4 py-3 text-xs text-navy-400">{inc.observacion || '—'}</td>
                        <td className="px-4 py-3">
                          <button onClick={async () => { await deleteIncident(inc.id); if (selectedPeriod) setIncidents(await getIncidentsForPeriod(selectedPeriod.fechaInicio, selectedPeriod.fechaFin)); }}
                            className="btn-ghost p-1.5 text-navy-400 hover:text-accent-red"><Trash2 size={14} /></button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {incidents.length === 0 && (
              <div className="p-12 text-center"><AlertTriangle size={40} className="mx-auto text-navy-200 mb-3" /><p className="text-navy-400 text-sm">Sin incidencias registradas.</p></div>
            )}
          </div>
        </div>
      )}

      {/* =================== TAB: RECIBOS =================== */}
      {tab === 'recibos' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <select value={selectedPeriod?.id || ''} onChange={(e) => setSelectedPeriod(periods.find((p) => p.id === e.target.value) || null)}
              className="input-field text-sm max-w-md">
              <option value="">— Seleccionar Período —</option>
              {periods.map((p) => <option key={p.id} value={p.id}>{getPeriodLabel(p)}</option>)}
            </select>
          </div>

          {receipts.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {receipts.map((r) => (
                <div key={r.id} className="card p-4 space-y-3 hover-lift">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-display font-bold text-navy-900 text-sm">{r.employeeName}</p>
                      <p className="text-[10px] text-navy-400">{r.employeeCedula} · {r.employeeCargo}</p>
                    </div>
                    <span className={`badge ${r.estado === 'pagado' ? 'badge-green' : 'badge-amber'}`}>{r.estado === 'pagado' ? 'Pagado' : 'Pendiente'}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div><p className="text-[9px] text-navy-400 uppercase">Asignaciones</p><p className="font-mono text-xs font-bold text-emerald-600">{r.totalAsignaciones.toLocaleString('es-VE', { minimumFractionDigits: 2 })}</p></div>
                    <div><p className="text-[9px] text-navy-400 uppercase">Deducciones</p><p className="font-mono text-xs font-bold text-accent-red">{r.totalDeducciones.toLocaleString('es-VE', { minimumFractionDigits: 2 })}</p></div>
                    <div><p className="text-[9px] text-navy-400 uppercase">Neto</p><p className="font-mono text-xs font-bold text-navy-900">{r.netoAPagar.toLocaleString('es-VE', { minimumFractionDigits: 2 })}</p></div>
                  </div>
                  <button onClick={() => selectedPeriod && printPayrollReceipt(r, getPeriodLabel(selectedPeriod))}
                    className="btn-secondary w-full gap-2 text-xs py-2"><Printer size={12} /> Imprimir Recibo</button>
                </div>
              ))}
            </div>
          ) : (
            <div className="card p-12 text-center"><FileText size={40} className="mx-auto text-navy-200 mb-3" /><p className="text-navy-400 text-sm">No hay recibos para este período.</p></div>
          )}
        </div>
      )}

      {/* =================== MODALS =================== */}

      {/* Employee Modal */}
      {showEmpModal && (
        <Modal open onClose={() => setShowEmpModal(false)} title={editingId ? 'Editar Empleado' : 'Nuevo Empleado'} size="lg">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[
              { label: 'Nombre *', key: 'nombre', type: 'text' },
              { label: 'Apellido *', key: 'apellido', type: 'text' },
              { label: 'Cédula *', key: 'cedula', type: 'text' },
              { label: 'Teléfono', key: 'phone', type: 'text' },
              { label: 'Email', key: 'email', type: 'email' },
              { label: 'Dirección', key: 'direccion', type: 'text' },
              { label: 'Fecha de Nacimiento', key: 'fechaNacimiento', type: 'date' },
              { label: 'Cargo', key: 'cargo', type: 'text' },
              { label: 'Departamento', key: 'departamento', type: 'text' },
              { label: 'Fecha de Ingreso', key: 'fechaIngreso', type: 'date' },
              { label: 'Salario Base (Bs)', key: 'salarioBaseVed', type: 'number' },
              { label: 'Bonificación (USD)', key: 'bonificacionUsd', type: 'number' },
              { label: 'Cuenta Bancaria', key: 'cuentaBancaria', type: 'text' },
              { label: 'Banco', key: 'banco', type: 'text' },
              { label: 'Nro. IVSS', key: 'numIvss', type: 'text' },
            ].map((f) => (
              <div key={f.key}>
                <label className="block text-xs font-display font-medium text-navy-700 mb-1">{f.label}</label>
                <input type={f.type} value={(editEmp as any)[f.key] || ''}
                  onChange={(e) => setEditEmp({ ...editEmp, [f.key]: f.type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value })}
                  className="input-field text-sm" />
              </div>
            ))}
            <div>
              <label className="block text-xs font-display font-medium text-navy-700 mb-1">Tipo de Contrato</label>
              <select value={editEmp.tipoContrato || 'fijo'} onChange={(e) => setEditEmp({ ...editEmp, tipoContrato: e.target.value as any })}
                className="input-field text-sm">
                <option value="fijo">Fijo</option><option value="temporal">Temporal</option><option value="pasante">Pasante</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-display font-medium text-navy-700 mb-1">Jornada Laboral</label>
              <select value={editEmp.jornadaLaboral || 'diurna'} onChange={(e) => setEditEmp({ ...editEmp, jornadaLaboral: e.target.value as any })}
                className="input-field text-sm">
                <option value="diurna">Diurna</option><option value="mixta">Mixta</option><option value="nocturna">Nocturna</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-display font-medium text-navy-700 mb-1">Estado</label>
              <select value={editEmp.estado || 'activo'} onChange={(e) => setEditEmp({ ...editEmp, estado: e.target.value as any })}
                className="input-field text-sm">
                <option value="activo">Activo</option><option value="reposo">Reposo</option><option value="vacaciones">Vacaciones</option><option value="egresado">Egresado</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setShowEmpModal(false)} className="btn-secondary">Cancelar</button>
            <button onClick={handleSaveEmployee} disabled={loading} className="btn-primary gap-2">
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              {editingId ? 'Guardar' : 'Registrar'}
            </button>
          </div>
        </Modal>
      )}

      {/* Incident Modal */}
      {showIncModal && (
        <Modal open onClose={() => setShowIncModal(false)} title="Registrar Incidencia">
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-display font-medium text-navy-700 mb-1">Empleado *</label>
              <select value={incForm.employeeId} onChange={(e) => setIncForm({ ...incForm, employeeId: e.target.value })}
                className="input-field text-sm">
                <option value="">— Seleccionar —</option>
                {activeEmployees.map((e) => <option key={e.id} value={e.id}>{e.nombre} {e.apellido}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-display font-medium text-navy-700 mb-1">Tipo</label>
              <select value={incForm.tipo} onChange={(e) => setIncForm({ ...incForm, tipo: e.target.value as IncidentType })}
                className="input-field text-sm">
                {Object.entries(INCIDENT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-display font-medium text-navy-700 mb-1">Fecha</label>
                <input type="date" value={incForm.fecha} onChange={(e) => setIncForm({ ...incForm, fecha: e.target.value })}
                  className="input-field text-sm" />
              </div>
              <div>
                <label className="block text-xs font-display font-medium text-navy-700 mb-1">Cantidad (horas/días)</label>
                <input type="number" value={incForm.cantidad} onChange={(e) => setIncForm({ ...incForm, cantidad: parseFloat(e.target.value) || 0 })}
                  className="input-field text-sm font-mono" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-display font-medium text-navy-700 mb-1">Observación</label>
              <textarea value={incForm.observacion} onChange={(e) => setIncForm({ ...incForm, observacion: e.target.value })}
                className="input-field text-sm" rows={2} />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setShowIncModal(false)} className="btn-secondary">Cancelar</button>
            <button onClick={handleSaveIncident} disabled={loading} className="btn-primary gap-2">
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Registrar
            </button>
          </div>
        </Modal>
      )}

      {/* Period Modal */}
      {showPeriodModal && (
        <Modal open onClose={() => setShowPeriodModal(false)} title="Nuevo Período de Nómina">
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-display font-medium text-navy-700 mb-1">Tipo de Nómina</label>
              <select value={periodForm.tipo} onChange={(e) => setPeriodForm({ ...periodForm, tipo: e.target.value as any })}
                className="input-field text-sm">
                <option value="semanal">Semanal</option><option value="quincenal">Quincenal</option><option value="mensual">Mensual</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-xs font-display font-medium text-navy-700 mb-1">Fecha Inicio</label>
                <input type="date" value={periodForm.fechaInicio} onChange={(e) => setPeriodForm({ ...periodForm, fechaInicio: e.target.value })} className="input-field text-sm" /></div>
              <div><label className="block text-xs font-display font-medium text-navy-700 mb-1">Fecha Fin</label>
                <input type="date" value={periodForm.fechaFin} onChange={(e) => setPeriodForm({ ...periodForm, fechaFin: e.target.value })} className="input-field text-sm" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-xs font-display font-medium text-navy-700 mb-1">Tasa BCV (Bs/$)</label>
                <input type="number" step="0.01" value={periodForm.tasaBcv} onChange={(e) => setPeriodForm({ ...periodForm, tasaBcv: parseFloat(e.target.value) || 0 })} className="input-field text-sm font-mono" /></div>
              <div><label className="block text-xs font-display font-medium text-navy-700 mb-1">Salario Mínimo (Bs)</label>
                <input type="number" value={periodForm.salarioMinimoVed} onChange={(e) => setPeriodForm({ ...periodForm, salarioMinimoVed: parseFloat(e.target.value) || 0 })} className="input-field text-sm font-mono" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-xs font-display font-medium text-navy-700 mb-1">Cestaticket Diario (Bs)</label>
                <input type="number" step="0.01" value={periodForm.cestaticketDiario} onChange={(e) => setPeriodForm({ ...periodForm, cestaticketDiario: parseFloat(e.target.value) || 0 })} className="input-field text-sm font-mono" /></div>
              <div><label className="block text-xs font-display font-medium text-navy-700 mb-1">Días Utilidades (año)</label>
                <input type="number" value={periodForm.diasUtilidades} onChange={(e) => setPeriodForm({ ...periodForm, diasUtilidades: parseInt(e.target.value) || 60 })} className="input-field text-sm font-mono" /></div>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setShowPeriodModal(false)} className="btn-secondary">Cancelar</button>
            <button onClick={handleCreatePeriod} disabled={loading} className="btn-primary gap-2">
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Crear Período
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
