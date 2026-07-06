import { lazy, Suspense, ComponentType, ReactElement } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from './contexts/AuthContext';
import { subscriptionApi } from './api/services';
import { UserRole } from './types';

// Layouts — not lazy-loaded (always needed, small size)
import Layout from './components/Layout';
import AdminLayout from './components/AdminLayout';
import LoadingSpinner from './components/LoadingSpinner';
import ErrorBoundary from './components/ErrorBoundary';
import FeatureGate from './components/FeatureGate';

// ─── Lazy loading with retry on chunk failure ────────────────────────────────
// After a deployment, the browser may have a cached index.html that references
// old chunk filenames that no longer exist on the server (404). The bare
// import() promise rejects permanently on failure. This wrapper retries up to
// 3 times with a delay, and on final failure forces a page reload to fetch
// the fresh index.html.

function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
  retries = 2,
): React.LazyExoticComponent<T> {
  return lazy(() => {
    const attempt = (remaining: number, delay: number): Promise<{ default: T }> =>
      factory().catch((err: Error) => {
        if (remaining <= 0) {
          const reloadKey = 'lazy_chunk_reload';
          if (!sessionStorage.getItem(reloadKey)) {
            sessionStorage.setItem(reloadKey, Date.now().toString());
            window.location.reload();
          }
          throw err;
        }
        return new Promise<{ default: T }>((resolve) =>
          setTimeout(() => resolve(attempt(remaining - 1, delay * 2)), delay),
        );
      });
    // Exponential backoff: 150ms → 300ms (total 450ms max vs old 3000ms)
    return attempt(retries, 150);
  });
}

// ─── Lazy-loaded pages (code-split into separate chunks) ─────────────────────
// Each page loads only when the user navigates to its route.
// lazyWithRetry adds retry logic to handle stale-cache chunk load failures.

const LandingPage = lazyWithRetry(() => import('./pages/landing/LandingPage'));
const FeatureDetailPage = lazyWithRetry(() => import('./pages/landing/FeatureDetailPage'));
const TarifyPage = lazyWithRetry(() => import('./pages/landing/TarifyPage'));
const LoginPage = lazyWithRetry(() => import('./pages/LoginPage'));
const SubscriptionBlockedPage = lazyWithRetry(() => import('./pages/SubscriptionBlockedPage'));
const DashboardPage = lazyWithRetry(() => import('./pages/DashboardPage'));
const ChecksPage = lazyWithRetry(() => import('./pages/ChecksPage'));
const WorkBoardPage = lazyWithRetry(() => import('./pages/WorkBoardPage'));
const CheckCreatePage = lazyWithRetry(() => import('./pages/CheckCreatePage'));
const CheckDetailPage = lazyWithRetry(() => import('./pages/CheckDetailPage'));
const ClientsPage = lazyWithRetry(() => import('./pages/ClientsPage'));
const ClientDetailPage = lazyWithRetry(() => import('./pages/ClientDetailPage'));
const CarsPage = lazyWithRetry(() => import('./pages/CarsPage'));
const ImportClientsCarsPage = lazyWithRetry(() => import('./pages/ImportClientsCarsPage'));
const ProductsPage = lazyWithRetry(() => import('./pages/ProductsPage'));
const ServicesPage = lazyWithRetry(() => import('./pages/ServicesPage'));
const SuppliersPage = lazyWithRetry(() => import('./pages/SuppliersPage'));
const SupplierDetailPage = lazyWithRetry(() => import('./pages/SupplierDetailPage'));
const PurchaseOrdersPage = lazyWithRetry(() => import('./pages/PurchaseOrdersPage'));
const PurchaseOrderEditPage = lazyWithRetry(() => import('./pages/PurchaseOrderEditPage'));
const PurchaseOrderDetailPage = lazyWithRetry(() => import('./pages/PurchaseOrderDetailPage'));
const SalaryPage = lazyWithRetry(() => import('./pages/SalaryPage'));
const ReportsPage = lazyWithRetry(() => import('./pages/ReportsPage'));
const CashFlowPage = lazyWithRetry(() => import('./pages/CashFlowPage'));
const CashShiftPage = lazyWithRetry(() => import('./pages/CashShiftPage'));
const InstallmentsPage = lazyWithRetry(() => import('./pages/InstallmentsPage'));
const UsersPage = lazyWithRetry(() => import('./pages/UsersPage'));
const EmployeesPage = lazyWithRetry(() => import('./pages/EmployeesPage'));
const EmployeeDetailPage = lazyWithRetry(() => import('./pages/EmployeeDetailPage'));
const SchedulePage = lazyWithRetry(() => import('./pages/SchedulePage'));
const MorePage = lazyWithRetry(() => import('./pages/MorePage'));
const TariffPage = lazyWithRetry(() => import('./pages/TariffPage'));
const RetailChecksPage = lazyWithRetry(() => import('./pages/RetailChecksPage'));
const ExpensesPage = lazyWithRetry(() => import('./pages/ExpensesPage'));
const MarketingPage = lazyWithRetry(() => import('./pages/MarketingPage'));
const CompanySettingsPage = lazyWithRetry(() => import('./pages/CompanySettingsPage'));
const IntegrationsPage = lazyWithRetry(() => import('./pages/IntegrationsPage'));
const CallsPage = lazyWithRetry(() => import('./pages/CallsPage'));
const EquipmentPage = lazyWithRetry(() => import('./pages/EquipmentPage'));
const KnowledgeBasePage = lazyWithRetry(() => import('./pages/KnowledgeBasePage'));
const ReviewPublicPage = lazyWithRetry(() => import('./pages/ReviewPublicPage'));
const PrivacyPage = lazyWithRetry(() => import('./pages/PrivacyPage'));
const TermsPage = lazyWithRetry(() => import('./pages/TermsPage'));
const NotificationSettingsPage = lazyWithRetry(() => import('./pages/NotificationSettingsPage'));

