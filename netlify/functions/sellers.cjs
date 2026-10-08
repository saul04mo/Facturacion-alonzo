/**
 * ══════════════════════════════════════════════════════════════
 * ALONZO — API 4: los vendedores (usuarios del POS)
 * ══════════════════════════════════════════════════════════════
 *
 * Para que Dismoncatech vincule a cada asesor del chat con su usuario del
 * POS: con ese `uid` como `sellerUid`, las ventas que entran por
 * `create-order` le suman a esa persona en Informes y Nómina en vez de
 * quedar a nombre de 'BOT'.
 *
 * Sólo lo justo para elegir a alguien de una lista: uid, nombre y rol. Ni
 * cédula, ni teléfono, ni correo, ni permisos. Los repartidores (`delivery`)
 * no venden, así que no se listan.
 *
 * Autenticación: cabecera `x-api-key` (CATALOG_API_KEY), igual que las otras.
 *
 * GET /.netlify/functions/sellers
 *   → 200 { count, sellers: [{ uid, name, rol }] }   (ordenados por nombre)
 */
const { getDb, HEADERS, json, requireApiKey } = require('../lib/api-common.cjs');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { ...HEADERS, 'Access-Control-Allow-Methods': 'GET, OPTIONS' }, body: '' };
  }
  if (event.httpMethod !== 'GET') return json(405, { error: 'Método no permitido. Usa GET.' });

  const unauthorized = requireApiKey(event);
  if (unauthorized) return unauthorized;

  try {
    const snap = await getDb().collection('users').get();
    const sellers = snap.docs
      .map((d) => {
        const u = d.data();
        return {
          uid: d.id,
          name: `${u.nombre || ''} ${u.apellido || ''}`.trim() || d.id,
          rol: u.rol || 'vendedor',
        };
      })
      .filter((s) => s.rol !== 'delivery')
      .sort((a, b) => a.name.localeCompare(b.name, 'es'));

    return json(200, { count: sellers.length, sellers });
  } catch (err) {
    console.error('sellers error:', err);
    return json(500, { error: 'Error del servidor al listar los vendedores.' });
  }
};
