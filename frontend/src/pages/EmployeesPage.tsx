/**
 * EmployeesPage — premium grouped roster with attendance, salary,
 * achievements and a per-period switcher.
 *
 *   Period switcher  Сегодня | Вчера | Неделя | Месяц | Прошлый месяц
 *   ──────────────────────────────────────────────
 *   Group: "Диагносты"  ✎     ‹click to rename›
 *     ┌────────────────────────────────┐ ┌────...
 *     │ Avatar  Имя  · роль · группа  ✎│ │
 *     │                                │ │
 *     │ Посещения: 12/15  ⏱ 2 опозд.  │ │
 *     │ ЗП: 64 200 ₽  · среднее 5 350  │ │
 *     │ Сравнение: +12% к пред. месяцу│ │
 *     │ 🏆 Рекордсмен · 💎 Премиум     │ │
 *     │ [ Чеки сотрудника → ]          │ │
 *     └────────────────────────────────┘ └─...
 *
 * Achievements + period numbers are computed across the whole active
 * roster for the same period, so they shift when the owner switches the
 * period selector.
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Calendar, ChevronRight, Clock, Pencil, Receipt, TrendingDown, TrendingUp, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import { usersApi, scheduleApi, salaryApi } from '../api/services';
import EmptyState from '../components/EmptyState';
import LoadingSpinner from '../components/LoadingSpinner';
import type { User, ScheduleEntry, MasterSalary } from '../types';
import { roleLabels } from '../../../shared/utils/formatters';
import {
  PERIOD_OPTIONS,
  PERIOD_LABEL_CASUAL,
  resolvePeriod,
  aggregateAttendance,
  type PeriodKey,
} from '../utils/employeePeriod';
import { computeAchievements, type Achievement, type AchievementInput } from '../utils/employeeAchievements';

const roleBadgeColors: Record<string, string> = {
  superadmin: 'bg-red-50 text-red-700',
  director: 'bg-purple-50 text-purple-700',
  admin: 'bg-blue-50 text-blue-700',
  master: 'bg-green-50 text-green-700',
};

const formatMoney = (v: number): string =>
  Math.round(v)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽';

const NO_GROUP = '__NO_GROUP__';

export default function EmployeesPage() {
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState<PeriodKey>('thisMonth');
  const range = useMemo(() => resolvePeriod(period), [period]);

  // ── Data ────────────────────────────────────────────────────────────
  const { data: users, isLoading: usersLoading } = useQuery<User[]>({
    queryKey: ['users-all'],
    queryFn: async () => {
      const res = await usersApi.getAll();
      return res.data;
    },
    staleTime: 60_000,
  });

  // Schedule for the chosen period — single call, then aggregated client-side.
  const { data: scheduleEntries } = useQuery<ScheduleEntry[]>({
    queryKey: ['employee-schedule', range.from, range.to],
    queryFn: async () => {
      const res = await scheduleApi.getAll({ dateFrom: range.from, dateTo: range.to });
      return res.data;
    },
    staleTime: 30_000,
  });

  // Salary for the chosen period and the comparable previous period.
  const { data: salaryRows } = useQuery<MasterSalary[]>({
    queryKey: ['employee-salary', range.from, range.to],
    queryFn: async () => {
      const res = await salaryApi.getAll({ dateFrom: range.from, dateTo: range.to });
      return res.data;
    },
    staleTime: 30_000,
  });
  const { data: prevSalaryRows } = useQuery<MasterSalary[]>({
    queryKey: ['employee-salary-prev', range.prevFrom, range.prevTo],
    queryFn: async () => {
      const res = await salaryApi.getAll({ dateFrom: range.prevFrom, dateTo: range.prevTo });
      return res.data;
    },
    staleTime: 30_000,
  });

  // ── Derived ─────────────────────────────────────────────────────────
  const activeUsers = useMemo(() => (users ?? []).filter((u) => u.isActive), [users]);

  // Role breakdown for the KPI strip — order keeps the most relevant roles first.
  const roleBreakdown = useMemo(() => {
    const order = ['master', 'admin', 'director', 'superadmin'];
    const counts = new Map<string, number>();
    for (const u of activeUsers) counts.set(u.role, (counts.get(u.role) ?? 0) + 1);
    return order.filter((r) => (counts.get(r) ?? 0) > 0).map((r) => ({ role: r, count: counts.get(r) ?? 0 }));
  }, [activeUsers]);

  const attendance = useMemo(() => aggregateAttendance(scheduleEntries ?? []), [scheduleEntries]);

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

  // Build achievement input across the whole roster, then pick winners.
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

  // Group users by `team` (NULL → "Без группы").
  const groups = useMemo(() => {
    const buckets = new Map<string, User[]>();
    for (const u of activeUsers) {
      const key = u.team && u.team.trim() ? u.team.trim() : NO_GROUP;
      const arr = buckets.get(key) ?? [];
      arr.push(u);
      buckets.set(key, arr);
    }
    // Sort users within each group, alphabetical.
    for (const arr of buckets.values()) {
      arr.sort((a, b) => a.fullName.localeCompare(b.fullName, 'ru'));
    }
    // Stable group order: named groups alphabetical, then "Без группы" last.
    return Array.from(buckets.entries()).sort((a, b) => {
      if (a[0] === NO_GROUP) return 1;
      if (b[0] === NO_GROUP) return -1;
      return a[0].localeCompare(b[0], 'ru');
    });
  }, [activeUsers]);

  // ── Group rename — patches every member of the group at once. ──────
  const renameMutation = useMutation({
    mutationFn: async ({ from, to }: { from: string; to: string }) => {
      const members = (users ?? []).filter((u) => (u.team ?? '') === from);
      await Promise.all(members.map((u) => usersApi.update(u.id, { team: to } as never)));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users-all'] });
      toast.success('Группа переименована');
    },
    onError: () => toast.error('Не удалось переименовать'),
  });

  if (usersLoading) return <LoadingSpinner />;
  if (activeUsers.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="Сотрудников пока нет"
        description="Пригласите команду через раздел «Пользователи»."
      />
    );
  }

  return (
    <div className="space-y-4 pb-8">
      <Header period={period} onPeriodChange={setPeriod} totalActive={activeUsers.length} />

      {/* KPI strip — roster headcount + role breakdown */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
        <div className="rounded-xl bg-blue-50 p-3">
          <p className="text-[10px] font-semibold text-blue-500 uppercase tracking-wider">Всего сотрудников</p>
          <p className="text-base sm:text-lg font-bold text-blue-700 mt-0.5">{activeUsers.length}</p>
        </div>
        {roleBreakdown.map(({ role, count }) => (
          <div key={role} className="rounded-xl bg-gray-50 p-3">
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider truncate">
              {roleLabels[role] || role}
            </p>
            <p className="text-base sm:text-lg font-bold text-gray-900 mt-0.5">{count}</p>
          </div>
        ))}
      </div>

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
  );
}

