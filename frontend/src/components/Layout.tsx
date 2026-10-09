import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { REPORT_CATALOG } from '../../../shared/reports/catalog';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { AnimatePresence, MotionConfig } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRightLeft,
  BarChart3,
  Bell,
  BookOpen,
  Building2,
  CalendarDays,
  Car,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Coins,
  CreditCard,
  GraduationCap,
  Hammer,
  LayoutDashboard,
  LayoutGrid,
  Lock,
  LogOut,
  Megaphone,
  MoreHorizontal,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Phone,
  Plug,
  Plus,
  Receipt,
  Settings,
  Shield,
  ShoppingCart,
  SlidersHorizontal,
  Truck,
  UserCircle,
  Users,
  Wallet,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import PageTransition from './PageTransition';
import PointIndicator from './PointIndicator';
import { useAuth } from '../contexts/AuthContext';
import { subscriptionApi } from '../api/services';
import { usePullToRefresh } from '../hooks/usePullToRefresh';
import { useRoutePrefetch } from '../hooks/useRoutePrefetch';
import { useOfflineSync } from '../hooks/useOfflineSync';
import { usePointAccess } from '../hooks/usePoints';
import type { UserPermissions, SubscriptionInfo } from '../types';
import { roleLabels } from '../../../shared/utils/formatters';
import { cn } from '../ui/cn';
import { Tooltip } from '../ui/Tooltip';
import { DropdownMenu, type MenuEntry } from '../ui/DropdownMenu';
import { buttonClasses } from '../ui/Button';
import { focusRing, focusRingOnRail } from '../ui/tokens';

// ─── Навигация ───────────────────────────────────────────────────────────────

interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
  /** Gating-право: пункт скрыт, если у сотрудника его нет (байпас — superadmin/director внутри hasPermission). */
  permission?: keyof UserPermissions;
  /** Пункт виден, если есть ХОТЯ БЫ ОДНО из прав (OR-гейт, зеркало backend). */
  anyPermission?: (keyof UserPermissions)[];
  /** Гейт по тарифу: замок, не скрытие (страница покажет paywall FeatureGate). */
  featureKey?: string;
  /** Только когда у тенанта больше одного автосервиса (156/160/161). */
  multiPointOnly?: boolean;
  /** Точное совпадение пути для активного состояния. */
  end?: boolean;
}

interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

