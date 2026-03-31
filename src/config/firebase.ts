import { initializeApp } from 'firebase/app';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? 'AIzaSyCSIZ00QQqAN_3bqj89r6YVrifZx9vGy20',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? 'alozo-2633a.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? 'alozo-2633a',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? 'alozo-2633a.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '711733152496',
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? '1:711733152496:web:98557b5691ba9ebcc51035',
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID ?? 'G-P580SMEQJW',
};

export const app = initializeApp(firebaseConfig);

/**
 * Firestore WITH persistent cache enabled.
 * 
 * This makes a HUGE difference in perceived load time:
 * - First visit: data loads from server (same as before)
 * - Every subsequent visit: data loads INSTANTLY from IndexedDB,
 *   then syncs with server in the background
 * - Works offline too
 * - Multi-tab support enabled
 */
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
});

export const auth = getAuth(app);
export const storage = getStorage(app);
