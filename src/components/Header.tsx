import { useState, useEffect } from 'react';
import { useAppStore } from '@/store/appStore';
import { useAuth } from '@/modules/auth/useAuth';
import { useToast } from './Toast';
import { CurrencyToggle } from './CurrencyToggle';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { currentTimeVE } from '@/utils/dateUtils';
import { LogOut, Menu, CircleDot, Moon, Sun, Clock, RefreshCw } from 'lucide-react';

export function Header() {
  const currentUser = useAppStore((s) => s.currentUser);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const theme = useAppStore((s) => s.theme);
  const toggleTheme = useAppStore((s) => s.toggleTheme);
  const { logout } = useAuth();
  const isOnline = useOnlineStatus();
  const toast = useToast();

  const [time, setTime] = useState(currentTimeVE());
  useEffect(() => {
    const interval = setInterval(() => setTime(currentTimeVE()), 30000);
    return () => clearInterval(interval);
  }, []);

  const displayName = currentUser ? `${currentUser.nombre} ${currentUser.apellido}` : '';
  const initials = currentUser ? `${currentUser.nombre.charAt(0)}${currentUser.apellido.charAt(0)}` : '';

  async function handleClearCache() {
    if (!window.confirm('¿Forzar sincronización de base de datos? Esto limpiará la memoria caché local y recargará la página.')) return;
    try {
      const databases = await window.indexedDB.databases();
      for (const dbInfo of databases) {
        if (dbInfo.name && !dbInfo.name.includes('firebaseLocalStorage')) {
          window.indexedDB.deleteDatabase(dbInfo.name);
        }
      }
      window.location.reload();
    } catch (err) {
      console.error(err);
      toast.error('Error limpiando caché local. Intenta borrar los datos del navegador manualmente.');
    }
  }

  return (
    <header className="flex items-center justify-between px-4 py-3 bg-white border-b border-surface-200 shadow-nav z-20">
      <div className="flex items-center gap-3">
        <button onClick={toggleSidebar} className="md:hidden btn-ghost p-2" aria-label="Menú"><Menu size={20} /></button>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 md:w-9 md:h-9 rounded-lg bg-navy-900 dark:bg-blue-600 flex items-center justify-center overflow-hidden">
            <img src="/images/Alonzo.JPG" alt="Logo" className="w-full h-full object-cover"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; (e.target as HTMLImageElement).parentElement!.innerHTML = '<span class="text-white font-display font-bold text-sm">A</span>'; }} />
          </div>
          <h1 className="text-base font-display font-bold text-navy-900 dark:text-gray-100 hidden sm:block">POS Alonzo</h1>
        </div>
        <div className="hidden sm:block h-6 w-px bg-surface-200 mx-1" />
        <CurrencyToggle />
      </div>

      <div className="flex items-center gap-3">
        {/* Venezuela time */}
        <div className="hidden lg:flex items-center gap-1.5 text-xs font-mono text-navy-400 dark:text-gray-500">
          <Clock size={12} />
          <span>{time}</span>
          <span className="text-[9px] text-navy-300 dark:text-gray-600">VET</span>
        </div>

        {/* Status */}
        <div className="hidden md:flex items-center gap-1.5 text-xs font-display">
          <CircleDot size={12} className={isOnline ? 'text-emerald-500' : 'text-amber-400'} />
          <span className={isOnline ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>
            {isOnline ? 'Activo' : 'Offline'}
          </span>
        </div>

        <div className="hidden md:block h-6 w-px bg-surface-200" />

        {/* Theme toggle */}
        <button onClick={toggleTheme}
          className="btn-ghost p-2 text-navy-400 dark:text-gray-400"
          title={theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}>
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>

        {/* Clear Cache */}
        <button onClick={handleClearCache}
          className="btn-ghost p-2 text-navy-400 dark:text-gray-400 hover:text-blue-600"
          title="Sincronizar Datos (Limpiar Caché)">
          <RefreshCw size={18} />
        </button>

        {/* User */}
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-navy-100 flex items-center justify-center">
            <span className="text-xs font-display font-bold text-navy-700 dark:text-gray-300">{initials}</span>
          </div>
          <div className="hidden md:block">
            <p className="text-sm font-display font-semibold text-navy-900 dark:text-gray-100 leading-tight">{displayName}</p>
            <p className="text-xs text-navy-400 dark:text-gray-500 leading-tight capitalize">{currentUser?.rol}</p>
          </div>
        </div>

        <button onClick={logout} className="btn-ghost p-2 text-navy-400 dark:text-gray-400 hover:text-accent-red" title="Cerrar Sesión">
          <LogOut size={18} />
        </button>
      </div>
    </header>
  );
}
