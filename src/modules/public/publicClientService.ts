/**
 * Servicio del formulario PÚBLICO de registro de envío.
 *
 * Llama a la Netlify Function `register-client`, que corre en el servidor
 * con permisos admin: detecta si la cédula/teléfono ya existen (sin exponer
 * datos a anónimos) y crea o actualiza el cliente en la colección `clients`.
 */

export interface PublicClientInput {
  name: string;        // Nombre y Apellido
  rif_ci: string;      // Cédula
  phone: string;       // WhatsApp
  city: string;        // Ciudad
  agency: string;      // Agencia
  addressLine: string; // Dirección
}

export interface PublicClientResult {
  existed: boolean;   // true si el cliente ya estaba registrado (se actualizó)
  name?: string;      // nombre con el que ya estaba registrado
}

const ENDPOINT = '/.netlify/functions/register-client';

export async function submitPublicClient(input: PublicClientInput): Promise<PublicClientResult> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data?.error || 'No pudimos enviar tus datos.');
  }

  return { existed: !!data.existed, name: data.name };
}
