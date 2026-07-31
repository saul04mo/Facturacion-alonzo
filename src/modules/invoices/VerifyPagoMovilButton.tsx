import { useState } from 'react';
import { validarCreditoBancario, type BanescoTransaction } from '@/services/banescoService';
import { ShieldCheck, Loader2, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import { BanescoMatchDetails } from '@/components/BanescoMatchDetails';

/**
 * Botón de verificación de un pago recibido (pago móvil o transferencia
 * bancaria) contra Banesco para una factura
 * ya emitida. Consulta por la referencia registrada en el pago y la fecha
 * de la factura; muestra el resultado inline.
 *
 * Es solo informativo — no modifica la factura ni el pago. Reutiliza el
 * mismo microservicio (Cloud Run) que el resto de la app.
 */

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'found'; match: BanescoTransaction; reviewed: number }
  | { status: 'notfound'; reviewed: number }
  | { status: 'error'; message: string };

export function VerifyPagoMovilButton({
  referenceNumber,
  date,
}: {
  referenceNumber: string;
  date: Date;
}) {
  const [state, setState] = useState<State>({ status: 'idle' });

  async function verify() {
    setState({ status: 'loading' });
    try {
      // Solo por referencia (no se valida el monto).
      const result = await validarCreditoBancario({ referenceNumber, date });
      if (result.found && result.match) {
        setState({ status: 'found', match: result.match, reviewed: result.reviewed });
      } else {
        setState({ status: 'notfound', reviewed: result.reviewed });
      }
    } catch (err: any) {
      setState({ status: 'error', message: err?.message || 'No se pudo verificar.' });
    }
  }

  return (
    <div className="mt-1.5 space-y-1.5">
      <button
        type="button"
        onClick={verify}
        disabled={state.status === 'loading'}
        className="flex items-center gap-1.5 text-[11px] font-display font-semibold px-2 py-1 rounded-md border border-blue-300 text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-50 transition-colors dark:bg-blue-900/20 dark:border-blue-800/40 dark:text-blue-300"
      >
        {state.status === 'loading'
          ? (<><Loader2 size={12} className="animate-spin" /> Verificando…</>)
          : (<><ShieldCheck size={12} /> Verificar en Banesco</>)}
      </button>

      {state.status === 'found' && (
        <div className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-2 py-1.5">
          <div className="flex items-center gap-1.5 font-display font-semibold mb-1">
            <CheckCircle2 size={13} className="shrink-0" /> Pago encontrado
          </div>
          <BanescoMatchDetails match={state.match} />
        </div>
      )}
      {state.status === 'notfound' && (
        <div className="flex items-start gap-1.5 text-[11px] text-accent-red bg-red-50 border border-red-200 rounded-md px-2 py-1.5">
          <XCircle size={13} className="mt-0.5 shrink-0" />
          <span>No se encontró un crédito con esa referencia en la fecha (se revisaron {state.reviewed}). Verificá la fecha del pago.</span>
        </div>
      )}
      {state.status === 'error' && (
        <div className="flex items-start gap-1.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5">
          <AlertCircle size={13} className="mt-0.5 shrink-0" />
          <span>{state.message}</span>
        </div>
      )}
    </div>
  );
}
