import { useState, useCallback } from 'react';
import { useAppStore } from '@/store/appStore';
import * as authService from './authService';

/**
 * Traduce el código de error de Firebase Auth a un mensaje útil.
 * Antes cualquier fallo (incluida la caída de red) se mostraba como
 * "Correo o contraseña incorrectos", lo que confundía un problema de
 * conexión con credenciales malas.
 */
function loginErrorMessage(err: unknown): string {
  const code = (err as { code?: string })?.code ?? '';
  switch (code) {
    case 'auth/network-request-failed':
      return 'No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.';
    case 'auth/too-many-requests':
      return 'Demasiados intentos fallidos. Espera unos minutos e inténtalo de nuevo.';
    case 'auth/user-disabled':
      return 'Esta cuenta está deshabilitada. Contacta al administrador.';
    case 'auth/invalid-email':
      return 'El correo no tiene un formato válido.';
    default:
      return 'Correo o contraseña incorrectos.';
  }
}

/**
 * Hook for auth operations (login, register, logout).
 * The actual auth state listener lives in AuthProvider.
 */
export function useAuth() {
  const currentUser = useAppStore((s) => s.currentUser);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const login = useCallback(async (email: string, password: string) => {
    setLoading(true);
    setError(null);
    try {
      await authService.signIn(email, password);
    } catch (err) {
      console.error('Login error:', err);
      setError(loginErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);



  const logout = useCallback(async () => {
    await authService.signOut();
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return {
    currentUser,
    isAuthenticated: !!currentUser,
    loading,
    error,
    login,
    logout,
    clearError,
  };
}
