import { useState, useEffect, useMemo } from 'react';
import { useAppStore } from '@/store/appStore';
import { usePermissions } from '@/hooks/usePermissions';
import { useToast } from '@/components/Toast';
import { Modal } from '@/components/Modal';
import {
  listTransfers,
  shipTransfer,
  cancelTransfer,
} from './transferService';
import { CreateTransferModal } from './CreateTransferModal';
import { ReceiveTransferModal } from './ReceiveTransferModal';
import type { InventoryTransfer, TransferStatus } from '@/types';
import {
  Truck, Plus, RefreshCw, Eye, Send, CheckCircle2, XCircle, Image as ImageIcon,
  Package, Calendar, User, FileText, AlertTriangle, ArrowRight, Clock, Store, Warehouse,
  Printer,
} from 'lucide-react';

const STATUS_BADGES: Record<TransferStatus, { class: string; label: string; icon: React.ReactNode }> = {
  pending:    { class: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',     label: 'Pendiente',  icon: <Clock size={11} /> },
  in_transit: { class: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',          label: 'En tránsito', icon: <Truck size={11} /> },
  received:   { class: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300', label: 'Recibida',  icon: <CheckCircle2 size={11} /> },
  cancelled:  { class: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',              label: 'Cancelada',  icon: <XCircle size={11} /> },
};

export function TransfersPage() {
  const products = useAppStore((s) => s.products);
  const currentUser = useAppStore((s) => s.currentUser);
  const { can } = usePermissions();
  const toast = useToast();

  const [transfers, setTransfers] = useState<InventoryTransfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<TransferStatus | 'all'>('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [receiveTransfer, setReceiveTransfer] = useState<InventoryTransfer | null>(null);
  const [detailTransfer, setDetailTransfer] = useState<InventoryTransfer | null>(null);
  const [proofPreviewUrl, setProofPreviewUrl] = useState<string | null>(null);
  const [actioningId, setActioningId] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const list = await listTransfers();
      setTransfers(list);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || 'Error cargando transferencias.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const filtered = useMemo(() => {
    if (filterStatus === 'all') return transfers;
    return transfers.filter((t) => t.status === filterStatus);
  }, [transfers, filterStatus]);

  // Counts por estado para los chips de filtro
  const counts = useMemo(() => {
    const c: Record<TransferStatus | 'all', number> = {
      all: transfers.length, pending: 0, in_transit: 0, received: 0, cancelled: 0,
    };
    transfers.forEach((t) => { c[t.status]++; });
    return c;
  }, [transfers]);

  async function handleShip(t: InventoryTransfer) {
    if (!currentUser) return;
    if (!window.confirm(`¿Confirmás el envío de la transferencia TR-${t.numericId}?\n\nEsto va a descontar el stock del almacén y marcarlo como "En tránsito".`)) return;
    setActioningId(t.id);
    try {
      await shipTransfer({ transferId: t.id, products, currentUser });
      toast.success(`TR-${t.numericId} enviada — stock descontado del almacén.`);
      await refresh();
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || 'Error al enviar la transferencia.');
    } finally {
      setActioningId(null);
    }
  }

  async function handleCancel(t: InventoryTransfer) {
    const reason = window.prompt(`Motivo de cancelación para TR-${t.numericId}:`);
    if (!reason || !reason.trim()) return;
    setActioningId(t.id);
    try {
      await cancelTransfer({ transferId: t.id, products, reason });
      toast.success(`TR-${t.numericId} cancelada.`);
      await refresh();
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || 'Error al cancelar la transferencia.');
    } finally {
      setActioningId(null);
    }
  }

  return (
    <div className="space-y-5 animate-fade-up md:-mx-6 lg:-mx-12 xl:-mx-20 2xl:-mx-32 md:px-2 lg:px-4">
      {/* Header */}
      <div className="card p-5">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-1 h-12 bg-blue-500 rounded-full" />
            <div>
              <h1 className="text-xl font-display font-bold text-navy-900 dark:text-gray-100">Transferencias</h1>
              <p className="text-navy-400 text-sm">Mover stock entre Almacén y Tienda.</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={refresh} className="btn-ghost text-sm" disabled={loading}>
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Actualizar
            </button>
            {can('canAccessTransfers') && (
              <button onClick={() => setCreateOpen(true)} className="btn-primary text-sm">
                <Plus size={14} /> Nueva transferencia
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {(['all', 'pending', 'in_transit', 'received', 'cancelled'] as const).map((status) => {
          const isActive = filterStatus === status;
          const label = status === 'all' ? 'Todas' : STATUS_BADGES[status as TransferStatus].label;
          const ring = status === 'all' ? 'navy' : status === 'pending' ? 'amber' : status === 'in_transit' ? 'blue' : status === 'received' ? 'emerald' : 'red';
          return (
            <button
              key={status}
              onClick={() => setFilterStatus(status)}
              className={`card px-4 py-3 hover-lift text-left transition-all ${isActive ? `ring-2 ring-${ring}-500 border-${ring}-300` : ''}`}
            >
              <p className="text-[10px] font-display font-semibold text-navy-400 uppercase">{label}</p>
              <p className="text-lg font-mono font-bold text-navy-900 dark:text-gray-100">{counts[status]}</p>
            </button>
          );
        })}
      </div>

      {/* Lista */}
      {loading ? (
        <div className="card p-12 text-center">
          <RefreshCw size={32} className="mx-auto text-navy-200 mb-2 animate-spin" />
          <p className="text-navy-400 text-sm font-display">Cargando…</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card p-16 text-center">
          <Truck size={48} className="mx-auto text-navy-200 mb-3" />
          <p className="text-navy-400 text-sm font-display">
            {filterStatus === 'all' ? 'Aún no hay transferencias.' : `No hay transferencias en estado "${STATUS_BADGES[filterStatus as TransferStatus]?.label || filterStatus}".`}
          </p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full table-fixed">
            <thead>
              <tr className="border-b border-surface-200 bg-surface-50 dark:bg-dark-200/50">
                {[
                  { h: 'TR', w: 'w-[5%]' },
                  { h: 'Estado', w: 'w-[9%]' },
                  { h: 'De → A', w: 'w-[11%]' },
                  { h: 'Items', w: 'w-[6%]' },
                  { h: 'Unidades', w: 'w-[7%]' },
                  { h: 'Creó', w: 'w-[10%]' },
                  { h: 'Recibió', w: 'w-[10%]' },
                  { h: 'Fecha', w: 'w-[11%]' },
                  { h: 'Foto', w: 'w-[5%]' },
                  { h: 'Observaciones', w: 'w-[14%]' },
                  { h: 'Acciones', w: 'w-[12%]' },
                ].map((c) => (
                  <th key={c.h} className={`text-left text-[11px] font-display font-semibold text-navy-400 uppercase tracking-wide px-3 py-3 ${c.w}`}>
                    {c.h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100 dark:divide-dark-200/40">
              {filtered.map((t) => {
                const itemsCount = t.items.length;
                const totalUnits = t.items.reduce((acc, i) => acc + i.quantitySent, 0);
                const date = t.createdAt?.toDate ? t.createdAt.toDate() : null;
                const st = STATUS_BADGES[t.status];
                const isLoading = actioningId === t.id;
                return (
                  <tr key={t.id} className="hover:bg-surface-50 dark:hover:bg-dark-200/30 transition-colors">
                    <td className="px-3 py-3 font-mono font-semibold text-[12px] text-navy-900 dark:text-gray-200">TR-{t.numericId}</td>
                    <td className="px-3 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-display font-semibold ${st.class}`}>
                        {st.icon} {st.label}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-[12px] text-navy-600 dark:text-gray-400">
                      <span className="inline-flex items-center gap-1">
                        <Warehouse size={11} className="text-blue-500" /> Almacén
                        <ArrowRight size={11} className="mx-1 text-navy-300" />
                        <Store size={11} className="text-emerald-500" /> Tienda
                      </span>
                    </td>
                    <td className="px-3 py-3 font-mono text-[12px] text-navy-700 dark:text-gray-300">{itemsCount}</td>
                    <td className="px-3 py-3 font-mono font-bold text-[12px] text-navy-900 dark:text-gray-100">{totalUnits}</td>
                    <td className="px-3 py-3 text-[12px] text-navy-500 dark:text-gray-400 break-words leading-tight">{t.createdByName}</td>
                    <td className="px-3 py-3 text-[12px] break-words leading-tight">
                      {t.receivedByName ? (
                        <span className="text-emerald-700 dark:text-emerald-400 font-display font-medium">
                          {t.receivedByName}
                        </span>
                      ) : t.status === 'cancelled' ? (
                        <span className="text-navy-200 dark:text-gray-600 italic text-[10px]">Cancelada</span>
                      ) : (
                        <span className="text-navy-200 dark:text-gray-600">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-[11px] text-navy-500 dark:text-gray-400 leading-tight">
                      {date ? date.toLocaleString('es-VE') : '—'}
                    </td>
                    <td className="px-3 py-3">
                      {t.proofUrl ? (
                        <button onClick={() => setProofPreviewUrl(t.proofUrl!)} className="btn-ghost p-1 text-blue-600 hover:text-blue-700">
                          <ImageIcon size={14} />
                        </button>
                      ) : (
                        <span className="text-navy-200 dark:text-gray-600 text-[10px]">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-[11px] text-navy-500 dark:text-gray-400 break-words leading-tight" title={t.observation || ''}>
                      {t.observation || <span className="text-navy-200 dark:text-gray-600">—</span>}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-1">
                        <button
                          onClick={() => setDetailTransfer(t)}
                          className="btn-ghost p-1 text-navy-400 hover:text-blue-600"
                          title="Ver detalle"
                        >
                          <Eye size={14} />
                        </button>
                        {t.status === 'pending' && (
                          <>
                            <button
                              onClick={() => handleShip(t)}
                              disabled={isLoading}
                              className="btn-ghost p-1 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                              title="Enviar (descontar stock)"
                            >
                              <Send size={14} />
                            </button>
                            <button
                              onClick={() => handleCancel(t)}
                              disabled={isLoading}
                              className="btn-ghost p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                              title="Cancelar"
                            >
                              <XCircle size={14} />
                            </button>
                          </>
                        )}
                        {t.status === 'in_transit' && (
                          <>
                            <button
                              onClick={() => setReceiveTransfer(t)}
                              disabled={isLoading}
                              className="btn-ghost p-1 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20"
                              title="Confirmar recepción"
                            >
                              <CheckCircle2 size={14} />
                            </button>
                            <button
                              onClick={() => handleCancel(t)}
                              disabled={isLoading}
                              className="btn-ghost p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                              title="Cancelar (stock vuelve al almacén)"
                            >
                              <XCircle size={14} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modales */}
      {createOpen && (
        <CreateTransferModal
          onClose={() => setCreateOpen(false)}
          onCreated={() => { setCreateOpen(false); refresh(); }}
        />
      )}

      {receiveTransfer && (
        <ReceiveTransferModal
          transfer={receiveTransfer}
          onClose={() => setReceiveTransfer(null)}
          onReceived={() => { setReceiveTransfer(null); refresh(); }}
        />
      )}

      {detailTransfer && (
        <Modal open onClose={() => setDetailTransfer(null)} title={`TR-${detailTransfer.numericId} — Detalle`} size="md">
          <TransferDetail
            transfer={detailTransfer}
            onPrinted={(updated) => { setDetailTransfer(updated); refresh(); }}
          />
        </Modal>
      )}

      {proofPreviewUrl && (
        <Modal open onClose={() => setProofPreviewUrl(null)} title="Foto del despacho" size="md">
          <img src={proofPreviewUrl} alt="Despacho" className="w-full rounded-lg" />
        </Modal>
      )}
    </div>
  );
}

// ════════════════════════════════════════
// DETAIL VIEW
// ════════════════════════════════════════

function TransferDetail({ transfer, onPrinted }: { transfer: InventoryTransfer; onPrinted?: (updated: InventoryTransfer) => void }) {
  const st = STATUS_BADGES[transfer.status];
  const totalSent = transfer.items.reduce((a, i) => a + i.quantitySent, 0);
  const totalReceived = transfer.items.reduce((a, i) => a + (i.quantityReceived ?? 0), 0);

  function fmt(ts: any) {
    if (!ts?.toDate) return null;
    return ts.toDate().toLocaleString('es-VE');
  }

  return (
    <div className="space-y-4">
      {/* Estado */}
      <div className="flex items-center gap-2">
        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-display font-semibold ${st.class}`}>
          {st.icon} {st.label}
        </span>
        <span className="text-xs text-navy-400 font-mono">TR-{transfer.numericId}</span>
      </div>

      {/* Audit trail */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="bg-surface-50 dark:bg-dark-200/40 rounded-lg p-3">
          <p className="text-[10px] font-display font-semibold text-navy-400 uppercase mb-1">Creada</p>
          <p className="text-xs text-navy-700 dark:text-gray-300 flex items-center gap-1">
            <User size={11} /> {transfer.createdByName}
          </p>
          <p className="text-[10px] text-navy-400 mt-0.5 flex items-center gap-1">
            <Calendar size={10} /> {fmt(transfer.createdAt) || '—'}
          </p>
        </div>
        {transfer.shippedByName && (
          <div className="bg-blue-50/60 dark:bg-blue-900/20 rounded-lg p-3">
            <p className="text-[10px] font-display font-semibold text-blue-600 uppercase mb-1">Enviada</p>
            <p className="text-xs text-navy-700 dark:text-gray-300 flex items-center gap-1">
              <User size={11} /> {transfer.shippedByName}
            </p>
            <p className="text-[10px] text-navy-400 mt-0.5 flex items-center gap-1">
              <Calendar size={10} /> {fmt(transfer.shippedAt) || '—'}
            </p>
          </div>
        )}
        {transfer.receivedByName && (
          <div className="bg-emerald-50/60 dark:bg-emerald-900/20 rounded-lg p-3">
            <p className="text-[10px] font-display font-semibold text-emerald-600 uppercase mb-1">Recibida</p>
            <p className="text-xs text-navy-700 dark:text-gray-300 flex items-center gap-1">
              <User size={11} /> {transfer.receivedByName}
            </p>
            <p className="text-[10px] text-navy-400 mt-0.5 flex items-center gap-1">
              <Calendar size={10} /> {fmt(transfer.receivedAt) || '—'}
            </p>
          </div>
        )}
        {transfer.cancelledAt && (
          <div className="bg-red-50/60 dark:bg-red-900/20 rounded-lg p-3 sm:col-span-2">
            <p className="text-[10px] font-display font-semibold text-red-600 uppercase mb-1">Cancelada</p>
            <p className="text-[10px] text-navy-400 flex items-center gap-1">
              <Calendar size={10} /> {fmt(transfer.cancelledAt) || '—'}
            </p>
            {transfer.cancelReason && (
              <p className="text-xs text-navy-700 dark:text-gray-300 mt-1 italic">"{transfer.cancelReason}"</p>
            )}
          </div>
        )}
      </div>

      {/* Items */}
      <div>
        <p className="text-[11px] font-display font-semibold text-navy-500 uppercase mb-2 flex items-center gap-1">
          <Package size={12} /> Items ({transfer.items.length})
        </p>
        <div className="border border-surface-200 dark:border-dark-300 rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-surface-50 dark:bg-dark-200/40">
              <tr>
                <th className="text-left px-3 py-2 font-display font-semibold text-navy-500">Producto</th>
                <th className="text-left px-3 py-2 font-display font-semibold text-navy-500 w-20">Talla</th>
                <th className="text-left px-3 py-2 font-display font-semibold text-navy-500 w-28">Color</th>
                <th className="text-right px-3 py-2 font-display font-semibold text-navy-500 w-24">Enviado</th>
                {transfer.status === 'received' && (
                  <th className="text-right px-3 py-2 font-display font-semibold text-navy-500 w-24">Recibido</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100 dark:divide-dark-300/40">
              {transfer.items.map((item, idx) => {
                const diff = (item.quantityReceived ?? item.quantitySent) - item.quantitySent;
                return (
                  <tr key={idx}>
                    <td className="px-3 py-2 text-navy-900 dark:text-gray-200">{item.productName}</td>
                    <td className="px-3 py-2 font-mono text-navy-700 dark:text-gray-300">{item.size}</td>
                    <td className="px-3 py-2 text-navy-600 dark:text-gray-400">{item.color}</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold text-navy-900 dark:text-gray-200">{item.quantitySent}</td>
                    {transfer.status === 'received' && (
                      <td className="px-3 py-2 text-right font-mono font-semibold">
                        <span className={diff < 0 ? 'text-red-600' : 'text-emerald-600'}>
                          {item.quantityReceived ?? '—'}
                        </span>
                        {diff < 0 && (
                          <span className="ml-1 text-[10px] text-red-500" title="Diferencia">
                            ({diff})
                          </span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-surface-50 dark:bg-dark-200/40">
              <tr>
                <td colSpan={3} className="px-3 py-2 text-right font-display font-semibold text-navy-500">Total</td>
                <td className="px-3 py-2 text-right font-mono font-bold text-navy-900 dark:text-gray-100">{totalSent}</td>
                {transfer.status === 'received' && (
                  <td className="px-3 py-2 text-right font-mono font-bold text-navy-900 dark:text-gray-100">
                    {totalReceived}
                    {totalReceived !== totalSent && (
                      <span className="ml-1 text-[10px] text-red-500" title="Mermas en tránsito">
                        ({totalReceived - totalSent})
                      </span>
                    )}
                  </td>
                )}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Observación */}
      {transfer.observation && (
        <div>
          <p className="text-[11px] font-display font-semibold text-navy-500 uppercase mb-1 flex items-center gap-1">
            <FileText size={12} /> Observaciones
          </p>
          <p className="text-xs text-navy-700 dark:text-gray-300 bg-surface-50 dark:bg-dark-200/40 rounded p-3 italic">
            {transfer.observation}
          </p>
        </div>
      )}

      {/* Foto */}
      {transfer.proofUrl && (
        <div>
          <p className="text-[11px] font-display font-semibold text-navy-500 uppercase mb-2 flex items-center gap-1">
            <ImageIcon size={12} /> Foto del despacho
          </p>
          <img src={transfer.proofUrl} alt="Despacho" className="w-full max-w-md rounded-lg border border-surface-200 dark:border-dark-300" />
        </div>
      )}

      {/* Discrepancia */}
      {transfer.status === 'received' && totalReceived !== totalSent && (
        <div className="bg-red-50/60 dark:bg-red-900/20 rounded-lg p-3 flex items-start gap-2 border border-red-200 dark:border-red-800/40">
          <AlertTriangle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
          <div className="text-xs">
            <p className="font-display font-semibold text-red-700 dark:text-red-300">Discrepancia detectada</p>
            <p className="text-red-600 dark:text-red-400 mt-0.5">
              Se enviaron <strong>{totalSent}</strong> unidades pero se recibieron <strong>{totalReceived}</strong>.
              La diferencia ({totalSent - totalReceived}) se contabiliza como merma en tránsito.
            </p>
          </div>
        </div>
      )}

      {/* Botón de impresión de comanda — único uso */}
      <PrintCommandSection transfer={transfer} onPrinted={onPrinted} />
    </div>
  );
}

// ════════════════════════════════════════
// PRINT COMMAND SECTION
// ════════════════════════════════════════

function PrintCommandSection({
  transfer,
  onPrinted,
}: {
  transfer: InventoryTransfer;
  onPrinted?: (updated: InventoryTransfer) => void;
}) {
  const currentUser = useAppStore((s) => s.currentUser);
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const alreadyPrinted = !!transfer.printedBy;
  const printedDate = transfer.printedAt?.toDate
    ? transfer.printedAt.toDate().toLocaleString('es-VE')
    : transfer.printedAt
      ? new Date(transfer.printedAt).toLocaleString('es-VE')
      : null;

  async function handlePrint() {
    if (!currentUser) {
      toast.error('Usuario no identificado.');
      return;
    }
    if (alreadyPrinted) return;

    // Confirmación: una sola oportunidad de imprimir
    const ok = window.confirm(
      `Vas a imprimir la comanda de TR-${transfer.numericId}.\n\n` +
      `Por seguridad solo se permite imprimir UNA VEZ. Después de esto, la opción quedará deshabilitada y se registrará tu nombre como responsable de la impresión.\n\n` +
      `¿Continuar?`
    );
    if (!ok) return;

    setBusy(true);
    try {
      // Importes dinámicos: el ticket lleva HTML/CSS pesado y el servicio
      // de print no se necesita en otras pantallas.
      const [{ markTransferPrinted }, { printTransferTicket }] = await Promise.all([
        import('./transferService'),
        import('./transferTicket'),
      ]);

      // Primero marcamos como impresa (si esto falla, no abrimos la
      // ventana — evita que alguien imprima sin que quede registrado).
      const result = await markTransferPrinted({ transferId: transfer.id, currentUser });

      // Build el objeto actualizado para reflejar el cambio en la UI sin
      // tener que esperar al refresh
      const updated: InventoryTransfer = {
        ...transfer,
        printedBy: currentUser.uid,
        printedByName: result.printedByName,
        printedAt: { toDate: () => result.printedAt } as any,
      };

      // Lanzar la ventana de impresión
      printTransferTicket(updated);

      toast.success(`Comanda impresa por ${result.printedByName}.`);
      if (onPrinted) onPrinted(updated);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || 'Error al imprimir la comanda.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-t border-surface-200 dark:border-dark-300 pt-4 mt-4">
      <p className="text-[11px] font-display font-semibold text-navy-500 uppercase mb-2 flex items-center gap-1">
        <Printer size={12} /> Comanda física
      </p>
      {alreadyPrinted ? (
        <div className="bg-surface-50 dark:bg-dark-200/40 rounded-lg p-3 text-xs space-y-1">
          <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300 font-display font-semibold">
            <CheckCircle2 size={14} /> Comanda ya impresa
          </div>
          <p className="text-navy-600 dark:text-gray-400">
            Por <strong>{transfer.printedByName}</strong>{printedDate && <> el {printedDate}</>}
          </p>
          <p className="text-[10px] text-navy-400 dark:text-gray-500 italic">
            Por seguridad solo se imprime una vez. Si necesitás un duplicado, contactá al administrador.
          </p>
        </div>
      ) : (
        <div>
          <button
            onClick={handlePrint}
            disabled={busy}
            type="button"
            className="btn-primary text-sm w-full sm:w-auto"
          >
            <Printer size={14} />
            {busy ? 'Procesando…' : 'Imprimir comanda (una sola vez)'}
          </button>
          <p className="text-[10px] text-navy-400 dark:text-gray-500 italic mt-1.5">
            Esta acción solo se permite una vez. Quedará registrado tu nombre como responsable.
          </p>
        </div>
      )}
    </div>
  );
}
