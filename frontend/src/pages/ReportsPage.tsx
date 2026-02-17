import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  ShoppingCart,
  Users,
  Receipt,
  Lock,
} from 'lucide-react';
import { format, startOfMonth } from 'date-fns';

import { reportsApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import DatePeriodPicker from '../components/DatePeriodPicker';
import LoadingSpinner from '../components/LoadingSpinner';
import { FinancialReport } from '../types';

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'UZS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export default function ReportsPage() {
  const { hasPermission } = useAuth();

  const today = format(new Date(), 'yyyy-MM-dd');
  const monthStart = format(startOfMonth(new Date()), 'yyyy-MM-dd');

  const [dateFrom, setDateFrom] = useState(monthStart);
  const [dateTo, setDateTo] = useState(today);

  const canView = hasPermission('financial_reports');

  const { data: report, isLoading } = useQuery({
    queryKey: ['financial-report', dateFrom, dateTo],
    queryFn: () => reportsApi.getFinancial({ dateFrom, dateTo }),
    select: (res) => res.data as FinancialReport,
    enabled: canView,
  });

  if (!canView) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="mb-4 p-4 bg-gray-100 rounded-full">
          <Lock className="w-10 h-10 text-gray-400" />
        </div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2">
          Доступ ограничен
        </h2>
        <p className="text-gray-500 max-w-sm">
          У вас нет прав для просмотра финансовых отчетов. Обратитесь к
          администратору.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <h1 className="text-2xl font-bold text-gray-900">Финансовые отчеты</h1>

      {/* Date picker */}
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
      ) : !report ? (
        <div className="text-center py-12 text-gray-500">
          Не удалось загрузить данные
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Revenue */}
          <div className="stat-card border-l-4 border-blue-500">
            <div className="flex items-center justify-between">
              <div>
                <div className="stat-label">Выручка</div>
                <div className="stat-value text-blue-600">
                  {formatCurrency(report.revenue)}
                </div>
              </div>
              <div className="p-3 bg-blue-50 rounded-xl">
                <TrendingUp className="w-6 h-6 text-blue-500" />
              </div>
            </div>
          </div>

          {/* Product cost */}
          <div className="stat-card border-l-4 border-red-500">
            <div className="flex items-center justify-between">
              <div>
                <div className="stat-label">Себестоимость товаров</div>
                <div className="stat-value text-red-600">
                  {formatCurrency(report.productCost)}
                </div>
              </div>
              <div className="p-3 bg-red-50 rounded-xl">
                <ShoppingCart className="w-6 h-6 text-red-500" />
              </div>
            </div>
          </div>

          {/* Salaries */}
          <div className="stat-card border-l-4 border-red-400">
            <div className="flex items-center justify-between">
              <div>
                <div className="stat-label">Зарплаты</div>
                <div className="stat-value text-red-500">
                  {formatCurrency(report.salaries)}
                </div>
              </div>
              <div className="p-3 bg-red-50 rounded-xl">
                <Users className="w-6 h-6 text-red-400" />
              </div>
            </div>
          </div>

          {/* Gross profit */}
          <div className="stat-card border-l-4 border-green-500">
            <div className="flex items-center justify-between">
              <div>
                <div className="stat-label">Валовая прибыль</div>
                <div className="stat-value text-green-600">
                  {formatCurrency(report.grossProfit)}
                </div>
              </div>
              <div className="p-3 bg-green-50 rounded-xl">
                <TrendingUp className="w-6 h-6 text-green-500" />
              </div>
            </div>
          </div>

          {/* Net profit */}
          <div className="stat-card border-l-4 border-green-600">
            <div className="flex items-center justify-between">
              <div>
                <div className="stat-label">Чистая прибыль</div>
                <div
                  className={`stat-value ${
                    report.netProfit >= 0 ? 'text-green-600' : 'text-red-600'
                  }`}
                >
                  {formatCurrency(report.netProfit)}
                </div>
              </div>
              <div
                className={`p-3 rounded-xl ${
                  report.netProfit >= 0 ? 'bg-green-50' : 'bg-red-50'
                }`}
              >
                {report.netProfit >= 0 ? (
                  <DollarSign className="w-6 h-6 text-green-600" />
                ) : (
                  <TrendingDown className="w-6 h-6 text-red-600" />
                )}
              </div>
            </div>
          </div>

          {/* Check count */}
          <div className="stat-card border-l-4 border-blue-400">
            <div className="flex items-center justify-between">
              <div>
                <div className="stat-label">Количество чеков</div>
                <div className="stat-value text-blue-500">
                  {report.checkCount}
                </div>
              </div>
              <div className="p-3 bg-blue-50 rounded-xl">
                <Receipt className="w-6 h-6 text-blue-400" />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
