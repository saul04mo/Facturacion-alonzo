/**
 * Venezuela timezone utilities.
 * Venezuela uses VET (Venezuelan Standard Time) = UTC-4, no DST.
 */

const VE_TIMEZONE = 'America/Caracas';
const VE_LOCALE = 'es-VE';

/** Convert any Firestore/JS date to a Date object */
export function toDate(d: any): Date | null {
  if (!d) return null;
  if (d.toDate) return d.toDate();
  if (d instanceof Date) return d;
  return new Date(d);
}

/** Format date as "dd/mm/yyyy" in Venezuela timezone */
export function formatDate(d: any): string {
  const date = toDate(d);
  if (!date) return '—';
  return date.toLocaleDateString(VE_LOCALE, { timeZone: VE_TIMEZONE });
}

/** Format time as "hh:mm:ss a.m." in Venezuela timezone */
export function formatTime(d: any): string {
  const date = toDate(d);
  if (!date) return '—';
  return date.toLocaleTimeString(VE_LOCALE, { timeZone: VE_TIMEZONE });
}

/** Format as "dd/mm/yyyy hh:mm:ss" in Venezuela timezone */
export function formatDateTime(d: any): string {
  const date = toDate(d);
  if (!date) return '—';
  return date.toLocaleString(VE_LOCALE, { timeZone: VE_TIMEZONE });
}

/** Format as "sábado, 8 de marzo de 2026" in Venezuela timezone */
export function formatDateLong(d: any): string {
  const date = toDate(d);
  if (!date) return '—';
  return date.toLocaleDateString(VE_LOCALE, {
    timeZone: VE_TIMEZONE,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/** Get today's date string as YYYY-MM-DD in Venezuela timezone */
export function todayVE(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: VE_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** Get current time display for Venezuela */
export function currentTimeVE(): string {
  return new Date().toLocaleTimeString(VE_LOCALE, { timeZone: VE_TIMEZONE, hour: '2-digit', minute: '2-digit' });
}
