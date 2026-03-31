import { doc, setDoc, updateDoc } from 'firebase/firestore';
import { initializeApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth';
import { db } from '@/config/firebase';
import { DEFAULT_PERMISSIONS, type PermissionKey } from '@/config/constants';
import type { AppUser } from '@/types';

interface UserInput {
  nombre: string;
  apellido: string;
  cedula: string;
  phone: string;
  correo: string;
  rol: 'administrador' | 'vendedor';
}

/**
 * Create a new user via a secondary Firebase app instance
 * (so we don't sign out the current admin).
 */
export async function createUser(data: UserInput & { password: string }, firebaseConfig: any): Promise<void> {
  const appName = `secondary-app-${Date.now()}`;
  const secondaryApp = initializeApp(firebaseConfig, appName);
  const secondaryAuth = getAuth(secondaryApp);

  try {
    const credential = await createUserWithEmailAndPassword(secondaryAuth, data.correo, data.password);
    const uid = credential.user.uid;

    await setDoc(doc(db, 'users', uid), {
      uid,
      nombre: data.nombre,
      apellido: data.apellido,
      cedula: data.cedula,
      phone: data.phone,
      correo: data.correo,
      rol: data.rol,
      permissions: DEFAULT_PERMISSIONS[data.rol],
    });
  } finally {
    // Clean up secondary app
    try { await secondaryApp.delete(); } catch { /* ignore */ }
  }
}

/**
 * Update an existing user's profile (not password/email).
 */
export async function updateUser(id: string, data: UserInput): Promise<void> {
  await updateDoc(doc(db, 'users', id), {
    nombre: data.nombre,
    apellido: data.apellido,
    cedula: data.cedula,
    phone: data.phone,
    correo: data.correo,
    rol: data.rol,
  });
}

/**
 * Update user permissions.
 */
export async function updatePermissions(userId: string, permissions: Record<PermissionKey, boolean>): Promise<void> {
  await updateDoc(doc(db, 'users', userId), { permissions });
}
