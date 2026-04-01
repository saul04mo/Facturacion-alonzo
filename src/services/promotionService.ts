import {
  collection, doc, setDoc, updateDoc, deleteDoc, Timestamp, increment,
} from 'firebase/firestore';
import { db } from '@/config/firebase';
import type {
  Coupon, Promotion, Product, SaleItem, AppliedCoupon, AppliedPromotion,
} from '@/types';
import { calcDiscountAmount } from '@/utils/discountUtils';

// ================================================================
// COUPON CRUD
// ================================================================

export async function createCoupon(data: Omit<Coupon, 'id' | 'usedCount' | 'usageByClient' | 'createdAt'>): Promise<string> {
  const ref = doc(collection(db, 'coupons'));
  const coupon = {
    ...data,
    code: data.code.toUpperCase().trim(),
    usedCount: 0,
    usageByClient: {},
    createdAt: Timestamp.now(),
  };
  await setDoc(ref, coupon);
  return ref.id;
}

export async function updateCoupon(id: string, data: Partial<Coupon>): Promise<void> {
  const updates: any = { ...data };
  if (updates.code) updates.code = updates.code.toUpperCase().trim();
  delete updates.id;
  await updateDoc(doc(db, 'coupons', id), updates);
}

export async function deleteCoupon(id: string): Promise<void> {
  await deleteDoc(doc(db, 'coupons', id));
}

// ================================================================
// PROMOTION CRUD
// ================================================================

export async function createPromotion(data: Omit<Promotion, 'id' | 'createdAt'>): Promise<string> {
  const ref = doc(collection(db, 'promotions'));
  await setDoc(ref, { ...data, createdAt: Timestamp.now() });
  return ref.id;
}

export async function updatePromotion(id: string, data: Partial<Promotion>): Promise<void> {
  const updates: any = { ...data };
  delete updates.id;
  await updateDoc(doc(db, 'promotions', id), updates);
}

export async function deletePromotion(id: string): Promise<void> {
  await deleteDoc(doc(db, 'promotions', id));
}

// ================================================================
// COUPON VALIDATION & APPLICATION
// ================================================================

function isWithinDateRange(
  startsAt: Timestamp | null | undefined,
  expiresAt: Timestamp | null | undefined,
): boolean {
  const now = Date.now();
  if (startsAt && startsAt.toMillis() > now) return false;
  if (expiresAt && expiresAt.toMillis() < now) return false;
  return true;
}

export interface CouponValidation {
  valid: boolean;
  error?: string;
  coupon?: Coupon;
}

export function validateCoupon(
  code: string,
  coupons: Coupon[],
  subtotal: number,
  clientId: string | null,
  cartItems: SaleItem[],
  products: Product[],
): CouponValidation {
  const coupon = coupons.find((c) => c.code === code.toUpperCase().trim());
  if (!coupon) return { valid: false, error: 'Cupón no encontrado.' };
  if (!coupon.active) return { valid: false, error: 'Este cupón está desactivado.' };

  if (!isWithinDateRange(coupon.startsAt, coupon.expiresAt)) {
    return { valid: false, error: 'Este cupón ha expirado o aún no está vigente.' };
  }

  if (coupon.maxUsesTotal > 0 && coupon.usedCount >= coupon.maxUsesTotal) {
    return { valid: false, error: 'Este cupón ha alcanzado su límite de usos.' };
  }

  if (coupon.maxUsesPerClient > 0 && clientId) {
    const clientUses = coupon.usageByClient?.[clientId] || 0;
    if (clientUses >= coupon.maxUsesPerClient) {
      return { valid: false, error: 'Ya alcanzaste el límite de usos de este cupón.' };
    }
  }

  if (coupon.minPurchase > 0 && subtotal < coupon.minPurchase) {
    return { valid: false, error: `Compra mínima de $${coupon.minPurchase.toFixed(2)} requerida.` };
  }

  // Validate scope
  if (coupon.scope === 'category' && coupon.scopeTargets.length > 0) {
    const hasMatchingItem = cartItems.some((item) => {
      const product = products.find((p) => p.id === item.productId);
      return product && coupon.scopeTargets.includes(product.category);
    });
    if (!hasMatchingItem) {
      return { valid: false, error: `Este cupón solo aplica para: ${coupon.scopeTargets.join(', ')}.` };
    }
  }

  if (coupon.scope === 'product' && coupon.scopeTargets.length > 0) {
    const hasMatchingItem = cartItems.some((item) =>
      coupon.scopeTargets.includes(item.productId),
    );
    if (!hasMatchingItem) {
      return { valid: false, error: 'Ningún producto del carrito aplica para este cupón.' };
    }
  }

  return { valid: true, coupon };
}

