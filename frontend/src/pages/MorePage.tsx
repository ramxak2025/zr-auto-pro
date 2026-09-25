import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRightLeft,
  BarChart3,
  Bell,
  BookOpen,
  Building2,
  CalendarDays,
  Camera,
  ChevronRight,
  ClipboardList,
  Coins,
  CreditCard,
  Lock,
  LogOut,
  Megaphone,
  Package,
  Phone,
  Plug,
  Shield,
  ShoppingCart,
  SlidersHorizontal,
  Truck,
  UserCircle,
  Users,
  Wallet,
  Wrench,
} from 'lucide-react';
import toast from 'react-hot-toast';

import { useAuth } from '../contexts/AuthContext';
import { authApi, subscriptionApi, uploadsApi } from '../api/services';
import type { SubscriptionInfo, UserPermissions } from '../types';
import { roleLabels } from '../../../shared/utils/formatters';
import { Card, IconButton, cn } from '../ui';
import { focusRing } from '../ui/tokens';
import DeleteAccountSection from '../components/DeleteAccountSection';
import UserAvatar from '../components/company/UserAvatar';
import { usePointAccess } from '../hooks/usePoints';

const PRIVACY_URL = 'https://autexa.pw/privacy';
const TERMS_URL = 'https://autexa.pw/terms';

interface MenuItem {
  label: string;
  description: string;
  path: string;
  icon: typeof Users;
  permission?: keyof UserPermissions;
  /** Пункт виден, если есть ХОТЯ БЫ ОДНО из прав (OR-гейт, зеркало backend). */
  anyPermission?: (keyof UserPermissions)[];
  /** Только для зон БЕЗ ключа матрицы (напр. биллинг «Тариф и подписка»). */
  roles?: string[];
  /**
   * Пункт виден, только если у пользователя больше одного АВТОСЕРВИСА
   * (156/160/161). Права здесь нет сознательно: переходить между автосервисами
   * обязан и мастер, работающий в двух, иначе он пробьёт заказ-наряд не туда.
   */
  multiPointOnly?: boolean;
  featureKey?: string;
}

