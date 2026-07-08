import { useLocation, useNavigate, Link, Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { LayoutDashboard, Building2, CreditCard, Megaphone, ScrollText, UserPlus, LogOut } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { adminApi } from '../api/services';

const navItems = [
  { label: 'Панель', path: '/admin/dashboard', icon: LayoutDashboard },
  { label: 'Клиенты', path: '/admin/tenants', icon: Building2 },
  { label: 'Заявки', path: '/admin/registration', icon: UserPlus },
  { label: 'Тарифы', path: '/admin/plans', icon: CreditCard },
  { label: 'Рассылка', path: '/admin/broadcast', icon: Megaphone },
  { label: 'Журнал', path: '/admin/audit-log', icon: ScrollText },
];

export default function AdminLayout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  // Pending registration count → small badge on the «Заявки» nav item.
  const { data: pendingCount } = useQuery({
    queryKey: ['registration-requests', 'pending'],
    queryFn: () => adminApi.listRegistrationRequests('pending'),
    select: (res) => res.data.length,
    staleTime: 60_000,
  });

  const isActive = (path: string) => location.pathname.startsWith(path);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="flex h-screen h-[100dvh] overflow-hidden">
      {/* Sidebar */}
      <aside className="hidden md:flex md:flex-col w-64 bg-white border-r border-gray-200">
        {/* Logo */}
        <div className="flex items-center h-16 px-6 border-b border-gray-200">
          <img src="/logo.png" alt="Logo" className="h-9 w-auto object-contain" />
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-4 px-3">
          <ul className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.path);
              return (
                <li key={item.path}>
                  <Link
                    to={item.path}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                      active ? 'bg-primary-50 text-primary-600' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                    }`}
                  >
                    <Icon className="w-5 h-5 flex-shrink-0" />
                    <span className="flex-1">{item.label}</span>
                    {item.path === '/admin/registration' && !!pendingCount && (
                      <span className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-primary-600 px-1.5 py-0.5 text-xs font-semibold text-white">
                        {pendingCount}
                      </span>
                    )}
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
              {user?.fullName?.charAt(0)?.toUpperCase() || 'A'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">{user?.fullName}</p>
              <p className="text-xs text-gray-500 truncate">Владелец платформы</p>
            </div>
            <button
              onClick={handleLogout}
              className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-gray-100 transition-colors"
              title="Выйти"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile Header for Admin */}
      <div className="flex flex-1 flex-col min-w-0">
        <header className="md:hidden flex items-center justify-between h-14 px-4 bg-white border-b border-gray-200">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="Logo" className="h-8 w-auto object-contain" />
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleLogout} className="p-2 text-gray-500 hover:text-red-500">
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </header>

        {/* Mobile Tab Navigation */}
        <nav className="md:hidden flex items-center bg-white border-b border-gray-200 px-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.path);
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  active
                    ? 'border-primary-600 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <Icon className="w-4 h-4" />
                {item.label}
                {item.path === '/admin/registration' && !!pendingCount && (
                  <span className="inline-flex min-w-[1.125rem] items-center justify-center rounded-full bg-primary-600 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white">
                    {pendingCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <main className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
