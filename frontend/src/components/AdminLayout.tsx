import { type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Building2,
  LogOut,
  ChevronRight,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

interface NavItem {
  label: string;
  path: string;
  icon: typeof LayoutDashboard;
}

const navItems: NavItem[] = [
  { label: 'Dashboard', path: '/', icon: LayoutDashboard },
  { label: 'Автосервисы', path: '/tenants', icon: Building2 },
];

function getPageTitle(pathname: string): string[] {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return ['Dashboard'];

  const labelMap: Record<string, string> = {
    tenants: 'Автосервисы',
  };

  const titles: string[] = [];
  const first = labelMap[segments[0]] || segments[0].charAt(0).toUpperCase() + segments[0].slice(1);
  titles.push(first);

  if (segments.length > 1) {
    titles.push('Детали');
  }

  return titles;
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const location = useLocation();

  const breadcrumbs = getPageTitle(location.pathname);

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-gray-50">
      {/* Sidebar */}
      <aside className="hidden md:flex fixed inset-y-0 left-0 z-30 w-[260px] flex-col bg-gray-900">
        {/* Logo */}
        <div className="flex h-16 items-center gap-3 border-b border-gray-700/50 px-6">
          <img src="/logo.png" alt="Autexa" className="h-10 aspect-[7/2] object-cover object-center brightness-0 invert" />
          <div className="flex flex-col">
            <span className="text-[11px] font-medium text-indigo-400 leading-tight">
              Панель управления
            </span>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <ul className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;

              return (
                <li key={item.path}>
                  <NavLink
                    to={item.path}
                    end={item.path === '/'}
                    className={({ isActive }) =>
                      `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150 ${
                        isActive
                          ? 'bg-indigo-600/20 text-indigo-400'
                          : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
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
        <div className="border-t border-gray-700/50 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600/20 text-indigo-400 text-sm font-semibold">
              {user?.fullName?.charAt(0) || 'S'}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-gray-200">
                {user?.fullName || 'Super Admin'}
              </p>
              <p className="truncate text-xs text-gray-500">Super Admin</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex flex-1 flex-col md:pl-[260px]">
        {/* Top bar */}
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-gray-200 bg-white px-4 md:px-6">
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
                {user?.fullName || 'Super Admin'}
              </span>
              <span className="inline-flex items-center rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700">
                Super Admin
              </span>
            </div>
            <button
              onClick={logout}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
              title="Выйти"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Выйти</span>
            </button>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
