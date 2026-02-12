import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Banknote,
  CreditCard,
  ShieldCheck,
  ArrowLeft,
  TrendingUp,
} from 'lucide-react';
import { checksApi, usersApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import type { Check, PaginatedResponse, User } from '../types';
import LoadingSpinner from '../components/LoadingSpinner';
import { useNavigate } from 'react-router-dom';
import DatePeriodPicker from '../components/DatePeriodPicker';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatMoney(value: number): string {
  const rounded = Math.round(value);
  return rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' \u20BD';
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

function formatDateFull(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

interface DayRow {
  date: string;
  cash: number;
  card: number;
  warranty: number;
  total: number;
  count: number;
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function CashFlowPage() {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();

  const [masterId, setMasterId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Load all checks
  const { data: checksData, isLoading } = useQuery<PaginatedResponse<Check>>({
    queryKey: ['cashflow-checks', { masterId, dateFrom, dateTo }],
    queryFn: async () => {
      const params: any = { page: 1, limit: 1000 };
      if (masterId) params.masterId = masterId;
      if (dateFrom) params.dateFrom = dateFrom;
      if (dateTo) params.dateTo = dateTo;
      const res = await checksApi.getAll(params);
      return res.data;
    },
  });

  // Load masters for filter
  const { data: mastersData } = useQuery<User[]>({
    queryKey: ['masters-list'],
    queryFn: async () => {
      const res = await usersApi.getAll();
      return res.data?.data || res.data || [];
    },
    staleTime: 5 * 60_000,
  });
  const masters = (mastersData || []) as User[];

  const checks = checksData?.data || [];
  const hasFilters = !!(dateFrom || dateTo || masterId);

  // Group by day
  const dayRows = useMemo<DayRow[]>(() => {
    const map = new Map<string, DayRow>();
    for (const check of checks) {
      const dateKey = check.date.split('T')[0];
      if (!map.has(dateKey)) {
        map.set(dateKey, { date: dateKey, cash: 0, card: 0, warranty: 0, total: 0, count: 0 });
      }
      const row = map.get(dateKey)!;
      row.count++;
      const amount = check.totalRevenue;
      row.total += amount;

      if (check.paymentMethod === 'cash') row.cash += amount;
      else if (check.paymentMethod === 'card') row.card += amount;
      else if (check.paymentMethod === 'warranty') row.warranty += amount;
      else if (check.paymentMethod === 'cash_card') {
        // Split roughly 50/50 for display
        row.cash += Math.round(amount / 2);
        row.card += amount - Math.round(amount / 2);
      }
    }
    return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
  }, [checks]);

  // Totals
  const totals = useMemo(() => {
    return dayRows.reduce(
      (acc, r) => ({ cash: acc.cash + r.cash, card: acc.card + r.card, warranty: acc.warranty + r.warranty, total: acc.total + r.total, count: acc.count + r.count }),
      { cash: 0, card: 0, warranty: 0, total: 0, count: 0 },
    );
  }, [dayRows]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)}
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-white border border-gray-200 text-gray-500 hover:bg-gray-50">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div>
          <h1 className="text-lg font-bold text-gray-900">Движение денег</h1>
          <p className="text-[11px] text-gray-400">По дням и способам оплаты</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <DatePeriodPicker
          dateFrom={dateFrom}
          dateTo={dateTo}
          onChange={(from, to) => { setDateFrom(from); setDateTo(to); }}
        />
        <select
          value={masterId}
          onChange={(e) => setMasterId(e.target.value)}
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-600 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 focus:outline-none"
        >
          <option value="">Все сотрудники</option>
          {masters.map((m) => (
            <option key={m.id} value={m.id}>{m.fullName}</option>
          ))}
        </select>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="rounded-xl bg-white border border-gray-100 shadow-sm p-3.5">
          <div className="flex items-center gap-2 mb-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-50">
              <Banknote className="h-4 w-4 text-green-600" />
            </div>
            <span className="text-[11px] text-gray-400 font-medium">Наличные</span>
          </div>
          <p className="text-base font-bold text-gray-900">{formatMoney(totals.cash)}</p>
        </div>
        <div className="rounded-xl bg-white border border-gray-100 shadow-sm p-3.5">
          <div className="flex items-center gap-2 mb-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50">
              <CreditCard className="h-4 w-4 text-blue-600" />
            </div>
            <span className="text-[11px] text-gray-400 font-medium">Карта</span>
          </div>
          <p className="text-base font-bold text-gray-900">{formatMoney(totals.card)}</p>
        </div>
        <div className="rounded-xl bg-white border border-gray-100 shadow-sm p-3.5">
          <div className="flex items-center gap-2 mb-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-50">
              <ShieldCheck className="h-4 w-4 text-orange-600" />
            </div>
            <span className="text-[11px] text-gray-400 font-medium">Гарантия</span>
          </div>
          <p className="text-base font-bold text-gray-900">{formatMoney(totals.warranty)}</p>
        </div>
        <div className="rounded-xl bg-white border border-gray-100 shadow-sm p-3.5">
          <div className="flex items-center gap-2 mb-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-50">
              <TrendingUp className="h-4 w-4 text-purple-600" />
            </div>
            <span className="text-[11px] text-gray-400 font-medium">Всего</span>
          </div>
          <p className="text-base font-bold text-gray-900">{formatMoney(totals.total)}</p>
        </div>
      </div>

      {/* Day rows */}
      {isLoading ? (
        <LoadingSpinner />
      ) : dayRows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-gray-400">
          <Banknote className="h-12 w-12 mb-3" />
          <p className="text-sm">Нет данных за выбранный период</p>
        </div>
      ) : (
        <div className="space-y-2">
          {dayRows.map((row) => (
            <div key={row.date} className="rounded-xl bg-white border border-gray-100 shadow-sm px-4 py-3">
              {/* Date header */}
              <div className="flex items-center justify-between mb-2.5">
                <div>
                  <p className="text-sm font-semibold text-gray-900">{formatDateFull(row.date)}</p>
                  <p className="text-[11px] text-gray-400">{row.count} чеков</p>
                </div>
                <span className="text-base font-bold text-gray-900">{formatMoney(row.total)}</span>
              </div>
              {/* Breakdown */}
              <div className="flex items-center gap-2 flex-wrap">
                {row.cash > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-green-50 border border-green-100 px-2.5 py-1 text-[11px] font-medium text-green-700">
                    <Banknote className="h-3 w-3" />{formatMoney(row.cash)}
                  </span>
                )}
                {row.card > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 border border-blue-100 px-2.5 py-1 text-[11px] font-medium text-blue-700">
                    <CreditCard className="h-3 w-3" />{formatMoney(row.card)}
                  </span>
                )}
                {row.warranty > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-orange-50 border border-orange-100 px-2.5 py-1 text-[11px] font-medium text-orange-700">
                    <ShieldCheck className="h-3 w-3" />{formatMoney(row.warranty)}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
