import { useState, useCallback } from 'react';
import { validarPagoMovil, type BanescoTransaction } from '@/services/banescoService';
import { ShieldCheck, Search, Loader2, CheckCircle2, XCircle, AlertCircle, X } from 'lucide-react';

/**
 * Buscador independiente de pagos contra Banesco para el panel de ventas.
 *
 * NO está integrado al flujo de cobro a propósito: validar dentro del
 * checkout agregaría latencia y el negocio necesita velocidad. Esto es
 * solo una herramienta de consulta — el cajero busca una referencia y ve
 * si el pago llegó, sin bloquear la venta.
 */

type SearchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'found'; match: BanescoTransaction; reviewed: number }
  | { status: 'notfound'; reviewed: number }
  | { status: 'error'; message: string };

/** Fecha de hoy en formato YYYY-MM-DD (hora local) para el input date. */
function todayInputValue(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Convierte 'YYYY-MM-DD' a un Date local (evita el corrimiento de zona horaria de new Date(str)). */
function parseLocalDate(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function ValidatePaymentModal({ onClose }: { onClose: () => void }) {
  const [reference, setReference] = useState('');
  const [date, setDate] = useState(todayInputValue);
  const [state, setState] = useState<SearchState>({ status: 'idle' });

  const handleSearch = useCallback(async () => {
    const ref = reference.trim();
    if (!ref) {
      setState({ status: 'error', message: 'Ingresá la referencia del pago.' });
      return;
    }
    setState({ status: 'loading' });
    try {
      // La validación es solo por referencia (no se compara el monto).
      const result = await validarPagoMovil({
        referenceNumber: ref,
        date: parseLocalDate(date),
      });
      if (result.found && result.match) {
        setState({ status: 'found', match: result.match, reviewed: result.reviewed });
      } else {
        setState({ status: 'notfound', reviewed: result.reviewed });
      }
    } catch (err: any) {
      setState({ status: 'error', message: err?.message || 'No se pudo consultar Banesco.' });
    }
  }, [reference, date]);

  return (
    <div onClick={onClose}
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-navy-900/40 backdrop-blur-sm animate-fade-up">
      <div className="card w-full max-w-md p-5 relative" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose}
          className="absolute top-3 right-3 p-1.5 rounded-lg text-navy-400 hover:text-navy-700 hover:bg-surface-100 transition-colors">
          <X size={18} />
        </button>

        <div className="flex items-center gap-2 mb-1">
          <ShieldCheck size={18} className="text-blue-600" />
          <h2 className="font-display font-bold text-navy-900 text-base">Validar pago en Banesco</h2>
        </div>
        <p className="text-xs text-navy-400 mb-4">
          Consulta si un pago móvil llegó a la cuenta. No afecta la venta en curso.
        </p>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-display font-medium text-navy-600 mb-1 block">
              Referencia <span className="text-accent-red">*</span>
            </label>
            <input value={reference}
              onChange={(e) => { setReference(e.target.value); setState({ status: 'idle' }); }}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              autoFocus placeholder="Ej: 050206" className="input-field text-sm font-mono" />
          </div>

          <div>
            <label className="text-xs font-display font-medium text-navy-600 mb-1 block">Fecha</label>
            <input value={date} onChange={(e) => setDate(e.target.value)}
              type="date" className="input-field text-sm" />
          </div>

          <button onClick={handleSearch} disabled={state.status === 'loading' || !reference.trim()}
            className="btn-primary w-full py-2.5">
            {state.status === 'loading'
              ? (<><Loader2 size={16} className="animate-spin" /> Buscando...</>)
              : (<><Search size={16} /> Buscar pago</>)}
          </button>

          {state.status === 'found' && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
              <div className="flex items-center gap-1.5 text-emerald-700 font-display font-semibold mb-1.5">
                <CheckCircle2 size={16} /> Pago encontrado
              </div>
              <dl className="space-y-1 text-xs text-navy-700">
                <div className="flex justify-between"><dt className="text-navy-500">Monto</dt><dd className="font-mono font-semibold">Bs {state.match.amount.toLocaleString('es-VE', { minimumFractionDigits: 2 })}</dd></div>
                <div className="flex justify-between"><dt className="text-navy-500">Referencia</dt><dd className="font-mono">{state.match.referenceNumber}</dd></div>
                <div className="flex justify-between"><dt className="text-navy-500">Fecha</dt><dd className="font-mono">{state.match.trnDate} {state.match.trnTime?.trim()}</dd></div>
                <div className="flex justify-between"><dt className="text-navy-500">Concepto</dt><dd className="text-right">{state.match.concept?.trim()}</dd></div>
              </dl>
            </div>
          )}

          {state.status === 'notfound' && (
            <div className="flex items-start gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-accent-red">
              <XCircle size={15} className="mt-0.5 shrink-0" />
              <span>No se encontró un crédito con esa referencia. Se revisaron {state.reviewed} pago(s) recibido(s) en la fecha. Verificá la fecha o la referencia.</span>
            </div>
          )}

          {state.status === 'error' && (
            <div className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-700">
              <AlertCircle size={15} className="mt-0.5 shrink-0" />
              <span>{state.message}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function ValidatePaymentButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}
        title="Validar un pago en Banesco"
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-blue-300 bg-blue-50 text-blue-700 text-xs font-display font-semibold hover:bg-blue-100 transition-colors dark:bg-blue-900/20 dark:border-blue-800/40 dark:text-blue-300">
        <ShieldCheck size={14} />
        <span className="hidden sm:inline">Validar pago</span>
      </button>
      {open && <ValidatePaymentModal onClose={() => setOpen(false)} />}
    </>
  );
}
