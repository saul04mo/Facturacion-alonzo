import { useAppStore } from '@/store/appStore';
import { DEFAULT_PERMISSIONS, type PermissionKey } from '@/config/constants';

/**
 * Hook for checking user permissions.
 * Replaces the old `applyPermissions()` function.
 */
export function usePermissions() {
  const currentUser = useAppStore((s) => s.currentUser);

  // Lookup por rol en vez de un ternario: con tres roles el ternario hacía
  // que cualquier rol nuevo cayera silenciosamente en los permisos de
  // vendedor, que es justo lo que no queremos para un repartidor.
  const roleDefaults =
    (currentUser?.rol && DEFAULT_PERMISSIONS[currentUser.rol]) || DEFAULT_PERMISSIONS.vendedor;

  // Merge saved permissions with defaults — new permissions use role default
  const permissions = currentUser?.permissions
    ? { ...roleDefaults, ...currentUser.permissions }
    : roleDefaults;

  function can(permission: PermissionKey): boolean {
    if (!currentUser) return false;
    return permissions?.[permission] ?? false;
  }

  const isAdmin = currentUser?.rol === 'administrador';
  const isCourier = currentUser?.rol === 'delivery';

  return { can, isAdmin, isCourier, permissions };
}