// Admin pages
const AdminDashboardPage = lazyWithRetry(() => import('./pages/admin/AdminDashboardPage'));
const AdminTenantsPage = lazyWithRetry(() => import('./pages/admin/AdminTenantsPage'));
const AdminTenantDetailPage = lazyWithRetry(() => import('./pages/admin/AdminTenantDetailPage'));
const AdminPlansPage = lazyWithRetry(() => import('./pages/admin/AdminPlansPage'));
const AdminBroadcastPage = lazyWithRetry(() => import('./pages/admin/AdminBroadcastPage'));
const AdminAuditLogPage = lazyWithRetry(() => import('./pages/admin/AdminAuditLogPage'));

// ─── Feature gate definitions (same keys as mobile) ─────────────────────────
const FEATURE_GATES: Record<string, { title: string; description: string; benefits: string[] }> = {
  schedule_view: {
    title: 'Расписание',
    description: 'Управляйте графиком работы мастеров и планируйте загрузку автосервиса',
    benefits: ['График работы мастеров', 'Планирование смен', 'Контроль загрузки'],
  },
  clients_view: {
    title: 'Клиенты',
    description: 'Ведите базу клиентов с историей обращений и автомобилей',
    benefits: ['База клиентов', 'История обращений', 'Привязка автомобилей'],
  },
  services_view: {
    title: 'Услуги',
    description: 'Каталог услуг с ценами для быстрого оформления заказ-нарядов',
    benefits: ['Каталог услуг', 'Быстрое добавление в чек', 'Гибкие цены'],
  },
  suppliers_view: {
    title: 'Поставщики',
    description: 'Управляйте закупками, поставками и долгами перед поставщиками',
    benefits: ['Учёт поставок и закупок', 'Контроль долгов', 'История платежей'],
  },
  cashflow_view: {
    title: 'Движение денег',
    description: 'Отслеживайте все денежные потоки по дням и сотрудникам',
    benefits: ['Касса по дням', 'Разбивка по сотрудникам', 'Наличные и безналичные'],
  },
  salary_view: {
    title: 'Зарплата',
    description: 'Автоматический расчёт зарплат мастеров на основе выполненных работ',
    benefits: ['Автоматический расчёт', 'Процент от услуг', 'История выплат'],
  },
  reports_view: {
    title: 'Отчёты',
    description: 'Финансовые отчёты с анализом прибыли, расходов и маржинальности',
    benefits: ['Выручка и прибыль', 'Анализ расходов', 'Средний чек'],
  },
  users_manage: {
    title: 'Пользователи',
    description: 'Управляйте сотрудниками, ролями и правами доступа',
    benefits: ['Роли и права', 'Управление доступом', 'Контроль сотрудников'],
  },
};

