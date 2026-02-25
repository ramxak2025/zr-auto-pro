import { lazy, Suspense, ComponentType } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { UserRole } from './types';

// Layouts — not lazy-loaded (always needed, small size)
import Layout from './components/Layout';
import AdminLayout from './components/AdminLayout';
import LoadingSpinner from './components/LoadingSpinner';
import ErrorBoundary from './components/ErrorBoundary';

// ─── Lazy loading with retry on chunk failure ────────────────────────────────
// After a deployment, the browser may have a cached index.html that references
// old chunk filenames that no longer exist on the server (404). The bare
// import() promise rejects permanently on failure. This wrapper retries up to
// 3 times with a delay, and on final failure forces a page reload to fetch
// the fresh index.html.

function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
  retries = 3,
): React.LazyExoticComponent<T> {
  return lazy(() => {
    const attempt = (remaining: number): Promise<{ default: T }> =>
      factory().catch((err: Error) => {
        if (remaining <= 0) {
          // All retries failed — likely stale cache, force reload once
          const reloadKey = 'lazy_chunk_reload';
          if (!sessionStorage.getItem(reloadKey)) {
            sessionStorage.setItem(reloadKey, Date.now().toString());
            window.location.reload();
          }
          throw err;
        }
        return new Promise<{ default: T }>((resolve) =>
          setTimeout(() => resolve(attempt(remaining - 1)), 1000),
        );
      });
    return attempt(retries);
  });
}

// ─── Lazy-loaded pages (code-split into separate chunks) ─────────────────────
// Each page loads only when the user navigates to its route.
// lazyWithRetry adds retry logic to handle stale-cache chunk load failures.

const LoginPage = lazyWithRetry(() => import('./pages/LoginPage'));
const SubscriptionBlockedPage = lazyWithRetry(() => import('./pages/SubscriptionBlockedPage'));
const DashboardPage = lazyWithRetry(() => import('./pages/DashboardPage'));
const ChecksPage = lazyWithRetry(() => import('./pages/ChecksPage'));
const CheckCreatePage = lazyWithRetry(() => import('./pages/CheckCreatePage'));
const CheckDetailPage = lazyWithRetry(() => import('./pages/CheckDetailPage'));
const ClientsPage = lazyWithRetry(() => import('./pages/ClientsPage'));
const ClientDetailPage = lazyWithRetry(() => import('./pages/ClientDetailPage'));
const CarsPage = lazyWithRetry(() => import('./pages/CarsPage'));
const ProductsPage = lazyWithRetry(() => import('./pages/ProductsPage'));
const ServicesPage = lazyWithRetry(() => import('./pages/ServicesPage'));
const SuppliersPage = lazyWithRetry(() => import('./pages/SuppliersPage'));
const SupplierDetailPage = lazyWithRetry(() => import('./pages/SupplierDetailPage'));
const SalaryPage = lazyWithRetry(() => import('./pages/SalaryPage'));
const ReportsPage = lazyWithRetry(() => import('./pages/ReportsPage'));
const CashFlowPage = lazyWithRetry(() => import('./pages/CashFlowPage'));
const UsersPage = lazyWithRetry(() => import('./pages/UsersPage'));
const SchedulePage = lazyWithRetry(() => import('./pages/SchedulePage'));
const MorePage = lazyWithRetry(() => import('./pages/MorePage'));
const TariffPage = lazyWithRetry(() => import('./pages/TariffPage'));
const RetailChecksPage = lazyWithRetry(() => import('./pages/RetailChecksPage'));
const ExpensesPage = lazyWithRetry(() => import('./pages/ExpensesPage'));
const MarketingPage = lazyWithRetry(() => import('./pages/MarketingPage'));
const CompanySettingsPage = lazyWithRetry(() => import('./pages/CompanySettingsPage'));
const ReviewPublicPage = lazyWithRetry(() => import('./pages/ReviewPublicPage'));

// Admin pages
const AdminDashboardPage = lazyWithRetry(() => import('./pages/admin/AdminDashboardPage'));
const AdminTenantsPage = lazyWithRetry(() => import('./pages/admin/AdminTenantsPage'));
const AdminTenantDetailPage = lazyWithRetry(() => import('./pages/admin/AdminTenantDetailPage'));
const AdminPlansPage = lazyWithRetry(() => import('./pages/admin/AdminPlansPage'));

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
    <ErrorBoundary>
    <Suspense fallback={null}>
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
                  <Route path="/company-settings" element={<CompanySettingsPage />} />
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
    </ErrorBoundary>
  );
}
