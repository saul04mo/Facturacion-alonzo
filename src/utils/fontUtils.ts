/**
 * Catálogo de fuentes que el usuario puede elegir desde Configuración → Sistema.
 *
 * Cómo funciona:
 *  - El usuario elige una opción en el dropdown
 *  - Llamamos a applyFontPreset(id) que:
 *     a) Inyecta un <link> a Google Fonts (lazy, una sola vez por fuente)
 *     b) Setea CSS custom properties en :root que sobrescriben las
 *        que Tailwind genera para font-display / font-body / font-mono
 *  - Persistimos el id en localStorage
 *  - Al iniciar la app cargamos lo último guardado
 *
 * Por qué CSS variables y no recompilar Tailwind:
 *  - Cambia al instante sin rebuild
 *  - Tailwind YA usa las clases font-display etc. en miles de lugares,
 *    no hay que tocar ni un componente
 *  - Funciona porque tailwind.config.js exporta:
 *      mono:    ['"JetBrains Mono"', ...]
 *      display: ['"Plus Jakarta Sans"', ...]
 *    y nuestra CSS override va con !important sobre :root, ganando.
 */

export interface FontPreset {
  id: string;
  label: string;
  /** Descripción breve que se muestra debajo del nombre. */
  description: string;
  /** family-stack para CSS. Quotes alrededor de nombres con espacios. */
  family: string;
  /** Param para Google Fonts URL. Ej: 'Inter:wght@400;500;600;700' */
  googleFontParam?: string;
  /** Si true, no se carga desde Google Fonts (usa stack del sistema). */
  isSystem?: boolean;
}

export const FONT_PRESETS: FontPreset[] = [
  {
    id: 'default',
    label: 'Por defecto (Plus Jakarta + DM Sans + JetBrains Mono)',
    description: 'La combinación original del sistema. Display y body diferenciados, mono para números.',
    family: '', // No aplica — restaura el comportamiento de tailwind.config
    isSystem: true,
  },
  {
    id: 'inter',
    label: 'Inter',
    description: 'Limpia, neutra, alta legibilidad. Estándar de productos digitales modernos.',
    family: '"Inter", system-ui, sans-serif',
    googleFontParam: 'Inter:wght@400;500;600;700;800',
  },
  {
    id: 'manrope',
    label: 'Manrope',
    description: 'Geométrica y amistosa. Buena lectura en tamaños chicos.',
    family: '"Manrope", system-ui, sans-serif',
    googleFontParam: 'Manrope:wght@400;500;600;700;800',
  },
  {
    id: 'roboto',
    label: 'Roboto',
    description: 'Clásica de Google. Neutra y muy probada.',
    family: '"Roboto", system-ui, sans-serif',
    googleFontParam: 'Roboto:wght@400;500;700;900',
  },
  {
    id: 'plus-jakarta',
    label: 'Plus Jakarta Sans (todo)',
    description: 'Aplica la display que ya usa el sistema a TODO (incluido números). Look unificado.',
    family: '"Plus Jakarta Sans", system-ui, sans-serif',
    // Esta fuente ya viene cargada en index.html, no necesita Google Fonts param
  },
  {
    id: 'dm-sans',
    label: 'DM Sans (todo)',
    description: 'Aplica la body que ya usa el sistema a TODO. Más sobria que Plus Jakarta.',
    family: '"DM Sans", system-ui, sans-serif',
  },
  {
    id: 'system',
    label: 'Sistema (Segoe UI / SF Pro)',
    description: 'Usa la fuente nativa del sistema operativo. Render más rápido y familiar.',
    family: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    isSystem: true,
  },
  {
    id: 'open-sans',
    label: 'Open Sans',
    description: 'Humanística y muy legible. Probada en e-commerce y dashboards.',
    family: '"Open Sans", system-ui, sans-serif',
    googleFontParam: 'Open+Sans:wght@400;500;600;700;800',
  },
];

/**
 * Inyecta un <link rel="stylesheet"> apuntando a Google Fonts si todavía
 * no fue inyectado para esa fuente. Idempotente: la primera llamada
 * agrega el link, las siguientes lo detectan y no hacen nada.
 */
function ensureGoogleFontLoaded(googleFontParam: string) {
  if (typeof document === 'undefined') return;
  const id = `gf-${googleFontParam.replace(/[^a-z0-9]/gi, '-')}`;
  if (document.getElementById(id)) return; // ya cargado
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${googleFontParam}&display=swap`;
  document.head.appendChild(link);
}

/**
 * Aplica un preset de fuente al sistema entero.
 * Sobrescribe las CSS custom properties que Tailwind usa en font-display,
 * font-body y font-mono.
 */
export function applyFontPreset(presetId: string): void {
  if (typeof document === 'undefined') return;
  const preset = FONT_PRESETS.find((p) => p.id === presetId) || FONT_PRESETS[0];

  // Cargar la fuente desde Google si hace falta
  if (preset.googleFontParam) {
    ensureGoogleFontLoaded(preset.googleFontParam);
  }

  // Aplicamos via <style> tag dedicado en <head>. Cada vez que se llama,
  // reemplazamos el tag entero (más simple que ir setting CSS variables
  // y luego sobrescribir las clases de Tailwind ya inlinedas).
  const STYLE_TAG_ID = 'app-font-override';
  let styleTag = document.getElementById(STYLE_TAG_ID) as HTMLStyleElement | null;
  if (!styleTag) {
    styleTag = document.createElement('style');
    styleTag.id = STYLE_TAG_ID;
    document.head.appendChild(styleTag);
  }

  if (preset.id === 'default') {
    // Quitamos la sobrescritura — vuelve al comportamiento de tailwind.config
    styleTag.textContent = '';
    return;
  }

  // Sobrescribimos las 3 clases de Tailwind con !important para ganarle a
  // las propias declaraciones que hace Tailwind en las clases utility.
  styleTag.textContent = `
    .font-display, .font-body, .font-mono {
      font-family: ${preset.family} !important;
    }
    /* También body por si algún componente no usa las clases utility */
    body {
      font-family: ${preset.family} !important;
    }
  `;
}

const STORAGE_KEY = 'pos-alonzo-font-preset';

export function getCurrentFontPreset(): string {
  if (typeof window === 'undefined') return 'default';
  return localStorage.getItem(STORAGE_KEY) || 'default';
}

export function setFontPreset(presetId: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, presetId);
  applyFontPreset(presetId);
}

/**
 * Llamar UNA vez en el bootstrap de la app (App.tsx, useEffect inicial).
 * Lee del localStorage y aplica.
 */
export function initFontPreset(): void {
  const id = getCurrentFontPreset();
  applyFontPreset(id);
}
