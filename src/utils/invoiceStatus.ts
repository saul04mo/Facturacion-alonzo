/**
 * Helpers centralizados para el estado de las facturas.
 *
 * Mantener acá toda la lógica de "qué estados cuentan como venta válida",
 * "cuál es el siguiente estado del flujo", y la configuración visual del
 * badge, evita inconsistencias entre paneles (Facturas, Dashboard,
 * Informes, Publicidad, Comisiones, Delivery, CRM, etc).
 */

import type { InvoiceStatus } from '@/types';

/**
 * Estados que cuentan como "venta confirmada" para reportes, dashboards,
 * comisiones y cálculo de publicidad.
 *
 * Incluye los tres estados del flujo de preparación porque desde el
 * momento en que se crea la venta ya entró la plata o se generó deuda
 * — la preparación es un proceso interno logístico, no afecta si
 * contablemente fue venta.
 *
 * 'Pendiente de pago' también cuenta (venta a crédito en curso).
 * 'Devolución' / 'Cancelado' / 'Creada' NO cuentan.
 */
export function isCountableSale(status: InvoiceStatus): boolean {
  return (
    status === 'Por Preparar' ||
    status === 'Preparado' ||
    status === 'Finalizado' ||
    status === 'Pendiente de pago'
  );
}

/**
 * Devuelve el siguiente estado del flujo de preparación, o null si la
 * factura no está en el flujo (estado terminal o de excepción).
 */
export function nextStatusInFlow(status: InvoiceStatus): InvoiceStatus | null {
  if (status === 'Por Preparar') return 'Preparado';
  if (status === 'Preparado') return 'Finalizado';
  return null;
}

/** Verbo corto para el botón que avanza al siguiente estado. */
export function advanceLabel(status: InvoiceStatus): string | null {
  if (status === 'Por Preparar') return 'Marcar Preparado';
  if (status === 'Preparado') return 'Finalizar';
  return null;
}

/**
 * Configuración visual del badge por estado. Se usa en todos los
 * paneles para mantener una paleta consistente.
 *
 * 'class' apunta a las clases CSS de badge ya definidas en index.css
 * (badge-red, badge-amber, badge-green, badge-blue, badge-gray).
 *
 * 'tailwindBg' / 'tailwindText' es la versión Tailwind directa para
 * componentes que no usan las clases badge-* (ej. DashboardPage,
 * CRMPage que arman su propio chip inline).
 */
export const STATUS_CONFIG: Record<
  InvoiceStatus,
  {
    class: string;
    label: string;
    tailwindBg: string;
    tailwindText: string;
  }
> = {
  'Por Preparar': {
    class: 'badge-red',
    label: 'Por Preparar',
    tailwindBg: 'bg-red-100 dark:bg-red-900/30',
    tailwindText: 'text-red-700 dark:text-red-300',
  },
  Preparado: {
    class: 'badge-amber',
    label: 'Preparado',
    tailwindBg: 'bg-amber-100 dark:bg-amber-900/30',
    tailwindText: 'text-amber-700 dark:text-amber-300',
  },
  Finalizado: {
    class: 'badge-green',
    label: 'Finalizado',
    tailwindBg: 'bg-emerald-100 dark:bg-emerald-900/30',
    tailwindText: 'text-emerald-700 dark:text-emerald-300',
  },
  'Pendiente de pago': {
    class: 'badge-amber',
    label: 'Pendiente de pago',
    tailwindBg: 'bg-amber-100 dark:bg-amber-900/30',
    tailwindText: 'text-amber-700 dark:text-amber-300',
  },
  Devolución: {
    class: 'badge-blue',
    label: 'Devolución',
    tailwindBg: 'bg-blue-100 dark:bg-blue-900/30',
    tailwindText: 'text-blue-700 dark:text-blue-300',
  },
  Cancelado: {
    class: 'badge-gray',
    label: 'Cancelado',
    tailwindBg: 'bg-gray-100 dark:bg-gray-700',
    tailwindText: 'text-gray-700 dark:text-gray-300',
  },
  Creada: {
    class: 'badge-gray',
    label: 'Creada',
    tailwindBg: 'bg-gray-100 dark:bg-gray-700',
    tailwindText: 'text-gray-700 dark:text-gray-300',
  },
};
