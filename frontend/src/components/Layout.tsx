import { memo, useMemo } from 'react';
import { NavLink, useLocation, Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard,
  Users,
  Package,
  Wrench,
  Truck,
  Wallet,
  BarChart3,
  Shield,
  LogOut,
  ChevronRight,
  MoreHorizontal,
  Receipt,
  BookOpen,
  CalendarDays,
  Megaphone,
  Lock,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { subscriptionApi } from '../api/services';
import { usePullToRefresh } from '../hooks/usePullToRefresh';
import { useRoutePrefetch } from '../hooks/useRoutePrefetch';
import { useOfflineSync } from '../hooks/useOfflineSync';
import type { UserPermissions, SubscriptionInfo } from '../types';
import { roleLabels } from '../../../shared/utils/formatters';


interface NavItem {
  label: string;
  path: string;
  icon: typeof LayoutDashboard;
  permission?: keyof UserPermissions;
  featureKey?: string;
}

const navItems: NavItem[] = [
  { label: 'Главная', path: '/dashboard', icon: LayoutDashboard },
  { label: 'Клиенты', path: '/clients', icon: Users, permission: 'clients_view', featureKey: 'clients_view' },
  { label: 'Касса', path: '/checks', icon: Receipt, permission: 'checks_view' },
  { label: 'Склад', path: '/products', icon: Package, permission: 'warehouse_access' },
  { label: 'Услуги', path: '/services', icon: Wrench, featureKey: 'services_view' },
  { label: 'Поставщики', path: '/suppliers', icon: Truck, permission: 'suppliers_access', featureKey: 'suppliers_view' },
  { label: 'Движение денег', path: '/cashflow', icon: Wallet, featureKey: 'cashflow_view' },
  { label: 'Зарплата', path: '/salary', icon: Wallet, featureKey: 'salary_view' },
  { label: 'Расписание', path: '/schedule', icon: CalendarDays, featureKey: 'schedule_view' },
  { label: 'Отчёты', path: '/reports', icon: BarChart3, permission: 'financial_reports', featureKey: 'reports_view' },
  { label: 'Маркетинг', path: '/marketing', icon: Megaphone },
  { label: 'Пользователи', path: '/users', icon: Shield, permission: 'user_management', featureKey: 'users_manage' },
];

interface TabItem {
  label: string;
  path: string;
  icon: typeof LayoutDashboard;
  matchPaths?: string[];
}

const mobileTabItems: (TabItem & { isCenter?: boolean })[] = [
  { label: 'Главная', path: '/dashboard', icon: LayoutDashboard, matchPaths: ['/dashboard'] },
  { label: 'Склад', path: '/products', icon: Package, matchPaths: ['/products'] },
  { label: 'Касса', path: '/checks/new', icon: Receipt, matchPaths: ['/checks/new'], isCenter: true },
  { label: 'Журнал', path: '/checks', icon: BookOpen, matchPaths: ['/checks'] },
  { label: 'Ещё', path: '/more', icon: MoreHorizontal, matchPaths: ['/more', '/clients', '/services', '/suppliers', '/salary', '/reports', '/users', '/cashflow', '/schedule', '/tariff', '/clients/retail', '/marketing'] },
];

const roleBadgeColors: Record<string, string> = {
  superadmin: 'bg-red-50 text-red-700',
  director: 'bg-purple-50 text-purple-700',
  admin: 'bg-blue-50 text-blue-700',
  master: 'bg-green-50 text-green-700',
};

function getPageTitle(pathname: string): string[] {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return ['Dashboard'];
  const titles: string[] = [];
  const first = segments[0].charAt(0).toUpperCase() + segments[0].slice(1);
  titles.push(first);
  if (segments.length > 1) {
    titles.push(segments[1] === 'new' ? 'Создание' : 'Детали');
  }
  return titles;
}

function isTabActive(tab: TabItem & { isCenter?: boolean }, pathname: string): boolean {
  if (tab.path === '/checks/new') return pathname === '/checks/new';
  if (tab.path === '/dashboard') return pathname === '/dashboard' || pathname === '/';
  if (tab.path === '/checks') return pathname === '/checks' || (pathname.startsWith('/checks/') && pathname !== '/checks/new');
  if (tab.matchPaths) return tab.matchPaths.some((p) => pathname === p || pathname.startsWith(p + '/'));
  return pathname === tab.path;
}

// ─── Memoized static components ──────────────────────────────────────────────
// These parts of the layout don't depend on route/page data, so we memoize them
// to avoid re-renders when the <Outlet> content changes.

interface SidebarProps {
  userName: string;
  userAvatar?: string;
  userInitial: string;
  tenantName: string;
  roleLabel: string;
  hasPermission: (perm: keyof UserPermissions) => boolean;
  isFeatureLocked: (featureKey?: string) => boolean;
  onLogout: () => void;
}

const DesktopSidebar = memo(function DesktopSidebar({
  userName,
  userAvatar,
  userInitial,
  tenantName,
  roleLabel,
  hasPermission,
  isFeatureLocked,
  onLogout,
}: SidebarProps) {
  const prefetch = useRoutePrefetch();

  return (
    <aside className="hidden md:flex fixed inset-y-0 left-0 z-30 w-[260px] flex-col border-r border-gray-200 bg-white">
      <div className="flex h-16 items-center gap-3 border-b border-gray-200 px-6">
        <img src="/logo.png" alt="Logo" className="h-9 w-auto object-contain" />
        {tenantName && (
          <div className="min-w-0">
            <span className="text-sm font-semibold text-gray-900 truncate block">{tenantName}</span>
          </div>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="space-y-1">
          {navItems.map((item) => {
            if (item.permission && !hasPermission(item.permission)) return null;
            const Icon = item.icon;
            const locked = isFeatureLocked(item.featureKey);
            return (
              <li key={item.path}>
                <NavLink
                  to={item.path}
                  end={item.path === '/dashboard'}
                  {...prefetch(item.path)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150 ${
                      locked
                        ? 'text-gray-400 cursor-default'
                        : isActive
                          ? 'bg-primary-50 text-primary-700'
                          : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                    }`
                  }
                >
                  <Icon className={`h-5 w-5 flex-shrink-0 ${locked ? 'text-gray-300' : ''}`} />
                  <span className="flex-1">{item.label}</span>
                  {locked && <Lock className="h-3.5 w-3.5 text-gray-300" />}
                </NavLink>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-gray-200 px-4 py-3">
        <div className="flex items-center gap-3">
          {userAvatar ? (
            <img src={userAvatar} alt="" className="h-8 w-8 rounded-full object-cover" />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-100 text-primary-700 text-sm font-semibold">
              {userInitial}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-gray-900">{userName}</p>
            <p className="truncate text-xs text-gray-500">{roleLabel}</p>
          </div>
          <button onClick={onLogout} className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-gray-100 transition-colors" title="Выход">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
});

interface MobileHeaderProps {
  userAvatar?: string;
  userInitial: string;
}

const MobileHeader = memo(function MobileHeader({ userAvatar, userInitial }: MobileHeaderProps) {
  return (
    <header className="md:hidden sticky top-0 z-20 flex h-14 items-center justify-between border-b border-gray-200 bg-white px-4">
      <div className="flex items-center gap-2">
        <img src="/logo.png" alt="Logo" className="h-8 w-auto object-contain" />
      </div>
      <div className="flex items-center gap-2">
        {userAvatar ? (
          <img src={userAvatar} alt="" className="h-7 w-7 rounded-full object-cover" />
        ) : (
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary-100 text-primary-700 text-xs font-semibold">
            {userInitial}
          </div>
        )}
      </div>
    </header>
  );
});

interface MobileTabBarProps {
  pathname: string;
}

const MobileTabBar = memo(function MobileTabBar({ pathname }: MobileTabBarProps) {
  return (
    <nav className="md:hidden flex-shrink-0 relative z-30 bg-white/95 backdrop-blur-lg border-t border-gray-100 pb-[env(safe-area-inset-bottom)]">
      <div className="flex items-center justify-around h-[68px] px-2">
        {mobileTabItems.map((tab) => {
          const Icon = tab.icon;
          const active = isTabActive(tab, pathname);

          if (tab.isCenter) {
            return (
              <NavLink key={tab.path} to={tab.path} replace className="flex flex-col items-center -mt-6">
                <div className="relative">
                  <div className="absolute inset-0 rounded-2xl bg-primary-400 blur-md opacity-40" />
                  <div className="relative flex h-12 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-500 to-primary-700 text-white shadow-md transition-transform active:scale-95">
                    <Icon className="h-6 w-6" strokeWidth={2.2} />
                  </div>
                </div>
                <span className="text-[10px] font-bold mt-1 text-primary-600">{tab.label}</span>
              </NavLink>
            );
          }

          return (
            <NavLink key={tab.path} to={tab.path} replace className="flex flex-col items-center justify-center gap-0.5 w-16 py-1.5 transition-colors">
              <div className={`flex items-center justify-center h-8 w-8 rounded-xl transition-colors ${active ? 'bg-primary-50' : ''}`}>
                <Icon className={`h-[22px] w-[22px] ${active ? 'text-primary-600' : 'text-gray-400'}`} strokeWidth={active ? 2.2 : 1.8} />
              </div>
              <span className={`text-[10px] font-medium ${active ? 'text-primary-600' : 'text-gray-400'}`}>{tab.label}</span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
});

// ─── Main Layout ─────────────────────────────────────────────────────────────

export default function Layout() {
  const { user, logout, hasPermission } = useAuth();
  const location = useLocation();

  // Pull-to-refresh: invalidates all active React Query caches on pull down
  usePullToRefresh();

  // Background sync: handle offline mutations and online/offline events
  useOfflineSync();

  // Fetch subscription for feature gating in sidebar
  const { data: sub } = useQuery<SubscriptionInfo>({
    queryKey: ['subscription'],
    queryFn: async () => { const res = await subscriptionApi.get(); return res.data; },
    staleTime: 5 * 60 * 1000,
  });

  const currentPlan = sub?.plans?.find(p => p.name === sub?.planName);
  const planFeatures: string[] = Array.isArray(currentPlan?.features) ? currentPlan!.features : [];
  const isBypass = user?.role === 'superadmin';

  const isFeatureLocked = useMemo(() => (featureKey?: string) => {
    if (!featureKey || isBypass || !sub) return false;
    return !planFeatures.includes(featureKey);
  }, [isBypass, sub, planFeatures]);

  const breadcrumbs = getPageTitle(location.pathname);
  const roleLabel = user?.role ? (roleLabels[user.role] || user.role) : '';
  const userName = user?.fullName || 'User';
  const userInitial = user?.fullName?.charAt(0) || 'U';
  const tenantName = user?.tenant?.name || '';

  // Memoize to prevent unnecessary re-renders of child components
  const sidebarProps = useMemo(() => ({
    userName,
    userAvatar: user?.avatar,
    userInitial,
    tenantName,
    roleLabel,
    hasPermission,
    isFeatureLocked,
    onLogout: logout,
  }), [userName, user?.avatar, userInitial, tenantName, roleLabel, hasPermission, isFeatureLocked, logout]);

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-gray-50">
      {/* ─── Desktop sidebar (memoized) ─── */}
      <DesktopSidebar {...sidebarProps} />

      {/* ─── Main area ─── */}
      <div className="flex flex-1 flex-col md:pl-[260px] w-full min-w-0">
        {/* Desktop top bar */}
        <header className="hidden md:flex sticky top-0 z-20 h-16 items-center justify-between border-b border-gray-200 bg-white px-6">
          <div className="flex items-center gap-1.5 text-sm">
            {breadcrumbs.map((crumb, index) => (
              <span key={index} className="flex items-center gap-1.5">
                {index > 0 && <ChevronRight className="h-4 w-4 text-gray-400" />}
                <span className={index === breadcrumbs.length - 1 ? 'font-semibold text-gray-900' : 'text-gray-500'}>{crumb}</span>
              </span>
            ))}
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2.5">
              <span className="text-sm font-medium text-gray-700">{userName}</span>
              <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${roleBadgeColors[user?.role || ''] || 'bg-gray-100 text-gray-600'}`}>
                {roleLabel}
              </span>
            </div>
            <button onClick={logout} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700">
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Выход</span>
            </button>
          </div>
        </header>

        {/* Mobile top bar (memoized) */}
        <MobileHeader userAvatar={user?.avatar} userInitial={userInitial} />

        {/* Page content */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden p-4 pb-24 md:p-6 md:pb-6 w-full min-w-0">
          <div className="w-full min-w-0">
            <Outlet />
          </div>
        </main>

        {/* ─── Mobile bottom tab bar (memoized) ─── */}
        <MobileTabBar pathname={location.pathname} />
      </div>
    </div>
  );
}
