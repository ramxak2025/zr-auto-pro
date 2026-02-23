import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { UserRole } from './types';

// Layouts — not lazy-loaded (always needed, small size)
import Layout from './components/Layout';
import AdminLayout from './components/AdminLayout';
import LoadingSpinner from './components/LoadingSpinner';

// ─── Lazy-loaded pages (code-split into separate chunks) ─────────────────────
// Each page loads only when the user navigates to its route.
// This reduces the initial JS bundle from ~700KB to ~200KB.

const LoginPage = lazy(() => import('./pages/LoginPage'));
const SubscriptionBlockedPage = lazy(() => import('./pages/SubscriptionBlockedPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const ChecksPage = lazy(() => import('./pages/ChecksPage'));
const CheckCreatePage = lazy(() => import('./pages/CheckCreatePage'));
const CheckDetailPage = lazy(() => import('./pages/CheckDetailPage'));
const ClientsPage = lazy(() => import('./pages/ClientsPage'));
const ClientDetailPage = lazy(() => import('./pages/ClientDetailPage'));
const CarsPage = lazy(() => import('./pages/CarsPage'));
const ProductsPage = lazy(() => import('./pages/ProductsPage'));
const ServicesPage = lazy(() => import('./pages/ServicesPage'));
const SuppliersPage = lazy(() => import('./pages/SuppliersPage'));
const SupplierDetailPage = lazy(() => import('./pages/SupplierDetailPage'));
const SalaryPage = lazy(() => import('./pages/SalaryPage'));
const ReportsPage = lazy(() => import('./pages/ReportsPage'));
const CashFlowPage = lazy(() => import('./pages/CashFlowPage'));
const UsersPage = lazy(() => import('./pages/UsersPage'));
const SchedulePage = lazy(() => import('./pages/SchedulePage'));
const MorePage = lazy(() => import('./pages/MorePage'));
const TariffPage = lazy(() => import('./pages/TariffPage'));
const RetailChecksPage = lazy(() => import('./pages/RetailChecksPage'));
const ExpensesPage = lazy(() => import('./pages/ExpensesPage'));
const MarketingPage = lazy(() => import('./pages/MarketingPage'));
const ReviewPublicPage = lazy(() => import('./pages/ReviewPublicPage'));

// Admin pages
const AdminDashboardPage = lazy(() => import('./pages/admin/AdminDashboardPage'));
const AdminTenantsPage = lazy(() => import('./pages/admin/AdminTenantsPage'));
const AdminTenantDetailPage = lazy(() => import('./pages/admin/AdminTenantDetailPage'));
const AdminPlansPage = lazy(() => import('./pages/admin/AdminPlansPage'));

function isSubscriptionExpired(subscriptionEnd?: string | null): boolean {
  if (!subscriptionEnd) return false; // No date set = no restriction
  const end = new Date(subscriptionEnd);
  const now = new Date();
  return end < now;
}

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return <LoadingSpinner />;
  }

  // Check subscription for non-superadmin users
  const subscriptionBlocked =
    user &&
    user.role !== UserRole.SUPERADMIN &&
    user.tenant &&
    isSubscriptionExpired(user.tenant.subscriptionEnd);

  return (
    <Suspense fallback={<LoadingSpinner />}>
      <Routes>
        {/* Public: Review page (no auth) */}
        <Route path="/review/:token" element={<ReviewPublicPage />} />

        {/* Public: Login */}
        <Route
          path="/login"
          element={user ? <Navigate to={user.role === UserRole.SUPERADMIN ? '/admin/dashboard' : '/dashboard'} replace /> : <LoginPage />}
        />

        {/* Protected routes */}
        {user ? (
          <>
            {/* Subscription blocked — show block screen for all routes */}
            {subscriptionBlocked ? (
              <Route path="*" element={<SubscriptionBlockedPage />} />
            ) : (
              <>
                {/* Main app routes inside Layout */}
                <Route element={<Layout />}>
                  <Route path="/" element={
                    user.role === UserRole.SUPERADMIN
                      ? <Navigate to="/admin/dashboard" replace />
                      : <Navigate to="/dashboard" replace />
                  } />
                  <Route path="/dashboard" element={<DashboardPage />} />
                  <Route path="/checks" element={<ChecksPage />} />
                  <Route path="/checks/new" element={<CheckCreatePage />} />
                  <Route path="/checks/:id/edit" element={<CheckCreatePage />} />
                  <Route path="/checks/:id" element={<CheckDetailPage />} />
                  <Route path="/clients" element={<ClientsPage />} />
                  <Route path="/clients/retail" element={<RetailChecksPage />} />
                  <Route path="/clients/:id" element={<ClientDetailPage />} />
                  <Route path="/cars" element={<CarsPage />} />
                  <Route path="/products" element={<ProductsPage />} />
                  <Route path="/services" element={<ServicesPage />} />
                  <Route path="/suppliers" element={<SuppliersPage />} />
                  <Route path="/suppliers/:id" element={<SupplierDetailPage />} />
                  <Route path="/salary" element={<SalaryPage />} />
                  <Route path="/reports" element={<ReportsPage />} />
                  <Route path="/cashflow" element={<CashFlowPage />} />
                  <Route path="/expenses" element={<ExpensesPage />} />
                  <Route path="/users" element={<UsersPage />} />
                  <Route path="/schedule" element={<SchedulePage />} />
                  <Route path="/more" element={<MorePage />} />
                  <Route path="/tariff" element={<TariffPage />} />
                  <Route path="/marketing" element={<MarketingPage />} />
                </Route>

                {/* Admin routes inside AdminLayout (superadmin only) */}
                {user.role === UserRole.SUPERADMIN && (
                  <Route element={<AdminLayout />}>
                    <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />
                    <Route path="/admin/dashboard" element={<AdminDashboardPage />} />
                    <Route path="/admin/tenants" element={<AdminTenantsPage />} />
                    <Route path="/admin/tenants/:id" element={<AdminTenantDetailPage />} />
                    <Route path="/admin/plans" element={<AdminPlansPage />} />
                  </Route>
                )}

                {/* Catch-all: redirect to dashboard */}
                <Route path="*" element={<Navigate to="/" replace />} />
              </>
            )}
          </>
        ) : (
          /* Not logged in: redirect everything to login */
          <Route path="*" element={<Navigate to="/login" replace />} />
        )}
      </Routes>
    </Suspense>
  );
}
