import { useCallback, useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAppStore } from '@/store/appStore';
import { useToast } from '@/components/Toast';
import { signOut } from '@/modules/auth/authService';
import { PAYMENT_METHODS } from '@/modules/invoices/invoiceService';
import {
  calcularAjuste, confirmarEntrega, DIAS_POR_DEFECTO, envioDentroDelTotal,
  fetchPedidosDelRepartidor, lineaNeta, pagadoUsd,
} from './deliveryService';
import { dateKeyVE, formatDateTimeShort, shiftDateKey, todayVE } from '@/utils/dateUtils';
import { telHref, whatsappHref } from '@/utils/phoneUtils';
import { STATUS_CONFIG } from '@/utils/invoiceStatus';
import type { Invoice, InvoiceItem, InvoiceStatus } from '@/types';
import {
  ArrowLeft, Calendar, Check, CheckCircle2, ChevronDown, LogOut, MapPin,
  MessageCircle, Package, Phone, RefreshCw, StickyNote, Truck, Undo2,
} from 'lucide-react';

/** Los cobros en la puerta nunca son a crédito: eso se decide en la tienda. */
const METODOS_COBRO = PAYMENT_METHODS.filter((m) => m.name !== 'Crédito');

function plata(usd: number): string {
  return `$ ${(usd ?? 0).toFixed(2)}`;
}

/**
 * El mismo badge de estado que muestran Facturas, Dashboard e Informes.
 *
 * La entrega no tiene estado propio: mover la mercadería mueve el `status` de
 * la factura. El repartidor ve exactamente lo mismo que ve la tienda, que era
 * el punto — dos estados en paralelo terminan contradiciéndose.
 */
function EstadoFactura({ status }: { status: InvoiceStatus }) {
  const st = STATUS_CONFIG[status] || { class: 'badge-gray', label: status };
  return <span className={`badge ${st.class} shrink-0`}>{st.label}</span>;
}

function datosCliente(inv: Invoice) {
  const c: any = inv.clientSnapshot || {};
  const phone = c.phone || '';
  return {
    nombre: c.name || c.nombre || 'Cliente general',
    direccion: c.address || '',
    // Los links se arman con el normalizador compartido: el 92% de los
    // teléfonos está guardado como 0414… y wa.me necesita 58414…
    tel: telHref(phone),
    whatsapp: whatsappHref(phone),
  };
}

// ════════════════════════════════════════
// Tarjeta de un pedido en la lista
// ════════════════════════════════════════
function TarjetaPedido({ inv, onAbrir }: { inv: Invoice; onAbrir: () => void }) {
  const { nombre, direccion } = datosCliente(inv);
  const devueltas = inv.deliveryConfirmation?.returnedItems?.length || 0;
  const prendas = (inv.items || []).reduce((a, i) => a + (i.quantity || 0), 0);

  return (
    <button
      onClick={onAbrir}
      className="card w-full p-4 text-left active:scale-[0.99] transition-transform"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-display font-bold text-navy-900 dark:text-gray-100 truncate">{nombre}</p>
          <p className="text-xs text-navy-400 dark:text-gray-500 mt-0.5">
            <span className="font-mono">FACT-{String(inv.numericId).padStart(4, '0')}</span>
            {' · '}
            {formatDateTimeShort(inv.date)}
          </p>
        </div>
        <EstadoFactura status={inv.status} />
      </div>

      {direccion && (
        <div className="flex items-start gap-1.5 mt-2.5">
          <MapPin size={14} className="text-navy-300 dark:text-gray-600 shrink-0 mt-px" />
          <span className="text-sm text-navy-500 dark:text-gray-400 line-clamp-2">{direccion}</span>
        </div>
      )}

      {inv.observation && (
        <div className="flex items-start gap-1.5 mt-2.5 p-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
          <StickyNote size={13} className="text-amber-600 shrink-0 mt-px" />
          <span className="text-xs text-amber-800 dark:text-amber-300 line-clamp-3 whitespace-pre-wrap">
            {inv.observation}
          </span>
        </div>
      )}

      <div className="flex items-center justify-between mt-3 pt-3 border-t border-surface-100 dark:border-dark-300">
        <span className="text-xs text-navy-400 dark:text-gray-500 flex items-center gap-1.5">
          <Package size={13} /> {prendas} prenda{prendas === 1 ? '' : 's'}
          {devueltas > 0 && (
            <span className="text-amber-600">· volvieron {devueltas}</span>
          )}
        </span>
        <span className="font-mono font-bold text-navy-900 dark:text-gray-100">{plata(inv.total)}</span>
      </div>
    </button>
  );
}

