import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useAppStore } from '@/store/appStore';
import { useCurrency } from '@/hooks/useCurrency';
import { useToast } from '@/components/Toast';
import { PAYMENT_METHODS, processSale, type ActivePayment } from '@/modules/invoices/invoiceService';
import { CreditCard, Check, Loader2 } from 'lucide-react';

interface PaymentEntry {
  methodId: string;
  enabled: boolean;
  amount: string;
  ref: string;
}

function buildDefaultEntries(): PaymentEntry[] {
  return PAYMENT_METHODS.map((m) => ({ methodId: m.id, enabled: false, amount: '', ref: '' }));
}

export function PaymentPanel({ total, onSuccess }: { total: number; onSuccess?: (numericId: number) => void }) {
  const currentSale = useAppStore((s) => s.currentSale);
  const setCurrentSale = useAppStore((s) => s.setCurrentSale);
  const products = useAppStore((s) => s.products);
  const clients = useAppStore((s) => s.clients);
  const currentUser = useAppStore((s) => s.currentUser);
  const resetCurrentSale = useAppStore((s) => s.resetCurrentSale);
  const exchangeRate = useAppStore((s) => s.exchangeRate);
  const { format } = useCurrency();
  const toast = useToast();
  const [processing, setProcessing] = useState(false);
  const isPending = !currentSale.deliveryPaidInStore;
  const setIsPending = (val: boolean) => setCurrentSale({ ...currentSale, deliveryPaidInStore: !val });

  const [entries, setEntries] = useState<PaymentEntry[]>(buildDefaultEntries);

  // FIX: Reset payment entries when cart items change significantly
  const prevItemCount = useRef(currentSale.items.length);
  useEffect(() => {
    if (currentSale.items.length === 0 && prevItemCount.current > 0) {
      setEntries(buildDefaultEntries());
    }
    prevItemCount.current = currentSale.items.length;
  }, [currentSale.items.length]);

  const updateEntry = useCallback((methodId: string, field: keyof PaymentEntry, value: any) => {
    setEntries((prev) => prev.map((e) => e.methodId === methodId ? { ...e, [field]: value } : e));
  }, []);

  const { remaining, change } = useMemo(() => {
    const totalSaleVes = total * exchangeRate;
    let paid = 0;
    entries.filter((e) => e.enabled).forEach((e) => {
      const method = PAYMENT_METHODS.find((m) => m.id === e.methodId);
      const amt = parseFloat(e.amount) || 0;
      if (method?.currency === 'ves') paid += amt;
      else if (method?.currency === 'usd') paid += amt * exchangeRate;
    });
    const rem = Math.max(0, totalSaleVes - paid);
    const ch = paid > totalSaleVes ? paid - totalSaleVes : 0;
    return { totalPaidVes: paid, remaining: rem, change: ch };
  }, [entries, total, exchangeRate]);

  const isCreditSale = entries.some((e) => e.enabled && e.methodId === 'credito');
  const canProcess = currentSale.items.length > 0 && (isPending || isCreditSale || remaining < 0.01);

  async function handleCheckout() {
    if (!currentUser) return;
    if (!canProcess) {
      if (!isCreditSale && !isPending) {
        toast.warning(`Pago incompleto. Faltan ${format(remaining / exchangeRate)}`);
      }
      return;
    }

    let activePayments: ActivePayment[] = [];
    if (isPending) {
      activePayments = [{ method: 'Crédito', amountVes: 0, amountUsd: 0 }];
    } else {
      activePayments = entries
        .filter((e) => e.enabled)
        .map((e) => {
          const method = PAYMENT_METHODS.find((m) => m.id === e.methodId)!;
          const amt = parseFloat(e.amount) || 0;
          return {
            method: method.name,
            amountVes: method.currency === 'ves' ? amt : 0,
            amountUsd: method.currency === 'usd' ? amt : 0,
            ...(e.ref ? { ref: e.ref } : {}),
          };
        })
        .filter((p) => p.amountVes > 0 || p.amountUsd > 0 || p.method === 'Crédito');
    }

    setProcessing(true);
    try {
      const result = await processSale({
        sale: { ...currentSale, total }, payments: activePayments,
        exchangeRate, currentUser, products, clients,
      });
      resetCurrentSale();
      setEntries(buildDefaultEntries());
      onSuccess?.(result.numericId);
      toast.success(`Venta procesada. Factura FACT-${String(result.numericId).padStart(4, '0')} generada.`);
    } catch (err: any) {
      console.error('Error procesando venta:', err);
      // Show the specific stock error if that's what it is
      toast.error(err?.message || 'Error al procesar la venta.');
    } finally {
      setProcessing(false);
    }
  }

  if (currentSale.items.length === 0) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between p-3 bg-surface-50 rounded-lg border border-surface-200 hover-lift mb-3 transition-colors">
        <span className="text-sm font-display font-medium text-navy-800">Pago de pedido:</span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsPending(!isPending)}
            className={`w-10 h-6 rounded-full relative transition-colors duration-300 focus:outline-none ${!isPending ? 'bg-green-500' : 'bg-surface-400'}`}
          >
            <div className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-transform duration-300 ${!isPending ? 'left-[22px]' : 'left-1'}`} />
          </button>
          <span className={`text-sm font-display font-medium w-16 ${isPending ? 'text-accent-red' : 'text-emerald-600'}`}>
            {isPending ? 'Pendiente' : 'Recibido'}
          </span>
        </div>
      </div>

      {!isPending && (
        <>
          <div className="flex items-center gap-2 mb-1">
            <CreditCard size={16} className="text-navy-500" />
            <h3 className="font-display font-bold text-navy-900 text-sm">Métodos de Pago</h3>
          </div>

          <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
            {PAYMENT_METHODS.map((method) => {
              const entry = entries.find((e) => e.methodId === method.id)!;
              return (
                <div key={method.id} className={`rounded-lg border transition-all duration-200 hover-lift ${entry.enabled ? 'border-blue-200 bg-blue-50/30 shadow-sm' : 'border-surface-200 bg-white'}`}>
                  <label className="flex items-center gap-3 px-3 py-2.5 cursor-pointer">
                    <input type="checkbox" checked={entry.enabled}
                      onChange={(e) => { updateEntry(method.id, 'enabled', e.target.checked); if (!e.target.checked) { updateEntry(method.id, 'amount', ''); updateEntry(method.id, 'ref', ''); } }}
                      className="w-4 h-4 rounded border-surface-300 text-navy-900 focus:ring-navy-900/20" />
                    <span className="text-sm font-display font-medium text-navy-800 flex-1">{method.name}</span>
                    {method.currency !== 'none' && (
                      <span className="text-[10px] font-mono text-navy-400 uppercase">{method.currency}</span>
                    )}
                  </label>

                  {entry.enabled && method.currency !== 'none' && (
                    <div className="px-3 pb-3 space-y-2">
                      <input type="number" step="0.01" value={entry.amount}
                        onChange={(e) => updateEntry(method.id, 'amount', e.target.value)}
                        placeholder={method.currency === 'ves' ? 'Monto Bs.' : 'Monto $'}
                        className="input-field text-sm py-1.5 font-mono" />
                      {(method as any).hasRef && (
                        <input type="text" value={entry.ref}
                          onChange={(e) => updateEntry(method.id, 'ref', e.target.value)}
                          placeholder="Referencia" className="input-field text-sm py-1.5" />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="bg-surface-50 rounded-lg border border-surface-200 p-3 space-y-1.5 text-sm hover-lift">
            <div className="flex justify-between text-navy-500">
              <span>Restante</span>
              <span className={`font-mono font-medium ${remaining > 0.01 ? 'text-accent-red' : 'text-emerald-600'}`}>
                {format(remaining / exchangeRate)}
              </span>
            </div>
            {change > 0.01 && (
              <div className="flex justify-between text-emerald-600">
                <span>Cambio</span>
                <span className="font-mono font-medium">{format(change / exchangeRate)}</span>
              </div>
            )}
          </div>
        </>
      )}

      <button onClick={handleCheckout} disabled={!canProcess || processing}
        className="btn-primary w-full py-3">
        {processing ? (
          <><Loader2 size={16} className="animate-spin" /> Procesando...</>
        ) : (
          <><Check size={16} /> Procesar Venta</>
        )}
      </button>
    </div>
  );
}
