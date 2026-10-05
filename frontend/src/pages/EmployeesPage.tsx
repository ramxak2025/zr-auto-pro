/**
 * EmployeesPage — карточки сотрудников по группам с посещаемостью, заработком,
 * достижениями и переключателем периода (Сегодня · Вчера · Неделя · Месяц ·
 * Прошлый месяц). Достижения и цифры периода считаются по всей активной
 * команде за один и тот же период, поэтому меняются вместе с переключателем.
 */
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Calendar,
  ChevronRight,
  Clock,
  Pencil,
  Receipt,
  TrendingDown,
  TrendingUp,
  UserCircle,
  Users,
} from 'lucide-react';
import toast from 'react-hot-toast';

import { salaryApi, scheduleApi, usersApi } from '../api/services';
import { useTenantCalendar } from '../hooks/useTenantTimezone';
import {
  Badge,
  Card,
  IconButton,
  Input,
  Money,
  PageHeader,
  QueryState,
  SegmentedControl,
  SkeletonCard,
  StatCard,
  cn,
} from '../ui';
import { focusRing } from '../ui/tokens';
import RoleBadge from '../components/company/RoleBadge';
import UserAvatar from '../components/company/UserAvatar';
import { ErrorRow, MiniStat } from '../components/dashboard/shared';
import type { MasterSalary, ScheduleEntry, User } from '../types';
import { roleLabels } from '../../../shared/utils/formatters';
import { apiErrorMessage } from '../../../shared/utils/apiError';
import {
  PERIOD_LABEL_CASUAL,
  PERIOD_OPTIONS,
  aggregateAttendance,
  resolvePeriod,
  type PeriodKey,
} from '../utils/employeePeriod';
import { computeAchievements, type Achievement, type AchievementInput } from '../utils/employeeAchievements';

const NO_GROUP = '__NO_GROUP__';
const PERIOD_KEYS = new Set<string>(PERIOD_OPTIONS.map((p) => p.key));
const ROLE_ORDER = ['master', 'admin', 'director', 'superadmin'];

type AttendanceMap = ReturnType<typeof aggregateAttendance>;
type AttendanceRow = AttendanceMap extends Map<string, infer V> ? V : never;

