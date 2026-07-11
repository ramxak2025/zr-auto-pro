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
} from 'lucide-react';

import { tenantsApi } from '../../api/services';
import { PlatformStats } from '../../types';
import QueryState from '../../components/QueryState';
import MrrTrendChart from '../../components/MrrTrendChart';
import SubscriptionRevenuePanel from '../../components/SubscriptionRevenuePanel';

function formatRub(value: number | undefined): string {
  return `${(value ?? 0).toLocaleString('ru-RU')} ₽`;
}

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

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Панель управления</h1>
          <p className="mt-1 text-sm text-gray-500">Платная выручка по подпискам и состояние платформы</p>
        </div>
      </div>

      {/* Paid subscription revenue — front and center */}
      <SubscriptionRevenuePanel />

      {/* Platform overview */}
      <div className="mb-3 flex items-center gap-2.5">
        <div className="rounded-lg bg-blue-50 p-2">
          <Building2 className="h-4 w-4 text-blue-600" />
        </div>
        <h2 className="text-lg font-semibold text-gray-900">Обзор платформы</h2>
      </div>

      {/* Stats */}
      <QueryState
        isLoading={isLoading}
        isError={isError}
        onRetry={refetch}
        isFetching={isFetching}
        errorTitle="Не удалось загрузить статистику"
        minHeight="min-h-[200px]"
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <div className="stat-card">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-blue-50 rounded-xl">
                <Building2 className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="stat-label">Всего клиентов</p>
                <p className="stat-value tabular-nums">{stats?.totalTenants ?? 0}</p>
              </div>
            </div>
          </div>

          <div className="stat-card">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-green-50 rounded-xl">
                <Activity className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="stat-label">Активных</p>
                <p className="stat-value tabular-nums">{stats?.activeTenants ?? 0}</p>
              </div>
            </div>
          </div>

          <div className="stat-card">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-red-50 rounded-xl">
                <CalendarClock className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <p className="stat-label">Истёкших</p>
                <p className="stat-value tabular-nums">{stats?.expiredTenants ?? 0}</p>
              </div>
            </div>
          </div>

          <div className="stat-card">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-emerald-50 rounded-xl">
                <BadgeRussianRuble className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <p className="stat-label">MRR (мес. выручка)</p>
                <p className="stat-value tabular-nums">{formatRub(stats?.mrr)}</p>
              </div>
            </div>
          </div>

          <div className="stat-card">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-teal-50 rounded-xl">
                <TrendingUp className="w-5 h-5 text-teal-600" />
              </div>
              <div>
                <p className="stat-label">ARPU (на клиента)</p>
                <p className="stat-value tabular-nums">{formatRub(stats?.arpu)}</p>
              </div>
            </div>
          </div>

          <div className="stat-card">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-indigo-50 rounded-xl">
                <UserPlus className="w-5 h-5 text-indigo-600" />
              </div>
              <div>
                <p className="stat-label">Новых в этом месяце</p>
                <p className="stat-value tabular-nums">{stats?.newTenantsThisMonth ?? 0}</p>
              </div>
            </div>
          </div>

          <div className="stat-card">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-purple-50 rounded-xl">
                <Users className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <p className="stat-label">Всего пользователей</p>
                <p className="stat-value tabular-nums">{stats?.totalUsers ?? 0}</p>
              </div>
            </div>
          </div>
        </div>
      </QueryState>

      {/* MRR trend — owner cabinet widget */}
      <div className="mb-8">
        <MrrTrendChart />
      </div>

      {/* Quick Links */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-900">Быстрые действия</h2>

        <Link
          to="/admin/tenants"
          className="card card-body flex items-center justify-between hover:shadow-md transition-shadow"
        >
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary-50 rounded-lg">
              <Building2 className="w-5 h-5 text-primary-600" />
            </div>
            <div>
              <p className="font-medium text-gray-900">Управление клиентами</p>
              <p className="text-sm text-gray-500">Просмотр, создание и редактирование автосервисов</p>
            </div>
          </div>
          <ArrowRight className="w-5 h-5 text-gray-400" />
        </Link>

        <Link
          to="/admin/plans"
          className="card card-body flex items-center justify-between hover:shadow-md transition-shadow"
        >
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-50 rounded-lg">
              <CreditCard className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="font-medium text-gray-900">Управление тарифами</p>
              <p className="text-sm text-gray-500">Настройка тарифных планов и цен</p>
            </div>
          </div>
          <ArrowRight className="w-5 h-5 text-gray-400" />
        </Link>

        <Link
          to="/admin/broadcast"
          className="card card-body flex items-center justify-between hover:shadow-md transition-shadow"
        >
          <div className="flex items-center gap-3">
            <div className="p-2 bg-violet-50 rounded-lg">
              <Megaphone className="w-5 h-5 text-violet-600" />
            </div>
            <div>
              <p className="font-medium text-gray-900">Рассылка владельцам</p>
              <p className="text-sm text-gray-500">Объявление со ссылкой и кнопками — всем директорам</p>
            </div>
          </div>
          <ArrowRight className="w-5 h-5 text-gray-400" />
        </Link>

        <Link
          to="/admin/audit-log"
          className="card card-body flex items-center justify-between hover:shadow-md transition-shadow"
        >
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-50 rounded-lg">
              <ScrollText className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <p className="font-medium text-gray-900">Журнал действий</p>
              <p className="text-sm text-gray-500">История операций администраторов платформы</p>
            </div>
          </div>
          <ArrowRight className="w-5 h-5 text-gray-400" />
        </Link>
      </div>
    </div>
  );
}
