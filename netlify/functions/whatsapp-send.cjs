/**
 * ══════════════════════════════════════════════════════════════
 * ALONZO — Netlify Function: comprobante de envío por WhatsApp (Meta Cloud API)
 * ══════════════════════════════════════════════════════════════
 *
 * Manda UNA plantilla con la foto de la guía como encabezado. El POS la llama
 * una vez por cliente; el "masivo" es el bucle del lado del navegador, así
 * cada fila sabe si salió o no y un error no tumba la tanda entera.
 *
 * Flujo:
 *   1. Verifica el ID token de Firebase y que el usuario pueda usar Envíos.
 *   2. Si esa guía ya se mandó, no la repite (salvo `force: true`).
 *   3. Sube la foto a Meta (/media) → media id.
 *   4. Manda la plantilla con header IMAGE + 3 variables en el cuerpo.
 *   5. Guarda el resultado en `shipmentNotifications/{empresa}_{guía}`.
 *      El webhook (whatsapp-webhook) después le actualiza el estado.
 *
 * Variables de entorno (Netlify → Site settings → Environment variables):
 *   WHATSAPP_TOKEN            token permanente de un System User de Meta
 *   WHATSAPP_PHONE_NUMBER_ID  el ID del número (no el número en sí)
 *   WHATSAPP_TEMPLATE_NAME    default: comprobante_envio
 *   WHATSAPP_TEMPLATE_LANG    default: es
 *   FIREBASE_SERVICE_ACCOUNT  la misma de las otras funciones
 */
const admin = require('firebase-admin');

const GRAPH = 'https://graph.facebook.com/v21.0';
const COLLECTION = 'shipmentNotifications';

function getAdmin() {
  if (!admin.apps.length) {
    let credential;
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      credential = admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
    } else {
      // Respaldo SOLO para `netlify dev`. Require dinámico para que esbuild no
      // incruste la llave en el bundle.
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
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

const reply = (statusCode, obj) => ({ statusCode, headers: HEADERS, body: JSON.stringify(obj) });

/** Mismo criterio que src/utils/phoneUtils.ts → toWhatsappNumber. */
function toIntl(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (!d) return null;
  let intl;
  if (d.startsWith('58')) intl = d;
  else if (d.startsWith('0')) intl = '58' + d.slice(1);
  else if (d.length <= 10) intl = '58' + d;
  else intl = d;
  return intl.length >= 11 && intl.length <= 15 ? intl : null;
}

/** Meta rechaza variables vacías o con saltos de línea / 4+ espacios seguidos. */
function param(s, fallback) {
  const v = String(s || '').replace(/\s+/g, ' ').trim();
  return (v || fallback).slice(0, 200);
}

async function graphError(res) {
  try {
    const j = await res.json();
    const e = j.error || {};
    return `${e.message || res.statusText}${e.error_data?.details ? ` — ${e.error_data.details}` : ''} (code ${e.code ?? res.status})`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: HEADERS, body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Método no permitido' });

  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) {
    return reply(500, { error: 'Falta configurar WHATSAPP_TOKEN y WHATSAPP_PHONE_NUMBER_ID en Netlify.' });
  }

  // ── 1. Quién llama ──
  const fb = getAdmin();
  const idToken = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer\s+/i, '');
  let uid;
  try {
    uid = (await fb.auth().verifyIdToken(idToken)).uid;
  } catch {
    return reply(401, { error: 'Sesión inválida. Vuelve a iniciar sesión.' });
  }
  const db = fb.firestore();
  const userSnap = await db.collection('users').doc(uid).get();
  const user = userSnap.data() || {};
  const allowed = user.rol === 'administrador' || user.permissions?.canAccessEnvios === true;
  if (!allowed) return reply(403, { error: 'No tienes permiso para enviar comprobantes.' });

  // ── Datos ──
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'JSON inválido' }); }

  const to = toIntl(body.phone);
  const carrier = String(body.carrier || '').toUpperCase().replace(/[^A-Z]/g, '') || 'OTRO';
  const tracking = String(body.tracking || '').replace(/[^\w-]/g, '');
  const image = String(body.imageBase64 || '');
  if (!to) return reply(400, { error: 'Teléfono inválido.' });
  if (!tracking) return reply(400, { error: 'Falta el número de guía.' });
  if (!image) return reply(400, { error: 'Falta la foto de la guía.' });

  const docRef = db.collection(COLLECTION).doc(`${carrier}_${tracking}`);

  // ── 2. No mandar dos veces la misma guía ──
  if (!body.force) {
    const prev = await docRef.get();
    const st = prev.exists && prev.data().status;
    if (st && st !== 'failed') {
      return reply(409, { error: 'Esta guía ya se envió.', alreadySent: true, status: st });
    }
  }

  const record = {
    carrier,
    carrierLabel: param(body.carrierLabel, carrier),
    tracking,
    phone: to,
    clientId: body.clientId || null,
    clientName: param(body.name, ''),
    cedula: String(body.cedula || '').replace(/\D/g, ''),
    destination: param(body.destination, ''),
    sentBy: uid,
    sentByName: [user.nombre, user.apellido].filter(Boolean).join(' ') || user.correo || '',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  try {
    // ── 3. Subir la foto ──
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', 'image/jpeg');
    form.append('file', new Blob([Buffer.from(image, 'base64')], { type: 'image/jpeg' }), `guia-${tracking}.jpg`);
    const up = await fetch(`${GRAPH}/${phoneId}/media`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    if (!up.ok) throw new Error(`Subiendo la foto: ${await graphError(up)}`);
    const { id: mediaId } = await up.json();

    // ── 4. Plantilla ──
    // Cuerpo: {{1}} nombre · {{2}} empresa · {{3}} número de guía
    const firstName = param(body.name, 'cliente').split(' ')[0];
    const nombre = firstName.charAt(0) + firstName.slice(1).toLowerCase();
    const send = await fetch(`${GRAPH}/${phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: process.env.WHATSAPP_TEMPLATE_NAME || 'comprobante_envio',
          language: { code: process.env.WHATSAPP_TEMPLATE_LANG || 'es' },
          components: [
            { type: 'header', parameters: [{ type: 'image', image: { id: mediaId } }] },
            {
              type: 'body',
              parameters: [
                { type: 'text', text: nombre },
                { type: 'text', text: param(body.carrierLabel, carrier) },
                { type: 'text', text: tracking },
              ],
            },
          ],
        },
      }),
    });
    if (!send.ok) throw new Error(await graphError(send));
    const sent = await send.json();
    const wamid = sent.messages?.[0]?.id || null;

    await docRef.set({ ...record, status: 'sent', wamid, error: null });
    return reply(200, { ok: true, wamid });
  } catch (e) {
    const msg = String(e.message || e);
    await docRef.set({ ...record, status: 'failed', wamid: null, error: msg });
    return reply(502, { error: msg });
  }
};
