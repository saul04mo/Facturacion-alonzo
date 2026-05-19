import { useState, useMemo } from 'react';
import { Modal } from '@/components/Modal';
import { useCurrency } from '@/hooks/useCurrency';
import { PAYMENT_METHODS } from './invoiceService';
import { ArrowLeftRight, Minus, Plus } from 'lucide-react';
import type { Invoice, Product } from '@/types';

const EXCHANGE_REASONS = [
  'Cambio de Talla',
  'Cambio de Color',
  'Cambio de Talla y Color',
  'Cambio de Producto',
  'Otro',
];

interface Replacement {
  productId: string;
  variantIndex: number;
  quantity: number;
}

export interface ExchangeConfirmData {
  returnedItems: Array<{
    productId: string; variantIndex: number; quantity: number;
    priceAtSale: number; productName: string; variantLabel: string; branch?: any;
  }>;
  newItems: Array<{
    productId: string; variantIndex: number; quantity: number;
    priceAtSale: number; productName: string; variantLabel: string; branch?: any;
  }>;
  reason: string;
  priceDiff: number;
  priceDiffMethod: string | null;
  newDeliveryCostUsd: number;
  deliveryMethod: string | null;
}

interface Props {
  invoice: Invoice;
  products: Product[];
  loading: boolean;
  onClose: () => void;
  onConfirm: (data: ExchangeConfirmData) => Promise<void>;
}

