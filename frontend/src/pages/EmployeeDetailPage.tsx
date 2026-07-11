import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  ChevronLeft,
  Phone,
  Shield,
  Calendar,
  Clock,
  AtSign,
  Award,
  TrendingUp,
  Wallet,
  Receipt,
  AlertTriangle,
} from 'lucide-react';
import { usersApi, scheduleApi, salaryApi, checksApi } from '../api/services';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';
import type { User, TodayEmployeeStatus, MasterSalary, EmployeeRanking } from '../types';
import { roleLabels, formatMoney } from '../../../shared/utils/formatters';

const roleBadgeColors: Record<string, string> = {
  superadmin: 'bg-red-50 text-red-700 ring-red-100',
  director: 'bg-purple-50 text-purple-700 ring-purple-100',
  admin: 'bg-blue-50 text-blue-700 ring-blue-100',
  master: 'bg-green-50 text-green-700 ring-green-100',
};

const formatTime = (iso?: string | null): string => {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
};

function statusBadge(s?: TodayEmployeeStatus): { text: string; tone: string } {
  if (!s) return { text: 'Нет данных', tone: 'bg-gray-100 text-gray-600 ring-gray-200' };
  const note = (s.note || '').toLowerCase();
  if (note.includes('больнич')) return { text: 'Больничный', tone: 'bg-rose-50 text-rose-700 ring-rose-200' };
  if (s.isDayOff) return { text: 'Выходной', tone: 'bg-gray-100 text-gray-600 ring-gray-200' };
  if (s.lateStatus === 'late_major')
    return { text: `Опозд. >1 ч (${s.lateMinutes} мин)`, tone: 'bg-orange-50 text-orange-700 ring-orange-200' };
  if (s.lateStatus === 'late_minor')
    return { text: `Опозд. ${s.lateMinutes} мин`, tone: 'bg-yellow-50 text-yellow-800 ring-yellow-200' };
  if (s.isWorking || s.actualArrival || s.lateStatus === 'on_time')
    return { text: 'На смене', tone: 'bg-green-50 text-green-700 ring-green-200' };
  if (note.includes('прогул')) return { text: 'Прогул', tone: 'bg-red-50 text-red-700 ring-red-200' };
  if (s.hasSchedule) return { text: 'Не пришёл', tone: 'bg-red-50 text-red-700 ring-red-200' };
  return { text: '—', tone: 'bg-gray-100 text-gray-600 ring-gray-200' };
}

