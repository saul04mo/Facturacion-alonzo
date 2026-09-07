/**
 * ══════════════════════════════════════════════════════════════
 * ALONZO — Tarea programada: guarda la fila de tasas del día
 * ══════════════════════════════════════════════════════════════
 *
 * Corre sola todos los días (horario en netlify.toml) para que el histórico
 * no dependa de que alguien abra el panel. Escribe en rateHistory/{dateKey}
 * con la cuenta de servicio, así que NO le afectan las reglas de Firestore.
 *
 * OJO: no toca `config/exchangeRate`. Esa es la tasa con la que se factura y
 * se sigue cambiando a mano desde Ventas o Configuración. Esto es solo el
 * registro histórico para comparar.
 *
 * Si una fuente está caída, guarda las otras y deja la que falló como estaba:
 * un null de Binance no borra el valor bueno que ya tenía la fila.
 *
 * Credenciales: FIREBASE_SERVICE_ACCOUNT (el JSON completo de la llave de
 * servicio). En `netlify dev` cae al serviceAccountKey.json local.
 */
const admin = require('firebase-admin');
const { readRates, todayVE } = require('../lib/rate-sources.cjs');

// ── Inicialización singleton (reutiliza entre invocaciones "calientes") ──
function getDb() {
  if (!admin.apps.length) {
    let credential;
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      credential = admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
    } else {
      // Respaldo SOLO para desarrollo local con `netlify dev`. El require es
      // dinámico a propósito: así esbuild NO incrusta la llave en el bundle.
      const path = require('path');
      const keyPath = path.join(__dirname, '..', '..', 'serviceAccountKey.json');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      credential = admin.credential.cert(require(keyPath));
    }
    admin.initializeApp({ credential });
  }
  return admin.firestore();
}

exports.handler = async () => {
  const dateKey = todayVE();
  const rates = await readRates();

  if (rates.bcv === null && rates.eur === null && rates.binance === null) {
    console.error('[rates-daily] ninguna fuente respondió:', rates.errors);
    // 500 hace que Netlify lo marque como fallido y quede visible en los logs.
    return { statusCode: 500, body: JSON.stringify({ dateKey, errors: rates.errors }) };
  }

  const db = getDb();
  const ref = db.collection('rateHistory').doc(dateKey);
  const existing = (await ref.get()).data() || {};

  // El valor de ahora gana, salvo que su fuente haya fallado: en ese caso se
  // conserva lo que ya estuviera guardado en vez de pisarlo con null.
  const merged = {
    dateKey,
    bcv: rates.bcv ?? existing.bcv ?? null,
    eur: rates.eur ?? existing.eur ?? null,
    binance: rates.binance ?? existing.binance ?? null,
    source: 'cron',
    capturedAt: admin.firestore.Timestamp.now(),
    capturedByName: 'Tarea programada',
  };

  await ref.set(merged);
  console.log('[rates-daily] guardado', dateKey, merged.bcv, merged.eur, merged.binance);

  return {
    statusCode: 200,
    body: JSON.stringify({ dateKey, saved: merged, errors: rates.errors }),
  };
};
