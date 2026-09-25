import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Gift, Info, Wallet } from 'lucide-react';

import { adminApi } from '../api/services';
import type { SubscriptionRevenue } from '../types';
import { formatMoney } from '../../../shared/utils/formatters';
import { Card, CardHeader } from '../ui/Card';
import { Skeleton } from '../ui/Skeleton';
import { Tooltip } from '../ui/Tooltip';
import { cn } from '../ui/cn';
import { focusRing } from '../ui/tokens';
import { ErrorRow, MiniStat, compactRub, longMonth, shortMonth } from './admin/adminUi';
import { pluralRu } from './knowledge/utils';

const CALC_HINT =
  'Фактически собранные платные продления (реестр subscription_payments) по месяцам. ' +
  'Бесплатные продления в выручку не входят — они показаны отдельным счётчиком.';

const PLOT_H = 160;

/**
 * 122 — «Платная выручка по подпискам» для суперадмин-дашборда. Живые деньги от
 * продлений: собрано за месяц / всего, число платных vs бесплатных продлений и
 * помесячный столбчатый график. Бесплатные продления НИКОГДА не выручка —
 * показаны отдельно и визуально приглушены. Само-достаточный: тянет
 * adminApi.getSubscriptionRevenue (по образцу MrrTrendChart).
 */
export default function SubscriptionRevenuePanel() {
  const months = 12;
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
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
    <Card padding="none">
      <CardHeader
        icon={Wallet}
        iconTone="ok"
        title="Платная выручка по подпискам"
        subtitle="Живые деньги от продлений; бесплатные продления выручкой не считаются"
        actions={
          <Tooltip content={CALC_HINT} side="left">
            <button
              type="button"
              className={cn(
                'inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs text-ink-3 hover:text-ink',
                focusRing,
              )}
            >
              <Info className="h-3.5 w-3.5" aria-hidden="true" />
              как считается
            </button>
          </Tooltip>
        }
      />

      {isLoading ? (
        <div className="space-y-5 px-5 py-5" aria-busy="true">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i}>
                <Skeleton variant="text" className="w-28" />
                <Skeleton className="mt-2 h-6 w-24" />
              </div>
            ))}
          </div>
          <Skeleton className="h-[160px] w-full" />
        </div>
      ) : isError ? (
        <div className="px-5 py-5">
          <ErrorRow
            message="Не удалось загрузить выручку по подпискам"
            onRetry={() => refetch()}
            loading={isFetching}
          />
        </div>
      ) : (
        <>
          {/* Сводка: одна семантика — платное зелёное, бесплатное приглушено */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-4 px-5 py-5 lg:grid-cols-4">
            <MiniStat
              label="Собрано в этом месяце"
              value={formatMoney(data?.paidRevenueThisMonth ?? 0)}
              tone={(data?.paidRevenueThisMonth ?? 0) > 0 ? 'ok' : 'neutral'}
              hint={`${data?.paidExtensionsThisMonth ?? 0} ${pluralRu(
                data?.paidExtensionsThisMonth ?? 0,
                'платное продление',
                'платных продления',
                'платных продлений',
              )}`}
            />
            <MiniStat
              label="Собрано всего"
              value={formatMoney(data?.paidRevenueTotal ?? 0)}
              hint={`${data?.paidExtensionsTotal ?? 0} платных за всё время`}
            />
            <MiniStat label="Платных продлений" value={data?.paidExtensionsThisMonth ?? 0} hint="в этом месяце" />
            <MiniStat
              label={
                <span className="inline-flex items-center gap-1">
                  <Gift className="h-3.5 w-3.5 text-ink-4" aria-hidden="true" /> Бесплатных продлений
                </span>
              }
              value={<span className="text-ink-3">{data?.freeExtensionsThisMonth ?? 0}</span>}
              hint="в этом месяце · не выручка"
            />
          </div>

          {/* Помесячный график */}
          <div className="border-t border-line px-4 pb-5 pt-4">
            <p className="mb-3 px-1 text-xs text-ink-3">Помесячно, платная выручка за последний год</p>
            {monthly.length === 0 || !hasAnyRevenue ? (
              <p className="py-12 text-center text-sm text-ink-3">Пока нет платных продлений за период.</p>
            ) : (
              <div>
                <div className="flex gap-2">
                  {/* Ось Y */}
                  <div
                    className="relative w-14 flex-shrink-0 text-right text-2xs tabular-nums text-ink-3"
                    style={{ height: PLOT_H }}
                    aria-hidden="true"
                  >
                    {[1, 0.5, 0].map((pct) => (
                      <span
                        key={pct}
                        className="absolute right-0 -translate-y-1/2 pr-1"
                        style={{ top: `${(1 - pct) * 100}%` }}
                      >
                        {pct === 0 ? '0' : compactRub(maxRevenue * pct)}
                      </span>
                    ))}
                  </div>

                  {/* Столбцы */}
                  <div className="relative min-w-0 flex-1" style={{ height: PLOT_H }}>
                    {[1, 0.5, 0].map((pct) => (
                      <div
                        key={pct}
                        className="pointer-events-none absolute inset-x-0 border-t border-line"
                        style={{ top: `${(1 - pct) * 100}%` }}
                        aria-hidden="true"
                      />
                    ))}
                    <ul className="absolute inset-0 flex items-end gap-1 sm:gap-2" aria-label="Выручка по месяцам">
                      {monthly.map((m, idx) => {
                        const pct = (m.paidRevenue / maxRevenue) * 100;
                        const isHover = hoverIdx === idx;
                        return (
                          <li key={m.month} className="relative flex h-full flex-1 items-end justify-center">
                            <button
                              type="button"
                              aria-label={`${longMonth(m.month)}: ${formatMoney(m.paidRevenue)}, платных ${m.paidCount}, бесплатных ${m.freeCount}`}
                              onMouseEnter={() => setHoverIdx(idx)}
                              onMouseLeave={() => setHoverIdx(null)}
                              onFocus={() => setHoverIdx(idx)}
                              onBlur={() => setHoverIdx(null)}
                              className={cn('flex h-full w-full max-w-[32px] items-end rounded', focusRing)}
                            >
                              <span
                                className={cn(
                                  'block w-full rounded-t-[3px] transition-colors duration-150',
                                  isHover ? 'bg-accent-hover' : 'bg-accent',
                                )}
                                style={{ height: `${m.paidRevenue > 0 ? Math.max(pct, 2) : 0}%` }}
                              />
                            </button>
                            {isHover && (
                              <div
                                role="tooltip"
                                className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-ink px-2.5 py-1.5 text-left text-xs text-white shadow-pop"
                              >
                                <p className="capitalize text-white/70">{longMonth(m.month)}</p>
                                <p className="font-semibold tabular-nums">{formatMoney(m.paidRevenue)}</p>
                                <p className="tabular-nums text-white/70">
                                  Платных: {m.paidCount} · бесплатных: {m.freeCount}
                                </p>
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </div>
                {/* Подписи месяцев — той же сеткой, что столбцы */}
                <div className="ml-16 mt-1.5 flex gap-1 sm:gap-2" aria-hidden="true">
                  {monthly.map((m, idx) => (
                    <span
                      key={m.month}
                      className={cn(
                        'flex-1 text-center text-2xs capitalize',
                        hoverIdx === idx ? 'font-medium text-ink' : 'text-ink-3',
                      )}
                    >
                      {shortMonth(m.month)}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </Card>
  );
}
