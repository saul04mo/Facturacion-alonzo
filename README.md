# POS Alonzo v2

Sistema de Punto de Venta modular — Vite + React + TypeScript + Firebase.

Migrado de un monolito HTML de 9,126 líneas a una arquitectura modular con ~4,500 líneas tipadas.

## Quick Start

```bash
npm install
cp .env.example .env
mkdir -p public/images && cp /path/to/Alonzo.JPG public/images/
npm run dev
```

## Estructura

```
src/
├── config/           Firebase init, constantes, permisos, rutas
├── types/            Interfaces TS (Product, Invoice, Client, User...)
├── store/            Zustand store global (reemplaza localState)
├── hooks/            useCurrency, usePermissions, useOnlineStatus, useFirestoreListeners
├── services/         excelService (export XLSX)
├── components/       Layout, Header, Sidebar, Modal, CurrencyToggle, etc.
└── modules/
    ├── auth/         ✅ Login, Register, AuthProvider, guards
    ├── pos/          ✅ Catálogo 3-pasos, Carrito, PaymentPanel, Checkout
    ├── inventory/    ✅ CRUD productos, Variantes, Accordion table
    ├── clients/      ✅ CRUD clientes, Búsqueda, Validación duplicados
    ├── invoices/     ✅ Filtros, Tabla, Detalle, Devoluciones, Abonos
    ├── delivery/     ✅ Pedidos delivery, Confirmación de pago
    ├── reports/      ✅ Ventas generales + Productos vendidos, 7 filtros, Export
    └── users/        ✅ CRUD usuarios, 19 permisos granulares por grupo
```

## Mapeo Monolito → v2

| Monolito                    | v2                                    |
|-----------------------------|---------------------------------------|
| `localState`                | `useAppStore()` (Zustand)             |
| `onAuthStateChanged()`      | `AuthProvider.tsx`                    |
| `SPARouter` (hash)          | React Router + lazy loading           |
| `formatCurrency()`          | `useCurrency()` hook                  |
| `applyPermissions()`        | `usePermissions()` hook               |
| `attachListeners()`         | `useFirestoreListeners()` hook        |
| `processSale()`             | `invoiceService.processSale()`        |
| `confirmReturn()`           | `invoiceService.processReturn()`      |
| `renderInformes()`          | `ReportsPage.tsx` (React state)       |
| `renderInventory()`         | `InventoryPage.tsx` (accordion)       |
| `exportSalesToExcel()`      | `excelService.exportSalesData()`      |
| `paymentMethods[]`          | `PAYMENT_METHODS` constant            |
| `openPermissionsModal()`    | `PermissionsModal` component          |

## Tech Stack

Vite · React 18 · TypeScript · Tailwind CSS · React Router · Zustand · Firebase v10 · SheetJS · Vite PWA
