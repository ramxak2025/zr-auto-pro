import { ReactNode } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import {
  LayoutDashboard,
  ClipboardList,
  Users,
  Package,
  Wrench,
  Truck,
  Wallet,
  BarChart3,
  Calendar,
  UserCog,
  LogOut,
  MoreHorizontal,
  Home,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { UserPermissions } from '../types';

interface NavItem {
  label: string;
  path: string;
  icon: React.ElementType;
  permission?: keyof UserPermissions;
}

const navItems: NavItem[] = [
  { label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
  { label: 'Checks', path: '/checks', icon: ClipboardList, permission: 'checks_view' },
  { label: 'Clients', path: '/clients', icon: Users, permission: 'clients_view' },
  { label: 'Products', path: '/products', icon: Package, permission: 'warehouse_access' },
  { label: 'Services', path: '/services', icon: Wrench },
  { label: 'Suppliers', path: '/suppliers', icon: Truck, permission: 'suppliers_access' },
  { label: 'Salary', path: '/salary', icon: Wallet },
  { label: 'Reports', path: '/reports', icon: BarChart3, permission: 'financial_reports' },
  { label: 'Schedule', path: '/schedule', icon: Calendar },
  { label: 'Users', path: '/users', icon: UserCog, permission: 'user_management' },
];

interface MobileTab {
  label: string;
  path: string;
  icon: React.ElementType;
}

const mobileTabs: MobileTab[] = [
  { label: 'Home', path: '/dashboard', icon: Home },
  { label: 'Checks', path: '/checks', icon: ClipboardList },
  { label: 'Clients', path: '/clients', icon: Users },
  { label: 'Products', path: '/products', icon: Package },
  { label: 'More', path: '/more', icon: MoreHorizontal },
];

export default function Layout({ children }: { children: ReactNode }) {
  const { user, logout, hasPermission } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const visibleNavItems = navItems.filter(
    (item) => !item.permission || hasPermission(item.permission)
  );

  const isActive = (path: string) => location.pathname.startsWith(path);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex md:flex-col w-64 bg-white border-r border-gray-200">
        {/* Logo */}
        <div className="flex items-center h-16 px-6 border-b border-gray-200">
          <img src="/logo-horizontal.png" alt="Logo" className="h-8" />
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-4 px-3">
          <ul className="space-y-1">
            {visibleNavItems.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.path);
              return (
                <li key={item.path}>
                  <Link
                    to={item.path}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                      active
                        ? 'bg-primary-50 text-primary-600'
                        : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                    }`}
                  >
                    <Icon className="w-5 h-5 flex-shrink-0" />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* User Info */}
        <div className="border-t border-gray-200 p-4">
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0 w-9 h-9 rounded-full bg-primary-100 text-primary-600 flex items-center justify-center text-sm font-semibold">
              {user?.fullName?.charAt(0)?.toUpperCase() || 'U'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">
                {user?.fullName}
              </p>
              <p className="text-xs text-gray-500 truncate">{user?.role}</p>
            </div>
            <button
              onClick={handleLogout}
              className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-gray-100 transition-colors"
              title="Logout"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex flex-1 flex-col min-w-0">
        <main className="flex-1 overflow-y-auto p-4 md:p-6 pb-20 md:pb-6">
          {children}
        </main>

        {/* Mobile Bottom Tab Bar */}
        <nav className="md:hidden flex items-center justify-around bg-white border-t border-gray-200 py-1.5">
          {mobileTabs.map((tab) => {
            const Icon = tab.icon;
            const active = isActive(tab.path);
            return (
              <Link
                key={tab.path}
                to={tab.path}
                className={`flex flex-col items-center gap-0.5 px-3 py-1.5 text-xs font-medium transition-colors ${
                  active ? 'text-primary-600' : 'text-gray-400'
                }`}
              >
                <Icon className="w-5 h-5" />
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
