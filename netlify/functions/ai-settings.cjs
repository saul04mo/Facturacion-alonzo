/**
 * ══════════════════════════════════════════════════════════════
 * ALONZO — Netlify Function: configuración de la IA que lee las guías
 * ══════════════════════════════════════════════════════════════
 *
 * La API key se carga desde el POS (página Envíos → "Lectura con IA") y se
 * guarda en `secrets/aiConfig`. Esa colección NO se puede leer ni escribir
 * desde el navegador (cae en el "deny everything else" de firestore.rules):
 * solo estas funciones, con firebase-admin. Así la key nunca llega al cliente.
 *
 *   GET   → { provider, model, hasKey, keyHint }   (keyHint = "sk-…abcd")
 *   POST  { provider, model, apiKey? }             (apiKey vacío = no cambiarla)
 *
 * Solo administradores.
 */
const admin = require('firebase-admin');

const DOC = ['secrets', 'aiConfig'];
const PROVIDERS = ['openai', 'anthropic'];
const DEFAULT_MODEL = { openai: 'gpt-4o', anthropic: 'claude-opus-5-5' };

function getAdmin() {
  if (!admin.apps.length) {
    let credential;
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      credential = admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
    } else {
      const path = require('path');
      const keyPath = path.join(__dirname, '..', '..', 'serviceAccountKey.json');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      credential = admin.credential.cert(require(keyPath));
    }
    admin.initializeApp({ credential });
  }
  return admin;
}

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
};
const reply = (statusCode, obj) => ({ statusCode, headers: HEADERS, body: JSON.stringify(obj) });

const hint = (k) => (k ? `${k.slice(0, 3)}…${k.slice(-4)}` : '');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: HEADERS, body: '' };

  const fb = getAdmin();
  const idToken = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer\s+/i, '');
  let uid;
  try {
    uid = (await fb.auth().verifyIdToken(idToken)).uid;
  } catch {
    return reply(401, { error: 'Sesión inválida. Vuelve a iniciar sesión.' });
  }
  const db = fb.firestore();
  const user = (await db.collection('users').doc(uid).get()).data() || {};
  if (user.rol !== 'administrador') return reply(403, { error: 'Solo un administrador puede ver o cambiar la IA.' });

  const ref = db.collection(DOC[0]).doc(DOC[1]);

  if (event.httpMethod === 'GET') {
    const cfg = (await ref.get()).data() || {};
    const provider = PROVIDERS.includes(cfg.provider) ? cfg.provider : 'openai';
    return reply(200, {
      provider,
      model: cfg.model || DEFAULT_MODEL[provider],
      hasKey: !!cfg.apiKey,
      keyHint: hint(cfg.apiKey),
      updatedByName: cfg.updatedByName || '',
    });
  }

  if (event.httpMethod !== 'POST') return reply(405, { error: 'Método no permitido' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'JSON inválido' }); }
  const provider = String(body.provider || '');
  if (!PROVIDERS.includes(provider)) return reply(400, { error: 'Proveedor inválido.' });
  const model = String(body.model || '').trim() || DEFAULT_MODEL[provider];
  const apiKey = String(body.apiKey || '').trim();
  if (apiKey && !/^sk-[\w-]{20,}$/.test(apiKey)) {
    return reply(400, { error: 'Esa API key no tiene el formato esperado (empieza con sk-).' });
  }

  const prev = (await ref.get()).data() || {};
  // Si cambia de proveedor, la key vieja no sirve: hay que cargar una nueva.
  if (!apiKey && prev.provider && prev.provider !== provider) {
    return reply(400, { error: 'Al cambiar de proveedor hay que cargar su API key.' });
  }

  await ref.set({
    provider,
    model,
    apiKey: apiKey || prev.apiKey || '',
    updatedBy: uid,
    updatedByName: [user.nombre, user.apellido].filter(Boolean).join(' ') || user.correo || '',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  const saved = apiKey || prev.apiKey || '';
  return reply(200, { ok: true, provider, model, hasKey: !!saved, keyHint: hint(saved) });
};
