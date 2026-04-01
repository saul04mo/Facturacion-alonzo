export const ROUTES = {
  LOGIN: '/login',
  REGISTER: '/register',
  DASHBOARD: '/dashboard',
  POS: '/ventas',
  INVOICES: '/facturas',
  INVENTORY: '/inventario',
  CLIENTS: '/clientes',
  DELIVERY: '/delivery',
  REPORTS: '/informes',
  USERS: '/usuarios',
  SETTINGS: '/configuracion',
  OFFERS: '/ofertas',
  PAYROLL: '/nomina',
} as const;

export const ALL_PERMISSIONS = {
  canAccessVentas: 'Acceder a Ventas',
  canAccessInventario: 'Acceder a Inventario',
  canAccessClientes: 'Acceder a Clientes',
  canAccessDelivery: 'Acceder a Delivery',
  canAccessFacturas: 'Acceder a Facturas',
  canManageUsers: 'Gestionar Usuarios',
  canCreateProducts: 'Crear Productos',
  canEditProducts: 'Editar Productos',
  canDeleteProducts: 'Eliminar Productos',
  canCreateClients: 'Crear Clientes',
  canEditClients: 'Editar Clientes',
  canDeleteClients: 'Eliminar Clientes',
  canProcessReturns: 'Procesar Devoluciones',
  canEditInvoices: 'Editar Facturas',
  canApplyDiscounts: 'Aplicar Descuentos',
  canUpdateExchangeRate: 'Actualizar Tasa de Cambio',
  canConfirmDeliveryPayment: 'Confirmar Pago de Envío',
  canAddAbono: 'Añadir Abonos a Créditos',
  canAccessInformes: 'Acceder a Informes',
  canManageOffers: 'Gestionar Ofertas',
  canAccessNomina: 'Acceder a Nómina',
} as const;

export type PermissionKey = keyof typeof ALL_PERMISSIONS;

export const DEFAULT_PERMISSIONS: Record<string, Record<PermissionKey, boolean>> = {
  vendedor: {
    canAccessVentas: true, canAccessInventario: true, canAccessClientes: true,
    canAccessDelivery: false, canAccessFacturas: true, canManageUsers: false,
    canCreateProducts: false, canEditProducts: false, canDeleteProducts: false,
    canCreateClients: true, canEditClients: true, canDeleteClients: false,
    canProcessReturns: false, canEditInvoices: false, canApplyDiscounts: true,
    canUpdateExchangeRate: false, canConfirmDeliveryPayment: false, canAddAbono: false,
    canAccessInformes: false, canManageOffers: false, canAccessNomina: false,
  },
  administrador: Object.keys(ALL_PERMISSIONS).reduce(
    (acc, key) => ({ ...acc, [key]: true }), {} as Record<PermissionKey, boolean>,
  ),
};

export const DELIVERY_TYPES = [
  { value: 'showroom', label: 'Showroom' },
  { value: 'pickup', label: 'Retiro en Tienda' },
  { value: 'pick-up', label: 'Pick-Up' },
  { value: 'local', label: 'Delivery Local' },
  { value: 'national', label: 'Envío Nacional' },
  { value: 'web', label: 'Página Web' },
] as const;

export type Currency = 'usd' | 'ves';

export const MODULE_COLORS = {
  ventas: { bg: 'bg-blue-50', text: 'text-blue-600', border: 'border-blue-200', icon: 'text-blue-500' },
  facturas: { bg: 'bg-purple-50', text: 'text-purple-600', border: 'border-purple-200', icon: 'text-purple-500' },
  inventario: { bg: 'bg-amber-50', text: 'text-amber-600', border: 'border-amber-200', icon: 'text-amber-500' },
  clientes: { bg: 'bg-cyan-50', text: 'text-cyan-600', border: 'border-cyan-200', icon: 'text-cyan-500' },
  delivery: { bg: 'bg-green-50', text: 'text-green-600', border: 'border-green-200', icon: 'text-green-500' },
  informes: { bg: 'bg-rose-50', text: 'text-rose-600', border: 'border-rose-200', icon: 'text-rose-500' },
  usuarios: { bg: 'bg-indigo-50', text: 'text-indigo-600', border: 'border-indigo-200', icon: 'text-indigo-500' },
  ofertas: { bg: 'bg-pink-50', text: 'text-pink-600', border: 'border-pink-200', icon: 'text-pink-500' },
  configuracion: { bg: 'bg-slate-50', text: 'text-slate-600', border: 'border-slate-200', icon: 'text-slate-500' },
  nomina: { bg: 'bg-teal-50', text: 'text-teal-600', border: 'border-teal-200', icon: 'text-teal-500' },
} as const;
