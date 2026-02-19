import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  DollarSign,
  Banknote,
  CreditCard,
  Shield,
  TrendingUp,
  Users,
} from 'lucide-react';
import { format, startOfWeek, startOfMonth } from 'date-fns';

import { salaryApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import DatePeriodPicker from '../components/DatePeriodPicker';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';
import { UserRole, MasterSalary, SalarySummary } from '../types';

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'UZS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function MasterSalaryView() {
  const { data: summary, isLoading } = useQuery({
    queryKey: ['salary-my'],
    queryFn: () => salaryApi.getMy(),
    select: (res) => res.data as SalarySummary,
  });

  if (isLoading) return <LoadingSpinner />;

  if (!summary) {
    return (
      <EmptyState
        icon={DollarSign}
        title="Нет данных о зарплате"
        description="Данные появятся после закрытия первого чека"
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Моя зарплата</h1>
        <p className="text-gray-500 mt-1">
          {summary.masterName} &middot; Ставка: {summary.salaryPercent}%
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="stat-card">
          <div className="stat-label">Сегодня</div>
          <div className="stat-value text-green-600">
            {formatCurrency(summary.today)}
          </div>
          {summary.todayChecks !== undefined && (
            <p className="text-xs text-gray-400 mt-1">
              {summary.todayChecks} чек(ов)
            </p>
          )}
        </div>
        <div className="stat-card">
          <div className="stat-label">Неделя</div>
          <div className="stat-value text-blue-600">
            {formatCurrency(summary.week)}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Месяц</div>
          <div className="stat-value text-purple-600">
            {formatCurrency(summary.month)}
          </div>
          {summary.monthChecks !== undefined && (
            <p className="text-xs text-gray-400 mt-1">
              {summary.monthChecks} чек(ов)
            </p>
          )}
        </div>
        <div className="stat-card">
          <div className="stat-label">Всего</div>
          <div className="stat-value text-gray-900">
            {formatCurrency(summary.total)}
          </div>
        </div>
      </div>

      {/* Today breakdown by payment method */}
      <div className="card">
        <div className="card-body">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Сегодня по способу оплаты
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="flex items-center gap-3 p-3 bg-green-50 rounded-lg">
              <div className="p-2 bg-green-100 rounded-lg">
                <Banknote className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-green-700">Наличные</p>
                <p className="text-lg font-semibold text-green-800">
                  {formatCurrency(summary.todayCash || 0)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg">
              <div className="p-2 bg-blue-100 rounded-lg">
                <CreditCard className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-blue-700">Карта</p>
                <p className="text-lg font-semibold text-blue-800">
                  {formatCurrency(summary.todayCard || 0)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 bg-orange-50 rounded-lg">
              <div className="p-2 bg-orange-100 rounded-lg">
                <Shield className="w-5 h-5 text-orange-600" />
              </div>
              <div>
                <p className="text-sm text-orange-700">Гарантия</p>
                <p className="text-lg font-semibold text-orange-800">
                  {formatCurrency(summary.todayWarranty || 0)}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AdminSalaryView() {
  const today = format(new Date(), 'yyyy-MM-dd');
  const monthStart = format(startOfMonth(new Date()), 'yyyy-MM-dd');

  const [dateFrom, setDateFrom] = useState(monthStart);
  const [dateTo, setDateTo] = useState(today);

  const { data: salaries, isLoading } = useQuery({
    queryKey: ['salary-all', dateFrom, dateTo],
    queryFn: () => salaryApi.getAll({ dateFrom, dateTo }),
    select: (res) => {
      const d = res.data;
      return Array.isArray(d) ? (d as MasterSalary[]) : ((d as any).data || []) as MasterSalary[];
    },
  });

  const masters = salaries || [];

  const totalRevenue = masters.reduce((s, m) => s + m.totalRevenue, 0);
  const totalEarnings = masters.reduce((s, m) => s + m.totalEarnings, 0);
  const totalChecks = masters.reduce((s, m) => s + m.checkCount, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <h1 className="text-2xl font-bold text-gray-900">Зарплаты мастеров</h1>

      {/* Date filter */}
      <DatePeriodPicker
        dateFrom={dateFrom}
        dateTo={dateTo}
        onChange={(from, to) => {
          setDateFrom(from);
          setDateTo(to);
        }}
      />

      {isLoading ? (
        <LoadingSpinner />
      ) : masters.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Нет данных"
          description="За выбранный период нет данных по зарплатам"
        />
      ) : (
        <>
          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {masters.map((master) => (
              <div key={master.masterId} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-gray-900 text-sm">{master.masterName}</span>
                  <span className="text-xs text-gray-400">{master.salaryPercent}%</span>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[10px] text-gray-400 uppercase">Выручка</p>
                    <p className="text-sm font-medium text-gray-900">{formatCurrency(master.totalRevenue)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] text-gray-400 uppercase">Заработок</p>
                    <p className="text-sm font-bold text-green-600">{formatCurrency(master.totalEarnings)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] text-gray-400 uppercase">Чеков</p>
                    <p className="text-sm font-medium text-gray-600">{master.checkCount}</p>
                  </div>
                </div>
              </div>
            ))}
            <div className="bg-gray-50 rounded-xl border border-gray-200 p-4">
              <div className="flex items-center justify-between">
                <span className="font-bold text-gray-900 text-sm">Итого</span>
                <div className="flex items-center gap-4 text-sm">
                  <span className="font-semibold text-gray-900">{formatCurrency(totalRevenue)}</span>
                  <span className="font-bold text-green-600">{formatCurrency(totalEarnings)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Desktop table */}
          <div className="hidden md:block table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Мастер</th>
                  <th className="text-right">% ставка</th>
                  <th className="text-right">Выручка</th>
                  <th className="text-right">Заработок</th>
                  <th className="text-right">Чеков</th>
                </tr>
              </thead>
              <tbody>
                {masters.map((master) => (
                  <tr key={master.masterId}>
                    <td className="font-medium text-gray-900">
                      {master.masterName}
                    </td>
                    <td className="text-right text-gray-600">
                      {master.salaryPercent}%
                    </td>
                    <td className="text-right text-gray-900">
                      {formatCurrency(master.totalRevenue)}
                    </td>
                    <td className="text-right font-medium text-green-600">
                      {formatCurrency(master.totalEarnings)}
                    </td>
                    <td className="text-right text-gray-600">
                      {master.checkCount}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-300">
                  <td className="font-semibold text-gray-900">Итого</td>
                  <td></td>
                  <td className="text-right font-semibold text-gray-900">
                    {formatCurrency(totalRevenue)}
                  </td>
                  <td className="text-right font-semibold text-green-600">
                    {formatCurrency(totalEarnings)}
                  </td>
                  <td className="text-right font-semibold text-gray-600">
                    {totalChecks}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export default function SalaryPage() {
  const { isRole } = useAuth();

  const isMaster = isRole(UserRole.MASTER);

  if (isMaster) {
    return <MasterSalaryView />;
  }

  return <AdminSalaryView />;
}
