import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { Wallet, Gift, Loader2, Info } from 'lucide-react';

import { adminApi } from '../api/services';
import type { SubscriptionRevenue } from '../types';

function formatRub(value: number | undefined | null): string {
  return `${Math.round(value ?? 0).toLocaleString('ru-RU')} ₽`;
}

/** 'YYYY-MM' → 'июн' (short month label under a bar). */
function shortMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return month;
  return format(new Date(y, m - 1, 1), 'LLL', { locale: ru });
}

/** 'YYYY-MM' → 'июнь 2026' (tooltip). */
function longMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return month;
  return format(new Date(y, m - 1, 1), 'LLLL yyyy', { locale: ru });
}

const CALC_HINT =
  'Фактически собранные ПЛАТНЫЕ продления (реестр subscription_payments) по месяцам. ' +
  'Бесплатные продления в выручку не входят — они показаны отдельным счётчиком.';

/**
 * 122 — «Платная выручка по подпискам» для суперадмин-дашборда. Живые деньги от
 * продлений: собрано за месяц / всего, число платных vs бесплатных продлений и
 * помесячный столбчатый график. Бесплатные продления НИКОГДА не выручка —
 * показаны отдельно и визуально приглушены. Само-достаточный: тянет
 * adminApi.getSubscriptionRevenue (по образцу MrrTrendChart).
 */
export default function SubscriptionRevenuePanel() {
  const months = 12;
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-subscription-revenue', months],
    queryFn: () => adminApi.getSubscriptionRevenue(months),
    select: (res) => res.data as SubscriptionRevenue,
    staleTime: 5 * 60_000,
  });

  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const monthly = useMemo(() => data?.monthly ?? [], [data]);
  const maxRevenue = useMemo(() => Math.max(1, ...monthly.map((m) => m.paidRevenue)), [monthly]);
  const hasAnyRevenue = monthly.some((m) => m.paidRevenue > 0);

  return (
    <section className="mb-8">
      {/* Section heading */}
      <div className="mb-3 flex items-center gap-2.5">
        <div className="rounded-lg bg-emerald-50 p-2">
          <Wallet className="h-4 w-4 text-emerald-600" />
        </div>
        <div>
          <h2 className="text-lg font-semibold leading-tight text-gray-900">Платная выручка по подпискам</h2>
          <p className="text-xs text-gray-500">
            Живые деньги от продлений. Бесплатные продления не считаются выручкой.
          </p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {/* This month collected — hero */}
        <div className="relative overflow-hidden rounded-xl border border-emerald-500 bg-gradient-to-br from-emerald-500 to-emerald-600 p-5 shadow-sm">
          <p className="text-xs font-medium text-emerald-50">Собрано в этом месяце</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-white">{formatRub(data?.paidRevenueThisMonth)}</p>
          <p className="mt-1 text-[11px] tabular-nums text-emerald-50/90">
            {data?.paidExtensionsThisMonth ?? 0} платных продлений
          </p>
          <Wallet className="pointer-events-none absolute -bottom-3 -right-3 h-20 w-20 text-white/10" />
        </div>

        {/* Total collected */}
        <div className="card card-body">
          <p className="stat-label">Собрано всего</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-gray-900">{formatRub(data?.paidRevenueTotal)}</p>
          <p className="mt-1 text-[11px] tabular-nums text-gray-400">
            {data?.paidExtensionsTotal ?? 0} платных за всё время
          </p>
        </div>

        {/* Paid extensions this month */}
        <div className="card card-body">
          <p className="stat-label">Платных продлений</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-gray-900">{data?.paidExtensionsThisMonth ?? 0}</p>
          <p className="mt-1 text-[11px] text-gray-400">в этом месяце</p>
        </div>

        {/* Free extensions — de-emphasized, explicitly "not revenue" */}
        <div className="card card-body bg-gray-50/70">
          <div className="flex items-center gap-1.5">
            <Gift className="h-3.5 w-3.5 text-gray-400" />
            <p className="stat-label">Бесплатных продлений</p>
          </div>
          <p className="mt-1 text-2xl font-bold tabular-nums text-gray-500">{data?.freeExtensionsThisMonth ?? 0}</p>
          <p className="mt-1 text-[11px] text-gray-400">в этом месяце · не выручка</p>
        </div>
      </div>

      {/* Monthly paid-revenue bar chart */}
      <div className="card">
        <div className="flex items-start justify-between gap-3 px-5 pb-1 pt-5">
          <div>
            <h3 className="text-base font-semibold leading-tight text-gray-900">Помесячно</h3>
            <p className="text-xs text-gray-500">Платная выручка за последний год</p>
          </div>
          <span className="flex cursor-help items-center gap-1 text-xs text-gray-400" title={CALC_HINT}>
            <Info className="h-3.5 w-3.5" />
            как считается
          </span>
        </div>

        <div className="px-4 pb-5 pt-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-gray-300" />
            </div>
          ) : isError ? (
            <div className="py-14 text-center">
              <p className="text-sm text-gray-500">Не удалось загрузить выручку по подпискам.</p>
              <button type="button" onClick={() => refetch()} className="btn-secondary btn-sm mt-3">
                Повторить
              </button>
            </div>
          ) : monthly.length === 0 || !hasAnyRevenue ? (
            <div className="py-16 text-center text-sm text-gray-400">Пока нет платных продлений за период.</div>
          ) : (
            <div className="flex items-end gap-1 sm:gap-2">
              {monthly.map((m, idx) => {
                const pct = (m.paidRevenue / maxRevenue) * 100;
                const isHover = hoverIdx === idx;
                return (
                  <div
                    key={m.month}
                    className="group relative flex flex-1 flex-col items-center"
                    onMouseEnter={() => setHoverIdx(idx)}
                    onMouseLeave={() => setHoverIdx(null)}
                  >
                    {/* Tooltip */}
                    {isHover && (
                      <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-gray-900 px-3 py-2 text-left shadow-lg">
                        <p className="text-[10px] font-medium uppercase capitalize tracking-wide text-gray-400">
                          {longMonth(m.month)}
                        </p>
                        <p className="text-sm font-bold tabular-nums text-emerald-300">{formatRub(m.paidRevenue)}</p>
                        <p className="mt-0.5 text-[10px] tabular-nums text-gray-300">
                          Платных: {m.paidCount} · бесплатных: {m.freeCount}
                        </p>
                      </div>
                    )}

                    {/* Bar column with a faint track */}
                    <div className="relative flex h-[160px] w-full items-end justify-center">
                      <div className="absolute inset-x-1 inset-y-0 rounded-md bg-gray-50" />
                      <div
                        className={`relative w-full max-w-[26px] rounded-md bg-gradient-to-t transition-all duration-300 ${
                          isHover ? 'from-emerald-600 to-emerald-500' : 'from-emerald-500 to-emerald-400'
                        }`}
                        style={{ height: `${m.paidRevenue > 0 ? Math.max(pct, 4) : 0}%` }}
                      />
                    </div>

                    <span
                      className={`mt-1.5 text-[10px] capitalize ${
                        isHover ? 'font-medium text-gray-700' : 'text-gray-400'
                      }`}
                    >
                      {shortMonth(m.month)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