// ─── Header — title + period switcher ────────────────────────────────

function Header({
  period,
  onPeriodChange,
  totalActive,
}: {
  period: PeriodKey;
  onPeriodChange: (p: PeriodKey) => void;
  totalActive: number;
}) {
  return (
    <header className="sticky top-0 z-10 -mx-4 md:-mx-6 px-4 md:px-6 pt-2 pb-3 bg-gray-50/80 backdrop-blur">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
            <Users className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Сотрудники</h1>
            <p className="text-sm text-gray-500">{totalActive} активных</p>
          </div>
        </div>

        {/* Period switcher — segmented control */}
        <div className="flex flex-wrap items-center gap-1 rounded-xl bg-white border border-gray-200 p-1 shadow-sm">
          {PERIOD_OPTIONS.map((p) => {
            const active = p.key === period;
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => onPeriodChange(p.key)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                  active ? 'bg-gray-900 text-white shadow-sm' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </div>
    </header>
  );
}

// ─── Group section — header (with rename) + employee cards ───────────

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
  attendance: ReturnType<typeof aggregateAttendance>;
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
    <section className="space-y-3">
      {/* Group title */}
      <div className="flex items-center gap-2 px-1">
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitEdit();
              if (e.key === 'Escape') setEditing(false);
            }}
            placeholder="Название группы…"
            className="text-sm font-bold text-gray-900 px-2 py-1 rounded-md border border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          />
        ) : (
          <button
            type="button"
            onClick={beginEdit}
            className="group flex items-center gap-1.5 text-sm font-bold text-gray-900 hover:text-blue-700 transition-colors"
            title={isUngrouped ? 'Назвать группу' : 'Переименовать группу'}
          >
            <span>{displayName}</span>
            <Pencil className="h-3 w-3 text-gray-300 group-hover:text-blue-600 transition-colors" />
          </button>
        )}
        <span className="text-xs text-gray-400 ml-1">{members.length}</span>
      </div>

      {/* Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
        {members.map((u, idx) => (
          <EmployeeCard
            key={u.id}
            user={u}
            attendance={attendance.get(u.id)}
            salary={salaryByUser.get(u.id)}
            prevSalary={prevSalaryByUser.get(u.id)}
            achievements={achievements.get(u.id) ?? []}
            period={period}
            index={idx}
          />
        ))}
      </div>
    </section>
  );
}

// ─── Employee card ──────────────────────────────────────────────────

function EmployeeCard({
  user,
  attendance,
  salary,
  prevSalary,
  achievements,
  period,
  index,
}: {
  user: User;
  attendance?: ReturnType<typeof aggregateAttendance> extends Map<infer _, infer V> ? V : never;
  salary?: MasterSalary;
  prevSalary?: MasterSalary;
  achievements: Achievement[];
  period: PeriodKey;
  index: number;
}) {
  const navigate = useNavigate();
  const initials = user.fullName
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const roleClass = roleBadgeColors[user.role] || roleBadgeColors.master;

  const earnings = salary?.totalEarnings ?? 0;
  const prevEarnings = prevSalary?.totalEarnings ?? 0;
  const earningsDeltaPct = prevEarnings > 0 ? Math.round(((earnings - prevEarnings) / prevEarnings) * 100) : null;

  const worked = attendance?.worked ?? 0;
  const avgPerShift = worked > 0 ? earnings / worked : 0;

  return (
    <motion.article
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay: Math.min(index * 0.03, 0.18), ease: [0.2, 0, 0, 1] }}
      className="group flex flex-col rounded-2xl border border-gray-100 bg-white shadow-sm hover:shadow-md transition-shadow overflow-hidden"
    >
      {/* Top — avatar + name + role */}
      <Link
        to={`/employees/${user.id}`}
        className="flex items-center gap-3 px-4 pt-4 pb-3 no-underline hover:bg-gray-50/50 transition-colors"
      >
        {user.avatar ? (
          <img src={user.avatar} alt="" className="h-12 w-12 rounded-full object-cover" />
        ) : (
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-blue-700 font-bold text-sm">
            {initials}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-gray-900 truncate">{user.fullName}</p>
          <span className={`inline-flex text-[10px] font-semibold px-2 py-0.5 rounded-full mt-0.5 ${roleClass}`}>
            {roleLabels[user.role] || user.role}
          </span>
        </div>
        <ChevronRight className="h-4 w-4 text-gray-300 group-hover:text-gray-500 transition-colors" />
      </Link>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-px bg-gray-100">
        <Stat
          icon={<Calendar className="h-3 w-3" />}
          label="Смен / расп."
          value={attendance ? `${attendance.worked}/${attendance.scheduled}` : '—'}
          hint={attendance && attendance.daysOff > 0 ? `+${attendance.daysOff} вых.` : undefined}
        />
        <Stat
          icon={<Clock className="h-3 w-3" />}
          label="Опоздания"
          value={attendance ? String((attendance.lateMinor ?? 0) + (attendance.lateMajor ?? 0)) : '—'}
          hint={
            attendance && attendance.lateMajor > 0
              ? `${attendance.lateMajor} >1 ч`
              : attendance && attendance.lateMinor > 0
                ? 'все <1 ч'
                : undefined
          }
          tone={attendance && attendance.lateMajor > 0 ? 'warn' : undefined}
        />
      </div>

      {/* Salary — master role only and only when there's data */}
      {user.role === 'master' && salary && earnings > 0 && (
        <div className="px-4 py-3 bg-gradient-to-r from-blue-50/40 to-transparent border-t border-gray-100">
          <div className="flex items-baseline gap-2 flex-wrap">
            <p className="text-xl font-bold text-gray-900 tabular-nums">{formatMoney(earnings)}</p>
            {earningsDeltaPct !== null && (
              <span
                className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                  earningsDeltaPct > 0
                    ? 'bg-green-50 text-green-700'
                    : earningsDeltaPct < 0
                      ? 'bg-red-50 text-red-600'
                      : 'bg-gray-100 text-gray-500'
                }`}
              >
                {earningsDeltaPct > 0 ? (
                  <TrendingUp className="h-2.5 w-2.5" />
                ) : (
                  <TrendingDown className="h-2.5 w-2.5" />
                )}
                {earningsDeltaPct > 0 ? '+' : ''}
                {earningsDeltaPct}%
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-[11px] text-gray-500 mt-0.5">
            <span>
              {salary.checkCount} {pluralChecks(salary.checkCount)}
            </span>
            {avgPerShift > 0 && (
              <>
                <span className="text-gray-300">·</span>
                <span>~{formatMoney(avgPerShift)}/смену</span>
              </>
            )}
            <span className="text-gray-300">·</span>
            <span>{PERIOD_LABEL_CASUAL[period]}</span>
          </div>
        </div>
      )}

      {/* Achievements */}
      {achievements.length > 0 && (
        <div className="px-4 py-3 border-t border-gray-100 flex flex-wrap gap-1.5">
          {achievements.map((a) => (
            <span
              key={a.id}
              title={a.hint}
              className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 ring-1 ring-amber-100"
            >
              <span>{a.emoji}</span>
              <span>{a.label}</span>
            </span>
          ))}
        </div>
      )}

      {/* Action — go to checks filtered by master */}
      {user.role === 'master' && (
        <button
          type="button"
          onClick={() => navigate(`/checks?masterId=${user.id}`)}
          className="border-t border-gray-100 px-4 py-2.5 flex items-center justify-between text-sm font-semibold text-blue-600 hover:bg-blue-50/50 transition-colors"
        >
          <span className="flex items-center gap-1.5">
            <Receipt className="h-4 w-4" />
            Чеки сотрудника
          </span>
          <ChevronRight className="h-4 w-4 text-gray-300" />
        </button>
      )}
    </motion.article>
  );
}

// ─── Atoms ──────────────────────────────────────────────────────────

function Stat({
  icon,
  label,
  value,
  hint,
  tone,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  tone?: 'warn';
}) {
  return (
    <div className="bg-white px-3 py-2.5">
      <div className="flex items-center gap-1 text-[10px] text-gray-400 uppercase tracking-wider">
        {icon}
        <span>{label}</span>
      </div>
      <p className={`text-base font-bold tabular-nums mt-0.5 ${tone === 'warn' ? 'text-orange-600' : 'text-gray-900'}`}>
        {value}
      </p>
      {hint && <p className="text-[10px] text-gray-400 mt-0">{hint}</p>}
    </div>
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
