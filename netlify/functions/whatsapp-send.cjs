/**
 * ══════════════════════════════════════════════════════════════
 * ALONZO — Netlify Function: comprobante de envío por WhatsApp (vía Dismoncatech)
 * ══════════════════════════════════════════════════════════════
 *
 * Manda UNA plantilla con la foto de la guía como encabezado. El POS la llama
 * una vez por cliente; el "masivo" es el bucle del lado del navegador, así
 * cada fila sabe si salió o no y un error no tumba la tanda entera.
 *
 * Flujo:
 *   1. Verifica el ID token de Firebase y que el usuario pueda usar Envíos.
 *   2. Si esa guía ya se mandó, no la repite (salvo `force: true`).
 *   3. Le avisa a Dismoncatech (`enviar-plantilla`) que salió una guía, con
 *      sus datos y la foto en base64. QUÉ plantilla sale y qué dato va en
 *      cada parte se configura en Dismoncatech → Ajustes → API, en el aviso
 *      `guia_enviada`: cambiar el texto o la plantilla NO toca este código.
 *   4. Guarda el resultado en `shipmentNotifications/{empresa}_{guía}`.
 *
 * POR QUÉ POR DISMONCATECH Y NO DIRECTO A META (2026-09-29): Dismoncatech es
 * el que atiende el WhatsApp de Alonzo. Mandando por ahí, la guía queda en el
 * hilo del cliente en el inbox, el bot sabe que se la mandaron si el cliente
 * pregunta, y los estados (entregado, leído) llegan solos. Directo a Meta
 * hacía falta un webhook propio, y Meta acepta UNO por app: configurarlo
 * dejaba al bot sin recibir mensajes. **No configures `whatsapp-webhook` en
 * Meta.**
 *
 * Variables de entorno (Netlify → Site settings → Environment variables):
 *   DISMONCATECH_API_KEY      la llave de API del bot de Alonzo (dmt_…)
 *   DISMONCATECH_API_URL      default: la de producción de Dismoncatech
 *   DISMONCATECH_AVISO        default: guia_enviada
 *   FIREBASE_SERVICE_ACCOUNT  la misma de las otras funciones
 */
const admin = require('firebase-admin');

const API_POR_DEFECTO = 'https://movqwllrkcexhbruvlxh.supabase.co/functions/v1/enviar-plantilla';
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



exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: HEADERS, body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Método no permitido' });

  const apiKey = process.env.DISMONCATECH_API_KEY;
  const apiUrl = process.env.DISMONCATECH_API_URL || API_POR_DEFECTO;
  if (!apiKey) {
    return reply(500, { error: 'Falta configurar DISMONCATECH_API_KEY en Netlify.' });
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
    // ── 3. Avisar a Dismoncatech ──
    // Se mandan TODOS los datos que se tienen; el aviso elige cuáles usa.
    const firstName = param(body.name, 'cliente').split(' ')[0];
    const nombre = firstName.charAt(0) + firstName.slice(1).toLowerCase();
    // La referencia es la misma llave del historial: Dismoncatech tampoco
    // manda dos veces la misma guía. Con `force` (reenviar a propósito) va
    // con un sufijo, o Dismoncatech la tomaría por repetida.
    const referencia = `${carrier}_${tracking}${body.force ? `_R${Date.now()}` : ''}`;
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        aviso: process.env.DISMONCATECH_AVISO || 'guia_enviada',
        telefono: to,
        nombre,
        nombre_completo: param(body.name, ''),
        empresa: param(body.carrierLabel, carrier),
        guia: tracking,
        cedula: record.cedula,
        destino: record.destination,
        foto: image,
        referencia,
      }),
    });
    const j = await res.json().catch(() => ({}));
    if (res.status === 409 && j.ya_enviado) {
      await docRef.set({ ...record, status: 'sent', wamid: null, dismoncatechId: j.mensaje_id ?? null, error: null });
      return reply(409, { error: 'Esta guía ya se envió.', alreadySent: true, status: 'sent' });
    }
    if (!res.ok) throw new Error(j.error || `Dismoncatech respondió ${res.status}`);
    const wamid = null;

    await docRef.set({ ...record, status: 'sent', wamid, dismoncatechId: j.mensaje_id ?? null, error: null });
    return reply(200, { ok: true, wamid, dismoncatechId: j.mensaje_id ?? null });
  } catch (e) {
    const msg = String(e.message || e);
    await docRef.set({ ...record, status: 'failed', wamid: null, error: msg });
    return reply(502, { error: msg });
  }
};
