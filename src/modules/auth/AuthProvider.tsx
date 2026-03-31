import { useEffect, useState, type ReactNode } from 'react';
import { useAppStore } from '@/store/appStore';
import { onAuthChange, fetchUserProfile, signOut } from './authService';
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
    const unsubscribe = onAuthChange(async (firebaseUser) => {
      if (firebaseUser) {
        try {
          const profile = await fetchUserProfile(firebaseUser);
          if (profile) {
            setCurrentUser(profile);
          } else {
            // User exists in Auth but not in Firestore — force sign out
            console.error('No se encontró el documento del usuario en Firestore.');
            await signOut();
            setCurrentUser(null);
          }
        } catch (err) {
          console.error('Error fetching user profile:', err);
          setCurrentUser(null);
        }
      } else {
        setCurrentUser(null);
      }
      setInitializing(false);
    });

    return () => unsubscribe();
  }, [setCurrentUser]);

  // Show loading spinner during initial auth check
  if (initializing) {
    return <LoadingScreen />;
  }

  return <>{children}</>;
}
