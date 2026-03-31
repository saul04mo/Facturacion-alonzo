import { useState, useEffect, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from './useAuth';
import { useAppStore } from '@/store/appStore';
import { ROUTES } from '@/config/constants';
import { LogIn, Mail, Lock } from 'lucide-react';

export function LoginPage() {
  const { login, loading, error, clearError, isAuthenticated } = useAuth();
  const theme = useAppStore((s) => s.theme);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Apply dark class (auth pages are outside Layout)
  useEffect(() => { document.documentElement.classList.toggle('dark', theme === 'dark'); }, [theme]);

  if (isAuthenticated) return <Navigate to={ROUTES.POS} replace />;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    await login(email, password);
  }

  return (
    <div className="min-h-screen bg-surface-50 flex items-center justify-center p-4 transition-colors duration-300">
      {/* Subtle background pattern */}
      <div className="fixed inset-0 opacity-[0.015]"
        style={{
          backgroundImage: `radial-gradient(circle at 1px 1px, #102a43 1px, transparent 0)`,
          backgroundSize: '24px 24px',
        }}
      />

      <div className="relative w-full max-w-md animate-fade-up">
        {/* Logo area */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-navy-900 mx-auto mb-4 flex items-center justify-center shadow-card overflow-hidden">
            <img
              src="/images/Alonzo.JPG"
              alt="Logo"
              className="w-full h-full object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
                (e.target as HTMLImageElement).parentElement!.innerHTML =
                  '<span class="text-white font-display font-bold text-2xl">A</span>';
              }}
            />
          </div>
          <h1 className="text-2xl font-display font-bold text-navy-900">
            Bienvenido de vuelta
          </h1>
          <p className="text-navy-400 text-sm mt-1 font-body">
            Ingresa a tu cuenta de POS Alonzo
          </p>
        </div>

        {/* Card */}
        <div className="card p-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-display font-medium text-navy-700 mb-1.5">
                Correo Electrónico
              </label>
              <div className="relative">
                <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-navy-300" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); clearError(); }}
                  className="input-field pl-10"
                  placeholder="correo@ejemplo.com"
                  required
                  autoComplete="email"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-display font-medium text-navy-700 mb-1.5">
                Contraseña
              </label>
              <div className="relative">
                <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-navy-300" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); clearError(); }}
                  className="input-field pl-10"
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                />
              </div>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
                <p className="text-accent-red text-sm font-display">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full py-3"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Accediendo...
                </span>
              ) : (
                <>
                  <LogIn size={16} />
                  Iniciar Sesión
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