// ════════════════════════════════════════
// Detalle + confirmación
// ════════════════════════════════════════
function DetallePedido({
  inv, exchangeRate, onVolver, onConfirmado,
}: {
  inv: Invoice;
  exchangeRate: number;
  onVolver: () => void;
  onConfirmado: () => void;
}) {
  const currentUser = useAppStore((s) => s.currentUser);
  const toast = useToast();
  const items = inv.items || [];

  // Arranca con todo marcado: lo normal es que el cliente se quede con todo,
  // y desmarcar es el gesto excepcional.
  const [quedados, setQuedados] = useState<Set<number>>(() => new Set(items.map((_, i) => i)));
  const [metodo, setMetodo] = useState('');
  const [monto, setMonto] = useState('');
  const [ref, setRef] = useState('');
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);

  const { nombre, direccion, tel, whatsapp } = datosCliente(inv);
  const yaConfirmado = Boolean(inv.deliveryConfirmation);

  const devueltos = useMemo(
    () => items.filter((_, i) => !quedados.has(i)),
    [items, quedados],
  );

  const { credito, totalNuevo } = useMemo(
    () => (devueltos.length === items.length
      ? { credito: 0, totalNuevo: inv.total ?? 0 }
      : calcularAjuste(inv, devueltos)),
    [inv, devueltos, items.length],
  );

  const pagado = useMemo(() => pagadoUsd(inv), [inv]);
  const saldo = Number((totalNuevo - pagado).toFixed(2));
  const metodoCfg = METODOS_COBRO.find((m) => m.name === metodo);

  // Prellenar el monto con el saldo, en la moneda del método elegido.
  useEffect(() => {
    if (!metodoCfg || saldo <= 0.01) return;
    const enMoneda = metodoCfg.currency === 'usd' ? saldo : saldo * (exchangeRate || 1);
    setMonto(enMoneda.toFixed(2));
  }, [metodo, saldo, exchangeRate]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggle(idx: number) {
    setQuedados((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  }

  async function confirmar() {
    if (!currentUser) return;
    const montoNum = Number(monto) || 0;
    if (metodo && montoNum <= 0) {
      toast.error('Poné el monto que cobraste, o quitá el método de pago.');
      return;
    }
    if (metodoCfg?.hasRef && metodo && !ref.trim()) {
      toast.error(`Falta la referencia del pago (${metodo}).`);
      return;
    }

    const resumen = devueltos.length === 0
      ? 'El cliente se quedó con todo.'
      : devueltos.length === items.length
        ? 'El cliente no se quedó con nada. Todo vuelve a la tienda.'
        : `El cliente se quedó con ${items.length - devueltos.length} de ${items.length}. Vuelven ${devueltos.length} a la tienda.`;
    if (!confirm(`${resumen}\n\nTotal del pedido: ${plata(totalNuevo)}\n\n¿Confirmar?`)) return;

    setGuardando(true);
    try {
      await confirmarEntrega({
        invoice: inv,
        keptIndexes: [...quedados],
        collected: metodo && montoNum > 0 ? { method: metodo, amount: montoNum, ref: ref.trim() || undefined } : null,
        exchangeRate,
        courier: currentUser,
        note: nota,
      });
      toast.success('Entrega confirmada.');
      onConfirmado();
    } catch (err: any) {
      toast.error(err?.message || 'No se pudo confirmar la entrega.');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="pb-28">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onVolver} className="btn-ghost p-2 -ml-2 text-navy-500 dark:text-gray-400">
          <ArrowLeft size={20} />
        </button>
        <div className="min-w-0">
          <p className="font-display font-bold text-navy-900 dark:text-gray-100 truncate">{nombre}</p>
          <p className="text-xs text-navy-400 dark:text-gray-500">
            <span className="font-mono">FACT-{String(inv.numericId).padStart(4, '0')}</span>
            {' · '}
            {formatDateTimeShort(inv.date)}
          </p>
        </div>
      </div>

      {/* ── Contacto ── */}
      <div className="card p-4 mb-3">
        {direccion && (
          <div className="flex items-start gap-2 mb-3">
            <MapPin size={16} className="text-navy-300 dark:text-gray-600 shrink-0 mt-0.5" />
            <span className="text-sm text-navy-600 dark:text-gray-300">{direccion}</span>
          </div>
        )}

        {/* Acá suele venir el "llamar antes de llegar" o "timbre 2 veces":
            sin truncar, que es justo lo que hay que leer antes de tocar. */}
        {inv.observation && (
          <div className="flex items-start gap-2 mb-3 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
            <StickyNote size={15} className="text-amber-600 shrink-0 mt-0.5" />
            <span className="text-sm text-amber-800 dark:text-amber-300 whitespace-pre-wrap">
              {inv.observation}
            </span>
          </div>
        )}
        <div className="grid grid-cols-3 gap-2">
          <a
            href={tel ?? undefined}
            className={`btn-ghost flex-col gap-1 py-3 text-xs ${tel ? 'text-navy-600 dark:text-gray-300' : 'opacity-40 pointer-events-none'}`}
          >
            <Phone size={17} /> Llamar
          </a>
          <a
            href={whatsapp ?? undefined}
            target="_blank" rel="noreferrer"
            className={`btn-ghost flex-col gap-1 py-3 text-xs ${whatsapp ? 'text-emerald-600' : 'opacity-40 pointer-events-none'}`}
          >
            <MessageCircle size={17} /> WhatsApp
          </a>
          <a
            href={direccion ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(direccion)}` : undefined}
            target="_blank" rel="noreferrer"
            className={`btn-ghost flex-col gap-1 py-3 text-xs ${direccion ? 'text-blue-600' : 'opacity-40 pointer-events-none'}`}
          >
            <MapPin size={17} /> Mapa
          </a>
        </div>
      </div>

      {yaConfirmado ? (
        <ResumenConfirmado inv={inv} />
      ) : (
        <>
          {/* ── Prendas ── */}
          <p className="text-[11px] font-display font-semibold text-navy-400 dark:text-gray-500 uppercase tracking-wider px-1 mb-2">
            ¿Con cuáles se quedó?
          </p>
          <div className="space-y-2 mb-4">
            {items.map((item: InvoiceItem, idx: number) => {
              const activo = quedados.has(idx);
              return (
                <button
                  key={`${item.productId}-${item.variantIndex}-${idx}`}
                  onClick={() => toggle(idx)}
                  className={`card w-full p-3.5 text-left flex items-center gap-3 transition-colors ${
                    activo ? '' : 'opacity-60 bg-surface-50 dark:bg-dark-300/40'
                  }`}
                >
                  <div className={`w-6 h-6 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors ${
                    activo
                      ? 'bg-emerald-500 border-emerald-500'
                      : 'border-surface-300 dark:border-dark-100'
                  }`}>
                    {activo && <Check size={15} className="text-white" strokeWidth={3} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-medium truncate ${activo ? 'text-navy-900 dark:text-gray-100' : 'text-navy-400 dark:text-gray-500 line-through'}`}>
                      {item.productName}
                    </p>
                    <p className="text-xs text-navy-400 dark:text-gray-500">
                      {item.variantLabel}
                      {item.quantity > 1 && ` · x${item.quantity}`}
                    </p>
                  </div>
                  <span className={`font-mono text-sm shrink-0 ${activo ? 'text-navy-700 dark:text-gray-300' : 'text-navy-300 dark:text-gray-600'}`}>
                    {plata(lineaNeta(item))}
                  </span>
                </button>
              );
            })}
          </div>

          {devueltos.length > 0 && (
            <div className="flex items-start gap-2 p-3 mb-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
              <Undo2 size={16} className="text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700 dark:text-amber-300">
                {devueltos.length === items.length
                  ? 'No se queda con nada: todo vuelve a la tienda y el pedido queda como devolución.'
                  : `Vuelven ${devueltos.length} prenda${devueltos.length === 1 ? '' : 's'} a la tienda. Se descuentan ${plata(credito)} del pedido.`}
              </p>
            </div>
          )}

          {/* ── Plata ── */}
          <div className="card p-4 mb-3">
            <div className="flex justify-between text-sm mb-1.5">
              <span className="text-navy-500 dark:text-gray-400">Total del pedido</span>
              <span className="font-mono font-semibold text-navy-900 dark:text-gray-100">{plata(totalNuevo)}</span>
            </div>
            {envioDentroDelTotal(inv) > 0 && (
              <div className="flex justify-between text-xs mb-1.5">
                <span className="text-navy-400 dark:text-gray-500">incluye envío</span>
                <span className="font-mono text-navy-400 dark:text-gray-500">{plata(envioDentroDelTotal(inv))}</span>
              </div>
            )}
            <div className="flex justify-between text-sm mb-2">
              <span className="text-navy-500 dark:text-gray-400">Ya pagó</span>
              <span className="font-mono text-emerald-600">−{plata(pagado)}</span>
            </div>
            <div className="flex justify-between pt-2.5 border-t border-surface-100 dark:border-dark-300">
              <span className="font-display font-semibold text-navy-900 dark:text-gray-100 text-sm">
                {saldo >= -0.01 ? 'A cobrar' : 'A favor del cliente'}
              </span>
              <span className={`font-mono font-bold ${saldo > 0.01 ? 'text-navy-900 dark:text-gray-100' : 'text-blue-600'}`}>
                {plata(Math.abs(saldo))}
              </span>
            </div>
            {saldo < -0.01 && (
              <p className="text-[11px] text-blue-600 dark:text-blue-400 mt-2">
                Pagó de más por las prendas que devuelve. El reintegro lo hace la tienda.
              </p>
            )}
          </div>

          {/* ── Cobro ── */}
          {saldo > 0.01 && (
            <div className="card p-4 mb-3 space-y-3">
              <p className="text-[11px] font-display font-semibold text-navy-400 dark:text-gray-500 uppercase tracking-wider">
                ¿Cobraste algo?
              </p>
              <select value={metodo} onChange={(e) => { setMetodo(e.target.value); setRef(''); }} className="input-field w-full">
                <option value="">No cobré nada</option>
                {METODOS_COBRO.map((m) => (
                  <option key={m.id} value={m.name}>{m.name}</option>
                ))}
              </select>
              {metodo && (
                <>
                  <div>
                    <label className="text-xs text-navy-400 dark:text-gray-500 mb-1 block">
                      Monto en {metodoCfg?.currency === 'usd' ? 'dólares' : 'bolívares'}
                    </label>
                    <input
                      type="number" inputMode="decimal" step="0.01" value={monto}
                      onChange={(e) => setMonto(e.target.value)}
                      className="input-field w-full font-mono text-lg"
                    />
                  </div>
                  {metodoCfg?.hasRef && (
                    <input
                      type="text" inputMode="numeric" value={ref} onChange={(e) => setRef(e.target.value)}
                      placeholder="Referencia" className="input-field w-full font-mono"
                    />
                  )}
                </>
              )}
            </div>
          )}

          <textarea
            value={nota} onChange={(e) => setNota(e.target.value)} rows={2}
            placeholder="Nota (opcional): por qué devolvió, quién recibió…"
            className="input-field w-full text-sm mb-3"
          />

          {/* ── Confirmar ── */}
          <div className="fixed bottom-0 left-0 right-0 p-4 bg-page/95 backdrop-blur border-t border-surface-200 dark:border-dark-300">
            <button
              onClick={confirmar} disabled={guardando}
              className="btn-primary w-full justify-center py-3.5 text-base disabled:opacity-60"
            >
              {guardando ? 'Confirmando…' : (
                <><CheckCircle2 size={18} /> Confirmar entrega</>
              )}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ════════════════════════════════════════