export default function EmployeesPage() {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  // Период — в URL (?period=), чтобы F5 и возврат из карточки не сбрасывали выбор.
  const rawPeriod = params.get('period');
  const period: PeriodKey = rawPeriod && PERIOD_KEYS.has(rawPeriod) ? (rawPeriod as PeriodKey) : 'thisMonth';
  const setPeriod = (next: PeriodKey) => {
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (next === 'thisMonth') p.delete('period');
        else p.set('period', next);
        return p;
      },
      { replace: true },
    );
  };

  // Опора периода — сегодняшний день АВТОСЕРВИСА (157), не браузера: сервер
  // режет бизнес-сутки поясом тенанта, и по часам машины «Сегодня» просило
  // соседние сутки (обоснование — в resolvePeriod).
  const { today: tenantToday } = useTenantCalendar();
  const range = useMemo(() => resolvePeriod(period, tenantToday), [period, tenantToday]);

  // ── Данные ──────────────────────────────────────────────────────────
  const {
    data: users,
    isLoading: usersLoading,
    isError: usersError,
    refetch: refetchUsers,
    isFetching: usersFetching,
  } = useQuery<User[]>({
    queryKey: ['users-all'],
    queryFn: async () => {
      const res = await usersApi.getAll();
      return res.data;
    },
    staleTime: 60_000,
  });

  // Расписание за период — один запрос, агрегация на клиенте.
  const scheduleQuery = useQuery<ScheduleEntry[]>({
    queryKey: ['employee-schedule', range.from, range.to],
    queryFn: async () => {
      const res = await scheduleApi.getAll({ dateFrom: range.from, dateTo: range.to });
      return res.data;
    },
    staleTime: 30_000,
  });

  // Зарплата за период и за сопоставимый предыдущий.
  const salaryQuery = useQuery<MasterSalary[]>({
    queryKey: ['employee-salary', range.from, range.to],
    queryFn: async () => {
      const res = await salaryApi.getAll({ dateFrom: range.from, dateTo: range.to });
      return res.data;
    },
    staleTime: 30_000,
  });
  const prevSalaryQuery = useQuery<MasterSalary[]>({
    queryKey: ['employee-salary-prev', range.prevFrom, range.prevTo],
    queryFn: async () => {
      const res = await salaryApi.getAll({ dateFrom: range.prevFrom, dateTo: range.prevTo });
      return res.data;
    },
    staleTime: 30_000,
  });
  const scheduleEntries = scheduleQuery.data;
  const salaryRows = salaryQuery.data;
  const prevSalaryRows = prevSalaryQuery.data;

  // ── Производные ─────────────────────────────────────────────────────
  const activeUsers = useMemo(() => (users ?? []).filter((u) => u.isActive), [users]);

  const roleBreakdown = useMemo(() => {
    const counts = new Map<string, number>();
    for (const u of activeUsers) counts.set(u.role, (counts.get(u.role) ?? 0) + 1);
    return ROLE_ORDER.filter((r) => (counts.get(r) ?? 0) > 0).map((r) => ({ role: r, count: counts.get(r) ?? 0 }));
  }, [activeUsers]);

  const attendance = useMemo(
    () => aggregateAttendance(scheduleEntries ?? [], tenantToday),
    [scheduleEntries, tenantToday],
  );

  const salaryByUser = useMemo(() => {
    const map = new Map<string, MasterSalary>();
    (salaryRows ?? []).forEach((s) => map.set(s.masterId, s));
    return map;
  }, [salaryRows]);

  const prevSalaryByUser = useMemo(() => {
    const map = new Map<string, MasterSalary>();
    (prevSalaryRows ?? []).forEach((s) => map.set(s.masterId, s));
    return map;
  }, [prevSalaryRows]);

  // Достижения — по всей команде за период.
  const achievements = useMemo(() => {
    const inputs: AchievementInput[] = activeUsers.map((u) => {
      const sal = salaryByUser.get(u.id);
      const att = attendance.get(u.id);
      return {
        userId: u.id,
        role: u.role,
        earnings: sal?.totalEarnings,
        revenue: sal?.totalRevenue,
        checkCount: sal?.checkCount,
        scheduled: att?.scheduled,
        worked: att?.worked,
        daysOff: att?.daysOff,
        lateMajor: att?.lateMajor,
      };
    });
    return computeAchievements(inputs);
  }, [activeUsers, salaryByUser, attendance]);

  // Группы по `team` (NULL → «Без группы»).
  const groups = useMemo(() => {
    const buckets = new Map<string, User[]>();
    for (const u of activeUsers) {
      const key = u.team && u.team.trim() ? u.team.trim() : NO_GROUP;
      const arr = buckets.get(key) ?? [];
      arr.push(u);
      buckets.set(key, arr);
    }
    for (const arr of buckets.values()) {
      arr.sort((a, b) => a.fullName.localeCompare(b.fullName, 'ru'));
    }
    // Именованные группы по алфавиту, «Без группы» — последней.
    return Array.from(buckets.entries()).sort((a, b) => {
      if (a[0] === NO_GROUP) return 1;
      if (b[0] === NO_GROUP) return -1;
      return a[0].localeCompare(b[0], 'ru');
    });
  }, [activeUsers]);

  // ── Переименование группы — патчит всех её участников разом ─────────
  const renameMutation = useMutation({
    mutationFn: async ({ from, to }: { from: string; to: string }) => {
      const members = (users ?? []).filter((u) => (u.team ?? '') === from);
      await Promise.all(members.map((u) => usersApi.update(u.id, { team: to } as never)));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users-all'] });
      toast.success('Группа переименована');
    },
    onError: (err: unknown) => toast.error(apiErrorMessage(err) ?? 'Не удалось переименовать'),
  });

  // Вторичные запросы: сбой не прячем за «—», а называем и даём повторить.
  const failedSecondary = [
    scheduleQuery.isError && !scheduleQuery.data ? 'посещаемость' : null,
    salaryQuery.isError && !salaryQuery.data ? 'заработок' : null,
    prevSalaryQuery.isError && !prevSalaryQuery.data ? 'сравнение с прошлым периодом' : null,
  ].filter(Boolean) as string[];
  const retrySecondary = () => {
    if (scheduleQuery.isError) void scheduleQuery.refetch();
    if (salaryQuery.isError) void salaryQuery.refetch();
    if (prevSalaryQuery.isError) void prevSalaryQuery.refetch();
  };
  const secondaryFetching = scheduleQuery.isFetching || salaryQuery.isFetching || prevSalaryQuery.isFetching;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Сотрудники"
        icon={UserCircle}
        subtitle={usersLoading ? 'Команда автосервиса' : `${activeUsers.length} активных`}
        actions={
          <div className="max-w-full overflow-x-auto no-scrollbar">
            <SegmentedControl
              aria-label="Период"
              value={period}
              onChange={setPeriod}
              options={PERIOD_OPTIONS.map((p) => ({ value: p.key, label: p.label }))}
            />
          </div>
        }
      />

      <QueryState
        isLoading={usersLoading}
        isError={usersError}
        onRetry={refetchUsers}
        isFetching={usersFetching}
        loader={
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <SkeletonCard key={i} lines={3} />
            ))}
          </div>
        }
        isEmpty={activeUsers.length === 0}
        empty={{
          icon: Users,
          title: 'Сотрудников пока нет',
          description: 'Пригласите команду через раздел «Пользователи».',
        }}
        errorTitle="Не удалось загрузить сотрудников"
      >
        {/* KPI: численность и разбивка по ролям — нейтральные плитки */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard compact label="Всего сотрудников" value={activeUsers.length} icon={Users} />
          {roleBreakdown.map(({ role, count }) => (
            <StatCard key={role} compact label={roleLabels[role] || role} value={count} />
          ))}
        </div>

        {failedSecondary.length > 0 && (
          <ErrorRow
            className="mt-5"
            message={`Не удалось загрузить: ${failedSecondary.join(', ')}. Цифры в карточках неполные.`}
            onRetry={retrySecondary}
            loading={secondaryFetching}
          />
        )}

        <div className="mt-5 space-y-6">
          {groups.map(([groupKey, members]) => (
            <GroupSection
              key={groupKey}
              groupKey={groupKey}
              members={members}
              attendance={attendance}
              salaryByUser={salaryByUser}
              prevSalaryByUser={prevSalaryByUser}
              achievements={achievements}
              period={period}
              onRename={(from, to) => renameMutation.mutate({ from, to })}
            />
          ))}
        </div>
      </QueryState>
    </div>
  );
}

