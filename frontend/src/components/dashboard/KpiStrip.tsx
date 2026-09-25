import { useQuery } from '@tanstack/react-query';
import { Banknote, CalendarRange, Clock, Percent, Wallet } from 'lucide-react';
import { reportsApi } from '../../api/services';
import { useAuth } from '../../contexts/AuthContext';
import { formatMoney } from '../../../../shared/utils/formatters';
import { StatCard } from '../../ui/StatCard';
import { SkeletonCard } from '../../ui/Skeleton';
import { ErrorRow } from './shared';

/**
 * Полоса показателей дня для владельца. Источник — тот же запрос
 * ['dashboard-v2'], что питает «Чистую прибыль» (react-query дедуплицирует),
 * новых обращений к API нет. На старом бэкенде без полей — ничего не рисуем.
 */
export default function KpiStrip() {
  const { hasPermission } = useAuth();
  const canSeeProfit = hasPermission('profit_view');

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['dashboard-v2'],
    queryFn: async () => (await reportsApi.dashboardV2()).data,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  if (isLoading && !data) {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <SkeletonCard key={i} lines={1} />
        ))}
      </div>
    );
  }
  if (isError && !data) {
    return <ErrorRow message="Не удалось загрузить показатели дня" onRetry={() => refetch()} loading={isFetching} />;
  }
  if (!data) return null;

  const cash = data.cashPosition;
  const marginDelta = typeof data.marginPctChange === 'number' ? Math.round(data.marginPctChange * 10) / 10 : null;

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatCard
        compact
        label="Выручка сегодня"
        value={formatMoney(data.revenueToday ?? 0)}
        hint={`Чеков: ${data.checksToday ?? 0}`}
        icon={Banknote}
        tone="accent"
      />
      <StatCard
        compact
        label="Выручка за месяц"
        value={formatMoney(data.revenueMonth ?? 0)}
        hint={data.monthForecast ? `Прогноз: ${formatMoney(data.monthForecast)}` : undefined}
        icon={CalendarRange}
      />
      <StatCard
        compact
        label="Касса сегодня"
        value={formatMoney(cash?.total ?? 0)}
        hint={`Нал ${formatMoney(cash?.cash ?? 0)} · карта ${formatMoney(cash?.card ?? 0)}`}
        icon={Wallet}
      />
      {canSeeProfit ? (
        <StatCard
          compact
          label="Маржа"
          value={`${Math.round(data.marginPct ?? 0)}%`}
          delta={
            marginDelta !== null ? { value: marginDelta, suffix: ' п.п.', label: 'к прошлому периоду' } : undefined
          }
          icon={Percent}
        />
      ) : (
        <StatCard
          compact
          label="Отложенные чеки"
          value={formatMoney(data.deferredSum?.sum ?? 0)}
          hint={`Чеков: ${data.deferredSum?.count ?? 0}`}
          icon={Clock}
          tone={(data.deferredSum?.count ?? 0) > 0 ? 'warn' : 'neutral'}
        />
      )}
    </div>
  );
}