const menuItems: MenuItem[] = [
  { label: 'Сотрудники', description: 'Карточки персонала, статус, рейтинги', path: '/employees', icon: UserCircle },
  {
    label: 'Расписание',
    description: 'График работы и смены',
    path: '/schedule',
    icon: CalendarDays,
    permission: 'schedule_view',
    featureKey: 'schedule_view',
  },
  {
    label: 'Клиенты',
    description: 'База клиентов',
    path: '/clients',
    icon: Users,
    permission: 'clients_view',
    featureKey: 'clients_view',
  },
  {
    label: 'Услуги',
    description: 'Каталог услуг',
    path: '/services',
    icon: Wrench,
    permission: 'services_view',
    featureKey: 'services_view',
  },
  {
    label: 'Поставщики',
    description: 'Поставки и расчёты',
    path: '/suppliers',
    icon: Truck,
    permission: 'suppliers_access',
    featureKey: 'suppliers_view',
  },
  {
    label: 'Заказы поставщикам',
    description: 'Закупки и приёмка на склад',
    path: '/purchase-orders',
    icon: ShoppingCart,
    permission: 'suppliers_access',
    featureKey: 'suppliers_view',
  },
  {
    label: 'Движение денег',
    description: 'Касса по дням и сотрудникам',
    path: '/cashflow',
    icon: ArrowRightLeft,
    permission: 'cashflow_view',
    featureKey: 'cashflow_view',
  },
  {
    label: 'Кассовая смена',
    description: 'Z-отчёт, инкассация, сверка кассы',
    path: '/cash-shift',
    icon: ClipboardList,
  },
  { label: 'Рассрочка', description: 'Продажи в рассрочку и график платежей', path: '/installments', icon: Coins },
  {
    label: 'Зарплата',
    description: 'Заработок мастеров',
    path: '/salary',
    icon: Wallet,
    permission: 'salary_view',
    featureKey: 'salary_view',
  },
  {
    label: 'Расходы',
    description: 'Аренда, маркетинг и др.',
    path: '/expenses',
    // Зеркало backend GET /expenses (OR-гейт): вносит расходы ЛИБО финансы.
    anyPermission: ['can_add_expenses', 'financial_reports'],
    icon: Wallet,
  },
  {
    label: 'Постоянные расходы и мотивация',
    description: 'Планирование для реальной чистой прибыли',
    path: '/planning',
    icon: SlidersHorizontal,
    permission: 'financial_reports',
  },
  {
    label: 'Отчёты',
    description: 'Финансовые отчёты',
    path: '/reports',
    icon: BarChart3,
    permission: 'financial_reports',
    featureKey: 'reports_view',
  },
  { label: 'Звонки', description: 'Журнал звонков и записи', path: '/calls', icon: Phone, permission: 'calls_view' },
  {
    label: 'Маркетинг',
    description: 'Рассылки, акции, аналитика',
    path: '/marketing',
    icon: Megaphone,
    permission: 'marketing_access',
  },
  { label: 'База знаний', description: 'Статьи, инструкции и регламенты', path: '/knowledge', icon: BookOpen },
  {
    label: 'Пользователи',
    description: 'Управление доступом',
    path: '/users',
    icon: Shield,
    permission: 'user_management',
    featureKey: 'users_manage',
  },
  {
    label: 'Имущество',
    description: 'Учёт инструментов и оборудования',
    path: '/equipment',
    icon: Package,
    permission: 'equipment_view',
  },
  { label: 'Уведомления', description: 'Push-уведомления по категориям', path: '/notifications', icon: Bell },
  {
    // «Филиалы» (156/160/161/163/167) — сводка по сети: основной сервис
    // владельца и открытые им филиалы с оборотом каждого. Это ЕДИНСТВЕННОЕ
    // место, где меняется филиал: руководителю — одним нажатием (перевыпуск
    // сессии), сотруднику — выходом и входом. В шапке только индикатор.
    label: 'Филиалы',
    description: 'Основной сервис и филиалы, обороты каждого',
    path: '/points',
    icon: Building2,
    multiPointOnly: true,
  },
  {
    label: 'Настройки компании',
    description: 'Реквизиты, автомобили, касса и лояльность',
    path: '/company-settings',
    icon: Building2,
    // Owner-only ячейка settings.company: у системного «Администратора» false.
    permission: 'company_manage',
  },
  {
    label: 'Интеграции',
    description: 'Эквайринг, СБП и онлайн-касса 54-ФЗ',
    path: '/integrations',
    icon: Plug,
    permission: 'settings_manage',
  },
  {
    label: 'Тариф и подписка',
    description: 'Ваш тариф, оплата, функционал',
    path: '/tariff',
    icon: CreditCard,
    roles: ['director', 'admin'],
  },
];