export function ExchangeModal({ invoice, products, loading, onClose, onConfirm }: Props) {
  const { format } = useCurrency();

  const [selectedItems, setSelectedItems] = useState<Record<number, number>>({});
  const [replacements, setReplacements] = useState<Record<number, Replacement>>({});
  const [reason, setReason] = useState(EXCHANGE_REASONS[0]);
  const [priceDiffMethod, setPriceDiffMethod] = useState<string>(PAYMENT_METHODS[0].name);
  const [newDeliveryCost, setNewDeliveryCost] = useState(String(invoice.deliveryCostUsd || 0));
  const [deliveryMethod, setDeliveryMethod] = useState<string>(PAYMENT_METHODS[0].name);

  function toggleItem(idx: number) {
    const item = invoice.items[idx];
    const isCurrentlySelected = idx in selectedItems;
    setSelectedItems((prev) => {
      if (isCurrentlySelected) {
        const next = { ...prev };
        delete next[idx];
        return next;
      }
      return { ...prev, [idx]: item.quantity };
    });
    if (!isCurrentlySelected) {
      setReplacements((prev) => ({
        ...prev,
        [idx]: { productId: item.productId, variantIndex: item.variantIndex, quantity: item.quantity },
      }));
    } else {
      setReplacements((prev) => {
        const next = { ...prev };
        delete next[idx];
        return next;
      });
    }
  }

  function updateReturnQty(idx: number, qty: number) {
    const max = invoice.items[idx].quantity;
    setSelectedItems((prev) => ({ ...prev, [idx]: Math.min(Math.max(1, qty), max) }));
    setReplacements((prev) => ({
      ...prev,
      [idx]: { ...(prev[idx] || {}), quantity: Math.min(Math.max(1, qty), max) } as Replacement,
    }));
  }

  function updateReplacement(idx: number, field: keyof Replacement, value: number | string) {
    setReplacements((prev) => {
      const current = prev[idx] || {
        productId: invoice.items[idx].productId,
        variantIndex: 0,
        quantity: selectedItems[idx] || 1,
      };
      const updated = { ...current, [field]: value };
      if (field === 'productId') updated.variantIndex = 0;
      return { ...prev, [idx]: updated };
    });
  }

  const returnedTotal = useMemo(
    () =>
      Object.entries(selectedItems).reduce((acc, [idx, qty]) => {
        const item = invoice.items[Number(idx)];
        return acc + (item?.priceAtSale || 0) * qty;
      }, 0),
    [selectedItems, invoice.items],
  );

  const newItemsTotal = useMemo(
    () =>
      Object.entries(replacements).reduce((acc, [idx, rep]) => {
        if (!(Number(idx) in selectedItems)) return acc;
        const prod = products.find((p) => p.id === rep.productId);
        const variant = prod?.variants[rep.variantIndex];
        return acc + (variant?.price || 0) * rep.quantity;
      }, 0),
    [replacements, selectedItems, products],
  );

  const priceDiff = Math.round((newItemsTotal - returnedTotal) * 100) / 100;
  const originalDelivery = invoice.deliveryCostUsd || 0;
  const newDelivery = parseFloat(newDeliveryCost) || 0;
  const deliveryDiff = Math.round((newDelivery - originalDelivery) * 100) / 100;
  const totalAdjustment = Math.round((priceDiff + deliveryDiff) * 100) / 100;

  const selectedCount = Object.keys(selectedItems).length;
  const allHaveReplacements = Object.keys(selectedItems).every((idx) => {
    const rep = replacements[Number(idx)];
    if (!rep) return false;
    const prod = products.find((p) => p.id === rep.productId);
    return prod?.variants[rep.variantIndex] !== undefined;
  });
  const canConfirm = selectedCount > 0 && allHaveReplacements;

  async function handleConfirm() {
    const returnedItemsData = Object.entries(selectedItems).map(([idx, qty]) => {
      const item = invoice.items[Number(idx)];
      return {
        productId: item.productId,
        variantIndex: item.variantIndex,
        quantity: qty,
        priceAtSale: item.priceAtSale,
        productName: item.productName,
        variantLabel: item.variantLabel,
        branch: item.branch,
      };
    });

    const newItemsData = Object.entries(replacements)
      .filter(([idx]) => Number(idx) in selectedItems)
      .map(([, rep]) => {
        const prod = products.find((p) => p.id === rep.productId)!;
        const variant = prod.variants[rep.variantIndex];
        const parts = [variant.size, variant.color].filter(Boolean);
        return {
          productId: rep.productId,
          variantIndex: rep.variantIndex,
          quantity: rep.quantity,
          priceAtSale: variant.price,
          productName: prod.name,
          variantLabel: parts.join(' / '),
          branch: invoice.branch,
        };
      });

    await onConfirm({
      returnedItems: returnedItemsData,
      newItems: newItemsData,
      reason,
      priceDiff,
      priceDiffMethod: priceDiff !== 0 ? priceDiffMethod : null,
      newDeliveryCostUsd: newDelivery,
      deliveryMethod: deliveryDiff !== 0 ? deliveryMethod : null,
    });
  }

  const payMethods = PAYMENT_METHODS.filter((m) => m.currency !== 'none');

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={`Cambio — FACT-${String(invoice.numericId).padStart(4, '0')}`}
      size="lg"
    >
      <div className="space-y-5">

        {/* Motivo */}
        <div>
          <label className="block text-xs font-display font-semibold text-navy-500 uppercase mb-1">
            Motivo del cambio
          </label>
          <select value={reason} onChange={(e) => setReason(e.target.value)} className="input-field text-sm">
            {EXCHANGE_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>

        {/* ── Sección 1: Qué devuelve ── */}
        <div>
          <p className="text-xs font-display font-semibold text-navy-500 uppercase mb-2">
            ¿Qué devuelve el cliente?
          </p>
          <div className="space-y-2">
            {invoice.items.map((item, idx) => {
              const isSelected = idx in selectedItems;
              const returnQty = selectedItems[idx] ?? item.quantity;
              return (
                <div
                  key={idx}
                  onClick={() => toggleItem(idx)}
                  className={`border rounded-lg p-3 cursor-pointer transition-colors ${
                    isSelected ? 'border-blue-400 bg-blue-50/40' : 'border-surface-200 hover:border-surface-300'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => {}}
                      onClick={(e) => e.stopPropagation()}
                      className="w-4 h-4 rounded accent-blue-600 flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-display font-semibold text-sm text-navy-900 truncate">
                        {item.productName}
                      </p>
                      <p className="text-xs text-navy-400">
                        {item.variantLabel} · {format(item.priceAtSale)} c/u
                      </p>
                    </div>
                    {isSelected ? (
                      <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                        <span className="text-xs text-navy-400 font-display">Cant:</span>
                        <button
                          type="button"
                          onClick={() => updateReturnQty(idx, returnQty - 1)}
                          className="w-6 h-6 rounded bg-surface-100 hover:bg-surface-200 flex items-center justify-center"
                        >
                          <Minus size={10} />
                        </button>
                        <span className="font-mono font-bold text-sm w-5 text-center">{returnQty}</span>
                        <button
                          type="button"
                          onClick={() => updateReturnQty(idx, returnQty + 1)}
                          disabled={returnQty >= item.quantity}
                          className="w-6 h-6 rounded bg-surface-100 hover:bg-surface-200 flex items-center justify-center disabled:opacity-40"
                        >
                          <Plus size={10} />
                        </button>
                        <span className="text-xs text-navy-400">/ {item.quantity}</span>
                      </div>
                    ) : (
                      <span className="text-xs font-mono text-navy-500 flex-shrink-0">
                        {item.quantity}x {format(item.priceAtSale * item.quantity)}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Sección 2: Qué se lleva ── */}
        {selectedCount > 0 && (
          <div>
            <p className="text-xs font-display font-semibold text-navy-500 uppercase mb-2">
              ¿Qué se lleva el cliente?
            </p>
            <div className="space-y-3">
              {Object.keys(selectedItems).map((idxStr) => {
                const idx = Number(idxStr);
                const originalItem = invoice.items[idx];
                const rep = replacements[idx] ?? {
                  productId: originalItem.productId,
                  variantIndex: originalItem.variantIndex,
                  quantity: selectedItems[idx],
                };
                const repProd = products.find((p) => p.id === rep.productId);
                const repVariant = repProd?.variants[rep.variantIndex];

                return (
                  <div
                    key={idx}
                    className="border border-teal-200 bg-teal-50/30 rounded-lg p-3 space-y-3"
                  >
                    <div className="flex items-center gap-2">
                      <ArrowLeftRight size={14} className="text-teal-600 flex-shrink-0" />
                      <span className="text-xs text-navy-500 font-display">
                        Reemplaza:{' '}
                        <span className="font-semibold text-navy-700">
                          {originalItem.productName} ({originalItem.variantLabel})
                        </span>
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {/* Producto */}
                      <div>
                        <label className="block text-[10px] font-display font-semibold text-navy-400 uppercase mb-1">
                          Producto
                        </label>
                        <select
                          value={rep.productId}
                          onChange={(e) => updateReplacement(idx, 'productId', e.target.value)}
                          className="input-field text-xs"
                        >
                          {[...products]
                            .filter((p) => p.variants?.length > 0)
                            .sort((a, b) => a.name.localeCompare(b.name))
                            .map((p) => (
                              <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                        </select>
                      </div>
                      {/* Talla / Color */}
                      <div>
                        <label className="block text-[10px] font-display font-semibold text-navy-400 uppercase mb-1">
                          Talla / Color
                        </label>
                        <select
                          value={rep.variantIndex}
                          onChange={(e) => updateReplacement(idx, 'variantIndex', Number(e.target.value))}
                          className="input-field text-xs"
                        >
                          {(repProd?.variants ?? []).map((v, vi) => (
                            <option key={vi} value={vi}>
                              {[v.size, v.color].filter(Boolean).join(' / ')} — {format(v.price)} (Stock: {v.stock ?? 0})
                            </option>
                          ))}
                        </select>
                      </div>
                      {/* Cantidad + precio resultante */}
                      <div>
                        <label className="block text-[10px] font-display font-semibold text-navy-400 uppercase mb-1">
                          Cantidad
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min={1}
                            value={rep.quantity}
                            onChange={(e) =>
                              updateReplacement(idx, 'quantity', Math.max(1, Number(e.target.value)))
                            }
                            className="input-field text-xs w-20"
                          />
                          {repVariant && (
                            <span className="text-xs font-mono font-bold text-emerald-600">
                              = {format(repVariant.price * rep.quantity)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Sección 3: Ajuste financiero ── */}
        {selectedCount > 0 && (
          <div className="border border-surface-200 rounded-lg p-4 space-y-4 bg-surface-50/50">
            <p className="text-xs font-display font-semibold text-navy-500 uppercase">
              Ajuste financiero
            </p>

            {/* Diferencia de precio */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-display font-medium text-navy-700">Diferencia de precio</p>
                <p className="text-xs text-navy-400">
                  Devuelto {format(returnedTotal)} → Nuevo {format(newItemsTotal)}
                </p>
              </div>
              <span
                className={`text-xl font-mono font-bold ${
                  priceDiff > 0.005
                    ? 'text-rose-600'
                    : priceDiff < -0.005
                    ? 'text-emerald-600'
                    : 'text-navy-400'
                }`}
              >
                {priceDiff > 0.005 ? '+' : ''}{format(priceDiff)}
              </span>
            </div>
            {Math.abs(priceDiff) > 0.005 && (
              <div>
                <label className="block text-[10px] font-display font-semibold text-navy-400 uppercase mb-1">
                  {priceDiff > 0 ? 'Método de cobro (diferencia)' : 'Método de devolución (diferencia)'}
                </label>
                <select
                  value={priceDiffMethod}
                  onChange={(e) => setPriceDiffMethod(e.target.value)}
                  className="input-field text-sm"
                >
                  {payMethods.map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}
                </select>
              </div>
            )}

            {/* Delivery */}
            <div className="pt-3 border-t border-surface-200 space-y-2">
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <label className="block text-[10px] font-display font-semibold text-navy-400 uppercase mb-1">
                    Costo de envío del cambio
                    {originalDelivery > 0 && (
                      <span className="ml-1 font-normal normal-case">(original: {format(originalDelivery)})</span>
                    )}
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={newDeliveryCost}
                    onChange={(e) => setNewDeliveryCost(e.target.value)}
                    className="input-field text-sm"
                    placeholder="0.00"
                  />
                </div>
                {Math.abs(deliveryDiff) > 0.005 && (
                  <div className="text-right flex-shrink-0">
                    <p className="text-[10px] text-navy-400 font-display uppercase">Diferencia</p>
                    <p className={`text-base font-mono font-bold ${deliveryDiff > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                      {deliveryDiff > 0 ? '+' : ''}{format(deliveryDiff)}
                    </p>
                  </div>
                )}
              </div>
              {Math.abs(deliveryDiff) > 0.005 && (
                <div>
                  <label className="block text-[10px] font-display font-semibold text-navy-400 uppercase mb-1">
                    {deliveryDiff > 0 ? 'Método de cobro (envío)' : 'Método de devolución (envío)'}
                  </label>
                  <select
                    value={deliveryMethod}
                    onChange={(e) => setDeliveryMethod(e.target.value)}
                    className="input-field text-sm"
                  >
                    {payMethods.map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}
                  </select>
                </div>
              )}
            </div>

            {/* Total del ajuste */}
            {Math.abs(totalAdjustment) > 0.005 && (
              <div className="pt-3 border-t border-surface-200 flex justify-between items-center">
                <span className="text-sm font-display font-semibold text-navy-800">
                  Total a {totalAdjustment > 0 ? 'cobrar al cliente' : 'devolver al cliente'}
                </span>
                <span
                  className={`text-2xl font-mono font-bold ${
                    totalAdjustment > 0 ? 'text-rose-600' : 'text-emerald-600'
                  }`}
                >
                  {format(Math.abs(totalAdjustment))}
                </span>
              </div>
            )}
            {Math.abs(totalAdjustment) <= 0.005 && selectedCount > 0 && (
              <p className="text-xs text-emerald-600 font-display font-semibold text-center py-1">
                ✓ Cambio sin diferencia de precio
              </p>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex justify-end gap-3 pt-2 border-t border-surface-200">
          <button onClick={onClose} className="btn-secondary" disabled={loading}>
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canConfirm || loading}
            className="btn-primary"
          >
            {loading ? 'Procesando...' : 'Confirmar Cambio'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
