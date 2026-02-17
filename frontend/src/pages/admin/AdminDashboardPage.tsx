import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Building2, Users, ArrowRight, Activity } from 'lucide-react';

import { tenantsApi } from '../../api/services';
import { PlatformStats } from '../../types';
import LoadingSpinner from '../../components/LoadingSpinner';

export default function AdminDashboardPage() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: () => tenantsApi.getStats(),
    select: (res) => res.data as PlatformStats,
  });

  if (isLoading) return <LoadingSpinner />;

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <h1 className="page-title">Панель администратора</h1>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="stat-card">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-50 rounded-xl">
              <Building2 className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="stat-label">Всего организаций</p>
              <p className="stat-value">{stats?.totalTenants ?? 0}</p>
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
              <p className="stat-value">{stats?.activeTenants ?? 0}</p>
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
              <p className="stat-value">{stats?.totalUsers ?? 0}</p>
            </div>
          </div>
        </div>
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
              <p className="font-medium text-gray-900">Управление организациями</p>
              <p className="text-sm text-gray-500">
                Просмотр, создание и редактирование организаций
              </p>
            </div>
          </div>
          <ArrowRight className="w-5 h-5 text-gray-400" />
        </Link>
      </div>
    </div>
  );
}
