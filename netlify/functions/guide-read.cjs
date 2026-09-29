/**
 * ══════════════════════════════════════════════════════════════
 * ALONZO — Netlify Function: lectura de guías de envío con IA (Claude)
 * ══════════════════════════════════════════════════════════════
 *
 * El OCR del navegador no alcanza con fotos de celular reales: paquetes
 * oscuros, plástico encima, impresión térmica gris (Tealca), etiquetas de
 * lado. Un modelo con visión lee la foto y devuelve los datos del DESTINATARIO.
 *
 * Proveedor, modelo y API key se cargan desde el POS (Envíos → "Lectura con
 * IA") y viven en `secrets/aiConfig` (ver ai-settings.cjs). OpenAI (ChatGPT)
 * o Anthropic (Claude). Si no hay nada cargado, se usa ANTHROPIC_API_KEY.
 *
 * El navegador la llama solo cuando el código no trajo todo: con MRW el QR
 * ya tiene nombre, cédula y teléfono, y no se gasta nada.
 *
 * Costo aproximado: ~1–2 centavos de dólar por foto.
 */
const Anthropic = require('@anthropic-ai/sdk');
const admin = require('firebase-admin');

/** Netlify corta la función a los 10 s: se deja margen para responder. */
const AI_TIMEOUT_MS = 8500;

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

function userText(codes) {
  return codes.length
    ? `Códigos decodificados de esta foto:\n${codes.map((c) => `- ${c}`).join('\n')}`
    : 'No se pudo decodificar ningún código de esta foto.';
}

class AiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ── OpenAI (ChatGPT): Chat Completions con visión y salida JSON estricta ──
async function readWithOpenAi({ apiKey, model }, image, codes) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), AI_TIMEOUT_MS);
  let res;
  try {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          // Con OpenAI no hay herramienta: la respuesta ya sale como JSON.
          { role: 'system', content: SYSTEM.replace(/\s*Llama a la herramienta[\s\S]*$/, '') },
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${image}`, detail: 'high' } },
              { type: 'text', text: userText(codes) },
            ],
          },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: TOOL.name, strict: true, schema: TOOL.input_schema },
        },
      }),
    });
  } catch (e) {
    throw new AiError(504, e.name === 'AbortError' ? 'La IA tardó demasiado.' : `No se pudo conectar con OpenAI: ${e.message}`);
  } finally {
    clearTimeout(timer);
  }
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = j.error?.message || `HTTP ${res.status}`;
    if (res.status === 401) throw new AiError(500, 'La API key de OpenAI es inválida.');
    if (res.status === 429) throw new AiError(429, `OpenAI: ${msg}`);
    throw new AiError(502, `OpenAI: ${msg}`);
  }
  const msg = j.choices?.[0]?.message;
  if (msg?.refusal) throw new AiError(422, 'La IA no pudo procesar esta foto.');
  try {
    return JSON.parse(msg?.content || '');
  } catch {
    throw new AiError(422, 'La IA no devolvió datos.');
  }
}

// ── Anthropic (Claude) ──
async function readWithClaude({ apiKey, model }, image, codes) {
  // Sin reintentos: con el tope de 10 s de Netlify no entra un segundo intento.
  const client = new Anthropic({ apiKey, timeout: AI_TIMEOUT_MS, maxRetries: 0 });
  let response;
  try {
    response = await client.beta.messages.create({
      model,
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
          { type: 'text', text: userText(codes) },
        ],
      }],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new AiError(500, 'La API key de Claude es inválida.');
    if (e instanceof Anthropic.RateLimitError) throw new AiError(429, 'Límite de la IA: intenta en un momento.');
    if (e instanceof Anthropic.APIConnectionTimeoutError) throw new AiError(504, 'La IA tardó demasiado.');
    if (e instanceof Anthropic.APIError) throw new AiError(502, `Claude: ${e.message}`);
    throw e;
  }
  if (response.stop_reason === 'refusal') throw new AiError(422, 'La IA no pudo procesar esta foto.');
  const call = response.content.find((b) => b.type === 'tool_use' && b.name === TOOL.name);
  if (!call) throw new AiError(422, 'La IA no devolvió datos.');
  return call.input;
}

/** Lo cargado en el POS; si no hay nada, la variable de entorno de Claude. */
async function loadConfig(db) {
  const cfg = (await db.collection('secrets').doc('aiConfig').get()).data() || {};
  if (cfg.apiKey) {
    const provider = cfg.provider === 'anthropic' ? 'anthropic' : 'openai';
    return { provider, apiKey: cfg.apiKey, model: cfg.model || (provider === 'openai' ? 'gpt-4o' : 'claude-opus-5-5') };
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return { provider: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY, model: 'claude-opus-5-5' };
  }
  return null;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: HEADERS, body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Método no permitido' });
  // ── Quién llama ── (misma regla que whatsapp-send)
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
  if (!(user.rol === 'administrador' || user.permissions?.canAccessEnvios === true)) {
    return reply(403, { error: 'No tienes permiso para leer guías.' });
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'JSON inválido' }); }
  const image = String(body.imageBase64 || '');
  if (!image) return reply(400, { error: 'Falta la foto.' });
  const codes = Array.isArray(body.codes) ? body.codes.map(String).slice(0, 5) : [];

  const cfg = await loadConfig(db);
  if (!cfg) {
    return reply(501, { error: 'Falta cargar la API key de la IA (Envíos → Lectura con IA).', notConfigured: true });
  }

  try {
    const data = cfg.provider === 'openai'
      ? await readWithOpenAi(cfg, image, codes)
      : await readWithClaude(cfg, image, codes);
    return reply(200, { ok: true, data, provider: cfg.provider });
  } catch (e) {
    if (e instanceof AiError) return reply(e.status, { error: e.message });
    return reply(500, { error: String(e.message || e) });
  }
};
