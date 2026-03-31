import { useEffect, Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { OfflineBanner } from './OfflineBanner';
import { useFirestoreListeners } from '@/hooks/useFirestoreListeners';
import { useAppStore } from '@/store/appStore';

export function Layout() {
  useFirestoreListeners();
  const theme = useAppStore((s) => s.theme);
  const loading = useAppStore((s) => s.loading);
  const products = useAppStore((s) => s.products);
  const invoices = useAppStore((s) => s.invoices);

  // Apply dark class to <html> so all Tailwind dark: variants work
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  const isFirstLoad = loading.products && products.length === 0 && loading.invoices && invoices.length === 0;

  return (
    <div className="h-screen flex flex-col bg-page">
      <OfflineBanner />
      <Header />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar />

        <main className="flex-1 overflow-y-auto">
          <div className="max-w-7xl mx-auto p-4 md:p-6 lg:p-8">
            {isFirstLoad ? (
              <div className="flex flex-col items-center justify-center py-24 animate-fade-up">
                <div className="w-12 h-12 border-[3px] border-surface-200 dark:border-dark-300 border-t-navy-900 dark:border-t-blue-500 rounded-full animate-spin mb-5" />
                <p className="font-display font-semibold text-navy-700 dark:text-gray-200 text-sm">Cargando datos del sistema...</p>
                <p className="text-navy-400 dark:text-gray-500 text-xs mt-1.5 max-w-sm text-center">
                  Sincronizando productos, clientes y facturas.
                </p>
                <div className="flex gap-6 mt-6">
                  {[
                    { label: 'Productos', done: !loading.products },
                    { label: 'Clientes', done: !loading.clients },
                    { label: 'Facturas', done: !loading.invoices },
                    { label: 'Tasa', done: !loading.exchangeRate },
                  ].map((item) => (
                    <div key={item.label} className="flex items-center gap-2 text-xs">
                      {item.done ? (
                        <div className="w-4 h-4 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
                          <div className="w-2 h-2 rounded-full bg-emerald-500" />
                        </div>
                      ) : (
                        <div className="w-4 h-4 rounded-full border-2 border-surface-300 border-t-navy-500 dark:border-t-blue-500 animate-spin" />
                      )}
                      <span className={item.done ? 'text-emerald-600 dark:text-emerald-400 font-medium' : 'text-navy-400 dark:text-gray-500'}>
                        {item.label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <Suspense fallback={
                <div className="flex flex-col items-center justify-center py-24 animate-fade-in" style={{ animationDelay: '200ms', animationFillMode: 'both' }}>
                  <div className="w-8 h-8 rounded-full border-2 border-surface-300 border-t-navy-500 dark:border-t-blue-500 animate-spin" />
                </div>
              }>
                <Outlet />
              </Suspense>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
