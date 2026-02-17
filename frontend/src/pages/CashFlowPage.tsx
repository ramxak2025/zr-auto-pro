import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Wallet, Banknote, CreditCard, Shield } from 'lucide-react';
import { format, startOfMonth } from 'date-fns';
import { ru } from 'date-fns/locale';

import { reportsApi } from '../api/services';
import DatePeriodPicker from '../components/DatePeriodPicker';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';

interface CashFlowDay {
  date: string;
  cash: number;
  card: number;
  warranty: number;
  total: number;
}

interface CashFlowData {
  days: CashFlowDay[];
  totals: {
    cash: number;
    card: number;
    warranty: number;
    total: number;
  };
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'UZS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export default function CashFlowPage() {
  const today = format(new Date(), 'yyyy-MM-dd');
  const monthStart = format(startOfMonth(new Date()), 'yyyy-MM-dd');

  const [dateFrom, setDateFrom] = useState(monthStart);
  const [dateTo, setDateTo] = useState(today);

  const { data: cashFlow, isLoading } = useQuery({
    queryKey: ['cashflow', dateFrom, dateTo],
    queryFn: () => reportsApi.getCashFlow({ dateFrom, dateTo }),
    select: (res) => res.data as CashFlowData,
  });

  const days = cashFlow?.days || [];
  const totals = cashFlow?.totals || { cash: 0, card: 0, warranty: 0, total: 0 };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-primary-50 rounded-xl">
          <Wallet className="w-6 h-6 text-primary-600" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900">Движение денег</h1>
      </div>

      {/* Date picker */}
      <DatePeriodPicker
        dateFrom={dateFrom}
        dateTo={dateTo}
        onChange={(from, to) => {
          setDateFrom(from);
          setDateTo(to);
        }}
      />

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="stat-card">
          <div className="flex items-center gap-2 mb-1">
            <Banknote className="w-4 h-4 text-green-500" />
            <div className="stat-label">Наличные</div>
          </div>
          <div className="stat-value text-green-600">
            {formatCurrency(totals.cash)}
          </div>
        </div>
        <div className="stat-card">
          <div className="flex items-center gap-2 mb-1">
            <CreditCard className="w-4 h-4 text-blue-500" />
            <div className="stat-label">Карта</div>
          </div>
          <div className="stat-value text-blue-600">
            {formatCurrency(totals.card)}
          </div>
        </div>
        <div className="stat-card">
          <div className="flex items-center gap-2 mb-1">
            <Shield className="w-4 h-4 text-orange-500" />
            <div className="stat-label">Гарантия</div>
          </div>
          <div className="stat-value text-orange-600">
            {formatCurrency(totals.warranty)}
          </div>
        </div>
        <div className="stat-card">
          <div className="flex items-center gap-2 mb-1">
            <Wallet className="w-4 h-4 text-gray-700" />
            <div className="stat-label">Итого</div>
          </div>
          <div className="stat-value text-gray-900">
            {formatCurrency(totals.total)}
          </div>
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <LoadingSpinner />
      ) : days.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="Нет данных"
          description="За выбранный период нет движения денежных средств"
        />
      ) : (
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Дата</th>
                <th className="text-right">Наличные</th>
                <th className="text-right">Карта</th>
                <th className="text-right">Гарантия</th>
                <th className="text-right">Итого</th>
              </tr>
            </thead>
            <tbody>
              {days.map((day) => (
                <tr key={day.date}>
                  <td className="font-medium text-gray-900">
                    {format(new Date(day.date), 'dd MMM yyyy', { locale: ru })}
                  </td>
                  <td className="text-right text-green-600">
                    {day.cash > 0 ? formatCurrency(day.cash) : '\u2014'}
                  </td>
                  <td className="text-right text-blue-600">
                    {day.card > 0 ? formatCurrency(day.card) : '\u2014'}
                  </td>
                  <td className="text-right text-orange-600">
                    {day.warranty > 0 ? formatCurrency(day.warranty) : '\u2014'}
                  </td>
                  <td className="text-right font-semibold text-gray-900">
                    {formatCurrency(day.total)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-300 bg-gray-50">
                <td className="font-bold text-gray-900">Итого</td>
                <td className="text-right font-bold text-green-600">
                  {formatCurrency(totals.cash)}
                </td>
                <td className="text-right font-bold text-blue-600">
                  {formatCurrency(totals.card)}
                </td>
                <td className="text-right font-bold text-orange-600">
                  {formatCurrency(totals.warranty)}
                </td>
                <td className="text-right font-bold text-gray-900">
                  {formatCurrency(totals.total)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
