/**
 * Envíos: cruce de la guía con la base de clientes, envío por WhatsApp
 * (vía la función whatsapp-send) e historial en Firestore.
 *
 * El historial (`shipmentNotifications`) lo escribe SOLO el servidor — la
 * función al mandar y el webhook al llegar los estados. Desde el POS es de
 * solo lectura, así un vendedor no puede marcar como "leído" algo que no salió.
 */
import { collection, getDocs, limit, onSnapshot, orderBy, query, Timestamp } from 'firebase/firestore';
import { auth, db } from '@/config/firebase';
import { toWhatsappNumber } from '@/utils/phoneUtils';
import { normalizeClient, type Client } from '@/types';
import { CARRIER_LABELS, type Carrier, type GuideData } from './guideParser';

const ENDPOINT = '/.netlify/functions/whatsapp-send';
export const NOTIFICATIONS = 'shipmentNotifications';

export type NotificationStatus = 'sent' | 'delivered' | 'read' | 'failed';

export interface ShipmentNotification {
  id: string;
  carrier: Carrier;
  carrierLabel: string;
  tracking: string;
  phone: string;
  clientId: string | null;
  clientName: string;
  cedula: string;
  destination: string;
  status: NotificationStatus;
  error: string | null;
  sentByName: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

/** Mismo ID de documento que arma la función: una guía = un documento. */
export const notificationKey = (carrier: string, tracking: string) =>
  `${carrier.toUpperCase().replace(/[^A-Z]/g, '') || 'OTRO'}_${tracking.replace(/[^\w-]/g, '')}`;

export function listenNotifications(cb: (rows: ShipmentNotification[]) => void, max = 300) {
  return onSnapshot(
    query(collection(db, NOTIFICATIONS), orderBy('createdAt', 'desc'), limit(max)),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ShipmentNotification)),
    () => cb([]),
  );
}

// ─────────────────────────────── Cruce con clientes ──

export interface ClientMatch {
  client: Client;
  by: 'cédula' | 'teléfono' | 'nombre' | 'manual';
}

const NAME_STOP = new Set(['DE', 'DEL', 'LA', 'LOS', 'LAS', 'Y']);
function nameTokens(s: string): string[] {
  return s
    .toUpperCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .split(/[^A-Z]+/)
    .filter((t) => t.length >= 3 && !NAME_STOP.has(t));
}

/** Cuántos dígitos distintos hay entre dos cédulas del mismo largo. */
function digitDiff(a: string, b: string): number {
  if (a.length !== b.length) return Infinity;
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

/**
 * Cédula primero (es lo único inequívoco), después teléfono y por último
 * nombre. Por nombre se exige que coincidan al menos dos palabras: "JOSE" solo
 * matchea con media base.
 *
 * El OCR se equivoca de dígito (13140368 → 13140388), así que una cédula con
 * UN dígito distinto también vale si además coincide alguna palabra del nombre.
 */
export function matchClient(g: Pick<GuideData, 'cedula' | 'phone' | 'name'>, clients: Client[]): ClientMatch | null {
  const ced = g.cedula.replace(/\D/g, '');
  if (ced.length >= 6) {
    const c = clients.find((c) => c.rif_ci.replace(/\D/g, '') === ced);
    if (c) return { client: c, by: 'cédula' };
    const want = new Set(nameTokens(g.name));
    if (want.size) {
      const near = clients.find((c) =>
        digitDiff(c.rif_ci.replace(/\D/g, ''), ced) === 1 && nameTokens(c.name).some((t) => want.has(t)));
      if (near) return { client: near, by: 'cédula' };
    }
  }
  const tel = toWhatsappNumber(g.phone);
  if (tel) {
    const c = clients.find((c) => toWhatsappNumber(c.phone) === tel);
    if (c) return { client: c, by: 'teléfono' };
  }
  const want = nameTokens(g.name);
  if (want.length >= 2) {
    let best: Client | null = null;
    let bestScore = 1;
    for (const c of clients) {
      const have = new Set(nameTokens(c.name));
      const score = want.filter((t) => have.has(t)).length;
      if (score > bestScore) { best = c; bestScore = score; }
    }
    if (best) return { client: best, by: 'nombre' };
  }
  return null;
}

/**
 * TODOS los clientes, una vez por sesión. La lista del store no los trae a
 * todos (hay más de 5.000) y sin eso guías de clientes registrados salían como
 * "no está registrado". Son ~5.400 lecturas: menos de medio centavo.
 */
let allClients: Promise<Client[]> | null = null;
export function loadAllClients(): Promise<Client[]> {
  if (!allClients) {
    allClients = getDocs(collection(db, 'clients'))
      .then((snap) => snap.docs.map((d) => normalizeClient({ id: d.id, ...d.data() })))
      .catch((e) => { allClients = null; throw e; });
  }
  return allClients;
}

/** Búsqueda libre para elegir el cliente a mano. */
export function searchClients(q: string, clients: Client[], max = 8): Client[] {
  const t = q.trim().toLowerCase();
  if (t.length < 2) return [];
  const digits = t.replace(/\D/g, '');
  return clients
    .filter((c) =>
      c.name.toLowerCase().includes(t) ||
      (digits.length >= 4 && (c.rif_ci.replace(/\D/g, '').includes(digits) || c.phone.replace(/\D/g, '').includes(digits))))
    .slice(0, max);
}

// ─────────────────────────────────────────── Envío ──

export interface SendPayload {
  carrier: Carrier;
  tracking: string;
  name: string;
  cedula: string;
  phone: string;
  destination: string;
  clientId: string | null;
  imageBase64: string;
  force?: boolean;
}

export class AlreadySentError extends Error {}

export async function sendGuide(p: SendPayload): Promise<{ wamid: string }> {
  const user = auth.currentUser;
  if (!user) throw new Error('Sesión vencida.');
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await user.getIdToken()}` },
    body: JSON.stringify({ ...p, carrierLabel: CARRIER_LABELS[p.carrier] }),
  });

  // Sin las Netlify Functions corriendo, el catch-all del SPA devuelve index.html.
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    throw new Error('La función de WhatsApp no respondió. En local hay que usar `npm run dev:netlify`.');
  }
  const j = await res.json();
  if (res.status === 409 && j.alreadySent) throw new AlreadySentError(j.error);
  if (!res.ok) throw new Error(j.error || `Error ${res.status}`);
  return j;
}
