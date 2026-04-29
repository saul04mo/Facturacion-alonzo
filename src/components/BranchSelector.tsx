/**
 * Selector de sucursal (Tienda / Almacén) usado en el POS.
 *
 * Diseño: botón compacto con icono + label + chevron, abre un dropdown
 * con las dos opciones. Click en una opción la selecciona y cierra.
 *
 * Bloqueo de cambio: si hay items en el carrito y el usuario intenta
 * cambiar la sucursal, muestra confirm() preguntando si quiere vaciar
 * el carrito. Esto evita inconsistencias (un item del carrito que se
 * "vendió" desde tienda no puede aparecer luego como vendido desde
 * almacén — descontaríamos del stock equivocado).
 */

import { useState, useRef, useEffect } from 'react';
import { Store, Warehouse, ChevronDown, Check } from 'lucide-react';
import type { Branch } from '@/types';

interface BranchSelectorProps {
  value: Branch;
  onChange: (b: Branch) => void;
  /** Si true, pide confirmación antes de cambiar (cuando hay carrito). */
  requireConfirm?: boolean;
  /** Mensaje del confirm. Default: 'Hay items en el carrito. ¿Vaciar y cambiar de sucursal?' */
  confirmMessage?: string;
  className?: string;
  /** Compact: oculta el label en pantallas chicas (md+ lo muestra). */
  compact?: boolean;
}

const OPTIONS: { value: Branch; label: string; icon: React.ReactNode; color: string }[] = [
  { value: 'store', label: 'Tienda', icon: <Store size={14} />, color: 'emerald' },
  { value: 'warehouse', label: 'Almacén', icon: <Warehouse size={14} />, color: 'blue' },
];

export function BranchSelector({
  value,
  onChange,
  requireConfirm = false,
  confirmMessage = 'Hay items en el carrito. ¿Vaciar y cambiar de sucursal?',
  className = '',
  compact = false,
}: BranchSelectorProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = OPTIONS.find((o) => o.value === value) || OPTIONS[0];

  // Click fuera cierra el dropdown
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  function handlePick(branch: Branch) {
    if (branch !== value && requireConfirm) {
      const ok = window.confirm(confirmMessage);
      if (!ok) {
        setOpen(false);
        return;
      }
    }
    onChange(branch);
    setOpen(false);
  }

  const colorClass = current.color === 'emerald'
    ? 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/20 dark:border-emerald-800/40 dark:text-emerald-300'
    : 'border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-900/20 dark:border-blue-800/40 dark:text-blue-300';

  return (
    <div ref={ref} className={`relative inline-block ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-display font-semibold transition-colors ${colorClass}`}
      >
        {current.icon}
        <span className={compact ? 'hidden md:inline' : ''}>{current.label}</span>
        <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-48 bg-white dark:bg-dark-card rounded-lg shadow-modal border border-surface-200 dark:border-dark-border overflow-hidden animate-fade-up">
          <div className="px-3 py-2 border-b border-surface-100 dark:border-dark-border">
            <p className="text-[10px] font-display font-bold text-navy-400 dark:text-gray-500 uppercase tracking-wide">
              Sucursal de Venta
            </p>
          </div>
          {OPTIONS.map((opt) => {
            const isActive = opt.value === value;
            return (
              <button
                key={opt.value}
                onClick={() => handlePick(opt.value)}
                className={`w-full flex items-center gap-2 px-3 py-2.5 text-sm font-display transition-colors text-left ${
                  isActive
                    ? 'bg-surface-50 dark:bg-dark-200 text-navy-900 dark:text-gray-100 font-semibold'
                    : 'text-navy-600 dark:text-gray-400 hover:bg-surface-50 dark:hover:bg-dark-200'
                }`}
              >
                <span className={opt.color === 'emerald' ? 'text-emerald-600' : 'text-blue-600'}>
                  {opt.icon}
                </span>
                <span className="flex-1">{opt.label}</span>
                {isActive && <Check size={14} className="text-emerald-600" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
