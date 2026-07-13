/**
 * ══════════════════════════════════════════════════════════════
 * ALONZO — Netlify Function: registro de cliente desde web pública
 * ══════════════════════════════════════════════════════════════
 *
 * Corre en el SERVIDOR (no en el navegador) con permisos admin, así que:
 *   - Puede LEER la colección clients para detectar duplicados sin
 *     exponer datos a visitantes anónimos.
 *   - Si la cédula o el teléfono ya existen → ACTUALIZA ese cliente y
 *     responde { existed: true } para mostrar "Ya estabas registrado".
 *   - Si no existe → crea uno nuevo con source:'web'.
 *
 * Credenciales: variable de entorno FIREBASE_SERVICE_ACCOUNT (el JSON
 * completo de la llave de servicio). En `netlify dev` cae al archivo
 * local serviceAccountKey.json como respaldo.
 */
const admin = require('firebase-admin');

// ── Inicialización singleton (reutiliza entre invocaciones "calientes") ──
function getDb() {
  if (!admin.apps.length) {
    let credential;
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      credential = admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
    } else {
      // Respaldo SOLO para desarrollo local con `netlify dev`.
      // El require es dinámico a propósito: así esbuild NO incrusta la llave
      // en el bundle desplegado (en producción se usa la env var de arriba).
      const path = require('path');
      const keyPath = path.join(__dirname, '..', '..', 'serviceAccountKey.json');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      credential = admin.credential.cert(require(keyPath));
    }
    admin.initializeApp({ credential });
  }
  return admin.firestore();
}

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function clean(s) {
  return typeof s === 'string' ? s.trim() : '';
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: HEADERS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'Método no permitido' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'JSON inválido' }) };
  }

  const name = clean(body.name);
  const rif_ci = clean(body.rif_ci);
  const phone = clean(body.phone);
  const city = clean(body.city);
  const agency = clean(body.agency);
  const addressLine = clean(body.addressLine);

  // ── Validación de servidor (no confiar solo en el front) ──
  if (name.length < 3) return bad('Nombre y apellido inválido.');
  if (!/^\d{5,}$/.test(rif_ci.replace(/\D/g, ''))) return bad('Cédula inválida.');
  if (phone.replace(/\D/g, '').length < 10) return bad('Número de WhatsApp inválido.');
  if (!city || !agency || !addressLine) return bad('Faltan datos de envío.');

  // `address` compuesto: primero agencia, luego dirección y ciudad.
  const address = `Agencia: ${agency} — ${addressLine}, ${city}`;
  const payload = {
    name, rif_ci, phone, city, agency, addressLine, address,
    source: 'web',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  try {
    const db = getDb();
    const clients = db.collection('clients');

    // ── Buscar duplicado por cédula (rif_ci o legacy 'cedula') o teléfono ──
    const cedulaDigits = rif_ci.replace(/\D/g, '');
    const [byRif, byCedula, byPhone] = await Promise.all([
      clients.where('rif_ci', '==', cedulaDigits).limit(1).get(),
      clients.where('cedula', '==', cedulaDigits).limit(1).get(),
      clients.where('phone', '==', phone).limit(1).get(),
    ]);

    const existing = !byRif.empty ? byRif.docs[0]
      : !byCedula.empty ? byCedula.docs[0]
      : !byPhone.empty ? byPhone.docs[0]
      : null;

    if (existing) {
      // Ya registrado → actualizamos sus datos de envío (merge, sin pisar todo)
      await existing.ref.set(payload, { merge: true });
      return {
        statusCode: 200,
        headers: HEADERS,
        body: JSON.stringify({ existed: true, id: existing.id, name: existing.data().name || name }),
      };
    }

    // Nuevo cliente
    payload.email = '';
    payload.createdAt = admin.firestore.FieldValue.serverTimestamp();
    const ref = await clients.add(payload);
    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({ existed: false, id: ref.id }),
    };
  } catch (err) {
    console.error('register-client error:', err);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Error del servidor' }) };
  }

  function bad(msg) {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: msg }) };
  }
};
