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
  Car,
  MessageSquare,
  Tag,
  TrendingUp,
  Search,
  Clock,
  Pause,
} from 'lucide-react';
import { checksApi, usersApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import type { Check, User, PaymentMethod, PaginatedResponse } from '../types';
import { UserRole } from '../types';
import DatePeriodPicker from '../components/DatePeriodPicker';

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
  warranty: {
    label: 'Гарантия',
    className: 'bg-orange-50 text-orange-700 border-orange-200',
  },
  cash_card: {
    label: 'Нал + Карта',
    className: 'bg-purple-50 text-purple-700 border-purple-200',
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

function truncateComment(text: string, maxLen = 60): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).trimEnd() + '…';
}

function CheckCard({ check, onClick, showProfit }: { check: Check; onClick: () => void; showProfit: boolean }) {
  const hasDiscount = check.discount && check.discount > 0;
  const hasComment = check.comment && check.comment.trim().length > 0;
  const isDeferred = (check as any).isDeferred;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left rounded-xl border shadow-sm p-4 hover:shadow-md active:bg-gray-50 transition-all ${
        isDeferred
          ? 'bg-amber-50/60 border-amber-200'
          : 'bg-white border-gray-100'
      }`}
    >
      {/* Top row: number + badges | amount + profit */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-bold text-gray-900">#{check.number}</span>
          <PaymentBadge method={check.paymentMethod} />
          {isDeferred && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 border border-amber-300 px-2 py-0.5 text-xs font-medium text-amber-700">
              <Pause className="h-3 w-3" />
              Отложен
            </span>
          )}
          {hasDiscount && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-rose-50 border border-rose-200 px-2 py-0.5 text-xs font-medium text-rose-600">
              <Tag className="h-3 w-3" />
              −{formatMoney(check.discount!)}
            </span>
          )}
        </div>
        <div className="text-right flex-shrink-0 ml-2">
          <span className="text-base font-bold text-gray-900">
            {formatMoney(check.totalRevenue)}
          </span>
          {showProfit && (
            <div className="flex items-center justify-end gap-0.5">
              <TrendingUp className={`h-3 w-3 ${check.profit >= 0 ? 'text-green-500' : 'text-red-400'}`} />
              <span className={`text-xs font-semibold ${check.profit >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                {check.profit >= 0 ? '+' : ''}{formatMoney(check.profit)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Client + car info */}
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

      {/* Comment */}
      {hasComment && (
        <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-gray-50 px-2.5 py-1.5">
          <MessageSquare className="h-3.5 w-3.5 text-gray-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-gray-500 leading-relaxed">
            {truncateComment(check.comment!)}
          </p>
        </div>
      )}

      {/* Footer: date + master */}
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
  const { user, hasPermission } = useAuth();
  const canSeeProfit = hasPermission('profit_view');

  // Filters
  const [page, setPage] = useState(1);
  const [searchNumber, setSearchNumber] = useState('');
  const [masterId, setMasterId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

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
  if (searchNumber) queryParams.search = searchNumber;
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

  const handleDatePeriodChange = (from: string, to: string) => {
    setDateFrom(from);
    setDateTo(to);
    setPage(1);
  };

  const hasFilters = !!(dateFrom || dateTo || masterId || searchNumber);

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

      {/* Compact filters row */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Search */}
        <div className="relative flex-1 min-w-[140px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchNumber}
            onChange={(e) => handleFilterChange(setSearchNumber, e.target.value)}
            placeholder="Поиск по номеру..."
            className="block w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-all focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-500/10"
          />
        </div>

        {/* Date period picker */}
        <DatePeriodPicker
          dateFrom={dateFrom}
          dateTo={dateTo}
          onChange={handleDatePeriodChange}
        />

        {/* Master filter */}
        <select
          value={masterId}
          onChange={(e) => handleFilterChange(setMasterId, e.target.value)}
          className="rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-xs font-medium text-gray-600 min-w-0 max-w-[140px] focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-500/10 transition-colors"
        >
          <option value="">Все мастера</option>
          {masters?.map((m) => (
            <option key={m.id} value={m.id}>
              {m.fullName}
            </option>
          ))}
        </select>

        {/* Reset */}
        {hasFilters && (
          <button
            type="button"
            onClick={() => {
              setSearchNumber('');
              setDateFrom('');
              setDateTo('');
              setMasterId('');
              setPage(1);
            }}
            className="text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors"
          >
            Сбросить
          </button>
        )}
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
                showProfit={canSeeProfit}
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
                      Клиент / Авто
                    </th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">
                      Мастер
                    </th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600 max-w-[200px]">
                      Комментарий
                    </th>
                    <th className="px-4 py-3 text-right font-semibold text-gray-600">
                      Сумма
                    </th>
                    <th className="px-4 py-3 text-right font-semibold text-gray-600">
                      Скидка
                    </th>
                    {canSeeProfit && (
                      <th className="px-4 py-3 text-right font-semibold text-gray-600">
                        Прибыль
                      </th>
                    )}
                    <th className="px-4 py-3 text-center font-semibold text-gray-600">
                      Оплата
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {checks.map((check) => {
                    const hasDiscount = check.discount && check.discount > 0;
                    const hasComment = check.comment && check.comment.trim().length > 0;
                    const isDeferred = (check as any).isDeferred;

                    return (
                      <tr
                        key={check.id}
                        onClick={() => navigate(`/checks/${check.id}`)}
                        className={`cursor-pointer transition-colors group ${
                          isDeferred ? 'bg-amber-50/50 hover:bg-amber-50' : 'hover:bg-gray-50'
                        }`}
                      >
                        <td className="px-4 py-3 font-medium text-gray-900">
                          <div className="flex items-center gap-1.5">
                            #{check.number}
                            {isDeferred && <Pause className="h-3.5 w-3.5 text-amber-500" />}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                          {formatDate(check.date)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-gray-900 font-medium">{check.client?.fullName ?? '—'}</div>
                          {check.car && (
                            <div className="flex items-center gap-1 text-xs text-gray-400 mt-0.5">
                              <Car className="h-3 w-3" />
                              {check.car.plateNumber} {check.car.makeModel}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {check.master?.fullName ?? '—'}
                        </td>
                        <td className="px-4 py-3 max-w-[200px]">
                          {hasComment ? (
                            <div className="flex items-start gap-1.5">
                              <MessageSquare className="h-3.5 w-3.5 text-gray-300 flex-shrink-0 mt-0.5" />
                              <span className="text-xs text-gray-500 leading-relaxed truncate" title={check.comment}>
                                {truncateComment(check.comment!, 50)}
                              </span>
                            </div>
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-gray-900 whitespace-nowrap">
                          {formatMoney(check.totalRevenue)}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          {hasDiscount ? (
                            <span className="inline-flex items-center gap-0.5 text-xs font-medium text-rose-600">
                              <Tag className="h-3 w-3" />
                              −{formatMoney(check.discount!)}
                            </span>
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </td>
                        {canSeeProfit && (
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            <span className={`inline-flex items-center gap-0.5 font-medium ${check.profit >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                              <TrendingUp className={`h-3.5 w-3.5 ${check.profit >= 0 ? 'text-green-500' : 'text-red-400'}`} />
                              {check.profit >= 0 ? '+' : ''}{formatMoney(check.profit)}
                            </span>
                          </td>
                        )}
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <PaymentBadge method={check.paymentMethod} />
                            {isDeferred && (
                              <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 border border-amber-300 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                                <Pause className="h-2.5 w-2.5" />
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
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
