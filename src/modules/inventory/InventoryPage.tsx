import { useState, useMemo } from 'react';
import { useAppStore } from '@/store/appStore';
import { usePermissions } from '@/hooks/usePermissions';
import { useCurrency } from '@/hooks/useCurrency';
import { useToast } from '@/components/Toast';
import { Modal } from '@/components/Modal';
import { Pagination } from '@/components/Pagination';
import { saveProduct, deleteProduct } from './inventoryService';
import type { Product, ProductVariant } from '@/types';
import { Plus, Search, Package, Edit, Trash2, X as XIcon, Check, ChevronDown, ChevronUp, AlertTriangle, Filter } from 'lucide-react';

// ============================
// VARIANT EDITOR (Modal)
// ============================
function VariantEditor({ variants, onChange }: { variants: ProductVariant[]; onChange: (v: ProductVariant[]) => void }) {
  const update = (i: number, field: keyof ProductVariant, value: string | number) => {
    const copy = [...variants]; copy[i] = { ...copy[i], [field]: value }; onChange(copy);
  };
  const remove = (i: number) => onChange(variants.filter((_, idx) => idx !== i));
  const add = () => onChange([...variants, { size: '', color: '', price: 0, stock: 0 }]);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-sm font-display font-semibold text-navy-700">Variantes</label>
        <button type="button" onClick={add} className="btn-ghost text-xs"><Plus size={14} /> Agregar</button>
      </div>
      {variants.length === 0 && <p className="text-sm text-navy-300 text-center py-4">Agrega al menos una variante.</p>}
      {variants.map((v, i) => (
        <div key={i} className="grid grid-cols-2 md:grid-cols-5 gap-2 items-end p-3 bg-surface-50 rounded-lg border border-surface-200">
          <div><label className="text-[10px] font-display font-medium text-navy-400 uppercase">Talla</label>
            <input value={v.size} onChange={(e) => update(i, 'size', e.target.value)} className="input-field text-sm py-1.5" /></div>
          <div><label className="text-[10px] font-display font-medium text-navy-400 uppercase">Color</label>
            <input value={v.color} onChange={(e) => update(i, 'color', e.target.value)} className="input-field text-sm py-1.5" /></div>
          <div><label className="text-[10px] font-display font-medium text-navy-400 uppercase">Precio ($)</label>
            <input type="number" step="0.01" value={v.price || ''} onChange={(e) => update(i, 'price', parseFloat(e.target.value) || 0)} className="input-field text-sm py-1.5" /></div>
          <div><label className="text-[10px] font-display font-medium text-navy-400 uppercase">Stock</label>
            <input type="number" value={v.stock} onChange={(e) => update(i, 'stock', parseInt(e.target.value) || 0)} className="input-field text-sm py-1.5" /></div>
          <div className="flex justify-end">
            <button type="button" onClick={() => remove(i)} className="btn-ghost p-1.5 text-accent-red hover:bg-red-50"><Trash2 size={14} /></button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================
// PRODUCT FORM MODAL
// ============================
function ProductFormModal({ open, onClose, product }: { open: boolean; onClose: () => void; product: Product | null }) {
  const products = useAppStore((s) => s.products);
  const toast = useToast();
  const [name, setName] = useState(product?.name || '');
  const [gender, setGender] = useState(product?.gender || 'Hombre');
  const [category, setCategory] = useState(product?.category || '');
  const [variants, setVariants] = useState<ProductVariant[]>(product?.variants || [{ size: '', color: '', price: 0, stock: 0 }]);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const categories = useMemo(() => [...new Set(products.map((p) => p.category).filter(Boolean))].sort(), [products]);
  useState(() => { setName(product?.name || ''); setGender(product?.gender || 'Hombre'); setCategory(product?.category || ''); setVariants(product?.variants || [{ size: '', color: '', price: 0, stock: 0 }]); setImageFile(null); });
  async function handleSave() {
    if (!name.trim()) return toast.warning('El nombre es obligatorio.');
    if (variants.length === 0) return toast.warning('Agrega al menos una variante.');
    setSaving(true);
    try { await saveProduct(product?.id || null, { name, gender, category, variants, imageFile, currentImageUrl: product?.imageUrl }); onClose(); }
    catch (err) { console.error(err); toast.error('Error al guardar producto.'); } finally { setSaving(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title={product ? 'Editar Producto' : 'Nuevo Producto'} size="lg">
      <div className="space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><label className="block text-sm font-display font-medium text-navy-700 mb-1.5">Nombre</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="input-field" /></div>
          <div><label className="block text-sm font-display font-medium text-navy-700 mb-1.5">Género</label>
            <select value={gender} onChange={(e) => setGender(e.target.value as 'Hombre' | 'Mujer')} className="input-field">
              <option value="Hombre">Hombre</option><option value="Mujer">Mujer</option></select></div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><label className="block text-sm font-display font-medium text-navy-700 mb-1.5">Categoría</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="input-field">
              <option value="">-- Selecciona --</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
          <div><label className="block text-sm font-display font-medium text-navy-700 mb-1.5">Imagen</label>
            <input type="file" accept="image/*" onChange={(e) => setImageFile(e.target.files?.[0] || null)}
              className="input-field text-sm file:mr-3 file:py-1 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-display file:font-semibold file:bg-navy-900 file:text-white" /></div>
        </div>
        <VariantEditor variants={variants} onChange={setVariants} />
        <div className="flex justify-end gap-3 pt-4 border-t border-surface-200">
          <button onClick={onClose} className="btn-secondary">Cancelar</button>
          <button onClick={handleSave} disabled={saving} className="btn-primary">{saving ? 'Guardando...' : 'Guardar Producto'}</button>
        </div>
      </div>
    </Modal>
  );
}

// ============================
// VARIANT DETAIL PANEL
// ============================
function ProductVariantsPanel({ product }: { product: Product }) {
  const { format } = useCurrency();
  const byColor: Record<string, (ProductVariant & { idx: number })[]> = {};
  product.variants?.forEach((v, idx) => {
    const key = (v.color || 'SIN COLOR').toUpperCase();
    if (!byColor[key]) byColor[key] = [];
    byColor[key].push({ ...v, idx });
  });
  return (
    <div className="px-4 pb-4 animate-fade-up">
      <div className="bg-surface-50 rounded-lg border border-surface-200 overflow-hidden">
        {Object.entries(byColor).map(([color, variants]) => (
          <div key={color}>
            <div className="px-4 py-2 bg-surface-100 border-b border-surface-200">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-navy-300 border border-navy-400" />
                <span className="text-xs font-display font-bold text-navy-700">{color}</span>
                <span className="text-[10px] text-navy-400">({variants.length} tallas)</span>
              </div>
            </div>
            <div className="divide-y divide-surface-100">
              {variants.map((v) => {
                const isLow = v.stock <= 5;
                return (
                  <div key={v.idx} className={`grid grid-cols-4 gap-4 px-4 py-2.5 text-sm ${isLow ? 'bg-red-50/60' : ''}`}>
                    <div><span className="text-[10px] text-navy-400 font-display uppercase block">Talla</span>
                      <span className="font-display font-medium text-navy-800">{v.size || 'N/A'}</span></div>
                    <div><span className="text-[10px] text-navy-400 font-display uppercase block">Precio</span>
                      <span className="font-mono font-semibold text-navy-900">{format(v.price)}</span></div>
                    <div><span className="text-[10px] text-navy-400 font-display uppercase block">Stock</span>
                      <span className={`font-mono font-semibold ${isLow ? 'text-accent-red' : 'text-navy-900'}`}>{v.stock} {isLow && <AlertTriangle size={11} className="inline ml-0.5" />}</span></div>
                    <div><span className="text-[10px] text-navy-400 font-display uppercase block">Valor</span>
                      <span className="font-mono text-navy-600">{format(v.price * v.stock)}</span></div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================
// MAIN INVENTORY PAGE
// ============================
export function InventoryPage() {
  const products = useAppStore((s) => s.products);
  const { can } = usePermissions();
  const { format } = useCurrency();
  const toast = useToast();

  // Draft filters (what user is selecting)
  const [draftGender, setDraftGender] = useState('all');
  const [draftCategory, setDraftCategory] = useState('all');
  const [draftSearch, setDraftSearch] = useState('');

  // Applied filters (what is actually shown)
  const [appliedGender, setAppliedGender] = useState('all');
  const [appliedCategory, setAppliedCategory] = useState('all');
  const [appliedSearch, setAppliedSearch] = useState('');

  const [showFilters, setShowFilters] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);

  // Available categories (based on draft gender for cascading)
  const availableCategories = useMemo(() => {
    let prods = products;
    if (draftGender !== 'all') prods = prods.filter((p) => p.gender === draftGender);
    return [...new Set(prods.map((p) => p.category || 'Sin Categoría').filter(Boolean))].sort();
  }, [products, draftGender]);

  // Reset draft category when gender changes
  function handleDraftGenderChange(val: string) {
    setDraftGender(val);
    setDraftCategory('all');
  }

  // Apply filters
  function applyFilters() {
    setAppliedGender(draftGender);
    setAppliedCategory(draftCategory);
    setAppliedSearch(draftSearch);
    setPage(1);
    setExpandedId(null);
  }

  function clearFilters() {
    setDraftGender('all'); setDraftCategory('all'); setDraftSearch('');
    setAppliedGender('all'); setAppliedCategory('all'); setAppliedSearch('');
    setPage(1);
  }

  const hasActiveFilters = appliedGender !== 'all' || appliedCategory !== 'all' || appliedSearch !== '';
  const hasDraftChanges = draftGender !== appliedGender || draftCategory !== appliedCategory || draftSearch !== appliedSearch;

  // Filtered products
  const filtered = useMemo(() => {
    let result = products;
    if (appliedGender !== 'all') result = result.filter((p) => p.gender === appliedGender);
    if (appliedCategory !== 'all') result = result.filter((p) => (p.category || 'Sin Categoría') === appliedCategory);
    if (appliedSearch) {
      const s = appliedSearch.toLowerCase();
      result = result.filter((p) =>
        p.name.toLowerCase().includes(s) ||
        p.variants?.some((v) => v.color?.toLowerCase().includes(s) || v.size?.toLowerCase().includes(s))
      );
    }
    return result;
  }, [products, appliedGender, appliedCategory, appliedSearch]);

  // Group by Gender → Category
  const grouped = useMemo(() => {
    const groups: { gender: string; category: string; products: Product[] }[] = [];
    const map: Record<string, Product[]> = {};

    filtered.forEach((p) => {
      const key = `${p.gender}|||${p.category || 'Sin Categoría'}`;
      if (!map[key]) map[key] = [];
      map[key].push(p);
    });

    // Sort: Hombre first, then Mujer, then alphabetical categories
    Object.entries(map)
      .sort(([a], [b]) => {
        const [gA, cA] = a.split('|||');
        const [gB, cB] = b.split('|||');
        if (gA !== gB) return gA === 'Hombre' ? -1 : 1;
        return cA.localeCompare(cB);
      })
      .forEach(([key, prods]) => {
        const [gender, category] = key.split('|||');
        groups.push({ gender, category, products: prods.sort((a, b) => a.name.localeCompare(b.name)) });
      });

    return groups;
  }, [filtered]);

  // Flatten for pagination
  const allProducts = useMemo(() => grouped.flatMap((g) => g.products), [grouped]);
  const totalPages = Math.max(1, Math.ceil(allProducts.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paginatedIds = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return new Set(allProducts.slice(start, start + pageSize).map((p) => p.id));
  }, [allProducts, currentPage, pageSize]);

  // Filter grouped to only show current page items
  const paginatedGroups = useMemo(() => {
    return grouped.map((g) => ({
      ...g,
      products: g.products.filter((p) => paginatedIds.has(p.id)),
    })).filter((g) => g.products.length > 0);
  }, [grouped, paginatedIds]);

  function handlePageSizeChange(size: number) { setPageSize(size); setPage(1); }

  const totalStock = filtered.reduce((acc, p) => acc + (p.variants?.reduce((a, v) => a + (v.stock || 0), 0) || 0), 0);
  const lowStockCount = filtered.filter((p) => (p.variants?.reduce((a, v) => a + (v.stock || 0), 0) || 0) <= 5).length;

  function handleEdit(p: Product) { setEditProduct(p); setFormOpen(true); }
  function handleAdd() { setEditProduct(null); setFormOpen(true); }
  async function handleDelete(p: Product) {
    if (!confirm(`¿Eliminar "${p.name}"?`)) return;
    try { await deleteProduct(p.id, p.imageUrl); } catch { toast.error('Error al eliminar producto.'); }
  }

  return (
    <div className="space-y-5 animate-fade-up">
      {/* Header */}
      <div className="card p-5">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-1 h-12 bg-amber-500 rounded-full" />
            <div>
              <h1 className="text-xl font-display font-bold text-navy-900">Inventario</h1>
              <p className="text-navy-400 text-sm">{filtered.length} productos · {totalStock} unidades</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowFilters(!showFilters)}
              className={`btn-secondary text-sm ${showFilters ? 'border-amber-300 bg-amber-50' : ''}`}>
              <Filter size={14} /> Filtros
              <ChevronDown size={14} className={`transition-transform ${showFilters ? 'rotate-180' : ''}`} />
            </button>
            {can('canCreateProducts') && (
              <button onClick={handleAdd} className="btn-primary text-sm"><Plus size={16} /> Nuevo</button>
            )}
          </div>
        </div>

        {/* Filters panel */}
        {showFilters && (
          <div className="mt-4 pt-4 border-t border-surface-200 animate-fade-up">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-[10px] font-display font-semibold text-navy-400 uppercase mb-1">Buscar</label>
                <Search size={14} className="absolute ml-3 mt-2.5 text-navy-300 pointer-events-none" />
                <input value={draftSearch} onChange={(e) => setDraftSearch(e.target.value)}
                  className="input-field pl-9 text-sm" placeholder="Nombre, color, talla..." />
              </div>
              <div>
                <label className="block text-[10px] font-display font-semibold text-navy-400 uppercase mb-1">Género</label>
                <select value={draftGender} onChange={(e) => handleDraftGenderChange(e.target.value)} className="input-field text-sm">
                  <option value="all">Todos</option>
                  <option value="Hombre">Hombre</option>
                  <option value="Mujer">Mujer</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-display font-semibold text-navy-400 uppercase mb-1">Categoría</label>
                <select value={draftCategory} onChange={(e) => setDraftCategory(e.target.value)} className="input-field text-sm">
                  <option value="all">Todas</option>
                  {availableCategories.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="flex items-end gap-2">
                <button onClick={applyFilters}
                  className={`btn-primary text-sm flex-1 ${hasDraftChanges ? 'animate-pulse' : ''}`}>
                  <Check size={14} /> Aplicar
                </button>
                {hasActiveFilters && (
                  <button onClick={clearFilters} className="btn-ghost text-sm p-2.5 text-navy-400 hover:text-accent-red">
                    <XIcon size={14} />
                  </button>
                )}
              </div>
            </div>
            {hasActiveFilters && (
              <div className="mt-3 flex flex-wrap gap-2">
                {appliedGender !== 'all' && <span className="badge badge-blue">Género: {appliedGender}</span>}
                {appliedCategory !== 'all' && <span className="badge badge-amber">Categoría: {appliedCategory}</span>}
                {appliedSearch && <span className="badge badge-gray">Búsqueda: "{appliedSearch}"</span>}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="card px-4 py-3 hover-lift"><p className="text-[10px] font-display font-semibold text-navy-400 uppercase">Productos</p>
          <p className="text-lg font-mono font-bold text-navy-900">{filtered.length}</p></div>
        <div className="card px-4 py-3 hover-lift"><p className="text-[10px] font-display font-semibold text-navy-400 uppercase">Stock Total</p>
          <p className="text-lg font-mono font-bold text-navy-900">{totalStock}</p></div>
        <div className="card px-4 py-3 hover-lift"><p className="text-[10px] font-display font-semibold text-navy-400 uppercase">Stock Bajo</p>
          <p className={`text-lg font-mono font-bold ${lowStockCount > 0 ? 'text-accent-red' : 'text-emerald-600'}`}>{lowStockCount}</p></div>
        <div className="card px-4 py-3 hover-lift"><p className="text-[10px] font-display font-semibold text-navy-400 uppercase">Grupos</p>
          <p className="text-lg font-mono font-bold text-navy-900">{grouped.length}</p></div>
      </div>

      {/* Grouped content */}
      <div className="space-y-4">
        {paginatedGroups.length === 0 ? (
          <div className="card p-16 text-center">
            <Package size={48} className="mx-auto text-navy-200 mb-3" />
            <p className="text-navy-400 text-sm font-display">No hay productos que coincidan.</p>
          </div>
        ) : (
          paginatedGroups.map((group) => (
            <div key={`${group.gender}-${group.category}`} className="card overflow-hidden">
              {/* Group header */}
              <div className="px-5 py-3 bg-surface-50 border-b border-surface-200 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className={`text-lg ${group.gender === 'Hombre' ? '👔' : '👗'}`} />
                  <div>
                    <span className="font-display font-bold text-navy-900 text-sm">{group.category}</span>
                    <span className="text-navy-300 mx-2">·</span>
                    <span className="text-xs text-navy-500 font-display">{group.gender}</span>
                  </div>
                </div>
                <span className="badge badge-gray text-[10px]">{group.products.length} productos</span>
              </div>

              {/* Products in this group */}
              <div className="divide-y divide-surface-100">
                {group.products.map((product) => {
                  const isExpanded = expandedId === product.id;
                  const totalStock = product.variants?.reduce((a, v) => a + (v.stock || 0), 0) || 0;
                  const lowStock = totalStock <= 5;
                  const minP = Math.min(...(product.variants?.map((v) => v.price) || [0]));
                  const maxP = Math.max(...(product.variants?.map((v) => v.price) || [0]));

                  return (
                    <div key={product.id} className={isExpanded ? 'bg-surface-50/50' : ''}>
                      <div className="flex items-center gap-4 px-5 py-3 cursor-pointer hover:bg-surface-50 transition-colors hover-lift"
                        onClick={() => setExpandedId(isExpanded ? null : product.id)}>
                        {/* Expand */}
                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 transition-all duration-200 ${isExpanded ? 'bg-navy-900 text-white' : 'bg-surface-100 text-navy-400'}`}>
                          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </div>
                        {/* Image */}
                        <div className="w-11 h-11 rounded-lg bg-surface-50 dark:bg-surface-100/50 overflow-hidden flex-shrink-0 border border-surface-200">
                          {product.imageUrl ? <img src={product.imageUrl} alt="" className="w-full h-full object-contain p-1 mix-blend-multiply dark:mix-blend-normal" /> :
                            <div className="w-full h-full flex items-center justify-center"><Package size={16} className="text-navy-300" /></div>}
                        </div>
                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <p className="font-display font-semibold text-navy-900 text-sm truncate">{product.name}</p>
                          <p className="text-xs font-mono text-navy-500">
                            {minP === maxP ? format(minP) : `${format(minP)} – ${format(maxP)}`}
                            <span className="text-navy-300 mx-1.5">·</span>
                            {product.variants?.length || 0} vars.
                          </p>
                        </div>
                        {/* Stock */}
                        <div className="text-right flex-shrink-0 w-20">
                          <span className={`text-sm font-mono font-bold ${lowStock ? 'text-accent-red' : 'text-navy-900'}`}>
                            {totalStock} {lowStock && <AlertTriangle size={12} className="inline ml-0.5" />}
                          </span>
                          <p className="text-[10px] text-navy-400">stock</p>
                        </div>
                        {/* Actions */}
                        <div className="flex gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                          {can('canEditProducts') && (
                            <button onClick={() => handleEdit(product)} className="w-8 h-8 rounded-lg flex items-center justify-center text-navy-400 hover:bg-blue-50 hover:text-blue-600 transition-colors"><Edit size={15} /></button>
                          )}
                          {can('canDeleteProducts') && (
                            <button onClick={() => handleDelete(product)} className="w-8 h-8 rounded-lg flex items-center justify-center text-navy-400 hover:bg-red-50 hover:text-accent-red transition-colors"><Trash2 size={15} /></button>
                          )}
                        </div>
                      </div>
                      {isExpanded && <ProductVariantsPanel product={product} />}
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Pagination */}
      {allProducts.length > 0 && (
        <div className="card overflow-hidden">
          <Pagination currentPage={currentPage} totalPages={totalPages} totalItems={allProducts.length}
            pageSize={pageSize} onPageChange={setPage} onPageSizeChange={handlePageSizeChange} />
        </div>
      )}

      {formOpen && <ProductFormModal open={formOpen} onClose={() => { setFormOpen(false); setEditProduct(null); }} product={editProduct} />}
    </div>
  );
}
