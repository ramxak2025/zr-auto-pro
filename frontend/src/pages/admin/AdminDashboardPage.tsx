import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Building2,
  Users,
  ArrowRight,
  Activity,
  CreditCard,
  TrendingUp,
  BadgeRussianRuble,
  CalendarClock,
  UserPlus,
  Megaphone,
  ScrollText,
  Inbox,
} from 'lucide-react';

import { tenantsApi, adminApi } from '../../api/services';
import { PlatformStats } from '../../types';
import QueryState from '../../components/QueryState';
import MrrTrendChart from '../../components/MrrTrendChart';
import SubscriptionRevenuePanel from '../../components/SubscriptionRevenuePanel';
import { AdminPageHeader, StatTile } from '../../components/admin/adminUi';

function formatRub(value: number | undefined): string {
  return `${(value ?? 0).toLocaleString('ru-RU')} ₽`;
}

// «1 заявка ждёт / 2 заявки ждут / 5 заявок ждут»
function pendingPhrase(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'заявка на регистрацию ждёт решения';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'заявки на регистрацию ждут решения';
  return 'заявок на регистрацию ждут решения';
}

const QUICK_LINKS = [
  {
    to: '/admin/tenants',
    icon: Building2,
    iconClass: 'bg-primary-50 text-primary-600',
    title: 'Управление клиентами',
    subtitle: 'Просмотр, создание и редактирование автосервисов',
  },
  {
    to: '/admin/plans',
    icon: CreditCard,
    iconClass: 'bg-green-50 text-green-600',
    title: 'Управление тарифами',
    subtitle: 'Настройка тарифных планов и цен',
  },
  {
    to: '/admin/broadcast',
    icon: Megaphone,
    iconClass: 'bg-violet-50 text-violet-600',
    title: 'Рассылка владельцам',
    subtitle: 'Объявление со ссылкой и кнопками — директорам',
  },
  {
    to: '/admin/audit-log',
    icon: ScrollText,
    iconClass: 'bg-amber-50 text-amber-600',
    title: 'Журнал действий',
    subtitle: 'История операций администраторов платформы',
  },
];

export default function AdminDashboardPage() {
  const {
    data: stats,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: () => tenantsApi.getStats(),
    select: (res) => res.data as PlatformStats,
  });

  // Тот же ключ, что и бейдж в AdminLayout — кэш общий, лишнего запроса нет.
  const { data: pendingCount } = useQuery({
    queryKey: ['registration-requests', 'pending'],
    queryFn: () => adminApi.listRegistrationRequests('pending'),
    select: (res) => res.data.length,
    staleTime: 60_000,
  });

  return (
    <div>
      <AdminPageHeader title="Панель управления" subtitle="Платная выручка по подпискам и состояние платформы" />

      {/* Ожидающие заявки — самое срочное, поэтому первым */}
      {!!pendingCount && (
        <Link
          to="/admin/registration"
          className="mb-5 flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 transition-colors hover:bg-amber-100"
        >
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-amber-100">
              <Inbox className="h-[18px] w-[18px] text-amber-600" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-amber-800">
                {pendingCount} {pendingPhrase(pendingCount)}
              </p>
              <p className="text-xs text-amber-700">Открыть раздел «Заявки»</p>
            </div>
          </div>
          <ArrowRight className="h-5 w-5 flex-shrink-0 text-amber-500" />
        </Link>
      )}

      {/* KPI платформы — плотная сетка */}
      <QueryState
        isLoading={isLoading}
        isError={isError}
        onRetry={refetch}
        isFetching={isFetching}
        errorTitle="Не удалось загрузить статистику"
        minHeight="min-h-[200px]"
      >
        <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile icon={Building2} tone="blue" label="Всего клиентов" value={stats?.totalTenants ?? 0} />
          <StatTile icon={Activity} tone="green" label="Активных" value={stats?.activeTenants ?? 0} />
          <StatTile icon={CalendarClock} tone="red" label="Истёкших" value={stats?.expiredTenants ?? 0} />
          <StatTile icon={Users} tone="purple" label="Пользователей" value={stats?.totalUsers ?? 0} />
          <StatTile
            icon={BadgeRussianRuble}
            tone="emerald"
            label="MRR"
            value={formatRub(stats?.mrr)}
            sub="месячная выручка"
          />
          <StatTile icon={TrendingUp} tone="teal" label="ARPU" value={formatRub(stats?.arpu)} sub="на клиента" />
          <StatTile icon={UserPlus} tone="indigo" label="Новых за месяц" value={stats?.newTenantsThisMonth ?? 0} />
          <StatTile icon={Inbox} tone="amber" label="Заявки ждут" value={pendingCount ?? 0} sub="на регистрацию" />
        </div>
      </QueryState>

      {/* Платная выручка по подпискам */}
      <SubscriptionRevenuePanel />

      {/* Динамика MRR */}
      <div className="mb-8">
        <MrrTrendChart />
      </div>

      {/* Быстрые действия */}
      <h2 className="mb-3 text-lg font-semibold text-gray-900">Быстрые действия</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {QUICK_LINKS.map((link) => {
          const Icon = link.icon;
          return (
            <Link
              key={link.to}
              to={link.to}
              className="card flex items-center justify-between gap-3 p-4 transition-shadow hover:shadow-md"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${link.iconClass}`}>
                  <Icon className="h-[18px] w-[18px]" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900">{link.title}</p>
                  <p className="truncate text-xs text-gray-500">{link.subtitle}</p>
                </div>
              </div>
              <ArrowRight className="h-4 w-4 flex-shrink-0 text-gray-400" />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
