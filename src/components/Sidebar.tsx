import { NavLink, useLocation } from 'react-router-dom';
import { useAppStore } from '@/store/appStore';
import { usePermissions } from '@/hooks/usePermissions';
import { ROUTES } from '@/config/constants';
import type { PermissionKey } from '@/config/constants';
import { ShoppingCart, FileText, Package, Users, Truck, BarChart3, Shield, Settings, X, Tag, Wallet, LayoutDashboard, Crown, ChevronLeft, ChevronRight } from 'lucide-react';

const NAV_GROUPS = [
  {
    title: 'PRINCIPAL',
    items: [
      { path: ROUTES.DASHBOARD, label: 'Dashboard', icon: <LayoutDashboard size={18} />, permission: 'canAccessDashboard' },
      { path: ROUTES.POS, label: 'Ventas', icon: <ShoppingCart size={18} />, permission: 'canAccessVentas' },
      { path: ROUTES.INVOICES, label: 'Facturas', icon: <FileText size={18} />, permission: 'canAccessFacturas' },
      { path: ROUTES.CLIENTS, label: 'Clientes', icon: <Users size={18} />, permission: 'canAccessClientes' },
      { path: ROUTES.CRM, label: 'CRM Marketing', icon: <Crown size={18} />, permission: 'canAccessCRM' },
      { path: ROUTES.DELIVERY, label: 'Delivery', icon: <Truck size={18} />, permission: 'canAccessDelivery' },
      { path: ROUTES.INVENTORY, label: 'Inventario', icon: <Package size={18} />, permission: 'canAccessInventario' },
      { path: ROUTES.OFFERS, label: 'Ofertas', icon: <Tag size={18} />, permission: 'canManageOffers' },
    ]
  },
  {
    title: 'REPORTES',
    items: [
      { path: ROUTES.REPORTS, label: 'Informes', icon: <BarChart3 size={18} />, permission: 'canAccessInformes' },
    ]
  },
  {
    title: 'CONFIGURACIÓN',
    items: [
      { path: ROUTES.USERS, label: 'Usuarios', icon: <Shield size={18} />, permission: 'canManageUsers' },
      { path: ROUTES.PAYROLL, label: 'Nómina', icon: <Wallet size={18} />, permission: 'canAccessNomina' },
      { path: ROUTES.SETTINGS, label: 'Configuración General', icon: <Settings size={18} />, permission: 'canAccessSettings' },
    ]
  }
];

