import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Activity,
  ArrowRight,
  BadgeRussianRuble,
  Building2,
  CalendarClock,
  CreditCard,
  Inbox,
  LayoutDashboard,
  Megaphone,
  ScrollText,
  TrendingUp,
  UserPlus,
  Users,
} from 'lucide-react';

import { tenantsApi, adminApi } from '../../api/services';
import { PlatformStats } from '../../types';
import { formatMoney } from '../../../../shared/utils/formatters';
import PageHeader from '../../components/PageHeader';
import MrrTrendChart from '../../components/MrrTrendChart';
import SubscriptionRevenuePanel from '../../components/SubscriptionRevenuePanel';
import { StatCard } from '../../ui/StatCard';
import { SkeletonCard } from '../../ui/Skeleton';
import { cn } from '../../ui/cn';
import { focusRing } from '../../ui/tokens';
import { ErrorRow, LinkTile } from '../../components/admin/adminUi';
import { pluralRu } from '../../components/knowledge/utils';

// «1 заявка ждёт / 2 заявки ждут / 5 заявок ждут»
function pendingPhrase(n: number): string {
  return pluralRu(
    n,
    'заявка на подключение ждёт решения',
    'заявки на подключение ждут решения',
    'заявок на подключение ждут решения',
  );
}

const QUICK_LINKS = [
  {
    to: '/admin/tenants',
    icon: Building2,
    title: 'Автосервисы',
    subtitle: 'Просмотр, создание и редактирование клиентов платформы',
  },
  {
    to: '/admin/plans',
    icon: CreditCard,
    title: 'Тарифы',
    subtitle: 'Тарифные планы, функции и цены',
  },
  {
    to: '/admin/broadcast',
    icon: Megaphone,
    title: 'Рассылка',
    subtitle: 'Объявление владельцам со ссылкой и кнопками',
  },
  {
    to: '/admin/audit-log',
    icon: ScrollText,
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
    <div className="space-y-5">
      <PageHeader
        title="Главная"
        icon={LayoutDashboard}
        subtitle="Состояние платформы и платная выручка по подпискам"
      />

      {/* Ожидающие заявки — самое срочное, поэтому первым */}
      {!!pendingCount && (
        <Link
          to="/admin/registration"
          className={cn(
            'flex items-center gap-3 rounded-xl border border-warn/30 bg-warn-soft px-4 py-3 transition-colors hover:border-warn/50',
            focusRing,
          )}
        >
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-warn/15 text-warn">
            <Inbox className="h-[18px] w-[18px]" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-warn-text">
              <span className="tabular-nums">{pendingCount}</span> {pendingPhrase(pendingCount)}
            </span>
            <span className="block text-xs text-warn-text/80">Открыть раздел «Заявки»</span>
          </span>
          <ArrowRight className="h-4 w-4 flex-shrink-0 text-warn" aria-hidden="true" />
        </Link>
      )}

      {/* KPI платформы — нейтральные плитки; тон только там, где есть смысл */}
      <section aria-label="Показатели платформы">
        {isLoading ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-busy="true">
            {Array.from({ length: 8 }).map((_, i) => (
              <SkeletonCard key={i} lines={1} className="p-4" />
            ))}
          </div>
        ) : isError ? (
          <ErrorRow
            message="Не удалось загрузить статистику платформы"
            onRetry={() => refetch()}
            loading={isFetching}
          />
        ) : (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              compact
              label="Всего автосервисов"
              value={stats?.totalTenants ?? 0}
              icon={Building2}
              to="/admin/tenants"
            />
            <StatCard
              compact
              label="Активных"
              value={stats?.activeTenants ?? 0}
              icon={Activity}
              to="/admin/tenants?status=active"
            />
            <StatCard
              compact
              label="Истёкших подписок"
              value={stats?.expiredTenants ?? 0}
              icon={CalendarClock}
              tone={(stats?.expiredTenants ?? 0) > 0 ? 'warn' : 'neutral'}
              to="/admin/tenants?status=expired"
            />
            <StatCard compact label="Пользователей" value={stats?.totalUsers ?? 0} icon={Users} />
            <StatCard
              compact
              label="MRR"
              value={formatMoney(stats?.mrr ?? 0)}
              hint="месячная выручка по ценникам тарифов"
              icon={BadgeRussianRuble}
            />
            <StatCard
              compact
              label="ARPU"
              value={formatMoney(stats?.arpu ?? 0)}
              hint="на активный автосервис"
              icon={TrendingUp}
            />
            <StatCard compact label="Новых за месяц" value={stats?.newTenantsThisMonth ?? 0} icon={UserPlus} />
            <StatCard
              compact
              label="Заявки ждут"
              value={pendingCount ?? 0}
              hint="на подключение"
              icon={Inbox}
              tone={(pendingCount ?? 0) > 0 ? 'warn' : 'neutral'}
              to="/admin/registration"
            />
          </div>
        )}
      </section>

      <SubscriptionRevenuePanel />

      <MrrTrendChart />

      {/* Разделы */}
      <section aria-labelledby="admin-sections">
        <h2 id="admin-sections" className="mb-3 text-md font-semibold text-ink">
          Разделы
        </h2>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {QUICK_LINKS.map((link) => {
            const Icon = link.icon;
            return (
              <li key={link.to}>
                <LinkTile to={link.to} className="flex items-center gap-3 p-4">
                  <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                    <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink group-hover:text-accent-text">
                      {link.title}
                    </span>
                    <span className="block truncate text-xs text-ink-3">{link.subtitle}</span>
                  </span>
                  <ArrowRight
                    className="h-4 w-4 flex-shrink-0 text-ink-4 transition-transform duration-150 group-hover:translate-x-0.5"
                    aria-hidden="true"
                  />
                </LinkTile>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
