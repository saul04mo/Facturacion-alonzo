/**
 * ══════════════════════════════════════════════════════════════
 * ALONZO — Script de Estandarización de Datos en Firestore
 * ══════════════════════════════════════════════════════════════
 *
 * DESCRIPCIÓN:
 * Este script corrige todas las inconsistencias de datos que se
 * acumularon por haber creado facturas y clientes desde distintas
 * plataformas (POS, Web, App) en diferentes momentos del desarrollo.
 *
 * QUÉ HACE:
 *
 * 1. CLIENTES (colección: clients)
 *    - Unifica campo "nombre" → "name" (mantiene ambos por compat)
 *    - Unifica campo "cedula" → "rif_ci"
 *    - Unifica campo "direccion" → "address"
 *    - Asegura que todos tengan: name, rif_ci, phone, email, address
 *    - NO borra campos legacy, solo AGREGA los estandarizados
 *
 * 2. FACTURAS — Items (colección: invoices, campo: items[])
 *    Items viejos solo tienen: { productId, variantIndex, quantity }
 *    Items web tienen: { titulo, precio, qty, size, color }
 *    Este script agrega los campos estándar a TODOS los items:
 *    - productName: nombre real del producto (busca en products)
 *    - priceAtSale: precio de la variante (busca en products)
 *    - quantity: normalizado (de qty, cantidad, etc.)
 *    - variantLabel: "M / Negro" (busca en products o parsea)
 *    - NO borra campos legacy (titulo, precio, qty siguen ahí)
 *
 * 3. FACTURAS — clientSnapshot
 *    - Asegura que todos los snapshots tengan: name, rif_ci, phone, address
 *    - Unifica nombre/cedula/direccion → name/rif_ci/address
 *
 * SEGURIDAD:
 * - Modo DRY RUN por defecto: solo muestra qué cambiaría sin tocar nada
 * - Para ejecutar real: node standardize-data.js --execute
 * - Genera reporte al final con estadísticas
 * - NO borra datos, solo AGREGA campos estandarizados
 *
 * CÓMO USARLO:
 *   cd alonzoapp       (o donde tengas firebase configurado)
 *   node scripts/standardize-data.js              ← dry run (solo muestra)
 *   node scripts/standardize-data.js --execute    ← ejecuta los cambios
 *
 * ══════════════════════════════════════════════════════════════
 */

const admin = require('firebase-admin');

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const DRY_RUN = !process.argv.includes('--execute');

// Stats
const stats = {
  clients: { total: 0, updated: 0, skipped: 0 },
  invoices: { total: 0, updated: 0, skipped: 0 },
  items: { total: 0, fixed_name: 0, fixed_price: 0, fixed_variant: 0, fixed_qty: 0 },
  snapshots: { total: 0, fixed: 0 },
};

// ══════════════════════════════════════════
// STEP 1: Load Products (needed to resolve item names/prices)
// ══════════════════════════════════════════
async function loadProducts() {
  console.log('\n📦 Cargando productos...');
  const snap = await db.collection('products').get();
  const products = {};
  snap.forEach(doc => {
    products[doc.id] = { id: doc.id, ...doc.data() };
  });
  console.log(`   ${Object.keys(products).length} productos cargados.`);
  return products;
}