// Pedido ya confirmado — solo lectura
// ════════════════════════════════════════
function ResumenConfirmado({ inv }: { inv: Invoice }) {
  const c = inv.deliveryConfirmation!;

  // Qué pasó se deduce de lo que volvió — no hace falta guardarlo aparte, y
  // así no puede quedar desfasado de los ítems que tiene la factura.
  const devueltas = c.returnedItems?.length || 0;
  const quedadas = c.keptItems?.length || 0;
  const resumen = quedadas === 0
    ? 'No se quedó con nada'
    : devueltas === 0
      ? 'Se quedó con todo'
      : `Se quedó con ${quedadas} de ${quedadas + devueltas}`;

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <CheckCircle2 size={18} className="text-emerald-500 shrink-0" />
          <p className="font-display font-semibold text-navy-900 dark:text-gray-100 text-sm truncate">
            {resumen}
          </p>
        </div>
        <EstadoFactura status={inv.status} />
      </div>
      <p className="text-xs text-navy-400 dark:text-gray-500">
        Por {c.courierName} · {c.date?.toDate?.().toLocaleString('es-VE') ?? ''}
      </p>

      {c.returnedItems?.length > 0 && (
        <div>
          <p className="text-[11px] font-display font-semibold text-navy-400 dark:text-gray-500 uppercase mb-1">Volvieron</p>
          {c.itemsOriginal
            ?.filter((it) => c.returnedItems.some((r) => r.productId === it.productId && r.variantIndex === it.variantIndex))
            .map((it, i) => (
              <p key={i} className="text-sm text-navy-600 dark:text-gray-300">
                {it.productName} <span className="text-navy-400 dark:text-gray-500">({it.variantLabel})</span>
              </p>
            ))}
          <p className="text-xs text-amber-600 mt-1">Se descontaron {plata(c.creditUsd)}</p>
        </div>
      )}

      {c.collected && (
        <div className="pt-2 border-t border-surface-100 dark:border-dark-300">
          <p className="text-sm text-navy-600 dark:text-gray-300">
            Cobrado: <span className="font-mono font-semibold">{c.collected.amount.toFixed(2)}</span> por {c.collected.method}
            {c.collected.ref && <span className="text-navy-400 dark:text-gray-500"> · ref {c.collected.ref}</span>}
          </p>
        </div>
      )}

      {c.note && <p className="text-sm text-navy-500 dark:text-gray-400 italic">“{c.note}”</p>}
    </div>
  );
}

