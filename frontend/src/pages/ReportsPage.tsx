import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Package,
  Users,
  Receipt,
  BarChart3,
} from 'lucide-react';
import { reportsApi } from '../api/services';
import type { FinancialReport } from '../types';
import LoadingSpinner from '../components/LoadingSpinner';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatMoney(value: number): string {
  return value.toLocaleString('ru-RU') + ' \u20BD';
}

function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

type Period = 'today' | 'week' | 'month' | 'year' | 'custom';

function calcRange(period: Period): { from: string; to: string } {
  const now = new Date();
  const to = toISO(now);

  switch (period) {
    case 'today':
      return { from: toISO(startOfDay(now)), to };
    case 'week': {
      const d = new Date(now);
      d.setDate(d.getDate() - 7);
      return { from: toISO(d), to };
    }
    case 'month': {
      const d = new Date(now);
      d.setMonth(d.getMonth() - 1);
      return { from: toISO(d), to };
    }
    case 'year': {
      const d = new Date(now);
      d.setFullYear(d.getFullYear() - 1);
      return { from: toISO(d), to };
    }
    default:
      return { from: toISO(startOfDay(now)), to };
  }
}

// ---------------------------------------------------------------------------
// Stat Card
// ---------------------------------------------------------------------------

interface StatCardProps {
  title: string;
  value: string;
  icon: React.ElementType;
  bgColor: string;
  iconColor: string;
  valueColor?: string;
}

