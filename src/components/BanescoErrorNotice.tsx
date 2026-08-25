import { Landmark, WifiOff, ServerOff, KeyRound, AlertTriangle, RefreshCw } from 'lucide-react';
import { toBanescoError, type BanescoFailureKind } from '@/services/banescoService';

/**
 * Aviso unificado para las fallas de consulta contra Banesco.
 *
 * Existe para que el cajero no vea "El validador respondió 503" y concluya
 * que el pago no llegó. Cuando la consulta no se pudo hacer, el resultado es
 * *desconocido*, no negativo — por eso estas fallas nunca se muestran en rojo
 * de "no encontrado": el rojo queda reservado para lo que sí exige acción
 * (credenciales vencidas, servicio mal configurado).
 */

type Tone = 'warn' | 'alert';

const TONE_CLASSES: Record<Tone, string> = {
  warn: 'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-900/20 dark:border-amber-800/40',
  alert: 'text-accent-red bg-red-50 border-red-200 dark:text-red-300 dark:bg-red-900/20 dark:border-red-800/40',
};

/** Ícono por categoría: de un vistazo se ve de quién es el problema. */
function iconFor(kind: BanescoFailureKind) {
  switch (kind) {
    case 'bank_unavailable':
    case 'bank_timeout':
    case 'bank_error':
    case 'rate_limited':
      return Landmark;
    case 'network':
      return WifiOff;
    case 'validator_offline':
    case 'validator_error':
    case 'timeout':
      return ServerOff;
    case 'bank_auth':
    case 'not_configured':
      return KeyRound;
    default:
      return AlertTriangle;
  }
}

/** Encabezado corto que nombra al culpable. */
function titleFor(kind: BanescoFailureKind): string {
  switch (kind) {
    case 'bank_unavailable':
    case 'bank_timeout':
    case 'bank_error':
      return 'Banesco no responde';
    case 'rate_limited':
      return 'Demasiadas consultas';
    case 'network':
      return 'Sin conexión';
    case 'validator_offline':
    case 'validator_error':
    case 'timeout':
      return 'Validador no disponible';
    case 'bank_auth':
    case 'not_configured':
      return 'Validador mal configurado';
    case 'bank_rejected':
    case 'bad_request':
      return 'Consulta rechazada';
    default:
      return 'No se pudo validar';
  }
}

export function BanescoErrorNotice({
  error,
  onRetry,
  size = 'md',
  label,
}: {
  /** Cualquier excepción: se normaliza acá. */
  error: unknown;
  /** Si se pasa, se muestra el botón de reintento en las fallas transitorias. */
  onRetry?: () => void;
  size?: 'sm' | 'md';
  /** Prefijo opcional, p. ej. el método de pago en el panel de cobro. */
  label?: string;
}) {
  const err = toBanescoError(error);
  // Rojo solo cuando hace falta que alguien intervenga; el resto es transitorio.
  const tone: Tone = err.retryable ? 'warn' : 'alert';
  const Icon = iconFor(err.kind);
  const sm = size === 'sm';

  // Rastro técnico para soporte: distingue el HTTP del validador del que
  // devolvió Banesco, que es justo lo que se pierde en un mensaje genérico.
  const trace = [
    err.httpStatus ? `validador ${err.httpStatus}` : null,
    err.upstreamStatus ? `banesco ${err.upstreamStatus}` : null,
    err.kind,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div
      className={`rounded-md border px-2.5 py-2 ${TONE_CLASSES[tone]} ${sm ? 'text-[11px]' : 'text-xs'}`}
      role="status"
    >
      <div className="flex items-start gap-1.5">
        <Icon size={sm ? 13 : 14} className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="font-display font-semibold">
            {label ? `${label}: ` : ''}
            {titleFor(err.kind)}
          </div>
          <p className="mt-0.5 opacity-90">{err.message}</p>
          {err.hint && <p className="mt-0.5 opacity-75">{err.hint}</p>}

          <div className="mt-1.5 flex items-center gap-2 flex-wrap">
            {onRetry && err.retryable && (
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex items-center gap-1 font-display font-semibold underline underline-offset-2 hover:no-underline"
              >
                <RefreshCw size={sm ? 11 : 12} /> Reintentar
              </button>
            )}
            {trace && <span className="font-mono opacity-50 text-[10px] truncate">{trace}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
