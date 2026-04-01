import { useState, useMemo } from 'react';
import { useAppStore } from '@/store/appStore';
import { useToast } from '@/components/Toast';
import { Modal } from '@/components/Modal';
import { createPromotion, updatePromotion, deletePromotion } from '@/services/promotionService';
import { Timestamp } from 'firebase/firestore';
import { Plus, Zap, Trash2, Edit, ToggleLeft, ToggleRight } from 'lucide-react';
import type { Promotion, PromotionType, CouponScope, CouponDiscountType } from '@/types';

const PROMO_TYPE_LABELS: Record<PromotionType, string> = {
  nxm: 'NxM (2x1, 3x2...)',
  volume_discount: 'Desc. por Volumen',
  min_purchase: 'Desc. por Monto Mínimo',
  free_shipping: 'Envío Gratis',
  bundle: 'Combo / Bundle',
};

const PROMO_TYPE_COLORS: Record<PromotionType, string> = {
  nxm: 'badge-blue',
  volume_discount: 'badge-purple',
  min_purchase: 'badge-green',
  free_shipping: 'badge-gray',
  bundle: 'badge-yellow',
};

export function PromotionsTab() {
  const promotions = useAppStore((s) => s.promotions);
  const products = useAppStore((s) => s.products);
  const toast = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editingPromo, setEditingPromo] = useState<Promotion | null>(null);

  const activeCount = promotions.filter((p) => p.active).length;

  async function handleToggle(promo: Promotion) {
    try {
      await updatePromotion(promo.id, { active: !promo.active });
      toast.success(promo.active ? 'Promoción desactivada' : 'Promoción activada');
    } catch { toast.error('Error al actualizar.'); }
  }

  async function handleDelete(promo: Promotion) {
    if (!confirm(`¿Eliminar "${promo.name}"?`)) return;
    try {
      await deletePromotion(promo.id);
      toast.success('Promoción eliminada');
    } catch { toast.error('Error al eliminar.'); }
  }

  function formatDate(ts: Timestamp | null | undefined): string {
    if (!ts) return '∞';
    return ts.toDate().toLocaleDateString('es-VE', { day: '2-digit', month: 'short' });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 justify-between">
        <p className="text-navy-400 text-sm">{activeCount} promociones activas de {promotions.length} totales</p>
        <button onClick={() => { setEditingPromo(null); setShowForm(true); }} className="btn-primary gap-1.5">
          <Plus size={14} /> Crear Promoción
        </button>
      </div>

      {promotions.length === 0 ? (
        <div className="text-center py-12">
          <Zap size={40} className="mx-auto text-navy-200 mb-3" />
          <p className="text-navy-400 text-sm">No hay promociones creadas.</p>
          <p className="text-navy-300 text-xs mt-1">Las promociones se aplican automáticamente en el carrito cuando se cumplen las condiciones.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {[...promotions].sort((a, b) => a.priority - b.priority).map((promo) => (
            <div key={promo.id}
              className={`card p-4 border-l-4 transition-all hover-lift ${promo.active ? 'border-l-violet-500' : 'border-l-surface-300 opacity-70'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-display font-bold text-navy-900 text-sm">{promo.name}</h3>
                    <span className={`badge ${PROMO_TYPE_COLORS[promo.type]} text-[10px]`}>
                      {PROMO_TYPE_LABELS[promo.type]}
                    </span>
                    <span className="badge badge-gray text-[10px]">Prioridad: {promo.priority}</span>
                    {!promo.stackable && <span className="badge badge-gray text-[10px]">No acumulable</span>}
                  </div>
                  <p className="text-xs text-navy-500 mt-1">{promo.description}</p>
                  <div className="flex flex-wrap gap-2 mt-2 text-[10px]">
                    {promo.type === 'nxm' && (
                      <span className="badge badge-blue">Compra {promo.buyQty}, paga {promo.payQty}</span>
                    )}
                    {promo.type === 'volume_discount' && (
                      <span className="badge badge-purple">
                        ≥{promo.minUnits} uds → {promo.discountValue}{promo.discountType === 'percentage' ? '%' : '$'} OFF
                      </span>
                    )}
                    {promo.type === 'min_purchase' && (
                      <span className="badge badge-green">
                        Compra ≥${promo.minPurchase} → {promo.discountValue}{promo.discountType === 'percentage' ? '%' : '$'} OFF
                      </span>
                    )}
                    {promo.type === 'free_shipping' && (
                      <span className="badge badge-green">Compra ≥${promo.minPurchase} → Envío gratis</span>
                    )}
                    {promo.type === 'bundle' && (
                      <span className="badge badge-yellow">
                        {promo.bundleProductIds.length} productos → {promo.discountValue}{promo.discountType === 'percentage' ? '%' : '$'} OFF
                      </span>
                    )}
                    <span className="text-navy-400">
                      {formatDate(promo.startsAt)} → {formatDate(promo.expiresAt)}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button onClick={() => { setEditingPromo(promo); setShowForm(true); }}
                    className="p-1.5 text-navy-400 hover:text-blue-500 transition-colors"><Edit size={14} /></button>
                  <button onClick={() => handleToggle(promo)}
                    className="p-1.5 text-navy-400 hover:text-emerald-500 transition-colors">
                    {promo.active ? <ToggleRight size={14} className="text-emerald-500" /> : <ToggleLeft size={14} />}
                  </button>
                  <button onClick={() => handleDelete(promo)}
                    className="p-1.5 text-navy-400 hover:text-accent-red transition-colors"><Trash2 size={14} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <PromotionFormModal
          promotion={editingPromo}
          products={products}
          onClose={() => { setShowForm(false); setEditingPromo(null); }}
          onSaved={() => { setShowForm(false); setEditingPromo(null); }}
        />
      )}
    </div>
  );
}

// ================================================================
// PROMOTION FORM MODAL
// ================================================================
function PromotionFormModal({
  promotion, products, onClose, onSaved,
}: {
  promotion: Promotion | null;
  products: any[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);

  const categories = useMemo(() =>
    [...new Set(products.map((p) => p.category).filter(Boolean))].sort(),
  [products]);

  const [name, setName] = useState(promotion?.name || '');
  const [description, setDescription] = useState(promotion?.description || '');
  const [type, setType] = useState<PromotionType>(promotion?.type || 'nxm');
  const [active, setActive] = useState(promotion?.active ?? true);
  const [priority, setPriority] = useState(promotion?.priority?.toString() || '10');
  const [stackable, setStackable] = useState(promotion?.stackable ?? true);
  const [scope, setScope] = useState<CouponScope>(promotion?.scope || 'global');
  const [scopeTargets, setScopeTargets] = useState<string[]>(promotion?.scopeTargets || []);

  // NxM
  const [buyQty, setBuyQty] = useState(promotion?.buyQty?.toString() || '2');
  const [payQty, setPayQty] = useState(promotion?.payQty?.toString() || '1');

  // Volume
  const [minUnits, setMinUnits] = useState(promotion?.minUnits?.toString() || '3');

  // Discount
  const [discountType, setDiscountType] = useState<CouponDiscountType>(promotion?.discountType || 'percentage');
  const [discountValue, setDiscountValue] = useState(promotion?.discountValue?.toString() || '');

  // Min purchase / free shipping
  const [minPurchase, setMinPurchase] = useState(promotion?.minPurchase?.toString() || '0');

  // Bundle
  const [bundleProductIds, setBundleProductIds] = useState<string[]>(promotion?.bundleProductIds || []);

  // Dates
  const [startsAt, setStartsAt] = useState(
    promotion?.startsAt ? promotion.startsAt.toDate().toISOString().slice(0, 10) : '',
  );
  const [expiresAt, setExpiresAt] = useState(
    promotion?.expiresAt ? promotion.expiresAt.toDate().toISOString().slice(0, 10) : '',
  );

  function toggleScopeTarget(t: string) {
    setScopeTargets((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]);
  }
  function toggleBundleProduct(id: string) {
    setBundleProductIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  async function handleSave() {
    if (!name.trim()) return toast.warning('Ingresa un nombre.');

    setSaving(true);
    try {
      const data: any = {
        name: name.trim(),
        description: description.trim(),
        type,
        active,
        priority: parseInt(priority) || 10,
        stackable,
        scope: type === 'bundle' ? 'product' : scope,
        scopeTargets: type === 'bundle' ? bundleProductIds : (scope === 'global' ? [] : scopeTargets),
        buyQty: parseInt(buyQty) || 2,
        payQty: parseInt(payQty) || 1,
        minUnits: parseInt(minUnits) || 3,
        discountType,
        discountValue: parseFloat(discountValue) || 0,
        minPurchase: parseFloat(minPurchase) || 0,
        bundleProductIds: type === 'bundle' ? bundleProductIds : [],
        startsAt: startsAt ? Timestamp.fromDate(new Date(startsAt + 'T00:00:00')) : null,
        expiresAt: expiresAt ? Timestamp.fromDate(new Date(expiresAt + 'T23:59:59')) : null,
      };

      if (promotion) {
        await updatePromotion(promotion.id, data);
        toast.success('Promoción actualizada');
      } else {
        await createPromotion(data);
        toast.success('Promoción creada');
      }
      onSaved();
    } catch (err) {
      console.error(err);
      toast.error('Error al guardar.');
    } finally {
      setSaving(false);
    }
  }

  const showDiscount = type === 'volume_discount' || type === 'min_purchase' || type === 'bundle';
  const showMinPurchase = type === 'min_purchase' || type === 'free_shipping';
  const showNxM = type === 'nxm';
  const showVolume = type === 'volume_discount';
  const showBundle = type === 'bundle';
  const showScope = type !== 'bundle';

  return (
    <Modal open={true} onClose={onClose} title={promotion ? 'Editar Promoción' : 'Crear Promoción'} size="lg">
      <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
        {/* Name & Type */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-display font-semibold text-navy-600 mb-1">Nombre</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="input-field" placeholder="Ej: 2x1 en Camisas" />
          </div>
          <div>
            <label className="block text-xs font-display font-semibold text-navy-600 mb-1">Tipo de Promoción</label>
            <select value={type} onChange={(e) => setType(e.target.value as PromotionType)} className="input-field">
              {Object.entries(PROMO_TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-display font-semibold text-navy-600 mb-1">Descripción</label>
          <input value={description} onChange={(e) => setDescription(e.target.value)} className="input-field"
            placeholder="Ej: Lleva 2 y paga solo 1 en toda la categoría" />
        </div>

        {/* Type-specific fields */}
        {showNxM && (
          <div className="grid grid-cols-2 gap-3 p-3 bg-blue-50 rounded-lg">
            <div>
              <label className="block text-xs font-display font-semibold text-blue-700 mb-1">Compra (N)</label>
              <input type="number" min="2" value={buyQty} onChange={(e) => setBuyQty(e.target.value)}
                className="input-field font-mono" />
            </div>
            <div>
              <label className="block text-xs font-display font-semibold text-blue-700 mb-1">Paga (M)</label>
              <input type="number" min="1" value={payQty} onChange={(e) => setPayQty(e.target.value)}
                className="input-field font-mono" />
            </div>
            <p className="col-span-2 text-[10px] text-blue-600">
              El cliente compra {buyQty || '?'} productos y paga solo {payQty || '?'} (el más barato es gratis).
            </p>
          </div>
        )}

        {showVolume && (
          <div className="p-3 bg-purple-50 rounded-lg">
            <label className="block text-xs font-display font-semibold text-purple-700 mb-1">Mínimo de unidades</label>
            <input type="number" min="2" value={minUnits} onChange={(e) => setMinUnits(e.target.value)}
              className="input-field font-mono w-32" />
          </div>
        )}

        {showDiscount && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-display font-semibold text-navy-600 mb-1">Tipo Descuento</label>
              <select value={discountType} onChange={(e) => setDiscountType(e.target.value as CouponDiscountType)} className="input-field">
                <option value="percentage">Porcentaje (%)</option>
                <option value="fixed">Monto Fijo ($)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-display font-semibold text-navy-600 mb-1">Valor</label>
              <input type="number" min="0" value={discountValue} onChange={(e) => setDiscountValue(e.target.value)}
                className="input-field font-mono" placeholder="0" />
            </div>
          </div>
        )}

        {showMinPurchase && (
          <div>
            <label className="block text-xs font-display font-semibold text-navy-600 mb-1">Compra Mínima ($)</label>
            <input type="number" min="0" value={minPurchase} onChange={(e) => setMinPurchase(e.target.value)}
              className="input-field font-mono w-40" />
          </div>
        )}

        {/* Scope */}
        {showScope && (
          <>
            <div>
              <label className="block text-xs font-display font-semibold text-navy-600 mb-1">Alcance</label>
              <select value={scope} onChange={(e) => { setScope(e.target.value as CouponScope); setScopeTargets([]); }} className="input-field">
                <option value="global">Todo el catálogo</option>
                <option value="category">Categorías específicas</option>
                <option value="product">Productos específicos</option>
              </select>
            </div>
            {scope === 'category' && (
              <div className="flex flex-wrap gap-2">
                {categories.map((cat) => (
                  <button key={cat} type="button" onClick={() => toggleScopeTarget(cat)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${scopeTargets.includes(cat) ? 'bg-blue-500 text-white' : 'bg-surface-100 text-navy-600 hover:bg-surface-200'}`}>
                    {cat}
                  </button>
                ))}
              </div>
            )}
            {scope === 'product' && (
              <div className="max-h-40 overflow-y-auto border border-surface-200 rounded-lg p-2 space-y-1">
                {products.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-surface-50 cursor-pointer">
                    <input type="checkbox" checked={scopeTargets.includes(p.id)}
                      onChange={() => toggleScopeTarget(p.id)}
                      className="w-3.5 h-3.5 rounded text-blue-500" />
                    <span className="text-xs text-navy-700">{p.name}</span>
                  </label>
                ))}
              </div>
            )}
          </>
        )}

        {/* Bundle product selector */}
        {showBundle && (
          <div>
            <label className="block text-xs font-display font-semibold text-navy-600 mb-1">
              Productos del Combo ({bundleProductIds.length} seleccionados)
            </label>
            <div className="max-h-40 overflow-y-auto border border-surface-200 rounded-lg p-2 space-y-1">
              {products.map((p) => (
                <label key={p.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-surface-50 cursor-pointer">
                  <input type="checkbox" checked={bundleProductIds.includes(p.id)}
                    onChange={() => toggleBundleProduct(p.id)}
                    className="w-3.5 h-3.5 rounded text-violet-500" />
                  <span className="text-xs text-navy-700">{p.name}</span>
                  <span className="text-[10px] text-navy-400 ml-auto">{p.category}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Priority & Dates */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-display font-semibold text-navy-600 mb-1">Prioridad</label>
            <input type="number" min="1" value={priority} onChange={(e) => setPriority(e.target.value)}
              className="input-field font-mono" />
            <p className="text-[10px] text-navy-400 mt-0.5">Menor = se evalúa primero</p>
          </div>
          <div>
            <label className="block text-xs font-display font-semibold text-navy-600 mb-1">Inicio</label>
            <input type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className="input-field" />
          </div>
          <div>
            <label className="block text-xs font-display font-semibold text-navy-600 mb-1">Expiración</label>
            <input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className="input-field" />
          </div>
        </div>

        {/* Toggles */}
        <div className="flex flex-wrap gap-4 pt-2 border-t border-surface-200">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={stackable} onChange={(e) => setStackable(e.target.checked)} className="w-4 h-4 rounded text-blue-500" />
            <span className="text-sm text-navy-700">Acumulable con otros</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="w-4 h-4 rounded text-emerald-500" />
            <span className="text-sm text-navy-700">Activo</span>
          </label>
        </div>
      </div>

      <div className="flex gap-3 pt-4 border-t border-surface-200 mt-4">
        <button onClick={onClose} className="btn-secondary flex-1">Cancelar</button>
        <button onClick={handleSave} disabled={saving} className="btn-primary flex-1">
          {saving ? 'Guardando...' : promotion ? 'Guardar Cambios' : 'Crear Promoción'}
        </button>
      </div>
    </Modal>
  );
}
