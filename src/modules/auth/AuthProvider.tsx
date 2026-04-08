import { useEffect, useState, type ReactNode } from 'react';
import { useAppStore } from '@/store/appStore';
import { onAuthChange, signOut } from './authService';
import { LoadingScreen } from '@/components/LoadingScreen';

interface AuthProviderProps {
  children: ReactNode;
}

/**
 * AuthProvider wraps the app and manages the auth state lifecycle.
 * Replaces the monolith's `onAuthStateChanged(auth, async (user) => {...})` block.
 *
 * Flow:
 * 1. On mount, subscribes to Firebase auth state
 * 2. When user signs in → fetches Firestore profile → sets currentUser in store
 * 3. When user signs out → clears currentUser
 * 4. If Firestore profile doesn't exist → forces sign out
 */
export function AuthProvider({ children }: AuthProviderProps) {
  const setCurrentUser = useAppStore((s) => s.setCurrentUser);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    let profileUnsub: (() => void) | undefined;

    const authUnsub = onAuthChange(async (firebaseUser) => {
      if (firebaseUser) {
        try {
          // Listen to the user document in real-time instead of a one-time fetch
          const { doc, onSnapshot } = await import('firebase/firestore');
          const { db } = await import('@/config/firebase');

          if (profileUnsub) profileUnsub(); // clear previous

          profileUnsub = onSnapshot(doc(db, 'users', firebaseUser.uid), (snap) => {
            if (snap.exists()) {
              const profile = { id: snap.id, uid: firebaseUser.uid, ...snap.data() } as any;
              setCurrentUser(profile);
            } else {
              // User documented deleted or not found
              console.error('No se encontró el documento del usuario en Firestore.');
              signOut();
              setCurrentUser(null);
            }
            setInitializing(false);
          });
        } catch (err) {
          console.error('Error attaching user profile listener:', err);
          setCurrentUser(null);
          setInitializing(false);
        }
      } else {
        if (profileUnsub) {
          profileUnsub();
          profileUnsub = undefined;
        }
        setCurrentUser(null);
        setInitializing(false);
      }
    });

    return () => {
      authUnsub();
      if (profileUnsub) profileUnsub();
    };
  }, [setCurrentUser]);

  // Show loading spinner during initial auth check
  if (initializing) {
    return <LoadingScreen />;
  }

  return <>{children}</>;
}