/** Wrap a lazy page element with a FeatureGate paywall */
function gated(featureKey: string, element: ReactElement): ReactElement {
  const gate = FEATURE_GATES[featureKey];
  if (!gate) return element;
  return (
    <FeatureGate featureKey={featureKey} title={gate.title} description={gate.description} benefits={gate.benefits}>
      {element}
    </FeatureGate>
  );
}

function isSubscriptionExpired(subscriptionEnd?: string | null): boolean {
  if (!subscriptionEnd) return false; // No date set = no restriction
  const end = new Date(subscriptionEnd);
  const now = new Date();
  return end < now;
}

export default function App() {
  const { user, loading } = useAuth();

  // Authoritative subscription status (102) for the hard gate. This reuses the
  // same ['subscription'] cache Layout / FeatureGate already warm, so it adds no
  // extra network on the golden path.
  const isBlockableRole = !!user && user.role !== UserRole.SUPERADMIN;
  const { data: sub } = useQuery({
    queryKey: ['subscription'],
    queryFn: () => subscriptionApi.get().then((res) => res.data),
    enabled: isBlockableRole,
    staleTime: 5 * 60 * 1000,
  });

  if (loading) {
    return <LoadingSpinner />;
  }

  // Hard gate: a tenant whose subscription is `expired` or `suspended` cannot use
  // the app — every employee is routed to the block screen. `status` from
  // GET /subscription is the authoritative driver; until it resolves we fall back
  // to the me()-embedded subscriptionEnd date so an expired tenant never flashes
  // the full app on first paint.
  const subscriptionBlocked =
    isBlockableRole && (sub?.status ? sub.status !== 'active' : isSubscriptionExpired(user?.tenant?.subscriptionEnd));

  return (
    <ErrorBoundary>
      <Suspense
        fallback={
          <div className="flex items-center justify-center h-32">
            <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
          </div>
        }
      >
        <Routes>
          {/* Public: Review page (no auth) */}
          <Route path="/review/:token" element={<ReviewPublicPage />} />

          {/* Public: Privacy Policy & Terms of Use (no auth — required for App Store / Google Play review) */}
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/terms" element={<TermsPage />} />

          {/* Public: Landing on the root for anonymous visitors.
              Logged-in users are redirected exactly like on /login. */}
          <Route
            path="/"
            element={
              user ? (
                <Navigate to={user.role === UserRole.SUPERADMIN ? '/admin/dashboard' : '/dashboard'} replace />
              ) : (
                <LandingPage />
              )
            }
          />

          {/* Public: страницы-разделы лендинга /f/:slug. Доступны всем — залогиненных
              НЕ редиректим: пусть изучают возможности из-под своего аккаунта. */}
          <Route path="/f/:slug" element={<FeatureDetailPage />} />

          {/* Public: страница тарифов — по образцу /f/:slug, доступна и залогиненным */}
          <Route path="/tarify" element={<TarifyPage />} />

          {/* Public: Login */}
          <Route
            path="/login"
            element={
              user ? (
                <Navigate to={user.role === UserRole.SUPERADMIN ? '/admin/dashboard' : '/dashboard'} replace />
              ) : (
                <LoginPage />
              )
            }
          />

          {/* Protected routes */}
          {user ? (
            <>
              {/* Subscription blocked — show block screen for all routes */}
              {subscriptionBlocked ? (
                <Route path="*" element={<SubscriptionBlockedPage />} />
              ) : (
                <>
                  {/* Main app routes inside Layout.
                      «/» здесь больше нет — корень обслуживает публичный роут выше
                      (лендинг для гостей, Navigate в /dashboard для залогиненных). */}
                  <Route element={<Layout />}>
                    <Route path="/dashboard" element={<DashboardPage />} />
                    <Route path="/checks" element={<ChecksPage />} />
                    <Route path="/work-board" element={<WorkBoardPage />} />
                    <Route path="/checks/new" element={<CheckCreatePage />} />
                    <Route path="/checks/:id/edit" element={<CheckCreatePage />} />
                    <Route path="/checks/:id" element={<CheckDetailPage />} />
                    <Route path="/clients" element={gated('clients_view', <ClientsPage />)} />
                    <Route path="/clients/retail" element={gated('clients_view', <RetailChecksPage />)} />
                    <Route path="/clients/import" element={gated('clients_view', <ImportClientsCarsPage />)} />
                    <Route path="/clients/:id" element={gated('clients_view', <ClientDetailPage />)} />
                    <Route path="/cars" element={gated('clients_view', <CarsPage />)} />
                    <Route path="/products" element={<ProductsPage />} />
                    <Route path="/services" element={gated('services_view', <ServicesPage />)} />
                    <Route path="/suppliers" element={gated('suppliers_view', <SuppliersPage />)} />
                    <Route path="/suppliers/:id" element={gated('suppliers_view', <SupplierDetailPage />)} />
                    <Route path="/purchase-orders" element={gated('suppliers_view', <PurchaseOrdersPage />)} />
                    <Route path="/purchase-orders/new" element={gated('suppliers_view', <PurchaseOrderEditPage />)} />
                    <Route
                      path="/purchase-orders/:id/edit"
                      element={gated('suppliers_view', <PurchaseOrderEditPage />)}
                    />
                    <Route path="/purchase-orders/:id" element={gated('suppliers_view', <PurchaseOrderDetailPage />)} />
                    <Route path="/salary" element={gated('salary_view', <SalaryPage />)} />
                    <Route path="/reports" element={gated('reports_view', <ReportsPage />)} />
                    <Route path="/cashflow" element={gated('cashflow_view', <CashFlowPage />)} />
                    <Route path="/cash-shift" element={<CashShiftPage />} />
                    <Route path="/installments" element={<InstallmentsPage />} />
                    {/* Legacy «Дебиторка» path → «Рассрочка» (keeps old bookmarks alive) */}
                    <Route path="/debtors" element={<Navigate to="/installments" replace />} />
                    <Route path="/expenses" element={<ExpensesPage />} />
                    <Route path="/users" element={gated('users_manage', <UsersPage />)} />
                    <Route path="/employees" element={<EmployeesPage />} />
                    <Route path="/employees/:id" element={<EmployeeDetailPage />} />
                    <Route path="/schedule" element={gated('schedule_view', <SchedulePage />)} />
                    <Route path="/more" element={<MorePage />} />
                    <Route path="/notifications" element={<NotificationSettingsPage />} />
                    <Route path="/tariff" element={<TariffPage />} />
                    <Route path="/marketing" element={<MarketingPage />} />
                    <Route path="/calls" element={<CallsPage />} />
                    <Route path="/equipment" element={<EquipmentPage />} />
                    <Route path="/knowledge" element={<KnowledgeBasePage />} />
                    <Route path="/company-settings" element={<CompanySettingsPage />} />
                    <Route path="/integrations" element={<IntegrationsPage />} />
                  </Route>

                  {/* Admin routes inside AdminLayout (superadmin only) */}
                  {user.role === UserRole.SUPERADMIN && (
                    <Route element={<AdminLayout />}>
                      <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />
                      <Route path="/admin/dashboard" element={<AdminDashboardPage />} />
                      <Route path="/admin/tenants" element={<AdminTenantsPage />} />
                      <Route path="/admin/tenants/:id" element={<AdminTenantDetailPage />} />
                      <Route path="/admin/plans" element={<AdminPlansPage />} />
                      <Route path="/admin/broadcast" element={<AdminBroadcastPage />} />
                      <Route path="/admin/audit-log" element={<AdminAuditLogPage />} />
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