export default function EmployeeDetailPage() {
  const { id = '' } = useParams<{ id: string }>();

  // Profile
  const { data: user, isLoading: userLoading } = useQuery<User>({
    queryKey: ['user', id],
    queryFn: async () => {
      const res = await usersApi.getById(id);
      return res.data;
    },
    enabled: !!id,
    staleTime: 60_000,
  });

  // Today schedule status
  const { data: todayList } = useQuery<TodayEmployeeStatus[]>({
    queryKey: ['schedule-today'],
    queryFn: async () => {
      const res = await scheduleApi.getToday();
      return res.data;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const today = (todayList ?? []).find((t) => t.userId === id);

  // Salary aggregate (period totals)
  const { data: salaryRows } = useQuery<MasterSalary[]>({
    queryKey: ['salary-all'],
    queryFn: async () => {
      const res = await salaryApi.getAll();
      return res.data;
    },
    enabled: !!user && user.role === 'master',
    staleTime: 60_000,
  });
  const salary = salaryRows?.find((m) => m.masterId === id);

  // Ranking
  const { data: ranking } = useQuery<EmployeeRanking>({
    queryKey: ['employee-ranking'],
    queryFn: async () => {
      const res = await checksApi.getRanking();
      return res.data;
    },
    staleTime: 60_000,
  });

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

  if (userLoading) return <LoadingSpinner />;
  if (!user)
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Сотрудник не найден"
        description="Возможно учётка была удалена или у вас нет к ней доступа."
      />
    );

  const initials = user.fullName
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const roleClass = roleBadgeColors[user.role] || roleBadgeColors.master;
  const sb = statusBadge(today);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: [0.2, 0, 0, 1] }}
      className="space-y-4 pb-8"
    >
      {/* Back */}
      <Link
        to="/employees"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors"
      >
        <ChevronLeft className="h-4 w-4" />К списку сотрудников
      </Link>

      {/* Hero */}
      <section className="rounded-3xl overflow-hidden bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 text-white p-6">
        <div className="flex items-center gap-4">
          {user.avatar ? (
            <img src={user.avatar} alt="" className="h-20 w-20 rounded-2xl object-cover ring-2 ring-white/20" />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-white/10 ring-2 ring-white/20 text-2xl font-bold">
              {initials}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold truncate">{user.fullName}</h1>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full ring-1 ring-inset ${roleClass}`}>
                {roleLabels[user.role] || user.role}
              </span>
              <span className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full ring-1 ring-inset ${sb.tone}`}>
                {sb.text}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Today */}
      <Section icon={<Clock className="h-4 w-4" />} title="Сегодня">
        <div className="grid grid-cols-3 gap-2">
          <Tile
            label="Смена"
            value={
              today?.shiftStart && today?.shiftEnd
                ? `${formatTime(today.shiftStart)} – ${formatTime(today.shiftEnd)}`
                : today?.isDayOff
                  ? 'Выходной'
                  : '—'
            }
          />
          <Tile label="Пришёл" value={today?.actualArrival ? formatTime(today.actualArrival) : '—'} />
          <Tile
            label="Опоздание"
            value={today && today.lateMinutes > 0 ? `${today.lateMinutes} мин` : '—'}
            tone={
              today?.lateStatus === 'late_major' ? 'orange' : today?.lateStatus === 'late_minor' ? 'yellow' : undefined
            }
          />
        </div>
        {today?.note && (
          <p className="mt-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-100 text-[12px] text-amber-800">
            {today.note}
          </p>
        )}
      </Section>

      {/* Salary (master only) */}
      {user.role === 'master' && salary && (
        <Section icon={<Wallet className="h-4 w-4" />} title="Заработок (период)">
          <div className="grid grid-cols-2 gap-2">
            <Tile label="Заработано" value={formatMoney(salary.totalEarnings ?? 0)} highlight />
            <Tile label="Выручка" value={formatMoney(salary.totalRevenue ?? 0)} highlight />
            <Tile label="Чеков" value={String(salary.checkCount ?? 0)} />
            <Tile label="К выплате" value={formatMoney(salary.remainingAmount ?? 0)} />
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {typeof salary.serviceEarnings === 'number' && (
              <Tile label="С услуг" value={formatMoney(salary.serviceEarnings)} />
            )}
            {typeof salary.productEarnings === 'number' && (
              <Tile label="С товаров" value={formatMoney(salary.productEarnings)} />
            )}
          </div>
        </Section>
      )}

      {/* Ranking (master only) */}
      {user.role === 'master' && rank && (rank.monthPlace || rank.todayPlace) && (
        <Section icon={<Award className="h-4 w-4" />} title="Рейтинг">
          <div className="grid grid-cols-2 gap-2">
            {rank.todayPlace && (
              <Tile
                label="Сегодня"
                value={`${rank.todayPlace} / ${rank.todayTotal}`}
                hint={rank.todayPlace === 1 ? '🥇' : rank.todayPlace === 2 ? '🥈' : rank.todayPlace === 3 ? '🥉' : ''}
              />
            )}
            {rank.monthPlace && (
              <Tile
                label="Месяц"
                value={`${rank.monthPlace} / ${rank.monthTotal}`}
                hint={rank.monthPlace === 1 ? '🥇' : rank.monthPlace === 2 ? '🥈' : rank.monthPlace === 3 ? '🥉' : ''}
              />
            )}
          </div>
          {rank.monthPlace && (
            <p className="mt-3 text-xs text-gray-500">
              Выручка за месяц:{' '}
              <span className="font-semibold text-gray-900 tabular-nums">{formatMoney(rank.monthRevenue)}</span>
              <span className="mx-1.5 text-gray-300">·</span>
              Чеков: <span className="font-semibold text-gray-900 tabular-nums">{rank.monthChecks}</span>
            </p>
          )}
        </Section>
      )}

      {/* Quick links to detailed reports */}
      {user.role === 'master' && (
        <Section icon={<TrendingUp className="h-4 w-4" />} title="Подробнее">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Link
              to={`/checks?masterId=${user.id}`}
              className="card-interactive flex items-center gap-3 px-4 py-3 no-underline"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                <Receipt className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900">Чеки сотрудника</p>
                <p className="text-xs text-gray-500">все заказ-наряды этого мастера</p>
              </div>
              <span className="text-gray-300 text-lg">›</span>
            </Link>
            <Link to="/salary" className="card-interactive flex items-center gap-3 px-4 py-3 no-underline">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-green-50 text-green-700">
                <Wallet className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900">Зарплата</p>
                <p className="text-xs text-gray-500">расчёты и выплаты</p>
              </div>
              <span className="text-gray-300 text-lg">›</span>
            </Link>
          </div>
        </Section>
      )}

      {/* Contact / settings */}
      <Section icon={<Phone className="h-4 w-4" />} title="Контакт и условия">
        <div className="rounded-xl border border-gray-100 divide-y divide-gray-100">
          <Row icon={<Phone className="h-4 w-4 text-gray-400" />} label="Телефон" value={user.phone || '—'} />
          {user.username && (
            <Row icon={<AtSign className="h-4 w-4 text-gray-400" />} label="Логин" value={user.username} />
          )}
          <Row
            icon={<Shield className="h-4 w-4 text-gray-400" />}
            label="Доля с услуг"
            value={`${user.salaryPercent || 0}%`}
          />
          {typeof user.productSalaryPercent === 'number' && (
            <Row
              icon={<Shield className="h-4 w-4 text-gray-400" />}
              label="Доля с товаров"
              value={`${user.productSalaryPercent}%`}
            />
          )}
          {user.daysOff && user.daysOff.length > 0 && (
            <Row
              icon={<Calendar className="h-4 w-4 text-gray-400" />}
              label="Выходные"
              value={user.daysOff.map((d) => ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'][d] || '?').join(', ')}
            />
          )}
        </div>
      </Section>
    </motion.div>
  );
}

// ── Reusable section + tile primitives ─────────────────────────────────────

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-white border border-gray-100 shadow-sm p-4">
      <h2 className="flex items-center gap-2 text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-3">
        {icon}
        <span>{title}</span>
      </h2>
      {children}
    </section>
  );
}

function Tile({
  label,
  value,
  highlight,
  tone,
  hint,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  tone?: 'orange' | 'yellow';
  hint?: string;
}) {
  const base = highlight
    ? 'bg-blue-50/60 border-blue-100 text-blue-900'
    : tone === 'orange'
      ? 'bg-orange-50 border-orange-100 text-orange-900'
      : tone === 'yellow'
        ? 'bg-yellow-50 border-yellow-100 text-yellow-900'
        : 'bg-gray-50/60 border-gray-100 text-gray-900';
  return (
    <div className={`rounded-xl border ${base} px-3 py-2`}>
      <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">{label}</p>
      <p className="text-sm font-semibold tabular-nums">
        {value}
        {hint && <span className="ml-1.5">{hint}</span>}
      </p>
    </div>
  );
}

function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      {icon}
      <span className="text-xs text-gray-500 flex-1">{label}</span>
      <span className="text-sm font-medium text-gray-900 tabular-nums">{value}</span>
    </div>
  );
}
