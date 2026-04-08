import { useEffect, useRef, useState } from 'react';
import JsBarcode from 'jsbarcode';
import { Modal } from '@/components/Modal';
import { useAppStore } from '@/store/appStore';
import { useCurrency } from '@/hooks/useCurrency';
import { Printer } from 'lucide-react';
import type { Product, ProductVariant } from '@/types';

// ============================
// BARCODE RENDERER (SVG)
// ============================
export function BarcodeRenderer({ 
  value, 
  width = 1.5, 
  height = 50, 
  fontSize = 12,
  displayValue = true,
  className = '' 
}: { 
  value: string; 
  width?: number; 
  height?: number; 
  fontSize?: number;
  displayValue?: boolean;
  className?: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (svgRef.current && value) {
      try {
        JsBarcode(svgRef.current, value, {
          format: 'CODE128',
          width,
          height,
          fontSize,
          displayValue,
          margin: 5,
          background: '#ffffff',
          lineColor: '#0a0a23',
        });
      } catch (err) {
        console.error('Barcode render error:', err);
      }
    }
  }, [value, width, height, fontSize, displayValue]);

  if (!value) return null;

  return <svg ref={svgRef} className={className} />;
}

// ============================
// GENERATE RANDOM BARCODE (EAN-13 compatible)
// ============================
export function generateBarcode(): string {
  // Generate a 12-digit number, then calculate EAN-13 check digit
  const prefix = '789'; // Standard prefix
  const random = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10)).join('');
  const partial = prefix + random;
  
  // Calculate EAN-13 check digit
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(partial[i]) * (i % 2 === 0 ? 1 : 3);
  }
  const checkDigit = (10 - (sum % 10)) % 10;
  return partial + checkDigit;
}

// ============================
// BARCODE PRINT MODAL
// ============================
interface BarcodePrintItem {
  barcode: string;
  productName: string;
  variantLabel: string;
  price: number;
  quantity: number;
}