export function calculateCouponDiscount(
  coupon: Coupon,
  subtotal: number,
  cartItems: SaleItem[],
  products: Product[],
): AppliedCoupon {
  let applicableTotal = subtotal;

  // If scope is category or product, only discount matching items
  if (coupon.scope === 'category' && coupon.scopeTargets.length > 0) {
    applicableTotal = cartItems.reduce((sum, item) => {
      const product = products.find((p) => p.id === item.productId);
      if (!product || !coupon.scopeTargets.includes(product.category)) return sum;
      const variant = product.variants[item.variantIndex];
      const lineTotal = (variant?.price || 0) * item.quantity;
      const itemDisc = calcDiscountAmount(lineTotal, item.discount);
      return sum + (lineTotal - itemDisc);
    }, 0);
  } else if (coupon.scope === 'product' && coupon.scopeTargets.length > 0) {
    applicableTotal = cartItems.reduce((sum, item) => {
      if (!coupon.scopeTargets.includes(item.productId)) return sum;
      const product = products.find((p) => p.id === item.productId);
      if (!product) return sum;
      const variant = product.variants[item.variantIndex];
      const lineTotal = (variant?.price || 0) * item.quantity;
      const itemDisc = calcDiscountAmount(lineTotal, item.discount);
      return sum + (lineTotal - itemDisc);
    }, 0);
  }

  let discountAmount = 0;
  if (coupon.discountType === 'percentage') {
    discountAmount = (applicableTotal * coupon.discountValue) / 100;
  } else {
    discountAmount = Math.min(coupon.discountValue, applicableTotal);
  }

  const desc = coupon.discountType === 'percentage'
    ? `${coupon.discountValue}% OFF`
    : `$${coupon.discountValue.toFixed(2)} OFF`;

  return {
    couponId: coupon.id,
    code: coupon.code,
    discountAmount: Math.round(discountAmount * 100) / 100,
    description: `Cupón ${coupon.code}: ${desc}`,
    freeShipping: coupon.freeShipping,
  };
}

/** Increment coupon usage after a successful sale */
export async function recordCouponUsage(couponId: string, clientId: string | null): Promise<void> {
  const ref = doc(db, 'coupons', couponId);
  const updates: any = { usedCount: increment(1) };
  if (clientId) {
    updates[`usageByClient.${clientId}`] = increment(1);
  }
  await updateDoc(ref, updates);
}

// ================================================================
// PROMOTION ENGINE (auto-applied)
// ================================================================

export function evaluatePromotions(
  promotions: Promotion[],
  cartItems: SaleItem[],
  products: Product[],
  subtotal: number,
  deliveryCost: number,
): AppliedPromotion[] {
  const applied: AppliedPromotion[] = [];

  const activePromos = promotions
    .filter((p) => p.active && isWithinDateRange(p.startsAt, p.expiresAt))
    .sort((a, b) => a.priority - b.priority);

  for (const promo of activePromos) {
    // Check if non-stackable and we already have one
    if (!promo.stackable && applied.length > 0) continue;

    const result = evaluateSinglePromotion(promo, cartItems, products, subtotal, deliveryCost);
    if (result) applied.push(result);
  }

  return applied;
}

function evaluateSinglePromotion(
  promo: Promotion,
  cartItems: SaleItem[],
  products: Product[],
  subtotal: number,
  deliveryCost: number,
): AppliedPromotion | null {
  switch (promo.type) {
    case 'nxm':
      return evaluateNxM(promo, cartItems, products);
    case 'volume_discount':
      return evaluateVolumeDiscount(promo, cartItems, products);
    case 'min_purchase':
      return evaluateMinPurchase(promo, subtotal);
    case 'free_shipping':
      return evaluateFreeShipping(promo, subtotal, deliveryCost);
    case 'bundle':
      return evaluateBundle(promo, cartItems, products);
    default:
      return null;
  }
}

function getTargetItems(promo: Promotion, cartItems: SaleItem[], products: Product[]): SaleItem[] {
  if (promo.scope === 'global') return cartItems;
  if (promo.scope === 'category') {
    return cartItems.filter((item) => {
      const product = products.find((p) => p.id === item.productId);
      return product && promo.scopeTargets.includes(product.category);
    });
  }
  if (promo.scope === 'product') {
    return cartItems.filter((item) => promo.scopeTargets.includes(item.productId));
  }
  return [];
}