// ─── Группа: заголовок с переименованием + карточки ──────────────────

function GroupSection({
  groupKey,
  members,
  attendance,
  salaryByUser,
  prevSalaryByUser,
  achievements,
  period,
  onRename,
}: {
  groupKey: string;
  members: User[];
  attendance: AttendanceMap;
  salaryByUser: Map<string, MasterSalary>;
  prevSalaryByUser: Map<string, MasterSalary>;
  achievements: Map<string, Achievement[]>;
  period: PeriodKey;
  onRename: (from: string, to: string) => void;
}) {
  const isUngrouped = groupKey === NO_GROUP;
  const displayName = isUngrouped ? 'Без группы' : groupKey;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const beginEdit = () => {
    setDraft(isUngrouped ? '' : groupKey);
    setEditing(true);
  };
  const commitEdit = () => {
    const next = draft.trim();
    setEditing(false);
    if (next === (isUngrouped ? '' : groupKey)) return;
    onRename(isUngrouped ? '' : groupKey, next);
  };

  return (
    <section aria-label={`Группа ${displayName}`} className="space-y-3">
      <div className="flex min-h-[36px] items-center gap-2">
        {editing ? (
          <Input
            autoFocus
            aria-label="Название группы"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitEdit();
              if (e.key === 'Escape') setEditing(false);
            }}
            placeholder="Название группы…"
            size="sm"
            className="w-64"
          />
        ) : (
          <>
            <h2 className="text-md font-semibold text-ink">{displayName}</h2>
            <Badge size="sm">{members.length}</Badge>
            <IconButton
              label={isUngrouped ? 'Назвать группу' : 'Переименовать группу'}
              icon={Pencil}
              size="sm"
              onClick={beginEdit}
            />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {members.map((u) => (
          <EmployeeCard
            key={u.id}
            user={u}
            attendance={attendance.get(u.id)}
            salary={salaryByUser.get(u.id)}
            prevSalary={prevSalaryByUser.get(u.id)}
            achievements={achievements.get(u.id) ?? []}
            period={period}
          />
        ))}
      </div>
    </section>
  );
}

// ─── Карточка сотрудника ────────────────────────────────────────────

