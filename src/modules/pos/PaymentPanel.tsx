import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useAppStore } from '@/store/appStore';
import { useCurrency } from '@/hooks/useCurrency';
import { useToast } from '@/components/Toast';
import { PAYMENT_METHODS, processSale, type ActivePayment } from '@/modules/invoices/invoiceService';
import { validarCreditoBancario, isBanescoValidatable, type BanescoTransaction } from '@/services/banescoService';
import { BanescoMatchDetails } from '@/components/BanescoMatchDetails';
import { BanescoErrorNotice } from '@/components/BanescoErrorNotice';
import type { CashCurrency } from '@/types';
import { CreditCard, Check, Loader2, ShieldCheck, CheckCircle2, XCircle } from 'lucide-react';

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
  const processingRef = useRef(false);
  const isPending = !currentSale.deliveryPaidInStore;
  const setIsPending = (val: boolean) => setCurrentSale({ ...currentSale, deliveryPaidInStore: !val });

  const [entries, setEntries] = useState<PaymentEntry[]>(buildDefaultEntries);

  // Moneda en la que se entrega el vuelto. Default Bs porque es lo habitual,
  // pero el cajero lo cambia a $ cuando devuelve dólares.
  const [changeCurrency, setChangeCurrency] = useState<CashCurrency>('ves');

  // Validación contra Banesco (solo informativa). Aplica a los métodos que
  // caen en la cuenta — pago móvil y transferencia bancaria — así que el
  // estado va indexado por método: el cajero puede cobrar con los dos a la
  // vez y cada uno lleva su propio resultado.
  type BankValidation =
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'found'; match: BanescoTransaction }
    | { status: 'notfound'; message: string }
    | { status: 'error'; error: unknown };
  const [validations, setValidations] = useState<Record<string, BankValidation>>({});

  const setValidation = useCallback((methodId: string, value: BankValidation) => {
    setValidations((prev) => ({ ...prev, [methodId]: value }));
  }, []);

  const handleValidateBank = useCallback(async (entry: PaymentEntry) => {
    const ref = entry.ref.trim();
    if (!ref) {
      toast.warning('Ingresá la referencia del pago primero.');
      return;
    }
    setValidation(entry.methodId, { status: 'loading' });
    try {
      const amountVes = parseFloat(entry.amount) || 0;
      const result = await validarCreditoBancario({ referenceNumber: ref, amountVes });
      if (result.found && result.match) {
        setValidation(entry.methodId, { status: 'found', match: result.match });
      } else {
        setValidation(entry.methodId, {
          status: 'notfound',
          message: `Sin coincidencia entre ${result.reviewed} crédito(s) de hoy.`,
        });
      }
    } catch (err) {
      setValidation(entry.methodId, { status: 'error', error: err });
    }
  }, [toast, setValidation]);

  // FIX: Reset payment entries when cart items change significantly
  const prevItemCount = useRef(currentSale.items.length);
  useEffect(() => {
    if (currentSale.items.length === 0 && prevItemCount.current > 0) {
      setEntries(buildDefaultEntries());
      setValidations({});
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
    if (processingRef.current) return; // Ref guard — prevents double-click race condition
    if (!canProcess) {
      if (!isCreditSale && !isPending) {
        toast.warning(`Pago incompleto. Faltan ${format(remaining / exchangeRate)}`);
      }
      return;
    }

    let activePayments: ActivePayment[] = [];
    if (isPending) {
      // Venta a crédito: la factura queda en 'Pendiente de pago'.
      // Si el cajero anotó algún método previsto, lo registramos como
      // abono. Respetamos el monto que haya ingresado (puede ser un
      // pago parcial); si lo dejó en blanco queda en 0 y se completará
      // cuando entre el dinero. Si no anotó nada, default a 'Crédito'.
      const annotated = entries
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
        });
      activePayments = annotated.length > 0 ? annotated : [{ method: 'Crédito', amountVes: 0, amountUsd: 0 }];
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

    processingRef.current = true; // Instant lock (synchronous, not async like setState)
    setProcessing(true);
    try {
      const result = await processSale({
        sale: { ...currentSale, total }, payments: activePayments,
        exchangeRate, currentUser, products, clients,
        allowNegativeStock: useAppStore.getState().allowNegativeStock,
        // Vuelto a entregar (USD). Si fue venta a crédito o no hay
        // exceso de efectivo, change será 0 y no se persiste el campo.
        changeUsd: !isPending && change > 0 ? change / exchangeRate : 0,
        changeCurrency,
      });
      resetCurrentSale();
      setEntries(buildDefaultEntries());
      setValidations({});
      setChangeCurrency('ves');
      onSuccess?.(result.numericId);
      toast.success(`Venta procesada. Factura FACT-${String(result.numericId).padStart(4, '0')} generada.`);
    } catch (err: any) {
      console.error('Error procesando venta:', err);
      toast.error(err?.message || 'Error al procesar la venta.');
    } finally {
      processingRef.current = false;
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

      {/* Métodos de pago: SIEMPRE visibles. Cuando el toggle está en
          'Pendiente' (venta a crédito), igual mostramos los métodos
          para que el cajero pueda anotar el método previsto si lo desea.
          La lógica de procesamiento toma el toggle como fuente de verdad
          (si Pendiente → factura como crédito, si Recibido → cobra los
          montos cargados). */}
      {isPending && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex gap-2 items-start text-amber-800 text-xs font-display">
          <span className="font-bold mt-0.5">⚠️</span>
          <span>
            Esta venta se va a crear como <strong>Crédito</strong> (Pendiente de pago).
            El stock se descuenta y la factura queda esperando el cobro.
            Podés anotar el método previsto abajo si querés.
          </span>
        </div>
      )}

      <>
        <div className="flex items-center gap-2 mb-1">
          <CreditCard size={16} className="text-navy-500" />
          <h3 className="font-display font-bold text-navy-900 text-sm">
            {isPending ? 'Método previsto (opcional)' : 'Métodos de Pago'}
          </h3>
        </div>

        {/* max-h-64: la lista tiene 10 métodos colapsados, pero uno abierto
            ocupa ~150px entre monto, referencia y botón. Con 192px el que
            estabas cargando quedaba medio tapado. */}
        <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
          {PAYMENT_METHODS.map((method) => {
            const entry = entries.find((e) => e.methodId === method.id)!;
            const canValidate = isBanescoValidatable(method.name);
            const validation = validations[method.id] ?? { status: 'idle' as const };
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
                        onChange={(e) => { updateEntry(method.id, 'ref', e.target.value); if (canValidate) setValidation(method.id, { status: 'idle' }); }}
                          placeholder="Referencia" className="input-field text-sm py-1.5" />
                      )}
                    {canValidate && (
                      <button type="button"
                        onClick={() => handleValidateBank(entry)}
                        disabled={validation.status === 'loading' || !entry.ref.trim()}
                        className="w-full flex items-center justify-center gap-1.5 text-xs font-display font-medium py-1.5 rounded-lg border border-navy-200 text-navy-700 bg-white hover:bg-navy-50 disabled:opacity-50 transition-colors">
                        {validation.status === 'loading'
                          ? (<><Loader2 size={14} className="animate-spin" /> Validando...</>)
                          : (<><ShieldCheck size={14} /> Validar en Banesco</>)}
                      </button>
                    )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Resultado de la validación bancaria — FUERA de la lista con
              scroll. Adentro quedaba encajonado en 192px y el detalle se
              cortaba a la mitad. Acá tiene el ancho completo del panel y
              cada tarjeta dice a qué método corresponde, porque se puede
              cobrar con pago móvil y transferencia en la misma venta. */}
          {PAYMENT_METHODS.map((method) => {
            const validation = validations[method.id];
            if (!validation || validation.status === 'idle' || validation.status === 'loading') return null;
            return (
              <div key={`val-${method.id}`} className="mt-2">
                {validation.status === 'found' && (
                  <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="flex items-center gap-1.5 font-display font-semibold">
                        <CheckCircle2 size={14} className="shrink-0" /> Encontrado en Banesco
                      </span>
                      <span className="text-[10px] font-display text-navy-500 truncate">{method.name}</span>
                    </div>
                    <BanescoMatchDetails match={validation.match} />
                  </div>
                )}
                {validation.status === 'notfound' && (
                  <div className="flex items-start gap-1.5 text-xs text-accent-red bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
                    <XCircle size={14} className="mt-0.5 shrink-0" />
                    <span><strong className="font-display">{method.name}:</strong> {validation.message}</span>
                  </div>
                )}
                {validation.status === 'error' && (
                  <BanescoErrorNotice
                    error={validation.error}
                    label={method.name}
                    onRetry={() => {
                      const entry = entries.find((e) => e.methodId === method.id);
                      if (entry) handleValidateBank(entry);
                    }}
                  />
                )}
              </div>
            );
          })}

          {!isPending && (
            <div className="bg-surface-50 rounded-lg border border-surface-200 p-3 space-y-1.5 text-sm hover-lift">
              <div className="flex justify-between text-navy-500">
                <span>Restante</span>
                <span className={`font-mono font-medium ${remaining > 0.01 ? 'text-accent-red' : 'text-emerald-600'}`}>
                  {format(remaining / exchangeRate)}
                </span>
              </div>
              {change > 0.01 && (
                <>
                  <div className="flex justify-between text-emerald-600">
                    <span>Cambio</span>
                    <span className="font-mono font-medium">{format(change / exchangeRate)}</span>
                  </div>
                  {/* En qué moneda se entrega el vuelto. Determina de qué
                      gaveta lo descuenta el cierre de caja — sin esto la
                      caja en Bs y la caja en $ nunca cuadran. */}
                  <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-surface-200">
                    <span className="text-navy-500 text-xs">Vuelto entregado en</span>
                    <div className="flex gap-1">
                      {([
                        { id: 'ves', label: 'Bs', hint: `Bs ${change.toFixed(2)}` },
                        { id: 'usd', label: '$', hint: `$ ${(change / exchangeRate).toFixed(2)}` },
                      ] as const).map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          title={opt.hint}
                          onClick={() => setChangeCurrency(opt.id)}
                          className={`px-3 py-1 rounded-md text-xs font-display font-semibold border transition-colors
                            ${changeCurrency === opt.id
                              ? 'bg-navy-900 text-white border-navy-900'
                              : 'bg-white text-navy-500 border-surface-200 hover:border-navy-300'}`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </>

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
