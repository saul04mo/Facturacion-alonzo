import { useState, useMemo, useRef } from 'react';
import { useAppStore } from '@/store/appStore';
import { useToast } from '@/components/Toast';
import { Modal } from '@/components/Modal';
import { createTransfer } from './transferService';
import type { Product, Branch } from '@/types';
import {
  Plus, Trash2, Search, Image as ImageIcon, X, Warehouse, ArrowRight, Store,
  Package, Camera, AlertTriangle, ArrowLeftRight,
} from 'lucide-react';

interface DraftItem {
  productId: string;
  productName: string;
  size: string;
  color: string;
  variantIndex: number;
  /** Stock disponible en la sucursal de ORIGEN al momento de armar la draft. */
  availableAtSource: number;
  quantitySent: number;
}

/** Nombre del campo de stock en la variante para una sucursal dada. */
function stockField(branch: Branch): 'stockStore' | 'stockWarehouse' {
  return branch === 'store' ? 'stockStore' : 'stockWarehouse';
}
function branchLabel(branch: Branch): string {
  return branch === 'store' ? 'Tienda' : 'Almacén';
}

export function CreateTransferModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const currentUser = useAppStore((s) => s.currentUser);
  const toast = useToast();

  // Dirección de la transferencia. 'to' siempre es el opuesto a 'from'.
  const [from, setFrom] = useState<Branch>('warehouse');
  const to: Branch = from === 'warehouse' ? 'store' : 'warehouse';
  const sourceLabel = branchLabel(from);
  const destLabel = branchLabel(to);
  const sourceField = stockField(from);

  const [items, setItems] = useState<DraftItem[]>([]);
  const [observation, setObservation] = useState('');
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofPreview, setProofPreview] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const totalUnits = useMemo(() => items.reduce((acc, i) => acc + i.quantitySent, 0), [items]);

  /** Invertir dirección. Limpia los items porque sus disponibilidades quedan
   *  obsoletas (el origen cambió y los stocks de cada variante son distintos). */
  function flipDirection() {
    if (items.length > 0) {
      const ok = confirm(
        `Cambiar dirección a ${branchLabel(to)} → ${branchLabel(from)} vaciará los productos ya agregados (porque las disponibilidades cambian con el origen). ¿Continuar?`,
      );
      if (!ok) return;
      setItems([]);
    }
    setFrom(to);
  }

  function handleAddItem(product: Product, variantIndex: number) {
    const variant = product.variants[variantIndex];
    const available = (variant as any)[sourceField] ?? 0;
    if (available <= 0) {
      toast.warning(`${product.name} ${variant.size}/${variant.color} no tiene stock en ${sourceLabel.toLowerCase()}.`);
      return;
    }
    // Si ya existe en la draft, sumamos 1
    const existing = items.find(
      (i) => i.productId === product.id && i.variantIndex === variantIndex,
    );
    if (existing) {
      const proposed = existing.quantitySent + 1;
      if (proposed > available) {
        toast.warning(`No podés mover más de ${available} unidades (todo el stock de ${sourceLabel.toLowerCase()}).`);
        return;
      }
      updateQuantity(items.indexOf(existing), proposed);
      return;
    }
    setItems((prev) => [
      ...prev,
      {
        productId: product.id,
        productName: product.name,
        size: variant.size,
        color: variant.color,
        variantIndex,
        availableAtSource: available,
        quantitySent: 1,
      },
    ]);
  }

  function updateQuantity(idx: number, quantity: number) {
    if (quantity < 0) quantity = 0;
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, quantitySent: quantity } : it)));
  }

  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleProofChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.warning('El archivo debe ser una imagen.');
      return;
    }
    setProofFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setProofPreview((ev.target?.result as string) || null);
    reader.readAsDataURL(file);
  }

  async function handleSubmit() {
    if (!currentUser) {
      toast.error('Usuario no identificado.');
      return;
    }
    if (items.length === 0) {
      toast.warning('Agregá al menos un producto.');
      return;
    }
    if (items.some((i) => i.quantitySent <= 0)) {
      toast.warning('Todas las cantidades deben ser mayores que cero.');
      return;
    }
    // Validación de stock (suave — la validación dura pasa al ENVIAR, no al crear)
    const overflow = items.find((i) => i.quantitySent > i.availableAtSource);
    if (overflow) {
      toast.warning(
        `${overflow.productName} ${overflow.size}/${overflow.color}: cantidad excede el stock de ${sourceLabel.toLowerCase()} (${overflow.availableAtSource}).`,
      );
      return;
    }

    setSubmitting(true);
    try {
      const result = await createTransfer({
        items: items.map((i) => ({
          productId: i.productId,
          productName: i.productName,
          size: i.size,
          color: i.color,
          quantitySent: i.quantitySent,
        })),
        from,
        to,
        proofFile,
        observation: observation.trim() || undefined,
        currentUser,
      });
      toast.success(`TR-${result.numericId} creada en estado "Pendiente".`);
      onCreated();
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || 'Error al crear la transferencia.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Nueva transferencia" size="lg">
      <div className="space-y-4">
        {/* Origen → Destino (toggle) */}
        <div className="flex items-center gap-2.5 px-3 py-2.5 bg-surface-50 dark:bg-dark-200/40 rounded-lg">
          {from === 'warehouse' ? (
            <Warehouse size={18} className="text-blue-500" />
          ) : (
            <Store size={18} className="text-emerald-500" />
          )}
          <span className="text-sm font-display font-bold text-navy-900 dark:text-gray-100">
            {sourceLabel}
          </span>
          <ArrowRight size={16} strokeWidth={2.5} className="mx-1 text-navy-500 dark:text-gray-400" />
          {to === 'warehouse' ? (
            <Warehouse size={18} className="text-blue-500" />
          ) : (
            <Store size={18} className="text-emerald-500" />
          )}
          <span className="text-sm font-display font-bold text-navy-900 dark:text-gray-100">
            {destLabel}
          </span>
          <button
            type="button"
            onClick={flipDirection}
            disabled={submitting}
            className="ml-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-display font-bold uppercase tracking-wider text-navy-800 dark:text-gray-100 bg-white dark:bg-dark-400 ring-1 ring-surface-300 dark:ring-dark-400 shadow-sm hover:bg-blue-50 dark:hover:bg-dark-300 hover:ring-blue-300 dark:hover:ring-blue-500/50 hover:text-blue-700 dark:hover:text-blue-300 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            title="Invertir dirección de la transferencia"
          >
            <ArrowLeftRight size={13} strokeWidth={2.5} /> Invertir
          </button>
          <span className="ml-auto text-[10px] text-navy-400 dark:text-gray-500">
            Estado inicial: <strong className="text-amber-600">Pendiente</strong> (no descuenta stock todavía)
          </span>
        </div>

        {/* Items */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-display font-semibold text-navy-500 dark:text-gray-400 uppercase flex items-center gap-1">
              <Package size={12} /> Productos a transferir ({items.length})
            </p>
            <button
              onClick={() => setPickerOpen(true)}
              className="btn-secondary text-xs"
              type="button"
            >
              <Plus size={13} /> Agregar producto
            </button>
          </div>

          {items.length === 0 ? (
            <div className="border-2 border-dashed border-surface-200 dark:border-dark-300 rounded-lg p-6 text-center">
              <Package size={28} className="mx-auto text-navy-200 mb-2" />
              <p className="text-xs text-navy-400 dark:text-gray-500">
                Agregá productos de {sourceLabel.toLowerCase()} para transferir a {destLabel.toLowerCase()}.
              </p>
            </div>
          ) : (
            <div className="border border-surface-200 dark:border-dark-300 rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-surface-50 dark:bg-dark-200/40">
                  <tr>
                    <th className="text-left px-3 py-2 font-display font-semibold text-navy-500">Producto</th>
                    <th className="text-left px-3 py-2 font-display font-semibold text-navy-500 w-16">Talla</th>
                    <th className="text-left px-3 py-2 font-display font-semibold text-navy-500 w-28">Color</th>
                    <th
                      className="text-right px-3 py-2 font-display font-semibold text-navy-500 w-20"
                      title={`Stock disponible en ${sourceLabel.toLowerCase()}`}
                    >
                      Disp.
                    </th>
                    <th className="text-right px-3 py-2 font-display font-semibold text-navy-500 w-24">Cantidad</th>
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-100 dark:divide-dark-300/40">
                  {items.map((item, idx) => {
                    const tooMuch = item.quantitySent > item.availableAtSource;
                    return (
                      <tr key={idx}>
                        <td className="px-3 py-2 text-navy-900 dark:text-gray-200 truncate">{item.productName}</td>
                        <td className="px-3 py-2 font-mono text-navy-700 dark:text-gray-300">{item.size}</td>
                        <td className="px-3 py-2 text-navy-600 dark:text-gray-400 truncate">{item.color}</td>
                        <td className="px-3 py-2 text-right font-mono text-navy-500">{item.availableAtSource}</td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min="0"
                            max={item.availableAtSource}
                            value={item.quantitySent}
                            onChange={(e) => updateQuantity(idx, parseInt(e.target.value) || 0)}
                            className={`input-field text-xs py-1 px-2 w-20 text-right font-mono ${tooMuch ? 'border-red-400 bg-red-50 dark:bg-red-900/20' : ''}`}
                          />
                        </td>
                        <td className="px-2 py-2">
                          <button
                            onClick={() => removeItem(idx)}
                            className="text-red-500 hover:text-red-700"
                            type="button"
                          >
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-surface-50 dark:bg-dark-200/40">
                  <tr>
                    <td colSpan={4} className="px-3 py-2 text-right font-display font-semibold text-navy-500">
                      Total
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-bold text-navy-900 dark:text-gray-100">{totalUnits}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>

        {/* Foto del despacho */}
        <div>
          <p className="text-xs font-display font-semibold text-navy-500 dark:text-gray-400 uppercase mb-1 flex items-center gap-1">
            <Camera size={12} /> Foto del despacho (opcional)
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleProofChange}
            className="hidden"
          />
          {proofPreview ? (
            <div className="relative inline-block">
              <img src={proofPreview} alt="Despacho" className="max-h-32 rounded-lg border border-surface-200 dark:border-dark-300" />
              <button
                onClick={() => { setProofFile(null); setProofPreview(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-0.5 shadow-sm"
                type="button"
              >
                <X size={12} />
              </button>
            </div>
          ) : (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-surface-200 dark:border-dark-300 rounded-lg p-3 hover:bg-surface-50 dark:hover:bg-dark-200/40 transition-colors text-xs text-navy-500 dark:text-gray-400 flex items-center gap-2"
              type="button"
            >
              <ImageIcon size={16} /> Subir foto
            </button>
          )}
        </div>

        {/* Observaciones */}
        <div>
          <p className="text-xs font-display font-semibold text-navy-500 dark:text-gray-400 uppercase mb-1">
            Observaciones (opcional)
          </p>
          <textarea
            value={observation}
            onChange={(e) => setObservation(e.target.value)}
            placeholder="Notas internas: número de remito, transportista, etc."
            rows={2}
            className="input-field text-xs"
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 pt-2 border-t border-surface-200 dark:border-dark-300">
          <p className="text-[10px] text-navy-400 italic">
            Al crear queda en <strong>Pendiente</strong>. El stock se descuenta del almacén
            al hacer click en "Enviar" en el listado.
          </p>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-ghost text-sm" type="button">Cancelar</button>
            <button
              onClick={handleSubmit}
              disabled={submitting || items.length === 0}
              className="btn-primary text-sm"
              type="button"
            >
              {submitting ? 'Creando…' : 'Crear transferencia'}
            </button>
          </div>
        </div>
      </div>

      {pickerOpen && (
        <ProductPickerModal
          source={from}
          onClose={() => setPickerOpen(false)}
          onPick={(p, vi) => { handleAddItem(p, vi); /* mantenemos el picker abierto */ }}
        />
      )}
    </Modal>
  );
}

// ════════════════════════════════════════
// PRODUCT PICKER (sub-modal)
// ════════════════════════════════════════

function ProductPickerModal({
  source,
  onClose,
  onPick,
}: {
  source: Branch;
  onClose: () => void;
  onPick: (product: Product, variantIndex: number) => void;
}) {
  const products = useAppStore((s) => s.products);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState<string>('all');

  const sourceField = stockField(source);
  const sourceLabel = branchLabel(source).toLowerCase();

  // Solo productos con al menos una variante con stock en la sucursal de origen
  const productsWithSourceStock = useMemo(() => {
    return products.filter((p) =>
      p.variants?.some((v) => ((v as any)[sourceField] ?? 0) > 0),
    );
  }, [products, sourceField]);

  // Categorías únicas (con género para diferenciar "PANTALONES Hombre" vs
  // "PANTALONES Mujer"). Cada opción del dropdown lleva un id sintético
  // gender|||category — coincide con el formato usado en InventoryPage.
  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    productsWithSourceStock.forEach((p) => {
      const key = `${p.gender || 'Sin género'}|||${p.category || 'Sin categoría'}`;
      set.add(key);
    });
    return Array.from(set).sort();
  }, [productsWithSourceStock]);

  const filtered = useMemo(() => {
    let list = productsWithSourceStock;

    // Filtro por categoría
    if (filterCategory !== 'all') {
      const [g, c] = filterCategory.split('|||');
      list = list.filter((p) => (p.gender || 'Sin género') === g && (p.category || 'Sin categoría') === c);
    }

    // Filtro por búsqueda de texto
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((p) =>
        p.name.toLowerCase().includes(q) ||
        p.category?.toLowerCase().includes(q) ||
        p.gender?.toLowerCase().includes(q),
      );
    }
    return list;
  }, [productsWithSourceStock, search, filterCategory]);

  return (
    <Modal open onClose={onClose} title={`Seleccionar producto · desde ${branchLabel(source)}`} size="md">
      <div className="space-y-3">
        {/* Buscador + filtro de categoría */}
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-navy-300" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar producto…"
              autoFocus
              className="input-field text-sm pl-9"
            />
          </div>
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="input-field text-sm sm:w-56"
            title="Filtrar por categoría"
          >
            <option value="all">Todas las categorías ({productsWithSourceStock.length})</option>
            {categoryOptions.map((opt) => {
              const [g, c] = opt.split('|||');
              const count = productsWithSourceStock.filter(
                (p) => (p.gender || 'Sin género') === g && (p.category || 'Sin categoría') === c,
              ).length;
              return (
                <option key={opt} value={opt}>
                  {g} · {c} ({count})
                </option>
              );
            })}
          </select>
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-8">
            <AlertTriangle size={28} className="mx-auto text-amber-400 mb-2" />
            <p className="text-xs text-navy-400">
              {productsWithSourceStock.length === 0
                ? `No hay productos con stock en ${sourceLabel}.`
                : 'Ningún producto coincide con la búsqueda.'}
            </p>
          </div>
        ) : (
          <div className="max-h-96 overflow-y-auto border border-surface-200 dark:border-dark-300 rounded-lg divide-y divide-surface-100 dark:divide-dark-300/40">
            {filtered.map((product) => {
              const variantsInStock = (product.variants || []).filter((v) => ((v as any)[sourceField] ?? 0) > 0);
              // Suma total de unidades en el origen (todas las variantes)
              // — al cajero le sirve saber el total general del producto
              // sin tener que sumar mentalmente cada variante.
              const totalUnits = variantsInStock.reduce((acc, v) => acc + ((v as any)[sourceField] ?? 0), 0);
              return (
                <div key={product.id} className="p-3">
                  <div className="flex items-center gap-3 mb-2">
                    {product.imageUrl ? (
                      <img src={product.imageUrl} alt={product.name} className="w-10 h-10 rounded object-cover" />
                    ) : (
                      <div className="w-10 h-10 rounded bg-surface-100 dark:bg-dark-300 flex items-center justify-center">
                        <Package size={14} className="text-navy-300" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-display font-semibold text-sm text-navy-900 dark:text-gray-100 truncate">{product.name}</p>
                        <span className="flex-shrink-0 px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800/40 text-blue-700 dark:text-blue-300 text-[10px] font-mono font-bold">
                          {totalUnits} {totalUnits === 1 ? 'unidad' : 'unidades'}
                        </span>
                      </div>
                      <p className="text-[10px] text-navy-400">
                        {product.gender} · {product.category} · {variantsInStock.length} variante{variantsInStock.length === 1 ? '' : 's'} con stock
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {variantsInStock.map((v) => {
                      const variantIndex = product.variants.indexOf(v);
                      const stockHere = (v as any)[sourceField] ?? 0;
                      return (
                        <button
                          key={`${v.size}-${v.color}-${variantIndex}`}
                          onClick={() => onPick(product, variantIndex)}
                          className="px-2 py-1 rounded-md border border-surface-200 dark:border-dark-300 bg-surface-50 dark:bg-dark-200/40 hover:border-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors text-[10px] font-display"
                          type="button"
                          title={`Click para agregar 1 unidad (stock en ${sourceLabel}: ${stockHere})`}
                        >
                          <span className="font-semibold text-navy-700 dark:text-gray-300">{v.size}</span>
                          <span className="mx-1 text-navy-300">·</span>
                          <span className="text-navy-500">{v.color}</span>
                          <span className="ml-2 font-mono text-blue-600">×{stockHere}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex justify-end pt-2 border-t border-surface-200 dark:border-dark-300">
          <button onClick={onClose} className="btn-secondary text-sm" type="button">Listo</button>
        </div>
      </div>
    </Modal>
  );
}
