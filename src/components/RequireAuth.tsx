import { Navigate, useLocation } from 'react-router-dom';
import { useAppStore } from '@/store/appStore';
import { ROUTES } from '@/config/constants';

interface RequireAuthProps {
  children: React.ReactNode;
}

export function RequireAuth({ children }: RequireAuthProps) {
  const currentUser = useAppStore((s) => s.currentUser);
  const location = useLocation();

  if (!currentUser) {
    return <Navigate to={ROUTES.LOGIN} state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
