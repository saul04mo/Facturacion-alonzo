import { useState, useMemo } from 'react';
import { useAppStore } from '@/store/appStore';
import { useToast } from '@/components/Toast';
import { Modal } from '@/components/Modal';
import { receiveTransfer } from './transferService';
import type { InventoryTransfer } from '@/types';
import { CheckCircle2, AlertTriangle, Truck } from 'lucide-react';

export function ReceiveTransferModal({
  transfer,
  onClose,
  onReceived,
}: {
  transfer: InventoryTransfer;
  onClose: () => void;
  onReceived: () => void;
}) {
  const products = useAppStore((s) => s.products);
  const currentUser = useAppStore((s) => s.currentUser);
  const toast = useToast();

  // Cantidades editables — arrancan iguales a quantitySent (recepción completa por defecto)
  const [received, setReceived] = useState<Record<number, number>>(() => {
    const obj: Record<number, number> = {};
    transfer.items.forEach((item, idx) => {
      obj[idx] = item.quantitySent;
    });
    return obj;
  });
  const [submitting, setSubmitting] = useState(false);

  const totalSent = useMemo(() => transfer.items.reduce((a, i) => a + i.quantitySent, 0), [transfer]);
  const totalReceived = useMemo(() => Object.values(received).reduce((a, b) => a + b, 0), [received]);
  const hasDiscrepancy = totalReceived !== totalSent;

  function updateReceived(idx: number, value: number) {
    if (value < 0) value = 0;
    const max = transfer.items[idx].quantitySent;
    if (value > max) value = max;
    setReceived((prev) => ({ ...prev, [idx]: value }));
  }

  async function handleSubmit() {
    if (!currentUser) {
      toast.error('Usuario no identificado.');
      return;
    }
    if (hasDiscrepancy) {
      const ok = window.confirm(
        `Hay una diferencia entre lo enviado (${totalSent}) y lo recibido (${totalReceived}).\n\n` +
        `La diferencia (${totalSent - totalReceived} unidades) se contabilizará como merma en tránsito y NO volverá al origen.\n\n` +
        `¿Confirmar recepción con esta diferencia?`
      );
      if (!ok) return;
    }

    setSubmitting(true);
    try {
      await receiveTransfer({
        transferId: transfer.id,
        products,
        currentUser,
        receivedQuantities: received,
      });
      const receiverName = `${currentUser.nombre} ${currentUser.apellido}`;
      const destLabel = transfer.to === 'store' ? 'tienda' : 'almacén';
      toast.success(`TR-${transfer.numericId} recibida por ${receiverName} — stock agregado a ${destLabel}.`);
      onReceived();
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || 'Error al recibir la transferencia.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Confirmar recepción — TR-${transfer.numericId}`} size="md">
      <div className="space-y-4">
        {/* Header info */}
        <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
          <Truck size={14} className="text-blue-500" />
          <p className="text-xs text-blue-700 dark:text-blue-300">
            Confirmá las cantidades realmente recibidas. Si todo llegó completo, dejá los valores tal cual y hacé click en confirmar.
          </p>
        </div>

        {/* Foto del despacho (referencia) */}
        {transfer.proofUrl && (
          <details className="text-xs">
            <summary className="cursor-pointer text-navy-500 dark:text-gray-400 hover:text-navy-700 font-display">
              Ver foto del despacho original
            </summary>
            <img src={transfer.proofUrl} alt="Despacho" className="mt-2 max-w-md rounded-lg border border-surface-200 dark:border-dark-300" />
          </details>
        )}

        {/* Tabla de items */}
        <div className="border border-surface-200 dark:border-dark-300 rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-surface-50 dark:bg-dark-200/40">
              <tr>
                <th className="text-left px-3 py-2 font-display font-semibold text-navy-500">Producto</th>
                <th className="text-left px-3 py-2 font-display font-semibold text-navy-500 w-16">Talla</th>
                <th className="text-left px-3 py-2 font-display font-semibold text-navy-500 w-24">Color</th>
                <th className="text-right px-3 py-2 font-display font-semibold text-navy-500 w-20">Enviado</th>
                <th className="text-right px-3 py-2 font-display font-semibold text-navy-500 w-24">Recibido</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100 dark:divide-dark-300/40">
              {transfer.items.map((item, idx) => {
                const recv = received[idx] ?? item.quantitySent;
                const isDiff = recv !== item.quantitySent;
                return (
                  <tr key={idx}>
                    <td className="px-3 py-2 text-navy-900 dark:text-gray-200 truncate">{item.productName}</td>
                    <td className="px-3 py-2 font-mono text-navy-700 dark:text-gray-300">{item.size}</td>
                    <td className="px-3 py-2 text-navy-600 dark:text-gray-400 truncate">{item.color}</td>
                    <td className="px-3 py-2 text-right font-mono text-navy-500">{item.quantitySent}</td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min="0"
                        max={item.quantitySent}
                        value={recv}
                        onChange={(e) => updateReceived(idx, parseInt(e.target.value) || 0)}
                        className={`input-field text-xs py-1 px-2 w-20 text-right font-mono ${isDiff ? 'border-amber-400 bg-amber-50 dark:bg-amber-900/20' : ''}`}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-surface-50 dark:bg-dark-200/40">
              <tr>
                <td colSpan={3} className="px-3 py-2 text-right font-display font-semibold text-navy-500">Total</td>
                <td className="px-3 py-2 text-right font-mono font-bold text-navy-900 dark:text-gray-100">{totalSent}</td>
                <td className="px-3 py-2 text-right font-mono font-bold">
                  <span className={hasDiscrepancy ? 'text-amber-700' : 'text-emerald-700'}>{totalReceived}</span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Discrepancia warning */}
        {hasDiscrepancy && (
          <div className="bg-amber-50/60 dark:bg-amber-900/20 rounded-lg p-3 flex items-start gap-2 border border-amber-200 dark:border-amber-800/40">
            <AlertTriangle size={16} className="text-amber-500 flex-shrink-0 mt-0.5" />
            <div className="text-xs">
              <p className="font-display font-semibold text-amber-700 dark:text-amber-300">Diferencia detectada</p>
              <p className="text-amber-600 dark:text-amber-400 mt-0.5">
                Faltan <strong>{totalSent - totalReceived}</strong> unidades respecto a lo enviado.
                Estas unidades se contabilizarán como <strong>merma en tránsito</strong> y NO regresan al origen.
                Solo confirmá si efectivamente perdiste esas unidades en el camino.
              </p>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex justify-end gap-2 pt-2 border-t border-surface-200 dark:border-dark-300">
          <button onClick={onClose} className="btn-ghost text-sm" type="button">Cancelar</button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="btn-primary text-sm"
            type="button"
          >
            <CheckCircle2 size={14} />
            {submitting ? 'Procesando…' : hasDiscrepancy ? 'Confirmar con diferencia' : 'Confirmar recepción'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