// ══════════════════════════════════════════
// STEP 2: Standardize Clients
// ══════════════════════════════════════════
async function standardizeClients() {
  console.log('\n👥 Estandarizando clientes...');
  const snap = await db.collection('clients').get();
  const batch = db.batch();
  let batchCount = 0;

  for (const doc of snap.docs) {
    stats.clients.total++;
    const data = doc.data();
    const updates = {};

    // name ← nombre
    if (!data.name && data.nombre) {
      updates.name = data.nombre;
    }
    // Ensure name exists
    if (!data.name && !data.nombre) {
      updates.name = 'Sin nombre';
    }

    // rif_ci ← cedula
    if (!data.rif_ci && data.cedula) {
      updates.rif_ci = data.cedula;
    }

    // address ← direccion
    if (!data.address && data.direccion) {
      updates.address = data.direccion;
    }

    // Ensure phone exists
    if (data.phone === undefined) {
      updates.phone = data.telefono || '';
    }

    // Ensure email exists
    if (data.email === undefined) {
      updates.email = '';
    }

    // Ensure address exists
    if (data.address === undefined && !data.direccion) {
      updates.address = '';
    }

    if (Object.keys(updates).length > 0) {
      stats.clients.updated++;
      if (!DRY_RUN) {
        batch.update(doc.ref, updates);
        batchCount++;
        if (batchCount >= 450) {
          await batch.commit();
          batchCount = 0;
        }
      } else {
        console.log(`   🔧 ${data.name || data.nombre || doc.id}: ${JSON.stringify(updates)}`);
      }
    } else {
      stats.clients.skipped++;
    }
  }

  if (!DRY_RUN && batchCount > 0) {
    await batch.commit();
  }
  console.log(`   ✅ ${stats.clients.updated} clientes actualizados, ${stats.clients.skipped} ya estaban bien.`);
}

// ══════════════════════════════════════════
// STEP 3: Standardize Invoices
// ══════════════════════════════════════════
async function standardizeInvoices(products) {
  console.log('\n🧾 Estandarizando facturas...');
  const snap = await db.collection('invoices').get();
  
  // Process in batches of 450 (Firestore limit is 500 per batch)
  let batch = db.batch();
  let batchCount = 0;

  for (const doc of snap.docs) {
    stats.invoices.total++;
    const data = doc.data();
    let needsUpdate = false;
    const updates = {};

    // ── Fix items ──
    const items = data.items || [];
    const fixedItems = items.map((item, idx) => {
      stats.items.total++;
      const fixed = { ...item };
      const product = item.productId ? products[item.productId] : null;
      const variant = product?.variants?.[item.variantIndex];

      // Fix productName
      if (!item.productName || item.productName === 'Producto') {
        const name = product?.name || item.titulo || item.name || item.producto || item.nombre || null;
        if (name) {
          fixed.productName = name;
          stats.items.fixed_name++;
          needsUpdate = true;
        }
      }

      // Fix priceAtSale
      if (item.priceAtSale === undefined || item.priceAtSale === null) {
        const price = variant?.price ?? item.price ?? item.precio ?? null;
        if (price !== null) {
          fixed.priceAtSale = typeof price === 'string' ? parseFloat(price) : price;
          stats.items.fixed_price++;
          needsUpdate = true;
        }
      }
      // Ensure priceAtSale is number not string
      if (typeof fixed.priceAtSale === 'string') {
        fixed.priceAtSale = parseFloat(fixed.priceAtSale) || 0;
        stats.items.fixed_price++;
        needsUpdate = true;
      }

      // Fix quantity (from qty, cantidad)
      if (item.quantity === undefined || item.quantity === null) {
        const qty = item.qty || item.cantidad || 1;
        fixed.quantity = qty;
        stats.items.fixed_qty++;
        needsUpdate = true;
      }

      // Fix variantLabel
      if (!item.variantLabel) {
        let size = item.size || item.selectedSize || item.talla || variant?.size || 'N/A';
        let color = item.color || item.selectedColor || variant?.color || 'N/A';
        fixed.variantLabel = `${size} / ${color}`;
        stats.items.fixed_variant++;
        needsUpdate = true;
      }

      return fixed;
    });

    if (needsUpdate) {
      updates.items = fixedItems;
    }

    // ── Fix clientSnapshot ──
    const cs = data.clientSnapshot;
    if (cs) {
      stats.snapshots.total++;
      const csUpdates = { ...cs };
      let csChanged = false;

      if (!cs.name && cs.nombre) {
        csUpdates.name = cs.nombre;
        csChanged = true;
      }
      if (!cs.rif_ci && cs.cedula) {
        csUpdates.rif_ci = cs.cedula;
        csChanged = true;
      }
      if (!cs.address && cs.direccion) {
        csUpdates.address = cs.direccion;
        csChanged = true;
      }
      // Ensure fields exist
      if (csUpdates.phone === undefined) {
        csUpdates.phone = cs.telefono || '';
        csChanged = true;
      }

      if (csChanged) {
        updates.clientSnapshot = csUpdates;
        stats.snapshots.fixed++;
      }
    }

    // ── Apply updates ──
    if (Object.keys(updates).length > 0) {
      stats.invoices.updated++;
      if (!DRY_RUN) {
        batch.update(doc.ref, updates);
        batchCount++;
        if (batchCount >= 450) {
          await batch.commit();
          batch = db.batch();
          batchCount = 0;
          process.stdout.write(`   💾 ${stats.invoices.updated} facturas procesadas...\r`);
        }
      } else {
        const numericId = data.numericId || '?';
        const itemFixes = fixedItems.filter((fi, i) => {
          const orig = items[i];
          return !orig.productName || orig.priceAtSale === undefined || !orig.variantLabel || orig.quantity === undefined;
        }).length;
        if (itemFixes > 0) {
          console.log(`   🔧 FACT-${String(numericId).padStart(4, '0')}: ${itemFixes} items sin datos completos → arreglados`);
        }
      }
    } else {
      stats.invoices.skipped++;
    }
  }

  if (!DRY_RUN && batchCount > 0) {
    await batch.commit();
  }
  console.log(`   ✅ ${stats.invoices.updated} facturas actualizadas, ${stats.invoices.skipped} ya estaban bien.`);
}

