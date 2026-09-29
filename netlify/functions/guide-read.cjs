/**
 * ══════════════════════════════════════════════════════════════
 * ALONZO — Netlify Function: lectura de guías de envío con IA (Claude)
 * ══════════════════════════════════════════════════════════════
 *
 * El OCR del navegador no alcanza con fotos de celular reales: paquetes
 * oscuros, plástico encima, impresión térmica gris (Tealca), etiquetas de
 * lado. Claude lee la foto y devuelve los datos del DESTINATARIO.
 *
 * El navegador la llama solo cuando el código no trajo todo: con MRW el QR
 * ya tiene nombre, cédula y teléfono, y no se gasta nada.
 *
 * Costo aproximado: ~1–2 centavos de dólar por foto.
 *
 * Variables de entorno:
 *   ANTHROPIC_API_KEY         console.anthropic.com → API Keys
 *   FIREBASE_SERVICE_ACCOUNT  la misma de las otras funciones
 */
const Anthropic = require('@anthropic-ai/sdk');
const admin = require('firebase-admin');

const MODEL = 'claude-opus-5-5';

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
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};
const reply = (statusCode, obj) => ({ statusCode, headers: HEADERS, body: JSON.stringify(obj) });

const SYSTEM = `Lees fotos de guías de envío venezolanas (MRW, Zoom, Tealca u otras) que manda la Tienda Alonzo, y extraes los datos del DESTINATARIO para avisarle por WhatsApp.

Cómo son las guías:
- MRW: "TRACKING 0133…" (15 dígitos). "DEST: NOMBRE V-12345678" y "TLF:04xx…" del destinatario.
- Zoom: "ZOOM 1709088149" (10 dígitos). "Destinatario: NOMBRE (V-12345678)" o "(RIF/CI.V-12345678)"; el teléfono va en "(Tel.424-9171059)" o "(TEL.04143443149/4143443149)", que es el mismo número repetido.
- Tealca: "GUIA: 84873145" (8 dígitos), "NOMB: NOMBRE", "DEST: CIUDAD". Suele no traer cédula ni teléfono. La etiqueta suele venir girada.

Reglas:
- El REMITENTE es la tienda (TIENDA ALONZO / TIENDAALONZO, tlf 04123380976, RIF J-502846239): nunca lo devuelvas como destinatario ni uses su teléfono.
- Si te pasan códigos ya decodificados (QR, barras, DataMatrix), el número de guía que contienen es exacto: úsalo antes que lo que leas en la foto.
- Copia los dígitos tal como se ven. Si un dato no está o no se lee con seguridad, devuelve "" (vacío) en vez de adivinar.
- Cédula: solo los dígitos, sin V-/E- ni puntos. Teléfono: formato nacional 04XXXXXXXXX.
- Nombre en MAYÚSCULAS, tal como está impreso.

Llama a la herramienta registrar_guia exactamente una vez con los datos.`;

const TOOL = {
  name: 'registrar_guia',
  description: 'Registra los datos del destinatario leídos de la guía de envío.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      carrier: { type: 'string', enum: ['MRW', 'ZOOM', 'TEALCA', 'OTRO'], description: 'Empresa de envío' },
      tracking: { type: 'string', description: 'Número de guía / tracking, solo dígitos' },
      name: { type: 'string', description: 'Nombre del destinatario en mayúsculas' },
      cedula: { type: 'string', description: 'Cédula del destinatario, solo dígitos' },
      phone: { type: 'string', description: 'Teléfono del destinatario, 04XXXXXXXXX' },
      destination: { type: 'string', description: 'Agencia o ciudad de destino, corta' },
    },
    required: ['carrier', 'tracking', 'name', 'cedula', 'phone', 'destination'],
    additionalProperties: false,
  },
};

let client;
function getClient() {
  // Netlify corta la función a los 10 s: 2 reintentos no caben, 1 sí.
  if (!client) client = new Anthropic({ timeout: 8500, maxRetries: 0 });
  return client;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: HEADERS, body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Método no permitido' });
  if (!process.env.ANTHROPIC_API_KEY) {
    return reply(501, { error: 'Falta configurar ANTHROPIC_API_KEY en Netlify.', notConfigured: true });
  }

  // ── Quién llama ── (misma regla que whatsapp-send)
  const fb = getAdmin();
  const idToken = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer\s+/i, '');
  let uid;
  try {
    uid = (await fb.auth().verifyIdToken(idToken)).uid;
  } catch {
    return reply(401, { error: 'Sesión inválida. Vuelve a iniciar sesión.' });
  }
  const user = (await fb.firestore().collection('users').doc(uid).get()).data() || {};
  if (!(user.rol === 'administrador' || user.permissions?.canAccessEnvios === true)) {
    return reply(403, { error: 'No tienes permiso para leer guías.' });
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'JSON inválido' }); }
  const image = String(body.imageBase64 || '');
  if (!image) return reply(400, { error: 'Falta la foto.' });
  const codes = Array.isArray(body.codes) ? body.codes.map(String).slice(0, 5) : [];

  try {
    const response = await getClient().beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      // Extracción simple: con esfuerzo bajo responde más rápido y cuesta menos.
      output_config: { effort: 'low' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM,
      tools: [TOOL],
      tool_choice: { type: 'auto' },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } },
          {
            type: 'text',
            text: codes.length
              ? `Códigos decodificados de esta foto:\n${codes.map((c) => `- ${c}`).join('\n')}`
              : 'No se pudo decodificar ningún código de esta foto.',
          },
        ],
      }],
    });

    if (response.stop_reason === 'refusal') {
      return reply(422, { error: 'La IA no pudo procesar esta foto.' });
    }
    const call = response.content.find((b) => b.type === 'tool_use' && b.name === TOOL.name);
    if (!call) return reply(422, { error: 'La IA no devolvió datos.' });
    return reply(200, { ok: true, data: call.input });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return reply(500, { error: 'ANTHROPIC_API_KEY inválida.' });
    if (e instanceof Anthropic.RateLimitError) return reply(429, { error: 'Límite de la IA: intenta en un momento.' });
    if (e instanceof Anthropic.APIConnectionTimeoutError) return reply(504, { error: 'La IA tardó demasiado.' });
    if (e instanceof Anthropic.APIError) return reply(502, { error: `IA: ${e.message}` });
    return reply(500, { error: String(e.message || e) });
  }
};
