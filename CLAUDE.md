# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

POS de Alonzo (tienda de ropa en Venezuela): Vite + React 18 + TypeScript + Tailwind + Zustand + Firebase v10, desplegado en Netlify. El código, los comentarios, los commits y la UI están en español; seguir esa convención (commits estilo `feat(modulo): ...` / `fix(modulo): ...`).

## Comandos

```bash
npm run dev            # Vite, solo frontend (las funciones de Netlify NO corren)
npm run dev:netlify    # netlify dev: frontend + netlify/functions en local
npm run build          # tsc -b && vite build (el type-check es parte del build)
npx tsc -b             # solo type-check
```

- No hay tests ni framework de tests. Los `test_*.js/.cjs` de la raíz son scripts sueltos que consultan Firestore de producción, no tests.
- `npm run lint` está roto: no existe `eslint.config.js` (ESLint 9 falla). El type-check estricto (`noUnusedLocals`, `noUnusedParameters`) es la verificación real.
- Node 22 (`.nvmrc`).

## Deploy

- **`git push` no deploya.** Frontend + funciones: `netlify deploy --prod`.
- Reglas de Firestore van aparte: `firebase deploy --only firestore:rules` (proyecto `alozo-2633a`).
- `banesco-validator-service/` es un microservicio Express independiente (su propio `package.json`) desplegado en Google Cloud Run; ver su README.

## Arquitectura

### Frontend (`src/`)
- `App.tsx`: rutas con React Router, cada página lazy-loaded. Las rutas viven en `ROUTES` (`src/config/constants.ts`), en español (`/ventas`, `/facturas`, ...). Dos rutas van fuera del `Layout` a propósito: `/registro-envio` (pública, sin login) y `/entregas` (vista del repartidor, sin los listeners globales).
- `src/modules/<modulo>/`: un módulo por área (pos, invoices, inventory, cash, shipping, payroll, ...), cada uno con su `XxxPage.tsx` y normalmente un `xxxService.ts` que habla con Firestore.
- **Estado global**: `useAppStore` (Zustand, `src/store/appStore.ts`). Lo llena `useFirestoreListeners` (montado en el Layout) con `onSnapshot` sobre `products` (todos), `invoices` (500 más recientes), `config/exchangeRate`, `config/posSettings`, `employees`, `users` (solo admin o `canReassignSeller`), cupones y promociones. Los **clientes no se cargan globalmente** (3000+ docs): se buscan bajo demanda. Para reportes/exportes sin límite usar `fetchInvoicesByDateRange`.
- El listener de facturas **normaliza `status`** según `deliveryPaidInStore` (Finalizado ↔ Pendiente de pago); el valor en el store puede diferir del guardado.
- Firestore usa `memoryLocalCache` (sin IndexedDB, sin offline) por problemas multi-pestaña; ver comentario en `src/config/firebase.ts` antes de cambiarlo. `main.tsx` desregistra un service worker de PWA viejo en cada carga; no quitarlo sin reintroducir la PWA a propósito.
- Alias de import: `@/` → `src/`. Tipos de dominio en `src/types/index.ts`.

### Permisos y roles
- Roles: `administrador`, `vendedor`, `delivery` (repartidor). Permisos granulares en `ALL_PERMISSIONS` / `DEFAULT_PERMISSIONS` (`constants.ts`), sobreescribibles por usuario en `users/{uid}.permissions`; se consultan con `usePermissions()`. Al agregar un permiso nuevo, agregarlo a `ALL_PERMISSIONS` y decidir su default en cada rol (el rol `delivery` arranca todo en `false`).
- `firestore.rules` es la otra mitad: muchas colecciones permiten cualquier usuario autenticado; las facturas nunca se borran.

### Dominio: moneda, sucursales, stock
- Doble moneda USD/VES. Montos se guardan en USD; la tasa BCV vive en `config/exchangeRate` (historial en `exchangeRateHistory` y `rateHistory`). Mostrar con `useCurrency()`.
- Dos sucursales (`Branch`): `store` (tienda) y `warehouse` (almacén). Cada variante de producto tiene `stockStore`, `stockWarehouse`, `stockInTransit` y el agregado legacy `stock`, que **siempre** debe recalcularse como la suma. Toda mutación de stock pasa por `src/utils/stockUtils.ts` (`batchApplyStockDeltas`, `batchRestoreStock`) y `branchUtils.ts` (incluye la talla "sin talla" `S/T` y sus etiquetas legacy).
- `src/modules/invoices/invoiceService.ts` concentra la lógica de ventas: `processSale`, `processReturn`, `processExchange`, `cancelInvoice`, `addAbono`, `updateInvoiceFull`, etc. Usa transacciones/batches para numeración (`numericId`, contador en `config`), stock y factura juntos. Los movimientos de efectivo se registran vía import dinámico de `cashService` para evitar un ciclo de imports.
- Las facturas también las crean la tienda web y la app (`sellerUid` = `'WEB'` / `'APP'`) y la API `create-order`; el POS comparte Firestore con esos canales, así que los datos tienen formas legacy (ver `scripts/standardize-data.cjs` y `src/utils/migrations/`).

### Backend serverless (`netlify/`)
- `netlify/functions/*.cjs`: cada archivo es una función. Usan `firebase-admin` (ignoran las reglas de Firestore), por eso las APIs públicas exigen `x-api-key` (`CATALOG_API_KEY`). Código compartido en `netlify/lib/` (no dentro de `functions/`, porque ahí todo archivo se vuelve función).
- Credenciales: `FIREBASE_SERVICE_ACCOUNT` en Netlify; en local cae a `serviceAccountKey.json` en la raíz (gitignored).
- `rates-daily` es programada (22:00 UTC) en `netlify.toml`. No se puede agregar redirect para `/.netlify/functions/*`.
- Documentación detallada: `netlify/README-APIS.md` (catálogo, disponibilidad, create-order) y `netlify/README-WHATSAPP.md` (envíos de guías vía Dismoncatech — **no** configurar el webhook de Meta; lectura de guías con zxing → IA → Tesseract).

### Servicios externos desde el frontend
- Validación de pagos Banesco: `src/services/banescoService.ts` → microservicio en Cloud Run (`VITE_BANESCO_VALIDATOR_URL`).
- Recibos/etiquetas impresos: `src/services/receiptService.ts` (etiquetas térmicas de 80mm/100mm).
