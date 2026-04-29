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
  const otherLabel = branch === 'store' ? 'Almacén' : 'Tienda';

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
            // Stock en la sucursal contraria — útil mostrarlo para que
            // el cajero sepa que existe pero hay que transferir.
            const stockOther = branch === 'store' ? breakdown.warehouse : breakdown.store;
            const noStock = stockHere <= 0;
            const blocked = noStock && !allowNegative;
            return (
              <button key={idx} onClick={() => { onSelect(idx); onClose(); }}
                disabled={blocked}
                className={`w-full flex items-center justify-between p-3 rounded-lg border transition-all
                  ${blocked
                    ? 'border-surface-200 bg-surface-100 opacity-50 cursor-not-allowed'
                    : 'border-surface-200 hover:border-blue-300 hover:bg-blue-50/50'}`}
              >
                <div className="flex items-center gap-3">
                  <div className="text-sm text-left">
                    <span className="font-display font-semibold text-navy-900">Talla {v.size || '—'}</span>
                    <span className="mx-2 text-navy-200">·</span>
                    <span className="text-navy-500">{v.color || 'Sin color'}</span>
                  </div>
                </div>
                <div className="text-right">
                  <span className="font-mono font-semibold text-navy-900 text-sm">{format(v.price)}</span>
                  <p className={`text-[10px] ${noStock ? 'text-accent-red font-bold' : 'text-navy-400'}`}>
                    {branchLabel}: {stockHere}
                  </p>
                  {/* Hint del stock en la otra sucursal */}
                  {stockOther > 0 && (
                    <p className="text-[9px] text-navy-300 italic">
                      ({otherLabel}: {stockOther})
                    </p>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
