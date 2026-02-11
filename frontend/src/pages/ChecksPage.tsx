import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Plus,
  FileText,
  Loader2,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Car,
} from 'lucide-react';
import { checksApi, usersApi } from '../api/services';
import type { Check, User, PaymentMethod, PaginatedResponse } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatMoney(value: number): string {
  return value.toLocaleString('ru-RU') + ' \u20BD';
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('ru-RU');
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

const PAYMENT_BADGES: Record<
  string,
  { label: string; className: string }
> = {
  cash: {
    label: 'Наличные',
    className: 'bg-green-50 text-green-700 border-green-200',
  },
  card: {
    label: 'Карта',
    className: 'bg-blue-50 text-blue-700 border-blue-200',
  },
  transfer: {
    label: 'Перевод',
    className: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  },
  mixed: {
    label: 'Смешанная',
    className: 'bg-gray-50 text-gray-700 border-gray-200',
  },
};

function PaymentBadge({ method }: { method: PaymentMethod | string }) {
  const badge = PAYMENT_BADGES[method] ?? PAYMENT_BADGES.cash;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${badge.className}`}
    >
      {badge.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LIMIT = 20;

// ---------------------------------------------------------------------------
// Mobile card for a single check
// ---------------------------------------------------------------------------

function CheckCard({ check, onClick }: { check: Check; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left bg-white rounded-xl border border-gray-100 shadow-sm p-4 hover:shadow-md active:bg-gray-50 transition-all"
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-gray-900">#{check.number}</span>
          <PaymentBadge method={check.paymentMethod} />
        </div>
        <span className="text-base font-bold text-gray-900">
          {formatMoney(check.totalRevenue)}
        </span>
      </div>
      <div className="space-y-1">
        <p className="text-sm text-gray-700 font-medium">
          {check.client?.fullName ?? 'Клиент не указан'}
        </p>
        {check.car && (
          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            <Car className="h-3.5 w-3.5" />
            <span>{check.car.plateNumber} {check.car.makeModel}</span>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between mt-3 pt-2 border-t border-gray-50">
        <span className="text-xs text-gray-400">
          {formatDate(check.date)} {formatTime(check.createdAt)}
        </span>
        <span className="text-xs text-gray-500">
          {check.master?.fullName ?? ''}
        </span>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// ChecksPage
// ---------------------------------------------------------------------------

export default function ChecksPage() {
  const navigate = useNavigate();

  // Filters
  const [page, setPage] = useState(1);
  const [masterId, setMasterId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Fetch masters for filter dropdown
  const { data: masters } = useQuery<User[]>({
    queryKey: ['masters'],
    queryFn: async () => {
      const res = await usersApi.getMasters();
      return res.data;
    },
    staleTime: 5 * 60_000,
  });

  // Build query params
  const queryParams: Record<string, any> = {
    page,
    limit: LIMIT,
  };
  if (masterId) queryParams.masterId = masterId;
  if (dateFrom) queryParams.dateFrom = dateFrom;
  if (dateTo) queryParams.dateTo = dateTo;

  // Fetch checks
  const {
    data: checksData,
    isLoading,
    isError,
  } = useQuery<PaginatedResponse<Check>>({
    queryKey: ['checks', queryParams],
    queryFn: async () => {
      const res = await checksApi.getAll(queryParams);
      return res.data;
    },
    keepPreviousData: true,
  } as any);

  const checks = checksData?.data ?? [];
  const total = checksData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  // Reset to page 1 when filters change
  const handleFilterChange = (setter: (v: string) => void, value: string) => {
    setter(value);
    setPage(1);
  };

  const hasFilters = !!(dateFrom || dateTo || masterId);

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900">Журнал чеков</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Всего: {total}
          </p>
        </div>
        <Link
          to="/checks/new"
          className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-3 md:px-4 py-2 md:py-2.5 text-sm font-semibold text-white
            hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:ring-offset-2 transition-colors"
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Новый чек</span>
        </Link>
      </div>

      {/* Filters - collapsible on mobile */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        {/* Mobile filter toggle */}
        <button
          type="button"
          onClick={() => setFiltersOpen((v) => !v)}
          className="md:hidden flex items-center justify-between w-full px-4 py-3 text-sm font-medium text-gray-700"
        >
          <span>Фильтры{hasFilters ? ' (активны)' : ''}</span>
          <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${filtersOpen ? 'rotate-180' : ''}`} />
        </button>

        <div className={`${filtersOpen ? 'block' : 'hidden'} md:block`}>
          <div className="flex flex-col md:flex-row md:flex-wrap md:items-end gap-3 md:gap-4 p-4 pt-0 md:pt-4">
            {/* Date From */}
            <div className="flex-1 min-w-0 md:flex-initial">
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Дата с
              </label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => handleFilterChange(setDateFrom, e.target.value)}
                className="block w-full md:w-auto rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900
                  focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 focus:outline-none transition-colors"
              />
            </div>

            {/* Date To */}
            <div className="flex-1 min-w-0 md:flex-initial">
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Дата по
              </label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => handleFilterChange(setDateTo, e.target.value)}
                className="block w-full md:w-auto rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900
                  focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 focus:outline-none transition-colors"
              />
            </div>

            {/* Master */}
            <div className="flex-1 min-w-0 md:flex-initial">
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Мастер
              </label>
              <select
                value={masterId}
                onChange={(e) => handleFilterChange(setMasterId, e.target.value)}
                className="block w-full md:w-auto rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 md:min-w-[180px]
                  focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 focus:outline-none transition-colors"
              >
                <option value="">Все мастера</option>
                {masters?.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.fullName}
                  </option>
                ))}
              </select>
            </div>

            {/* Reset */}
            {hasFilters && (
              <button
                type="button"
                onClick={() => {
                  setDateFrom('');
                  setDateTo('');
                  setMasterId('');
                  setPage(1);
                }}
                className="text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors md:pb-2"
              >
                Сбросить
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
        </div>
      ) : isError ? (
        <div className="flex items-center justify-center gap-3 py-20 text-red-600">
          <AlertCircle className="h-5 w-5" />
          <span className="text-sm">Ошибка загрузки данных</span>
        </div>
      ) : checks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <FileText className="h-12 w-12 mb-3" />
          <p className="text-sm">Чеки не найдены</p>
        </div>
      ) : (
        <>
          {/* ─── Mobile card list ─── */}
          <div className="md:hidden space-y-3">
            {checks.map((check) => (
              <CheckCard
                key={check.id}
                check={check}
                onClick={() => navigate(`/checks/${check.id}`)}
              />
            ))}
          </div>

          {/* ─── Desktop table ─── */}
          <div className="hidden md:block overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50/50">
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">
                      Номер
                    </th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">
                      Дата
                    </th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">
                      Клиент
                    </th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">
                      Автомобиль
                    </th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">
                      Мастер
                    </th>
                    <th className="px-4 py-3 text-right font-semibold text-gray-600">
                      Сумма
                    </th>
                    <th className="px-4 py-3 text-center font-semibold text-gray-600">
                      Оплата
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {checks.map((check) => (
                    <tr
                      key={check.id}
                      onClick={() => navigate(`/checks/${check.id}`)}
                      className="cursor-pointer hover:bg-gray-50 transition-colors"
                    >
                      <td className="px-4 py-3 font-medium text-gray-900">
                        #{check.number}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {formatDate(check.date)}
                      </td>
                      <td className="px-4 py-3 text-gray-900">
                        {check.client?.fullName ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {check.car
                          ? `${check.car.plateNumber} ${check.car.makeModel}`
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {check.master?.fullName ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-gray-900">
                        {formatMoney(check.totalRevenue)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <PaymentBadge method={check.paymentMethod} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between bg-white rounded-xl border border-gray-200 shadow-sm px-4 py-3">
          <p className="text-sm text-gray-500">
            {page} / {totalPages}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="inline-flex items-center justify-center rounded-lg border border-gray-300 p-2 text-gray-600
                hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            {/* Page number buttons (show up to 5 around current) — desktop only */}
            <div className="hidden sm:flex items-center gap-1">
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(
                  (p) =>
                    p === 1 ||
                    p === totalPages ||
                    (p >= page - 2 && p <= page + 2),
                )
                .reduce<(number | 'ellipsis')[]>((acc, p, idx, arr) => {
                  if (idx > 0 && p - (arr[idx - 1] as number) > 1) {
                    acc.push('ellipsis');
                  }
                  acc.push(p);
                  return acc;
                }, [])
                .map((item, idx) =>
                  item === 'ellipsis' ? (
                    <span key={`e-${idx}`} className="px-1 text-gray-400">
                      ...
                    </span>
                  ) : (
                    <button
                      key={item}
                      type="button"
                      onClick={() => setPage(item as number)}
                      className={`inline-flex h-8 w-8 items-center justify-center rounded-lg text-sm font-medium transition-colors ${
                        page === item
                          ? 'bg-primary-600 text-white'
                          : 'border border-gray-300 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {item}
                    </button>
                  ),
                )}
            </div>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="inline-flex items-center justify-center rounded-lg border border-gray-300 p-2 text-gray-600
                hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
