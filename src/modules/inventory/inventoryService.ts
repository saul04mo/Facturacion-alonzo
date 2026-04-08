import { collection, doc, addDoc, setDoc, deleteDoc, writeBatch } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { db, storage } from '@/config/firebase';
import type { ProductVariant } from '@/types';

export interface ProductInput {
  name: string;
  gender: string;
  category: string;
  variants: ProductVariant[];
  /** Single image (legacy / primary) */
  imageFile?: File | null;
  currentImageUrl?: string;
  /** Multiple new image files to upload */
  newImageFiles?: File[];
  /** Existing image URLs to keep */
  existingImageUrls?: string[];
  /** Image URLs that were removed and should be deleted from storage */
  removedImageUrls?: string[];
}

export async function saveProduct(id: string | null, data: ProductInput): Promise<void> {
  let imageUrl = data.currentImageUrl || null;

  // Handle primary image upload (legacy single-image)
  if (data.imageFile) {
    if (id && data.currentImageUrl) {
      try { await deleteObject(ref(storage, data.currentImageUrl)); } catch { /* ignore */ }
    }
    const imageRef = ref(storage, `products/${id || Date.now()}_${data.imageFile.name}`);
    const snapshot = await uploadBytes(imageRef, data.imageFile);
    imageUrl = await getDownloadURL(snapshot.ref);
  }

  // Handle multi-image uploads
  const existingUrls = data.existingImageUrls || [];
  const uploadedUrls: string[] = [];

  // Upload new image files
  if (data.newImageFiles && data.newImageFiles.length > 0) {
    const productRef = id || Date.now().toString();
    for (const file of data.newImageFiles) {
      const imgRef = ref(storage, `products/${productRef}_${Date.now()}_${file.name}`);
      const snapshot = await uploadBytes(imgRef, file);
      const url = await getDownloadURL(snapshot.ref);
      uploadedUrls.push(url);
    }
  }

  // Delete removed images from storage
  if (data.removedImageUrls && data.removedImageUrls.length > 0) {
    for (const url of data.removedImageUrls) {
      try { await deleteObject(ref(storage, url)); } catch { /* ignore */ }
    }
  }

  // Combine existing + new URLs
  const allImageUrls = [...existingUrls, ...uploadedUrls];

  // Use first image as primary if no explicit primary exists
  if (!imageUrl && allImageUrls.length > 0) {
    imageUrl = allImageUrls[0];
  }

  const productData: Record<string, any> = {
    name: data.name,
    gender: data.gender,
    category: data.category || 'Sin Categoría',
    variants: data.variants,
    imageUrl,
    imageUrls: allImageUrls,
  };

  if (id) {
    await setDoc(doc(db, 'products', id), productData, { merge: true });
  } else {
    await addDoc(collection(db, 'products'), productData);
  }
}

export async function deleteProduct(id: string, imageUrl?: string, imageUrls?: string[]): Promise<void> {
  // Delete primary image
  if (imageUrl) {
    try { await deleteObject(ref(storage, imageUrl)); } catch { /* ignore */ }
  }
  // Delete all gallery images
  if (imageUrls && imageUrls.length > 0) {
    for (const url of imageUrls) {
      if (url !== imageUrl) { // Don't double-delete the primary
        try { await deleteObject(ref(storage, url)); } catch { /* ignore */ }
      }
    }
  }
  await deleteDoc(doc(db, 'products', id));
}

export async function bulkUpdatePrices(
  products: { id: string; variants: ProductVariant[] }[],
  newPrice: number,
): Promise<number> {
  const batch = writeBatch(db);
  let count = 0;

  products.forEach((product) => {
    const updatedVariants = product.variants.map((v) => ({ ...v, price: newPrice }));
    batch.update(doc(db, 'products', product.id), { variants: updatedVariants });
    count++;
  });

  if (count > 0) await batch.commit();
  return count;
}
