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
      {/* Sidebar — тёмный «пульт платформы», визуально отделяет суперадминку от
          тенантского приложения (контент остаётся светлым). */}
      <aside className="hidden md:flex md:flex-col w-64 bg-slate-900">
        {/* Brand */}
        <div className="flex items-center gap-3 h-16 px-5 border-b border-white/10">
          <div className="flex-shrink-0 rounded-lg bg-white p-1 shadow-sm">
            <img src="/logo.png" alt="Logo" className="h-7 w-auto object-contain" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-tight text-white">Autexa</p>
            <p className="text-[11px] leading-tight text-slate-400">Панель платформы</p>
          </div>
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
                      active ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-slate-100'
                    }`}
                  >
                    <Icon className={`w-5 h-5 flex-shrink-0 ${active ? 'text-primary-400' : ''}`} />
                    <span className="flex-1">{item.label}</span>
                    {item.path === '/admin/registration' && !!pendingCount && (
                      <span className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-amber-400 px-1.5 py-0.5 text-xs font-semibold text-slate-900">
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
        <div className="border-t border-white/10 p-4">
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0 w-9 h-9 rounded-full bg-white/10 text-white flex items-center justify-center text-sm font-semibold">
              {user?.fullName?.charAt(0)?.toUpperCase() || 'A'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-100 truncate">{user?.fullName}</p>
              <p className="text-xs text-slate-400 truncate">Владелец платформы</p>
            </div>
            <button
              onClick={handleLogout}
              className="p-1.5 text-slate-400 hover:text-red-400 rounded-lg hover:bg-white/5 transition-colors"
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
          <div className="flex items-center gap-2.5">
            <img src="/logo.png" alt="Logo" className="h-8 w-auto object-contain" />
            <span className="rounded-md bg-slate-900 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
              Админ
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleLogout} className="p-2 text-gray-500 hover:text-red-500" title="Выйти">
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </header>

        {/* Mobile Tab Navigation — горизонтальный скролл: 6 пунктов не влезают
            в ширину телефона, без overflow-x-auto последние были недостижимы. */}
        <nav className="md:hidden flex items-center bg-white border-b border-gray-200 px-2 overflow-x-auto no-scrollbar">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.path);
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap px-3.5 py-3 text-sm font-medium border-b-2 transition-colors ${
                  active
                    ? 'border-primary-600 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <Icon className="w-4 h-4" />
                {item.label}
                {item.path === '/admin/registration' && !!pendingCount && (
                  <span className="inline-flex min-w-[1.125rem] items-center justify-center rounded-full bg-amber-400 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-slate-900">
                    {pendingCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <main className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 p-4 md:p-6">
          <div className="mx-auto w-full max-w-screen-2xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
