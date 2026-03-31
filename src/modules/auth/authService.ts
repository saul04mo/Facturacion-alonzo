import {
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  type User,
} from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from '@/config/firebase';
import { DEFAULT_PERMISSIONS } from '@/config/constants';
import type { AppUser } from '@/types';

/**
 * Sign in with email and password.
 */
export async function signIn(email: string, password: string): Promise<void> {
  await signInWithEmailAndPassword(auth, email, password);
}



/**
 * Sign out the current user.
 */
export async function signOut(): Promise<void> {
  await firebaseSignOut(auth);
}

/**
 * Fetch the AppUser profile from Firestore given a Firebase Auth User.
 * Returns null if the user document doesn't exist.
 */
export async function fetchUserProfile(user: User): Promise<AppUser | null> {
  const userDocRef = doc(db, 'users', user.uid);
  const snap = await getDoc(userDocRef);

  if (!snap.exists()) return null;

  return {
    id: snap.id,
    uid: user.uid,
    ...snap.data(),
  } as AppUser;
}

/**
 * Subscribe to auth state changes.
 * Returns an unsubscribe function.
 */
export function onAuthChange(callback: (user: User | null) => void) {
  return onAuthStateChanged(auth, callback);
}
