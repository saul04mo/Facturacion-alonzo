/**
 * Repara facturas cuyo `sellerUid` no corresponde al `sellerName`.
 *
 * Origen del problema: la reasignación de vendedor desde Historial de
 * Facturas escribía solo `sellerName` y dejaba `sellerUid` con el vendedor
 * original. Como Historial filtra por nombre pero Informes y Nómina filtran
 * por uid, esas facturas aparecían con un vendedor en un panel y con otro
 * en el resto (montos descuadrados entre Historial e Informes).
 *
 * El nombre es la fuente de verdad: es el campo que el usuario editó al
 * reasignar. Este script alinea `sellerUid` al usuario de ese nombre.
 *
 * Uso:
 *   node scripts/fix-seller-uid.cjs           # dry-run, solo lista
 *   node scripts/fix-seller-uid.cjs --apply   # escribe los cambios
 */
const admin = require('firebase-admin');
const sa = require('../serviceAccountKey.json');

admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

const APPLY = process.argv.includes('--apply');
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

(async () => {
  const usnap = await db.collection('users').get();
  const uidByName = new Map();
  const nameByUid = new Map();
  usnap.docs.forEach((d) => {
    const u = d.data();
    const uid = u.uid || d.id;
    const name = `${u.nombre || ''} ${u.apellido || ''}`.replace(/\s+/g, ' ').trim();
    if (!name) return;
    if (!uidByName.has(norm(name))) uidByName.set(norm(name), uid);
    nameByUid.set(uid, name);
  });

  const snap = await db.collection('invoices').get();
  const fixes = [];
  snap.docs.forEach((d) => {
    const inv = d.data();
    const uid = inv.sellerUid;
    // Ventas de canales automáticos: no tienen usuario al cual apuntar.
    if (uid === 'WEB' || uid === 'APP') return;
    // Vendedor histórico sin usuario en la colección: no hay uid correcto.
    const expected = uidByName.get(norm(inv.sellerName));
    if (!expected || !uid || uid === expected) return;
    // Solo corregimos reasignaciones reales: el uid actual tiene que ser el
    // de un usuario existente. Si no lo es, es un uid legado (canal web,
    // cuenta vieja) y sobrescribirlo sería adivinar.
    if (!nameByUid.has(uid)) return;
    fixes.push({
      id: d.id,
      numericId: inv.numericId,
      status: inv.status,
      total: inv.total,
      sellerName: inv.sellerName,
      from: `${uid} (${nameByUid.get(uid) || 'desconocido'})`,
      to: expected,
    });
  });

  console.log(`Facturas revisadas: ${snap.size}`);
  console.log(`Facturas a corregir: ${fixes.length}\n`);
  fixes
    .sort((a, b) => (a.numericId || 0) - (b.numericId || 0))
    .forEach((f) =>
      console.log(
        ` FACT-${f.numericId} | ${f.status} | $${f.total} | ${f.sellerName} | uid ${f.from} -> ${f.to}`,
      ),
    );

  if (!APPLY) {
    console.log('\nDRY-RUN: no se escribió nada. Correr con --apply para aplicar.');
    process.exit(0);
  }

  let batch = db.batch();
  let n = 0;
  for (const f of fixes) {
    batch.update(db.collection('invoices').doc(f.id), { sellerUid: f.to });
    if (++n % 400 === 0) { await batch.commit(); batch = db.batch(); }
  }
  if (fixes.length) await batch.commit();
  console.log(`\nListo: ${fixes.length} facturas actualizadas.`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
