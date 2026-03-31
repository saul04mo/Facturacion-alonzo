import type { Discount } from '@/types';

/**
 * Calculate discount amount from a line total.
 * Single source of truth — used by POS, Invoices, Reports, and Receipts.
 */
export function calcDiscountAmount(lineTotal: number, discount: Discount | undefined | null): number {
  if (!discount || discount.type === 'none' || !discount.value) return 0;
  if (discount.type === 'percentage') return (lineTotal * discount.value) / 100;
  if (discount.type === 'fixed') return Math.min(discount.value, lineTotal);
  return 0;
}

/**
 * Apply discount to a line total and return the final amount.
 */
export function applyDiscount(lineTotal: number, discount: Discount | undefined | null): number {
  return Math.max(0, lineTotal - calcDiscountAmount(lineTotal, discount));
}
