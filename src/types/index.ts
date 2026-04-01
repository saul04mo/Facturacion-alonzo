import type { Timestamp } from 'firebase/firestore';
import type { PermissionKey } from '@/config/constants';

// ================================
// User
// ================================
export interface AppUser {
  id: string;
  uid: string;
  nombre: string;
  apellido: string;
  cedula: string;
  phone: string;
  correo: string;
  rol: 'administrador' | 'vendedor';
  permissions: Record<PermissionKey, boolean>;
}

// ================================
// Product & Variants
// ================================
export interface ProductVariant {
  color: string;
  size: string;
  stock: number;
  price: number;
  barcode?: string;
}

export interface Product {
  id: string;
  name: string;
  category: string;
  gender: 'Hombre' | 'Mujer';
  imageUrl?: string;
  variants: ProductVariant[];
  offer?: {
    type: 'percentage' | 'fixed';
    value: number;
  };
}

// ================================
// Client
// ================================
export interface Client {
  id: string;
  name: string;
  rif_ci: string;
  phone: string;
  email?: string;
  address?: string;
  // Legacy fields (read-only, for backward compat with old Firestore docs)
  nombre?: string;
  apellido?: string;
  cedula?: string;
  direccion?: string;
}

/**
 * Normalize a Firestore client doc (which may use old or new field names)
 * into a consistent Client shape.
 */
export function normalizeClient(raw: Record<string, any>): Client {
  return {
    id: raw.id,
    name: raw.name || [raw.nombre, raw.apellido].filter(Boolean).join(' ') || 'Sin Nombre',
    rif_ci: raw.rif_ci || raw.cedula || '',
    phone: raw.phone || raw.telefono || '',
    email: raw.email || raw.correo || '',
    address: raw.address || raw.direccion || '',
  };
}

// ================================
// Sale / Cart
// ================================
export interface Discount {
  type: 'none' | 'percentage' | 'fixed';
  value: number;
}

export interface SaleItem {
  productId: string;
  variantIndex: number;
  quantity: number;
  discount: Discount;
}

export type DeliveryType = 'showroom' | 'pickup' | 'pick-up' | 'local' | 'national' | 'web';

export interface CurrentSale {
  items: SaleItem[];
  clientId: string | null;
  total: number;
  payments: Payment[];
  totalDiscount: Discount;
  deliveryType: DeliveryType;
  deliveryCostUsd: number;
  deliveryPaidInStore: boolean;
  observation: string | null;
  // ── Promotions & Coupons ──
  appliedCoupon: AppliedCoupon | null;
  appliedPromotions: AppliedPromotion[];
}

// ================================
// Payment
// ================================
export interface Payment {
  method: string;
  amountVes: number;
  amountUsd: number;
  ref?: string;
}

// ================================
// Invoice (matches Firestore shape)
// ================================
export interface InvoiceItem {
  productId: string;
  variantIndex: number;
  quantity: number;
  discount: Discount;
  /** Price at time of sale (USD). Added in v2.1 — older invoices may not have this. */
  priceAtSale: number;
  /** Product name snapshot. */
  productName: string;
  /** Variant description snapshot. */
  variantLabel: string;
}

export interface ClientSnapshot {
  name: string;
  rif_ci: string;
  phone: string;
  address: string;
}

export type InvoiceStatus = 'Finalizado' | 'Pendiente de pago' | 'Devolución' | 'Cancelado' | 'Creada';

export interface Invoice {
  id: string;
  numericId: number;
  items: InvoiceItem[];
  clientId: string | null;
  clientSnapshot: ClientSnapshot | null;
  total: number;
  totalDiscount: Discount;
  payments: Payment[];
  deliveryType: DeliveryType;
  deliveryCostUsd: number;
  deliveryPaidInStore: boolean;
  observation: string | null;
  sellerName: string;
  sellerUid: string;
  exchangeRate: number;
  status: InvoiceStatus;
  date: Timestamp;
  abonos: Abono[];
  // ── Promo / Coupon audit trail ──
  appliedCoupon?: AppliedCoupon | null;
  appliedPromotions?: AppliedPromotion[];
  returnDetails?: {
    reason: string;
    details: string | null;
    date: Timestamp;
    processedBy: string;
  };
}

export interface Abono {
  amountVes: number;
  amountUsd: number;
  method: string;
  ref?: string;
  date: Timestamp;
}

// ================================
// Coupon
// ================================
export type CouponScope = 'global' | 'category' | 'product';
export type CouponDiscountType = 'percentage' | 'fixed';

export interface Coupon {
  id: string;
  code: string;                    // Código que ingresa el cliente (uppercase, sin espacios)
  description: string;
  discountType: CouponDiscountType;
  discountValue: number;           // % o monto fijo en USD
  scope: CouponScope;
  /** IDs de categorías o productos según el scope */
  scopeTargets: string[];
  minPurchase: number;             // Monto mínimo de compra en USD (0 = sin mínimo)
  maxUsesTotal: number;            // Usos totales permitidos (0 = ilimitados)
  maxUsesPerClient: number;        // Usos por cliente (0 = ilimitados)
  usedCount: number;               // Contador global de usos
  /** Map de clientId -> cantidad de usos */
  usageByClient: Record<string, number>;
  active: boolean;
  startsAt: import('firebase/firestore').Timestamp | null;
  expiresAt: import('firebase/firestore').Timestamp | null;
  createdAt: import('firebase/firestore').Timestamp;
  freeShipping: boolean;           // Si aplica envío gratis además del descuento
}

