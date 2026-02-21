import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { UserRole } from './types';

// Layouts
import Layout from './components/Layout';
import AdminLayout from './components/AdminLayout';
import LoadingSpinner from './components/LoadingSpinner';

// Pages
import LoginPage from './pages/LoginPage';
import SubscriptionBlockedPage from './pages/SubscriptionBlockedPage';
import DashboardPage from './pages/DashboardPage';
import ChecksPage from './pages/ChecksPage';
import CheckCreatePage from './pages/CheckCreatePage';
import CheckDetailPage from './pages/CheckDetailPage';
import ClientsPage from './pages/ClientsPage';
import ClientDetailPage from './pages/ClientDetailPage';
import CarsPage from './pages/CarsPage';
import ProductsPage from './pages/ProductsPage';
import ServicesPage from './pages/ServicesPage';
import SuppliersPage from './pages/SuppliersPage';
import SupplierDetailPage from './pages/SupplierDetailPage';
import SalaryPage from './pages/SalaryPage';
import ReportsPage from './pages/ReportsPage';
import CashFlowPage from './pages/CashFlowPage';
import UsersPage from './pages/UsersPage';
import SchedulePage from './pages/SchedulePage';
import MorePage from './pages/MorePage';
import TariffPage from './pages/TariffPage';
import RetailChecksPage from './pages/RetailChecksPage';
import ExpensesPage from './pages/ExpensesPage';
import MarketingPage from './pages/MarketingPage';

// Admin pages
import AdminDashboardPage from './pages/admin/AdminDashboardPage';
import AdminTenantsPage from './pages/admin/AdminTenantsPage';
import AdminTenantDetailPage from './pages/admin/AdminTenantDetailPage';
import AdminPlansPage from './pages/admin/AdminPlansPage';

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
    <Routes>
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
  );
}
