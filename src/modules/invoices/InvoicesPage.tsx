import { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useAppStore } from '@/store/appStore';
import { usePermissions } from '@/hooks/usePermissions';
import { useCurrency } from '@/hooks/useCurrency';
import { useToast } from '@/components/Toast';
import { DELIVERY_TYPES } from '@/config/constants';
import { Modal } from '@/components/Modal';
import { processReturn, processExchange, cancelInvoice, approveWebOrder, confirmDeliveryPayment, addAbono, PAYMENT_METHODS, fetchInvoicesByDateRange, fetchInvoiceByNumericId, updateInvoiceCustomerData, updatePaymentRef, updateInvoiceStatus, updateInvoiceSeller } from './invoiceService';
import { ExchangeModal } from './ExchangeModal';
import type { ExchangeConfirmData } from './ExchangeModal';
import { VerifyPagoMovilButton } from './VerifyPagoMovilButton';
import { validarPagoMovil, type BanescoTransaction } from '@/services/banescoService';
import { printReceipt, downloadReceiptPdf } from '@/services/receiptService';
import { calcDiscountAmount } from '@/utils/discountUtils';
import { todayVE, toDate } from '@/utils/dateUtils';
import { STATUS_CONFIG, isCountableSale } from '@/utils/invoiceStatus';
import { sizeLabel } from '@/utils/branchUtils';
import type { Product, Invoice, InvoiceStatus } from '@/types';
import {
  FileText, RotateCcw, XCircle, CheckCircle, DollarSign,
  Eye, Check, X as XIcon, Printer, Download, ImageIcon, Hash, Edit2, ChevronDown, ArrowLeftRight, ShieldCheck, Loader2,
} from 'lucide-react';

// Estilos de los botones de acción de cada factura. Cada acción tiene su
// propio color de fondo + ícono para que sean fáciles de distinguir de un
// vistazo (antes eran todos gris y solo se coloreaban al hover). Las clases
// están escritas como literales completos para que Tailwind no las purgue.
const ACTION_BTN: Record<string, string> = {
  blue: 'inline-flex items-center justify-center p-1.5 rounded-lg border border-blue-200 bg-blue-50 text-blue-600 hover:bg-blue-100 dark:bg-blue-900/20 dark:border-blue-800/40 dark:text-blue-300 transition-colors',
  purple: 'inline-flex items-center justify-center p-1.5 rounded-lg border border-purple-200 bg-purple-50 text-purple-600 hover:bg-purple-100 dark:bg-purple-900/20 dark:border-purple-800/40 dark:text-purple-300 transition-colors',
  slate: 'inline-flex items-center justify-center p-1.5 rounded-lg border border-surface-200 bg-surface-100 text-navy-600 hover:bg-surface-200 dark:bg-dark-300/60 dark:border-dark-400 dark:text-gray-300 transition-colors',
  cyan: 'inline-flex items-center justify-center p-1.5 rounded-lg border border-cyan-200 bg-cyan-50 text-cyan-600 hover:bg-cyan-100 dark:bg-cyan-900/20 dark:border-cyan-800/40 dark:text-cyan-300 transition-colors',
  indigo: 'inline-flex items-center justify-center p-1.5 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 dark:bg-indigo-900/20 dark:border-indigo-800/40 dark:text-indigo-300 transition-colors',
  amber: 'inline-flex items-center justify-center p-1.5 rounded-lg border border-amber-200 bg-amber-50 text-amber-600 hover:bg-amber-100 dark:bg-amber-900/20 dark:border-amber-800/40 dark:text-amber-300 transition-colors',
  teal: 'inline-flex items-center justify-center p-1.5 rounded-lg border border-teal-200 bg-teal-50 text-teal-600 hover:bg-teal-100 dark:bg-teal-900/20 dark:border-teal-800/40 dark:text-teal-300 transition-colors',
  red: 'inline-flex items-center justify-center p-1.5 rounded-lg border border-red-200 bg-red-50 text-accent-red hover:bg-red-100 dark:bg-red-900/20 dark:border-red-800/40 dark:text-red-300 transition-colors',
  emerald: 'inline-flex items-center justify-center p-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 dark:bg-emerald-900/20 dark:border-emerald-800/40 dark:text-emerald-300 transition-colors',
  green: 'inline-flex items-center justify-center p-1.5 rounded-lg border border-green-200 bg-green-50 text-green-600 hover:bg-green-100 dark:bg-green-900/20 dark:border-green-800/40 dark:text-green-300 transition-colors',
};
const ACTION_ICON = 12;

// Devuelve los pagos por Pago Móvil de una factura junto con su índice en el
// array `payments` (necesario para guardar/atar la referencia con
// updatePaymentRef). Se usa para mostrar el botón de "Verificar en Banesco"
// directo en la lista, sin abrir el detalle. Incluye también los pagos móviles
// SIN referencia aún, para que el cajero pueda ingresarla y atarla al pedido.
function getPagoMovilPayments(inv: any): { payment: any; idx: number }[] {
  if (!Array.isArray(inv?.payments)) return [];
  return inv.payments
    .map((payment: any, idx: number) => ({ payment, idx }))
    .filter(({ payment }: any) => /m[oó]vil/i.test(String(payment.method || '')));
}

// ════════════════════════════════════════════════
// DROPDOWN CUSTOM PARA ESTADO DEL FLUJO
// ════════════════════════════════════════════════
// Reemplaza al <select> nativo porque los <option> no se pueden estilizar
// (los browsers usan colores del SO). En su lugar, cada opción se renderiza
// como un badge pintado del color del estado, lo que da contraste claro
// en cualquier modo (light/dark).
const FLOW_STATES: InvoiceStatus[] = ['Por Preparar', 'Preparado', 'Pendiente', 'Finalizado'];