export default function MorePage() {
  const { user, logout, hasPermission, refreshUser } = useAuth();
  // Тот же ключ ['points'], что и у индикатора в шапке, — лишней сети нет.
  const { multiPoint } = usePointAccess();
  const roleLabel = user?.role ? roleLabels[user.role] || user.role : '';
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  // Подписка — для замков тарифа
  const { data: sub } = useQuery<SubscriptionInfo>({
    queryKey: ['subscription'],
    queryFn: async () => {
      const res = await subscriptionApi.get();
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
  });

  // Гейтим по серверным ключам возможностей текущего тарифа, а не по имени
  // тарифа. См. shared/constants/features.ts.
  const planFeatures: string[] = sub && Array.isArray(sub.features) ? sub.features : [];
  const isBypass = user?.role === 'superadmin';

  const isFeatureLocked = (featureKey?: string) => {
    if (!featureKey || isBypass || !sub) return false;
    return !planFeatures.includes(featureKey);
  };

  const handleAvatarUpload = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Максимальный размер файла: 5 МБ');
      return;
    }
    setUploading(true);
    try {
      const res = await uploadsApi.upload(file);
      await authApi.updateAvatar(res.data.url);
      await refreshUser();
      toast.success('Фото профиля обновлено');
    } catch {
      toast.error('Не удалось загрузить фото профиля');
    } finally {
      setUploading(false);
    }
  };

  const visibleItems = menuItems.filter((item) => {
    // ROLE-ONLY hide-by-permission: скрываем пункт без gating-права. Байпас
    // только superadmin/director — внутри hasPermission; admin живёт по
    // эффективным правам матрицы из /auth/me (волна Битрикс24).
    if (item.permission && !hasPermission(item.permission)) return false;
    if (item.anyPermission && !item.anyPermission.some((p) => hasPermission(p))) return false;
    if (item.roles && user?.role && !item.roles.includes(user.role)) return false;
    // «Филиалы» скрыты, когда показывать нечего: у тенанта один автосервис.
    if (item.multiPointOnly && !multiPoint) return false;
    return true;
  });

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <h1 className="page-title">Ещё</h1>

      {/* Профиль */}
      <Card padding="md">
        <div className="flex items-center gap-4">
          <div className="relative flex-shrink-0">
            <UserAvatar name={user?.fullName || 'U'} src={user?.avatar} size="lg" />
            <IconButton
              label="Загрузить фото профиля"
              icon={Camera}
              size="sm"
              variant="secondary"
              loading={uploading}
              onClick={() => fileInputRef.current?.click()}
              className="absolute -bottom-1 -right-1 rounded-full"
            />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleAvatarUpload(file);
                e.target.value = '';
              }}
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-md font-semibold text-ink">{user?.fullName || 'Пользователь'}</p>
            <p className="text-sm text-ink-3">{roleLabel}</p>
          </div>
        </div>
      </Card>

      {/* Разделы */}
      <Card padding="none">
        <nav aria-label="Разделы">
          <ul className="divide-y divide-line">
            {visibleItems.map((item) => {
              const Icon = item.icon;
              const locked = isFeatureLocked(item.featureKey);
              return (
                <li key={item.path}>
                  <Link
                    to={item.path}
                    aria-describedby={locked ? undefined : undefined}
                    className={cn(
                      'flex items-center gap-4 px-5 py-3.5 no-underline transition-colors first:rounded-t-xl last:rounded-b-xl',
                      locked ? 'opacity-70' : 'hover:bg-surface-2 active:bg-surface-3',
                      focusRing,
                    )}
                  >
                    <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-surface-3 text-ink-3">
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-ink">{item.label}</span>
                      <span className="block text-xs text-ink-3">{item.description}</span>
                    </span>
                    {locked ? (
                      <>
                        <Lock className="h-4 w-4 flex-shrink-0 text-ink-4" aria-hidden="true" />
                        <span className="sr-only">Недоступно в вашем тарифе</span>
                      </>
                    ) : (
                      <ChevronRight className="h-5 w-5 flex-shrink-0 text-ink-4" aria-hidden="true" />
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </Card>

      {/* Выход */}
      <Card padding="none">
        <button
          type="button"
          onClick={logout}
          className={cn(
            'flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3.5 text-sm font-medium text-bad-text transition-colors hover:bg-bad-soft active:bg-bad-soft',
            focusRing,
          )}
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          Выйти из аккаунта
        </button>
      </Card>

      {/* Опасная зона — удаление аккаунта (Apple 5.1.1(v) / Google Play) */}
      <DeleteAccountSection />

      {/* Правовые ссылки */}
      <p className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 pt-1 text-xs text-ink-3">
        <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer" className="rounded hover:text-ink focus-ring">
          Политика конфиденциальности
        </a>
        <span className="text-ink-4" aria-hidden="true">
          ·
        </span>
        <a href={TERMS_URL} target="_blank" rel="noopener noreferrer" className="rounded hover:text-ink focus-ring">
          Условия использования
        </a>
      </p>
    </div>
  );
}
