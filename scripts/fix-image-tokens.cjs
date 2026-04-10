/**
 * Fix compressed images that were uploaded without download tokens.
 * Adds firebaseStorageDownloadTokens metadata and updates Firestore URLs.
 */
const admin = require('firebase-admin');
const { v4: uuidv4 } = require('uuid');

if (!admin.apps.length) {
  admin.initializeApp({
    storageBucket: 'alozo-2633a.firebasestorage.app',
  });
}
const db = admin.firestore();
const bucket = admin.storage().bucket();

async function main() {
  console.log('Fixing compressed image tokens...\n');

  const snap = await db.collection('products').get();
  let fixed = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    const updates = {};
    let changed = false;

    // Fix primary imageUrl
    if (data.imageUrl && data.imageUrl.includes('compressed_') && !data.imageUrl.includes('token=')) {
      const newUrl = await addToken(data.imageUrl);
      if (newUrl) {
        updates.imageUrl = newUrl;
        changed = true;
        console.log(`✅ ${data.name}: primary fixed`);
      }
    }

    // Fix gallery imageUrls
    if (data.imageUrls && Array.isArray(data.imageUrls)) {
      const newUrls = [];
      let galleryChanged = false;
      for (const url of data.imageUrls) {
        if (url && url.includes('compressed_') && !url.includes('token=')) {
          const newUrl = await addToken(url);
          if (newUrl) {
            newUrls.push(newUrl);
            galleryChanged = true;
          } else {
            newUrls.push(url);
          }
        } else {
          newUrls.push(url);
        }
      }
      if (galleryChanged) {
        updates.imageUrls = newUrls;
        changed = true;
      }
    }

    if (changed) {
      await db.collection('products').doc(doc.id).update(updates);
      fixed++;
    }
  }

  console.log(`\n✅ ${fixed} productos arreglados.`);
}

async function addToken(url) {
  try {
    // Extract file path from URL
    const match = url.match(/\/o\/(.+?)\?/);
    if (!match) return null;
    const filePath = decodeURIComponent(match[1]);

    const file = bucket.file(filePath);
    const [exists] = await file.exists();
    if (!exists) {
      console.log(`   ⚠️  File not found: ${filePath}`);
      return null;
    }

    // Add download token
    const token = uuidv4();
    await file.setMetadata({
      metadata: {
        firebaseStorageDownloadTokens: token,
      },
    });

    // Return URL with token
    return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(filePath)}?alt=media&token=${token}`;
  } catch (err) {
    console.error(`   ❌ Error: ${err.message}`);
    return null;
  }
}

main().catch(console.error);