export function Sidebar() {
  const { can, isAdmin } = usePermissions();
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  const collapsed = useAppStore((s) => s.sidebarCollapsed);
  const toggleCollapsed = useAppStore((s) => s.toggleSidebarCollapsed);
  const location = useLocation();

  function NavLinkItem({ path, icon, label, permission, adminOnly }: { path: string, icon: React.ReactNode, label: string, permission: PermissionKey, adminOnly?: boolean }) {
    if (!can(permission)) return null;
    if (adminOnly && !isAdmin) return null;
    const isActive = location.pathname === path;
    return (
      <NavLink to={path} onClick={() => setSidebarOpen(false)}
        title={collapsed ? label : undefined}
        className={`relative group flex items-center gap-3 ${collapsed ? 'md:justify-center md:px-2' : 'px-3'} py-2.5 rounded-xl text-sm font-display font-medium transition-all duration-200 overflow-hidden hover-lift
          ${isActive 
            ? 'bg-surface-100 text-navy-900 shadow-[inset_0_1px_3px_rgba(0,0,0,0.02)] dark:bg-dark-200 dark:text-gray-100' 
            : 'text-navy-500 dark:text-gray-400 hover:bg-surface-50 dark:hover:bg-dark-200 hover:text-navy-800 dark:hover:text-gray-200'}`}>
        
        {isActive && (
          <div className="absolute left-0 top-[12%] bottom-[12%] w-1.5 bg-blue-500 rounded-r-md" />
        )}
        
        <span className={`flex-shrink-0 transition-colors ${isActive ? 'text-blue-600 dark:text-blue-400' : 'text-navy-400 dark:text-gray-500 group-hover:text-navy-600 dark:group-hover:text-gray-300'}`}>
          {icon}
        </span>
        {/* Label oculto cuando colapsado en desktop, siempre visible en mobile */}
        <span className={`whitespace-nowrap z-10 ${collapsed ? 'md:hidden' : ''}`}>{label}</span>

        {/* Tooltip flotante cuando colapsado (sólo desktop, hover) */}
        {collapsed && (
          <span className="hidden md:group-hover:block absolute left-full ml-2 top-1/2 -translate-y-1/2 px-2 py-1 bg-navy-900 dark:bg-dark-300 text-white text-xs rounded shadow-lg whitespace-nowrap z-50 pointer-events-none">
            {label}
          </span>
        )}
      </NavLink>
    );
  }

  // Anchos según estado
  const desktopWidth = collapsed ? 'md:w-[68px]' : 'md:w-56';

  return (
    <>
      {sidebarOpen && <div className="fixed inset-0 bg-navy-950/20 dark:bg-black/40 backdrop-blur-sm z-40 md:hidden animate-fade-in" onClick={() => setSidebarOpen(false)} />}
      <aside className={`z-50 flex flex-col bg-white border-r border-surface-200 transition-all duration-300
        md:relative md:flex-shrink-0 fixed top-0 left-0 bottom-0
        ${sidebarOpen ? 'w-64 shadow-modal dark:shadow-modal-dark' : 'w-0 overflow-hidden'} ${desktopWidth} md:overflow-visible md:shadow-none`}>
        
        {/* Header Logo Area */}
        <div className={`flex items-center ${collapsed ? 'md:justify-center' : 'justify-between'} p-4 border-b border-surface-200`}>
          <div className="flex items-center gap-2">
            <div className="bg-blue-500 text-white p-1.5 rounded-lg shadow-sm flex-shrink-0">
              <ShoppingCart size={18} />
            </div>
            {/* Brand text — oculto en desktop colapsado */}
            <span className={`font-display font-bold text-navy-900 dark:text-gray-100 text-[15px] ${collapsed ? 'md:hidden' : ''}`}>W-Pro Ventas</span>
          </div>
          {/* Close button — solo mobile */}
          <button onClick={() => setSidebarOpen(false)} className="md:hidden btn-ghost p-1.5"><X size={18} /></button>
        </div>

        {/* Navigation Wrapper */}
        <nav className="flex flex-col gap-4 p-3 flex-1 overflow-y-auto custom-scrollbar">
          {NAV_GROUPS.map((group) => {
            const visibleItemsInGroup = group.items.filter(item => {
              if (!can(item.permission as PermissionKey)) return false;
              if ((item as any).adminOnly && !isAdmin) return false;
              return true;
            });
            if (visibleItemsInGroup.length === 0) return null;
            
            return (
              <div key={group.title} className="flex flex-col gap-1">
                {/* Título de grupo — oculto cuando colapsado en desktop */}
                <p className={`px-3 py-1 text-[10px] font-display font-bold text-navy-300 dark:text-gray-500 uppercase tracking-wider ${collapsed ? 'md:hidden' : ''}`}>
                  {group.title}
                </p>
                {/* Separador alternativo cuando colapsado: línea sutil entre grupos */}
                {collapsed && (
                  <div className="hidden md:block mx-3 my-1 border-t border-surface-200 dark:border-dark-300" />
                )}
                {visibleItemsInGroup.map((item) => (
                  <NavLinkItem key={item.path} {...item} permission={item.permission as PermissionKey} />
                ))}
              </div>
            );
          })}
        </nav>

        {/* Bottom Area */}
        <div className="p-3 border-t border-surface-200 mt-auto flex items-center justify-between gap-2">
          {/* Versión — oculta cuando colapsado */}
          <p className={`hidden md:block px-2 text-[10px] text-navy-300 dark:text-gray-600 font-display ${collapsed ? 'md:hidden' : ''}`}>
            POS Alonzo v2.0
          </p>
          {/* Botón colapsar/expandir — solo desktop */}
          <button
            onClick={toggleCollapsed}
            title={collapsed ? 'Expandir menú' : 'Colapsar menú'}
            className="hidden md:flex items-center justify-center w-8 h-8 rounded-lg text-navy-400 dark:text-gray-500 hover:bg-surface-100 dark:hover:bg-dark-300 hover:text-navy-700 dark:hover:text-gray-300 transition-colors ml-auto"
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </div>
      </aside>
    </>
  );
}
