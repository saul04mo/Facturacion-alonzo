import { collection, doc, getDoc, getDocs, limit, orderBy, query, where, writeBatch, Timestamp } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { batchRestoreStock } from '@/utils/stockUtils';
import { addAbono, PAYMENT_METHODS } from '@/modules/invoices/invoiceService';
import { isCountableSale } from '@/utils/invoiceStatus';
import { calcularAjuste } from './deliveryMath';
import type {
  AppUser, DeliveryConfirmation, DeliveryItemRef, Invoice, InvoiceItem, InvoiceStatus, Product,
} from '@/types';

// Las cuentas viven en deliveryMath (puras, testeables sin Firebase). Se
// re-exportan acá para que las vistas tengan una sola puerta de entrada.
export { calcularAjuste, envioDentroDelTotal, lineaNeta, pagadoUsd } from './deliveryMath';

/**
 * Rango que abre la vista por defecto. Más de un día porque un pedido que no se
 * pudo entregar ayer sigue vivo hoy, y tiene que poder cerrarlo sin que alguien
 * lo reabra a mano desde la tienda. Desde la vista se puede cambiar.
 */
export const DIAS_POR_DEFECTO = 3;

function comoRef(i: InvoiceItem): DeliveryItemRef {
  return { productId: i.productId, variantIndex: i.variantIndex, quantity: i.quantity };
}

/** Trae de Firestore solo los productos que hacen falta para reintegrar stock. */
async function cargarProductos(items: DeliveryItemRef[]): Promise<Product[]> {
  const ids = [...new Set(items.map((i) => i.productId))];
  const snaps = await Promise.all(ids.map((id) => getDoc(doc(db, 'products', id))));
  return snaps
    .filter((s) => s.exists())
    .map((s) => ({ id: s.id, ...s.data() })) as unknown as Product[];
}

/**
 * Pedidos que el repartidor tiene que ver: delivery local de los últimos días.
 *
 * Además de las ventas vivas entran las que él ya confirmó, aunque hayan
 * quedado en 'Devolución': si no, un pedido que el cliente rechazó entero
 * desaparecía de su pantalla apenas lo confirmaba y no podía ni releer lo que
 * acababa de reportar.
 *
 * Las dos puntas del rango van contra el mismo campo `date`, así que Firestore
 * lo resuelve con el índice de un solo campo: no hay que desplegar un índice
 * compuesto. El tipo de entrega se filtra en memoria por lo mismo.
 *
 * `desdeKey` y `hastaKey` son YYYY-MM-DD, ambos inclusive.
 *
 * Los límites del día se arman con el offset de Venezuela explícito en vez de
 * dejárselo a la zona horaria del dispositivo. Si no, en un celular configurado
 * en otra zona la consulta cortaría en un horario y la agrupación por día (que
 * usa dateKeyVE) en otro, y aparecerían pedidos en un día que el filtro dice no
 * haber pedido. Venezuela es UTC-4 fijo, sin horario de verano.
 */
const OFFSET_VE = '-04:00';

export async function fetchPedidosDelRepartidor(
  desdeKey: string,
  hastaKey: string,
): Promise<Invoice[]> {
  const desde = new Date(`${desdeKey}T00:00:00.000${OFFSET_VE}`);
  const hasta = new Date(`${hastaKey}T23:59:59.999${OFFSET_VE}`);

  const snap = await getDocs(
    query(
      collection(db, 'invoices'),
      where('date', '>=', Timestamp.fromDate(desde)),
      where('date', '<=', Timestamp.fromDate(hasta)),
      orderBy('date', 'desc'),
      limit(300),
    ),
  );

  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as unknown as Invoice)
    .filter((inv) => inv.deliveryType === 'local'
      && (isCountableSale(inv.status) || Boolean(inv.deliveryConfirmation)));
}

/**
 * Confirma lo que pasó en la puerta del cliente.
 *
 * `keptIndexes` son los índices de `invoice.items` que el cliente se quedó.
 * Todo lo que no esté ahí se considera devuelto: vuelve al stock y se descuenta
 * del total.
 *
 * Dos caminos distintos, a propósito:
 *  - Devolvió TODO → es una devolución como cualquier otra: pasa a 'Devolución'
 *    (que ya queda fuera de los reportes) y los ítems se dejan intactos como
 *    registro de lo que se intentó vender.
 *  - Devolvió ALGO → la venta sigue siendo venta, así que hay que editarla de
 *    verdad: quedan solo los ítems que el cliente se quedó y el total baja. Si
 *    no se ajustara, el informe seguiría contando mercadería que ya está de
 *    vuelta en la percha.
 *
 * La entrega NO tiene estado propio: mueve el `status` de la factura, el mismo
 * que ven Facturas, Dashboard e Informes. Un segundo estado en paralelo era
 * garantía de que en algún momento los dos dijeran cosas distintas.
 */
