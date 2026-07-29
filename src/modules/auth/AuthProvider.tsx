import { useEffect, useState, type ReactNode } from 'react';
import { useAppStore } from '@/store/appStore';
import { onAuthChange, signOut } from './authService';
import { LoadingScreen } from '@/components/LoadingScreen';
import { ConnectionErrorScreen } from '@/components/ConnectionErrorScreen';

interface AuthProviderProps {
  children: ReactNode;
}

/** Segundos sin respuesta del servidor antes de mostrar la pantalla de "sin conexión". */
const CONNECTION_TIMEOUT_MS = 12_000;

/**
 * AuthProvider wraps the app and manages the auth state lifecycle.
 * Replaces the monolith's `onAuthStateChanged(auth, async (user) => {...})` block.
 *
 * Flow:
 * 1. On mount, subscribes to Firebase auth state
 * 2. When user signs in → escucha su perfil en Firestore → sets currentUser in store
 * 3. When user signs out → clears currentUser
 * 4. Si el perfil NO existe *según el servidor* → fuerza sign out
 *
 * IMPORTANTE (bug de sesión): con `memoryLocalCache` el cache arranca vacío,
 * así que cuando Firestore no puede conectar (ERR_CONNECTION_TIMED_OUT en
 * /Listen/channel), onSnapshot emite igual un snapshot con `exists() === false`
 * y `metadata.fromCache === true`. Antes eso se interpretaba como "usuario
 * borrado" y disparaba signOut(), es decir: un corte de red temporal expulsaba
 * al usuario y no dejaba entrar al sistema. Solo confiamos en la NO existencia
 * cuando el snapshot viene del servidor (`fromCache === false`).
 */
export function AuthProvider({ children }: AuthProviderProps) {
  const setCurrentUser = useAppStore((s) => s.setCurrentUser);
  const [initializing, setInitializing] = useState(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  useEffect(() => {
    let profileUnsub: (() => void) | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const clearTimeoutIfAny = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = undefined;
      }
    };

    const authUnsub = onAuthChange(async (firebaseUser) => {
      if (firebaseUser) {
        try {
          // Listen to the user document in real-time instead of a one-time fetch
          const { doc, onSnapshot } = await import('firebase/firestore');
          const { db } = await import('@/config/firebase');

          if (cancelled) return;
          if (profileUnsub) profileUnsub(); // clear previous
          clearTimeoutIfAny();

          // Si el servidor no responde en X segundos, avisamos en pantalla en
          // vez de dejar el spinner girando para siempre.
          timeoutId = setTimeout(() => {
            setConnectionError(
              'No se pudo conectar con el servidor. Revisa tu conexión a internet e inténtalo de nuevo.'
            );
          }, CONNECTION_TIMEOUT_MS);

          profileUnsub = onSnapshot(
            doc(db, 'users', firebaseUser.uid),
            { includeMetadataChanges: true },
            (snap) => {
              const fromCache = snap.metadata.fromCache;

              if (snap.exists()) {
                const profile = { id: snap.id, uid: firebaseUser.uid, ...snap.data() } as any;
                setCurrentUser(profile);
                if (!fromCache) {
                  clearTimeoutIfAny();
                  setConnectionError(null);
                }
                setInitializing(false);
                return;
              }

              if (fromCache) {
                // Cache vacío por falta de conexión: NO es un usuario borrado.
                // Seguimos esperando la respuesta del servidor.
                return;
              }

              // El servidor confirmó que el documento no existe.
              clearTimeoutIfAny();
              console.error('No se encontró el documento del usuario en Firestore.');
              signOut();
              setCurrentUser(null);
              setConnectionError(null);
              setInitializing(false);
            },
            (err) => {
              console.error('Error en el listener del perfil de usuario:', err);
              clearTimeoutIfAny();
              if (err.code === 'permission-denied') {
                signOut();
                setCurrentUser(null);
                setConnectionError(null);
              } else {
                setConnectionError(
                  'Se perdió la conexión con el servidor. Revisa tu internet e inténtalo de nuevo.'
                );
              }
              setInitializing(false);
            }
          );
        } catch (err) {
          console.error('Error attaching user profile listener:', err);
          clearTimeoutIfAny();
          setCurrentUser(null);
          setInitializing(false);
        }
      } else {
        if (profileUnsub) {
          profileUnsub();
          profileUnsub = undefined;
        }
        clearTimeoutIfAny();
        setCurrentUser(null);
        setConnectionError(null);
        setInitializing(false);
      }
    });

    return () => {
      cancelled = true;
      clearTimeoutIfAny();
      authUnsub();
      if (profileUnsub) profileUnsub();
    };
  }, [setCurrentUser]);

  if (connectionError) {
    return <ConnectionErrorScreen message={connectionError} />;
  }

  // Show loading spinner during initial auth check
  if (initializing) {
    return <LoadingScreen />;
  }

  return <>{children}</>;
}
