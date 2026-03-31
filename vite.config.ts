import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'images/Alonzo.JPG'],
      manifest: {
        name: 'POS Alonzo - Sistema de Gestión Operativa',
        short_name: 'POS Alonzo',
        description: 'Punto de Venta, Inventario, Reportes y más',
        start_url: '/',
        display: 'standalone',
        background_color: '#0f1117',
        theme_color: '#0f1117',
        orientation: 'portrait-primary',
        icons: [
          { src: 'images/Alonzo.JPG', sizes: '192x192', type: 'image/jpeg', purpose: 'any maskable' },
          { src: 'images/Alonzo.JPG', sizes: '512x512', type: 'image/jpeg', purpose: 'any' },
        ],
        categories: ['business', 'productivity', 'utilities'],
        lang: 'es-VE',
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,jpg,jpeg,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com/,
            handler: 'CacheFirst',
            options: { cacheName: 'google-fonts', expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: { '@': '/src' },
  },
});
