import { Modal } from '@/components/Modal';
import { useCurrency } from '@/hooks/useCurrency';
import { useAppStore } from '@/store/appStore';
import { getAvailableStock, getStockBreakdown } from '@/utils/branchUtils';
import { Store, Warehouse } from 'lucide-react';
import type { Product } from '@/types';

export function VariantSelector({ product, onSelect, onClose }: {
  product: Product; onSelect: (variantIndex: number) => void; onClose: () => void;
}) {
  const { format } = useCurrency();
  // Si la config 'Permitir stock negativo' está activa, no deshabilitamos
  // las variantes con stock <= 0; el cajero podrá agregarlas igual y la
  // factura las descontará dejando stock negativo.
  const allowNegative = useAppStore((s) => s.allowNegativeStock);
  // Sucursal activa de la venta (Tienda o Almacén). El stock mostrado
  // y la validación se hacen contra esta sucursal, no contra el agregado.
  const branch = useAppStore((s) => s.currentSale.branch);
  const branchLabel = branch === 'store' ? 'Tienda' : 'Almacén';

  return (
    <Modal open={true} onClose={onClose} title={`Variante — ${product.name}`} size="sm">
      {/* Indicador de sucursal activa — el cajero sabe de dónde está vendiendo */}
      <div className={`mb-3 flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-display font-semibold ${
        branch === 'store'
          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300'
          : 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300'
      }`}>
        {branch === 'store' ? <Store size={14} /> : <Warehouse size={14} />}
        Vendiendo desde {branchLabel}
      </div>

      {product.variants?.length === 0 ? (
        <p className="text-navy-400 text-sm text-center py-4">Sin variantes registradas.</p>
      ) : (
        <div className="space-y-2">
          {product.variants?.map((v, idx) => {
            const stockHere = getAvailableStock(v, branch);
            const breakdown = getStockBreakdown(v);
            // Mostramos SIEMPRE ambos inventarios (Tienda y Almacén) para que
            // el cajero tenga visibilidad completa del stock disponible aunque
            // la venta solo descuente de la sucursal activa.
            const stockStore = breakdown.store;
            const stockWarehouse = breakdown.warehouse;
            const noStock = stockHere <= 0;
            const blocked = noStock && !allowNegative;
            return (
              <button key={idx} onClick={() => { onSelect(idx); onClose(); }}
                disabled={blocked}
                className={`w-full flex items-center justify-between p-3 rounded-lg border transition-all
                  ${blocked
                    ? 'border-surface-200 bg-surface-50 cursor-not-allowed dark:border-navy-800 dark:bg-navy-900/50'
                    : 'border-surface-200 hover:border-blue-300 hover:bg-blue-50/50'}`}
              >
                <div className="flex items-center gap-3">
                  <div className="text-sm text-left">
                    <span className="font-display font-semibold text-navy-900">Talla {v.size || '—'}</span>
                    <span className="mx-2 text-navy-200">·</span>
                    <span className="text-navy-500">{v.color || 'Sin color'}</span>
                  </div>
                </div>
                <div className="text-right flex flex-col items-end gap-1">
                  <span className="font-mono font-semibold text-navy-900 text-sm">{format(v.price)}</span>
                  {/* Ambos inventarios visibles. La sucursal activa se resalta
                      con borde para que el cajero sepa de cuál se descuenta. */}
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-mono
                        ${branch === 'store'
                          ? (stockStore <= 0
                              ? 'bg-accent-red/10 text-accent-red font-bold ring-1 ring-accent-red/40'
                              : 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-300 dark:bg-emerald-900/20 dark:text-emerald-300')
                          : 'bg-surface-100 text-navy-500 ring-1 ring-surface-200 dark:bg-dark-300 dark:text-gray-100 dark:ring-dark-400'}`}
                      title={branch === 'store' ? 'Sucursal activa de la venta' : 'Stock en Tienda (no se descuenta de aquí)'}
                    >
                      <Store size={12} />
                      <span>Tienda: {stockStore}</span>
                    </span>
                    <span
                      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-mono
                        ${branch === 'warehouse'
                          ? (stockWarehouse <= 0
                              ? 'bg-accent-red/10 text-accent-red font-bold ring-1 ring-accent-red/40'
                              : 'bg-blue-50 text-blue-700 ring-1 ring-blue-300 dark:bg-blue-900/20 dark:text-blue-300')
                          : 'bg-surface-100 text-navy-500 ring-1 ring-surface-200 dark:bg-dark-300 dark:text-gray-100 dark:ring-dark-400'}`}
                      title={branch === 'warehouse' ? 'Sucursal activa de la venta' : 'Stock en Almacén (no se descuenta de aquí)'}
                    >
                      <Warehouse size={12} />
                      <span>Almacén: {stockWarehouse}</span>
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
