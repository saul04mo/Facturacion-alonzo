/**
 * Motor de Cálculo de Nómina — Legislación Laboral Venezolana (LOTTT)
 *
 * Fórmulas:
 *  - Salario Diario = salarioBaseVed / 30
 *  - Salario Semanal = salarioBaseVed / 4.33
 *  - Hora Extra Diurna = (salarioDiario / 8) × 1.50
 *  - Hora Extra Nocturna = (salarioDiario / 8) × 1.80
 *  - Bono Nocturno = (salarioDiario / 8) × 0.30 × horas
 *  - Feriado Trabajado = salarioDiario × 1.50
 *  - IVSS (trabajador) = salarioSemanal × 0.04 × lunesDelMes
 *  - FAOV = salarioSemanal × 0.01 × lunesDelMes
 *  - RPE  = salarioSemanal × 0.005 × lunesDelMes
 *  - INCES = utilidades × 0.005
 */

import type { Employee, EmployeeIncident, PayrollReceipt } from '@/types';
import { Timestamp } from 'firebase/firestore';

// ================================
// Helpers
// ================================

/** Count Mondays in a given month/year */
export function countMondaysInMonth(year: number, month: number): number {
  let count = 0;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    if (new Date(year, month, d).getDay() === 1) count++;
  }
  return count;
}

/** Count business (working) days between two dates (Mon-Fri) */
export function countBusinessDays(start: string, end: string): number {
  const s = new Date(start + 'T00:00:00');
  const e = new Date(end + 'T23:59:59');
  let count = 0;
  const current = new Date(s);
  while (current <= e) {
    const day = current.getDay();
    if (day >= 1 && day <= 5) count++;
    current.setDate(current.getDate() + 1);
  }
  return count;
}

/** Years of service for an employee */
export function yearsOfService(fechaIngreso: string): number {
  const start = new Date(fechaIngreso);
  const now = new Date();
  return Math.max(0, Math.floor((now.getTime() - start.getTime()) / (365.25 * 24 * 60 * 60 * 1000)));
}

// ================================
// Period config
// ================================
export interface PeriodConfig {
  tipo: 'semanal' | 'quincenal' | 'mensual';
  fechaInicio: string;
  fechaFin: string;
  tasaBcv: number;
  salarioMinimoVed: number;
  cestaticketDiario: number;
  lunesDelMes: number;
  diasUtilidades: number; // 30-120 days/year set by company
}

// ================================
// Calculation Result
// ================================
export interface CalcResult {
  salarioBase: number;
  cestaticket: number;
  horasExtrasDiurnas: number;
  horasExtrasNocturnas: number;
  bonoNocturno: number;
  feriadosTrabajados: number;
  bonoVacacional: number;
  utilidades: number;
  bonificacionUsd: number;
  otrasAsignaciones: number;
  totalAsignaciones: number;
  ivss: number;
  faov: number;
  rpe: number;
  inces: number;
  otrasDeducciones: number;
  totalDeducciones: number;
  netoAPagar: number;
  netoUsd: number;
}

