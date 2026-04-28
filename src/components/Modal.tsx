import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

export function Modal({ open, onClose, title, children, size = 'md' }: ModalProps) {
  useEffect(() => {
    if (open) {
      // Bloqueamos scroll en body Y en el <main> del Layout (el contenedor
      // que realmente hace scroll en este SPA). Si solo bloquearamos body,
      // el usuario podría seguir scrolleando detrás del modal.
      const main = document.querySelector('main');
      document.body.style.overflow = 'hidden';
      if (main) main.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
        if (main) main.style.overflow = '';
      };
    }
  }, [open]);

  if (!open) return null;

  const widths = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' };

  // Renderizamos en un Portal al body para que el modal escape de cualquier
  // ancestor con overflow/transform/filter que rompería su position:fixed.
  // El Layout tiene <main className="overflow-y-auto"> que es el culpable
  // típico: position:fixed dentro de un overflow ancestor se queda anclado
  // al ancestor scrolleable, no al viewport.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center p-2 sm:p-4 sm:pt-8 animate-fade-in">
      <div className="absolute inset-0 bg-navy-950/20 dark:bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative bg-white dark:bg-dark-card rounded-xl shadow-modal w-full ${widths[size]} max-h-[calc(100vh-4rem)] flex flex-col animate-fade-up`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-200 dark:border-dark-border flex-shrink-0">
          <h2 className="text-lg font-display font-bold text-navy-900 dark:text-gray-100">{title}</h2>
          <button onClick={onClose} className="btn-ghost p-1.5 -mr-1.5">
            <X size={18} />
          </button>
        </div>
        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}
