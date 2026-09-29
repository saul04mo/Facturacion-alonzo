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

/**
 * Instrucciones FIJAS. Van primero y nunca cambian entre fotos: así las
 * cachean los proveedores (OpenAI desde 1.024 tokens, automático; Claude con
 * cache_control, desde 512). Por eso son largas a propósito: por debajo de
 * 1.024 tokens OpenAI no cachea nada. Los ejemplos también mejoran la lectura.
 *
 * OJO: cualquier cambio acá (aunque sea un espacio) invalida el caché. Nada
 * variable (fechas, IDs, el nombre del usuario) puede entrar en este texto:
 * lo que cambia por foto va en el mensaje del usuario, después de la imagen.
 * Los ejemplos usan datos INVENTADOS: no se mandan datos de clientes reales.
 */
const SYSTEM = `Lees fotos de guías de envío venezolanas (MRW, Zoom, Tealca u otras) que manda la Tienda Alonzo, y extraes los datos del DESTINATARIO para avisarle por WhatsApp que su pedido va en camino.

# Reglas

1. El REMITENTE es siempre la tienda: "TIENDA ALONZO", "TIENDAALONZO" o "ALONZO", teléfono 04123380976, RIF J-502846239. Nunca lo devuelvas como destinatario ni uses ese teléfono.
2. Si el mensaje trae códigos ya decodificados (QR, código de barras, DataMatrix), el número de guía que contienen es exacto: úsalo antes que lo que leas en la foto.
3. Copia los dígitos exactamente como se ven. Si un dato no está en la guía o no se lee con seguridad, devuelve "" (vacío). No adivines ni completes dígitos: un número equivocado hace que el mensaje le llegue a otra persona.
4. cedula: solo los dígitos, sin V-, E-, puntos ni espacios ("V-12.345.678" → "12345678").
5. phone: formato nacional de 11 dígitos 04XXXXXXXXX. Si viene sin el 0 ("424-5550101") agrégalo ("04245550101"). Si aparece dos veces separado por "/", es el mismo número: devuélvelo una vez.
6. name: en MAYÚSCULAS, tal como está impreso, sin la cédula ni el teléfono.
7. destination: corto, la agencia u oficina y la ciudad ("ZOOM AV BOLIVAR — VALENCIA", "BARQUISIMETO (retira en oficina)").
8. carrier: MRW, ZOOM, TEALCA u OTRO.
9. La foto puede venir girada, torcida, con reflejos, con plástico encima o con la impresión térmica gastada. Lee la etiqueta en la orientación que corresponda.

# Cómo es cada guía (ejemplos con datos inventados)

## MRW
Arriba dice "TRACKING" y un número de 15 dígitos. Trae un QR grande a la derecha.
  TRACKING
  013301005002314
  REMITENTE: TIENDA ALONZO        J-502846239  TLF 04123380976
  ORIGEN: 0133000 LA FLORIDA      DESTINO: RETIRAR POR OFICINA - 1005000 CENTRO
  DEST: MARIA PEREZ V-20111222                 TLF:04145550101
  DIR: AV. PRINCIPAL, EDIF. SOL, PISO 2 ... MNCP: VALENCIA EDO: CARABOBO
  ...
  ENSACADO PARA (VALENCIA)
Resultado: carrier MRW, tracking 013301005002314, name MARIA PEREZ, cedula 20111222, phone 04145550101, destination "RETIRAR POR OFICINA - CENTRO — VALENCIA".
Ojo: el primer TLF (04123380976) es de la tienda; el del destinatario está en la línea de DEST.

## Zoom (dos formatos)
Arriba dice "ZOOM" y un número de 10 dígitos que empieza por 1; a la derecha, un código de 3 letras (MUN, ETG, PZO, MYC...). Trae código de barras y un DataMatrix cuadrado.
Formato A:
  ZOOM      1867400001                 MUN
  Remitente: ALONZO
  Origen: ZOOM LA URBINA
  Destinatario:JOSE RAMIREZ(V-15222333)(Tel.424-5550202)
  Destino: (ZOOM AV UNIVERSIDAD) ... CIUDAD:MATURIN,ESTADO:MONAGAS
Resultado: ZOOM, 1867400001, JOSE RAMIREZ, 15222333, 04245550202, "ZOOM AV UNIVERSIDAD — MATURIN".
Formato B:
  ZOOM      1709000002                 ETG
  Remitente: TIENDAALONZO
  Origen: ZOOM LA URBINA - LOGISTICA INTERNACIONAL VC, C.A
  Destinatario:ANA TORRES (RIF/CI.V-9888777)
  Destino: CALLE 5 SUR ... MUNICIPIO:SIMON RODRIGUEZ; EL TIGRE; ANZOATEGUI; VENEZUELA
  (TEL.04265550303/4265550303)
Resultado: ZOOM, 1709000002, ANA TORRES, 9888777, 04265550303, "EL TIGRE".
En el formato B el teléfono va varias líneas debajo del destinatario. "Cod. Seg." es un código de seguridad, no la guía.

## Tealca
Etiqueta angosta, casi siempre girada 90°. Logo de un águila y "tealca.com". Código de barras largo.
  GUIA: 84870005        Aliada/PreGuia: 0000000
  SERV: COD-ESTANDAR-OFICINA
  ORIG: CCS-1102
  DEST: BARCELONA
  NOMB: CARLOS MENDOZA R
  FECH: 25-09-26 16:19
  PESO: 0.850   PZA: 001/001
Resultado: TEALCA, 84870005, CARLOS MENDOZA R, cedula "", phone "", "BARCELONA (retira en oficina)".
Tealca no trae cédula ni teléfono: devuélvelos vacíos. El nombre puede venir cortado al final (una inicial suelta); cópialo igual.

## Otras empresas
Busca las palabras destinatario / dest / consignatario / para, y el número de guía o tracking. Si no reconoces la empresa, carrier OTRO.

# Errores comunes que debes evitar

- Confundir "DESTINO:" (la oficina o ciudad) con "DEST:" (en MRW es el destinatario, en Tealca es la ciudad).
- Tomar el número de "Origen", "Ref.", "Cod. Seg.", "Aliada/PreGuia", el peso, el monto a cobrar ("Bs. 6.468,99") o la fecha como número de guía.
- Tomar la cédula de la línea del remitente: en algunas guías de Zoom la cédula del destinatario aparece repetida arriba a la derecha, junto al remitente; la válida es la que está pegada al nombre del destinatario.
- Leer "O" por "0", "I" o "l" por "1", "S" por "5" o "B" por "8" dentro de números: en guías, cédulas y teléfonos solo hay dígitos.
- Juntar dos líneas de nombre y dirección: el nombre termina donde empieza el paréntesis, la cédula o la palabra "DIR".
- Inventar un teléfono cuando la guía no lo trae. Mejor vacío.

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
  let data;
  try {
    data = JSON.parse(msg?.content || '');
  } catch {
    throw new AiError(422, 'La IA no devolvió datos.');
  }
  // OpenAI cachea solo, sin marcar nada: cached_tokens dice cuánto del prompt
  // salió del caché (se paga con descuento).
  const u = j.usage || {};
  return {
    data,
    usage: { input: u.prompt_tokens || 0, cached: u.prompt_tokens_details?.cached_tokens || 0, cacheWrite: 0, output: u.completion_tokens || 0 },
  };
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
      // El prefijo fijo (tools + system) se cachea: las lecturas siguientes lo
      // pagan al 10%. La imagen va después y es lo único que cambia.
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
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
  const u = response.usage;
  return {
    data: call.input,
    usage: { input: u.input_tokens, cached: u.cache_read_input_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0, output: u.output_tokens },
  };
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
    const { data, usage } = cfg.provider === 'openai'
      ? await readWithOpenAi(cfg, image, codes)
      : await readWithClaude(cfg, image, codes);
    // Queda en los logs de Netlify para ver si el caché está funcionando.
    console.log('guide-read', cfg.provider, cfg.model, JSON.stringify(usage));
    return reply(200, { ok: true, data, usage, provider: cfg.provider });
  } catch (e) {
    if (e instanceof AiError) return reply(e.status, { error: e.message });
    return reply(500, { error: String(e.message || e) });
  }
};
