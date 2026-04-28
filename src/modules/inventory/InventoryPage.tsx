import { useState, useMemo, useRef, useCallback } from 'react';
import { useAppStore } from '@/store/appStore';
import { usePermissions } from '@/hooks/usePermissions';
import { useCurrency } from '@/hooks/useCurrency';
import { useToast } from '@/components/Toast';
import { Modal } from '@/components/Modal';
import { Pagination } from '@/components/Pagination';
import { saveProduct, deleteProduct, toggleProductActive } from './inventoryService';
import { BarcodeRenderer, BarcodePrintModal, generateBarcode, findByBarcode, useBarcodeScanner } from '@/components/Barcode';
import type { Product, ProductVariant } from '@/types';
import { Plus, Search, Package, Trash2, X as XIcon, Check, ChevronDown, AlertTriangle, Filter, ImagePlus, GripVertical, Barcode, Shuffle, Eye, EyeOff, Copy } from 'lucide-react';

// ============================
// VARIANT EDITOR (Modal)
// ============================
function VariantEditor({ variants, onChange }: { variants: ProductVariant[]; onChange: (v: ProductVariant[]) => void }) {
  const [bulkPrice, setBulkPrice] = useState('');
  const [bulkStock, setBulkStock] = useState('');
  const [bulkColor, setBulkColor] = useState('');

  const update = (i: number, field: keyof ProductVariant, value: string | number) => {
    const copy = [...variants]; copy[i] = { ...copy[i], [field]: value }; onChange(copy);
  };
  const remove = (i: number) => onChange(variants.filter((_, idx) => idx !== i));
  const add = () => onChange([...variants, { size: '', color: '', price: 0, stock: 0 }]);

  function generateBarcodeForVariant(i: number) {
    const code = generateBarcode();
    update(i, 'barcode', code);
  }

  function generateAllBarcodes() {
    const copy = variants.map(v => ({
      ...v,
      barcode: v.barcode || generateBarcode(),
    }));
    onChange(copy);
  }

  function applyBulkPrice() {
    const price = parseFloat(bulkPrice);
    if (isNaN(price) || price < 0) return;
    onChange(variants.map(v => ({ ...v, price })));
    setBulkPrice('');
  }

  function applyBulkStock() {
    const stock = parseInt(bulkStock);
    if (isNaN(stock) || stock < 0) return;
    onChange(variants.map(v => ({ ...v, stock })));
    setBulkStock('');
  }

  function applyBulkColor() {
    if (!bulkColor.trim()) return;
    onChange(variants.map(v => ({ ...v, color: bulkColor.trim() })));
    setBulkColor('');
  }

  const missingBarcodes = variants.filter(v => !v.barcode).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-sm font-display font-semibold text-navy-700">Variantes</label>
        <div className="flex gap-2">
          {variants.length > 0 && missingBarcodes > 0 && (
            <button type="button" onClick={generateAllBarcodes}
              className="btn-ghost text-xs text-amber-600 hover:bg-amber-50 gap-1">
              <Barcode size={13} /> Generar Códigos ({missingBarcodes})
            </button>
          )}
          <button type="button" onClick={add} className="btn-ghost text-xs"><Plus size={14} /> Agregar</button>
        </div>
      </div>
      {variants.length === 0 && <p className="text-sm text-navy-300 text-center py-4">Agrega al menos una variante.</p>}

      {/* Bulk change bar */}
      {variants.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 p-2.5 bg-navy-900/5 dark:bg-navy-800/30 rounded-lg border border-dashed border-navy-300 dark:border-navy-600">
          <span className="text-[10px] font-display font-semibold text-navy-400 uppercase whitespace-nowrap">Cambio masivo:</span>
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              step="0.01"
              value={bulkPrice}
              onChange={(e) => setBulkPrice(e.target.value)}
              placeholder="Precio"
              className="input-field text-xs py-1 px-2 w-20 font-mono"
            />
            <button
              type="button"
              onClick={applyBulkPrice}
              disabled={!bulkPrice}
              className="px-2 py-1 text-[10px] font-display font-bold bg-emerald-600 text-white rounded-md hover:bg-emerald-700 transition-colors disabled:opacity-40"
            >
              $ Aplicar
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              value={bulkStock}
              onChange={(e) => setBulkStock(e.target.value)}
              placeholder="Stock"
              className="input-field text-xs py-1 px-2 w-20 font-mono"
            />
            <button
              type="button"
              onClick={applyBulkStock}
              disabled={!bulkStock}
              className="px-2 py-1 text-[10px] font-display font-bold bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:opacity-40"
            >
              # Aplicar
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <input
              value={bulkColor}
              onChange={(e) => setBulkColor(e.target.value)}
              placeholder="Color"
              className="input-field text-xs py-1 px-2 w-20"
            />
            <button
              type="button"
              onClick={applyBulkColor}
              disabled={!bulkColor.trim()}
              className="px-2 py-1 text-[10px] font-display font-bold bg-amber-600 text-white rounded-md hover:bg-amber-700 transition-colors disabled:opacity-40"
            >
              🎨 Aplicar
            </button>
          </div>
        </div>
      )}

      {variants.map((v, i) => (
        <div key={i} className="p-3 bg-surface-50 rounded-lg border border-surface-200 space-y-2">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 items-end">
            <div><label className="text-[10px] font-display font-medium text-navy-400 uppercase">Talla</label>
              <input value={v.size} onChange={(e) => update(i, 'size', e.target.value)} className="input-field text-sm py-1.5" /></div>
            <div><label className="text-[10px] font-display font-medium text-navy-400 uppercase">Color</label>
              <input value={v.color} onChange={(e) => update(i, 'color', e.target.value)} className="input-field text-sm py-1.5" /></div>
            <div><label className="text-[10px] font-display font-medium text-navy-400 uppercase">Precio ($)</label>
              <input type="number" step="0.01" value={v.price || ''} onChange={(e) => update(i, 'price', parseFloat(e.target.value) || 0)} className="input-field text-sm py-1.5" /></div>
            <div><label className="text-[10px] font-display font-medium text-navy-400 uppercase">Stock</label>
              <input type="number" value={v.stock} onChange={(e) => update(i, 'stock', parseInt(e.target.value) || 0)} className="input-field text-sm py-1.5" /></div>
          </div>
          {/* Barcode Row */}
          <div className="flex items-center gap-2 pt-1 border-t border-surface-200">
            <Barcode size={13} className="text-navy-300 flex-shrink-0" />
            <input
              value={v.barcode || ''}
              onChange={(e) => update(i, 'barcode', e.target.value)}
              placeholder="Código de barras"
              className="input-field text-sm py-1 font-mono flex-1"
            />
            <button
              type="button"
              onClick={() => generateBarcodeForVariant(i)}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-display font-semibold bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors flex-shrink-0"
              title="Generar código aleatorio"
            >
              <Shuffle size={11} /> Generar
            </button>
            <button
              type="button"
              onClick={() => remove(i)}
              className="btn-ghost p-1.5 text-accent-red hover:bg-red-50 flex-shrink-0"
            >
              <Trash2 size={14} />
            </button>
          </div>
          {/* Barcode preview */}
          {v.barcode && (
            <div className="flex justify-center bg-white rounded-md border border-surface-100 py-1">
              <BarcodeRenderer value={v.barcode} width={1.2} height={30} fontSize={9} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ============================
// IMAGE GALLERY ITEM
// ============================
interface GalleryImage {
  id: string;
  url: string;
  file?: File;
  isExisting: boolean;
}

// ============================
// PRODUCT FORM MODAL
// ============================
function ProductFormModal({ open, onClose, product }: { open: boolean; onClose: () => void; product: Product | null }) {
  const products = useAppStore((s) => s.products);
  const toast = useToast();
  const [name, setName] = useState(product?.name || '');
  const [description, setDescription] = useState(product?.description || '');
  const [gender, setGender] = useState(product?.gender || 'Hombre');
  const [category, setCategory] = useState(product?.category || '');
  const [variants, setVariants] = useState<ProductVariant[]>(product?.variants || [{ size: '', color: '', price: 0, stock: 0 }]);
  const [saving, setSaving] = useState(false);
  const categories = useMemo(() => [...new Set(products.map((p) => p.category).filter(Boolean))].sort(), [products]);

  // Multi-image state
  const existingUrls = product?.imageUrls?.length 
    ? product.imageUrls 
    : (product?.imageUrl ? [product.imageUrl] : []);
  
  const [galleryImages, setGalleryImages] = useState<GalleryImage[]>(
    existingUrls.map((url, i) => ({ id: `existing-${i}`, url, isExisting: true }))
  );
  const [removedUrls, setRemovedUrls] = useState<string[]>([]);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  useState(() => {
    setName(product?.name || '');
    setGender(product?.gender || 'Hombre');
    setCategory(product?.category || '');
    setVariants(product?.variants || [{ size: '', color: '', price: 0, stock: 0 }]);
  });

  const addFiles = useCallback((files: FileList | File[]) => {
    const newImages: GalleryImage[] = Array.from(files)
      .filter(f => f.type.startsWith('image/'))
      .map((file, i) => ({
        id: `new-${Date.now()}-${i}-${file.name}`,
        url: URL.createObjectURL(file),
        file,
        isExisting: false,
      }));
    if (newImages.length === 0) {
      toast.warning('Solo se permiten archivos de imagen.');
      return;
    }
    setGalleryImages(prev => [...prev, ...newImages]);
  }, [toast]);

  function removeImage(id: string) {
    setGalleryImages(prev => {
      const img = prev.find(g => g.id === id);
      if (img?.isExisting) {
        setRemovedUrls(r => [...r, img.url]);
      } else if (img?.url) {
        URL.revokeObjectURL(img.url);
      }
      return prev.filter(g => g.id !== id);
    });
  }

  function handleDragStart(idx: number) {
    setDragIdx(idx);
  }

  function handleDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;
    setGalleryImages(prev => {
      const copy = [...prev];
      const [dragged] = copy.splice(dragIdx, 1);
      copy.splice(idx, 0, dragged);
      return copy;
    });
    setDragIdx(idx);
  }

  function handleDropZone(e: React.DragEvent) {
    e.preventDefault();
    setIsDraggingOver(false);
    setDragIdx(null);
    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  }

  async function handleSave() {
    if (!name.trim()) return toast.warning('El nombre es obligatorio.');
    if (variants.length === 0) return toast.warning('Agrega al menos una variante.');
    setSaving(true);
    try {
      const existingImageUrls = galleryImages.filter(g => g.isExisting).map(g => g.url);
      const newImageFiles = galleryImages.filter(g => !g.isExisting && g.file).map(g => g.file!);
      const primaryUrl = galleryImages.length > 0 && galleryImages[0].isExisting ? galleryImages[0].url : undefined;

      await saveProduct(product?.id || null, {
        name,
        description,
        gender,
        category,
        variants,
        currentImageUrl: primaryUrl,
        existingImageUrls,
        newImageFiles,
        removedImageUrls: removedUrls,
      });
      onClose();
    } catch (err) {
      console.error(err);
      toast.error('Error al guardar producto.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={product?.id ? 'Editar Producto' : (product ? '📋 Duplicar — Nuevo Producto' : 'Nuevo Producto')} size="xl">
      <div className="space-y-5 max-h-[75vh] overflow-y-auto pr-1">
        {/* Duplicate warning */}
        {product && !product.id && (
          <div className="flex items-center gap-2 p-3 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg text-xs text-emerald-700 dark:text-emerald-400">
            <Copy size={14} className="shrink-0" />
            <span>Estás creando una <strong>copia</strong>. Cambia el nombre y los datos que necesites. Al guardar se creará un producto nuevo.</span>
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><label className="block text-sm font-display font-medium text-navy-700 mb-1.5">Nombre</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="input-field" /></div>
          <div><label className="block text-sm font-display font-medium text-navy-700 mb-1.5">Género</label>
            <select value={gender} onChange={(e) => setGender(e.target.value as 'Hombre' | 'Mujer')} className="input-field">
              <option value="Hombre">Hombre</option><option value="Mujer">Mujer</option></select></div>
        </div>
        <div>
          <label className="block text-sm font-display font-medium text-navy-700 mb-1.5">Categoría</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="input-field">
            <option value="">-- Selecciona --</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}</select>
        </div>
        <div>
          <label className="block text-sm font-display font-medium text-navy-700 mb-1.5">Descripción <span className="text-navy-400 font-normal">(opcional)</span></label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="input-field resize-none"
            rows={3}
            placeholder="Ej: Pantalón cargo de mezclilla premium con 6 bolsillos funcionales..."
          />
        </div>

        {/* Multi-Image Gallery Upload */}
        <div>
          <label className="block text-sm font-display font-medium text-navy-700 mb-1.5">
            Imágenes <span className="text-navy-400 font-normal">({galleryImages.length} {galleryImages.length === 1 ? 'imagen' : 'imágenes'})</span>
          </label>

          {/* Image Previews */}
          {galleryImages.length > 0 && (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2 mb-3">
              {galleryImages.map((img, idx) => (
                <div
                  key={img.id}
                  draggable
                  onDragStart={() => handleDragStart(idx)}
                  onDragOver={(e) => handleDragOver(e, idx)}
                  onDragEnd={() => setDragIdx(null)}
                  className={`group relative aspect-square rounded-lg border-2 overflow-hidden transition-all cursor-grab active:cursor-grabbing ${
                    idx === 0 ? 'border-amber-400 ring-2 ring-amber-200' : 'border-surface-200 hover:border-surface-300'
                  } ${dragIdx === idx ? 'opacity-50 scale-95' : 'opacity-100'}`}
                >
                  <img src={img.url} alt="" className="w-full h-full object-cover" />
                  {/* Primary badge */}
                  {idx === 0 && (
                    <div className="absolute top-1 left-1 px-1.5 py-0.5 bg-amber-500 text-white text-[9px] font-bold rounded-md shadow-sm">
                      PRINCIPAL
                    </div>
                  )}
                  {/* Drag handle */}
                  <div className="absolute top-1 right-7 p-0.5 bg-black/40 rounded text-white opacity-0 group-hover:opacity-100 transition-opacity">
                    <GripVertical size={12} />
                  </div>
                  {/* Delete button */}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); removeImage(img.id); }}
                    className="absolute top-1 right-1 w-5 h-5 flex items-center justify-center bg-red-500 hover:bg-red-600 text-white rounded-md shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <XIcon size={11} />
                  </button>
                  {/* New badge */}
                  {!img.isExisting && (
                    <div className="absolute bottom-1 left-1 px-1.5 py-0.5 bg-emerald-500 text-white text-[9px] font-bold rounded-md shadow-sm">
                      NUEVA
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Drop Zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDraggingOver(true); }}
            onDragLeave={() => setIsDraggingOver(false)}
            onDrop={handleDropZone}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
              isDraggingOver
                ? 'border-amber-400 bg-amber-50/50 scale-[1.01]'
                : 'border-surface-300 hover:border-navy-400 hover:bg-surface-50'
            }`}
          >
            <ImagePlus size={28} className={`mx-auto mb-2 ${isDraggingOver ? 'text-amber-500' : 'text-navy-300'}`} />
            <p className="text-sm text-navy-500 font-display">
              <span className="font-semibold text-navy-700">Haz clic para seleccionar</span> o arrastra imágenes aquí
            </p>
            <p className="text-[10px] text-navy-400 mt-1">JPG, PNG, WEBP — puedes subir múltiples imágenes a la vez</p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                addFiles(e.target.files);
                e.target.value = '';
              }
            }}
            className="hidden"
          />
          {galleryImages.length > 1 && (
            <p className="text-[10px] text-navy-400 mt-2 flex items-center gap-1">
              <GripVertical size={10} />
              Arrastra las imágenes para reordenar. La primera será la imagen principal del producto.
            </p>
          )}
        </div>

        <VariantEditor variants={variants} onChange={setVariants} />
        <div className="flex justify-end gap-3 pt-4 border-t border-surface-200">
          <button onClick={onClose} className="btn-secondary">Cancelar</button>
          <button onClick={handleSave} disabled={saving} className="btn-primary">{saving ? 'Guardando...' : (product && !product.id ? 'Crear Copia' : 'Guardar Producto')}</button>
        </div>
      </div>
    </Modal>
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

  // Barcode print modal state
  const [printModalOpen, setPrintModalOpen] = useState(false);
  const [printProduct, setPrintProduct] = useState<Product | undefined>(undefined);
  const [printVariantIndex, setPrintVariantIndex] = useState<number | undefined>(undefined);

  function openPrintModal(product?: Product, variantIndex?: number) {
    setPrintProduct(product);
    setPrintVariantIndex(variantIndex);
    setPrintModalOpen(true);
  }

  // USB barcode scanner integration
  useBarcodeScanner((barcode) => {
    const result = findByBarcode(products, barcode);
    if (result) {
      // Highlight transitorio en la card del catálogo
      setExpandedId(result.product.id);
      setTimeout(() => setExpandedId(null), 2500);
      // Scroll a la card
      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-product-id="${result.product.id}"]`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      });
      toast.success(`Producto encontrado: ${result.product.name} (${result.variant.size}/${result.variant.color})`);
    } else {
      toast.warning(`No se encontró producto con código: ${barcode}`);
    }
  });

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
        p.variants?.some((v) => v.color?.toLowerCase().includes(s) || v.size?.toLowerCase().includes(s) || v.barcode?.toLowerCase().includes(s))
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

  function handleDuplicate(p: Product) {
    const clone = {
      ...p,
      id: undefined,
      name: `${p.name} (copia)`,
      variants: p.variants.map(v => ({ ...v, stock: 0, barcode: '' })),
      // Don't share images — user should upload new ones for new color
      imageUrl: undefined,
      imageUrls: [],
    } as any;
    delete clone.id;
    setEditProduct(clone);
    setFormOpen(true);
    toast.info('Producto duplicado. Sube imágenes nuevas y guarda.');
  }
  function handleAdd() { setEditProduct(null); setFormOpen(true); }
  async function handleDelete(p: Product) {
    if (!confirm(`¿Eliminar "${p.name}"?`)) return;
    try { await deleteProduct(p.id, p.imageUrl, p.imageUrls); } catch { toast.error('Error al eliminar producto.'); }
  }
  async function handleToggleActive(p: Product) {
    const newState = !(p.active !== false); // default is true if undefined
    try {
      await toggleProductActive(p.id, newState);
      toast.success(`${p.name}: ${newState ? 'Visible' : 'Oculto'} en web y app.`);
    } catch { toast.error('Error al cambiar visibilidad.'); }
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
            <button onClick={() => openPrintModal()}
              className="btn-secondary text-sm gap-1" title="Imprimir códigos de barras">
              <Barcode size={14} /> Códigos
            </button>
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
                  className="input-field pl-9 text-sm" placeholder="Nombre, color, talla, barcode..." />
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

      {/* Catalog view — products as columns with sizes/stock per row */}
      <div className="space-y-6">
        {paginatedGroups.length === 0 ? (
          <div className="card p-16 text-center">
            <Package size={48} className="mx-auto text-navy-200 mb-3" />
            <p className="text-navy-400 text-sm font-display">No hay productos que coincidan.</p>
          </div>
        ) : (
          paginatedGroups.map((group) => (
            <div key={`${group.gender}-${group.category}`} className="card overflow-hidden">
              {/* Group header */}
              <div className="px-5 py-3 bg-surface-50 border-b border-surface-200 flex items-center justify-between sticky left-0">
                <div className="flex items-center gap-3">
                  <span className="text-lg">{group.gender === 'Hombre' ? '👔' : '👗'}</span>
                  <div>
                    <span className="font-display font-bold text-navy-900 text-sm">{group.category}</span>
                    <span className="text-navy-300 mx-2">·</span>
                    <span className="text-xs text-navy-500 font-display">{group.gender}</span>
                  </div>
                </div>
                <span className="badge badge-gray text-[10px]">{group.products.length} productos</span>
              </div>

              {/* Grid of product columns — wraps to next row */}
              <div className="grid gap-3 p-4 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
                {group.products.map((product) => {
                    const totalStockP = product.variants?.reduce((a, v) => a + (v.stock || 0), 0) || 0;
                    const lowStock = totalStockP <= 5;
                    const minP = Math.min(...(product.variants?.map((v) => v.price) || [0]));
                    const maxP = Math.max(...(product.variants?.map((v) => v.price) || [0]));
                    // Sort variants S, M, L, XL, 2XL, 3XL, 4XL, 5XL...
                    const sizeOrder = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', 'XXL', 'XXXL'];
                    const sortedVariants = [...(product.variants || [])].sort((a, b) => {
                      const ai = sizeOrder.indexOf(String(a.size).toUpperCase());
                      const bi = sizeOrder.indexOf(String(b.size).toUpperCase());
                      if (ai === -1 && bi === -1) return String(a.size).localeCompare(String(b.size));
                      if (ai === -1) return 1;
                      if (bi === -1) return -1;
                      return ai - bi;
                    });
                    const colorLabel = product.variants?.[0]?.color || '';
                    const allSameColor = product.variants?.every((v) => v.color === colorLabel);

                    return (
                      <div
                        key={product.id}
                        data-product-id={product.id}
                        className={`group/card relative w-full flex flex-col rounded-xl border bg-card cursor-pointer transition-all ${
                          expandedId === product.id
                            ? 'border-amber-500 ring-2 ring-amber-300 shadow-xl scale-[1.03]'
                            : 'border-surface-200 hover:border-amber-300 hover:shadow-lg'
                        }`}
                        onClick={() => can('canEditProducts') && handleEdit(product)}
                        title={can('canEditProducts') ? 'Click para editar' : product.name}
                      >
                        {/* Image */}
                        <div className="relative aspect-[4/5] rounded-t-xl bg-surface-50 dark:bg-surface-100/50 overflow-hidden">
                          {product.imageUrl ? (
                            <img
                              src={product.imageUrl}
                              alt={product.name}
                              className="w-full h-full object-contain p-2 mix-blend-multiply dark:mix-blend-normal"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <Package size={32} className="text-navy-200" />
                            </div>
                          )}
                          {product.active === false && (
                            <span className="absolute top-1.5 left-1.5 badge text-[8px] px-1.5 py-0.5 bg-red-500/90 text-white">Oculto</span>
                          )}
                          {/* Hover actions */}
                          <div
                            className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover/card:opacity-100 transition-opacity"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {can('canEditProducts') && (
                              <button
                                onClick={() => handleToggleActive(product)}
                                title={product.active !== false ? 'Ocultar' : 'Mostrar'}
                                className={`w-7 h-7 rounded-md flex items-center justify-center bg-white/95 backdrop-blur shadow-sm transition-colors ${product.active !== false ? 'text-emerald-600 hover:bg-emerald-50' : 'text-amber-600 hover:bg-amber-50'}`}
                              >
                                {product.active !== false ? <Eye size={13} /> : <EyeOff size={13} />}
                              </button>
                            )}
                            {can('canEditProducts') && (
                              <button
                                onClick={() => handleDuplicate(product)}
                                title="Duplicar"
                                className="w-7 h-7 rounded-md flex items-center justify-center bg-white/95 backdrop-blur shadow-sm text-navy-500 hover:bg-emerald-50 hover:text-emerald-600 transition-colors"
                              >
                                <Copy size={13} />
                              </button>
                            )}
                            {can('canDeleteProducts') && (
                              <button
                                onClick={() => handleDelete(product)}
                                title="Eliminar"
                                className="w-7 h-7 rounded-md flex items-center justify-center bg-white/95 backdrop-blur shadow-sm text-navy-500 hover:bg-red-50 hover:text-accent-red transition-colors"
                              >
                                <Trash2 size={13} />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Info */}
                        <div className="px-2.5 pt-2 pb-1.5 border-b border-surface-100">
                          <p className="font-display font-bold text-navy-900 text-[11px] leading-tight uppercase truncate">
                            {product.name}
                          </p>
                          <p className="text-[10px] text-navy-500 font-display uppercase truncate mt-0.5">
                            {allSameColor && colorLabel ? colorLabel : `${product.variants?.length || 0} colores`}
                          </p>
                          <p className="text-[10px] font-mono text-navy-400 mt-0.5">
                            {minP === maxP ? format(minP) : `${format(minP)}–${format(maxP)}`}
                          </p>
                        </div>

                        {/* Sizes / stock list */}
                        <div className="flex-1 px-2.5 py-2 space-y-0.5">
                          {sortedVariants.map((v, idx) => {
                            const isLow = (v.stock || 0) > 0 && (v.stock || 0) <= 2;
                            const isOut = (v.stock || 0) === 0;
                            return (
                              <div
                                key={`${v.size}-${v.color}-${idx}`}
                                className="flex items-baseline justify-between text-xs font-mono leading-snug"
                              >
                                <span className={`font-bold tabular-nums ${isOut ? 'text-navy-300' : 'text-navy-900'}`}>
                                  {v.stock || 0}
                                </span>
                                <span className={`text-[10px] uppercase font-display ${isOut ? 'text-navy-300 line-through' : isLow ? 'text-accent-red font-semibold' : 'text-navy-600'}`}>
                                  {v.size}
                                  {!allSameColor && v.color && <span className="text-navy-300 ml-1 normal-case">· {v.color}</span>}
                                </span>
                              </div>
                            );
                          })}
                        </div>

                        {/* Total */}
                        <div className={`px-2.5 py-2 border-t border-surface-200 flex items-center justify-between rounded-b-xl ${lowStock ? 'bg-red-50 dark:bg-red-900/20' : 'bg-surface-50 dark:bg-surface-100/30'}`}>
                          <span className="text-[9px] font-display font-semibold text-navy-400 uppercase tracking-wider">Total</span>
                          <span className={`text-sm font-mono font-bold tabular-nums ${lowStock ? 'text-accent-red' : 'text-navy-900'}`}>
                            {totalStockP} {lowStock && <AlertTriangle size={11} className="inline -mt-0.5" />}
                          </span>
                        </div>
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

      {/* Barcode Print Modal */}
      {printModalOpen && (
        <BarcodePrintModal
          open={printModalOpen}
          onClose={() => { setPrintModalOpen(false); setPrintProduct(undefined); setPrintVariantIndex(undefined); }}
          product={printProduct}
          variantIndex={printVariantIndex}
        />
      )}
    </div>
  );
}
