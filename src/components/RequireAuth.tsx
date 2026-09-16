import { Navigate, useLocation } from 'react-router-dom';
import { useAppStore } from '@/store/appStore';
import { ROUTES } from '@/config/constants';

interface RequireAuthProps {
  children: React.ReactNode;
  /**
   * Marca la vista del repartidor. Sirve para las dos direcciones: un
   * repartidor solo puede estar acá, y solo quien tenga el permiso puede
   * entrar desde afuera.
   */
  courierOnly?: boolean;
}

export function RequireAuth({ children, courierOnly = false }: RequireAuthProps) {
  const currentUser = useAppStore((s) => s.currentUser);
  const location = useLocation();

  if (!currentUser) {
    return <Navigate to={ROUTES.LOGIN} state={{ from: location }} replace />;
  }

  const esRepartidor = currentUser.rol === 'delivery';

  // El repartidor no existe fuera de su vista. Se redirige en vez de mostrar
  // un error: al loguearse cae en /facturas y tiene que rebotar solo.
  if (esRepartidor && !courierOnly) {
    return <Navigate to={ROUTES.COURIER} replace />;
  }

  // Al revés: un vendedor cualquiera no entra a la vista de entregas. Los
  // administradores sí, para poder ver lo mismo que ve el repartidor.
  if (courierOnly && !esRepartidor) {
    const permitido =
      currentUser.rol === 'administrador' || currentUser.permissions?.canConfirmHandoff === true;
    if (!permitido) return <Navigate to={ROUTES.INVOICES} replace />;
  }

  return <>{children}</>;
}
