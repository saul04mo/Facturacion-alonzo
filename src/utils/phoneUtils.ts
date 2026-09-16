/**
 * Normalización de teléfonos para links de WhatsApp y de llamada.
 *
 * Los números se cargan de mil formas. Sobre 1.428 clientes con teléfono:
 *   1.308  04141234567      (nacional, con el 0 — el 92% de la base)
 *      33  584141234567     (ya internacional)
 *      26  4141234567       (sin 0 ni código)
 *      17  +58 414-1234567  (con símbolos)
 *      15  0414-1234567
 *   …y un puñado con espacios, guiones o dos números en el mismo campo.
 *
 * wa.me es estricto: quiere SOLO dígitos, con código de país y sin el 0 de la
 * marcación nacional. Cualquier otra cosa y abre WhatsApp diciendo que el
 * número no existe — que es como se ve el error, con un + que agrega el propio
 * WhatsApp al mostrar lo que recibió.
 */

/** Venezuela. Si algún día hay clientes de otro país, esto se vuelve parámetro. */
const CODIGO_PAIS = '58';

/**
 * Pasa un teléfono al formato internacional que espera wa.me: solo dígitos,
 * con código de país. Devuelve null si no queda un número usable, para poder
 * apagar el botón en vez de abrir WhatsApp a un error.
 */
export function toWhatsappNumber(phone: string | null | undefined): string | null {
  const digitos = (phone || '').replace(/\D/g, '');
  if (!digitos) return null;

  let intl: string;
  if (digitos.startsWith(CODIGO_PAIS)) {
    // Ya viene con código de país.
    intl = digitos;
  } else if (digitos.startsWith('0')) {
    // Nacional: el 0 es de marcación interna, afuera no existe.
    intl = CODIGO_PAIS + digitos.slice(1);
  } else if (digitos.length <= 10) {
    // Sin 0 ni código: 4141234567.
    intl = CODIGO_PAIS + digitos;
  } else {
    // Largo y de otro país: se respeta tal cual.
    intl = digitos;
  }

  // Rango de E.164. Corta los campos con un número incompleto y los que traen
  // dos teléfonos pegados, donde no hay forma de adivinar cuál es el bueno.
  return intl.length >= 11 && intl.length <= 15 ? intl : null;
}

/** Link de WhatsApp, o null si el número no sirve. `texto` va prellenado. */
export function whatsappHref(
  phone: string | null | undefined,
  texto?: string,
): string | null {
  const intl = toWhatsappNumber(phone);
  if (!intl) return null;
  return texto
    ? `https://wa.me/${intl}?text=${encodeURIComponent(texto)}`
    : `https://wa.me/${intl}`;
}

/**
 * Link de llamada. Usa el formato internacional con `+`, que marca bien tanto
 * dentro del país como desde afuera.
 */
export function telHref(phone: string | null | undefined): string | null {
  const intl = toWhatsappNumber(phone);
  return intl ? `tel:+${intl}` : null;
}
