import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initFontPreset } from './utils/fontUtils';
import './index.css';

// Aplicar la fuente guardada antes de renderizar React.
// Si el usuario eligió 'Inter' en la última sesión, esto inyecta el
// <link> a Google Fonts y la <style> override antes del primer paint,
// evitando el flash de fuente por defecto.
initFontPreset();

// ────────────────────────────────────────────────────────────────────
// KILL SWITCH del service worker antiguo de PWA
// ────────────────────────────────────────────────────────────────────
// Antes el POS usaba vite-plugin-pwa que registraba un service worker
// (sw.js) interceptando todos los fetch del sitio. Lo quitamos del build
// pero los browsers de los usuarios YA tienen el SW instalado y va a
// seguir interceptando peticiones por días/semanas hasta que el SW
// "muera" naturalmente — eso causaba F5 colgado en hosting porque el
// SW devolvía bundles cacheados que ya no existen en el server.
//
// Este código se ejecuta en CADA carga y desregistra cualquier SW
// instalado + limpia los caches que dejó. Es seguro dejarlo permanente:
// si no hay SW, no hace nada. Si en el futuro queremos PWA de vuelta,
// hay que quitar este bloque ANTES de re-introducir el plugin.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    regs.forEach((reg) => reg.unregister());
  }).catch(() => { /* silent */ });
  if ('caches' in window) {
    caches.keys().then((names) => {
      names.forEach((n) => caches.delete(n));
    }).catch(() => { /* silent */ });
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
