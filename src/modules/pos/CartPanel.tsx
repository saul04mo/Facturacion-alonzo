import { useState, useMemo, useEffect } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAppStore } from '@/store/appStore';
import { searchClientsQuery } from '../clients/clientService';
import { useCurrency } from '@/hooks/useCurrency';
import { useToast } from '@/components/Toast';
import { PaymentPanel } from './PaymentPanel';
import { DiscountModal } from './DiscountModal';
import { ClientFormModal } from '@/modules/clients/ClientsPage';
import { calcDiscountAmount } from '@/utils/discountUtils';
import { validateCoupon, calculateCouponDiscount, evaluatePromotions } from '@/services/promotionService';
import { DELIVERY_TYPES } from '@/config/constants';
import { normalizeClient } from '@/types';
import type { AppliedPromotion } from '@/types';
import {
  ShoppingCart, Search, Tag, Plus, Minus, X, Trash2,
  Truck, Users, Edit, Ticket, Zap, Gift, CheckCircle2,
} from 'lucide-react';

export function CartPanel() {
  const products = useAppStore((s) => s.products);
  const coupons = useAppStore((s) => s.coupons);
  const promotions = useAppStore((s) => s.promotions);
  const currentSale = useAppStore((s) => s.currentSale);
  const setCurrentSale = useAppStore((s) => s.setCurrentSale);
  const resetCurrentSale = useAppStore((s) => s.resetCurrentSale);
  const { format, formatBoth } = useCurrency();
  const toast = useToast();
  const [showDiscountModal, setShowDiscountModal] = useState(false);
  const [showClientModal, setShowClientModal] = useState(false);
  const [searchCedula, setSearchCedula] = useState('');
  const [clientNotFound, setClientNotFound] = useState(false);
  const [selectedClient, setSelectedClient] = useState<any>(null);
  const [isSearchingClient, setIsSearchingClient] = useState(false);
  const [couponCode, setCouponCode] = useState('');
  const [couponError, setCouponError] = useState('');

  // Re-fetch client if cart has one but it's not loaded locally
  useEffect(() => {
    if (!currentSale.clientId) {
      setSelectedClient(null);
      return;
    }
    if (!selectedClient || selectedClient.id !== currentSale.clientId) {
      getDoc(doc(db, 'clients', currentSale.clientId)).then((snap) => {
        if (snap.exists()) setSelectedClient(normalizeClient({ id: snap.id, ...snap.data() }));
      });
    }
  }, [currentSale.clientId]);

  async function handleSearchClient() {
    const s = searchCedula.trim();
    if (!s) {
      setClientNotFound(false);
      return;
    }
    setIsSearchingClient(true);
    try {
      const results = await searchClientsQuery(s);
      if (results.length > 0) {
        const found = normalizeClient(results[0]);
        setSelectedClient(found);
        setCurrentSale({ ...currentSale, clientId: found.id });
        setSearchCedula('');
        setClientNotFound(false);
      } else {
        setClientNotFound(true);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsSearchingClient(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') handleSearchClient();
  }

  const cartDetails = useMemo(() => {
    let subtotal = 0;
    const items = currentSale.items.map((item, index) => {
      const product = products.find((p) => p.id === item.productId);
      if (!product) return null;
      const variant = product.variants[item.variantIndex];
      if (!variant) return null;
      const lineTotal = variant.price * item.quantity;
      const discountAmt = calcDiscountAmount(lineTotal, item.discount);
      const finalLine = lineTotal - discountAmt;
      subtotal += finalLine;
      return { index, product, variant, item, lineTotal, discountAmt, finalLine };
    }).filter(Boolean) as any[];

    const itemDiscountsTotal = items.reduce((sum: number, item: any) => sum + item.discountAmt, 0);
    const totalDiscountAmt = calcDiscountAmount(subtotal, currentSale.totalDiscount);
    const subtotalAfterDiscounts = Math.max(0, subtotal - totalDiscountAmt);

    // ── Auto-evaluate promotions ──
    const deliveryCost = Number(currentSale.deliveryCostUsd) || 0;
    const autoPromotions = evaluatePromotions(promotions, currentSale.items, products, subtotalAfterDiscounts, deliveryCost);
    const promoDiscount = autoPromotions.reduce((sum, p) => sum + p.discountAmount, 0);
    const hasFreeShipping = autoPromotions.some((p) => p.type === 'free_shipping');

    // ── Coupon discount ──
    const couponDiscount = currentSale.appliedCoupon?.discountAmount || 0;
    const couponFreeShipping = currentSale.appliedCoupon?.freeShipping || false;
    const effectiveDeliveryCost = (hasFreeShipping || couponFreeShipping) ? 0 : deliveryCost;

    const total = Math.max(0, subtotalAfterDiscounts - promoDiscount - couponDiscount + effectiveDeliveryCost);

    return {
      items, subtotal, itemDiscountsTotal, totalDiscountAmt,
      autoPromotions, promoDiscount,
      couponDiscount, effectiveDeliveryCost,
      freeShipping: hasFreeShipping || couponFreeShipping,
      total: total || 0,
    };
  }, [currentSale, products, promotions]);

  // ── Sync auto-promotions to currentSale ──
  useEffect(() => {
    const prevIds = (currentSale.appliedPromotions || []).map((p) => p.promotionId).sort().join(',');
    const newIds = cartDetails.autoPromotions.map((p: AppliedPromotion) => p.promotionId).sort().join(',');
    if (prevIds !== newIds) {
      setCurrentSale({ ...currentSale, appliedPromotions: cartDetails.autoPromotions });
    }
  }, [cartDetails.autoPromotions]);

  // ── Coupon handlers ──
  function handleApplyCoupon() {
    const code = couponCode.trim().toUpperCase();
    if (!code) return;
    setCouponError('');

    const validation = validateCoupon(code, coupons, cartDetails.subtotal, currentSale.clientId, currentSale.items, products);
    if (!validation.valid) {
      setCouponError(validation.error || 'Cupón inválido.');
      return;
    }

    const applied = calculateCouponDiscount(validation.coupon!, cartDetails.subtotal - cartDetails.totalDiscountAmt, currentSale.items, products);
    setCurrentSale({ ...currentSale, appliedCoupon: applied });
    setCouponCode('');
    toast.success(`¡Cupón ${applied.code} aplicado! Ahorras ${format(applied.discountAmount)}`);
  }

  function handleRemoveCoupon() {
    setCurrentSale({ ...currentSale, appliedCoupon: null });
    setCouponError('');
    toast.info('Cupón removido.');
  }

  function updateQty(index: number, delta: number) {
    const newItems = [...currentSale.items];
    const newQty = newItems[index].quantity + delta;
    if (newQty < 1) return;

    // FIX: Validate against stock
    if (delta > 0) {
      const item = newItems[index];
      const product = products.find((p) => p.id === item.productId);
      const variant = product?.variants[item.variantIndex];
      if (variant && newQty > variant.stock) {
        toast.warning(`Stock insuficiente. Disponible: ${variant.stock}`);
        return;
      }
    }

    newItems[index] = { ...newItems[index], quantity: newQty };
    setCurrentSale({ ...currentSale, items: newItems, total: cartDetails.total });
  }

  function removeItem(index: number) {
    const newItems = currentSale.items.filter((_, i) => i !== index);
    setCurrentSale({ ...currentSale, items: newItems });
  }

  const totals = formatBoth(cartDetails.total);

  return (
    <div className="card flex flex-col h-full overflow-y-auto overflow-x-hidden">
      {/* Cart header */}
      <div className="flex items-center justify-between p-4 border-b border-surface-200 flex-shrink-0">
        <div className="flex items-center gap-2">
          <ShoppingCart size={18} className="text-blue-500" />
          <h2 className="font-display font-bold text-navy-900">Venta Actual</h2>
          {currentSale.items.length > 0 && (
            <span className="badge badge-blue">{currentSale.items.length}</span>
          )}
        </div>
        <button onClick={resetCurrentSale} className="btn-ghost text-xs text-accent-red hover:bg-red-50">
          <Trash2 size={14} /> Limpiar
        </button>
      </div>

      {/* Client Management */}
      <div className="px-4 py-3 border-b border-surface-200 bg-surface-50/50 space-y-3 flex-shrink-0">
        {!selectedClient ? (
          <div>
            <label className="block text-xs font-display font-medium text-navy-700 mb-1">Buscar Cliente por Cédula/RIF</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Users size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-navy-300" />
                <input
                  value={searchCedula}
                  onChange={(e) => {
                    setSearchCedula(e.target.value);
                    setClientNotFound(false);
                  }}
                  onKeyDown={handleKeyDown}
                  className="input-field pl-8 text-xs py-1.5 disabled:opacity-50"
                  placeholder="Ej. 12345678"
                  disabled={isSearchingClient}
                />
              </div>
              <button
                onClick={handleSearchClient}
                disabled={isSearchingClient}
                className="btn-secondary px-3 py-1.5 min-w-0"
              >
                {isSearchingClient ? <div className="w-3.5 h-3.5 border-2 border-navy-500 border-t-transparent rounded-full animate-spin" /> : <Search size={14} className="text-navy-500" />}
              </button>
            </div>
            {clientNotFound && (
              <p className="text-accent-red text-xs mt-1.5">
                Cliente no encontrado. <button onClick={() => { setShowClientModal(true); setClientNotFound(false); }} className="underline font-medium hover:text-red-700">Añadir nuevo</button>
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-display font-bold text-emerald-600 text-sm">Cliente: {selectedClient.name}</span>
              <div className="flex gap-1">
                <button onClick={() => setShowClientModal(true)} className="btn-primary py-1 px-2 text-[10px] gap-1"><Edit size={10} /> Editar</button>
                <button onClick={() => setCurrentSale({ ...currentSale, clientId: null })} className="p-1 px-2 text-navy-400 hover:text-accent-red transition-colors text-xs font-medium">✕</button>
              </div>
            </div>
            <div className="text-[11px] text-navy-500 leading-tight space-y-0.5">
              <p><strong className="text-navy-700">Cédula/RIF:</strong> {selectedClient.rif_ci || '—'}</p>
              {selectedClient.address && <p><strong className="text-navy-700">Dirección:</strong> {selectedClient.address}</p>}
              {selectedClient.phone && <p><strong className="text-navy-700">Teléfono:</strong> {selectedClient.phone}</p>}
              {selectedClient.email && <p><strong className="text-navy-700">Email:</strong> {selectedClient.email}</p>}
            </div>
          </div>
        )}

        <div>
          <label className="block text-xs font-display font-medium text-navy-700 mb-1">Observaciones</label>
          <textarea
            value={currentSale.observation || ''}
            onChange={(e) => setCurrentSale({ ...currentSale, observation: e.target.value })}
            placeholder="Notas internas sobre esta venta..."
            className="input-field text-xs py-1.5 min-h-[40px] resize-y"
            rows={1}
          />
        </div>
      </div>

      {/* Items */}
      <div className="flex-1 overflow-y-auto min-h-[250px] p-4 space-y-2">
        {cartDetails.items.length === 0 ? (
          <div className="text-center py-8">
            <ShoppingCart size={32} className="mx-auto text-navy-200 mb-2" />
            <p className="text-navy-400 text-sm">Añade productos a la venta.</p>
          </div>
        ) : (
          cartDetails.items.map((item: any) => (
            <div key={item.index} className="flex items-center gap-3 p-3 bg-surface-50 rounded-lg border border-surface-200">
              <div className="w-10 h-10 rounded-lg bg-surface-200 overflow-hidden flex-shrink-0">
                {item.product.imageUrl ? (
                  <img src={item.product.imageUrl} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center"><Tag size={14} className="text-navy-300" /></div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-display font-semibold text-navy-900 text-xs truncate">{item.product.name}</p>
                <p className="text-[10px] text-navy-400">{item.variant.size} · {item.variant.color} · {format(item.variant.price)}</p>
                {/* FIX: Show stock warning */}
                {item.item.quantity >= item.variant.stock && (
                  <p className="text-[9px] text-accent-red font-medium">Stock máximo alcanzado ({item.variant.stock})</p>
                )}
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button onClick={() => updateQty(item.index, -1)} className="w-6 h-6 rounded-md bg-surface-200 flex items-center justify-center hover:bg-surface-300 transition-colors">
                  <Minus size={12} />
                </button>
                <span className="w-7 text-center font-mono text-sm font-semibold text-navy-900">{item.item.quantity}</span>
                <button onClick={() => updateQty(item.index, 1)} className="w-6 h-6 rounded-md bg-surface-200 flex items-center justify-center hover:bg-surface-300 transition-colors">
                  <Plus size={12} />
                </button>
              </div>
              <div className="text-right flex-shrink-0 w-16">
                <p className="font-mono font-semibold text-navy-900 text-xs">{format(item.finalLine)}</p>
              </div>
              <button onClick={() => removeItem(item.index)} className="p-1 text-navy-300 hover:text-accent-red transition-colors flex-shrink-0">
                <X size={14} />
              </button>
            </div>
          ))
        )}
      </div>

      {/* Delivery Section */}
      <div className="px-4 py-3 border-t border-surface-200 bg-surface-50/50 flex-shrink-0">
        <div className="flex items-center gap-2 mb-2">
          <Truck size={14} className="text-navy-400" />
          <label className="text-xs font-display font-medium text-navy-700">Tipo de Entrega</label>
        </div>
        <div className="flex gap-2">
          <select
            value={currentSale.deliveryType}
            onChange={(e) => {
              const type = e.target.value as any;
              const hasCost = type === 'local';
              setCurrentSale({
                ...currentSale,
                deliveryType: type,
                deliveryCostUsd: hasCost ? currentSale.deliveryCostUsd : 0,
              });
            }}
            className="input-field text-xs py-1.5"
          >
            {DELIVERY_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          {currentSale.deliveryType === 'local' && (
            <div className="relative animate-fade-in">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-navy-400 text-xs">$</span>
              <input
                type="number"
                step="0.01"
                value={currentSale.deliveryCostUsd || ''}
                onChange={(e) => setCurrentSale({ ...currentSale, deliveryCostUsd: parseFloat(e.target.value) || 0 })}
                placeholder="Costo"
                className="input-field pl-5 text-xs py-1.5 font-mono"
              />
            </div>
          )}
        </div>
      </div>

      {/* ═══ Coupon Input ═══ */}
      {currentSale.items.length > 0 && (
        <div className="px-4 py-3 border-t border-surface-200 bg-surface-50/50 flex-shrink-0">
          {currentSale.appliedCoupon ? (
            <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-lg p-2.5 animate-fade-in">
              <div className="flex items-center gap-2 min-w-0">
                <CheckCircle2 size={14} className="text-emerald-600 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-display font-bold text-emerald-700 truncate">{currentSale.appliedCoupon.code}</p>
                  <p className="text-[10px] text-emerald-600">{currentSale.appliedCoupon.description}</p>
                </div>
              </div>
              <button onClick={handleRemoveCoupon} className="p-1 text-emerald-400 hover:text-accent-red transition-colors flex-shrink-0">
                <X size={14} />
              </button>
            </div>
          ) : (
            <div>
              <label className="block text-xs font-display font-medium text-navy-700 mb-1">
                <Ticket size={12} className="inline mr-1 text-pink-500" />
                ¿Tienes un cupón?
              </label>
              <div className="flex gap-2">
                <input
                  value={couponCode}
                  onChange={(e) => { setCouponCode(e.target.value.toUpperCase()); setCouponError(''); }}
                  onKeyDown={(e) => e.key === 'Enter' && handleApplyCoupon()}
                  className="input-field text-xs py-1.5 font-mono uppercase flex-1"
                  placeholder="Ej. VERANO20"
                />
                <button
                  onClick={handleApplyCoupon}
                  disabled={!couponCode.trim()}
                  className="btn-primary px-3 py-1.5 text-xs disabled:opacity-50 bg-pink-600 hover:bg-pink-700"
                >
                  Aplicar
                </button>
              </div>
              {couponError && (
                <p className="text-accent-red text-[10px] mt-1 font-medium">{couponError}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ═══ Totals ═══ */}
      <div className="p-4 border-t border-surface-200 space-y-2 flex-shrink-0 flex flex-col">
        <div className="flex justify-between text-sm text-navy-500">
          <span>Subtotal</span>
          <span className="font-mono">{format(cartDetails.subtotal)}</span>
        </div>
        {cartDetails.itemDiscountsTotal > 0 && (
          <div className="flex justify-between text-[11px] text-pink-600">
            <span>Ahorro Ofertas</span>
            <span className="font-mono">-{format(cartDetails.itemDiscountsTotal)}</span>
          </div>
        )}
        {cartDetails.totalDiscountAmt > 0 && (
          <div className="flex justify-between text-sm text-accent-red">
            <span>Descuento General</span>
            <span className="font-mono">-{format(cartDetails.totalDiscountAmt)}</span>
          </div>
        )}

        {/* ── Applied Promotions ── */}
        {cartDetails.autoPromotions.length > 0 && (
          <div className="space-y-1 pt-1">
            {cartDetails.autoPromotions.map((promo: AppliedPromotion) => (
              <div key={promo.promotionId} className="flex items-center justify-between text-[11px] text-purple-600 bg-purple-50/50 rounded px-2 py-1">
                <span className="flex items-center gap-1 min-w-0 truncate">
                  <Zap size={10} className="flex-shrink-0" />
                  {promo.description}
                </span>
                <span className="font-mono font-semibold flex-shrink-0 ml-2">-{format(promo.discountAmount)}</span>
              </div>
            ))}
          </div>
        )}

        {/* ── Applied Coupon Discount ── */}
        {currentSale.appliedCoupon && currentSale.appliedCoupon.discountAmount > 0 && (
          <div className="flex items-center justify-between text-[11px] text-emerald-600 bg-emerald-50/50 rounded px-2 py-1">
            <span className="flex items-center gap-1 min-w-0 truncate">
              <Gift size={10} className="flex-shrink-0" />
              Cupón {currentSale.appliedCoupon.code}
            </span>
            <span className="font-mono font-semibold flex-shrink-0 ml-2">-{format(currentSale.appliedCoupon.discountAmount)}</span>
          </div>
        )}

        {/* ── Free shipping badge ── */}
        {cartDetails.freeShipping && currentSale.deliveryCostUsd > 0 && (
          <div className="flex items-center justify-between text-[11px] text-blue-600 bg-blue-50/50 rounded px-2 py-1">
            <span className="flex items-center gap-1">
              <Truck size={10} /> ¡Envío gratis aplicado!
            </span>
            <span className="font-mono font-semibold">-{format(currentSale.deliveryCostUsd)}</span>
          </div>
        )}

        <div className="flex justify-end pt-1">
          <button onClick={() => setShowDiscountModal(true)} className="flex items-center gap-1.5 text-xs font-medium text-blue-500 hover:text-blue-600 transition-colors">
            <Tag size={12} /> {cartDetails.totalDiscountAmt > 0 ? 'Editar Descuento' : 'Aplicar Descuento General'}
          </button>
        </div>
        <div className="pt-2 border-t border-surface-200">
          <div className="flex justify-between font-display font-bold text-navy-900">
            <span>Total (USD)</span>
            <span className="font-mono text-lg">{totals.usd}</span>
          </div>
          <div className="flex justify-between text-sm text-navy-400 font-mono">
            <span>Total (Bs)</span>
            <span>{totals.ves}</span>
          </div>
        </div>

        {/* Payment methods & checkout */}
        {currentSale.items.length > 0 && (
          <div className="pt-3 border-t border-surface-200 flex-shrink-0">
            <PaymentPanel total={cartDetails.total} />
          </div>
        )}
      </div>

      {showDiscountModal && (
        <DiscountModal
          currentDiscount={currentSale.totalDiscount}
          subtotal={cartDetails.subtotal}
          onApply={(disc) => setCurrentSale({ ...currentSale, totalDiscount: disc })}
          onClose={() => setShowDiscountModal(false)}
        />
      )}

      {showClientModal && (
        <ClientFormModal
          open={true}
          onClose={() => setShowClientModal(false)}
          client={selectedClient || { rif_ci: searchCedula } as any}
        />
      )}
    </div>
  );
}
