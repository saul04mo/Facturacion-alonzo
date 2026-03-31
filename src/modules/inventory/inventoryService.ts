import { collection, doc, addDoc, setDoc, deleteDoc, writeBatch } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { db, storage } from '@/config/firebase';
import type { ProductVariant } from '@/types';

export interface ProductInput {
  name: string;
  gender: string;
  category: string;
  variants: ProductVariant[];
  imageFile?: File | null;
  currentImageUrl?: string;
}

export async function saveProduct(id: string | null, data: ProductInput): Promise<void> {
  let imageUrl = data.currentImageUrl || null;

  // Handle image upload
  if (data.imageFile) {
    if (id && data.currentImageUrl) {
      try { await deleteObject(ref(storage, data.currentImageUrl)); } catch { /* ignore */ }
    }
    const imageRef = ref(storage, `products/${id || Date.now()}_${data.imageFile.name}`);
    const snapshot = await uploadBytes(imageRef, data.imageFile);
    imageUrl = await getDownloadURL(snapshot.ref);
  }

  const productData = {
    name: data.name,
    gender: data.gender,
    category: data.category || 'Sin Categoría',
    variants: data.variants,
    imageUrl,
  };

  if (id) {
    await setDoc(doc(db, 'products', id), productData, { merge: true });
  } else {
    await addDoc(collection(db, 'products'), productData);
  }
}

export async function deleteProduct(id: string, imageUrl?: string): Promise<void> {
  if (imageUrl) {
    try { await deleteObject(ref(storage, imageUrl)); } catch { /* ignore */ }
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
