import { type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  FileText,
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
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import type { UserPermissions } from '../types';

interface NavItem {
  label: string;
  path: string;
  icon: typeof LayoutDashboard;
  permission?: keyof UserPermissions;
}

const navItems: NavItem[] = [
  { label: 'Главная', path: '/', icon: LayoutDashboard },
  { label: 'Клиенты', path: '/clients', icon: Users, permission: 'clients_view' },
  { label: 'Касса', path: '/checks', icon: Receipt, permission: 'checks_view' },
  { label: 'Склад', path: '/products', icon: Package, permission: 'warehouse_access' },
  { label: 'Услуги', path: '/services', icon: Wrench },
  { label: 'Поставщики', path: '/suppliers', icon: Truck, permission: 'suppliers_access' },
  { label: 'Движение денег', path: '/cashflow', icon: Wallet },
  { label: 'Зарплата', path: '/salary', icon: Wallet },
  { label: 'Отчёты', path: '/reports', icon: BarChart3, permission: 'financial_reports' },
  { label: 'Пользователи', path: '/users', icon: Shield, permission: 'user_management' },
];

/** Bottom tab items for mobile (5 max like iOS) */
interface TabItem {
  label: string;
  path: string;
  icon: typeof LayoutDashboard;
  /** Match these paths as "active" for this tab */
  matchPaths?: string[];
}

/** Order: Главная, Склад, КАССА (center), Журнал, Ещё */
const mobileTabItems: (TabItem & { isCenter?: boolean })[] = [
  { label: 'Главная', path: '/', icon: LayoutDashboard, matchPaths: ['/'] },
  { label: 'Склад', path: '/products', icon: Package, matchPaths: ['/products'] },
  { label: 'Касса', path: '/checks/new', icon: Receipt, matchPaths: ['/checks/new'], isCenter: true },
  { label: 'Журнал', path: '/checks', icon: BookOpen, matchPaths: ['/checks'] },
  { label: 'Ещё', path: '/more', icon: MoreHorizontal, matchPaths: ['/more', '/clients', '/services', '/suppliers', '/salary', '/reports', '/users', '/cashflow'] },
];

const roleBadgeColors: Record<string, string> = {
  superadmin: 'bg-red-50 text-red-700',
  owner: 'bg-purple-50 text-purple-700',
  admin: 'bg-blue-50 text-blue-700',
  master: 'bg-green-50 text-green-700',
  storekeeper: 'bg-yellow-50 text-yellow-700',
  accountant: 'bg-gray-100 text-gray-600',
};

const roleLabels: Record<string, string> = {
  superadmin: 'Суперадмин',
  owner: 'Владелец',
  admin: 'Администратор',
  master: 'Мастер',
  storekeeper: 'Товаровед',
  accountant: 'Бухгалтер',
};

function getPageTitle(pathname: string): string[] {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return ['Dashboard'];

  const titles: string[] = [];
  const first = segments[0].charAt(0).toUpperCase() + segments[0].slice(1);
  titles.push(first);

  if (segments.length > 1) {
    if (segments[1] === 'new') {
      titles.push('Create');
    } else {
      titles.push('Details');
    }
  }

  return titles;
}

function isTabActive(tab: TabItem, pathname: string): boolean {
  // Exact match for Касса (checks/new)
  if (tab.path === '/checks/new') {
    return pathname === '/checks/new';
  }
  // Главная: exact match only
  if (tab.path === '/') {
    return pathname === '/';
  }
  // Журнал: match /checks but NOT /checks/new
  if (tab.path === '/checks') {
    return pathname === '/checks' || (pathname.startsWith('/checks/') && pathname !== '/checks/new');
  }
  // Others: startsWith match
  if (tab.matchPaths) {
    return tab.matchPaths.some((p) => pathname === p || pathname.startsWith(p + '/'));
  }
  return pathname === tab.path;
}

export default function Layout({ children }: { children: ReactNode }) {
  const { user, logout, hasPermission } = useAuth();
  const location = useLocation();

  const breadcrumbs = getPageTitle(location.pathname);
  const roleLabel = user?.role ? (roleLabels[user.role] || user.role) : '';

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-gray-50">
      {/* ─── Desktop sidebar ─── */}
      <aside className="hidden md:flex fixed inset-y-0 left-0 z-30 w-[260px] flex-col border-r border-gray-200 bg-white">
        {/* Logo */}
        <div className="flex h-16 items-center gap-3 border-b border-gray-200 px-6">
          <img src="/logo.png" alt="Autexa" className="h-9 max-w-[140px] object-contain" />
          <div className="min-w-0">
            {user?.tenant && (
              <span className="text-xs text-gray-500 truncate block">{user.tenant.name || ''}</span>
            )}
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <ul className="space-y-1">
            {navItems.map((item) => {
              if (item.permission && !hasPermission(item.permission)) {
                return null;
              }

              const Icon = item.icon;

              return (
                <li key={item.path}>
                  <NavLink
                    to={item.path}
                    end={item.path === '/'}
                    className={({ isActive }) =>
                      `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150 ${
                        isActive
                          ? 'bg-primary-50 text-primary-700'
                          : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                      }`
                    }
                  >
                    <Icon className="h-5 w-5 flex-shrink-0" />
                    <span>{item.label}</span>
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Sidebar footer */}
        <div className="border-t border-gray-200 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-100 text-primary-700 text-sm font-semibold">
              {user?.fullName?.charAt(0) || 'U'}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-gray-900">
                {user?.fullName || 'User'}
              </p>
              <p className="truncate text-xs text-gray-500">{roleLabel}</p>
            </div>
          </div>
        </div>
      </aside>

      {/* ─── Main area ─── */}
      <div className="flex flex-1 flex-col md:pl-[260px]">
        {/* ─── Desktop top bar ─── */}
        <header className="hidden md:flex sticky top-0 z-20 h-16 items-center justify-between border-b border-gray-200 bg-white px-6">
          {/* Breadcrumbs */}
          <div className="flex items-center gap-1.5 text-sm">
            {breadcrumbs.map((crumb, index) => (
              <span key={index} className="flex items-center gap-1.5">
                {index > 0 && (
                  <ChevronRight className="h-4 w-4 text-gray-400" />
                )}
                <span
                  className={
                    index === breadcrumbs.length - 1
                      ? 'font-semibold text-gray-900'
                      : 'text-gray-500'
                  }
                >
                  {crumb}
                </span>
              </span>
            ))}
          </div>

          {/* User info + logout */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2.5">
              <span className="text-sm font-medium text-gray-700">
                {user?.fullName}
              </span>
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  roleBadgeColors[user?.role || ''] || 'bg-gray-100 text-gray-600'
                }`}
              >
                {roleLabel}
              </span>
            </div>
            <button
              onClick={logout}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
              title="Logout"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Выход</span>
            </button>
          </div>
        </header>

        {/* ─── Mobile top bar ─── */}
        <header className="md:hidden sticky top-0 z-20 flex h-14 items-center justify-between border-b border-gray-200 bg-white px-4">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="Autexa" className="h-8 max-w-[130px] object-contain" />
          </div>
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary-100 text-primary-700 text-xs font-semibold">
              {user?.fullName?.charAt(0) || 'U'}
            </div>
          </div>
        </header>

        {/* ─── Page content (sole scroll container) ─── */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden p-4 md:p-6">{children}</main>

        {/* ─── Mobile bottom tab bar ─── */}
        {/* Flex item (NOT fixed): sits below <main> so content never goes under it */}
        <nav className="md:hidden flex-shrink-0 relative z-30 bg-white/95 backdrop-blur-lg border-t border-gray-100 pb-[env(safe-area-inset-bottom)]">
          <div className="flex items-center justify-around h-[68px] px-2">
            {mobileTabItems.map((tab) => {
              const Icon = tab.icon;
              const active = isTabActive(tab, location.pathname);

              // Center "Касса" button — pill shape, gradient accent
              if (tab.isCenter) {
                return (
                  <NavLink
                    key={tab.path}
                    to={tab.path}
                    replace
                    className="flex flex-col items-center -mt-6"
                  >
                    <div className="relative">
                      <div className="absolute inset-0 rounded-2xl bg-primary-400 blur-md opacity-40" />
                      <div
                        className="relative flex h-12 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-500 to-primary-700 text-white shadow-md transition-transform active:scale-95"
                      >
                        <Icon className="h-6 w-6" strokeWidth={2.2} />
                      </div>
                    </div>
                    <span className="text-[10px] font-bold mt-1 text-primary-600">
                      {tab.label}
                    </span>
                  </NavLink>
                );
              }

              return (
                <NavLink
                  key={tab.path}
                  to={tab.path}
                  replace
                  className="flex flex-col items-center justify-center gap-0.5 w-16 py-1.5 transition-colors"
                >
                  <div className={`flex items-center justify-center h-8 w-8 rounded-xl transition-colors ${active ? 'bg-primary-50' : ''}`}>
                    <Icon
                      className={`h-[22px] w-[22px] ${active ? 'text-primary-600' : 'text-gray-400'}`}
                      strokeWidth={active ? 2.2 : 1.8}
                    />
                  </div>
                  <span className={`text-[10px] font-medium ${active ? 'text-primary-600' : 'text-gray-400'}`}>
                    {tab.label}
                  </span>
                </NavLink>
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
}