// ROLE-ONLY (консолидация 2026-07): `permission` — gating-ключ. Пункт скрыт из
// меню, если у сотрудника нет этого права. Волна «права как в Битрикс24»:
// байпас только superadmin/director (внутри hasPermission); admin живёт по
// эффективным правам матрицы из /auth/me. `featureKey` — отдельный gate по
// тарифу (замок, не скрытие). Карта секция→ключ синхронизирована с mobile
// MoreScreen (и MorePage) и с бэкенд-guard'ами. Группы — по рабочим зонам
// владельца (docs/web-redesign/BRIEF.md §3).
const navGroups: NavGroup[] = [
  {
    id: 'work',
    label: 'Работа',
    items: [
      { label: 'Главная', path: '/dashboard', icon: LayoutDashboard, end: true },
      { label: 'Касса', path: '/checks/new', icon: Receipt, permission: 'checks_create', end: true },
      {
        label: 'Записи',
        path: '/bookings',
        icon: CalendarDays,
        anyPermission: ['bookings_access', 'company_manage'],
      },
      { label: 'Доска работ', path: '/work-board', icon: LayoutGrid, permission: 'checks_view' },
      { label: 'Журнал', path: '/checks', icon: BookOpen, permission: 'checks_view' },
    ],
  },
  {
    id: 'clients',
    label: 'Клиенты',
    items: [
      { label: 'Клиенты', path: '/clients', icon: Users, permission: 'clients_view', featureKey: 'clients_view' },
      { label: 'Автомобили', path: '/cars', icon: Car, permission: 'clients_view', featureKey: 'clients_view' },
      { label: 'Звонки', path: '/calls', icon: Phone, permission: 'calls_view' },
      { label: 'Маркетинг', path: '/marketing', icon: Megaphone, permission: 'marketing_access' },
    ],
  },
  {
    id: 'stock',
    label: 'Склад',
    items: [
      { label: 'Склад', path: '/products', icon: Package, permission: 'warehouse_access' },
      { label: 'Услуги', path: '/services', icon: Wrench, permission: 'services_view', featureKey: 'services_view' },
      {
        label: 'Поставщики',
        path: '/suppliers',
        icon: Truck,
        permission: 'suppliers_access',
        featureKey: 'suppliers_view',
      },
      {
        label: 'Заказы поставщикам',
        path: '/purchase-orders',
        icon: ShoppingCart,
        permission: 'suppliers_access',
        featureKey: 'suppliers_view',
      },
      { label: 'Имущество', path: '/equipment', icon: Hammer, permission: 'equipment_view' },
    ],
  },
  {
    id: 'money',
    label: 'Деньги',
    items: [
      {
        label: 'Движение денег',
        path: '/cashflow',
        icon: ArrowRightLeft,
        permission: 'cashflow_view',
        featureKey: 'cashflow_view',
      },
      { label: 'Кассовая смена', path: '/cash-shift', icon: ClipboardList },
      { label: 'Рассрочка', path: '/installments', icon: CreditCard },
      // Зеркало backend GET /expenses (OR-гейт): вносит расходы ЛИБО финансы.
      { label: 'Расходы', path: '/expenses', icon: Wallet, anyPermission: ['can_add_expenses', 'financial_reports'] },
      { label: 'Планирование', path: '/planning', icon: SlidersHorizontal, permission: 'financial_reports' },
      { label: 'Зарплата', path: '/salary', icon: Coins, permission: 'salary_view', featureKey: 'salary_view' },
      {
        label: 'Отчёты',
        path: '/reports',
        icon: BarChart3,
        // Конструктор отчётов (2026-09-25): раздел доступен по ЛЮБОМУ из прав
        // отчётов — завскладом открывает «По товарам» без финансовых прав;
        // какие именно отчёты видны, решает сервер (GET /reports/builder/catalog).
        anyPermission: [
          'financial_reports',
          'salary_view',
          'suppliers_access',
          'clients_view',
          'warehouse_access',
          'bookings_access',
        ],
        featureKey: 'reports_view',
      },
    ],
  },
  {
    id: 'company',
    label: 'Компания',
    items: [
      {
        label: 'Расписание',
        path: '/schedule',
        icon: CalendarDays,
        permission: 'schedule_view',
        featureKey: 'schedule_view',
      },
      { label: 'Сотрудники', path: '/employees', icon: UserCircle },
      {
        label: 'Пользователи',
        path: '/users',
        icon: Shield,
        permission: 'user_management',
        featureKey: 'users_manage',
      },
      // «Филиалы» (156/160/161/163/167) — ЕДИНСТВЕННОЕ место смены филиала; в шапке только индикатор.
      { label: 'Филиалы', path: '/points', icon: Building2, multiPointOnly: true },
      { label: 'База знаний', path: '/knowledge', icon: GraduationCap },
      // Owner-only ячейка settings.company: у системного «Администратора» false.
      { label: 'Настройки', path: '/company-settings', icon: Settings, permission: 'company_manage' },
      { label: 'Интеграции', path: '/integrations', icon: Plug, permission: 'settings_manage' },
    ],
  },
];

interface TabItem {
  label: string;
  path: string;
  icon: LucideIcon;
  matchPaths?: string[];
}

const mobileTabItems: (TabItem & { isCenter?: boolean })[] = [
  { label: 'Главная', path: '/dashboard', icon: LayoutDashboard, matchPaths: ['/dashboard'] },
  { label: 'Склад', path: '/products', icon: Package, matchPaths: ['/products'] },
  { label: 'Касса', path: '/checks/new', icon: Receipt, matchPaths: ['/checks/new'], isCenter: true },
  { label: 'Журнал', path: '/checks', icon: BookOpen, matchPaths: ['/checks'] },
  {
    label: 'Ещё',
    path: '/more',
    icon: MoreHorizontal,
    matchPaths: [
      '/more',
      '/work-board',
      '/clients',
      '/cars',
      '/services',
      '/suppliers',
      '/purchase-orders',
      '/salary',
      '/reports',
      '/users',
      '/employees',
      '/cashflow',
      '/cash-shift',
      '/installments',
      '/expenses',
      '/planning',
      '/schedule',
      '/tariff',
      '/clients/retail',
      '/marketing',
      '/calls',
      '/equipment',
      '/knowledge',
      '/company-settings',
      '/integrations',
      '/notifications',
      // «Филиалы» (156/160) — раздел живёт в «Ещё», как и в мобилке.
      '/points',
    ],
  },
];

