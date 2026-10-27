import { accrualBreakdown } from '../../../../shared/utils/accrualBreakdown';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, ChevronDown, Coins, Wallet } from 'lucide-react';
import { reportsApi } from '../../api/services';
import { formatMoney } from '../../../../shared/utils/formatters';
import { Card, CardHeader } from '../../ui/Card';
import { Badge } from '../../ui/Badge';
import { Money } from '../../ui/Money';
import { SkeletonCard } from '../../ui/Skeleton';
import { cn } from '../../ui/cn';
import { focusRing } from '../../ui/tokens';
import { ErrorRow } from './shared';

function BreakdownRow({ label, contribution }: { label: string; contribution: number }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 text-sm">
      <span className="text-ink-2">{label}</span>
      <Money value={contribution} precision={2} signed colorize className="font-medium" />
    </div>
  );
}

/**
 * Реальная чистая прибыль по начислению (owner/director): постоянные расходы и
 * оклады размазаны по календарным дням, поэтому цифра не прыгает в день
 * выплат. Источник — reportsApi.dashboardV2().netProfitAccrual (тот же кеш,
 * что у KpiStrip). На старом бэкенде без поля карточка не рисуется.
 */
export default function NetProfitCard() {
  const [expanded, setExpanded] = useState(false);
  const [period, setPeriod] = useState<'today' | 'mtd'>('mtd');
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['dashboard-v2'],
    queryFn: async () => (await reportsApi.dashboardV2()).data,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  if (isLoading && !data) return <SkeletonCard lines={3} />;
  if (isError && !data)
    return <ErrorRow message="Не удалось загрузить чистую прибыль" onRetry={() => refetch()} loading={isFetching} />;

  const acc = data?.netProfitAccrual;
  if (!acc) return null; // legacy backend — no accrual payload

  const { projection, config, daysElapsed, daysInMonth } = acc;
  const selected = period === 'today' && acc.today ? acc.today : acc.mtd;
  const configEmpty =
    config.plannedFixedMonthly === 0 &&
    config.staffFixedMonthly === 0 &&
    config.pctTurnoverTotal === 0 &&
    config.pctProfitTotal === 0 &&
    !config.hasPerVehicleDayCosts;
  const positive = selected.netProfit >= 0;
  const visibleRows = accrualBreakdown(selected);

  return (
    <Card padding="none">
      <CardHeader
        dense
        icon={Coins}
        iconTone={positive ? 'ok' : 'bad'}
        title="Чистая прибыль"
        subtitle="по начислению"
        actions={
          <Badge tone="neutral" className="tabular-nums">
            {daysElapsed} / {daysInMonth} дн.
          </Badge>
        }
      />

      <div className="px-4 pt-4">
        {acc.today && (
          <SegmentedControl
            aria-label="Период прибыли по начислению"
            size="sm"
            className="mb-4"
            options={[
              { value: 'today', label: 'Сегодня' },
              { value: 'mtd', label: 'С начала месяца' },
            ]}
            value={period}
            onChange={setPeriod}
          />
        )}
        {!acc.today && <p className="mb-3 text-xs text-ink-3">С начала месяца</p>}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <Money
              value={selected.netProfit}
              precision={2}
              colorize
              className={cn('block text-[28px] font-semibold leading-none tracking-tight', positive && 'text-ink')}
            />
            <p className="mt-1.5 text-xs text-ink-3">
              {period === 'today' && acc.today ? 'За сегодня, по начислению' : 'С начала месяца, по начислению'}
            </p>
          </div>
          <div className="flex-shrink-0 text-right">
            <p className="text-2xs font-medium uppercase tracking-wide text-ink-3">Прогноз на месяц</p>
            <p className="mt-0.5 text-base font-semibold tabular-nums text-ink-2">
              {formatMoney(projection.netProfit, 2)}
            </p>
          </div>
        </div>

        {config.recurringUncovered > 0 && (
          <Link
            to="/planning"
            className={cn(
              'mt-4 flex items-center gap-2.5 rounded-lg border border-warn/30 bg-warn-soft px-3 py-2.5 text-warn-text transition-colors hover:border-warn/50',
              focusRing,
            )}
          >
            <AlertTriangle className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
            <span className="flex-1 text-xs leading-snug">
              Отмечено постоянным, но не в Плане:{' '}
              <span className="font-semibold tabular-nums">{formatMoney(config.recurringUncovered)}</span>
            </span>
            <ArrowRight className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
          </Link>
        )}

        {configEmpty && (
          <Link
            to="/planning"
            className={cn(
              'mt-4 flex items-center gap-2.5 rounded-lg border border-accent/20 bg-accent-soft px-3 py-2.5 text-accent-text transition-colors hover:border-accent/40',
              focusRing,
            )}
          >
            <Wallet className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
            <span className="flex-1 text-xs leading-snug">
              Настройте постоянные расходы и оклады — прибыль станет точной
            </span>
            <ArrowRight className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
          </Link>
        )}
      </div>

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className={cn(
          'mt-4 flex w-full items-center justify-between border-t border-line px-4 py-2.5 text-xs font-medium text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink',
          !expanded && 'rounded-b-xl',
          focusRing,
        )}
      >
        <span>Как это считается</span>
        <ChevronDown
          className={cn('h-4 w-4 transition-transform duration-150', expanded && 'rotate-180')}
          aria-hidden="true"
        />
      </button>

      {expanded && (
        <div className="rounded-b-xl border-t border-line bg-surface-2 px-4 py-3">
          <div className="divide-y divide-line">
            {visibleRows.map((r) => (
              <BreakdownRow key={r.label} {...r} />
            ))}
          </div>
          <div className="mt-2 flex items-center justify-between border-t border-line-strong pt-2.5">
            <span className="text-sm font-semibold text-ink">Чистая прибыль</span>
            <Money value={selected.netProfit} precision={2} colorize className="text-base font-semibold" />
          </div>
        </div>
      )}
    </Card>
  );
}