function EmployeeCard({
  user,
  attendance,
  salary,
  prevSalary,
  achievements,
  period,
}: {
  user: User;
  attendance?: AttendanceRow;
  salary?: MasterSalary;
  prevSalary?: MasterSalary;
  achievements: Achievement[];
  period: PeriodKey;
}) {
  const earnings = salary?.totalEarnings ?? 0;
  const prevEarnings = prevSalary?.totalEarnings ?? 0;
  const earningsDeltaPct = prevEarnings > 0 ? Math.round(((earnings - prevEarnings) / prevEarnings) * 100) : null;

  const worked = attendance?.worked ?? 0;
  const avgPerShift = worked > 0 ? earnings / worked : 0;
  const lateTotal = attendance ? (attendance.lateMinor ?? 0) + (attendance.lateMajor ?? 0) : null;
  const isMaster = user.role === 'master';

  return (
    <Card as="article" padding="none" interactive className="flex flex-col">
      <Link
        to={`/employees/${user.id}`}
        className={cn('group flex items-center gap-3 rounded-t-xl px-4 pb-3 pt-4 no-underline', focusRing)}
      >
        <UserAvatar name={user.fullName} src={user.avatar} size="md" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink group-hover:text-accent-text">{user.fullName}</p>
          <div className="mt-1">
            <RoleBadge role={user.role} size="sm" />
          </div>
        </div>
        <ChevronRight
          className="h-4 w-4 flex-shrink-0 text-ink-4 transition-transform group-hover:translate-x-0.5"
          aria-hidden="true"
        />
      </Link>

      {/* Посещаемость за период */}
      <div className="grid grid-cols-2 gap-3 border-t border-line px-4 py-3">
        <MiniStat
          size="sm"
          label={
            <span className="inline-flex items-center gap-1">
              <Calendar className="h-3 w-3" aria-hidden="true" />
              Смен / расп.
            </span>
          }
          value={attendance ? `${attendance.worked}/${attendance.scheduled}` : '—'}
          hint={attendance && attendance.daysOff > 0 ? `+${attendance.daysOff} вых.` : undefined}
        />
        <MiniStat
          size="sm"
          label={
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" aria-hidden="true" />
              Опоздания
            </span>
          }
          value={lateTotal === null ? '—' : String(lateTotal)}
          tone={attendance && attendance.lateMajor > 0 ? 'warn' : 'neutral'}
          hint={
            attendance && attendance.lateMajor > 0
              ? `${attendance.lateMajor} больше часа`
              : attendance && attendance.lateMinor > 0
                ? 'все до часа'
                : undefined
          }
        />
      </div>

      {/* Заработок — только мастерам и только когда есть данные */}
      {isMaster && salary && earnings > 0 && (
        <div className="border-t border-line px-4 py-3">
          <div className="flex flex-wrap items-baseline gap-2">
            <Money value={earnings} className="text-xl font-semibold tracking-tight text-ink" />
            {earningsDeltaPct !== null && (
              <Badge
                size="sm"
                tone={earningsDeltaPct > 0 ? 'ok' : earningsDeltaPct < 0 ? 'bad' : 'neutral'}
                icon={earningsDeltaPct >= 0 ? TrendingUp : TrendingDown}
              >
                {earningsDeltaPct > 0 ? '+' : ''}
                {earningsDeltaPct}%
              </Badge>
            )}
          </div>
          <p className="mt-0.5 text-xs text-ink-3">
            {salary.checkCount} {pluralChecks(salary.checkCount)}
            {avgPerShift > 0 && (
              <>
                {' · '}~<Money value={avgPerShift} />
                /смену
              </>
            )}
            {' · '}
            {PERIOD_LABEL_CASUAL[period]}
          </p>
        </div>
      )}

      {/* Достижения */}
      {achievements.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-t border-line px-4 py-3">
          {achievements.map((a) => (
            <Badge key={a.id} outline size="sm" title={a.hint}>
              <span aria-hidden="true">{a.emoji}</span> {a.label}
            </Badge>
          ))}
        </div>
      )}

      {/* Переход к чекам мастера — настоящая ссылка (Cmd+клик, средняя кнопка) */}
      {isMaster && (
        <Link
          to={`/checks?masterId=${user.id}`}
          className={cn(
            'mt-auto flex items-center justify-between gap-2 rounded-b-xl border-t border-line px-4 py-2.5 text-sm font-medium text-accent no-underline transition-colors hover:bg-accent-soft/60',
            focusRing,
          )}
        >
          <span className="inline-flex items-center gap-1.5">
            <Receipt className="h-4 w-4" aria-hidden="true" />
            Чеки сотрудника
          </span>
          <ChevronRight className="h-4 w-4 text-ink-4" aria-hidden="true" />
        </Link>
      )}
    </Card>
  );
}

function pluralChecks(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return 'чеков';
  if (mod10 === 1) return 'чек';
  if (mod10 >= 2 && mod10 <= 4) return 'чека';
  return 'чеков';
}
