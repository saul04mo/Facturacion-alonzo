import { useState, useCallback } from 'react';
import { useAppStore } from '@/store/appStore';
import * as authService from './authService';

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
      setError('Correo o contraseña incorrectos.');
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
