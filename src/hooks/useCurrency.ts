import { useAppStore } from '@/store/appStore';

/**
 * Hook for currency formatting and conversion.
 * Replaces the old `formatCurrency()` function and currency toggle logic.
 */
export function useCurrency() {
  const exchangeRate = useAppStore((s) => s.exchangeRate);
  const displayCurrency = useAppStore((s) => s.displayCurrency);
  const toggleCurrency = useAppStore((s) => s.toggleCurrency);
  const setCurrency = useAppStore((s) => s.setCurrency);

  /** Format a USD amount according to current display currency */
  function format(amountInUsd: number): string {
    if (displayCurrency === 'ves') {
      return `Bs. ${(amountInUsd * exchangeRate).toFixed(2)}`;
    }
    return `$ ${amountInUsd.toFixed(2)}`;
  }

  /** Convert USD to VES */
  function toVes(usd: number): number {
    return usd * exchangeRate;
  }

  /** Get both formatted values */
  function formatBoth(amountInUsd: number) {
    return {
      usd: `$ ${amountInUsd.toFixed(2)}`,
      ves: `Bs. ${(amountInUsd * exchangeRate).toFixed(2)}`,
    };
  }

  return {
    exchangeRate,
    displayCurrency,
    toggleCurrency,
    setCurrency,
    format,
    toVes,
    formatBoth,
  };
}