// ══════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════
async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  ALONZO — Estandarización de Datos en Firestore');
  console.log('═══════════════════════════════════════════════════════');

  if (DRY_RUN) {
    console.log('\n⚠️  MODO DRY RUN — No se modificará ningún dato.');
    console.log('   Para ejecutar real: node scripts/standardize-data.js --execute\n');
  } else {
    console.log('\n🚨 MODO EJECUCIÓN — Se modificarán datos en Firestore.');
    console.log('   Esperando 5 segundos para cancelar (Ctrl+C)...\n');
    await new Promise(r => setTimeout(r, 5000));
  }

  // Load products first (needed for item resolution)
  const products = await loadProducts();

  // Step 1: Clients
  await standardizeClients();

  // Step 2: Invoices (items + clientSnapshot)
  await standardizeInvoices(products);

  // Report
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  REPORTE FINAL');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`\n  👥 CLIENTES:`);
  console.log(`     Total:        ${stats.clients.total}`);
  console.log(`     Actualizados: ${stats.clients.updated}`);
  console.log(`     Ya estaban OK:${stats.clients.skipped}`);

  console.log(`\n  🧾 FACTURAS:`);
  console.log(`     Total:        ${stats.invoices.total}`);
  console.log(`     Actualizadas: ${stats.invoices.updated}`);
  console.log(`     Ya estaban OK:${stats.invoices.skipped}`);

  console.log(`\n  📦 ITEMS DE FACTURAS:`);
  console.log(`     Total items:     ${stats.items.total}`);
  console.log(`     Nombre arreglado:${stats.items.fixed_name}`);
  console.log(`     Precio arreglado:${stats.items.fixed_price}`);
  console.log(`     Variante arregl.:${stats.items.fixed_variant}`);
  console.log(`     Cantidad arregl.:${stats.items.fixed_qty}`);

  console.log(`\n  👤 CLIENT SNAPSHOTS:`);
  console.log(`     Total:        ${stats.snapshots.total}`);
  console.log(`     Arreglados:   ${stats.snapshots.fixed}`);

  if (DRY_RUN) {
    console.log('\n⚠️  Esto fue un DRY RUN. Para aplicar los cambios:');
    console.log('   node scripts/standardize-data.js --execute\n');
  } else {
    console.log('\n✅ Todos los cambios aplicados exitosamente.\n');
  }
}

main().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
