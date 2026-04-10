/**
 * ══════════════════════════════════════════════════════════════
 * ALONZO — Compresión de imágenes existentes en Firebase Storage
 * ══════════════════════════════════════════════════════════════
 *
 * DESCRIPCIÓN:
 * Descarga todas las imágenes de productos desde Firebase Storage,
 * las comprime a WebP (max 1200px, 82% quality), las re-sube,
 * y actualiza las URLs en Firestore.
 *
 * REQUISITOS:
 *   npm install sharp firebase-admin
 *
 * USO:
 *   node scripts/compress-images.cjs              ← dry run
 *   node scripts/compress-images.cjs --execute    ← ejecuta
 *
 * ══════════════════════════════════════════════════════════════
 */

const admin = require('firebase-admin');
const sharp = require('sharp');
const https = require('https');
const http = require('http');
const path = require('path');

if (!admin.apps.length) {
  admin.initializeApp({
    storageBucket: 'alozo-2633a.firebasestorage.app',
  });
}
const db = admin.firestore();
const bucket = admin.storage().bucket();

const DRY_RUN = !process.argv.includes('--execute');
const MAX_WIDTH = 1200;
const QUALITY = 82;

const stats = {
  total: 0,
  compressed: 0,
  skipped: 0,
  errors: 0,
  savedBytes: 0,
};

/**
 * Download image from URL to buffer
 */
function downloadImage(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return downloadImage(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

/**
 * Compress a single image buffer with sharp
 */
async function compressBuffer(buffer) {
  const meta = await sharp(buffer).metadata();
  let pipeline = sharp(buffer);

  // Resize if wider than MAX_WIDTH
  if (meta.width && meta.width > MAX_WIDTH) {
    pipeline = pipeline.resize(MAX_WIDTH, null, { withoutEnlargement: true });
  }

  // Convert to WebP
  return pipeline.webp({ quality: QUALITY }).toBuffer();
}

/**
 * Process a single image URL: download, compress, upload, return new URL
 */
async function processImage(imageUrl, productId, label) {
  try {
    // Download
    const original = await downloadImage(imageUrl);
    const originalSize = original.length;

    // Skip if already small (< 150KB)
    if (originalSize < 150 * 1024) {
      console.log(`   ⏭  ${label}: ${(originalSize / 1024).toFixed(0)}KB — already small, skipping`);
      stats.skipped++;
      return null; // null = no change needed
    }

    // Compress
    const compressed = await compressBuffer(original);
    const newSize = compressed.length;
    const reduction = Math.round((1 - newSize / originalSize) * 100);

    // Skip if compression didn't help much (< 10% reduction)
    if (reduction < 10) {
      console.log(`   ⏭  ${label}: ${(originalSize / 1024).toFixed(0)}KB → ${(newSize / 1024).toFixed(0)}KB (${reduction}%) — minimal gain, skipping`);
      stats.skipped++;
      return null;
    }

    console.log(`   ✅ ${label}: ${(originalSize / 1024).toFixed(0)}KB → ${(newSize / 1024).toFixed(0)}KB (${reduction}% reduction)`);
    stats.savedBytes += (originalSize - newSize);

    if (DRY_RUN) {
      stats.compressed++;
      return null;
    }

    // Upload compressed version
    const fileName = `products/compressed_${productId}_${Date.now()}.webp`;
    const file = bucket.file(fileName);
    await file.save(compressed, {
      metadata: { contentType: 'image/webp' },
      public: true,
    });

    // Get download URL
    const [url] = await file.getSignedUrl({
      action: 'read',
      expires: '03-01-2030',
    });

    // Try to get public URL instead (works if bucket has public access)
    const publicUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(fileName)}?alt=media`;

    stats.compressed++;
    return publicUrl;
  } catch (err) {
    console.error(`   ❌ ${label}: ${err.message}`);
    stats.errors++;
    return null;
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  ALONZO — Compresión de Imágenes de Productos');
  console.log('═══════════════════════════════════════════════════════');

  if (DRY_RUN) {
    console.log('\n⚠️  MODO DRY RUN — No se modificará ningún archivo.');
    console.log('   Para ejecutar: node scripts/compress-images.cjs --execute\n');
  } else {
    console.log('\n🚨 MODO EJECUCIÓN — Se comprimirán y re-subirán imágenes.');
    console.log('   Esperando 5 segundos para cancelar (Ctrl+C)...\n');
    await new Promise(r => setTimeout(r, 5000));
  }

  const snap = await db.collection('products').get();
  console.log(`📦 ${snap.size} productos encontrados.\n`);

  for (const doc of snap.docs) {
    stats.total++;
    const data = doc.data();
    const productId = doc.id;
    const name = data.name || 'Sin nombre';
    console.log(`\n🏷  ${name} (${productId})`);

    const updates = {};
    let changed = false;

    // Process primary image
    if (data.imageUrl && data.imageUrl.startsWith('http')) {
      const newUrl = await processImage(data.imageUrl, productId, 'Primary');
      if (newUrl) {
        updates.imageUrl = newUrl;
        changed = true;
      }
    }

    // Process gallery images
    if (data.imageUrls && Array.isArray(data.imageUrls) && data.imageUrls.length > 0) {
      const newUrls = [];
      let galleryChanged = false;
      for (let i = 0; i < data.imageUrls.length; i++) {
        const url = data.imageUrls[i];
        if (url && url.startsWith('http')) {
          const newUrl = await processImage(url, `${productId}_g${i}`, `Gallery[${i}]`);
          if (newUrl) {
            newUrls.push(newUrl);
            galleryChanged = true;
          } else {
            newUrls.push(url); // Keep original
          }
        } else {
          newUrls.push(url);
        }
      }
      if (galleryChanged) {
        updates.imageUrls = newUrls;
        // Update primary if it was the first gallery image
        if (!updates.imageUrl && newUrls[0] !== data.imageUrls[0]) {
          updates.imageUrl = newUrls[0];
        }
        changed = true;
      }
    }

    // Update Firestore
    if (changed && !DRY_RUN) {
      await db.collection('products').doc(productId).update(updates);
      console.log(`   💾 Firestore actualizado.`);
    }
  }

  // Report
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  REPORTE FINAL');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Productos:     ${stats.total}`);
  console.log(`  Comprimidos:   ${stats.compressed}`);
  console.log(`  Sin cambio:    ${stats.skipped}`);
  console.log(`  Errores:       ${stats.errors}`);
  console.log(`  Ahorro total:  ${(stats.savedBytes / 1024 / 1024).toFixed(2)} MB`);

  if (DRY_RUN) {
    console.log('\n⚠️  Dry run. Para ejecutar: node scripts/compress-images.cjs --execute\n');
  } else {
    console.log('\n✅ Compresión completada.\n');
  }
}

main().catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
});
