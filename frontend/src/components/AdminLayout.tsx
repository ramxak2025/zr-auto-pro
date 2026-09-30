import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { MotionConfig } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import {
  Building2,
  ChevronDown,
  ChevronRight,
  CreditCard,
  LayoutDashboard,
  LogOut,
  Megaphone,
  ScrollText,
  UserCog,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { adminApi } from '../api/services';
import { cn } from '../ui/cn';
import { DropdownMenu } from '../ui/DropdownMenu';
import { focusRing, focusRingOnRail } from '../ui/tokens';

// ─── Навигация панели платформы ─────────────────────────────────────────────
// Подписи пунктов совпадают с H1 страниц (правило системы: заголовок = пункт
// меню). Маршруты не менялись.
interface AdminNavItem {
  label: string;
  path: string;
  icon: LucideIcon;
  /** Пункт носит счётчик ожидающих заявок. */
  pendingBadge?: boolean;
}

const navItems: AdminNavItem[] = [
  { label: 'Главная', path: '/admin/dashboard', icon: LayoutDashboard },
  { label: 'Автосервисы', path: '/admin/tenants', icon: Building2 },
  { label: 'Менеджеры', path: '/admin/managers', icon: UserCog },
  { label: 'Заявки', path: '/admin/registration', icon: UserPlus, pendingBadge: true },
  { label: 'Тарифы', path: '/admin/plans', icon: CreditCard },
  { label: 'Рассылка', path: '/admin/broadcast', icon: Megaphone },
  { label: 'Журнал действий', path: '/admin/audit-log', icon: ScrollText },
];

// Разделы с карточкой записи: /admin/tenants/:id и /admin/managers/:id.
const detailCrumbs: Record<string, string> = {
  '/admin/tenants': 'Карточка автосервиса',
  '/admin/managers': 'Карточка менеджера',
};

/** Хлебные крошки: раздел (+ «Карточка» для страниц записи). */
function crumbsFor(pathname: string): { label: string; to?: string }[] {
  const item = navItems.find((i) => pathname === i.path || pathname.startsWith(i.path + '/'));
  if (!item) return [{ label: 'Панель платформы' }];
  const detail = detailCrumbs[item.path];
  if (pathname !== item.path && detail) {
    return [{ label: item.label, to: item.path }, { label: detail }];
  }
  return [{ label: item.label }];
}

function PendingBadge({ count }: { count: number }) {
  return (
    <span
      className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-warn px-1.5 text-2xs font-semibold tabular-nums text-white"
      aria-label={`${count} ожидающих заявок`}
    >
      {count}
    </span>
  );
}

/**
 * Оболочка суперадминки: та же идиома, что у Layout тенантского приложения —
 * тёмная боковая панель (rail), светлая верхняя панель с крошками и меню
 * пользователя, единственный скролл-контейнер <main id="main">. Панель
 * визуально отделяет «пульт платформы» от приложения автосервиса подписью
 * «Панель платформы» под логотипом.
 */
export default function AdminLayout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  // Счётчик ожидающих заявок → бейдж на пункте «Заявки» (кэш общий с Главной).
  const { data: pendingCount } = useQuery({
    queryKey: ['registration-requests', 'pending'],
    queryFn: () => adminApi.listRegistrationRequests('pending'),
    select: (res) => res.data.length,
    staleTime: 60_000,
  });

  const isActive = (path: string) => location.pathname === path || location.pathname.startsWith(path + '/');

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const crumbs = crumbsFor(location.pathname);
  const initial = user?.fullName?.trim().charAt(0).toUpperCase() || 'A';

  return (
    <MotionConfig reducedMotion="user">
      <div data-app className="flex h-[100dvh] overflow-hidden bg-canvas">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-ink focus:shadow-pop"
        >
          К содержимому
        </a>

        {/* Боковая панель (десктоп) */}
        <aside className="hidden w-[256px] flex-shrink-0 flex-col bg-rail text-rail-text md:flex">
          <div className="flex h-14 flex-shrink-0 items-center border-b border-white/10 px-4">
            <Link
              to="/admin/dashboard"
              aria-label="Autexa — панель платформы, на главную"
              className={cn('flex min-w-0 items-center gap-2.5 rounded-lg', focusRingOnRail)}
            >
              <img
                src="/logo-icon.png"
                alt=""
                width={32}
                height={32}
                className="h-8 w-8 flex-shrink-0 rounded-lg object-contain"
              />
              <span className="min-w-0">
                <span className="block truncate text-[17px] font-bold leading-5 tracking-tight text-white">Autexa</span>
                <span className="block truncate text-2xs font-semibold uppercase tracking-[0.08em] text-rail-muted">
                  Панель платформы
                </span>
              </span>
            </Link>
          </div>

          <nav aria-label="Разделы панели платформы" className="flex-1 overflow-y-auto px-3 py-3">
            <ul className="space-y-0.5">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.path);
                return (
                  <li key={item.path}>
                    <NavLink
                      to={item.path}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'group relative flex h-9 items-center gap-3 rounded-lg px-2.5 text-sm font-medium transition-colors duration-100',
                        focusRingOnRail,
                        active ? 'bg-white/10 text-white' : 'text-rail-text hover:bg-white/5 hover:text-white',
                      )}
                    >
                      {active && (
                        <span
                          className="absolute -left-3 bottom-1.5 top-1.5 w-[3px] rounded-r-full bg-accent"
                          aria-hidden="true"
                        />
                      )}
                      <Icon
                        className={cn(
                          'h-[18px] w-[18px] flex-shrink-0 transition-colors duration-100',
                          active ? 'text-white' : 'text-rail-muted group-hover:text-rail-text',
                        )}
                        strokeWidth={active ? 2.1 : 1.8}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      {item.pendingBadge && !!pendingCount && <PendingBadge count={pendingCount} />}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="flex-shrink-0 border-t border-white/10 p-3">
            <div className="flex items-center gap-3 px-1">
              <span
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-white/10 text-sm font-semibold text-white"
                aria-hidden="true"
              >
                {initial}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-white">{user?.fullName}</span>
                <span className="block truncate text-xs text-rail-muted">Владелец платформы</span>
              </span>
              <button
                type="button"
                onClick={handleLogout}
                aria-label="Выйти"
                title="Выйти"
                className={cn(
                  'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-rail-muted transition-colors hover:bg-white/5 hover:text-white',
                  focusRingOnRail,
                )}
              >
                <LogOut className="h-[18px] w-[18px]" aria-hidden="true" />
              </button>
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Верхняя панель (десктоп): крошки + меню пользователя */}
          <header className="hidden h-14 flex-shrink-0 items-center justify-between gap-4 border-b border-line bg-surface px-6 md:flex">
            <nav aria-label="Хлебные крошки" className="flex min-w-0 items-center gap-1.5 text-sm">
              <span className="text-ink-3">Панель платформы</span>
              {crumbs.map((c, i) => (
                <span key={`${c.label}-${i}`} className="flex min-w-0 items-center gap-1.5">
                  <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-ink-4" aria-hidden="true" />
                  {c.to ? (
                    <Link to={c.to} className={cn('truncate rounded text-ink-3 hover:text-ink', focusRing)}>
                      {c.label}
                    </Link>
                  ) : (
                    <span className="truncate font-medium text-ink" aria-current="page">
                      {c.label}
                    </span>
                  )}
                </span>
              ))}
            </nav>
            <DropdownMenu
              aria-label="Меню пользователя"
              trigger={
                <button
                  type="button"
                  className={cn(
                    'flex h-9 items-center gap-2 rounded-lg pl-1 pr-2 text-sm hover:bg-surface-3',
                    focusRing,
                  )}
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent-text">
                    {initial}
                  </span>
                  <span className="hidden max-w-[180px] truncate font-medium text-ink lg:block">{user?.fullName}</span>
                  <ChevronDown className="h-4 w-4 text-ink-4" aria-hidden="true" />
                </button>
              }
              items={[
                { type: 'label', key: 'role', label: 'Владелец платформы' },
                { key: 'logout', label: 'Выйти', icon: LogOut, danger: true, onSelect: handleLogout },
              ]}
            />
          </header>

          {/* Мобильная шапка */}
          <header className="flex h-14 flex-shrink-0 items-center justify-between border-b border-line bg-surface px-4 md:hidden">
            <Link
              to="/admin/dashboard"
              className={cn('flex min-w-0 items-center gap-2 rounded-lg', focusRing)}
              aria-label="Autexa — панель платформы, на главную"
            >
              <img src="/logo-icon.png" alt="" width={32} height={32} className="h-8 w-8 rounded-lg object-contain" />
              <span className="min-w-0">
                <span className="block truncate text-sm font-bold leading-4 text-ink">Autexa</span>
                <span className="block truncate text-2xs font-semibold uppercase tracking-[0.08em] text-ink-3">
                  Панель платформы
                </span>
              </span>
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              aria-label="Выйти"
              className={cn(
                'flex h-9 w-9 items-center justify-center rounded-lg text-ink-3 hover:bg-surface-3 hover:text-ink',
                focusRing,
              )}
            >
              <LogOut className="h-5 w-5" aria-hidden="true" />
            </button>
          </header>

          {/* Мобильные вкладки — горизонтальный скролл: семь пунктов в ширину телефона не влезают */}
          <nav
            aria-label="Разделы панели платформы"
            className="flex flex-shrink-0 items-center gap-1 overflow-x-auto border-b border-line bg-surface px-2 no-scrollbar md:hidden"
          >
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.path);
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    '-mb-px flex h-11 flex-shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-colors',
                    focusRing,
                    active ? 'border-accent text-accent-text' : 'border-transparent text-ink-2 hover:text-ink',
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {item.label}
                  {item.pendingBadge && !!pendingCount && <PendingBadge count={pendingCount} />}
                </NavLink>
              );
            })}
          </nav>

          <main
            id="main"
            tabIndex={-1}
            className="min-h-0 flex-1 overflow-y-auto px-4 py-5 outline-none md:px-6 md:py-6"
          >
            <div className="mx-auto w-full max-w-screen-2xl">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </MotionConfig>
  );
}