export async function confirmarEntrega(opts: {
  invoice: Invoice;
  /** Índices de invoice.items que el cliente se quedó. */
  keptIndexes: number[];
  /** Cobro hecho en la puerta. null si no cobró nada. */
  collected: { method: string; amount: number; ref?: string } | null;
  exchangeRate: number;
  courier: AppUser;
  note?: string;
}): Promise<{ status: InvoiceStatus; credito: number; totalNuevo: number }> {
  const { invoice, keptIndexes, collected, exchangeRate, courier, note } = opts;

  if (invoice.deliveryConfirmation) {
    throw new Error('Este pedido ya fue confirmado.');
  }

  const items = invoice.items || [];
  const kept = new Set(keptIndexes);
  const quedados = items.filter((_, idx) => kept.has(idx));
  const devueltos = items.filter((_, idx) => !kept.has(idx));

  const todoDevuelto = quedados.length === 0;

  // El estado que queda en la factura. Entregar es el final del camino
  // logístico, así que cierra el flujo de preparación. 'Pendiente de pago' no
  // se toca: eso lo resuelve el cobro, no la entrega.
  const status: InvoiceStatus = todoDevuelto
    ? 'Devolución'
    : invoice.status === 'Por Preparar' || invoice.status === 'Preparado'
      ? 'Finalizado'
      : invoice.status;

  const { credito, totalNuevo } = todoDevuelto
    ? { credito: 0, totalNuevo: invoice.total ?? 0 }
    : calcularAjuste(invoice, devueltos);

  const confirmacion: DeliveryConfirmation = {
    date: Timestamp.now(),
    courierUid: courier.uid,
    courierName: `${courier.nombre} ${courier.apellido}`.trim(),
    keptItems: quedados.map(comoRef),
    returnedItems: devueltos.map(comoRef),
    itemsOriginal: items,
    totalOriginal: invoice.total ?? 0,
    creditUsd: credito,
    collected: null,
    note: note?.trim() || null,
  };

  if (collected && collected.amount > 0.001) {
    const metodo = PAYMENT_METHODS.find((m) => m.name === collected.method);
    confirmacion.collected = {
      method: collected.method,
      amount: Number(collected.amount.toFixed(2)),
      amountUsd: Number(
        (metodo?.currency === 'usd' ? collected.amount : collected.amount / (exchangeRate || 1)).toFixed(2),
      ),
      ...(collected.ref ? { ref: collected.ref } : {}),
    };
  }

  // ── 1. Stock + factura, en un solo batch ──
  const batch = writeBatch(db);

  if (devueltos.length) {
    const productos = await cargarProductos(devueltos.map(comoRef));
    batchRestoreStock(
      batch,
      devueltos.map((i) => ({ ...comoRef(i), branch: i.branch })),
      productos,
      invoice.branch || 'store',
    );
  }

  const cambios: Record<string, any> = {
    status,
    deliveryConfirmation: confirmacion,
  };

  // Solo la entrega parcial edita la compra. En la devolución entera los ítems
  // quedan como registro de lo que se intentó vender.
  if (!todoDevuelto) {
    cambios.items = quedados;
    cambios.total = totalNuevo;
  }

  batch.update(doc(db, 'invoices', invoice.id), cambios);
  await batch.commit();

  // ── 2. El cobro va después, para que addAbono lea el total YA ajustado ──
  // Así el saldo se calcula contra el total nuevo y el efectivo entra a la
  // gaveta por la misma vía que cualquier otro abono.
  if (confirmacion.collected) {
    await addAbono({
      invoiceId: invoice.id,
      invoice: { ...invoice, total: todoDevuelto ? (invoice.total ?? 0) : totalNuevo },
      amount: confirmacion.collected.amount,
      methodName: confirmacion.collected.method,
      ref: confirmacion.collected.ref,
      exchangeRate: exchangeRate || invoice.exchangeRate || 1,
      currentUser: courier,
    });
  }

  return { status, credito, totalNuevo };
}