/** "Hoy", "Ayer" o "sábado, 8 de marzo" — encabezado de cada grupo de día. */
function etiquetaDia(key: string): string {
  const hoy = todayVE();
  if (key === hoy) return 'Hoy';
  if (key === shiftDateKey(hoy, -1)) return 'Ayer';
  return new Date(`${key}T12:00:00`).toLocaleDateString('es-VE', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
}

/** "8 mar" — para resumir el rango en una línea. */
function diaCorto(key: string): string {
  return new Date(`${key}T12:00:00`).toLocaleDateString('es-VE', { day: 'numeric', month: 'short' });
}

// ════════════════════════════════════════
// Filtro de fechas
// ════════════════════════════════════════
function FiltroFecha({ desde, hasta, onAplicar }: {
  desde: string;
  hasta: string;
  onAplicar: (desde: string, hasta: string) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [d, setD] = useState(desde);
  const [h, setH] = useState(hasta);

  // Si el rango cambia desde afuera (un atajo), el borrador lo sigue.
  useEffect(() => { setD(desde); setH(hasta); }, [desde, hasta]);

  const hoy = todayVE();
  const atajos = [
    { label: 'Hoy', d: hoy, h: hoy },
    { label: `${DIAS_POR_DEFECTO} días`, d: shiftDateKey(hoy, -(DIAS_POR_DEFECTO - 1)), h: hoy },
    { label: '7 días', d: shiftDateKey(hoy, -6), h: hoy },
  ];

  const invalido = d > h;
  const resumen = desde === hasta ? etiquetaDia(desde) : `${diaCorto(desde)} — ${diaCorto(hasta)}`;

  return (
    <div className="border-t border-surface-200 dark:border-dark-300">
      <button
        onClick={() => setAbierto((v) => !v)}
        className="w-full px-4 py-2.5 flex items-center justify-between gap-2 text-left"
      >
        <span className="flex items-center gap-2 text-sm text-navy-600 dark:text-gray-300 min-w-0">
          <Calendar size={15} className="text-navy-400 dark:text-gray-500 shrink-0" />
          <span className="font-medium capitalize truncate">{resumen}</span>
        </span>
        <ChevronDown
          size={16}
          className={`text-navy-400 dark:text-gray-500 shrink-0 transition-transform ${abierto ? 'rotate-180' : ''}`}
        />
      </button>

      {abierto && (
        <div className="px-4 pb-3 space-y-2.5">
          <div className="flex gap-2">
            {atajos.map((a) => {
              const activo = desde === a.d && hasta === a.h;
              return (
                <button
                  key={a.label}
                  onClick={() => { onAplicar(a.d, a.h); setAbierto(false); }}
                  className={`flex-1 py-2 rounded-lg text-xs font-display font-semibold transition-colors ${
                    activo
                      ? 'bg-navy-900 text-white dark:bg-blue-600'
                      : 'bg-surface-100 dark:bg-dark-300 text-navy-600 dark:text-gray-300'
                  }`}
                >
                  {a.label}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2">
            <input
              type="date" value={d} max={h || undefined}
              onChange={(e) => setD(e.target.value)}
              className="input-field text-sm flex-1 min-w-0"
            />
            <span className="text-navy-300 dark:text-gray-600 shrink-0">—</span>
            <input
              type="date" value={h} min={d || undefined}
              onChange={(e) => setH(e.target.value)}
              className="input-field text-sm flex-1 min-w-0"
            />
          </div>

          <button
            onClick={() => { onAplicar(d, h); setAbierto(false); }}
            disabled={invalido}
            className="btn-primary w-full justify-center py-2 text-sm disabled:opacity-50"
          >
            {invalido ? 'La fecha inicial es posterior' : 'Aplicar'}
          </button>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════
// Página
// ════════════════════════════════════════
export function CourierPage() {
  const currentUser = useAppStore((s) => s.currentUser);
  const exchangeRate = useAppStore((s) => s.exchangeRate);
  const setExchangeRate = useAppStore((s) => s.setExchangeRate);
  const toast = useToast();

  const [desde, setDesde] = useState(() => shiftDateKey(todayVE(), -(DIAS_POR_DEFECTO - 1)));
  const [hasta, setHasta] = useState(() => todayVE());
  const [pedidos, setPedidos] = useState<Invoice[]>([]);
  const [cargando, setCargando] = useState(true);
  const [abiertoId, setAbiertoId] = useState<string | null>(null);

  // Esta vista corre FUERA del Layout, así que useFirestoreListeners no se
  // monta: la tasa hay que traerla acá o el cobro en bolívares saldría con
  // tasa 1. Es el único dato global que necesita.
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'config', 'exchangeRate'), (snap) => {
      setExchangeRate(snap.exists() && snap.data().value ? snap.data().value : 1);
    });
    return unsub;
  }, [setExchangeRate]);

  // `toast` queda FUERA de las dependencias a propósito: el ToastProvider no
  // memoiza su value, así que cambia de identidad en cada render y meterlo acá
  // dispararía la consulta en loop.
  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      setPedidos(await fetchPedidosDelRepartidor(desde, hasta));
    } catch (err) {
      console.error('Error cargando pedidos de delivery:', err);
      toast.error('No se pudieron cargar los pedidos.');
    } finally {
      setCargando(false);
    }
  }, [desde, hasta]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { cargar(); }, [cargar]);

  const abierto = pedidos.find((p) => p.id === abiertoId) || null;

  // Un grupo por día, el más reciente arriba, y dentro de cada día lo que falta
  // entregar primero. El sort es estable, así que el orden por hora se mantiene.
  const grupos = useMemo(() => {
    const mapa = new Map<string, Invoice[]>();
    for (const inv of pedidos) {
      const key = dateKeyVE(inv.date);
      if (!mapa.has(key)) mapa.set(key, []);
      mapa.get(key)!.push(inv);
    }
    for (const lista of mapa.values()) {
      lista.sort((a, b) =>
        Number(Boolean(a.deliveryConfirmation)) - Number(Boolean(b.deliveryConfirmation)));
    }
    return [...mapa.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [pedidos]);

  const porEntregar = pedidos.filter((p) => !p.deliveryConfirmation).length;

  return (
    <div className="min-h-screen bg-page">
      <header className="sticky top-0 z-10 bg-page/95 backdrop-blur border-b border-surface-200 dark:border-dark-300">
        <div className="max-w-lg mx-auto">
          <div className="px-4 py-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-emerald-500 flex items-center justify-center shrink-0">
                <Truck size={18} className="text-white" />
              </div>
              <div className="min-w-0">
                <p className="font-display font-bold text-navy-900 dark:text-gray-100 leading-tight">Entregas</p>
                <p className="text-xs text-navy-400 dark:text-gray-500 truncate">
                  {currentUser?.nombre}
                  {!cargando && ` · ${porEntregar} por entregar`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={cargar} disabled={cargando} className="btn-ghost p-2 text-navy-400 dark:text-gray-500">
                <RefreshCw size={17} className={cargando ? 'animate-spin' : ''} />
              </button>
              <button onClick={() => signOut()} className="btn-ghost p-2 text-navy-400 dark:text-gray-500">
                <LogOut size={17} />
              </button>
            </div>
          </div>

          {!abierto && (
            <FiltroFecha
              desde={desde}
              hasta={hasta}
              onAplicar={(d, h) => { setDesde(d); setHasta(h); }}
            />
          )}
        </div>
      </header>

      <main className="max-w-lg mx-auto p-4">
        {abierto ? (
          <DetallePedido
            inv={abierto}
            exchangeRate={exchangeRate}
            onVolver={() => setAbiertoId(null)}
            onConfirmado={() => { setAbiertoId(null); cargar(); }}
          />
        ) : cargando ? (
          <div className="flex justify-center py-20">
            <div className="w-8 h-8 rounded-full border-2 border-surface-300 border-t-navy-500 animate-spin" />
          </div>
        ) : grupos.length === 0 ? (
          <div className="text-center py-20">
            <Truck size={40} className="mx-auto text-navy-200 dark:text-gray-700 mb-3" />
            <p className="text-navy-400 dark:text-gray-500 text-sm">
              {desde === hasta
                ? `Sin entregas el ${diaCorto(desde)}.`
                : 'Sin entregas en estas fechas.'}
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {grupos.map(([dia, lista]) => {
              const faltan = lista.filter((i) => !i.deliveryConfirmation).length;
              return (
                <section key={dia} className="space-y-2.5">
                  <div className="flex items-center justify-between gap-2 px-1">
                    <p className="text-[11px] font-display font-semibold text-navy-400 dark:text-gray-500 uppercase tracking-wider capitalize">
                      {etiquetaDia(dia)}
                    </p>
                    <p className="text-[11px] text-navy-300 dark:text-gray-600">
                      {faltan > 0 ? `${faltan} por entregar` : 'todo confirmado'}
                    </p>
                  </div>
                  {lista.map((inv) => (
                    <TarjetaPedido key={inv.id} inv={inv} onAbrir={() => setAbiertoId(inv.id)} />
                  ))}
                </section>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