// ================================
// Main Calculation
// ================================
export function calculatePayroll(
  employee: Employee,
  incidents: EmployeeIncident[],
  config: PeriodConfig
): CalcResult {
  const { tasaBcv, cestaticketDiario, lunesDelMes, diasUtilidades } = config;

  // Proportional factor for the period
  const periodDays = countBusinessDays(config.fechaInicio, config.fechaFin);
  const factor = config.tipo === 'mensual' ? 1 : config.tipo === 'quincenal' ? 0.5 : 7 / 30;

  // Base calculations
  const salarioDiario = employee.salarioBaseVed / 30;
  const salarioSemanal = employee.salarioBaseVed / 4.33;
  const salarioBase = employee.salarioBaseVed * factor;

  // Cestaticket
  const cestaticket = cestaticketDiario * periodDays;

  // Aggregate incidents
  const empIncidents = incidents.filter((i) => i.employeeId === employee.id);
  const horasExDiurnas = empIncidents
    .filter((i) => i.tipo === 'hora_extra_diurna')
    .reduce((sum, i) => sum + i.cantidad, 0);
  const horasExNocturnas = empIncidents
    .filter((i) => i.tipo === 'hora_extra_nocturna')
    .reduce((sum, i) => sum + i.cantidad, 0);
  const horasBonoNocturno = empIncidents
    .filter((i) => i.tipo === 'bono_nocturno')
    .reduce((sum, i) => sum + i.cantidad, 0);
  const diasFeriados = empIncidents
    .filter((i) => i.tipo === 'feriado_trabajado')
    .reduce((sum, i) => sum + i.cantidad, 0);
  const diasFaltas = empIncidents
    .filter((i) => i.tipo === 'falta')
    .reduce((sum, i) => sum + i.cantidad, 0);

  // Assignments
  const horasExtrasDiurnas = (salarioDiario / 8) * 1.50 * horasExDiurnas;
  const horasExtrasNocturnas = (salarioDiario / 8) * 1.80 * horasExNocturnas;
  const bonoNocturno = (salarioDiario / 8) * 0.30 * horasBonoNocturno;
  const feriadosTrabajados = salarioDiario * 1.50 * diasFeriados;

  // Bono Vacacional: 15 días + 1 por año de servicio, prorrateado mensual
  const years = yearsOfService(employee.fechaIngreso);
  const diasBonoVac = Math.min(15 + years, 30); // cap at 30
  const bonoVacacional = (salarioDiario * diasBonoVac / 12) * factor;

  // Utilidades: prorrateado mensual (días/12)
  const utilidades = (salarioDiario * Math.min(Math.max(diasUtilidades, 30), 120) / 12) * factor;

  // USD bonus (converted to VED for totals)
  const bonificacionUsdVed = employee.bonificacionUsd * tasaBcv * factor;

  // Deduction for absences
  const descuentoFaltas = salarioDiario * diasFaltas;

  const totalAsignaciones =
    salarioBase + cestaticket + horasExtrasDiurnas + horasExtrasNocturnas +
    bonoNocturno + feriadosTrabajados + bonoVacacional + utilidades + bonificacionUsdVed;

  // Deductions (LOTTT) — based on lunes del mes
  const ivss = salarioSemanal * 0.04 * lunesDelMes * factor;
  const faov = salarioSemanal * 0.01 * lunesDelMes * factor;
  const rpe = salarioSemanal * 0.005 * lunesDelMes * factor;
  const inces = utilidades * 0.005;

  const totalDeducciones = ivss + faov + rpe + inces + descuentoFaltas;

  const netoAPagar = Math.max(0, totalAsignaciones - totalDeducciones);
  const netoUsd = tasaBcv > 0 ? netoAPagar / tasaBcv : 0;

  return {
    salarioBase: round(salarioBase),
    cestaticket: round(cestaticket),
    horasExtrasDiurnas: round(horasExtrasDiurnas),
    horasExtrasNocturnas: round(horasExtrasNocturnas),
    bonoNocturno: round(bonoNocturno),
    feriadosTrabajados: round(feriadosTrabajados),
    bonoVacacional: round(bonoVacacional),
    utilidades: round(utilidades),
    bonificacionUsd: round(bonificacionUsdVed),
    otrasAsignaciones: 0,
    totalAsignaciones: round(totalAsignaciones),
    ivss: round(ivss),
    faov: round(faov),
    rpe: round(rpe),
    inces: round(inces),
    otrasDeducciones: round(descuentoFaltas),
    totalDeducciones: round(totalDeducciones),
    netoAPagar: round(netoAPagar),
    netoUsd: round(netoUsd),
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Build a PayrollReceipt object from calc result + metadata */
export function buildReceipt(
  employee: Employee,
  calc: CalcResult,
  periodId: string,
  tasaBcv: number
): Omit<PayrollReceipt, 'id'> {
  return {
    periodId,
    employeeId: employee.id,
    employeeName: `${employee.nombre} ${employee.apellido}`,
    employeeCedula: employee.cedula,
    employeeCargo: employee.cargo,
    fechaIngreso: employee.fechaIngreso,
    departamento: employee.departamento,
    ...calc,
    tasaBcv,
    estado: 'generado',
    fecha: Timestamp.now(),
  };
}
