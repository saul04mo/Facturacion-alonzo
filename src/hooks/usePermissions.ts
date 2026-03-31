import { useAppStore } from '@/store/appStore';
import { DEFAULT_PERMISSIONS, type PermissionKey } from '@/config/constants';

/**
 * Hook for checking user permissions.
 * Replaces the old `applyPermissions()` function.
 */
export function usePermissions() {
  const currentUser = useAppStore((s) => s.currentUser);

  const permissions = currentUser?.permissions ??
    (currentUser?.rol === 'administrador'
      ? DEFAULT_PERMISSIONS.administrador
      : DEFAULT_PERMISSIONS.vendedor);

  function can(permission: PermissionKey): boolean {
    if (!currentUser) return false;
    if (currentUser.rol === 'administrador') return true;
    return permissions?.[permission] ?? false;
  }

  const isAdmin = currentUser?.rol === 'administrador';

  return { can, isAdmin, permissions };
}