// Русские подписи хлебных крошек по первому сегменту URL — сырые английские
// имена маршрутов («Products», «Clients») пользователю не показываем.
const routeTitles: Record<string, string> = {
  dashboard: 'Главная',
  checks: 'Журнал',
  'work-board': 'Доска работ',
  clients: 'Клиенты',
  cars: 'Автомобили',
  products: 'Склад',
  services: 'Услуги',
  suppliers: 'Поставщики',
  'purchase-orders': 'Заказы поставщикам',
  salary: 'Зарплата',
  reports: 'Отчёты',
  cashflow: 'Движение денег',
  'cash-shift': 'Кассовая смена',
  installments: 'Рассрочка',
  expenses: 'Расходы',
  planning: 'Планирование',
  users: 'Пользователи',
  employees: 'Сотрудники',
  schedule: 'Расписание',
  more: 'Ещё',
  // Без этой строки хлебная крошка показывала сырое «Points» — раздел, куда
  // владелец заходит смотреть выручку каждого автосервиса.
  points: 'Филиалы',
  notifications: 'Уведомления',
  tariff: 'Тариф',
  marketing: 'Маркетинг',
  calls: 'Звонки',
  equipment: 'Имущество',
  knowledge: 'База знаний',
  'company-settings': 'Настройки компании',
  integrations: 'Интеграции',
  bookings: 'Записи',
};

const subRouteTitles: Record<string, string> = {
  new: 'Новый',
  edit: 'Редактирование',
  retail: 'Розница',
  import: 'Импорт',
  financial: 'Финансовый отчёт',
};

/** Подпись детальной страницы по разделу (`/clients/:id` → «Клиент»). */
const detailTitles: Record<string, string> = {
  checks: 'Чек',
  clients: 'Клиент',
  suppliers: 'Поставщик',
  employees: 'Сотрудник',
  'purchase-orders': 'Заказ',
  reports: 'Отчёт',
};

function getPageTitle(pathname: string): string[] {
  if (pathname === '/checks/new') return ['Касса'];
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return ['Главная'];
  const titles: string[] = [];
  titles.push(routeTitles[segments[0]] ?? segments[0].charAt(0).toUpperCase() + segments[0].slice(1));
  if (segments.length > 1) {
    const last = segments[segments.length - 1];
    // /reports/<id> — название отчёта из общего каталога («Отчёты › По мастерам»).
    const reportTitle =
      segments[0] === 'reports' && segments.length === 2 ? REPORT_CATALOG.find((r) => r.id === last)?.title : undefined;
    titles.push(reportTitle ?? subRouteTitles[last] ?? detailTitles[segments[0]] ?? 'Детали');
  }
  return titles;
}

function isTabActive(tab: TabItem & { isCenter?: boolean }, pathname: string): boolean {
  if (tab.path === '/checks/new') return pathname === '/checks/new';
  if (tab.path === '/dashboard') return pathname === '/dashboard' || pathname === '/';
  if (tab.path === '/checks')
    return pathname === '/checks' || (pathname.startsWith('/checks/') && pathname !== '/checks/new');
  if (tab.matchPaths) return tab.matchPaths.some((p) => pathname === p || pathname.startsWith(p + '/'));
  return pathname === tab.path;
}

/** Активный пункт боковой панели: «Касса» — только /checks/new, «Журнал» — /checks и детали чеков. */
function isNavActive(item: NavItem, pathname: string): boolean {
  if (item.end) return pathname === item.path || (item.path === '/dashboard' && pathname === '/');
  if (item.path === '/checks')
    return pathname === '/checks' || (pathname.startsWith('/checks/') && pathname !== '/checks/new');
  return pathname === item.path || pathname.startsWith(item.path + '/');
}