function StatusFlowDropdown({
  status,
  onChange,
  disabled,
  size = 'sm',
}: {
  status: InvoiceStatus;
  onChange: (next: InvoiceStatus) => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
}) {
  const [open, setOpen] = useState(false);
  // Posición calculada del menú flotante (en coordenadas de viewport).
  // Se setea cada vez que se abre el dropdown a partir del rect del botón.
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; minWidth: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Cierra al click afuera (del botón Y del menú), ESC, y al scrollear
  // (porque las coordenadas del menú quedarían desactualizadas).
  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      const t = e.target as Node;
      if (btnRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    function onScroll() {
      setOpen(false);
    }
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKey);
    // capture: true para detectar scroll en CUALQUIER contenedor scrolleable,
    // no solo en window. Si la tabla tiene overflow-y:auto y se scrollea
    // adentro, también queremos cerrar.
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  function handleToggle() {
    if (disabled) return;
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      // Si no entra abajo, abrir hacia arriba. ~120px es alto estimado del
      // menú con las 3 opciones.
      const spaceBelow = window.innerHeight - rect.bottom;
      const menuHeight = 120;
      const top = spaceBelow < menuHeight
        ? rect.top - menuHeight - 4
        : rect.bottom + 4;
      setMenuPos({
        top,
        left: rect.left,
        minWidth: Math.max(rect.width, 150),
      });
    }
    setOpen(!open);
  }

  const st = STATUS_CONFIG[status] || { class: 'badge-gray', label: status };
  const padding = size === 'sm' ? 'text-[10px] px-2 py-0.5' : 'text-xs px-2.5 py-1';
  const iconSize = size === 'sm' ? 10 : 12;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={handleToggle}
        disabled={disabled}
        className={`badge ${padding} ${st.class} inline-flex items-center gap-1 cursor-pointer border-0 disabled:cursor-not-allowed disabled:opacity-60 hover:brightness-95 dark:hover:brightness-110 transition`}
        title="Cambiar estado"
      >
        <span>{st.label}</span>
        <ChevronDown size={iconSize} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
      </button>
      {open && menuPos && createPortal(
        <div
          ref={menuRef}
          // position:fixed + portal a document.body para escapar de
          // cualquier overflow:hidden del contenedor padre (tabla, modal,
          // etc.). El dropdown ya no se recorta.
          style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, minWidth: menuPos.minWidth }}
          className="z-[1000] py-1 bg-white dark:bg-dark-300 rounded-lg shadow-xl border border-surface-200 dark:border-dark-400"
        >
          {FLOW_STATES.map((s) => {
            const c = STATUS_CONFIG[s];
            const isCurrent = s === status;
            return (
              <button
                key={s}
                type="button"
                onClick={() => { onChange(s); setOpen(false); }}
                className={`w-full px-2.5 py-1.5 text-left flex items-center gap-2 hover:bg-surface-50 dark:hover:bg-dark-400/60 transition-colors ${isCurrent ? 'bg-surface-100 dark:bg-dark-400/40' : ''}`}
              >
                <span className={`badge text-[10px] px-2 py-0.5 ${c.class} pointer-events-none`}>{c.label}</span>
                {isCurrent && <Check size={12} className="ml-auto text-emerald-600 dark:text-emerald-400" />}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}

// ════════════════════════════════════════════════
// MULTI-SELECT con checkboxes para filtros
// ════════════════════════════════════════════════
function MultiSelect({
  options,
  value,
  onChange,
  placeholder = 'Todos',
}: {
  options: { value: string; label: string }[];
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  function toggle(v: string) {
    if (value.includes(v)) onChange(value.filter((x) => x !== v));
    else onChange([...value, v]);
  }

  const displayText =
    value.length === 0
      ? placeholder
      : value.length === 1
        ? (options.find((o) => o.value === value[0])?.label ?? value[0])
        : `${value.length} seleccionados`;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="input-field text-sm text-left flex items-center justify-between w-full gap-2"
      >
        <span className={value.length === 0 ? 'text-navy-400 truncate' : 'text-navy-900 dark:text-gray-100 truncate font-medium'}>
          {displayText}
        </span>
        <ChevronDown size={14} className={`text-navy-400 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute z-50 top-full left-0 mt-1 w-full min-w-[200px] bg-white dark:bg-dark-300 border border-surface-200 dark:border-dark-400 rounded-lg shadow-xl py-1 max-h-64 overflow-y-auto">
          {options.map((opt) => (
            <label
              key={opt.value}
              className="flex items-center gap-2.5 px-3 py-2 hover:bg-surface-50 dark:hover:bg-dark-400/60 cursor-pointer select-none"
            >
              <input
                type="checkbox"
                checked={value.includes(opt.value)}
                onChange={() => toggle(opt.value)}
                className="rounded text-blue-500 focus:ring-blue-500 flex-shrink-0"
              />
              <span className="text-sm text-navy-700 dark:text-gray-200">{opt.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

const RETURN_REASONS = ['Cambio de Producto', 'Producto Dañado (Merma)', 'Cambio de Talla/Color', 'Insatisfacción del Cliente', 'Error en la Venta', 'Otro'];

export function InvoicesPage() {
  const invoices = useAppStore((s) => s.invoices);
  const products = useAppStore((s) => s.products);
  const clients = useAppStore((s) => s.clients);
  const currentUser = useAppStore((s) => s.currentUser);
  const exchangeRate = useAppStore((s) => s.exchangeRate);
  const { can } = usePermissions();
  const { format, formatBoth } = useCurrency();
  const toast = useToast();

  const today = todayVE();

  // Draft filters
  const [dSearch, setDSearch] = useState('');
  const [dStart, setDStart] = useState(today);
  const [dEnd, setDEnd] = useState(today);
  const [dStatus, setDStatus] = useState<string[]>([]);
  const [dSeller, setDSeller] = useState<string[]>([]);
  const [dMethod, setDMethod] = useState<string[]>([]);
  const [dDelivery, setDDelivery] = useState<string[]>([]);

  // Applied filters
  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [sellerFilter, setSellerFilter] = useState<string[]>([]);
  const [methodFilter, setMethodFilter] = useState<string[]>([]);
  const [deliveryFilter, setDeliveryFilter] = useState<string[]>([]);

  // Paginación removida: ahora se muestran todas las facturas filtradas
  // en una sola lista con scroll. El array `filtered` ya está acotado por
  // los filtros activos (fechas, vendedor, estado, etc.) así que el
  // tamaño es manejable para uso típico de POS.
  const [detailInvoice, setDetailInvoice] = useState<any>(null);
  // Factura cuyo pago móvil se está verificando contra Banesco desde la lista
  const [verifyInvoice, setVerifyInvoice] = useState<any>(null);
  const [returnInvoice, setReturnInvoice] = useState<any>(null);
  const [returnReason, setReturnReason] = useState(RETURN_REASONS[0]);
  const [returnDetails, setReturnDetails] = useState('');
  const [exchangeInvoice, setExchangeInvoice] = useState<any>(null);
  const [exchangeLoading, setExchangeLoading] = useState(false);
  const [abonoInvoice, setAbonoInvoice] = useState<any>(null);
  const [abonoAmount, setAbonoAmount] = useState('');
  const [abonoMethod, setAbonoMethod] = useState<string>(PAYMENT_METHODS[0].name);
  const [abonoRef, setAbonoRef] = useState('');
  // Editar datos del cliente / observación de una factura ya emitida
  const [editInvoice, setEditInvoice] = useState<Invoice | null>(null);
  const [editName, setEditName] = useState('');
  const [editRif, setEditRif] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editObs, setEditObs] = useState('');
  const [loading, setLoading] = useState(false);
  const [serverInvoices, setServerInvoices] = useState<any[] | null>(null);
  const [isSearchingServer, setIsSearchingServer] = useState(false);
  const [quickSearch, setQuickSearch] = useState('');
  const [isQuickSearching, setIsQuickSearching] = useState(false);
  // Loading state del cambio de estado para evitar doble click / race conditions
  const [advancingId, setAdvancingId] = useState<string | null>(null);

  // Cambiar el estado de una factura desde el selector inline (tabla, vista
  // grid o modal de detalle). Único entry point — antes había handleAdvance
  // (un escalón por vez) y handleSetStatus (cualquiera), pero como ya no
  // existe el botón ▶ todo va por acá.
  async function handleSetStatus(inv: any, newStatus: InvoiceStatus) {
    if (inv.status === newStatus) return;
    setAdvancingId(inv.id);
    try {
      await updateInvoiceStatus(inv.id, newStatus);
      toast.success(`Factura FACT-${inv.numericId} → "${newStatus}".`);
      // Refresh local del modal con el nuevo estado si está abierto, para
      // feedback inmediato. Si no está abierto, no pasa nada.
      if (detailInvoice?.id === inv.id) {
        setDetailInvoice({ ...inv, status: newStatus });
      }
    } catch (e: any) {
      toast.error(e?.message || 'Error al cambiar el estado.');
    } finally {
      setAdvancingId(null);
    }
  }

  async function handleQuickSearch() {
    const raw = quickSearch.trim().replace(/[^0-9]/g, '');
    if (!raw) return toast.warning('Escribe un número de factura.');
    const num = parseInt(raw);
    if (isNaN(num) || num <= 0) return toast.warning('Número de factura inválido.');
    setIsQuickSearching(true);
    try {
      // First check locally
      const local = invoices.find((inv: any) => inv.numericId === num);
      if (local) {
        setDetailInvoice(local);
        setQuickSearch('');
        return;
      }
      // If not found locally, search in Firestore
      const result = await fetchInvoiceByNumericId(num);
      if (result) {
        setDetailInvoice(result);
        setQuickSearch('');
      } else {
        toast.warning(`No se encontró la factura #${num}`);
      }
    } catch (err) {
      console.error('Quick search error:', err);
      toast.error('Error al buscar factura.');
    } finally {
      setIsQuickSearching(false);
    }
  }

  async function applyFilters() {
    setSearch(dSearch);
    setStartDate(dStart);
    setEndDate(dEnd);
    setStatusFilter(dStatus);
    setSellerFilter(dSeller);
    setMethodFilter(dMethod);
    setDeliveryFilter(dDelivery);
    
    if (dStart || dEnd) {
      setIsSearchingServer(true);
      try {
        const results = await fetchInvoicesByDateRange(dStart || '1970-01-01', dEnd || '2100-01-01');
        setServerInvoices(results);
      } catch (err) {
        toast.error('Error al descargar facturas del servidor.');
        setServerInvoices(null);
      } finally {
        setIsSearchingServer(false);
      }
    } else {
      setServerInvoices(null);
    }
  }

  function clearFilters() {
    setDSearch(''); setDStart(today); setDEnd(today); setDStatus([]);
    setDSeller([]); setDMethod([]); setDDelivery([]);
    setSearch(''); setStartDate(today); setEndDate(today); setStatusFilter([]);
    setSellerFilter([]); setMethodFilter([]); setDeliveryFilter([]);
    setServerInvoices(null);
  }
  const hasActive = search || startDate !== today || endDate !== today
    || statusFilter.length > 0 || sellerFilter.length > 0
    || methodFilter.length > 0 || deliveryFilter.length > 0;

  // Lista de vendedores únicos derivada de las facturas en memoria/servidor
  const availableSellers = useMemo(() => {
    const set = new Set<string>();
    (serverInvoices || invoices).forEach((inv: any) => {
      if (inv.sellerName) set.add(inv.sellerName);
    });
    return Array.from(set).sort();
  }, [invoices, serverInvoices]);

  const filtered = useMemo(() => {
    // Merge inteligente: store (realtime via onSnapshot) + serverInvoices
    // (one-shot fetch). El store siempre tiene los últimos 500 invoices
    // actualizados en tiempo real. serverInvoices puede traer un rango
    // histórico más amplio. Priorizamos el store para IDs duplicados —
    // así una venta nueva, anulación o devolución se refleja al instante
    // sin necesidad de F5 / Aplicar.
    let result: any[];
    if (serverInvoices) {
      const storeIds = new Set(invoices.map((i: any) => i.id));
      result = [
        ...invoices,
        ...serverInvoices.filter((s: any) => !storeIds.has(s.id)),
      ];
    } else {
      result = [...invoices];
    }

    // Aplicamos SIEMPRE el filtro de fecha (antes solo se aplicaba cuando
    // no había serverInvoices). Ahora, como el merge incluye invoices del
    // store que pueden estar fuera del rango filtrado, hay que filtrarlas
    // aquí para no contaminar la vista.
    if (startDate && endDate) {
      const s = new Date(startDate + 'T00:00:00'), e = new Date(endDate + 'T23:59:59');
      result = result.filter((inv: any) => { const d = toDate(inv.date); return d && d >= s && d <= e; });
    }
    
    if (statusFilter.length > 0) {
      result = result.filter((inv: any) => statusFilter.includes(inv.status));
    } else {
      result = result.filter((inv: any) => inv.status !== 'Cancelado' && inv.status !== 'Devolución');
    }

    if (sellerFilter.length > 0) {
      result = result.filter((inv: any) => sellerFilter.includes(inv.sellerName));
    }
    if (methodFilter.length > 0) {
      result = result.filter((inv: any) =>
        Array.isArray(inv.payments) && inv.payments.some((p: any) => methodFilter.includes(p.method))
      );
    }
    if (deliveryFilter.length > 0) {
      result = result.filter((inv: any) => deliveryFilter.includes(inv.deliveryType));
    }
    
    if (search) {
      const s = search.toLowerCase();
      result = result.filter((inv: any) => {
        const name = inv.clientSnapshot?.name || '';
        const id = `fact-${String(inv.numericId).padStart(4, '0')}`;
        return name.toLowerCase().includes(s) || id.includes(s) || (inv.clientSnapshot?.rif_ci || '').toLowerCase().includes(s);
      });
    }
    return result;
  }, [invoices, serverInvoices, startDate, endDate, statusFilter, sellerFilter, methodFilter, deliveryFilter, search]);

  const totals = useMemo(() => {
    let totalAll = 0, delivery = 0;
    filtered.forEach((inv: any) => {
      if (isCountableSale(inv.status)) {
        totalAll += Number(inv.total) || 0;
        delivery += Number(inv.deliveryCostUsd) || 0;
      }
    });
    return { sales: totalAll - delivery, delivery, general: totalAll };
  }, [filtered]);

  async function refetchIfServer() {
    if (serverInvoices && startDate && endDate) {
      try {
        const results = await fetchInvoicesByDateRange(startDate, endDate);
        setServerInvoices(results);
      } catch (err) {}
    }
  }

  async function handleExchange(data: ExchangeConfirmData) {
    if (!exchangeInvoice || !currentUser) return;
    setExchangeLoading(true);
    try {
      await processExchange({
        invoiceId: exchangeInvoice.id,
        invoice: exchangeInvoice,
        ...data,
        currentUser,
        products,
      });
      setExchangeInvoice(null);
      toast.success('Cambio procesado correctamente.');
      await refetchIfServer();
    } catch (err: any) {
      toast.error(`Error al procesar cambio: ${err?.message || err}`);
    } finally {
      setExchangeLoading(false);
    }
  }

  async function handleReturn() {
    if (!returnInvoice || !currentUser) return; setLoading(true);
    try { 
      await processReturn({ invoiceId: returnInvoice.id, invoice: returnInvoice, reason: returnReason, details: returnDetails, currentUser, products }); 
      setReturnInvoice(null); 
      toast.success('Devolución procesada.'); 
      await refetchIfServer();
    }
    catch (err: any) { console.error('processReturn error:', err); toast.error(`Error al procesar devolución: ${err?.message || err}`); } finally { setLoading(false); }
  }
  async function handleCancel(invoice: any) {
    if (!confirm('¿Cancelar factura? Stock será restaurado.')) return; setLoading(true);
    try { 
      await cancelInvoice({ invoice, products }); 
      setDetailInvoice(null); 
      toast.success('Factura cancelada.'); 
      await refetchIfServer();
    } catch { toast.error('Error al cancelar.'); } finally { setLoading(false); }
  }
  async function handleApproveWeb(invoice: any) { setLoading(true); try { await approveWebOrder(invoice.id); toast.success('Pedido web aprobado.'); await refetchIfServer(); } catch { toast.error('Error.'); } finally { setLoading(false); } }

  // Abre el modal de edición y precarga los valores actuales del snapshot
  function openEditModal(invoice: Invoice) {
    setEditInvoice(invoice);
    setEditName(invoice.clientSnapshot?.name || '');
    setEditRif(invoice.clientSnapshot?.rif_ci || '');
    setEditAddress(invoice.clientSnapshot?.address || '');
    setEditPhone(invoice.clientSnapshot?.phone || '');
    setEditObs(invoice.observation || '');
  }

  async function handleSaveEdit() {
    if (!editInvoice) return;
    if (!editName.trim()) { toast.warning('El nombre del cliente no puede estar vacío.'); return; }
    setLoading(true);
    try {
      await updateInvoiceCustomerData(editInvoice.id, {
        clientSnapshot: {
          ...(editInvoice.clientSnapshot || {}),
          name: editName.trim(),
          rif_ci: editRif.trim(),
          address: editAddress.trim(),
          phone: editPhone.trim(),
        },
        observation: editObs.trim() || null,
      });
      toast.success('Datos actualizados.');
      setEditInvoice(null);
      await refetchIfServer();
    } catch (e) {
      console.error(e);
      toast.error('Error al actualizar.');
    } finally {
      setLoading(false);
    }
  }
  
  async function handleMarkAsPaid(invoice: any) {
    if (!confirm('¿Marcar pago de delivery como completado y finalizar?')) return;
    setLoading(true); 
    try { 
      await confirmDeliveryPayment(invoice.id, invoice.status); 
      toast.success('Pago confirmado.'); 
      await refetchIfServer(); 
    } catch { toast.error('Error al confirmar pago.'); } finally { setLoading(false); } 
  }

  async function handleAbono() {
    if (!abonoInvoice) return; const amt = parseFloat(abonoAmount);
    if (isNaN(amt) || amt <= 0) return toast.warning('Monto inválido.'); setLoading(true);
    try { 
      await addAbono({ invoiceId: abonoInvoice.id, invoice: abonoInvoice, amount: amt, methodName: abonoMethod, ref: abonoRef || undefined, exchangeRate }); 
      setAbonoInvoice(null); 
      toast.success('Abono registrado.'); 
      await refetchIfServer();
    }
    catch { toast.error('Error al registrar abono.'); } finally { setLoading(false); }
  }
  function label(inv: any) { return `FACT-${String(inv.numericId).padStart(4, '0')}`; }

  return (
    <div className="space-y-6 animate-fade-up">
      {/* Header */}
      <div className="card p-5">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-1 h-12 bg-purple-500 rounded-full" />
            <div><h1 className="text-xl font-display font-bold text-navy-900">Historial de Facturas</h1>
              <p className="text-navy-400 text-sm">{filtered.length} facturas</p></div>
          </div>
          <div className="flex gap-2 items-center w-full sm:w-auto">
            {/* Quick search by numericId */}
            <div className="relative flex-1 sm:flex-initial sm:w-52">
              <Hash size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-navy-300" />
              <input
                value={quickSearch}
                onChange={(e) => setQuickSearch(e.target.value.replace(/[^0-9]/g, ''))}
                onKeyDown={(e) => e.key === 'Enter' && handleQuickSearch()}
                className="input-field pl-8 pr-16 text-sm font-mono"
                placeholder="Nº factura..."
                inputMode="numeric"
              />
              <button
                onClick={handleQuickSearch}
                disabled={isQuickSearching}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 px-2 py-1 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-400 text-white text-[10px] font-display font-semibold rounded transition-colors"
              >
                {isQuickSearching ? '...' : 'Buscar'}
              </button>
            </div>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-surface-200">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div><label className="block text-[10px] font-display font-semibold text-navy-400 uppercase mb-1">Buscar</label>
                <input value={dSearch} onChange={(e) => setDSearch(e.target.value)} className="input-field text-sm" placeholder="Cliente, factura..." /></div>
              <div><label className="block text-[10px] font-display font-semibold text-navy-400 uppercase mb-1">Desde</label>
                <input type="date" value={dStart} onChange={(e) => setDStart(e.target.value)} className="input-field text-sm" /></div>
              <div><label className="block text-[10px] font-display font-semibold text-navy-400 uppercase mb-1">Hasta</label>
                <input type="date" value={dEnd} onChange={(e) => setDEnd(e.target.value)} className="input-field text-sm" /></div>
              <div><label className="block text-[10px] font-display font-semibold text-navy-400 uppercase mb-1">Estado</label>
                <MultiSelect
                  value={dStatus}
                  onChange={setDStatus}
                  placeholder="Activas (todas)"
                  options={[
                    { value: 'Por Preparar', label: 'Por Preparar' },
                    { value: 'Preparado', label: 'Preparado' },
                    { value: 'Pendiente', label: 'Pendiente' },
                    { value: 'Finalizado', label: 'Finalizado' },
                    { value: 'Pendiente de pago', label: 'Crédito' },
                    { value: 'Devolución', label: 'Devolución' },
                    { value: 'Cancelado', label: 'Cancelado' },
                    { value: 'Creada', label: 'Web' },
                  ]}
                /></div>
              <div><label className="block text-[10px] font-display font-semibold text-navy-400 uppercase mb-1">Vendedor</label>
                <MultiSelect
                  value={dSeller}
                  onChange={setDSeller}
                  placeholder="Todos"
                  options={availableSellers.map((s) => ({ value: s, label: s }))}
                /></div>
              <div><label className="block text-[10px] font-display font-semibold text-navy-400 uppercase mb-1">Método de Pago</label>
                <MultiSelect
                  value={dMethod}
                  onChange={setDMethod}
                  placeholder="Todos"
                  options={PAYMENT_METHODS.filter((m) => m.currency !== 'none').map((m) => ({ value: m.name, label: m.name }))}
                /></div>
              <div><label className="block text-[10px] font-display font-semibold text-navy-400 uppercase mb-1">Entrega</label>
                <MultiSelect
                  value={dDelivery}
                  onChange={setDDelivery}
                  placeholder="Todas"
                  options={DELIVERY_TYPES.map((dt) => ({ value: dt.value, label: dt.label }))}
                /></div>
              <div className="flex items-end gap-2">
                <button onClick={applyFilters} disabled={isSearchingServer} className="btn-primary text-sm flex-1">
                  {isSearchingServer ? 'Buscando...' : <><Check size={14} /> Aplicar</>}
                </button>
                {hasActive && <button onClick={clearFilters} className="btn-ghost p-2.5 text-navy-400 hover:text-accent-red"><XIcon size={14} /></button>}
              </div>
            </div>
          </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        {[{ l: 'Ventas', v: totals.sales, c: 'text-navy-900' }, { l: 'Delivery', v: totals.delivery, c: 'text-blue-600' }, { l: 'Total', v: totals.general, c: 'text-emerald-600' }].map((i) => (
          <div key={i.l} className="card p-4 text-center hover-lift"><p className="text-[10px] font-display font-semibold text-navy-400 uppercase">{i.l}</p>
            <p className={`text-2xl font-display font-bold tabular-nums tracking-tight mt-1 ${i.c}`}>{format(i.v)}</p></div>
        ))}
      </div>

      {/* Table */}
      <div className="card overflow-hidden md:-mx-6 lg:-mx-12 xl:-mx-20 2xl:-mx-32">
        {filtered.length === 0 ? (
          <div className="p-12 text-center"><FileText size={40} className="mx-auto text-navy-200 mb-3" /><p className="text-navy-400 text-sm">Sin facturas.</p></div>
        ) : (
          <div>
            {/* ═══ MOBILE: Card layout ═══ */}
            <div className="md:hidden divide-y divide-surface-100">
              {filtered.map((inv: any) => {
                const date = toDate(inv.date);
                const st = STATUS_CONFIG[inv.status as InvoiceStatus] || { class: 'badge-gray', label: inv.status || 'N/A' };
                const paymentImgUrl = inv.proofUrl || inv.img || inv.paymentImg || (inv.payments?.find?.((p: any) => p.proofUrl || p.img)?.proofUrl || inv.payments?.find?.((p: any) => p.proofUrl || p.img)?.img) || null;
                return (
                  <div key={inv.id} className="p-4 hover:bg-surface-50 transition-colors">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <span className="font-mono font-bold text-sm text-navy-900">{label(inv)}</span>
                        {(FLOW_STATES.includes(inv.status as InvoiceStatus) && can('canEditInvoices')) ? (
                          <span className="ml-2 inline-block">
                            <StatusFlowDropdown
                              status={inv.status as InvoiceStatus}
                              onChange={(s) => handleSetStatus(inv, s)}
                              disabled={advancingId === inv.id}
                              size="sm"
                            />
                          </span>
                        ) : (
                          <span className={`badge text-[9px] px-1.5 py-0.5 ml-2 ${st.class}`}>{st.label}</span>
                        )}
                      </div>
                      <span className="font-mono font-bold text-sm text-navy-900">{format(inv.total || 0)}</span>
                    </div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-xs text-navy-500 truncate max-w-[60%]">
                        {inv.clientSnapshot?.name || 'General'}
                      </div>
                      <span className="font-mono text-xs text-navy-400">{formatBoth(inv.total || 0).ves}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="text-[10px] text-navy-400">
                        {date?.toLocaleDateString('es-VE', { day: '2-digit', month: 'short' })}{' '}
                        {date?.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })}
                        <span className="mx-1">·</span>
                        {inv.sellerName?.split(' ')[0] || 'N/A'}
                        <span className="mx-1">·</span>
                        {inv.payments?.map((p: any) => p.method).join(', ') || 'N/A'}
                      </div>
                      <div className="flex gap-1.5 flex-wrap justify-end">
                        <button onClick={() => setDetailInvoice(inv)} className={ACTION_BTN.blue} title="Ver detalle"><Eye size={ACTION_ICON} /></button>
                        {paymentImgUrl && (
                          <a href={paymentImgUrl} target="_blank" rel="noopener noreferrer" className={ACTION_BTN.purple} title="Ver comprobante"><ImageIcon size={ACTION_ICON} /></a>
                        )}
                        <button onClick={() => printReceipt({ invoice: inv, products, clients, currentExchangeRate: exchangeRate })} className={ACTION_BTN.slate} title="Imprimir recibo"><Printer size={ACTION_ICON} /></button>
                        {getPagoMovilPayments(inv).length > 0 && (
                          <button onClick={() => setVerifyInvoice(inv)} className={ACTION_BTN.cyan} title="Verificar pago móvil en Banesco"><ShieldCheck size={ACTION_ICON} /></button>
                        )}
                        {(isCountableSale(inv.status)) && can('canEditInvoices') && (
                          <button onClick={() => openEditModal(inv)} className={ACTION_BTN.indigo} title="Editar datos"><Edit2 size={ACTION_ICON} /></button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* ═══ DESKTOP: Table layout ═══ */}
            <div className="hidden md:block">
            <table className="w-full table-fixed">
              <thead><tr className="border-b border-surface-200 bg-surface-50">
                {[
                  { h: 'Factura', w: 'w-[6%]' }, { h: 'Vendedor', w: 'w-[11%]' }, { h: 'Cliente', w: 'w-[8%]' },
                  { h: 'Dirección', w: 'w-[8%]' }, { h: 'Obs.', w: 'w-[5%]' },
                  { h: 'Entrega', w: 'w-[6%]' }, { h: 'Envío', w: 'w-[5%]' },
                  { h: 'Pago', w: 'w-[6%]' }, { h: 'REF', w: 'w-[5%]' },
                  { h: 'Total $', w: 'w-[6%]' }, { h: 'Total Bs', w: 'w-[8%]' },
                  { h: 'Fecha', w: 'w-[8%]' }, { h: 'Estado', w: 'w-[7%]' }, { h: 'Acciones', w: 'w-[11%]' },
                ].map((c) => (
                  <th key={c.h || 'actions'} className={`text-left text-[11px] font-display font-semibold text-navy-400 uppercase tracking-wide px-3 py-3 ${c.w}`}>{c.h}</th>
                ))}</tr></thead>
              <tbody className="divide-y divide-surface-100">
                {filtered.map((inv: any) => {
                  const date = toDate(inv.date);
                  const st = STATUS_CONFIG[inv.status as InvoiceStatus] || { class: 'badge-gray', label: inv.status || 'N/A' };
                  const dt = (DELIVERY_TYPES as any).find((t: any) => t.value === inv.deliveryType || (inv.deliveryType === 'local' && t.value === 'local'));
                  const paymentImgUrl = inv.proofUrl || inv.img || inv.paymentImg || (inv.payments?.find?.((p: any) => p.proofUrl || p.img)?.proofUrl || inv.payments?.find?.((p: any) => p.proofUrl || p.img)?.img) || null;
                  
                  return (
                    <tr key={inv.id} className="hover:bg-surface-50 transition-colors">
                      <td className="px-3 py-3 font-mono font-semibold text-[12px] text-navy-900 break-all leading-tight">{label(inv)}</td>
                      <SellerCell invoice={inv} onUpdated={refetchIfServer} />
                      <td className="px-3 py-3 text-[12px] text-navy-600 break-words leading-tight" title={inv.clientSnapshot?.name}>{inv.clientSnapshot?.name || 'General'}</td>
                      <td className="px-3 py-3 text-[12px] text-navy-400 break-words leading-tight" title={inv.clientSnapshot?.address}>{inv.clientSnapshot?.address || 'N/A'}</td>
                      <td className="px-3 py-3 text-[12px] text-navy-400 break-words leading-tight" title={inv.observation || inv.notes}>{inv.observation || inv.notes || 'N/A'}</td>
                      <td className="px-3 py-3 text-[12px] text-navy-400 break-words leading-tight">{dt?.label || inv.deliveryType || 'N/A'}</td>
                      <td className="px-3 py-3 font-mono text-[12px] text-navy-900">{format(inv.deliveryCostUsd || 0)}</td>
                      <td className="px-3 py-3 text-[12px] text-navy-400 break-words leading-tight" title={inv.payments?.map((p: any) => p.method).join(', ')}>{inv.payments?.map((p: any) => p.method).join(', ') || 'N/A'}</td>
                      <RefCell invoice={inv} onUpdated={refetchIfServer} />
                      <td className="px-3 py-3 font-mono font-bold text-[12px] text-navy-900">{format(inv.total || 0)}</td>
                      <td className="px-3 py-3 font-mono text-[12px] text-navy-500 break-all leading-tight">{formatBoth(inv.total || 0).ves}</td>
                      <td className="px-3 py-3 text-[11px] text-navy-500 leading-tight">{date?.toLocaleString('es-VE')}</td>
                      <td className="px-3 py-3">
                        {/* Si la factura está en el flujo de preparación, mostrar
                            dropdown custom; sino, badge plano. */}
                        {(FLOW_STATES.includes(inv.status as InvoiceStatus) && can('canEditInvoices')) ? (
                          <StatusFlowDropdown
                            status={inv.status as InvoiceStatus}
                            onChange={(s) => handleSetStatus(inv, s)}
                            disabled={advancingId === inv.id}
                            size="sm"
                          />
                        ) : (
                          <span className={`badge text-[10px] px-2 py-0.5 ${st.class}`}>{st.label}</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex gap-1.5 flex-wrap">
                          <button onClick={() => setDetailInvoice(inv)} className={ACTION_BTN.blue} title="Ver detalle"><Eye size={ACTION_ICON} /></button>
                          {paymentImgUrl && (
                            <a href={paymentImgUrl} target="_blank" rel="noopener noreferrer" className={ACTION_BTN.purple} title="Ver comprobante de pago">
                              <ImageIcon size={ACTION_ICON} />
                            </a>
                          )}
                          <button onClick={() => printReceipt({ invoice: inv, products, clients, currentExchangeRate: exchangeRate })} className={ACTION_BTN.slate} title="Imprimir recibo"><Printer size={ACTION_ICON} /></button>
                          {getPagoMovilPayments(inv).length > 0 && (
                            <button onClick={() => setVerifyInvoice(inv)} className={ACTION_BTN.cyan} title="Verificar pago móvil en Banesco"><ShieldCheck size={ACTION_ICON} /></button>
                          )}
                          {(isCountableSale(inv.status)) && can('canEditInvoices') && (
                            <button onClick={() => openEditModal(inv)} className={ACTION_BTN.indigo} title="Editar datos del cliente / observación"><Edit2 size={ACTION_ICON} /></button>
                          )}
                          {(inv.status === 'Finalizado' || inv.status === 'Cambio') && can('canProcessReturns') && <button onClick={() => setReturnInvoice(inv)} className={ACTION_BTN.amber} title="Devolución"><RotateCcw size={ACTION_ICON} /></button>}
                          {inv.status === 'Finalizado' && can('canProcessReturns') && <button onClick={() => setExchangeInvoice(inv)} className={ACTION_BTN.teal} title="Cambio de prenda"><ArrowLeftRight size={ACTION_ICON} /></button>}
                          {/* Cancelar disponible en cualquiera de los tres estados del flujo */}
                          {(inv.status === 'Por Preparar' || inv.status === 'Preparado' || inv.status === 'Finalizado' || inv.status === 'Cambio') && can('canEditInvoices') && <button onClick={() => handleCancel(inv)} className={ACTION_BTN.red} title="Cancelar venta"><XCircle size={ACTION_ICON} /></button>}
                          {inv.status === 'Creada' && <button onClick={() => handleApproveWeb(inv)} className={ACTION_BTN.emerald} title="Aprobar pedido web"><CheckCircle size={ACTION_ICON} /></button>}
                          {inv.status === 'Pendiente de pago' && <button onClick={() => handleMarkAsPaid(inv)} className={ACTION_BTN.emerald} title="Finalizar Pago"><CheckCircle size={ACTION_ICON} /></button>}
                          {inv.status === 'Pendiente de pago' && can('canAddAbono') && <button onClick={() => { setAbonoInvoice(inv); setAbonoAmount(''); setAbonoRef(''); }} className={ACTION_BTN.green} title="Registrar abono"><DollarSign size={ACTION_ICON} /></button>}
                        </div>
                      </td>
                    </tr>);
                })}
              </tbody>
            </table>
            </div>
          </div>
        )}

        {/* Contador simple al pie — reemplaza la paginación. Útil para
            ver cuántas facturas matchean los filtros actuales. */}
        {filtered.length > 0 && (
          <div className="px-4 py-2 bg-surface-50 dark:bg-dark-200/40 border-t border-surface-200 dark:border-dark-300">
            <p className="text-xs text-navy-400 dark:text-gray-500 font-display text-center">
              Mostrando <span className="font-semibold text-navy-700 dark:text-gray-300">{filtered.length}</span> {filtered.length === 1 ? 'factura' : 'facturas'}
            </p>
          </div>
        )}
      </div>

      {/* DETAIL MODAL */}
      {detailInvoice && (
        <Modal open={true} onClose={() => setDetailInvoice(null)} title={label(detailInvoice)} size="lg">
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[{ l: 'Cliente', v: detailInvoice.clientSnapshot?.name || 'General' }, { l: 'Fecha', v: toDate(detailInvoice.date)?.toLocaleDateString('es-VE') }, { l: 'Vendedor', v: detailInvoice.sellerName }].map((i) => (
                <div key={i.l} className="bg-surface-50 rounded-lg p-3 hover-lift"><p className="text-[10px] font-display font-semibold text-navy-400 uppercase">{i.l}</p>
                  <p className="text-sm font-display font-medium text-navy-900 mt-0.5">{i.v}</p></div>
              ))}
              {/* Estado: dropdown custom si está en el flujo de preparación,
                  texto plano si está en un estado de excepción (Crédito,
                  Devolución, Cancelado, etc) que sigue otro flujo. */}
              <div className="bg-surface-50 rounded-lg p-3 hover-lift">
                <p className="text-[10px] font-display font-semibold text-navy-400 uppercase">Estado</p>
                {(FLOW_STATES.includes(detailInvoice.status as InvoiceStatus) && can('canEditInvoices')) ? (
                  <div className="mt-1">
                    <StatusFlowDropdown
                      status={detailInvoice.status as InvoiceStatus}
                      onChange={(s) => handleSetStatus(detailInvoice, s)}
                      disabled={advancingId === detailInvoice.id}
                      size="md"
                    />
                  </div>
                ) : (
                  <p className="text-sm font-display font-medium text-navy-900 mt-0.5">{detailInvoice.status}</p>
                )}
              </div>
            </div>
            {(detailInvoice.observation || detailInvoice.notes) && (
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg px-3 py-2.5">
                <p className="text-[10px] font-display font-semibold text-amber-600 dark:text-amber-400 uppercase mb-1">Observación</p>
                <p className="text-sm text-navy-800 dark:text-gray-200 leading-snug">{detailInvoice.observation || detailInvoice.notes}</p>
              </div>
            )}
            <div><p className="text-[10px] font-display font-semibold text-navy-400 uppercase mb-2">Productos</p>
              <div className="space-y-1.5">{detailInvoice.items?.map((item: any, i: number) => {
                const p = products.find((pr: Product) => pr.id === item.productId); const v = p?.variants?.[item.variantIndex];
                const price = item.priceAtSale ?? v?.price ?? 0;
                const itemName = p?.name || item.productName || 'Eliminado';
                const itemLabel = item.variantLabel || (v ? `${sizeLabel(v.size)}, ${v.color}` : '');
                const imgSrc = p?.imageUrl || p?.imageUrls?.[0];
                return (<div key={i} className="flex justify-between items-center text-sm p-2 bg-surface-50 rounded-lg hover-lift gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {imgSrc ? (
                      <img src={imgSrc} alt={itemName} className="w-10 h-10 rounded-md object-cover flex-shrink-0 border border-surface-200" />
                    ) : (
                      <div className="w-10 h-10 rounded-md bg-surface-200 flex items-center justify-center flex-shrink-0">
                        <ImageIcon size={16} className="text-navy-300" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <span className="font-display font-medium text-navy-900 block truncate">{itemName}</span>
                      {itemLabel && <span className="text-navy-400 text-xs">({itemLabel})</span>}
                    </div>
                  </div>
                  <div className="text-right font-mono flex-shrink-0"><span className="text-navy-500">{item.quantity}x</span>
                    <span className="ml-2 font-semibold text-navy-900">{format(price * item.quantity)}</span></div>
                </div>);
              })}</div>
            </div>
            {(detailInvoice.payments?.length > 0 || detailInvoice.proofUrl || detailInvoice.img || detailInvoice.paymentImg) && (
              <div><p className="text-[10px] font-display font-semibold text-navy-400 uppercase mb-2">Comprobantes</p>
                <div className="flex flex-col gap-3">

                  {/* Renderizar las imágenes de los comprobantes */}
                  {((detailInvoice.payments?.some((p: any) => p.proofUrl || p.img)) || (detailInvoice.proofUrl || detailInvoice.img || detailInvoice.paymentImg)) && (
                    <div className="flex flex-wrap gap-3 mt-1">
                      {detailInvoice.payments?.filter((p: any) => p.proofUrl || p.img).map((p: any, i: number) => (
                        <a key={i} href={p.proofUrl || p.img} target="_blank" rel="noopener noreferrer" className="block border border-surface-200 rounded-lg overflow-hidden hover:border-purple-400 transition-colors bg-surface-100 flex-shrink-0 relative group shadow-sm" style={{ width: '160px', height: '220px' }} title="Clic para ampliar comprobante">
                          <img src={p.proofUrl || p.img} alt={`Comprobante ${p.method}`} className="w-full h-full object-cover opacity-95 group-hover:opacity-100 transition-opacity" />
                          <div className="absolute inset-x-0 bottom-0 bg-black/60 text-white text-[10px] font-medium text-center py-1.5 opacity-0 group-hover:opacity-100 transition-opacity font-display">Ver completo</div>
                        </a>
                      ))}
                      
                      {/* Mostrar comprobante global si no estaba dentro del array de pagos */}
                      {(!detailInvoice.payments?.some((p: any) => p.proofUrl || p.img)) && (detailInvoice.proofUrl || detailInvoice.img || detailInvoice.paymentImg) && (
                        <a href={detailInvoice.proofUrl || detailInvoice.img || detailInvoice.paymentImg} target="_blank" rel="noopener noreferrer" className="block border border-surface-200 rounded-lg overflow-hidden hover:border-purple-400 transition-colors bg-surface-100 flex-shrink-0 relative group shadow-sm" style={{ width: '160px', height: '220px' }} title="Clic para ampliar comprobante">
                          <img src={detailInvoice.proofUrl || detailInvoice.img || detailInvoice.paymentImg} alt="Comprobante" className="w-full h-full object-cover opacity-95 group-hover:opacity-100 transition-opacity" />
                          <div className="absolute inset-x-0 bottom-0 bg-black/60 text-white text-[10px] font-medium text-center py-1.5 opacity-0 group-hover:opacity-100 transition-opacity font-display">Ver completo</div>
                        </a>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
            
            <div className="bg-surface-50 rounded-lg p-4 space-y-2 text-sm">
              {(() => {
                let itemDiscountsTotal = 0;
                
                const subT = detailInvoice.items?.reduce((sum: number, item: any) => {
                  const p = products.find((pr: Product) => pr.id === item.productId);
                  const v = p?.variants?.[item.variantIndex];
                  const price = item.priceAtSale ?? v?.price ?? 0;
                  
                  const lineTotal = price * item.quantity;
                  itemDiscountsTotal += calcDiscountAmount(lineTotal, item.discount);
                  return sum + lineTotal;
                }, 0) || 0;

                const subTAfterItems = subT - itemDiscountsTotal;
                const genDiscount = calcDiscountAmount(subTAfterItems, detailInvoice.totalDiscount);

                return (
                  <>
                    <div className="flex justify-between text-navy-600">
                      <span>Subtotal (Sin descuentos)</span>
                      <span className="font-mono">{format(subT)}</span>
                    </div>
                    {itemDiscountsTotal > 0 && (
                      <div className="flex justify-between text-pink-600">
                        <span>Ahorro Ofertas (Por Producto)</span>
                        <span className="font-mono">-{format(itemDiscountsTotal)}</span>
                      </div>
                    )}
                    {genDiscount > 0 && (
                      <div className="flex justify-between text-accent-red">
                        <span>Descuento General</span>
                        <span className="font-mono">-{format(genDiscount)}</span>
                      </div>
                    )}
                    {(detailInvoice.deliveryCostUsd || 0) > 0 && (
                      <div className="flex justify-between text-navy-600">
                        <span>Delivery</span>
                        <span className="font-mono">+{format(detailInvoice.deliveryCostUsd)}</span>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>

            <div className="bg-navy-900 text-white rounded-lg p-4"><div className="flex justify-between"><span className="font-display">Total Pagado</span>
              <div className="text-right"><p className="font-mono font-bold text-lg">{formatBoth(detailInvoice.total || 0).usd}</p>
                <p className="font-mono text-sm text-white/60">{formatBoth(detailInvoice.total || 0).ves}</p></div></div></div>

            {/* Desglose de métodos de pago. Cuando la factura tiene un
                solo método, esta sección es redundante con el badge de la
                tabla, pero cuando hay múltiples (ej: Pago Móvil + Efectivo)
                acá se ven todos con su monto y referencia individual. */}
            {Array.isArray(detailInvoice.payments) && detailInvoice.payments.length > 0 && (() => {
              const rate = detailInvoice.exchangeRate || exchangeRate || 1;
              return (
                <div className="bg-surface-50 dark:bg-dark-200/40 border border-surface-200 dark:border-dark-300 rounded-lg p-3">
                  <p className="text-[10px] font-display font-semibold text-navy-400 dark:text-gray-500 uppercase tracking-wider mb-2">
                    {detailInvoice.payments.length === 1 ? 'Método de pago' : `Métodos de pago (${detailInvoice.payments.length})`}
                  </p>
                  <div className="divide-y divide-surface-200 dark:divide-dark-300/40">
                    {detailInvoice.payments.map((p: any, i: number) => {
                      // Monto efectivo en USD del pago: el amountUsd si vino
                      // expresado en USD, o el amountVes convertido a USD si
                      // vino en bolívares.
                      const usdEquiv = (Number(p.amountUsd) || 0) + (Number(p.amountVes) || 0) / rate;
                      const hasVes = Number(p.amountVes) > 0;
                      // Pago móvil con referencia → permitir verificar contra Banesco.
                      const isPagoMovil = /m[oó]vil/i.test(String(p.method || ''));
                      return (
                        <div key={i} className="py-1.5 first:pt-0 last:pb-0">
                          <div className="flex justify-between items-start">
                            <div className="flex items-center gap-2 flex-wrap min-w-0 flex-1">
                              <span className="text-sm font-display font-medium text-navy-800 dark:text-gray-200">
                                {p.method || 'N/A'}
                              </span>
                              {p.ref && (
                                <span className="font-mono text-[10px] text-navy-500 dark:text-gray-400 bg-surface-100 dark:bg-dark-300/60 px-1.5 py-0.5 rounded">
                                  Ref: {p.ref}
                                </span>
                              )}
                            </div>
                            <div className="text-right shrink-0">
                              <p className="font-mono font-semibold text-sm text-navy-800 dark:text-gray-200">
                                {format(usdEquiv)}
                              </p>
                              {hasVes && (
                                <p className="font-mono text-[10px] text-navy-400 dark:text-gray-500">
                                  Bs. {Number(p.amountVes).toLocaleString('es-VE', { minimumFractionDigits: 2 })}
                                </p>
                              )}
                            </div>
                          </div>
                          {isPagoMovil && p.ref && (
                            <VerifyPagoMovilButton
                              referenceNumber={String(p.ref)}
                              date={toDate(detailInvoice.date) || new Date()}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* Vuelto (cambio en efectivo) — SIEMPRE visible.
                Para facturas nuevas: lee changeGiven (USD) directo.
                Para facturas viejas sin el campo: lo calcula al vuelo
                sumando pagos en efectivo y restando el total. */}
            {(() => {
              // Calcular SIEMPRE el efectivo recibido (suma de pagos
              // método "efectivo") para mostrarlo en una línea aparte.
              // Útil para que el cajero/admin vea cuánto recibió en
              // mano y cuánto le entregó de vuelto, sin tener que
              // anotarlo en observaciones.
              const rate = detailInvoice.exchangeRate || exchangeRate || 1;
              const cashPayments = (detailInvoice.payments || []).filter((p: any) => {
                return String(p.method || '').toLowerCase().includes('efectivo');
              });
              let cashReceivedUsd = 0;
              cashPayments.forEach((p: any) => {
                cashReceivedUsd += (Number(p.amountUsd) || 0);
                cashReceivedUsd += (Number(p.amountVes) || 0) / rate;
              });
              // Para vuelto: seguir la misma lógica que antes.
              const stored = (detailInvoice as any).changeGiven;
              const storedIsReasonable = typeof stored === 'number' && stored > 0 && stored < 10000;
              let changeUsd = 0;
              if (storedIsReasonable) {
                changeUsd = stored;
              } else {
                // Fallback: calcular al vuelo
                let nonCashUsd = 0;
                (detailInvoice.payments || []).filter((p: any) => !String(p.method || '').toLowerCase().includes('efectivo')).forEach((p: any) => {
                  nonCashUsd += (Number(p.amountUsd) || 0);
                  nonCashUsd += (Number(p.amountVes) || 0) / rate;
                });
                const totalCobradoUsd = cashReceivedUsd + nonCashUsd;
                const totalVentaUsd = Number(detailInvoice.total || 0);
                const exceso = totalCobradoUsd - totalVentaUsd;
                if (cashReceivedUsd > 0 && exceso > 0.01) changeUsd = exceso;
              }

              const showCashLine = cashReceivedUsd > 0;
              return (
                <>
                  {/* Recibido en efectivo — solo si hubo pago en efectivo */}
                  {showCashLine && (
                    <div className="bg-emerald-50/60 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg p-3 flex justify-between items-center">
                      <span className="text-sm font-display font-semibold text-emerald-700 dark:text-emerald-400">
                        Recibido en efectivo
                      </span>
                      <div className="text-right">
                        <p className="font-mono font-bold text-emerald-700 dark:text-emerald-400">
                          {format(cashReceivedUsd)}
                        </p>
                        <p className="font-mono text-xs text-emerald-500">
                          Bs. {(cashReceivedUsd * rate).toLocaleString('es-VE', { minimumFractionDigits: 2 })}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Vuelto entregado */}
                  <div className={`rounded-lg p-3 flex justify-between items-center border ${
                    changeUsd > 0.01
                      ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'
                      : 'bg-surface-50 dark:bg-dark-200/40 border-surface-200 dark:border-dark-300'
                  }`}>
                    <span className={`text-sm font-display font-semibold ${changeUsd > 0.01 ? 'text-amber-700 dark:text-amber-400' : 'text-navy-500 dark:text-gray-400'}`}>
                      Vuelto entregado
                    </span>
                    <div className="text-right">
                      <p className={`font-mono font-bold ${changeUsd > 0.01 ? 'text-amber-700 dark:text-amber-400' : 'text-navy-600 dark:text-gray-300'}`}>
                        {format(changeUsd)}
                      </p>
                      <p className={`font-mono text-xs ${changeUsd > 0.01 ? 'text-amber-500' : 'text-navy-400'}`}>
                        Bs. {(changeUsd * rate).toLocaleString('es-VE', { minimumFractionDigits: 2 })}
                      </p>
                    </div>
                  </div>
                </>
              );
            })()}

            {/* Detalles del cambio */}
            {detailInvoice.status === 'Cambio' && detailInvoice.exchangeDetails && (() => {
              const ex = detailInvoice.exchangeDetails;
              const exDate = ex.date?.toDate?.()?.toLocaleDateString('es-VE') ?? '—';
              const totalAdj = (ex.priceDiff || 0) + (ex.newDeliveryCostUsd || 0) - (detailInvoice.deliveryCostUsd || 0);
              return (
                <div className="border border-teal-200 bg-teal-50/30 rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-display font-semibold text-teal-700 uppercase tracking-wide">
                      Registro de Cambio
                    </p>
                    <span className="text-xs text-navy-400">{exDate} · {ex.processedBy}</span>
                  </div>
                  <p className="text-xs text-navy-500"><span className="font-semibold">Motivo:</span> {ex.reason}</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-[10px] font-display font-semibold text-navy-400 uppercase mb-1.5">Devuelto por el cliente</p>
                      <div className="space-y-1">
                        {(ex.returnedItems || []).map((it: any, i: number) => (
                          <div key={i} className="flex justify-between text-xs">
                            <span className="text-navy-600 truncate">{it.productName} <span className="text-navy-400">({it.variantLabel})</span></span>
                            <span className="font-mono text-navy-700 ml-2 flex-shrink-0">{it.quantity}x {format(it.priceAtSale)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] font-display font-semibold text-navy-400 uppercase mb-1.5">Llevado por el cliente</p>
                      <div className="space-y-1">
                        {(ex.newItems || []).map((it: any, i: number) => (
                          <div key={i} className="flex justify-between text-xs">
                            <span className="text-navy-600 truncate">{it.productName} <span className="text-navy-400">({it.variantLabel})</span></span>
                            <span className="font-mono text-navy-700 ml-2 flex-shrink-0">{it.quantity}x {format(it.priceAtSale)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="pt-2 border-t border-teal-200 flex flex-wrap gap-3 text-xs">
                    {ex.priceDiff !== 0 && (
                      <span>
                        Diferencia precio:{' '}
                        <span className={`font-mono font-bold ${ex.priceDiff > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                          {ex.priceDiff > 0 ? '+' : ''}{format(ex.priceDiff)}
                        </span>
                        {ex.priceDiffMethod && <span className="text-navy-400"> vía {ex.priceDiffMethod}</span>}
                      </span>
                    )}
                    {ex.newDeliveryCostUsd > 0 && (
                      <span>
                        Envío cambio:{' '}
                        <span className="font-mono font-bold text-blue-600">{format(ex.newDeliveryCostUsd)}</span>
                        {ex.deliveryMethod && <span className="text-navy-400"> vía {ex.deliveryMethod}</span>}
                      </span>
                    )}
                    {Math.abs(totalAdj) > 0.005 && (
                      <span className="ml-auto font-semibold">
                        Total ajuste:{' '}
                        <span className={`font-mono ${totalAdj > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                          {totalAdj > 0 ? '+' : ''}{format(totalAdj)}
                        </span>
                      </span>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Print / Download actions */}
            <div className="flex gap-2 pt-2">
              <button onClick={() => printReceipt({ invoice: detailInvoice, products, clients, currentExchangeRate: exchangeRate })}
                className="btn-primary flex-1">
                <Printer size={16} /> Imprimir Recibo
              </button>
              <button onClick={() => downloadReceiptPdf({ invoice: detailInvoice, products, clients, currentExchangeRate: exchangeRate })}
                className="btn-secondary flex-1">
                <Download size={16} /> Guardar PDF
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* VERIFY PAGO MÓVIL MODAL — ingresar referencia, atarla al pedido y verificar */}
      {verifyInvoice && (
        <Modal open={true} onClose={() => setVerifyInvoice(null)} title={`Verificar pago móvil — ${label(verifyInvoice)}`} size="sm">
          <div className="space-y-3">
            <p className="text-sm text-navy-500 dark:text-gray-400">
              Ingresá la referencia del pago móvil: se guarda en el pedido y se busca
              contra Banesco por esa referencia (no por monto) en la fecha de la factura.
            </p>
            {getPagoMovilPayments(verifyInvoice).map(({ payment, idx }) => {
              const rate = verifyInvoice.exchangeRate || exchangeRate || 1;
              const ves = (Number(payment.amountVes) || 0) || ((Number(payment.amountUsd) || 0) * rate);
              return (
                <div key={idx} className="bg-surface-50 dark:bg-dark-200/40 border border-surface-200 dark:border-dark-300 rounded-lg p-3">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm font-display font-medium text-navy-800 dark:text-gray-200">{payment.method}</span>
                    {ves > 0 && (
                      <span className="font-mono text-[11px] text-navy-400 dark:text-gray-500">
                        Bs. {Number(ves).toLocaleString('es-VE', { minimumFractionDigits: 2 })}
                      </span>
                    )}
                  </div>
                  <PagoMovilVerifyRow
                    invoiceId={verifyInvoice.id}
                    paymentIndex={idx}
                    initialRef={payment.ref ? String(payment.ref) : ''}
                    date={toDate(verifyInvoice.date) || new Date()}
                    onRefSaved={refetchIfServer}
                  />
                </div>
              );
            })}
          </div>
        </Modal>
      )}

      {/* EXCHANGE MODAL */}
      {exchangeInvoice && (
        <ExchangeModal
          invoice={exchangeInvoice}
          products={products}
          loading={exchangeLoading}
          onClose={() => setExchangeInvoice(null)}
          onConfirm={handleExchange}
        />
      )}

      {/* RETURN MODAL */}
      {returnInvoice && (
        <Modal open={true} onClose={() => setReturnInvoice(null)} title={`Devolución — ${label(returnInvoice)}`} size="sm">
          <div className="space-y-4">
            <div><label className="block text-sm font-display font-medium text-navy-700 mb-1.5">Motivo</label>
              <select value={returnReason} onChange={(e) => setReturnReason(e.target.value)} className="input-field">
                {RETURN_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}</select></div>
            <div><label className="block text-sm font-display font-medium text-navy-700 mb-1.5">Detalles</label>
              <textarea value={returnDetails} onChange={(e) => setReturnDetails(e.target.value)} className="input-field" rows={3} /></div>
            <div className="flex justify-end gap-3 pt-4 border-t border-surface-200">
              <button onClick={() => setReturnInvoice(null)} className="btn-secondary">Cancelar</button>
              <button onClick={handleReturn} disabled={loading} className="btn-danger">{loading ? 'Procesando...' : 'Procesar Devolución'}</button></div>
          </div>
        </Modal>
      )}

      {/* ABONO MODAL */}
      {abonoInvoice && (
        <Modal open={true} onClose={() => setAbonoInvoice(null)} title={`Abono — ${label(abonoInvoice)}`} size="sm">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-surface-50 rounded-lg p-3"><p className="text-[10px] font-display font-semibold text-navy-400 uppercase">Total</p>
                <p className="font-mono font-bold text-navy-900">{format(abonoInvoice.total)}</p></div>
              <div className="bg-surface-50 rounded-lg p-3"><p className="text-[10px] font-display font-semibold text-navy-400 uppercase">Pendiente</p>
                <p className="font-mono font-bold text-accent-red">Bs. {((abonoInvoice.total * (abonoInvoice.exchangeRate || 1)) - (abonoInvoice.abonos || []).reduce((a: number, b: any) => a + b.amountVes, 0)).toFixed(2)}</p></div>
            </div>
            <div><label className="block text-sm font-display font-medium text-navy-700 mb-1.5">Método</label>
              <select value={abonoMethod} onChange={(e) => setAbonoMethod(e.target.value)} className="input-field">
                {PAYMENT_METHODS.filter((m) => m.currency !== 'none').map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}</select></div>
            <div><label className="block text-sm font-display font-medium text-navy-700 mb-1.5">Monto</label>
              <input type="number" step="0.01" value={abonoAmount} onChange={(e) => setAbonoAmount(e.target.value)} className="input-field font-mono" /></div>
            {abonoMethod === 'Pago movil' && <div><label className="block text-sm font-display font-medium text-navy-700 mb-1.5">Referencia</label>
              <input value={abonoRef} onChange={(e) => setAbonoRef(e.target.value)} className="input-field" /></div>}
            <div className="flex justify-end gap-3 pt-4 border-t border-surface-200">
              <button onClick={() => setAbonoInvoice(null)} className="btn-secondary">Cancelar</button>
              <button onClick={handleAbono} disabled={loading} className="btn-primary">{loading ? 'Guardando...' : 'Registrar Abono'}</button></div>
          </div>
        </Modal>
      )}

      {/* Modal: Editar Datos del Cliente / Observación */}
      {editInvoice && (
        <Modal open={!!editInvoice} onClose={() => setEditInvoice(null)} title="Editar Datos de la Factura" size="md">
          <div className="space-y-5">
            <div>
              <p className="text-xs text-navy-400 font-display uppercase tracking-wide mb-1">Factura</p>
              <p className="text-sm font-mono text-navy-700">#{editInvoice.numericId} · {format(editInvoice.total || 0)}</p>
            </div>

            {/* Datos del cliente */}
            <div className="space-y-3 pb-4 border-b border-surface-200">
              <h3 className="text-sm font-display font-bold text-navy-900">Datos del Cliente</h3>
              <div>
                <label className="block text-xs font-display font-medium text-navy-700 mb-1">Nombre</label>
                <input value={editName} onChange={(e) => setEditName(e.target.value)} className="input-field" placeholder="Nombre del cliente" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-display font-medium text-navy-700 mb-1">RIF / C.I.</label>
                  <input value={editRif} onChange={(e) => setEditRif(e.target.value)} className="input-field font-mono" placeholder="V12345678" />
                </div>
                <div>
                  <label className="block text-xs font-display font-medium text-navy-700 mb-1">Teléfono</label>
                  <input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} className="input-field font-mono" placeholder="04141234567" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-display font-medium text-navy-700 mb-1">Dirección</label>
                <input value={editAddress} onChange={(e) => setEditAddress(e.target.value)} className="input-field" placeholder="Dirección de envío" />
              </div>
            </div>

            {/* Observación */}
            <div>
              <h3 className="text-sm font-display font-bold text-navy-900 mb-2">Observación de la Venta</h3>
              <textarea
                value={editObs}
                onChange={(e) => setEditObs(e.target.value)}
                className="input-field min-h-[80px] resize-y"
                placeholder="Notas internas sobre la factura (envío, cambio pendiente, etc.)"
              />
            </div>

            <p className="text-[11px] text-navy-400 leading-relaxed">
              Estos cambios solo afectan al snapshot de esta factura. No modifican el registro maestro del cliente.
            </p>

            <div className="flex justify-end gap-3 pt-4 border-t border-surface-200">
              <button onClick={() => setEditInvoice(null)} className="btn-secondary" disabled={loading}>Cancelar</button>
              <button onClick={handleSaveEdit} disabled={loading} className="btn-primary">{loading ? 'Guardando...' : 'Guardar Cambios'}</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ════════════════════════════════════════════
// Fila de verificación de un pago móvil
// ════════════════════════════════════════════
// Permite ingresar/editar la referencia del pago, GUARDARLA en el pedido
// (updatePaymentRef) y verificarla contra Banesco. La búsqueda es siempre por
// referencia — nunca por monto — porque muchos pagos tienen montos iguales.
type VerifyState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'found'; match: BanescoTransaction; reviewed: number }
  | { status: 'notfound'; reviewed: number }
  | { status: 'error'; message: string };

function PagoMovilVerifyRow({
  invoiceId,
  paymentIndex,
  initialRef,
  date,
  onRefSaved,
}: {
  invoiceId: string;
  paymentIndex: number;
  initialRef: string;
  date: Date;
  onRefSaved: () => void;
}) {
  const toast = useToast();
  const [ref, setRef] = useState(initialRef);
  const [savedRef, setSavedRef] = useState(initialRef);
  const [state, setState] = useState<VerifyState>({ status: 'idle' });

  async function saveAndVerify() {
    const r = ref.trim();
    if (!r) {
      setState({ status: 'error', message: 'Ingresá la referencia del pago.' });
      return;
    }
    setState({ status: 'loading' });
    try {
      // Atar la referencia al pedido si cambió respecto a la guardada
      if (r !== savedRef) {
        await updatePaymentRef(invoiceId, paymentIndex, r);
        setSavedRef(r);
        onRefSaved();
        toast.success('Referencia guardada en el pedido.');
      }
      // Buscar contra Banesco SOLO por referencia (no por monto)
      const result = await validarPagoMovil({ referenceNumber: r, date });
      if (result.found && result.match) {
        setState({ status: 'found', match: result.match, reviewed: result.reviewed });
      } else {
        setState({ status: 'notfound', reviewed: result.reviewed });
      }
    } catch (err: any) {
      setState({ status: 'error', message: err?.message || 'No se pudo verificar.' });
    }
  }

  const dirty = ref.trim() !== savedRef;

  return (
    <div className="space-y-1.5">
      <div className="flex gap-1.5">
        <input
          value={ref}
          onChange={(e) => { setRef(e.target.value); if (state.status !== 'idle') setState({ status: 'idle' }); }}
          onKeyDown={(e) => e.key === 'Enter' && saveAndVerify()}
          placeholder="N° de referencia..."
          className="input-field text-sm font-mono flex-1 py-1.5"
        />
        <button
          type="button"
          onClick={saveAndVerify}
          disabled={state.status === 'loading' || !ref.trim()}
          className="flex items-center gap-1.5 text-[11px] font-display font-semibold px-2.5 rounded-md border border-blue-300 text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-50 transition-colors dark:bg-blue-900/20 dark:border-blue-800/40 dark:text-blue-300 whitespace-nowrap"
        >
          {state.status === 'loading'
            ? (<><Loader2 size={12} className="animate-spin" /> Verificando…</>)
            : (<><ShieldCheck size={12} /> {dirty ? 'Guardar y verificar' : 'Verificar'}</>)}
        </button>
      </div>

      {state.status === 'found' && (
        <div className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-2 py-1.5">
          <div className="flex items-center gap-1.5 font-display font-semibold mb-1">
            <CheckCircle size={13} className="shrink-0" /> Pago encontrado
          </div>
          <dl className="space-y-0.5 text-[11px] text-navy-700">
            <div className="flex justify-between gap-2">
              <dt className="text-navy-500">Referencia</dt>
              <dd className="font-mono font-semibold break-all text-right">{state.match.referenceNumber}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-navy-500">Monto</dt>
              <dd className="font-mono font-semibold">Bs {state.match.amount.toLocaleString('es-VE', { minimumFractionDigits: 2 })}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-navy-500">Fecha</dt>
              <dd className="font-mono">{state.match.trnDate} {state.match.trnTime?.trim()}</dd>
            </div>
            {state.match.concept?.trim() && (
              <div className="flex justify-between gap-2">
                <dt className="text-navy-500">Concepto</dt>
                <dd className="text-right break-words">{state.match.concept.trim()}</dd>
              </div>
            )}
          </dl>
        </div>
      )}
      {state.status === 'notfound' && (
        <div className="flex items-start gap-1.5 text-[11px] text-accent-red bg-red-50 border border-red-200 rounded-md px-2 py-1.5">
          <XCircle size={13} className="mt-0.5 shrink-0" />
          <span>No se encontró un crédito con esa referencia en la fecha (se revisaron {state.reviewed}). Verificá la fecha o la referencia.</span>
        </div>
      )}
      {state.status === 'error' && (
        <div className="flex items-start gap-1.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5">
          <XCircle size={13} className="mt-0.5 shrink-0" />
          <span>{state.message}</span>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════
// Celda REF editable
// ════════════════════════════════════════════
/**
 * Celda de Vendedor con selector de usuarios. Permite reasignar la factura a
 * otro vendedor cuando la venta se registró con la sesión equivocada.
 *
 * Requiere el permiso `canReassignSeller`. La lista de usuarios solo se
 * sincroniza para quien tiene ese permiso (ver useFirestoreListeners), así que
 * si viene vacía caemos a texto plano en vez de mostrar un selector vacío.
 */
function SellerCell({ invoice, onUpdated }: { invoice: any; onUpdated: () => void }) {
  const users = useAppStore((s) => s.users);
  const { can } = usePermissions();
  const toast = useToast();
  const [saving, setSaving] = useState(false);

  const current = invoice.sellerName || '';

  const options = useMemo(() => {
    const names = users
      .map((u: any) => `${u.nombre || ''} ${u.apellido || ''}`.trim())
      .filter(Boolean);
    // El vendedor actual puede ser un usuario ya eliminado; lo conservamos como
    // opción para no perderlo silenciosamente al abrir el selector.
    if (current && !names.includes(current)) names.unshift(current);
    return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b, 'es'));
  }, [users, current]);

  const editable = can('canReassignSeller') && options.length > 0;

  if (!editable) {
    return (
      <td className="px-3 py-3 text-[12px] text-navy-500 break-words leading-tight" title={current}>
        {current || 'N/A'}
      </td>
    );
  }

  async function handleChange(next: string) {
    if (!next || next === current || saving) return;
    setSaving(true);
    try {
      await updateInvoiceSeller(invoice.id, next);
      toast.success(`Vendedor cambiado a ${next}.`);
      onUpdated();
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || 'Error al cambiar el vendedor.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <td className="px-3 py-3">
      <select
        value={current}
        disabled={saving}
        onChange={(e) => handleChange(e.target.value)}
        title={current ? `Vendedor: ${current} — click para reasignar` : 'Asignar vendedor'}
        className="w-full appearance-none bg-transparent bg-none text-[12px] text-navy-500 leading-tight rounded-md px-1 py-0.5 -ml-1
                   border border-transparent hover:border-surface-200 hover:bg-surface-50
                   focus:border-amber-400 focus:bg-white focus:outline-none
                   cursor-pointer disabled:opacity-50 disabled:cursor-wait transition-colors"
      >
        {!current && <option value="">N/A</option>}
        {options.map((name) => (
          <option key={name} value={name}>{name}</option>
        ))}
      </select>
    </td>
  );
}

function RefCell({ invoice, onUpdated }: { invoice: any; onUpdated: () => void }) {
  const toast = useToast();
  const payments = Array.isArray(invoice.payments) ? invoice.payments : [];

  // Identificar qué pagos aceptan ref (Pago Móvil, Zelle, Binance, etc.)
  const editablePayments = payments
    .map((p: any, idx: number) => ({ payment: p, idx }))
    .filter(({ payment }: any) => {
      const method = PAYMENT_METHODS.find((m) => m.name === payment.method);
      return method && (method as any).hasRef !== false;
    });

  const hasEditable = editablePayments.length > 0;
  const isSinglePayment = editablePayments.length === 1;

  // Estado para edit inline (caso 1 solo pago editable)
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [showModal, setShowModal] = useState(false);

  // Display value: todas las refs concatenadas
  const displayRef = payments
    .map((p: any) => p.ref)
    .filter(Boolean)
    .join(', ') || (hasEditable ? '—' : 'N/A');

  function startEditing() {
    if (!hasEditable) return; // no editable: no hace nada
    if (isSinglePayment) {
      setDraft(editablePayments[0].payment.ref || '');
      setEditing(true);
    } else {
      // Múltiples pagos editables: abrir modal para que el cajero
      // sepa exactamente cuál ref está editando
      setShowModal(true);
    }
  }

  async function commitInline() {
    if (saving) return;
    const idx = editablePayments[0].idx;
    setSaving(true);
    try {
      await updatePaymentRef(invoice.id, idx, draft);
      toast.success('Referencia actualizada.');
      setEditing(false);
      onUpdated();
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || 'Error al actualizar.');
    } finally {
      setSaving(false);
    }
  }

  function cancelInline() {
    setEditing(false);
    setDraft('');
  }

  // ── Render ──
  if (editing) {
    return (
      <td className="px-3 py-2">
        <input
          autoFocus
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => { if (!saving) commitInline(); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commitInline(); }
            if (e.key === 'Escape') { e.preventDefault(); cancelInline(); }
          }}
          disabled={saving}
          placeholder="N° de referencia..."
          className="w-full px-2 py-1 text-[13px] font-mono font-semibold text-white bg-navy-900/40 border border-blue-500 rounded outline-none focus:ring-2 focus:ring-blue-400"
        />
      </td>
    );
  }

  return (
    <>
      <td
        onDoubleClick={startEditing}
        title={hasEditable ? 'Doble click para editar' : 'Esta factura no tiene pagos con referencia'}
        className={`px-3 py-3 text-[13px] font-mono break-all leading-tight ${
          hasEditable
            ? 'text-white dark:text-gray-100 cursor-text hover:bg-blue-900/20 transition-colors'
            : 'text-navy-400'
        }`}
      >
        {displayRef}
      </td>

      {/* Modal para editar refs cuando hay múltiples pagos editables */}
      {showModal && (
        <RefMultiEditModal
          invoice={invoice}
          editablePayments={editablePayments}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); onUpdated(); }}
        />
      )}
    </>
  );
}

function RefMultiEditModal({
  invoice,
  editablePayments,
  onClose,
  onSaved,
}: {
  invoice: any;
  editablePayments: { payment: any; idx: number }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  // Estado: array paralelo a editablePayments con los drafts de ref
  const [drafts, setDrafts] = useState<string[]>(
    editablePayments.map(({ payment }) => payment.ref || '')
  );
  const [saving, setSaving] = useState(false);

  async function handleSaveAll() {
    setSaving(true);
    try {
      // Actualizamos solo los que cambiaron
      for (let i = 0; i < editablePayments.length; i++) {
        const original = editablePayments[i].payment.ref || '';
        const newRef = drafts[i];
        if (newRef !== original) {
          await updatePaymentRef(invoice.id, editablePayments[i].idx, newRef);
        }
      }
      toast.success('Referencias actualizadas.');
      onSaved();
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || 'Error al actualizar.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Editar referencias — ${invoiceLabel(invoice)}`} size="md">
      <div className="space-y-3">
        <p className="text-xs text-navy-500 dark:text-gray-400">
          Esta factura tiene varios pagos. Editá la referencia de cada uno individualmente.
        </p>
        {editablePayments.map(({ payment }, i) => (
          <div key={i} className="border border-surface-200 dark:border-dark-300 rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="font-display font-semibold text-sm text-navy-900 dark:text-gray-100">
                {payment.method}
              </span>
              <span className="font-mono text-xs text-navy-500 dark:text-gray-400">
                {payment.amountUsd ? `$ ${Number(payment.amountUsd).toFixed(2)}` : ''}
                {payment.amountVes ? ` · Bs. ${Number(payment.amountVes).toFixed(2)}` : ''}
              </span>
            </div>
            <input
              type="text"
              value={drafts[i]}
              onChange={(e) => {
                const next = [...drafts];
                next[i] = e.target.value;
                setDrafts(next);
              }}
              placeholder="N° de referencia..."
              className="input-field text-sm font-mono"
            />
          </div>
        ))}
        <div className="flex gap-2 justify-end pt-2">
          <button onClick={onClose} disabled={saving} className="btn-ghost text-sm">Cancelar</button>
          <button onClick={handleSaveAll} disabled={saving} className="btn-primary text-sm">
            {saving ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// Helper local — repite la lógica del label de factura sin tener
// que exportarla. label() en el componente principal hace esto mismo.
function invoiceLabel(inv: any): string {
  return inv.numericId ? `FACT-${String(inv.numericId).padStart(4, '0')}` : (inv.id?.slice(0, 6) || '—');
}
