import { WifiOff, RotateCw } from 'lucide-react';

interface ConnectionErrorScreenProps {
  message: string;
}

/**
 * Pantalla de error de conexión con Firestore.
 *
 * Se muestra cuando el listener del perfil no logra hablar con el backend
 * (típicamente ERR_CONNECTION_TIMED_OUT en /Listen/channel). Evita que el
 * usuario se quede mirando un spinner infinito o una pantalla de login que
 * "no hace nada".
 */
export function ConnectionErrorScreen({ message }: ConnectionErrorScreenProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-50 p-4">
      <div className="card max-w-md w-full p-8 text-center animate-fade-up">
        <div className="w-14 h-14 rounded-2xl bg-red-50 mx-auto mb-4 flex items-center justify-center">
          <WifiOff size={24} className="text-accent-red" />
        </div>

        <h1 className="text-lg font-display font-bold text-navy-900">Sin conexión al servidor</h1>
        <p className="text-navy-400 text-sm mt-2 font-body">{message}</p>

        <button onClick={() => window.location.reload()} className="btn-primary w-full py-3 mt-6">
          <RotateCw size={16} />
          Reintentar
        </button>

        <p className="text-navy-300 text-xs mt-4 font-body">
          Si el problema persiste, prueba con otra red (datos móviles) o desactiva VPN/antivirus que
          puedan bloquear firestore.googleapis.com.
        </p>
      </div>
    </div>
  );
}