// ─── Состояние сворачивания (localStorage) ───────────────────────────────────

const SIDEBAR_KEY = 'autexa.sidebar';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === 'collapsed';
  } catch {
    return false;
  }
}

function writeCollapsed(value: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_KEY, value ? 'collapsed' : 'expanded');
  } catch {
    // Safari Private Mode / отключённое хранилище — просто не запоминаем.
  }
}

// ─── Боковая панель ──────────────────────────────────────────────────────────

interface RailLinkProps {
  item: NavItem;
  active: boolean;
  locked: boolean;
  collapsed: boolean;
  prefetchProps: Record<string, unknown>;
}

function RailLink({ item, active, locked, collapsed, prefetchProps }: RailLinkProps) {
  const Icon = item.icon;
  const link = (
    <Link
      to={item.path}
      {...prefetchProps}
      aria-current={active ? 'page' : undefined}
      aria-label={collapsed ? item.label : undefined}
      className={cn(
        'group relative flex h-9 items-center rounded-lg text-sm font-medium transition-colors duration-100',
        focusRingOnRail,
        collapsed ? 'justify-center px-0' : 'gap-3 px-2.5',
        locked
          ? 'text-rail-muted hover:bg-white/5'
          : active
            ? 'bg-white/10 text-white'
            : 'text-rail-text hover:bg-white/5 hover:text-white',
      )}
    >
      {active && (
        <span className="absolute -left-3 bottom-1.5 top-1.5 w-[3px] rounded-r-full bg-accent" aria-hidden="true" />
      )}
      <Icon
        className={cn(
          'h-[18px] w-[18px] flex-shrink-0 transition-colors duration-100',
          locked ? 'text-rail-muted' : active ? 'text-white' : 'text-rail-muted group-hover:text-rail-text',
        )}
        strokeWidth={active ? 2.1 : 1.8}
        aria-hidden="true"
      />
      {!collapsed && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
      {!collapsed && locked && <Lock className="h-3.5 w-3.5 flex-shrink-0 text-rail-muted" aria-hidden="true" />}
      {collapsed && locked && (
        <Lock className="absolute right-1.5 top-1.5 h-2.5 w-2.5 text-rail-muted" aria-hidden="true" />
      )}
    </Link>
  );
  if (!collapsed) return link;
  return (
    <Tooltip content={locked ? `${item.label} — недоступно в тарифе` : item.label} side="right" delay={150}>
      {link}
    </Tooltip>
  );
}

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  pathname: string;
  canSee: (item: NavItem) => boolean;
  isFeatureLocked: (featureKey?: string) => boolean;
}

