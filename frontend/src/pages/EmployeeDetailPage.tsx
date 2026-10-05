import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  AtSign,
  Award,
  Calendar,
  ChevronRight,
  Clock,
  Percent,
  Phone,
  Receipt,
  Wallet,
} from 'lucide-react';

import { checksApi, salaryApi, scheduleApi, usersApi } from '../api/services';
import { Card, CardBody, CardHeader, EmptyState, Money, PageHeader, SkeletonCard, StatusPill, cn } from '../ui';
import { focusRing } from '../ui/tokens';
import RoleBadge from '../components/company/RoleBadge';
import UserAvatar from '../components/company/UserAvatar';
import { shortTime, todayStatusOf } from '../components/company/scheduleStatus';
import { ErrorRow, MiniStat } from '../components/dashboard/shared';
import type { EmployeeRanking, MasterSalary, TodayEmployeeStatus, User } from '../types';
import { formatPhone } from '../../../shared/validation/phone';
import { useTenantTimezone } from '../hooks/useTenantTimezone';

const DAY_ABBR = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

function placeLabel(place: number | null, total: number): string {
  if (!place) return '—';
  return `${place} из ${total}`;
}

export default function EmployeeDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const timeZone = useTenantTimezone();

  // Профиль
  const {
    data: user,
    isLoading: userLoading,
    isError: userError,
    refetch: refetchUser,
    isFetching: userFetching,
  } = useQuery<User>({
    queryKey: ['user', id],
    queryFn: async () => {
      const res = await usersApi.getById(id);
      return res.data;
    },
    enabled: !!id,
    staleTime: 60_000,
  });

  // Статус на сегодня
  const todayQuery = useQuery<TodayEmployeeStatus[]>({
    queryKey: ['schedule-today'],
    queryFn: async () => {
      const res = await scheduleApi.getToday();
      return res.data;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const today = (todayQuery.data ?? []).find((t) => t.userId === id);

  // Зарплата (итоги периода)
  const salaryQuery = useQuery<MasterSalary[]>({
    queryKey: ['salary-all'],
    queryFn: async () => {
      const res = await salaryApi.getAll();
      return res.data;
    },
    enabled: !!user && user.role === 'master',
    staleTime: 60_000,
  });
  const salary = salaryQuery.data?.find((m) => m.masterId === id);

  // Рейтинг
  const rankingQuery = useQuery<EmployeeRanking>({
    queryKey: ['employee-ranking'],
    queryFn: async () => {
      const res = await checksApi.getRanking();
      return res.data;
    },
    staleTime: 60_000,
  });
  const ranking = rankingQuery.data;

  const rank = useMemo(() => {
    if (!ranking || !user || user.role !== 'master') return null;
    const monthSorted = [...(ranking.month ?? [])].sort((a, b) => b.revenue - a.revenue);
    const todaySorted = [...(ranking.today ?? [])].sort((a, b) => b.revenue - a.revenue);
    const monthIdx = monthSorted.findIndex((r) => r.masterId === id);
    const todayIdx = todaySorted.findIndex((r) => r.masterId === id);
    return {
      monthPlace: monthIdx >= 0 ? monthIdx + 1 : null,
      monthTotal: monthSorted.length,
      monthRevenue: monthIdx >= 0 ? monthSorted[monthIdx].revenue : 0,
      monthChecks: monthIdx >= 0 ? monthSorted[monthIdx].checkCount : 0,
      todayPlace: todayIdx >= 0 ? todayIdx + 1 : null,
      todayTotal: todaySorted.length,
    };
  }, [ranking, user, id]);

  if (userLoading) {
    return (
      <div className="space-y-5">
        <PageHeader title="Сотрудник" backTo="/employees" />
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
          <div className="space-y-5 xl:col-span-2">
            <SkeletonCard lines={3} />
            <SkeletonCard lines={3} />
          </div>
          <SkeletonCard lines={4} />
        </div>
      </div>
    );
  }

  if (userError) {
    return (
      <div className="space-y-5">
        <PageHeader title="Сотрудник" backTo="/employees" />
        <ErrorRow
          message="Не удалось загрузить карточку сотрудника"
          onRetry={() => refetchUser()}
          loading={userFetching}
        />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="space-y-5">
        <PageHeader title="Сотрудник" backTo="/employees" />
        <EmptyState
          icon={AlertTriangle}
          title="Сотрудник не найден"
          description="Возможно, учётная запись была удалена или у вас нет к ней доступа."
        />
      </div>
    );
  }

  const isMaster = user.role === 'master';
  const status = today ? todayStatusOf(today) : null;
  const daysOff = user.daysOff ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        title={user.fullName}
        backTo="/employees"
        subtitle={[user.phone ? formatPhone(user.phone) : null, user.username ? `@${user.username}` : null]
          .filter(Boolean)
          .join(' · ')}
        meta={
          <>
            <RoleBadge role={user.role} />
            {status && (
              <StatusPill tone={status.tone} live={status.tone === 'ok'}>
                {status.label}
              </StatusPill>
            )}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3 xl:items-start">
        <div className="space-y-5 xl:col-span-2">
          {/* Сегодня */}
          <Card padding="none">
            <CardHeader icon={Clock} title="Сегодня" subtitle="Смена, приход и опоздание по графику" />
            <CardBody>
              {todayQuery.isError && !todayQuery.data ? (
                <ErrorRow
                  message="Не удалось загрузить статус на сегодня"
                  onRetry={() => todayQuery.refetch()}
                  loading={todayQuery.isFetching}
                />
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-4">
                    <MiniStat
                      label="Смена"
                      value={
                        today?.shiftStart && today?.shiftEnd
                          ? `${shortTime(today.shiftStart)}–${shortTime(today.shiftEnd)}`
                          : today?.isDayOff
                            ? 'Выходной'
                            : '—'
                      }
                    />
                    <MiniStat
                      label="Пришёл"
                      value={today?.actualArrival ? shortTime(today.actualArrival, timeZone) : '—'}
                    />
                    <MiniStat
                      label="Опоздание"
                      value={today && today.lateMinutes > 0 ? `${today.lateMinutes} мин` : '—'}
                      tone={today && today.lateMinutes > 0 ? 'warn' : 'neutral'}
                    />
                  </div>
                  {today?.note && (
                    <p className="mt-4 rounded-lg border border-warn/30 bg-warn-soft px-3.5 py-2.5 text-sm text-warn-text">
                      {today.note}
                    </p>
                  )}
                </>
              )}
            </CardBody>
          </Card>

          {/* Заработок (только мастер) */}
          {isMaster && (
            <Card padding="none">
              <CardHeader
                icon={Wallet}
                title="Заработок за период"
                subtitle="Итоги расчётного периода из раздела «Зарплата»"
              />
              <CardBody>
                {salaryQuery.isLoading && !salaryQuery.data ? (
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="h-12 animate-pulse rounded-md bg-line/70" />
                    ))}
                  </div>
                ) : salaryQuery.isError && !salaryQuery.data ? (
                  <ErrorRow
                    message="Не удалось загрузить заработок"
                    onRetry={() => salaryQuery.refetch()}
                    loading={salaryQuery.isFetching}
                  />
                ) : salary ? (
                  <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4">
                    <MiniStat label="Заработано" value={<Money value={salary.totalEarnings ?? 0} />} tone="accent" />
                    <MiniStat label="Выручка" value={<Money value={salary.totalRevenue ?? 0} />} />
                    <MiniStat label="Чеков" value={String(salary.checkCount ?? 0)} />
                    <MiniStat label="К выплате" value={<Money value={salary.remainingAmount ?? 0} />} />
                    {(salary.carryOverAmount ?? 0) > 0 && (
                      <MiniStat
                        label="Долг за прошлые месяцы"
                        value={<Money value={salary.carryOverAmount ?? 0} />}
                        hint="Выплата — на экране «Зарплата»"
                        tone="warn"
                      />
                    )}
                    {typeof salary.serviceEarnings === 'number' && (
                      <MiniStat label="С услуг" value={<Money value={salary.serviceEarnings} />} size="sm" />
                    )}
                    {typeof salary.productEarnings === 'number' && (
                      <MiniStat label="С товаров" value={<Money value={salary.productEarnings} />} size="sm" />
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-ink-3">За период начислений нет.</p>
                )}
              </CardBody>
            </Card>
          )}

          {/* Рейтинг (только мастер) */}
          {isMaster && (
            <Card padding="none">
              <CardHeader icon={Award} title="Рейтинг" subtitle="Место по выручке среди мастеров" />
              <CardBody>
                {rankingQuery.isError && !ranking ? (
                  <ErrorRow
                    message="Не удалось загрузить рейтинг"
                    onRetry={() => rankingQuery.refetch()}
                    loading={rankingQuery.isFetching}
                  />
                ) : rank && (rank.monthPlace || rank.todayPlace) ? (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <MiniStat
                        label="Сегодня"
                        value={placeLabel(rank.todayPlace, rank.todayTotal)}
                        tone={rank.todayPlace === 1 ? 'accent' : 'neutral'}
                      />
                      <MiniStat
                        label="Месяц"
                        value={placeLabel(rank.monthPlace, rank.monthTotal)}
                        tone={rank.monthPlace === 1 ? 'accent' : 'neutral'}
                      />
                    </div>
                    {rank.monthPlace && (
                      <p className="mt-4 text-xs text-ink-3">
                        Выручка за месяц: <Money value={rank.monthRevenue} className="font-semibold text-ink" />
                        {' · '}
                        Чеков: <span className="font-semibold tabular-nums text-ink">{rank.monthChecks}</span>
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-ink-3">Мастер пока не участвует в рейтинге — нет закрытых чеков.</p>
                )}
              </CardBody>
            </Card>
          )}
        </div>

        <div className="space-y-5">
          {/* Контакт и условия */}
          <Card padding="none">
            <CardHeader icon={Phone} title="Контакт и условия" />
            <CardBody padding="none">
              <div className="flex items-center gap-3 px-5 py-4">
                <UserAvatar name={user.fullName} src={user.avatar} size="lg" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">{user.fullName}</p>
                  <p className="text-xs text-ink-3">{user.isActive ? 'Активен' : 'Неактивен'}</p>
                </div>
              </div>
              <dl className="divide-y divide-line border-t border-line text-sm">
                <Row icon={Phone} label="Телефон" value={user.phone ? formatPhone(user.phone) : '—'} />
                {user.username && <Row icon={AtSign} label="Логин" value={user.username} />}
                <Row icon={Percent} label="Доля с услуг" value={`${user.salaryPercent || 0} %`} />
                {typeof user.productSalaryPercent === 'number' && (
                  <Row icon={Percent} label="Доля с товаров" value={`${user.productSalaryPercent} %`} />
                )}
                {daysOff.length > 0 && (
                  <Row icon={Calendar} label="Выходные" value={daysOff.map((d) => DAY_ABBR[d] || '?').join(', ')} />
                )}
              </dl>
            </CardBody>
          </Card>

          {/* Подробнее (только мастер) */}
          {isMaster && (
            <Card padding="none">
              <CardHeader title="Подробнее" as="h3" dense />
              <nav aria-label="Связанные разделы" className="divide-y divide-line">
                <QuickLink
                  to={`/checks?masterId=${user.id}`}
                  icon={Receipt}
                  title="Чеки сотрудника"
                  description="все заказ-наряды этого мастера"
                />
                <QuickLink to="/salary" icon={Wallet} title="Зарплата" description="расчёты и выплаты" />
              </nav>
            </Card>
          )}

          {!isMaster && <p className="text-xs text-ink-3">Заработок и рейтинг считаются только по мастерам. </p>}
        </div>
      </div>
    </div>
  );
}

function Row({ icon: Icon, label, value }: { icon: typeof Phone; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 px-5 py-3">
      <Icon className="h-4 w-4 flex-shrink-0 text-ink-4" aria-hidden="true" />
      <dt className="flex-1 text-ink-3">{label}</dt>
      <dd className="font-medium tabular-nums text-ink">{value}</dd>
    </div>
  );
}

function QuickLink({
  to,
  icon: Icon,
  title,
  description,
}: {
  to: string;
  icon: typeof Receipt;
  title: string;
  description: string;
}) {
  return (
    <Link
      to={to}
      className={cn(
        'group flex items-center gap-3 px-4 py-3 no-underline transition-colors last:rounded-b-xl hover:bg-surface-2',
        focusRing,
      )}
    >
      <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-surface-3 text-ink-3">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-ink group-hover:text-accent-text">{title}</span>
        <span className="block text-xs text-ink-3">{description}</span>
      </span>
      <ChevronRight className="h-4 w-4 text-ink-4" aria-hidden="true" />
    </Link>
  );
}
