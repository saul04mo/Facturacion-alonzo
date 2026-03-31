import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { WifiOff } from 'lucide-react';

export function OfflineBanner() {
  const isOnline = useOnlineStatus();

  return (
    <div
      className={`
        fixed top-0 left-0 right-0 z-[9999]
        bg-amber-50 dark:bg-amber-900/30 border-b border-amber-200 dark:border-amber-800/40
        text-amber-800 dark:text-amber-300 text-center text-sm font-display font-medium
        py-2 px-4
        flex items-center justify-center gap-2
        transition-transform duration-300 ease-out
        ${isOnline ? '-translate-y-full' : 'translate-y-0'}
      `}
    >
      <WifiOff size={14} />
      Sin conexión a Internet
    </div>
  );
}
