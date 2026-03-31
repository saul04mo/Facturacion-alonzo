import { collection, doc, addDoc, setDoc, deleteDoc, query, where, getDocs, limit } from 'firebase/firestore';
import { db } from '@/config/firebase';

export interface ClientInput {
  name: string;
  rif_ci: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
}

/** Check if a client with same cedula/phone already exists (excluding editId) */
export async function checkDuplicate(data: { rif_ci?: string | null, phone?: string | null }, editId?: string): Promise<string | null> {
  const checks: Promise<string | null>[] = [];

  if (data.rif_ci) {
    const checkRif = async () => {
      const q1 = query(collection(db, 'clients'), where('rif_ci', '==', data.rif_ci));
      const s1 = await getDocs(q1);
      const match1 = s1.docs.find(d => !editId || d.id !== editId);
      if (match1) return `Cédula/RIF ya registrada a nombre de: ${match1.data().name || match1.data().nombre}`;

      const q2 = query(collection(db, 'clients'), where('cedula', '==', data.rif_ci));
      const s2 = await getDocs(q2);
      const match2 = s2.docs.find(d => !editId || d.id !== editId);
      if (match2) return `Cédula ya registrada (formato antiguo) a nombre de: ${match2.data().name || match2.data().nombre}`;
      return null;
    };
    checks.push(checkRif());
  }

  if (data.phone) {
    const checkPhone = async () => {
      const q = query(collection(db, 'clients'), where('phone', '==', data.phone));
      const snap = await getDocs(q);
      const match = snap.docs.find(d => !editId || d.id !== editId);
      if (match) return `Teléfono ya registrado a nombre de: ${match.data().name || match.data().nombre}`;
      return null;
    };
    checks.push(checkPhone());
  }

  const results = await Promise.all(checks);
  return results.find(str => str !== null) || null;
}

export async function saveClient(id: string | null, data: ClientInput): Promise<string> {
  if (id) {
    await setDoc(doc(db, 'clients', id), data, { merge: true });
    return id;
  } else {
    const ref = await addDoc(collection(db, 'clients'), data);
    return ref.id;
  }
}

export async function deleteClient(id: string): Promise<void> {
  await deleteDoc(doc(db, 'clients', id));
}

export async function searchClientByCedula(cedula: string) {
  const q = query(collection(db, 'clients'), where('rif_ci', '==', cedula));
  const snap = await getDocs(q);
  if (snap.empty) {
    const q2 = query(collection(db, 'clients'), where('cedula', '==', cedula));
    const snap2 = await getDocs(q2);
    if (snap2.empty) return null;
    return { id: snap2.docs[0].id, ...snap2.docs[0].data() };
  }
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}

export async function getRecentClients(limitNum = 50) {
  // Since we don't have a reliable createdAt field across all old docs, we just fetch a limit.
  // We can try ordering by name to at least have alphabetical order.
  try {
    const q = query(collection(db, 'clients'), limit(limitNum));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.warn("Error fetching recent clients:", err);
    return [];
  }
}

export async function searchClientsQuery(term: string) {
  if (!term.trim()) return getRecentClients(50);
  
  const cleanTerm = term.trim();
  const isNumeric = /^\d+$/.test(cleanTerm);
  const results = new Map();

  try {
    if (isNumeric) {
      // Búsqueda por cédula/RIF
      const q1 = query(collection(db, 'clients'), where('rif_ci', '>=', cleanTerm), where('rif_ci', '<=', cleanTerm + '\uf8ff'), limit(15));
      const q2 = query(collection(db, 'clients'), where('cedula', '>=', cleanTerm), where('cedula', '<=', cleanTerm + '\uf8ff'), limit(15));
      
      const [s1, s2] = await Promise.all([getDocs(q1), getDocs(q2)]);
      s1.forEach(d => results.set(d.id, { id: d.id, ...d.data() }));
      s2.forEach(d => results.set(d.id, { id: d.id, ...d.data() }));
    } else {
      // Búsqueda por Nombre
      // Firestore requiere mayúsculas/minúsculas exactas. Buscaremos variantes comunes de la primera palabra.
      const upper = cleanTerm.toUpperCase();
      const cap = cleanTerm.charAt(0).toUpperCase() + cleanTerm.slice(1).toLowerCase();
      
      const q1 = query(collection(db, 'clients'), where('name', '>=', upper), where('name', '<=', upper + '\uf8ff'), limit(15));
      const q2 = query(collection(db, 'clients'), where('name', '>=', cap), where('name', '<=', cap + '\uf8ff'), limit(15));
      const q3 = query(collection(db, 'clients'), where('nombre', '>=', upper), where('nombre', '<=', upper + '\uf8ff'), limit(15));
      const q4 = query(collection(db, 'clients'), where('nombre', '>=', cap), where('nombre', '<=', cap + '\uf8ff'), limit(15));

      const [s1, s2, s3, s4] = await Promise.all([getDocs(q1), getDocs(q2), getDocs(q3), getDocs(q4)]);
      
      s1.forEach(d => results.set(d.id, { id: d.id, ...d.data() }));
      s2.forEach(d => results.set(d.id, { id: d.id, ...d.data() }));
      s3.forEach(d => results.set(d.id, { id: d.id, ...d.data() }));
      s4.forEach(d => results.set(d.id, { id: d.id, ...d.data() }));
    }
  } catch (err) {
    console.error("Error searching clients:", err);
  }

  return Array.from(results.values());
}
