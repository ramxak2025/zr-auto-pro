import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import ClientsPage from './pages/ClientsPage';
import ClientDetailPage from './pages/ClientDetailPage';
import CarsPage from './pages/CarsPage';
import ChecksPage from './pages/ChecksPage';
import CheckCreatePage from './pages/CheckCreatePage';
import CheckDetailPage from './pages/CheckDetailPage';
import ProductsPage from './pages/ProductsPage';
import ServicesPage from './pages/ServicesPage';
import SuppliersPage from './pages/SuppliersPage';
import SupplierDetailPage from './pages/SupplierDetailPage';
import SalaryPage from './pages/SalaryPage';
import ReportsPage from './pages/ReportsPage';
import UsersPage from './pages/UsersPage';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/*"
        element={
          <PrivateRoute>
            <Layout>
              <Routes>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/clients" element={<ClientsPage />} />
                <Route path="/clients/:id" element={<ClientDetailPage />} />
                <Route path="/cars" element={<CarsPage />} />
                <Route path="/checks" element={<ChecksPage />} />
                <Route path="/checks/new" element={<CheckCreatePage />} />
                <Route path="/checks/:id" element={<CheckDetailPage />} />
                <Route path="/products" element={<ProductsPage />} />
                <Route path="/services" element={<ServicesPage />} />
                <Route path="/suppliers" element={<SuppliersPage />} />
                <Route path="/suppliers/:id" element={<SupplierDetailPage />} />
                <Route path="/salary" element={<SalaryPage />} />
                <Route path="/reports" element={<ReportsPage />} />
                <Route path="/users" element={<UsersPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Layout>
          </PrivateRoute>
        }
      />
    </Routes>
  );
}
