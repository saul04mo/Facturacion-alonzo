import { initializeApp } from 'firebase/app';
import { initializeFirestore, memoryLocalCache } from 'firebase/firestore';
import { initializeAuth, browserLocalPersistence } from 'firebase/auth';
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
 * Firestore con cache EN MEMORIA (no persistente).
 *
 * Decisión deliberada: no usamos persistentLocalCache + IndexedDB porque
 * generaba problemas conocidos del SDK cuando había múltiples pestañas
 * del POS abiertas:
 *
 *   - 'Failed to obtain primary lease' (pelea de tabs por el lease)
 *   - IndexedDB que se corrompía con sesiones largas → forzaba a limpiar
 *     site data del navegador para volver a entrar
 *   - 400 Bad Request en /Listen/channel + QUIC_PROTOCOL_ERROR cuando
 *     la red se inestabilizaba y la cache local quedaba en estado raro
 *
 * Con memoryLocalCache:
 *   ✓ Multi-tab funciona sin pelea (cada tab tiene su propio cache RAM)
 *   ✓ onSnapshot sigue funcionando igual: realtime intacto
 *   ✓ Cero corrupción posible (no hay IndexedDB)
 *
 * Trade-off: no hay funcionalidad offline. Si se cae internet, la app
 * no puede leer/escribir. Para un POS de tienda con buena WiFi este
 * trade-off vale la pena. Si se necesita offline en el futuro, se
 * puede volver a persistentLocalCache (con su single-tab manager para
 * evitar la pelea de leases).
 */
export const db = initializeFirestore(app, {
  localCache: memoryLocalCache(),
});

// Use browserLocalPersistence (localStorage) instead of the default IndexedDB
// to avoid "database connection is closing" errors that were dropping sessions
// on page refresh/navigation in multi-tab POS environments.
export const auth = initializeAuth(app, {
  persistence: browserLocalPersistence,
});
export const storage = getStorage(app);
