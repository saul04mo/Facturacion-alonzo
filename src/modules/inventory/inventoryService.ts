import { collection, doc, addDoc, setDoc, deleteDoc, writeBatch } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { db, storage } from '@/config/firebase';
import { compressImage, compressImages } from '@/utils/imageUtils';
import type { ProductVariant } from '@/types';

export interface ProductInput {
  name: string;
  description?: string;
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
    const compressed = await compressImage(data.imageFile, 1600, 0.92);
    const imageRef = ref(storage, `products/${id || Date.now()}_${compressed.name}`);
    const snapshot = await uploadBytes(imageRef, compressed);
    imageUrl = await getDownloadURL(snapshot.ref);
  }

  // Handle multi-image uploads
  const existingUrls = data.existingImageUrls || [];
  const uploadedUrls: string[] = [];

  // Upload new image files (compressed)
  if (data.newImageFiles && data.newImageFiles.length > 0) {
    const productRef = id || Date.now().toString();
    const compressedFiles = await compressImages(data.newImageFiles, 1600, 0.92);
    for (const file of compressedFiles) {
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
    description: data.description || '',
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

/** Visibilidad en la tienda web pública (campo `active`, el que lee alonzo-store-web). */
export async function toggleProductActive(id: string, active: boolean): Promise<void> {
  await setDoc(doc(db, 'products', id), { active }, { merge: true });
}

/** Visibilidad en el POS. Independiente de la web. */
export async function toggleProductPosVisible(id: string, posVisible: boolean): Promise<void> {
  await setDoc(doc(db, 'products', id), { posVisible }, { merge: true });
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

// ============================================================
// CAMBIO DE PRECIOS POR CATEGORÍA
// ============================================================

/** Cómo se calcula el precio nuevo a partir del actual. */
export type PriceMode =
  /** Precio fijo: todas las variantes quedan en `value`. */
  | 'fixed'
  /** Porcentaje: precio * (1 + value/100). `value` puede ser negativo. */
  | 'percent'
  /** Monto: precio + value. `value` puede ser negativo. */
  | 'amount';

/** Redondeo aplicado al precio calculado. */
export type PriceRounding = 'none' | 'integer' | 'ends99';

export interface PriceChangeOptions {
  mode: PriceMode;
  value: number;
  rounding?: PriceRounding;
}

/**
 * Calcula el precio nuevo de UNA variante. Exportado aparte para que la UI
 * pueda mostrar la previsualización con exactamente la misma fórmula que
 * después se persiste (evita que preview y resultado se desincronicen).
 */
export function calcNewPrice(current: number, opts: PriceChangeOptions): number {
  const base = Number.isFinite(current) ? current : 0;
  let next: number;

  switch (opts.mode) {
    case 'fixed': next = opts.value; break;
    case 'percent': next = base * (1 + opts.value / 100); break;
    case 'amount': next = base + opts.value; break;
  }

  if (!Number.isFinite(next) || next < 0) next = 0;

  switch (opts.rounding) {
    case 'integer':
      next = Math.round(next);
      break;
    case 'ends99':
      // 12.40 → 12.99 · 12.99 → 12.99 · 0.50 → 0.99
      next = Math.floor(next) + 0.99;
      break;
    default:
      next = Math.round(next * 100) / 100;
  }

  return Math.round(next * 100) / 100;
}

/** Límite de operaciones por batch en Firestore. */
const BATCH_LIMIT = 450;

/**
 * Aplica un cambio de precio a todas las variantes de los productos dados.
 * Devuelve cuántos productos se actualizaron.
 *
 * Se escribe el array `variants` completo (Firestore no permite actualizar
 * elementos sueltos de un array), y se trocea en batches por el límite de
 * 500 escrituras.
 */
export async function bulkUpdatePrices(
  products: { id: string; variants: ProductVariant[] }[],
  opts: PriceChangeOptions,
): Promise<number> {
  let count = 0;

  for (let i = 0; i < products.length; i += BATCH_LIMIT) {
    const chunk = products.slice(i, i + BATCH_LIMIT);
    const batch = writeBatch(db);

    chunk.forEach((product) => {
      const updatedVariants = (product.variants || []).map((v) => ({
        ...v,
        price: calcNewPrice(v.price, opts),
      }));
      batch.update(doc(db, 'products', product.id), { variants: updatedVariants });
      count++;
    });

    await batch.commit();
  }

  return count;
}