function evaluateNxM(promo: Promotion, cartItems: SaleItem[], products: Product[]): AppliedPromotion | null {
  const targets = getTargetItems(promo, cartItems, products);
  if (targets.length === 0) return null;

  const totalQty = targets.reduce((sum, i) => sum + i.quantity, 0);
  if (totalQty < promo.buyQty) return null;

  // Collect all item prices (expanded by quantity), sorted ascending
  const prices: number[] = [];
  for (const item of targets) {
    const product = products.find((p) => p.id === item.productId);
    if (!product) continue;
    const variant = product.variants[item.variantIndex];
    if (!variant) continue;
    for (let i = 0; i < item.quantity; i++) {
      prices.push(variant.price);
    }
  }
  prices.sort((a, b) => a - b); // cheapest first

  // For every group of `buyQty`, the cheapest `buyQty - payQty` items are free
  const freePerGroup = promo.buyQty - promo.payQty;
  const fullGroups = Math.floor(prices.length / promo.buyQty);
  let totalDiscount = 0;

  for (let g = 0; g < fullGroups; g++) {
    const groupStart = g * promo.buyQty;
    for (let f = 0; f < freePerGroup; f++) {
      totalDiscount += prices[groupStart + f];
    }
  }

  if (totalDiscount <= 0) return null;

  const label = promo.buyQty === 2 && promo.payQty === 1 ? '2x1'
    : promo.buyQty === 3 && promo.payQty === 2 ? '3x2'
    : `${promo.buyQty}x${promo.payQty}`;

  return {
    promotionId: promo.id,
    name: promo.name,
    type: 'nxm',
    discountAmount: Math.round(totalDiscount * 100) / 100,
    description: `Promo ${label}: ${fullGroups} grupo(s) — ahorras $${totalDiscount.toFixed(2)}`,
  };
}

function evaluateVolumeDiscount(promo: Promotion, cartItems: SaleItem[], products: Product[]): AppliedPromotion | null {
  const targets = getTargetItems(promo, cartItems, products);
  const totalQty = targets.reduce((sum, i) => sum + i.quantity, 0);
  if (totalQty < promo.minUnits) return null;

  let targetSubtotal = 0;
  for (const item of targets) {
    const product = products.find((p) => p.id === item.productId);
    if (!product) continue;
    const variant = product.variants[item.variantIndex];
    if (!variant) continue;
    const lineTotal = variant.price * item.quantity;
    const itemDisc = calcDiscountAmount(lineTotal, item.discount);
    targetSubtotal += lineTotal - itemDisc;
  }

  let discountAmount = 0;
  if (promo.discountType === 'percentage') {
    discountAmount = (targetSubtotal * promo.discountValue) / 100;
  } else {
    discountAmount = Math.min(promo.discountValue, targetSubtotal);
  }

  if (discountAmount <= 0) return null;

  return {
    promotionId: promo.id,
    name: promo.name,
    type: 'volume_discount',
    discountAmount: Math.round(discountAmount * 100) / 100,
    description: `${promo.name}: ${promo.discountValue}${promo.discountType === 'percentage' ? '%' : '$'} OFF por llevar ${totalQty} unidades`,
  };
}

function evaluateMinPurchase(promo: Promotion, subtotal: number): AppliedPromotion | null {
  if (subtotal < promo.minPurchase) return null;

  let discountAmount = 0;
  if (promo.discountType === 'percentage') {
    discountAmount = (subtotal * promo.discountValue) / 100;
  } else {
    discountAmount = Math.min(promo.discountValue, subtotal);
  }

  if (discountAmount <= 0) return null;

  return {
    promotionId: promo.id,
    name: promo.name,
    type: 'min_purchase',
    discountAmount: Math.round(discountAmount * 100) / 100,
    description: `${promo.name}: ${promo.discountValue}${promo.discountType === 'percentage' ? '%' : '$'} OFF por compra mayor a $${promo.minPurchase}`,
  };
}

function evaluateFreeShipping(promo: Promotion, subtotal: number, deliveryCost: number): AppliedPromotion | null {
  if (subtotal < promo.minPurchase || deliveryCost <= 0) return null;

  return {
    promotionId: promo.id,
    name: promo.name,
    type: 'free_shipping',
    discountAmount: deliveryCost,
    description: `${promo.name}: ¡Envío gratis!`,
  };
}

function evaluateBundle(promo: Promotion, cartItems: SaleItem[], products: Product[]): AppliedPromotion | null {
  if (promo.bundleProductIds.length < 2) return null;

  // Check all bundle products are in cart
  const allPresent = promo.bundleProductIds.every((pid) =>
    cartItems.some((item) => item.productId === pid),
  );
  if (!allPresent) return null;

  // Calculate discount on the bundle items
  let bundleTotal = 0;
  for (const pid of promo.bundleProductIds) {
    const item = cartItems.find((i) => i.productId === pid);
    if (!item) continue;
    const product = products.find((p) => p.id === pid);
    if (!product) continue;
    const variant = product.variants[item.variantIndex];
    if (!variant) continue;
    bundleTotal += variant.price * item.quantity;
  }

  let discountAmount = 0;
  if (promo.discountType === 'percentage') {
    discountAmount = (bundleTotal * promo.discountValue) / 100;
  } else {
    discountAmount = Math.min(promo.discountValue, bundleTotal);
  }

  if (discountAmount <= 0) return null;

  return {
    promotionId: promo.id,
    name: promo.name,
    type: 'bundle',
    discountAmount: Math.round(discountAmount * 100) / 100,
    description: `${promo.name}: ${promo.discountValue}${promo.discountType === 'percentage' ? '%' : '$'} OFF en combo`,
  };
}