const DesktopSidebar = memo(function DesktopSidebar({
  collapsed,
  onToggle,
  pathname,
  canSee,
  isFeatureLocked,
}: SidebarProps) {
  const prefetch = useRoutePrefetch();
  const toggleLabel = collapsed ? 'Развернуть меню' : 'Свернуть меню';

  return (
    <aside
      className={cn(
        'fixed inset-y-0 left-0 z-30 hidden flex-col bg-rail text-rail-text transition-[width] duration-150 ease-out md:flex',
        collapsed ? 'w-[72px]' : 'w-[256px]',
      )}
    >
      <div
        className={cn(
          'flex h-14 flex-shrink-0 items-center border-b border-white/10',
          collapsed ? 'justify-center' : 'px-4',
        )}
      >
        <Link
          to="/dashboard"
          aria-label="Autexa — на главную"
          className={cn('flex items-center gap-2.5 rounded-lg', focusRingOnRail)}
        >
          <img
            src="/logo-icon.png"
            alt=""
            width={32}
            height={32}
            className="h-8 w-8 flex-shrink-0 rounded-lg object-contain"
          />
          {!collapsed && <span className="text-[17px] font-bold tracking-tight text-white">Autexa</span>}
        </Link>
      </div>

      <nav aria-label="Основная навигация" className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-3">
        {navGroups.map((group) => {
          const items = group.items.filter(canSee);
          if (items.length === 0) return null;
          return (
            <div key={group.id} className="mb-1.5">
              {collapsed ? (
                <div className="mx-2 my-2 h-px bg-white/10" role="separator" aria-label={group.label} />
              ) : (
                <p className="px-2.5 pb-1 pt-2.5 text-2xs font-semibold uppercase tracking-[0.08em] text-rail-muted">
                  {group.label}
                </p>
              )}
              <ul className="space-y-0.5">
                {items.map((item) => (
                  <li key={item.path}>
                    <RailLink
                      item={item}
                      active={isNavActive(item, pathname)}
                      locked={isFeatureLocked(item.featureKey)}
                      collapsed={collapsed}
                      prefetchProps={prefetch(item.path)}
                    />
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </nav>

      <div className="flex-shrink-0 border-t border-white/10 p-3">
        <Tooltip content={toggleLabel} side="right" disabled={!collapsed}>
          <button
            type="button"
            onClick={onToggle}
            aria-label={toggleLabel}
            className={cn(
              'flex h-9 w-full items-center rounded-lg text-sm text-rail-muted transition-colors duration-100 hover:bg-white/5 hover:text-white',
              focusRingOnRail,
              collapsed ? 'justify-center' : 'gap-3 px-2.5',
            )}
          >
            {collapsed ? (
              <PanelLeftOpen className="h-[18px] w-[18px]" aria-hidden="true" />
            ) : (
              <PanelLeftClose className="h-[18px] w-[18px]" aria-hidden="true" />
            )}
            {!collapsed && <span>Свернуть</span>}
          </button>
        </Tooltip>
      </div>
    </aside>
  );
});

// ─── Мобильные шапка и таб-бар ───────────────────────────────────────────────

interface MobileHeaderProps {
  userAvatar?: string;
  userInitial: string;
}

const MobileHeader = memo(function MobileHeader({ userAvatar, userInitial }: MobileHeaderProps) {
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-line bg-surface px-4 md:hidden">
      <Link
        to="/dashboard"
        className={cn('flex min-w-0 items-center gap-2 rounded-lg', focusRing)}
        aria-label="Autexa — на главную"
      >
        <img src="/logo.png" alt="" width={132} height={32} className="h-8 w-auto object-contain" />
      </Link>
      <div className="flex min-w-0 items-center gap-2">
        {/* Автосервис ЭТОЙ СЕССИИ (156/160/163). Филиал выбран при входе и
            до выхода не меняется — человек обязан видеть, где работает, до
            того как пробьёт чек. Это подпись, а не кнопка: ни выбора, ни
            перехода. Прячется, когда автосервис у тенанта один. */}
        <PointIndicator />
        <Link to="/more" aria-label="Профиль и ещё" className={cn('rounded-full', focusRing)}>
          {userAvatar ? (
            <img src={userAvatar} alt="" width={28} height={28} className="h-7 w-7 rounded-full object-cover" />
          ) : (
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent-text">
              {userInitial}
            </span>
          )}
        </Link>
      </div>
    </header>
  );
});

interface MobileTabBarProps {
  pathname: string;
}

const MobileTabBar = memo(function MobileTabBar({ pathname }: MobileTabBarProps) {
  return (
    <nav
      aria-label="Разделы"
      className="relative z-30 flex-shrink-0 border-t border-line bg-surface/95 pb-8 backdrop-blur-lg md:hidden"
    >
      <div className="flex h-[68px] items-center justify-around px-2">
        {mobileTabItems.map((tab) => {
          const Icon = tab.icon;
          const active = isTabActive(tab, pathname);

          if (tab.isCenter) {
            return (
              <NavLink
                key={tab.path}
                to={tab.path}
                replace
                aria-current={active ? 'page' : undefined}
                className={cn('-mt-6 flex flex-col items-center rounded-xl', focusRing)}
              >
                <span className="flex h-12 w-20 items-center justify-center rounded-xl bg-accent text-white shadow-pop transition-transform active:scale-95">
                  <Icon className="h-6 w-6" strokeWidth={2.2} aria-hidden="true" />
                </span>
                <span className="mt-1 text-2xs font-bold text-accent-text">{tab.label}</span>
              </NavLink>
            );
          }

          return (
            <NavLink
              key={tab.path}
              to={tab.path}
              replace
              aria-current={active ? 'page' : undefined}
              className={cn('flex w-16 flex-col items-center justify-center gap-0.5 rounded-lg py-1.5', focusRing)}
            >
              <span
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-xl transition-colors',
                  active ? 'bg-accent-soft' : '',
                )}
              >
                <Icon
                  className={cn('h-[22px] w-[22px]', active ? 'text-accent' : 'text-ink-3')}
                  strokeWidth={active ? 2.2 : 1.8}
                  aria-hidden="true"
                />
              </span>
              <span className={cn('text-2xs font-medium', active ? 'text-accent-text' : 'text-ink-3')}>
                {tab.label}
              </span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
});

// ─── Оболочка ────────────────────────────────────────────────────────────────

export default function Layout() {
  const { user, logout, hasPermission } = useAuth();
  const location = useLocation();
  const { multiPoint } = usePointAccess();

  const [collapsed, setCollapsed] = useState<boolean>(readCollapsed);
  const toggleCollapsed = useCallback(() => {
    setCollapsed((v) => {
      writeCollapsed(!v);
      return !v;
    });
  }, []);

  // Внутри залогиненного приложения вкладка называется коротко «Autexa»;
  // длинный SEO-title из index.html остаётся лендингу и странице логина.
  useEffect(() => {
    const seoTitle = document.title;
    document.title = 'Autexa';
    return () => {
      document.title = seoTitle;
    };
  }, []);

  // Pull-to-refresh: invalidates all active React Query caches on pull down
  usePullToRefresh();

  // Background sync: handle offline mutations and online/offline events
  useOfflineSync();

  // Fetch subscription for feature gating in sidebar
  const { data: sub } = useQuery<SubscriptionInfo>({
    queryKey: ['subscription'],
    queryFn: async () => {
      const res = await subscriptionApi.get();
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
  });

  const isBypass = user?.role === 'superadmin';

  const isFeatureLocked = useMemo(() => {
    // Источник правды — серверный набор ключей текущего тарифа (`sub.features`),
    // тот же, что в FeatureGate. Поиск плана по имени в `sub.plans` — только
    // запасной путь для старого ответа: у демо-тарифа плана в списке нет, и все
    // пункты с featureKey получали замок, хотя страницы открывались.
    const currentPlan = sub?.plans?.find((p) => p.name === sub?.planName);
    const planFeatures: string[] = Array.isArray(sub?.features)
      ? sub.features
      : Array.isArray(currentPlan?.features)
        ? currentPlan.features
        : [];
    return (featureKey?: string) => {
      if (!featureKey || isBypass || !sub) return false;
      return !planFeatures.includes(featureKey);
    };
  }, [isBypass, sub]);

  // ROLE-ONLY hide-by-permission: скрываем пункт без gating-права; OR-гейт для
  // anyPermission; «Филиалы» — только при нескольких автосервисах.
  const canSee = useCallback(
    (item: NavItem): boolean => {
      if (item.permission && !hasPermission(item.permission)) return false;
      if (item.anyPermission && !item.anyPermission.some((p) => hasPermission(p))) return false;
      if (item.multiPointOnly && !multiPoint) return false;
      return true;
    },
    [hasPermission, multiPoint],
  );

  const breadcrumbs = getPageTitle(location.pathname);
  const rootPath = '/' + (location.pathname.split('/').filter(Boolean)[0] ?? 'dashboard');
  const roleLabel = user?.role ? roleLabels[user.role] || user.role : '';
  const userName = user?.fullName || 'User';
  const userInitial = user?.fullName?.charAt(0) || 'U';
  const showNewCheck = hasPermission('checks_create') && location.pathname !== '/checks/new';
  const canSeeTariff = user?.role === 'director' || user?.role === 'admin';

  const userMenu = useMemo<MenuEntry[]>(() => {
    const items: MenuEntry[] = [
      { type: 'label', key: 'role', label: roleLabel },
      { key: 'more', label: 'Профиль и ещё', icon: MoreHorizontal, to: '/more' },
      { key: 'notifications', label: 'Уведомления', icon: Bell, to: '/notifications' },
    ];
    if (canSeeTariff) items.push({ key: 'tariff', label: 'Тариф и подписка', icon: CreditCard, to: '/tariff' });
    items.push(
      { type: 'separator', key: 's1' },
      { key: 'logout', label: 'Выйти', icon: LogOut, danger: true, onSelect: logout },
    );
    return items;
  }, [roleLabel, canSeeTariff, logout]);

  return (
    <MotionConfig reducedMotion="user">
      <div data-app="" className="flex h-[100dvh] overflow-hidden bg-canvas">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[10001] focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-ink focus:shadow-pop"
        >
          К содержимому
        </a>

        <DesktopSidebar
          collapsed={collapsed}
          onToggle={toggleCollapsed}
          pathname={location.pathname}
          canSee={canSee}
          isFeatureLocked={isFeatureLocked}
        />

        <div
          className={cn(
            'flex w-full min-w-0 flex-1 flex-col transition-[padding] duration-150 ease-out',
            collapsed ? 'md:pl-[72px]' : 'md:pl-[256px]',
          )}
        >
          {/* Верхняя панель: крошки · филиал · главное действие · пользователь */}
          <header className="sticky top-0 z-20 hidden h-14 flex-shrink-0 items-center gap-3 border-b border-line bg-surface px-6 md:flex">
            <nav aria-label="Хлебные крошки" className="flex min-w-0 items-center gap-1.5 text-sm">
              {breadcrumbs.map((crumb, index) => {
                const last = index === breadcrumbs.length - 1;
                return (
                  <span key={index} className="flex min-w-0 items-center gap-1.5">
                    {index > 0 && <ChevronRight className="h-4 w-4 flex-shrink-0 text-ink-4" aria-hidden="true" />}
                    {last ? (
                      <span className="truncate font-semibold text-ink" aria-current="page">
                        {crumb}
                      </span>
                    ) : (
                      <Link to={rootPath} className={cn('truncate rounded text-ink-3 hover:text-ink', focusRing)}>
                        {crumb}
                      </Link>
                    )}
                  </span>
                );
              })}
            </nav>

            <div className="ml-auto flex items-center gap-2.5">
              {/* Автосервис (156/160/163) — см. комментарий в MobileHeader. */}
              <PointIndicator />
              {showNewCheck && (
                <Link to="/checks/new" className={buttonClasses({ variant: 'primary', size: 'md' })}>
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Новый чек
                </Link>
              )}
              <DropdownMenu
                aria-label="Меню пользователя"
                align="end"
                width={240}
                items={userMenu}
                trigger={
                  <button
                    type="button"
                    className={cn(
                      'flex h-9 items-center gap-2 rounded-lg pl-1 pr-2 text-left transition-colors hover:bg-surface-3',
                      focusRing,
                    )}
                  >
                    {user?.avatar ? (
                      <img
                        src={user.avatar}
                        alt=""
                        width={28}
                        height={28}
                        className="h-7 w-7 rounded-full object-cover"
                      />
                    ) : (
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent-text">
                        {userInitial}
                      </span>
                    )}
                    <span className="hidden min-w-0 lg:block">
                      <span className="block max-w-[160px] truncate text-sm font-medium leading-tight text-ink">
                        {userName}
                      </span>
                      <span className="block text-2xs leading-tight text-ink-3">{roleLabel}</span>
                    </span>
                    <ChevronDown className="h-4 w-4 text-ink-4" aria-hidden="true" />
                  </button>
                }
              />
            </div>
          </header>

          <MobileHeader userAvatar={user?.avatar} userInitial={userInitial} />

          {/* Контент — кросс-фейд при смене маршрута. Внутренний контейнер
              ограничивает ширину чтения на широких мониторах (max-w-screen-2xl),
              на телефонах и планшетах остаётся во всю ширину. */}
          <main
            id="main"
            tabIndex={-1}
            className="w-full min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-4 pb-24 outline-none md:p-6 md:pb-8"
          >
            <div className="mx-auto w-full min-w-0 max-w-screen-2xl">
              <AnimatePresence mode="wait">
                <PageTransition key={location.pathname}>
                  <Outlet />
                </PageTransition>
              </AnimatePresence>
            </div>
          </main>

          <MobileTabBar pathname={location.pathname} />
        </div>
      </div>
    </MotionConfig>
  );
}
