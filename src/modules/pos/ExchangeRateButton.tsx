import { useState } from 'react';
import { useAppStore } from '@/store/appStore';
import { useCurrency } from '@/hooks/useCurrency';
import { usePermissions } from '@/hooks/usePermissions';
import { useToast } from '@/components/Toast';
import { updateExchangeRate } from '@/modules/invoices/invoiceService';
import { getFunctions, httpsCallable } from 'firebase/functions';
import {
  DollarSign, TrendingUp, RefreshCw, Check, Zap, AlertTriangle, X, Pencil,
} from 'lucide-react';

/**
 * Edición de la tasa de cambio desde el panel de ventas.
 *
 * Misma operación que Configuración → Tasa de Cambio, pero al alcance del
 * cajero: la tasa se ve todo el tiempo en el header y se corrige sin salir
 * de la venta en curso. Escribe en el mismo doc (config/exchangeRate), así
 * que el cambio se propaga a todo el sistema.
 */

function ExchangeRateModal({ onClose }: { onClose: () => void }) {
  const { can } = usePermissions();
  const toast = useToast();
  const currentUser = useAppStore((s) => s.currentUser);
  const { exchangeRate } = useCurrency();

  const [newRate, setNewRate] = useState(String(exchangeRate));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [fetchingBcv, setFetchingBcv] = useState(false);

  const parsed = parseFloat(newRate);
  const rateChanged = parsed !== exchangeRate;
  const validPreview = rateChanged && !isNaN(parsed) && parsed > 0;

  async function handleUpdateRate() {
    if (isNaN(parsed) || parsed <= 0) return toast.warning('Tasa inválida.');
    setSaving(true); setSaved(false);
    try {
      const userName = currentUser ? `${currentUser.nombre} ${currentUser.apellido}`.trim() : 'POS';
      await updateExchangeRate(parsed, userName);
      setSaved(true);
      toast.success(`Tasa actualizada: Bs. ${parsed.toFixed(2)}`);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      toast.error('Error al actualizar tasa.');
    } finally {
      setSaving(false);
    }
  }

  async function handleFetchBcv() {
    setFetchingBcv(true);
    try {
      const functions = getFunctions();
      const refreshRate = httpsCallable(functions, 'refreshBcvRate');
      const result = await refreshRate();
      const data = result.data as { rate: number; updatedAt: string };
      setNewRate(String(data.rate));
      toast.success(`Tasa BCV actualizada: Bs. ${data.rate.toFixed(2)}`);
    } catch (err: any) {
      console.error('BCV fetch error:', err);
      toast.error(err?.message || 'No se pudo obtener la tasa BCV. Intenta más tarde.');
    } finally {
      setFetchingBcv(false);
    }
  }

  return (
    <div onClick={onClose}
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-navy-900/40 backdrop-blur-sm animate-fade-up">
      <div className="card w-full max-w-md p-5 relative" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose}
          className="absolute top-3 right-3 p-1.5 rounded-lg text-navy-400 hover:text-navy-700 hover:bg-surface-100 transition-colors">
          <X size={18} />
        </button>

        <div className="flex items-center gap-2 mb-1">
          <DollarSign size={18} className="text-emerald-500" />
          <h2 className="font-display font-bold text-navy-900 dark:text-gray-100 text-base">Tasa de Cambio</h2>
        </div>
        <p className="text-xs text-navy-400 dark:text-gray-500 mb-4">
          Tasa USD → Bolívares. El cambio se aplica en todo el sistema.
        </p>

        <div className="space-y-4">
          <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/40 rounded-xl p-4 text-center">
            <p className="text-[10px] font-display font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">Tasa actual</p>
            <p className="text-3xl font-mono font-bold text-emerald-700 dark:text-emerald-300 mt-1">{exchangeRate.toFixed(2)}</p>
            <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">Bs. por cada 1 USD</p>
          </div>

          {can('canUpdateExchangeRate') ? (
            <>
              <button onClick={handleFetchBcv} disabled={fetchingBcv}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-xl font-display font-semibold text-sm transition-colors">
                {fetchingBcv ? (
                  <><RefreshCw size={16} className="animate-spin" /> Consultando BCV...</>
                ) : (
                  <><Zap size={16} /> Obtener Tasa BCV Automática</>
                )}
              </button>

              <div className="space-y-3">
                <label className="block text-sm font-display font-medium text-navy-700 dark:text-gray-300">Nueva tasa</label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <TrendingUp size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-navy-300 dark:text-gray-500" />
                    <input type="number" step="0.01" value={newRate} autoFocus
                      onChange={(e) => { setNewRate(e.target.value); setSaved(false); }}
                      onKeyDown={(e) => e.key === 'Enter' && rateChanged && handleUpdateRate()}
                      className="input-field pl-10 font-mono text-lg" />
                  </div>
                  <button onClick={handleUpdateRate} disabled={saving || !rateChanged}
                    className={`btn-primary px-5 ${saved ? '!bg-emerald-600' : ''}`}>
                    {saving ? <><RefreshCw size={16} className="animate-spin" /> Guardando...</> :
                      saved ? <><Check size={16} /> Guardado</> : <><RefreshCw size={16} /> Actualizar</>}
                  </button>
                </div>

                {validPreview && (
                  <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/40 rounded-lg p-3 animate-fade-up">
                    <p className="text-xs text-blue-700 dark:text-blue-300 font-display">
                      <span className="font-semibold">Vista previa:</span>{' '}
                      $1 = Bs. {parsed.toFixed(2)} · $10 = Bs. {(parsed * 10).toFixed(2)} · $100 = Bs. {(parsed * 100).toFixed(2)}
                    </p>
                  </div>
                )}

                {saved && (
                  <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/40 rounded-lg p-3 animate-fade-up">
                    <p className="text-xs text-emerald-700 dark:text-emerald-300 font-display flex items-center gap-2">
                      <Check size={14} /> Tasa actualizada en todo el sistema.
                    </p>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 rounded-lg p-4 flex items-start gap-3">
              <AlertTriangle size={18} className="text-amber-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-display font-semibold text-amber-800 dark:text-amber-300">Sin permiso</p>
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">Contacta a un administrador para cambiar la tasa.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function ExchangeRateButton() {
  const [open, setOpen] = useState(false);
  const { exchangeRate } = useCurrency();

  return (
    <>
      <button onClick={() => setOpen(true)}
        title="Ver o editar la tasa de cambio"
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-700 text-xs font-display font-semibold hover:bg-emerald-100 transition-colors dark:bg-emerald-900/20 dark:border-emerald-800/40 dark:text-emerald-300">
        <DollarSign size={14} />
        <span className="font-mono">Bs. {exchangeRate.toFixed(2)}</span>
      </button>
      {open && <ExchangeRateModal onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * Versión grande para el área del catálogo: la tasa se lee de un vistazo
 * desde lejos y se edita con un toque, sin depender del chip del header.
 */
export function ExchangeRateCard() {
  const [open, setOpen] = useState(false);
  const { exchangeRate } = useCurrency();

  return (
    <>
      <button onClick={() => setOpen(true)}
        title="Ver o editar la tasa de cambio"
        className="card-hover w-full max-w-sm mx-auto p-5 flex items-center gap-4 text-left animate-fade-up transition-all hover:scale-[1.01]">
        <div className="w-12 h-12 rounded-2xl bg-emerald-50 dark:bg-emerald-900/30 flex items-center justify-center flex-shrink-0">
          <DollarSign size={24} className="text-emerald-600 dark:text-emerald-400" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-display font-semibold text-navy-400 dark:text-gray-500 uppercase tracking-wider">
            Tasa de cambio
          </p>
          <p className="text-2xl font-mono font-bold text-emerald-700 dark:text-emerald-300 leading-tight">
            Bs. {exchangeRate.toFixed(2)}
          </p>
          <p className="text-[11px] text-navy-400 dark:text-gray-500">por cada 1 USD · toca para editar</p>
        </div>
        <Pencil size={16} className="text-navy-300 dark:text-gray-600 flex-shrink-0" />
      </button>
      {open && <ExchangeRateModal onClose={() => setOpen(false)} />}
    </>
  );
}
