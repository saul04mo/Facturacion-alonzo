import { Modal } from '@/components/Modal';
import { useCurrency } from '@/hooks/useCurrency';
import type { Product } from '@/types';

export function VariantSelector({ product, onSelect, onClose }: {
  product: Product; onSelect: (variantIndex: number) => void; onClose: () => void;
}) {
  const { format } = useCurrency();
  return (
    <Modal open={true} onClose={onClose} title={`Variante — ${product.name}`} size="sm">
      {product.variants?.length === 0 ? (
        <p className="text-navy-400 text-sm text-center py-4">Sin variantes registradas.</p>
      ) : (
        <div className="space-y-2">
          {product.variants?.map((v, idx) => (
            <button key={idx} onClick={() => { onSelect(idx); onClose(); }}
              disabled={v.stock <= 0}
              className={`w-full flex items-center justify-between p-3 rounded-lg border transition-all
                ${v.stock <= 0
                  ? 'border-surface-200 bg-surface-100 opacity-50 cursor-not-allowed'
                  : 'border-surface-200 hover:border-blue-300 hover:bg-blue-50/50'}`}
            >
              <div className="flex items-center gap-3">
                <div className="text-sm">
                  <span className="font-display font-semibold text-navy-900">Talla {v.size || '—'}</span>
                  <span className="mx-2 text-navy-200">·</span>
                  <span className="text-navy-500">{v.color || 'Sin color'}</span>
                </div>
              </div>
              <div className="text-right">
                <span className="font-mono font-semibold text-navy-900 text-sm">{format(v.price)}</span>
                <p className={`text-[10px] ${v.stock <= 0 ? 'text-accent-red font-bold' : 'text-navy-400'}`}>
                  Stock: {v.stock}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}
