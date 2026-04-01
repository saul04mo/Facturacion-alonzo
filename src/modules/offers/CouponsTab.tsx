import { useState, useMemo } from 'react';
import { useAppStore } from '@/store/appStore';
import { useCurrency } from '@/hooks/useCurrency';
import { useToast } from '@/components/Toast';
import { Modal } from '@/components/Modal';
import { createCoupon, updateCoupon, deleteCoupon } from '@/services/promotionService';
import { Timestamp } from 'firebase/firestore';
import { Plus, Search, Ticket, Trash2, Edit, Copy, ToggleLeft, ToggleRight } from 'lucide-react';
import type { Coupon, CouponScope, CouponDiscountType } from '@/types';

export function CouponsTab() {
  const coupons = useAppStore((s) => s.coupons);
  const products = useAppStore((s) => s.products);
  const { format } = useCurrency();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingCoupon, setEditingCoupon] = useState<Coupon | null>(null);

  const filtered = useMemo(() => {
    if (!search) return coupons;
    const q = search.toLowerCase();
    return coupons.filter(
      (c) => c.code.toLowerCase().includes(q) || c.description.toLowerCase().includes(q),
    );
  }, [coupons, search]);

  const activeCoupons = coupons.filter((c) => c.active).length;

  async function handleToggleActive(coupon: Coupon) {
    try {
      await updateCoupon(coupon.id, { active: !coupon.active });
      toast.success(coupon.active ? 'Cupón desactivado' : 'Cupón activado');
    } catch {
      toast.error('Error al actualizar cupón.');
    }
  }

  async function handleDelete(coupon: Coupon) {
    if (!confirm(`¿Eliminar el cupón "${coupon.code}"?`)) return;
    try {
      await deleteCoupon(coupon.id);
      toast.success('Cupón eliminado');
    } catch {
      toast.error('Error al eliminar cupón.');
    }
  }

  function handleCopyCode(code: string) {
    navigator.clipboard.writeText(code);
    toast.success(`Código "${code}" copiado`);
  }

  function formatDate(ts: Timestamp | null | undefined): string {
    if (!ts) return '—';
    return ts.toDate().toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 justify-between">
        <div>
          <p className="text-navy-400 text-sm">{activeCoupons} cupones activos de {coupons.length} totales</p>
        </div>
        <button onClick={() => { setEditingCoupon(null); setShowForm(true); }} className="btn-primary gap-1.5">
          <Plus size={14} /> Crear Cupón
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-navy-300" />
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          className="input-field pl-9" placeholder="Buscar por código o descripción..." />
      </div>

      {/* Coupon List */}
      {filtered.length === 0 ? (
        <div className="text-center py-12">
          <Ticket size={40} className="mx-auto text-navy-200 mb-3" />
          <p className="text-navy-400 text-sm">No hay cupones creados.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map((coupon) => (
            <div key={coupon.id}
              className={`card p-4 space-y-3 border-l-4 transition-all hover-lift ${coupon.active ? 'border-l-emerald-500' : 'border-l-surface-300 opacity-70'}`}>
              {/* Top row */}
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-lg text-navy-900 tracking-wider">{coupon.code}</span>
                    <button onClick={() => handleCopyCode(coupon.code)} className="p-1 text-navy-300 hover:text-navy-500">
                      <Copy size={12} />
                    </button>
                  </div>
                  <p className="text-xs text-navy-500 mt-0.5">{coupon.description}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => { setEditingCoupon(coupon); setShowForm(true); }}
                    className="p-1.5 text-navy-400 hover:text-blue-500 transition-colors"><Edit size={14} /></button>
                  <button onClick={() => handleToggleActive(coupon)}
                    className="p-1.5 text-navy-400 hover:text-emerald-500 transition-colors">
                    {coupon.active ? <ToggleRight size={14} className="text-emerald-500" /> : <ToggleLeft size={14} />}
                  </button>
                  <button onClick={() => handleDelete(coupon)}
                    className="p-1.5 text-navy-400 hover:text-accent-red transition-colors"><Trash2 size={14} /></button>
                </div>
              </div>

              {/* Details */}
              <div className="flex flex-wrap gap-2 text-[10px]">
                <span className="badge badge-blue">
                  {coupon.discountType === 'percentage' ? `${coupon.discountValue}%` : format(coupon.discountValue)} OFF
                </span>
                {coupon.freeShipping && <span className="badge badge-green">Envío gratis</span>}
                <span className="badge badge-gray">
                  {coupon.scope === 'global' ? 'Todo el catálogo' : coupon.scope === 'category' ? `Cat: ${coupon.scopeTargets.join(', ')}` : `${coupon.scopeTargets.length} productos`}
                </span>
                {coupon.minPurchase > 0 && (
                  <span className="badge badge-gray">Mín: {format(coupon.minPurchase)}</span>
                )}
              </div>

              {/* Stats row */}
              <div className="flex items-center justify-between text-[10px] text-navy-400 pt-1 border-t border-surface-100">
                <span>Usos: <strong className="text-navy-700">{coupon.usedCount}</strong>
                  {coupon.maxUsesTotal > 0 ? ` / ${coupon.maxUsesTotal}` : ' (∞)'}</span>
                <span>Vigencia: {formatDate(coupon.startsAt)} → {formatDate(coupon.expiresAt)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <CouponFormModal
          coupon={editingCoupon}
          products={products}
          onClose={() => { setShowForm(false); setEditingCoupon(null); }}
          onSaved={() => { setShowForm(false); setEditingCoupon(null); }}
        />
      )}
    </div>
  );
}

// ================================================================
// COUPON FORM MODAL
// ================================================================
function CouponFormModal({
  coupon, products, onClose, onSaved,
}: {
  coupon: Coupon | null;
  products: any[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);

  const categories = useMemo(() => {
    return [...new Set(products.map((p) => p.category).filter(Boolean))].sort();
  }, [products]);

  const [code, setCode] = useState(coupon?.code || '');
  const [description, setDescription] = useState(coupon?.description || '');
  const [discountType, setDiscountType] = useState<CouponDiscountType>(coupon?.discountType || 'percentage');
  const [discountValue, setDiscountValue] = useState(coupon?.discountValue?.toString() || '');
  const [scope, setScope] = useState<CouponScope>(coupon?.scope || 'global');
  const [scopeTargets, setScopeTargets] = useState<string[]>(coupon?.scopeTargets || []);
  const [minPurchase, setMinPurchase] = useState(coupon?.minPurchase?.toString() || '0');
  const [maxUsesTotal, setMaxUsesTotal] = useState(coupon?.maxUsesTotal?.toString() || '0');
  const [maxUsesPerClient, setMaxUsesPerClient] = useState(coupon?.maxUsesPerClient?.toString() || '0');
  const [freeShipping, setFreeShipping] = useState(coupon?.freeShipping || false);
  const [active, setActive] = useState(coupon?.active ?? true);
  const [startsAt, setStartsAt] = useState(
    coupon?.startsAt ? coupon.startsAt.toDate().toISOString().slice(0, 10) : '',
  );
  const [expiresAt, setExpiresAt] = useState(
    coupon?.expiresAt ? coupon.expiresAt.toDate().toISOString().slice(0, 10) : '',
  );

  function toggleScopeTarget(target: string) {
    setScopeTargets((prev) =>
      prev.includes(target) ? prev.filter((t) => t !== target) : [...prev, target],
    );
  }

  async function handleSave() {
    if (!code.trim()) return toast.warning('Ingresa un código.');
    if (!description.trim()) return toast.warning('Ingresa una descripción.');
    const val = parseFloat(discountValue);
    if (isNaN(val) || val <= 0) return toast.warning('Ingresa un valor de descuento válido.');
    if (discountType === 'percentage' && val > 100) return toast.warning('El porcentaje no puede ser mayor a 100.');
    if (scope !== 'global' && scopeTargets.length === 0) return toast.warning('Selecciona al menos un objetivo.');

    setSaving(true);
    try {
      const data: any = {
        code: code.toUpperCase().trim(),
        description: description.trim(),
        discountType,
        discountValue: val,
        scope,
        scopeTargets: scope === 'global' ? [] : scopeTargets,
        minPurchase: parseFloat(minPurchase) || 0,
        maxUsesTotal: parseInt(maxUsesTotal) || 0,
        maxUsesPerClient: parseInt(maxUsesPerClient) || 0,
        freeShipping,
        active,
        startsAt: startsAt ? Timestamp.fromDate(new Date(startsAt + 'T00:00:00')) : null,
        expiresAt: expiresAt ? Timestamp.fromDate(new Date(expiresAt + 'T23:59:59')) : null,
      };

      if (coupon) {
        await updateCoupon(coupon.id, data);
        toast.success('Cupón actualizado');
      } else {
        await createCoupon(data);
        toast.success('Cupón creado');
      }
      onSaved();
    } catch (err) {
      console.error(err);
      toast.error('Error al guardar cupón.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={true} onClose={onClose} title={coupon ? 'Editar Cupón' : 'Crear Cupón'} size="lg">
      <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
        {/* Code & Description */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-display font-semibold text-navy-600 mb-1">Código del Cupón</label>
            <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())}
              className="input-field font-mono uppercase tracking-wider" placeholder="Ej: VERANO2025" />
          </div>
          <div>
            <label className="block text-xs font-display font-semibold text-navy-600 mb-1">Descripción</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)}
              className="input-field" placeholder="Ej: Descuento de temporada" />
          </div>
        </div>

        {/* Discount Type & Value */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-display font-semibold text-navy-600 mb-1">Tipo Descuento</label>
            <select value={discountType} onChange={(e) => setDiscountType(e.target.value as CouponDiscountType)} className="input-field">
              <option value="percentage">Porcentaje (%)</option>
              <option value="fixed">Monto Fijo ($)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-display font-semibold text-navy-600 mb-1">Valor</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-navy-400 font-mono text-sm">
                {discountType === 'percentage' ? '%' : '$'}
              </span>
              <input type="number" min="0" value={discountValue} onChange={(e) => setDiscountValue(e.target.value)}
                className="input-field pl-8 font-mono" placeholder="0" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-display font-semibold text-navy-600 mb-1">Compra Mínima ($)</label>
            <input type="number" min="0" value={minPurchase} onChange={(e) => setMinPurchase(e.target.value)}
              className="input-field font-mono" placeholder="0 = sin mínimo" />
          </div>
        </div>

        {/* Scope */}
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
                  className="w-3.5 h-3.5 rounded border-surface-300 text-blue-500" />
                <span className="text-xs text-navy-700">{p.name}</span>
                <span className="text-[10px] text-navy-400 ml-auto">{p.category}</span>
              </label>
            ))}
          </div>
        )}

        {/* Usage Limits */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-display font-semibold text-navy-600 mb-1">Usos Totales Máximos</label>
            <input type="number" min="0" value={maxUsesTotal} onChange={(e) => setMaxUsesTotal(e.target.value)}
              className="input-field font-mono" placeholder="0 = ilimitados" />
            <p className="text-[10px] text-navy-400 mt-0.5">0 = sin límite</p>
          </div>
          <div>
            <label className="block text-xs font-display font-semibold text-navy-600 mb-1">Usos por Cliente</label>
            <input type="number" min="0" value={maxUsesPerClient} onChange={(e) => setMaxUsesPerClient(e.target.value)}
              className="input-field font-mono" placeholder="0 = ilimitados" />
            <p className="text-[10px] text-navy-400 mt-0.5">0 = sin límite</p>
          </div>
        </div>

        {/* Dates */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-display font-semibold text-navy-600 mb-1">Inicio de Vigencia</label>
            <input type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)}
              className="input-field" />
            <p className="text-[10px] text-navy-400 mt-0.5">Vacío = comienza de inmediato</p>
          </div>
          <div>
            <label className="block text-xs font-display font-semibold text-navy-600 mb-1">Fecha de Expiración</label>
            <input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)}
              className="input-field" />
            <p className="text-[10px] text-navy-400 mt-0.5">Vacío = nunca expira</p>
          </div>
        </div>

        {/* Toggles */}
        <div className="flex flex-wrap gap-4 pt-2 border-t border-surface-200">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={freeShipping} onChange={(e) => setFreeShipping(e.target.checked)}
              className="w-4 h-4 rounded text-blue-500" />
            <span className="text-sm text-navy-700">Incluye envío gratis</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)}
              className="w-4 h-4 rounded text-emerald-500" />
            <span className="text-sm text-navy-700">Activo</span>
          </label>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3 pt-4 border-t border-surface-200 mt-4">
        <button onClick={onClose} className="btn-secondary flex-1">Cancelar</button>
        <button onClick={handleSave} disabled={saving} className="btn-primary flex-1">
          {saving ? 'Guardando...' : coupon ? 'Guardar Cambios' : 'Crear Cupón'}
        </button>
      </div>
    </Modal>
  );
}
