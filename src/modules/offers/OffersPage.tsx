import { useState, useMemo, useEffect } from 'react';
import { useAppStore } from '@/store/appStore';
import { useCurrency } from '@/hooks/useCurrency';
import { useToast } from '@/components/Toast';
import { doc, updateDoc, writeBatch } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { Search, Tag, Package, Percent, Ticket, Zap } from 'lucide-react';
import { CouponsTab } from './CouponsTab';
import { PromotionsTab } from './PromotionsTab';
import type { Product } from '@/types';

type OfferTab = 'products' | 'coupons' | 'promotions';

export function OffersPage() {
  const [activeTab, setActiveTab] = useState<OfferTab>('products');

  const tabs: { id: OfferTab; label: string; icon: typeof Tag }[] = [
    { id: 'products', label: 'Ofertas por Producto', icon: Tag },
    { id: 'coupons', label: 'Cupones', icon: Ticket },
    { id: 'promotions', label: 'Promociones', icon: Zap },
  ];

  return (
    <div className="space-y-5 animate-fade-up">
      {/* Header with Tabs */}
      <div className="card p-5 hover-lift">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-1 h-12 bg-pink-500 rounded-full" />
          <div className="flex-1">
            <h1 className="text-xl font-display font-bold text-navy-900">Gestor de Ofertas y Promociones</h1>
            <p className="text-navy-400 text-sm">Administra descuentos, cupones y promociones automáticas.</p>
          </div>
        </div>
        <div className="flex gap-1 bg-surface-100 rounded-lg p-1">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-sm font-display font-medium transition-all ${
                activeTab === id
                  ? 'bg-white text-navy-900 shadow-sm'
                  : 'text-navy-400 hover:text-navy-600'
              }`}
            >
              <Icon size={14} />
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'products' && <ProductOffersTab />}
      {activeTab === 'coupons' && <CouponsTab />}
      {activeTab === 'promotions' && <PromotionsTab />}
    </div>
  );
}

// ================================================================
// PRODUCT OFFERS TAB (original OffersPage content)
// ================================================================
function ProductOffersTab() {
  const products = useAppStore((s) => s.products);
  const { format } = useCurrency();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'with_offer' | 'without_offer'>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [search, filter]);

  const filteredProducts = useMemo(() => {
    let res = products;
    if (filter === 'with_offer') res = res.filter((p) => (p.offer?.value || 0) > 0);
    if (filter === 'without_offer') res = res.filter((p) => !(p.offer?.value || 0));
    if (search) {
      const q = search.toLowerCase();
      res = res.filter((p) => p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q));
    }
    return res.sort((a, b) => a.name.localeCompare(b.name));
  }, [products, filter, search]);

  const activeOffersCount = products.filter((p) => (p.offer?.value || 0) > 0).length;

  // Optimistic UI updates are handled automatically by Firestore snapshot listeners
  // which will update useAppStore when the document changes, but we might want to debounce or show a spinner.
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  async function handleUpdateOffer(product: Product, type: 'percentage' | 'fixed', newValue: number) {
    if (newValue < 0) newValue = 0;
    if (type === 'percentage' && newValue > 100) newValue = 100;
    
    // Don't update if nothing changed
    if (product.offer?.type === type && product.offer?.value === newValue) return;

    setUpdatingId(product.id);
    try {
      await updateDoc(doc(db, 'products', product.id), {
        offer: newValue === 0 ? null : { type, value: newValue }
      });
    } catch (err) {
      console.error(err);
      toast.error('Error al actualizar la oferta.');
    } finally {
      setUpdatingId(null);
    }
  }

  // --- BATCH APPLICATION LOGIC ---
  const [batchGender, setBatchGender] = useState<string>('all');
  const [batchCategory, setBatchCategory] = useState<string>('all');
  const [batchType, setBatchType] = useState<'percentage' | 'fixed'>('percentage');
  const [batchValue, setBatchValue] = useState<string>('20');
  const [isBatching, setIsBatching] = useState(false);

  const batchCategories = useMemo(() => {
    let cats = products;
    if (batchGender !== 'all') {
      cats = cats.filter(p => p.gender === batchGender);
    }
    return ['all', ...new Set(cats.map(p => p.category || 'Sin Categoría').filter(Boolean))];
  }, [products, batchGender]);

  async function handleBatchApply() {
    const val = parseFloat(batchValue);
    if (isNaN(val) || val < 0) {
      toast.warning("Valor inválido");
      return;
    }
    if (batchType === 'percentage' && val > 100) {
      toast.warning("El porcentaje no puede ser mayor a 100");
      return;
    }

    let targets = products;
    if (batchGender !== 'all') targets = targets.filter(p => p.gender === batchGender);
    if (batchCategory !== 'all') targets = targets.filter(p => (p.category || 'Sin Categoría') === batchCategory);

    if (targets.length === 0) {
      toast.warning("No hay productos que coincidan con estos filtros.");
      return;
    }

    if (!confirm(`¿Estás seguro de aplicar descuento de ${batchType === 'percentage' ? val + '%' : '$' + val} a ${targets.length} producto(s)?`)) return;

    setIsBatching(true);
    try {
      const batch = writeBatch(db);
      targets.forEach((product) => {
        const ref = doc(db, 'products', product.id);
        batch.update(ref, { offer: val === 0 ? null : { type: batchType, value: val } });
      });
      await batch.commit();
      toast.success(`¡${targets.length} productos actualizados!`);
    } catch (err) {
      console.error(err);
      toast.error('Error en actualización masiva.');
    } finally {
      setIsBatching(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Search & Filter */}
      <div className="card p-5 hover-lift">
        <div className="flex items-center gap-2 mb-3">
          <p className="text-navy-400 text-sm">Hay {activeOffersCount} productos con ofertas aplicadas.</p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="md:col-span-2 relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-navy-300 pointer-events-none" />
            <input 
              value={search} 
              onChange={(e) => setSearch(e.target.value)}
              className="input-field pl-9" 
              placeholder="Buscar por nombre o categoría..." 
            />
          </div>
          <select 
            value={filter} 
            onChange={(e) => setFilter(e.target.value as any)}
            className="input-field"
          >
            <option value="all">Ver Todos</option>
            <option value="with_offer">Solo Con Oferta</option>
            <option value="without_offer">Sin Oferta</option>
          </select>
        </div>
      </div>

      {/* Batch Application Panel */}
      <div className="card p-5 hover-lift">
        <h2 className="text-sm font-display font-semibold text-navy-900 mb-3 flex items-center gap-2">
          <Percent size={14} className="text-pink-500" />
          Aplicación Masiva de Ofertas
        </h2>
        
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <div>
            <label className="block text-[10px] font-semibold text-navy-500 uppercase mb-1">Género</label>
            <select value={batchGender} onChange={(e) => { setBatchGender(e.target.value); setBatchCategory('all'); }} className="input-field">
              <option value="all">Todos los Géneros</option>
              <option value="Hombre">Hombre</option>
              <option value="Mujer">Mujer</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-navy-500 uppercase mb-1">Categoría</label>
            <select value={batchCategory} onChange={(e) => setBatchCategory(e.target.value)} className="input-field">
              <option value="all">Todas las Categorías</option>
              {batchCategories.filter(c => c !== 'all').map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-navy-500 uppercase mb-1">Descuento</label>
            <div className="flex bg-white rounded-lg border border-surface-200 overflow-hidden">
              <select 
                value={batchType} 
                onChange={(e) => setBatchType(e.target.value as 'percentage' | 'fixed')}
                className="w-16 bg-surface-50 border-r border-surface-200 text-sm font-semibold text-center text-navy-700 outline-none"
              >
                <option value="percentage">%</option>
                <option value="fixed">$</option>
              </select>
              <input 
                type="number" min="0" 
                value={batchValue} onChange={(e) => setBatchValue(e.target.value)}
                className="w-full h-10 px-3 text-sm font-mono outline-none" placeholder={batchType === 'percentage' ? '20' : '5'}
              />
            </div>
          </div>
          <button 
            onClick={handleBatchApply}
            disabled={isBatching}
            className="btn-primary w-full bg-pink-600 hover:bg-pink-700"
          >
            {isBatching ? 'Aplicando...' : 'Aplicar a Grupo'}
          </button>
        </div>
        <p className="text-[10px] text-navy-400 mt-3 flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
          Tip: Si quieres borrar todas las ofertas de una categoría, ingresa 0% y haz clic en Aplicar.
        </p>
      </div>

      {/* Product List */}
      <div className="card overflow-hidden">
        {filteredProducts.length === 0 ? (
          <div className="p-16 text-center">
            <Tag size={48} className="mx-auto text-navy-200 mb-3" />
            <p className="text-navy-400 text-sm font-display">No hay productos que mostrar en esta lista.</p>
          </div>
        ) : (
          <div className="divide-y divide-surface-100">
            {filteredProducts
              .slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)
              .map((product) => (
              <ProductRow 
                key={product.id} 
                product={product} 
                format={format} 
                handleUpdateOffer={handleUpdateOffer} 
                updatingId={updatingId} 
              />
            ))}
          </div>
        )}

        {/* Pagination Controls */}
        {filteredProducts.length > itemsPerPage && (
          <div className="px-4 py-3 bg-surface-50 border-t border-surface-200 flex items-center justify-between mt-4">
            <p className="text-xs text-navy-400 font-display">
              Mostrando <span className="font-semibold text-navy-700">{(currentPage - 1) * itemsPerPage + 1}</span> a <span className="font-semibold text-navy-700">{Math.min(currentPage * itemsPerPage, filteredProducts.length)}</span> de <span className="font-semibold text-navy-700">{filteredProducts.length}</span> productos
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                disabled={currentPage === 1}
                className="btn-secondary px-3 py-1.5 text-xs disabled:opacity-50"
              >
                Anterior
              </button>
              <div className="flex items-center px-2 text-xs font-mono font-bold text-navy-900">
                {currentPage} / {Math.ceil(filteredProducts.length / itemsPerPage)}
              </div>
              <button
                onClick={() => setCurrentPage(prev => Math.min(prev + 1, Math.ceil(filteredProducts.length / itemsPerPage)))}
                disabled={currentPage >= Math.ceil(filteredProducts.length / itemsPerPage)}
                className="btn-secondary px-3 py-1.5 text-xs disabled:opacity-50"
              >
                Siguiente
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ProductRow({ 
  product, 
  format, 
  handleUpdateOffer, 
  updatingId 
}: { 
  product: Product; 
  format: (val: number) => string; 
  handleUpdateOffer: (product: Product, type: 'percentage' | 'fixed', val: number) => void;
  updatingId: string | null;
}) {
  const currentOfferValue = product.offer?.value || 0;
  const currentOfferType = product.offer?.type || 'percentage';
  
  const [localType, setLocalType] = useState<'percentage' | 'fixed'>(currentOfferType);

  // Sync with external updates
  useEffect(() => {
    if (product.offer?.type) {
      setLocalType(product.offer.type);
    }
  }, [product.offer?.type]);

  const hasOffer = currentOfferValue > 0;
  const minPrice = Math.min(...(product.variants?.map((v) => v.price) || [0]));
  const discountPrice = hasOffer 
    ? (localType === 'percentage' ? minPrice - (minPrice * (currentOfferValue / 100)) : minPrice - currentOfferValue)
    : minPrice;

  return (
    <div className={`p-4 flex flex-col md:flex-row items-start md:items-center gap-4 transition-colors hover-lift ${hasOffer ? 'bg-pink-50/30 shadow-sm' : 'hover:bg-surface-50'}`}>
      {/* Image */}
      <div className="w-14 h-14 rounded-lg bg-surface-100 overflow-hidden flex-shrink-0 border border-surface-200 relative">
        {product.imageUrl ? (
          <img src={product.imageUrl} alt="" className="w-full h-full object-contain p-1 mix-blend-multiply dark:mix-blend-normal" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Package size={20} className="text-navy-300" />
          </div>
        )}
        {hasOffer && (
          <div className="absolute inset-x-0 bottom-0 bg-accent-red text-white text-[9px] font-bold text-center py-0.5">
            -{localType === 'percentage' ? `${currentOfferValue}%` : `$${currentOfferValue}`}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1">
        <h3 className="font-display font-semibold text-navy-900 text-sm">{product.name}</h3>
        <div className="flex items-center gap-2 mt-1">
          <span className="badge badge-gray text-[10px]">{product.category}</span>
          <span className="text-xs text-navy-400 font-mono">
            {product.variants?.length || 0} vars
          </span>
        </div>
      </div>
      
      {/* Prices pre-viz */}
      <div className="w-full md:w-32 text-left md:text-right hidden sm:block">
        {hasOffer ? (
          <div>
            <p className="text-[10px] text-navy-400 line-through">{format(minPrice)}</p>
            <p className="text-sm font-mono font-bold text-accent-red">{format(discountPrice)}</p>
          </div>
        ) : (
          <p className="text-sm font-mono font-semibold text-navy-900">{format(minPrice)}</p>
        )}
        <p className="text-[10px] text-navy-300">Precio Base</p>
      </div>

      {/* Offer Controller */}
      <div className="w-full md:w-56 bg-white border border-surface-200 rounded-lg p-2 shadow-sm flex items-center justify-between">
        <div>
          <p className="text-[10px] font-display font-semibold text-navy-500 uppercase mb-0.5">Descuento</p>
          {hasOffer ? (
            <span className="text-xs font-bold text-accent-red flex items-center gap-1">
              <Percent size={10} /> Activo
            </span>
          ) : (
            <span className="text-xs text-navy-400">Inactivo</span>
          )}
        </div>
        
        <div className="flex items-center bg-surface-50 rounded-md border border-surface-200 overflow-hidden">
          <select 
            value={localType}
            onChange={(e) => {
              const newType = e.target.value as 'percentage' | 'fixed';
              setLocalType(newType);
              if (currentOfferValue > 0) {
                handleUpdateOffer(product, newType, currentOfferValue);
              }
            }}
            disabled={updatingId === product.id}
            className="w-10 h-8 bg-surface-100 border-r border-surface-200 text-xs font-semibold text-center outline-none disabled:opacity-50"
          >
            <option value="percentage">%</option>
            <option value="fixed">$</option>
          </select>
          <input 
            type="number"
            min="0"
            value={currentOfferValue === 0 ? '' : currentOfferValue}
            onChange={(e) => {
              const val = e.target.value === '' ? 0 : parseFloat(e.target.value);
              if (!isNaN(val)) {
                handleUpdateOffer(product, localType, val);
              }
            }}
            placeholder="0"
            disabled={updatingId === product.id}
            className="w-12 h-8 text-center font-mono font-bold text-sm bg-transparent border-none focus:ring-0 text-navy-900 disabled:opacity-50"
          />
        </div>
      </div>
    </div>
  );
}
