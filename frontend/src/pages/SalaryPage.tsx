import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  DollarSign,
  Calendar,
  CalendarDays,
  CalendarRange,
  TrendingUp,
  Info,
  ChevronDown,
  Wallet,
} from 'lucide-react';
import { salaryApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import type { MasterSalary, SalarySummary } from '../types';
import LoadingSpinner from '../components/LoadingSpinner';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatMoney(value: number): string {
  return value.toLocaleString('ru-RU') + ' \u20BD';
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function monthAgoISO(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Stat Card
// ---------------------------------------------------------------------------

interface StatCardProps {
  title: string;
  value: string;
  icon: React.ElementType;
  color: string;
}

function StatCard({ title, value, icon: Icon, color }: StatCardProps) {
  const colorMap: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-green-50 text-green-600',
    orange: 'bg-orange-50 text-orange-600',
    purple: 'bg-purple-50 text-purple-600',
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <div
          className={`flex h-10 w-10 items-center justify-center rounded-lg ${colorMap[color] || colorMap.blue}`}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm text-gray-500">{title}</p>
          <p className="text-lg font-bold text-gray-900">{value}</p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Master View
// ---------------------------------------------------------------------------

function MasterSalaryView() {
  const { data, isLoading, isError } = useQuery<SalarySummary>({
    queryKey: ['salary', 'my'],
    queryFn: async () => {
      const res = await salaryApi.getMySummary();
      return res.data;
    },
  });

  if (isLoading) return <LoadingSpinner />;

  if (isError) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
        <p className="text-sm">Не удалось загрузить данные о зарплате</p>
      </div>
    );
  }

  if (!data) return null;

  const cards = [
    { title: 'Сегодня', value: formatMoney(data.today), icon: DollarSign, color: 'blue' },
    { title: 'Неделя', value: formatMoney(data.week), icon: Calendar, color: 'green' },
    { title: 'Месяц', value: formatMoney(data.month), icon: CalendarDays, color: 'orange' },
    { title: 'Всего', value: formatMoney(data.total), icon: TrendingUp, color: 'purple' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Моя зарплата</h1>
        <p className="mt-1 text-sm text-gray-500">{data.masterName}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <StatCard key={c.title} {...c} />
        ))}
      </div>

      <div className="flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 p-4 text-blue-700">
        <Info className="h-5 w-5 flex-shrink-0" />
        <p className="text-sm">Ваш процент: {data.salaryPercent}%</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mobile accordion card for a master
// ---------------------------------------------------------------------------

function MasterAccordion({ master: m }: { master: MasterSalary }) {
  const [open, setOpen] = useState(false);
  const initials = m.masterName.split(' ').map((w) => w[0]).join('').slice(0, 2);

  return (
    <div className="rounded-xl bg-white border border-gray-100 shadow-sm overflow-hidden">
      <button type="button" onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-3 w-full px-4 py-3.5 text-left active:bg-gray-50 transition-colors">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 text-sm font-bold text-primary-600 flex-shrink-0">
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">{m.masterName}</p>
          <p className="text-[11px] text-gray-400">Ставка {m.salaryPercent}%</p>
        </div>
        <span className="text-sm font-bold text-green-600 flex-shrink-0 mr-1">{formatMoney(m.totalEarnings)}</span>
        <ChevronDown className={`h-4 w-4 text-gray-400 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="border-t border-gray-100 px-4 py-3 space-y-2.5 bg-gray-50/50">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">Чеков</span>
            <span className="text-sm font-medium text-gray-900">{m.checkCount}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">Выручка</span>
            <span className="text-sm font-medium text-gray-900">{formatMoney(m.totalRevenue)}</span>
          </div>
          <div className="flex items-center justify-between pt-1.5 border-t border-gray-100">
            <span className="text-xs font-semibold text-gray-700">Заработок</span>
            <span className="text-sm font-bold text-green-600">{formatMoney(m.totalEarnings)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Admin / Owner View
// ---------------------------------------------------------------------------

function AdminSalaryView() {
  const [dateFrom, setDateFrom] = useState(monthAgoISO());
  const [dateTo, setDateTo] = useState(todayISO());

  const { data, isLoading, isError } = useQuery<MasterSalary[]>({
    queryKey: ['salary', 'masters', { dateFrom, dateTo }],
    queryFn: async () => {
      const res = await salaryApi.getAllMasters({ dateFrom, dateTo });
      return res.data;
    },
  });

  const masters = data || [];
  const totalRevenue = masters.reduce((s, m) => s + m.totalRevenue, 0);
  const totalEarnings = masters.reduce((s, m) => s + m.totalEarnings, 0);
  const totalChecks = masters.reduce((s, m) => s + m.checkCount, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-bold text-gray-900">Зарплата мастеров</h1>
        <p className="text-xs text-gray-400 mt-0.5">
          Отчёт по зарплатам за выбранный период
        </p>
      </div>

      {/* Date filter */}
      <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-end sm:gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Дата от</label>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
            className="block w-full sm:w-auto rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 focus:outline-none" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Дата до</label>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
            className="block w-full sm:w-auto rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 focus:outline-none" />
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <LoadingSpinner />
      ) : isError ? (
        <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
          <p className="text-sm">Не удалось загрузить данные</p>
        </div>
      ) : masters.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-12 text-center">
          <CalendarRange className="mx-auto h-12 w-12 text-gray-300" />
          <p className="mt-4 text-sm text-gray-500">
            Нет данных за выбранный период
          </p>
        </div>
      ) : (
        <>
          {/* Mobile accordion cards */}
          <div className="md:hidden space-y-2">
            {/* Summary card */}
            <div className="rounded-xl bg-gradient-to-r from-primary-50 to-blue-50 border border-primary-100 p-4">
              <p className="text-[11px] font-semibold text-primary-600 uppercase tracking-wider mb-2">Итого</p>
              <div className="grid grid-cols-3 gap-3">
                <div className="text-center">
                  <p className="text-lg font-bold text-gray-900">{totalChecks}</p>
                  <p className="text-[10px] text-gray-500">Чеков</p>
                </div>
                <div className="text-center">
                  <p className="text-sm font-bold text-gray-900">{formatMoney(totalRevenue)}</p>
                  <p className="text-[10px] text-gray-500">Выручка</p>
                </div>
                <div className="text-center">
                  <p className="text-sm font-bold text-green-600">{formatMoney(totalEarnings)}</p>
                  <p className="text-[10px] text-gray-500">Заработок</p>
                </div>
              </div>
            </div>

            {/* Master accordion items */}
            {masters.map((m) => (
              <MasterAccordion key={m.masterId} master={m} />
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50/50">
                    <th className="px-4 py-3 font-semibold text-gray-600">Мастер</th>
                    <th className="px-4 py-3 font-semibold text-gray-600 text-right">% от услуг</th>
                    <th className="px-4 py-3 font-semibold text-gray-600 text-right">Кол-во чеков</th>
                    <th className="px-4 py-3 font-semibold text-gray-600 text-right">Выручка</th>
                    <th className="px-4 py-3 font-semibold text-gray-600 text-right">Заработок</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {masters.map((m) => (
                    <tr key={m.masterId} className="transition-colors hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{m.masterName}</td>
                      <td className="px-4 py-3 text-gray-600 text-right">{m.salaryPercent}%</td>
                      <td className="px-4 py-3 text-gray-600 text-right">{m.checkCount}</td>
                      <td className="px-4 py-3 text-gray-600 text-right">{formatMoney(m.totalRevenue)}</td>
                      <td className="px-4 py-3 font-medium text-gray-900 text-right">{formatMoney(m.totalEarnings)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-200 bg-gray-50/80 font-semibold">
                    <td className="px-4 py-3 text-gray-900">Итого</td>
                    <td className="px-4 py-3 text-right text-gray-600">&mdash;</td>
                    <td className="px-4 py-3 text-right text-gray-900">{totalChecks}</td>
                    <td className="px-4 py-3 text-right text-gray-900">{formatMoney(totalRevenue)}</td>
                    <td className="px-4 py-3 text-right text-gray-900">{formatMoney(totalEarnings)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function SalaryPage() {
  const { user, hasPermission } = useAuth();

  if (!user) return <LoadingSpinner />;

  // Owner / Admin see all masters
  if (hasPermission('profit_view')) {
    return <AdminSalaryView />;
  }

  // Masters see their own salary
  if (user.role === 'master') {
    return <MasterSalaryView />;
  }

  // Others - no access
  return (
    <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
      <p className="text-sm">У вас нет доступа к этой странице</p>
    </div>
  );
}
