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

function BreakdownRow({ label, value, sign }: { label: string; value: number; sign: 'plus' | 'minus' }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span className="text-ink-2">{label}</span>
      <span className={cn('font-medium tabular-nums', sign === 'plus' ? 'text-ink' : 'text-bad-text')}>
        {sign === 'minus' ? '−' : ''}
        {formatMoney(value)}
      </span>
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

  const { mtd, projection, config, daysElapsed, daysInMonth } = acc;
  const configEmpty =
    config.plannedFixedMonthly === 0 &&
    config.staffFixedMonthly === 0 &&
    config.pctTurnoverTotal === 0 &&
    config.pctProfitTotal === 0;
  const positive = mtd.netProfit >= 0;

  const rows: { label: string; value: number; sign: 'plus' | 'minus' }[] = [
    { label: 'Прибыль по чекам', value: mtd.checkProfit, sign: 'plus' },
    { label: 'Постоянные расходы', value: mtd.plannedFixedAmortized, sign: 'minus' },
    { label: 'Оклады', value: mtd.staffFixedAmortized, sign: 'minus' },
    { label: '% с оборота', value: mtd.staffPctTurnover, sign: 'minus' },
    { label: '% с прибыли', value: mtd.staffPctProfit, sign: 'minus' },
    { label: 'Разовые расходы', value: mtd.oneOffExpenses, sign: 'minus' },
  ];
  if (mtd.recurringExcess > 0) rows.push({ label: 'Постоянка вне Плана', value: mtd.recurringExcess, sign: 'minus' });
  const visibleRows = rows.filter((r, i) => i === 0 || r.value !== 0);

  return (
    <Card padding="none">
      <CardHeader
        dense
        icon={Coins}
        iconTone={positive ? 'ok' : 'bad'}
        title="Чистая прибыль"
        subtitle="по начислению · с начала месяца"
        actions={
          <Badge tone="neutral" className="tabular-nums">
            {daysElapsed} / {daysInMonth} дн.
          </Badge>
        }
      />

      <div className="px-4 pt-4">
        <div className="flex items-end justify-between gap-4">
          <div className="min-w-0">
            <Money
              value={mtd.netProfit}
              colorize
              className={cn('block text-[28px] font-semibold leading-none tracking-tight', positive && 'text-ink')}
            />
            <p className="mt-1.5 text-xs text-ink-3">Заработано к сегодняшнему дню</p>
          </div>
          <div className="flex-shrink-0 text-right">
            <p className="text-2xs font-medium uppercase tracking-wide text-ink-3">Прогноз на месяц</p>
            <p className="mt-0.5 text-base font-semibold tabular-nums text-ink-2">
              {formatMoney(projection.netProfit)}
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
              <BreakdownRow key={r.label} label={r.label} value={r.value} sign={r.sign} />
            ))}
          </div>
          <div className="mt-2 flex items-center justify-between border-t border-line-strong pt-2.5">
            <span className="text-sm font-semibold text-ink">Чистая прибыль</span>
            <Money value={mtd.netProfit} colorize className="text-base font-semibold" />
          </div>
        </div>
      )}
    </Card>
  );
}