// ================================
// Promotion (auto-applied rules)
// ================================
export type PromotionType =
  | 'nxm'              // Compra N, paga M (ej: 2x1, 3x2)
  | 'volume_discount'  // Compra X+ unidades y obtén Y% de descuento
  | 'min_purchase'     // Gasta $X+ y obtén Y% de descuento en el total
  | 'free_shipping'    // Envío gratis si el total >= X
  | 'bundle';          // Compra producto A + B y obtén X% de descuento

export interface Promotion {
  id: string;
  name: string;
  description: string;
  type: PromotionType;
  active: boolean;
  priority: number;            // Menor = se evalúa primero
  /** Scope: 'global', o IDs de categorías/productos */
  scope: CouponScope;
  scopeTargets: string[];
  // ── Parámetros según el tipo ──
  /** NxM: compra `buyQty`, paga `payQty` */
  buyQty: number;
  payQty: number;
  /** Volume: mínimo de unidades para activar */
  minUnits: number;
  /** Volume / MinPurchase: % o monto de descuento */
  discountType: CouponDiscountType;
  discountValue: number;
  /** MinPurchase / FreeShipping: monto mínimo en USD */
  minPurchase: number;
  /** Bundle: IDs de productos que deben estar en el carrito */
  bundleProductIds: string[];
  // ── Vigencia ──
  startsAt: import('firebase/firestore').Timestamp | null;
  expiresAt: import('firebase/firestore').Timestamp | null;
  createdAt: import('firebase/firestore').Timestamp;
  stackable: boolean;          // ¿Se puede combinar con cupones/otros?
}

// ================================
// Applied Promotion Result (para el carrito)
// ================================
export interface AppliedPromotion {
  promotionId: string;
  name: string;
  type: PromotionType;
  discountAmount: number;       // Monto ahorrado en USD
  description: string;          // Texto legible para mostrar al usuario
}

export interface AppliedCoupon {
  couponId: string;
  code: string;
  discountAmount: number;
  description: string;
  freeShipping: boolean;
}

// ================================
// Employee (HR)
// ================================
export interface Employee {
  id: string;
  nombre: string;
  apellido: string;
  cedula: string;
  phone: string;
  email: string;
  direccion: string;
  fechaNacimiento: string;
  cargo: string;
  departamento: string;
  fechaIngreso: string;
  fechaEgreso?: string;
  tipoContrato: 'fijo' | 'temporal' | 'pasante';
  jornadaLaboral: 'diurna' | 'mixta' | 'nocturna';
  estado: 'activo' | 'reposo' | 'vacaciones' | 'egresado';
  salarioBaseVed: number;
  bonificacionUsd: number;
  cuentaBancaria?: string;
  banco?: string;
  numIvss?: string;
}

// ================================
// Payroll Period
// ================================
export interface PayrollPeriod {
  id: string;
  tipo: 'semanal' | 'quincenal' | 'mensual';
  fechaInicio: string;
  fechaFin: string;
  estado: 'borrador' | 'calculado' | 'aprobado' | 'pagado';
  tasaBcv: number;
  salarioMinimoVed: number;
  cestaticketDiario: number;
  lunesDelMes: number;
  totalAsignaciones: number;
  totalDeducciones: number;
  totalNeto: number;
  creadoPor: string;
  fecha: Timestamp;
}

// ================================
// Payroll Receipt
// ================================
export interface PayrollReceipt {
  id: string;
  periodId: string;
  employeeId: string;
  employeeName: string;
  employeeCedula: string;
  employeeCargo: string;
  fechaIngreso: string;
  departamento: string;
  salarioBase: number;
  cestaticket: number;
  horasExtrasDiurnas: number;
  horasExtrasNocturnas: number;
  bonoNocturno: number;
  feriadosTrabajados: number;
  bonoVacacional: number;
  utilidades: number;
  bonificacionUsd: number;
  otrasAsignaciones: number;
  totalAsignaciones: number;
  ivss: number;
  faov: number;
  rpe: number;
  inces: number;
  otrasDeducciones: number;
  totalDeducciones: number;
  netoAPagar: number;
  netoUsd: number;
  tasaBcv: number;
  estado: 'generado' | 'pagado';
  fecha: Timestamp;
}

// ================================
// Employee Incident
// ================================
export type IncidentType = 'falta' | 'hora_extra_diurna' | 'hora_extra_nocturna' | 'reposo' |
  'feriado_trabajado' | 'bono_nocturno' | 'permiso';

export interface EmployeeIncident {
  id: string;
  employeeId: string;
  tipo: IncidentType;
  fecha: string;
  cantidad: number;
  observacion?: string;
  creadoPor: string;
  fechaCreacion: Timestamp;
}