export function BarcodePrintModal({ 
  open, 
  onClose, 
  product,
  variantIndex,
}: { 
  open: boolean; 
  onClose: () => void;
  product?: Product;
  variantIndex?: number;
}) {
  const products = useAppStore((s) => s.products);
  const { format } = useCurrency();
  
  // Build list of items to print
  const [items, setItems] = useState<BarcodePrintItem[]>([]);
  const [labelSize, setLabelSize] = useState<'small' | 'medium' | 'large'>('medium');
  
  useEffect(() => {
    if (product) {
      // Single product mode
      const variantsToShow = variantIndex !== undefined 
        ? [{ v: product.variants[variantIndex], idx: variantIndex }]
        : product.variants.map((v, idx) => ({ v, idx }));
      
      setItems(
        variantsToShow
          .filter(({ v }) => v.barcode)
          .map(({ v }) => ({
            barcode: v.barcode!,
            productName: product.name,
            variantLabel: `${v.size} / ${v.color}`,
            price: v.price,
            quantity: 1,
          }))
      );
    } else {
      // All products mode
      const allItems: BarcodePrintItem[] = [];
      products.forEach((p) => {
        p.variants?.forEach((v) => {
          if (v.barcode) {
            allItems.push({
              barcode: v.barcode,
              productName: p.name,
              variantLabel: `${v.size} / ${v.color}`,
              price: v.price,
              quantity: 1,
            });
          }
        });
      });
      setItems(allItems);
    }
  }, [product, variantIndex, products]);

  function updateQuantity(idx: number, qty: number) {
    setItems(prev => prev.map((item, i) => i === idx ? { ...item, quantity: Math.max(0, qty) } : item));
  }

  function handlePrint() {
    const printWindow = window.open('', '_blank', 'width=800,height=600');
    if (!printWindow) return;

    const sizeStyles = {
      small: { w: '35mm', h: '22mm', bw: 1, bh: 25, fs: 7, nameFs: '6px', priceFs: '7px' },
      medium: { w: '50mm', h: '30mm', bw: 1.2, bh: 35, fs: 10, nameFs: '8px', priceFs: '9px' },
      large: { w: '70mm', h: '40mm', bw: 1.5, bh: 45, fs: 12, nameFs: '10px', priceFs: '11px' },
    };
    const s = sizeStyles[labelSize];

    // Generate barcode SVGs for the print window
    const labelsHtml = items
      .filter(item => item.quantity > 0)
      .flatMap(item => 
        Array.from({ length: item.quantity }, (_, i) => `
          <div class="label" style="width:${s.w};height:${s.h};">
            <div class="name">${item.productName}</div>
            <div class="variant">${item.variantLabel}</div>
            <svg class="barcode" id="bc-${item.barcode}-${i}"></svg>
            <div class="price">${format(item.price)}</div>
          </div>
        `)
      ).join('');

    const barcodeValues = items
      .filter(item => item.quantity > 0)
      .flatMap(item => 
        Array.from({ length: item.quantity }, (_, i) => ({ 
          id: `bc-${item.barcode}-${i}`, 
          value: item.barcode 
        }))
      );

    printWindow.document.write(`<!DOCTYPE html><html><head>
      <title>Etiquetas de Código de Barras - Alonzo</title>
      <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"></script>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', Arial, sans-serif; }
        .labels { display: flex; flex-wrap: wrap; gap: 2mm; padding: 5mm; }
        .label {
          border: 0.5px dashed #ccc;
          padding: 2mm;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          page-break-inside: avoid;
        }
        .name { font-size: ${s.nameFs}; font-weight: 700; line-height: 1.2; max-height: 2.4em; overflow: hidden; }
        .variant { font-size: ${s.nameFs}; color: #666; margin-bottom: 1mm; }
        .barcode { max-width: 100%; }
        .price { font-size: ${s.priceFs}; font-weight: 800; margin-top: 1mm; }
        @media print {
          .label { border: none; }
        }
      </style>
    </head><body>
      <div class="labels">${labelsHtml}</div>
      <script>
        const barcodes = ${JSON.stringify(barcodeValues)};
        barcodes.forEach(bc => {
          try {
            JsBarcode('#' + bc.id, bc.value, {
              format: 'CODE128',
              width: ${s.bw},
              height: ${s.bh},
              fontSize: ${s.fs},
              displayValue: true,
              margin: 2,
              background: '#ffffff',
              lineColor: '#000000',
            });
          } catch(e) { console.error(e); }
        });
        setTimeout(() => window.print(), 500);
      </script>
    </body></html>`);
    printWindow.document.close();
  }

  const totalLabels = items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <Modal open={open} onClose={onClose} title="Imprimir Códigos de Barras" size="lg">
      <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
        {/* Label size selector */}
        <div>
          <label className="block text-xs font-display font-semibold text-navy-600 mb-2">Tamaño de Etiqueta</label>
          <div className="flex gap-2">
            {(['small', 'medium', 'large'] as const).map(size => (
              <button
                key={size}
                onClick={() => setLabelSize(size)}
                className={`flex-1 px-3 py-2 rounded-lg border text-xs font-display font-semibold transition-all ${
                  labelSize === size
                    ? 'border-amber-400 bg-amber-50 text-amber-700'
                    : 'border-surface-200 text-navy-500 hover:bg-surface-50'
                }`}
              >
                {size === 'small' ? '35×22mm' : size === 'medium' ? '50×30mm' : '70×40mm'}
              </button>
            ))}
          </div>
        </div>

        {/* Items list */}
        {items.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-navy-400 text-sm">No hay variantes con código de barras asignado.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((item, idx) => (
              <div key={`${item.barcode}-${idx}`} className="flex items-center gap-3 p-3 bg-surface-50 rounded-lg border border-surface-200">
                <div className="flex-shrink-0 bg-white p-1 rounded border border-surface-200">
                  <BarcodeRenderer value={item.barcode} width={1} height={30} fontSize={8} className="max-w-[100px]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-display font-semibold text-navy-900 truncate">{item.productName}</p>
                  <p className="text-[10px] text-navy-400">{item.variantLabel}</p>
                  <p className="text-[10px] font-mono font-semibold text-navy-600">{format(item.price)}</p>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <label className="text-[10px] text-navy-400 font-display">Cant:</label>
                  <input
                    type="number"
                    min="0"
                    value={item.quantity}
                    onChange={(e) => updateQuantity(idx, parseInt(e.target.value) || 0)}
                    className="w-14 h-7 text-center text-xs font-mono border border-surface-200 rounded-md outline-none focus:border-amber-400"
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 pt-4 border-t border-surface-200 mt-4">
        <p className="text-xs text-navy-400 font-display">
          Total: <span className="font-bold text-navy-700">{totalLabels}</span> etiquetas
        </p>
        <div className="flex gap-2">
          <button onClick={onClose} className="btn-secondary text-sm">Cancelar</button>
          <button
            onClick={handlePrint}
            disabled={totalLabels === 0}
            className="btn-primary text-sm gap-1.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50"
          >
            <Printer size={14} /> Imprimir ({totalLabels})
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ============================
// BARCODE SCANNER HOOK (USB / keyboard barcode readers)
// ============================
export function useBarcodeScanner(onScan: (barcode: string) => void, enabled: boolean = true) {
  const bufferRef = useRef('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) return;

    function handleKeyDown(e: KeyboardEvent) {
      // Ignore if user is typing in an input field
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
        return;
      }

      // USB barcode scanners send characters very quickly followed by Enter
      if (e.key === 'Enter') {
        if (bufferRef.current.length >= 8) {
          onScan(bufferRef.current);
        }
        bufferRef.current = '';
        if (timerRef.current) clearTimeout(timerRef.current);
        return;
      }

      // Only accept printable characters
      if (e.key.length === 1) {
        bufferRef.current += e.key;
        
        // Reset buffer after 100ms of no input (normal typing is slower)
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          bufferRef.current = '';
        }, 100);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [onScan, enabled]);
}

// ============================
// FIND PRODUCT BY BARCODE
// ============================
export function findByBarcode(products: Product[], barcode: string): { product: Product; variant: ProductVariant; variantIndex: number } | null {
  for (const product of products) {
    const variantIndex = product.variants?.findIndex(v => v.barcode === barcode);
    if (variantIndex !== undefined && variantIndex >= 0) {
      return { product, variant: product.variants[variantIndex], variantIndex };
    }
  }
  return null;
}
