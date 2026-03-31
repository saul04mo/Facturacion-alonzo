import { useState } from 'react';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';

export function DiscountModal({
  currentDiscount, subtotal, onApply, onClose,
}: {
  currentDiscount: { type: 'none' | 'percentage' | 'fixed'; value: number };
  subtotal: number;
  onApply: (discount: { type: 'none' | 'percentage' | 'fixed'; value: number }) => void;
  onClose: () => void;
}) {
  const [type, setType] = useState<'percentage' | 'fixed'>(
    currentDiscount.type === 'none' ? 'percentage' : currentDiscount.type,
  );
  const [value, setValue] = useState(currentDiscount.value ? String(currentDiscount.value) : '');
  const toast = useToast();

  function handleApply() {
    const numValue = parseFloat(value);
    if (isNaN(numValue) || numValue < 0) {
      onApply({ type: 'none', value: 0 });
    } else {
      if (type === 'percentage' && numValue > 100) return toast.warning('El porcentaje no puede ser mayor a 100');
      if (type === 'fixed' && numValue > subtotal) return toast.warning('El descuento no puede ser mayor al subtotal');
      onApply({ type, value: numValue });
    }
    onClose();
  }

  function handleRemove() {
    onApply({ type: 'none', value: 0 });
    onClose();
  }

  return (
    <Modal open={true} onClose={onClose} title="Aplicar Descuento General" size="sm">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-display font-medium text-navy-700 mb-2">Tipo de Descuento</label>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" checked={type === 'percentage'} onChange={() => setType('percentage')} className="text-blue-500 focus:ring-blue-500" />
              <span className="text-sm text-navy-700">Porcentaje (%)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" checked={type === 'fixed'} onChange={() => setType('fixed')} className="text-blue-500 focus:ring-blue-500" />
              <span className="text-sm text-navy-700">Monto Fijo ($)</span>
            </label>
          </div>
        </div>
        <div>
          <label className="block text-sm font-display font-medium text-navy-700 mb-1.5">Valor</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-navy-400 font-mono">
              {type === 'percentage' ? '%' : '$'}
            </span>
            <input
              type="number" step="0.01" value={value}
              onChange={(e) => setValue(e.target.value)}
              className="input-field pl-8 font-mono"
              placeholder="0.00"
            />
          </div>
        </div>
        <div className="flex gap-3 pt-4 border-t border-surface-200">
          <button onClick={handleRemove} className="btn-secondary flex-1">Quitar</button>
          <button onClick={handleApply} className="btn-primary flex-1">Aplicar</button>
        </div>
      </div>
    </Modal>
  );
}