function StatCard({ title, value, icon: Icon, bgColor, iconColor, valueColor }: StatCardProps) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${bgColor}`}>
          <Icon className={`h-5 w-5 ${iconColor}`} />
        </div>
        <div className="min-w-0">
          <p className="text-sm text-gray-500">{title}</p>
          <p className={`text-lg font-bold truncate ${valueColor || 'text-gray-900'}`}>
            {value}
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab types
// ---------------------------------------------------------------------------

type TabKey = 'masters' | 'services' | 'products';

interface MasterRow {
  masterName: string;
  revenue: number;
  checkCount: number;
  salaryTotal: number;
}

interface ServiceRow {
  serviceName: string;
  count: number;
  revenue: number;
}

interface ProductRow {
  productName: string;
  count: number;
  revenue: number;
  cost: number;
  profit: number;
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

const PERIOD_BUTTONS: { key: Period; label: string }[] = [
  { key: 'today', label: 'Сегодня' },
  { key: 'week', label: 'Неделя' },
  { key: 'month', label: 'Месяц' },
  { key: 'year', label: 'Год' },
];

const TABS: { key: TabKey; label: string }[] = [
  { key: 'masters', label: 'По мастерам' },
  { key: 'services', label: 'По услугам' },
  { key: 'products', label: 'По товарам' },
];

export default function ReportsPage() {
  const [period, setPeriod] = useState<Period>('month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [activeTab, setActiveTab] = useState<TabKey>('masters');

  const { dateFrom, dateTo } = useMemo(() => {
    if (period === 'custom' && customFrom && customTo) {
      return { dateFrom: customFrom, dateTo: customTo };
    }
    const r = calcRange(period === 'custom' ? 'month' : period);
    return { dateFrom: r.from, dateTo: r.to };
  }, [period, customFrom, customTo]);

  // ---- Financial summary ----
  const {
    data: report,
    isLoading: reportLoading,
    isError: reportError,
  } = useQuery<FinancialReport>({
    queryKey: ['reports', 'financial', { dateFrom, dateTo }],
    queryFn: async () => {
      const res = await reportsApi.getFinancial({ dateFrom, dateTo });
      return res.data;
    },
  });

  // ---- By master ----
  const { data: mastersData, isLoading: mastersLoading } = useQuery<MasterRow[]>({
    queryKey: ['reports', 'masters', { dateFrom, dateTo }],
    queryFn: async () => {
      const res = await reportsApi.getByMaster({ dateFrom, dateTo });
      return res.data;
    },
    enabled: activeTab === 'masters',
  });

  // ---- By service ----
  const { data: servicesData, isLoading: servicesLoading } = useQuery<ServiceRow[]>({
    queryKey: ['reports', 'services', { dateFrom, dateTo }],
    queryFn: async () => {
      const res = await reportsApi.getByService({ dateFrom, dateTo });
      return res.data;
    },
    enabled: activeTab === 'services',
  });

  // ---- By product ----
  const { data: productsData, isLoading: productsLoading } = useQuery<ProductRow[]>({
    queryKey: ['reports', 'products', { dateFrom, dateTo }],
    queryFn: async () => {
      const res = await reportsApi.getByProduct({ dateFrom, dateTo });
      return res.data;
    },
    enabled: activeTab === 'products',
  });

  // ---- Period handlers ----
  function selectPeriod(p: Period) {
    setPeriod(p);
  }

  function handleCustomFrom(v: string) {
    setCustomFrom(v);
    setPeriod('custom');
  }

  function handleCustomTo(v: string) {
    setCustomTo(v);
    setPeriod('custom');
  }

  // ---- Stat cards data ----
  const stats = report
    ? [
        {
          title: 'Выручка',
          value: formatMoney(report.revenue),
          icon: DollarSign,
          bgColor: 'bg-blue-50',
          iconColor: 'text-blue-600',
        },
        {
          title: 'Себестоимость',
          value: formatMoney(report.productCost),
          icon: Package,
          bgColor: 'bg-gray-100',
          iconColor: 'text-gray-600',
        },
        {
          title: 'Зарплаты',
          value: formatMoney(report.salaries),
          icon: Users,
          bgColor: 'bg-orange-50',
          iconColor: 'text-orange-600',
        },
        {
          title: 'Валовая прибыль',
          value: formatMoney(report.grossProfit),
          icon: TrendingUp,
          bgColor: 'bg-teal-50',
          iconColor: 'text-teal-600',
        },
        {
          title: 'Чистая прибыль',
          value: formatMoney(report.netProfit),
          icon: report.netProfit >= 0 ? TrendingUp : TrendingDown,
          bgColor: report.netProfit >= 0 ? 'bg-green-50' : 'bg-red-50',
          iconColor: report.netProfit >= 0 ? 'text-green-600' : 'text-red-600',
          valueColor: report.netProfit >= 0 ? 'text-green-600' : 'text-red-600',
        },
        {
          title: 'Чеки',
          value: String(report.checkCount),
          icon: Receipt,
          bgColor: 'bg-blue-50',
          iconColor: 'text-blue-600',
        },
      ]
    : [];

  // ---- Tab content ----
  function renderTabContent() {
    if (activeTab === 'masters') {
      if (mastersLoading) return <LoadingSpinner />;
      const rows = mastersData || [];
      if (rows.length === 0) {
        return (
          <p className="py-8 text-center text-sm text-gray-500">Нет данных</p>
        );
      }
      return (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50/50">
                <th className="px-4 py-3 font-semibold text-gray-600">Мастер</th>
                <th className="px-4 py-3 font-semibold text-gray-600 text-right">Выручка</th>
                <th className="px-4 py-3 font-semibold text-gray-600 text-right">Чеков</th>
                <th className="px-4 py-3 font-semibold text-gray-600 text-right">Зарплата</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r, i) => (
                <tr key={i} className="transition-colors hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{r.masterName}</td>
                  <td className="px-4 py-3 text-gray-600 text-right">
                    {formatMoney(r.revenue)}
                  </td>
                  <td className="px-4 py-3 text-gray-600 text-right">{r.checkCount}</td>
                  <td className="px-4 py-3 font-medium text-gray-900 text-right">
                    {formatMoney(r.salaryTotal)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    if (activeTab === 'services') {
      if (servicesLoading) return <LoadingSpinner />;
      const rows = servicesData || [];
      if (rows.length === 0) {
        return (
          <p className="py-8 text-center text-sm text-gray-500">Нет данных</p>
        );
      }
      return (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50/50">
                <th className="px-4 py-3 font-semibold text-gray-600">Услуга</th>
                <th className="px-4 py-3 font-semibold text-gray-600 text-right">Кол-во</th>
                <th className="px-4 py-3 font-semibold text-gray-600 text-right">Выручка</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r, i) => (
                <tr key={i} className="transition-colors hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{r.serviceName}</td>
                  <td className="px-4 py-3 text-gray-600 text-right">{r.count}</td>
                  <td className="px-4 py-3 font-medium text-gray-900 text-right">
                    {formatMoney(r.revenue)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    if (activeTab === 'products') {
      if (productsLoading) return <LoadingSpinner />;
      const rows = productsData || [];
      if (rows.length === 0) {
        return (
          <p className="py-8 text-center text-sm text-gray-500">Нет данных</p>
        );
      }
      return (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50/50">
                <th className="px-4 py-3 font-semibold text-gray-600">Товар</th>
                <th className="px-4 py-3 font-semibold text-gray-600 text-right">Кол-во</th>
                <th className="px-4 py-3 font-semibold text-gray-600 text-right">Выручка</th>
                <th className="px-4 py-3 font-semibold text-gray-600 text-right">Себестоимость</th>
                <th className="px-4 py-3 font-semibold text-gray-600 text-right">Прибыль</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r, i) => (
                <tr key={i} className="transition-colors hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{r.productName}</td>
                  <td className="px-4 py-3 text-gray-600 text-right">{r.count}</td>
                  <td className="px-4 py-3 text-gray-600 text-right">
                    {formatMoney(r.revenue)}
                  </td>
                  <td className="px-4 py-3 text-gray-600 text-right">
                    {formatMoney(r.cost)}
                  </td>
                  <td
                    className={`px-4 py-3 font-medium text-right ${
                      r.profit >= 0 ? 'text-green-600' : 'text-red-600'
                    }`}
                  >
                    {formatMoney(r.profit)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    return null;
  }

  // ---- Render ----
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Финансовые отчёты</h1>
        <p className="mt-1 text-sm text-gray-500">
          Аналитика доходов и расходов за выбранный период
        </p>
      </div>

      {/* Period Selector */}
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex gap-2">
          {PERIOD_BUTTONS.map((p) => (
            <button
              key={p.key}
              onClick={() => selectPeriod(p.key)}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                period === p.key
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="flex items-end gap-2">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              От
            </label>
            <input
              type="date"
              value={period === 'custom' ? customFrom : dateFrom}
              onChange={(e) => handleCustomFrom(e.target.value)}
              className="block rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-900 shadow-sm transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              До
            </label>
            <input
              type="date"
              value={period === 'custom' ? customTo : dateTo}
              onChange={(e) => handleCustomTo(e.target.value)}
              className="block rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-900 shadow-sm transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
        </div>
      </div>

      {/* Stat Cards */}
      {reportLoading ? (
        <LoadingSpinner />
      ) : reportError ? (
        <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
          <p className="text-sm">Не удалось загрузить финансовый отчёт</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {stats.map((s) => (
              <StatCard key={s.title} {...s} />
            ))}
          </div>

          {/* Tabs */}
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
            {/* Tab headers */}
            <div className="flex border-b border-gray-200">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setActiveTab(t.key)}
                  className={`px-6 py-3 text-sm font-medium transition-colors ${
                    activeTab === t.key
                      ? 'border-b-2 border-blue-600 text-blue-600'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="p-0">{renderTabContent()}</div>
          </div>
        </>
      )}
    </div>
  );
}
