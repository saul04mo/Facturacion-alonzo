import { useAppStore } from '@/store/appStore';
import { DEFAULT_PERMISSIONS, type PermissionKey } from '@/config/constants';

/**
 * Hook for checking user permissions.
 * Replaces the old `applyPermissions()` function.
 */
export function usePermissions() {
  const currentUser = useAppStore((s) => s.currentUser);

  const roleDefaults = currentUser?.rol === 'administrador'
    ? DEFAULT_PERMISSIONS.administrador
    : DEFAULT_PERMISSIONS.vendedor;

  // Merge saved permissions with defaults — new permissions use role default
  const permissions = currentUser?.permissions
    ? { ...roleDefaults, ...currentUser.permissions }
    : roleDefaults;

  function can(permission: PermissionKey): boolean {
    if (!currentUser) return false;
    return permissions?.[permission] ?? false;
  }

  const isAdmin = currentUser?.rol === 'administrador';

  return { can, isAdmin, permissions };
}
