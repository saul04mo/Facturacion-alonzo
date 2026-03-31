import { useState, useMemo } from 'react';
import { useAppStore } from '@/store/appStore';
import { useCurrency } from '@/hooks/useCurrency';
import { useToast } from '@/components/Toast';
import { CartPanel } from './CartPanel';
import { VariantSelector } from './VariantSelector';
import type { Product, Discount } from '@/types';
import {
  ArrowLeft, Search, Tag, Calculator, ChevronRight,
} from 'lucide-react';

type CatalogView = 'gender' | 'category' | 'products';

export function POSPage() {
  const products = useAppStore((s) => s.products);
  const currentSale = useAppStore((s) => s.currentSale);
  const setCurrentSale = useAppStore((s) => s.setCurrentSale);
  const { format } = useCurrency();
  const { exchangeRate } = useCurrency();
  const toast = useToast();

  const [view, setView] = useState<CatalogView>('gender');
  const [activeGender, setActiveGender] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>('Todos');
  const [searchFilter, setSearchFilter] = useState('');
  const [variantProduct, setVariantProduct] = useState<Product | null>(null);
  const [calcAmount, setCalcAmount] = useState('');

  const categories = useMemo(() => {
    if (!activeGender) return [];
    const genderProducts = products.filter((p) => p.gender === activeGender);
    return ['Todos', ...new Set(genderProducts.map((p) => p.category || 'Sin Categoría').filter(Boolean))];
  }, [products, activeGender]);

  const displayProducts = useMemo(() => {
    let filtered = products;
    if (activeGender) filtered = filtered.filter((p) => p.gender === activeGender);
    if (activeCategory !== 'Todos') filtered = filtered.filter((p) => (p.category || 'Sin Categoría') === activeCategory);
    const unique = [...new Map(filtered.map((p) => [p.name, p])).values()];
    if (searchFilter) {
      const s = searchFilter.toLowerCase();
      return unique.filter((p) => p.name.toLowerCase().includes(s));
    }
    return unique.sort((a, b) => a.name.localeCompare(b.name));
  }, [products, activeGender, activeCategory, searchFilter]);

  function selectGender(gender: string) {
    setActiveGender(gender);
    setActiveCategory('Todos');
    setView('category');
  }

  function selectCategory(cat: string) {
    setActiveCategory(cat);
    setView('products');
  }

  function goBack() {
    if (view === 'products') { setView('category'); setSearchFilter(''); }
    else if (view === 'category') { setView('gender'); setActiveGender(null); }
  }

  function handleProductClick(product: Product) {
    if (product.variants?.length === 1) {
      addToCart(product.id, 0);
    } else {
      setVariantProduct(product);
    }
  }

  function addToCart(productId: string, variantIndex: number) {
    const product = products.find((p) => p.id === productId);
    if (!product) return;

    const variant = product.variants[variantIndex];

    // FIX: Validate stock before adding
    const existingItem = currentSale.items.find(
      (i) => i.productId === productId && i.variantIndex === variantIndex,
    );
    const currentQty = existingItem ? existingItem.quantity : 0;
    if (variant.stock <= currentQty) {
      toast.warning(`Sin stock disponible para "${product.name}" (${variant.size}/${variant.color})`);
      return;
    }

    const itemDiscount: Discount =
      (product.offer?.value || 0) > 0
        ? { type: product.offer!.type, value: product.offer!.value }
        : { type: 'none', value: 0 };

    const items = [...currentSale.items];
    const existingItemIndex = items.findIndex(
      (i) => i.productId === productId && i.variantIndex === variantIndex,
    );

    if (existingItemIndex > -1) {
      items[existingItemIndex] = {
        ...items[existingItemIndex],
        quantity: items[existingItemIndex].quantity + 1,
      };
    } else {
      items.push({
        productId,
        variantIndex,
        quantity: 1,
        discount: itemDiscount,
      });
    }

    setCurrentSale({ ...currentSale, items });
  }

  return (
    <div className="animate-fade-up">
      <div className="flex flex-col lg:flex-row gap-6 h-[calc(100vh-140px)]">
        {/* Left: Catalog */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <div className="card p-4 mb-4">
            <div className="flex items-center gap-3">
              <div className="w-1 h-10 bg-blue-500 rounded-full" />
              <div className="flex-1">
                <h1 className="text-lg font-display font-bold text-navy-900">Punto de Venta</h1>
                <p className="text-navy-400 text-xs">Selecciona género, categoría y producto.</p>
              </div>
              {/* Calculator */}
              <div className="hidden md:flex items-center gap-2 bg-surface-50 border border-surface-200 rounded-lg p-2">
                <Calculator size={14} className="text-navy-400" />
                <input value={calcAmount} onChange={(e) => setCalcAmount(e.target.value)}
                  type="number" placeholder="USD" className="w-16 text-sm bg-transparent outline-none text-navy-700 font-mono" />
                <ChevronRight size={14} className="text-navy-300" />
                <span className="text-sm font-mono font-semibold text-navy-900">
                  Bs. {((parseFloat(calcAmount) || 0) * exchangeRate).toFixed(2)}
                </span>
              </div>
            </div>
          </div>

          {/* Navigation breadcrumb */}
          {view !== 'gender' && (
            <button onClick={goBack}
              className="flex items-center gap-2 text-sm text-navy-500 hover:text-navy-700 mb-3 transition-colors font-display">
              <ArrowLeft size={16} /> Volver
              {activeGender && <span className="text-navy-300 mx-1">·</span>}
              {activeGender && <span className="font-medium text-navy-700">{activeGender}</span>}
              {view === 'products' && activeCategory !== 'Todos' && (
                <><span className="text-navy-300 mx-1">·</span><span className="font-medium text-navy-700">{activeCategory}</span></>
              )}
            </button>
          )}

          {/* Content area */}
          <div className="flex-1 overflow-y-auto">
            {/* Gender selection */}
            {view === 'gender' && (
              <div className="grid grid-cols-2 gap-4 stagger">
                {['Hombre', 'Mujer'].map((gender) => (
                  <button key={gender} onClick={() => selectGender(gender)}
                    className="card-hover p-8 text-center animate-fade-up transition-all hover:scale-[1.02]">
                    <div className={`w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center ${gender === 'Hombre' ? 'bg-blue-50' : 'bg-rose-50'}`}>
                      <span className="text-3xl">{gender === 'Hombre' ? '👔' : '👗'}</span>
                    </div>
                    <h2 className="text-lg font-display font-bold text-navy-900">{gender}</h2>
                    <p className="text-sm text-navy-400 mt-1">
                      {products.filter((p) => p.gender === gender).length} productos
                    </p>
                  </button>
                ))}
              </div>
            )}

            {/* Category selection */}
            {view === 'category' && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 stagger">
                {categories.map((cat) => (
                  <button key={cat} onClick={() => selectCategory(cat)}
                    className="card-hover p-5 text-left animate-fade-up transition-all hover:scale-[1.01]">
                    <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center mb-3">
                      <Tag size={18} className="text-amber-500" />
                    </div>
                    <h3 className="font-display font-semibold text-navy-900 text-sm">{cat}</h3>
                    <p className="text-[10px] text-navy-400 mt-0.5">
                      {products.filter((p) => p.gender === activeGender && (cat === 'Todos' || (p.category || 'Sin Categoría') === cat)).length} productos
                    </p>
                  </button>
                ))}
              </div>
            )}

            {/* Product grid */}
            {view === 'products' && (
              <div>
                <div className="relative mb-4">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-navy-300" />
                  <input value={searchFilter} onChange={(e) => setSearchFilter(e.target.value)}
                    className="input-field pl-9 text-sm" placeholder="Buscar producto..." />
                </div>

                {displayProducts.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-navy-400 text-sm">No se encontraron productos.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3 stagger">
                    {displayProducts.map((product) => {
                      const currentOfferValue = product.offer?.value || 0;
                      const currentOfferType = product.offer?.type || 'percentage';
                      const hasOffer = currentOfferValue > 0;

                      return (
                        <button key={product.id} onClick={() => handleProductClick(product)}
                          className="card-hover p-2 text-left animate-fade-up group cursor-pointer relative">
                          <div className="aspect-square rounded-lg bg-surface-50 dark:bg-surface-100/50 mb-2 overflow-hidden flex items-center justify-center relative">
                            {product.imageUrl ? (
                              <img src={product.imageUrl} alt={product.name} loading="lazy"
                                className="w-full h-full object-contain p-2 group-hover:scale-105 transition-transform duration-300 mix-blend-multiply dark:mix-blend-normal" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <Tag size={20} className="text-navy-200" />
                              </div>
                            )}
                            {hasOffer && (
                              <div className="absolute top-1 right-1 bg-accent-red text-white text-[10px] font-bold px-1.5 py-0.5 rounded shadow-sm">
                                -{currentOfferType === 'percentage' ? `${currentOfferValue}%` : `$${currentOfferValue}`}
                              </div>
                            )}
                          </div>
                          <p className="font-display font-semibold text-navy-900 text-[11px] line-clamp-2 leading-tight">
                            {product.name}
                          </p>
                          {product.variants?.[0] && (
                            <div className="mt-0.5">
                              {hasOffer ? (
                                <div className="flex flex-col">
                                  <span className="font-mono text-[9px] text-navy-400 line-through">
                                    {format(product.variants[0].price)}
                                  </span>
                                  <span className="font-mono text-[10px] font-bold text-accent-red">
                                    {format(currentOfferType === 'percentage'
                                      ? product.variants[0].price - (product.variants[0].price * (currentOfferValue / 100))
                                      : product.variants[0].price - currentOfferValue
                                    )}
                                  </span>
                                </div>
                              ) : (
                                <span className="font-mono text-[10px] text-navy-500">{format(product.variants[0].price)}</span>
                              )}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right: Cart */}
        <div className="w-full lg:w-80 xl:w-[400px] flex flex-col min-h-0">
          <CartPanel />
        </div>
      </div>

      {/* Variant selector modal */}
      {variantProduct && (
        <VariantSelector
          product={variantProduct}
          onSelect={(idx) => addToCart(variantProduct.id, idx)}
          onClose={() => setVariantProduct(null)}
        />
      )}
    </div>
  );
}
