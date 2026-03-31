import { useAppStore } from '@/store/appStore';
import type { Currency } from '@/config/constants';

export function CurrencyToggle() {
  const displayCurrency = useAppStore((s) => s.displayCurrency);
  const setCurrency = useAppStore((s) => s.setCurrency);

  const options: { value: Currency; label: string }[] = [
    { value: 'usd', label: 'USD' },
    { value: 'ves', label: 'VES' },
  ];

  return (
    <div className="flex bg-surface-100 dark:bg-dark-200 border border-surface-200 dark:border-dark-border rounded-lg p-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => setCurrency(opt.value)}
          className={`
            px-3 py-1.5 rounded-md text-xs font-display font-semibold
            transition-all duration-200
            ${displayCurrency === opt.value
              ? 'bg-navy-900 dark:bg-blue-600 text-white shadow-sm'
              : 'text-navy-400 dark:text-gray-500 hover:text-navy-700 dark:hover:text-gray-300'
            }
          `}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
