import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { dashboardApi, salaryApi } from '../../api/services';
import { useAuth } from '../../contexts/AuthContext';
import { useTenantTimezone } from '../../hooks/useTenantTimezone';
import { formatDayKey } from '../../../../shared/utils/formatters';
import {
  ATTENTION_LABELS,
  ATTENTION_LINKS,
  EARNINGS_EXPLANATION,
  earningsMoney,
} from '../../../../shared/utils/dashboardAttention';
import { Card, CardHeader } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { SkeletonCard } from '../../ui/Skeleton';
import { ErrorRow, initialsOf } from './shared';

function useTodayScope() {
  const { user } = useAuth();
  const timezone = useTenantTimezone();
  const [day, setDay] = useState(() => formatDayKey(new Date(), timezone));
  useEffect(() => {
    const update = () => setDay(formatDayKey(new Date(), timezone));
    update();
    const timer = window.setInterval(update, 60_000);
    window.addEventListener('focus', update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', update);
    };
  }, [timezone]);
  return [user?.id, user?.currentPointId ?? null, timezone, day, JSON.stringify(user?.permissions)] as const;
}

function Avatar({ name, avatar }: { name: string; avatar: string | null }) {
  const [failed, setFailed] = useState(false);
  const url = avatar;
  return (
    <span
      className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-3 text-xs font-semibold text-ink-2"
      aria-hidden="true"
    >
      {url && !failed ? (
        <img src={url} alt="" className="h-full w-full object-cover" onError={() => setFailed(true)} />
      ) : (
        initialsOf(name)
      )}
    </span>
  );
}

export function AttentionCard() {
  const { user, hasPermission } = useAuth();
  const scope = useTodayScope();
  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['dashboard-attention', ...scope],
    queryFn: async () => (await dashboardApi.attention()).data,
    enabled: user?.role === 'director',
    staleTime: 30_000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    placeholderData: undefined,
  });
  if (user?.role !== 'director') return null;
  if (isLoading) return <SkeletonCard lines={4} />;
  if (isError && !data)
    return <ErrorRow message="Не удалось загрузить задачи" onRetry={() => refetch()} loading={isFetching} />;
  if (!data?.buckets.length) return null;
  return (
    <Card>
      <CardHeader title="Требует внимания" subtitle={`${data.date} · текущий филиал`} />
      {isError && <ErrorRow message="Задачи не обновились" onRetry={() => refetch()} loading={isFetching} />}
      <ul className="divide-y divide-line px-5">
        {data.buckets.map((bucket) => (
          <li key={bucket.id}>
            {bucket.error ? (
              <div className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm text-ink-3">
                <span>{ATTENTION_LABELS[bucket.id]} · не загрузилось</span>
                <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching}>
                  Повторить
                </Button>
              </div>
            ) : (
              <Link
                to={
                  bucket.id === 'deferred' && !hasPermission('checks_view_all') && user?.id
                    ? `${ATTENTION_LINKS[bucket.id]}&masterId=${encodeURIComponent(user.id)}`
                    : ATTENTION_LINKS[bucket.id]
                }
                className={`flex min-h-[48px] items-center gap-3 rounded-lg py-3 text-sm transition-colors hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${bucket.count ? 'text-ink' : 'text-ink-3'}`}
              >
                <span className="min-w-0 flex-1">{ATTENTION_LABELS[bucket.id]}</span>
                <span className="tabular-nums font-semibold">{bucket.count}</span>
                <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />
              </Link>
            )}
          </li>
        ))}
      </ul>
      {data.buckets.every((b) => b.count === 0 && !b.error) && (
        <p className="px-5 pb-4 text-xs text-ink-3">Всё под контролем</p>
      )}
    </Card>
  );
}

export function TodayEarningsCard() {
  const { hasPermission } = useAuth();
  const allowed = hasPermission('salary_view_all');
  const scope = useTodayScope();
  const [expanded, setExpanded] = useState(false);
  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['salary-today-earnings', ...scope],
    queryFn: async () => (await salaryApi.getTodayEarnings()).data,
    enabled: allowed,
    staleTime: 30_000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    placeholderData: undefined,
  });
  if (!allowed) return null;
  if (isLoading) return <SkeletonCard lines={4} />;
  if (isError && !data)
    return <ErrorRow message="Не удалось загрузить заработок" onRetry={() => refetch()} loading={isFetching} />;
  if (!data) return null;
  return (
    <Card>
      <CardHeader title="Заработок сегодня" subtitle={`${data.date} · текущий филиал`} />
      {isError && <ErrorRow message="Заработок не обновился" onRetry={() => refetch()} loading={isFetching} />}
      <ul className="divide-y divide-line px-5">
        {(expanded ? data.employees : data.employees.slice(0, 5)).map((employee) => (
          <li key={employee.id} className="flex items-center gap-3 py-3">
            <Avatar key={`${employee.id}:${employee.avatar}`} name={employee.name} avatar={employee.avatar} />
            <span className="min-w-0 flex-1 break-words text-sm text-ink">{employee.name}</span>
            <span className="shrink-0 text-right text-sm font-semibold tabular-nums text-ink">
              {earningsMoney(employee.earnedAmount)}
            </span>
          </li>
        ))}
      </ul>
      {!data.employees.length && <p className="px-5 py-4 text-sm text-ink-3">В этом филиале пока нет сотрудников</p>}
      {data.employees.length > 5 && (
        <div className="px-5 pb-3">
          <Button variant="ghost" size="sm" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
            {expanded ? 'Свернуть' : `Показать всех (${data.employees.length})`}
          </Button>
        </div>
      )}
      <div className="flex justify-between gap-3 border-t border-line px-5 py-3 text-sm font-semibold text-ink">
        <span>Всего</span>
        <span className="tabular-nums">{earningsMoney(data.total)}</span>
      </div>
      <p className="px-5 pb-4 text-xs leading-relaxed text-ink-3">{EARNINGS_EXPLANATION}</p>
    </Card>
  );
}
