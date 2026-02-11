import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Building2,
  Users,
  Activity,
  Plus,
  ArrowRight,
  AlertCircle,
} from 'lucide-react';
import { adminApi } from '../../api/services';
import type { PlatformStats, Tenant } from '../../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function StatCardSkeleton() {
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm animate-pulse">
      <div className="flex items-center gap-3 mb-3">
        <div className="h-10 w-10 rounded-lg bg-gray-200" />
        <div className="h-4 w-24 rounded bg-gray-200" />
      </div>
      <div className="h-7 w-20 rounded bg-gray-200" />
    </div>
  );
}

function TableRowSkeleton() {
  return (
    <tr className="animate-pulse">
      <td className="px-4 py-3"><div className="h-4 w-32 rounded bg-gray-200" /></td>
      <td className="px-4 py-3"><div className="h-4 w-40 rounded bg-gray-200" /></td>
      <td className="px-4 py-3"><div className="h-5 w-16 rounded-full bg-gray-200" /></td>
      <td className="px-4 py-3"><div className="h-4 w-20 rounded bg-gray-200" /></td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  color: string;
  iconColor: string;
}

function StatCard({ icon, label, value, color, iconColor }: StatCardProps) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-center gap-3 mb-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${color}`}>
          <span className={iconColor}>{icon}</span>
        </div>
        <span className="text-sm text-gray-500">{label}</span>
      </div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Error banner
// ---------------------------------------------------------------------------

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
      <AlertCircle className="h-5 w-5 flex-shrink-0" />
      <p className="text-sm">{message}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function AdminDashboardPage() {
  // Stats query
  const {
    data: stats,
    isLoading: statsLoading,
    isError: statsError,
  } = useQuery<PlatformStats>({
    queryKey: ['admin', 'stats'],
    queryFn: async () => {
      const res = await adminApi.getStats();
      return res.data;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  // Recent tenants query
  const {
    data: recentTenants,
    isLoading: tenantsLoading,
    isError: tenantsError,
  } = useQuery<Tenant[]>({
    queryKey: ['admin', 'tenants', 'recent'],
    queryFn: async () => {
      const res = await adminApi.getTenants({ limit: 5, page: 1 });
      return res.data.data;
    },
    staleTime: 30_000,
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Панель управления платформой
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Обзор всех автосервисов и пользователей
          </p>
        </div>
        <Link
          to="/tenants"
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700"
        >
          <Plus className="h-4 w-4" />
          Добавить автосервис
        </Link>
      </div>

      {/* Stats */}
      {statsError ? (
        <ErrorBanner message="Не удалось загрузить статистику" />
      ) : statsLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <StatCardSkeleton key={i} />
          ))}
        </div>
      ) : stats ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard
            icon={<Building2 className="h-5 w-5" />}
            label="Всего автосервисов"
            value={stats.totalTenants}
            color="bg-indigo-100"
            iconColor="text-indigo-600"
          />
          <StatCard
            icon={<Activity className="h-5 w-5" />}
            label="Активные"
            value={stats.activeTenants}
            color="bg-green-100"
            iconColor="text-green-600"
          />
          <StatCard
            icon={<Users className="h-5 w-5" />}
            label="Всего пользователей"
            value={stats.totalUsers}
            color="bg-purple-100"
            iconColor="text-purple-600"
          />
        </div>
      ) : null}

      {/* Recent tenants */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">
            Последние автосервисы
          </h2>
          <Link
            to="/tenants"
            className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-700 transition-colors"
          >
            Все автосервисы
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          {tenantsError ? (
            <div className="p-6">
              <ErrorBanner message="Не удалось загрузить список автосервисов" />
            </div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="px-4 py-3 font-medium text-gray-500">Название</th>
                  <th className="px-4 py-3 font-medium text-gray-500">Email</th>
                  <th className="px-4 py-3 font-medium text-gray-500">Статус</th>
                  <th className="px-4 py-3 font-medium text-gray-500">Дата создания</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {tenantsLoading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <TableRowSkeleton key={i} />
                  ))
                ) : recentTenants && recentTenants.length > 0 ? (
                  recentTenants.map((tenant) => (
                    <tr
                      key={tenant.id}
                      className="hover:bg-gray-50 transition-colors cursor-pointer"
                      onClick={() => {
                        window.location.href = `/tenants/${tenant.id}`;
                      }}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                            <Building2 className="h-4 w-4" />
                          </div>
                          <span className="font-medium text-gray-900">
                            {tenant.name}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {tenant.email || '--'}
                      </td>
                      <td className="px-4 py-3">
                        {tenant.isActive ? (
                          <span className="inline-flex items-center rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700">
                            Активен
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-700">
                            Неактивен
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-500">
                        {formatDate(tenant.createdAt)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="px-4 py-12 text-center">
                      <div className="flex flex-col items-center">
                        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
                          <Building2 className="h-6 w-6 text-gray-400" />
                        </div>
                        <p className="mt-3 text-sm font-medium text-gray-900">
                          Нет автосервисов
                        </p>
                        <p className="mt-1 text-sm text-gray-500">
                          Добавьте первый автосервис для начала работы
                        </p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
