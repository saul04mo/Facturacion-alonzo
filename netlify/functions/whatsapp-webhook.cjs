/**
 * ══════════════════════════════════════════════════════════════
 * ALONZO — Netlify Function: webhook de WhatsApp (estados de los mensajes)
 * ══════════════════════════════════════════════════════════════
 *
 * Meta avisa acá cada cambio de estado de un mensaje que mandó
 * whatsapp-send: sent → delivered → read, o failed (número sin WhatsApp,
 * plantilla pausada, etc.). Se busca el documento por `wamid` y se actualiza,
 * así el historial de Envíos muestra si el cliente lo recibió y lo leyó.
 *
 * Configuración en Meta (App → WhatsApp → Configuration → Webhook):
 *   Callback URL:  https://<tu-sitio>/.netlify/functions/whatsapp-webhook
 *   Verify token:  el mismo valor de WHATSAPP_VERIFY_TOKEN
 *   Campo:         messages (suscribirse)
 *
 * Variables de entorno:
 *   WHATSAPP_VERIFY_TOKEN  texto cualquiera, solo para el handshake inicial
 *   WHATSAPP_APP_SECRET    (recomendado) App Secret de la app de Meta: con él
 *                          se valida la firma y nadie más puede falsear estados
 *   FIREBASE_SERVICE_ACCOUNT
 */
const crypto = require('crypto');
const admin = require('firebase-admin');

const COLLECTION = 'shipmentNotifications';

// Un estado nunca retrocede: si "read" llega antes que "delivered" (pasa), se
// queda en "read".
const RANK = { sent: 1, delivered: 2, read: 3, failed: 4 };

function getDb() {
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
  return admin.firestore();
}

function validSignature(raw, header) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return true; // sin secreto configurado no se valida
  if (!header) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

exports.handler = async (event) => {
  // ── Handshake de verificación (GET) ──
  if (event.httpMethod === 'GET') {
    const q = event.queryStringParameters || {};
    if (q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === process.env.WHATSAPP_VERIFY_TOKEN) {
      return { statusCode: 200, body: q['hub.challenge'] || '' };
    }
    return { statusCode: 403, body: 'forbidden' };
  }
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: '' };

  const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64') : Buffer.from(event.body || '', 'utf8');
  if (!validSignature(raw, event.headers['x-hub-signature-256'])) {
    return { statusCode: 401, body: 'bad signature' };
  }

  let payload;
  try { payload = JSON.parse(raw.toString('utf8')); } catch { return { statusCode: 400, body: '' }; }

  const statuses = (payload.entry || [])
    .flatMap((e) => e.changes || [])
    .flatMap((c) => c.value?.statuses || []);

  const db = getDb();
  await Promise.all(statuses.map(async (s) => {
    const snap = await db.collection(COLLECTION).where('wamid', '==', s.id).limit(1).get();
    if (snap.empty) return; // mensaje que no salió de Envíos
    const doc = snap.docs[0];
    const current = doc.data().status;
    if ((RANK[s.status] || 0) <= (RANK[current] || 0)) return;
    const err = s.errors?.[0];
    await doc.ref.update({
      status: s.status,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      [`${s.status}At`]: admin.firestore.Timestamp.fromMillis(Number(s.timestamp) * 1000),
      ...(err ? { error: `${err.title || ''}${err.error_data?.details ? ` — ${err.error_data.details}` : ''} (code ${err.code})` } : {}),
    });
  }));

  // Meta reintenta si no recibe 200 rápido: se responde siempre 200.
  return { statusCode: 200, body: 'ok' };
};
