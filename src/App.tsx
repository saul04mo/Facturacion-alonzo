import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from '@/modules/auth';
import { LoginPage } from '@/modules/auth';
import { Layout } from '@/components/Layout';
import { RequireAuth } from '@/components/RequireAuth';
import { LoadingScreen } from '@/components/LoadingScreen';
import { ToastProvider } from '@/components/Toast';
import { ROUTES } from '@/config/constants';

const POSPage = lazy(() => import('@/modules/pos/POSPage').then((m) => ({ default: m.POSPage })));
const DashboardPage = lazy(() => import('@/modules/dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const InvoicesPage = lazy(() => import('@/modules/invoices/InvoicesPage').then((m) => ({ default: m.InvoicesPage })));
const InventoryPage = lazy(() => import('@/modules/inventory/InventoryPage').then((m) => ({ default: m.InventoryPage })));
const ClientsPage = lazy(() => import('@/modules/clients/ClientsPage').then((m) => ({ default: m.ClientsPage })));
const DeliveryPage = lazy(() => import('@/modules/delivery/DeliveryPage').then((m) => ({ default: m.DeliveryPage })));
const ReportsPage = lazy(() => import('@/modules/reports/ReportsPage').then((m) => ({ default: m.ReportsPage })));
const OffersPage = lazy(() => import('@/modules/offers/OffersPage').then((m) => ({ default: m.OffersPage })));
const UsersPage = lazy(() => import('@/modules/users/UsersPage').then((m) => ({ default: m.UsersPage })));
const SettingsPage = lazy(() => import('@/modules/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const PayrollPage = lazy(() => import('@/modules/payroll/PayrollPage').then((m) => ({ default: m.PayrollPage })));

export function App() {
  return (
    <ToastProvider>
    <BrowserRouter>
      <AuthProvider>
        <Suspense fallback={<LoadingScreen />}>
          <Routes>
            <Route path={ROUTES.LOGIN} element={<LoginPage />} />

            <Route element={<RequireAuth><Layout /></RequireAuth>}>
              <Route path={ROUTES.DASHBOARD} element={<DashboardPage />} />
              <Route path={ROUTES.POS} element={<POSPage />} />
              <Route path={ROUTES.INVOICES} element={<InvoicesPage />} />
              <Route path={ROUTES.INVENTORY} element={<InventoryPage />} />
              <Route path={ROUTES.CLIENTS} element={<ClientsPage />} />
              <Route path={ROUTES.DELIVERY} element={<DeliveryPage />} />
              <Route path={ROUTES.REPORTS} element={<ReportsPage />} />
              <Route path={ROUTES.OFFERS} element={<OffersPage />} />
              <Route path={ROUTES.USERS} element={<UsersPage />} />
              <Route path={ROUTES.SETTINGS} element={<SettingsPage />} />
              <Route path={ROUTES.PAYROLL} element={<PayrollPage />} />
            </Route>

            <Route path="*" element={<Navigate to={ROUTES.DASHBOARD} replace />} />
          </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
    </ToastProvider>
  );
}
