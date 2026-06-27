import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  FileText,
  TrendingUp,
  PlusCircle,
  Search,
  AlertCircle,
  BarChart3,
  Banknote,
  CreditCard,
  ShieldCheck,
  ClipboardList,
  Play,
  Square,
  Clock,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Gift,
  Package,
} from 'lucide-react';
import {
  format,
  subDays,
  addDays,
  startOfWeek,
  addWeeks,
  subWeeks,
  startOfMonth,
  addMonths,
  subMonths,
  startOfYear,
  addYears,
  subYears,
} from 'date-fns';
import { ru } from 'date-fns/locale';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';
import { formatMoney } from '../../../shared/utils/formatters';
import { calculateAttendanceStats, attendanceScore, emptyBreakdown } from '../../../shared/utils/attendance';
import { checksApi, salaryApi, shiftsApi, scheduleApi, usersApi } from '../api/services';
import type { SalarySummary, UserRole, TodayEmployeeStatus, Shift } from '../types';
import { UserRole as UserRoleEnum } from '../types';
import { useNavigate } from 'react-router-dom';
import CallsWidget from '../components/CallsWidget';
import InstallmentsWidget from '../components/InstallmentsWidget';

// ---------------------------------------------------------------------------
// Skeleton loader for cards
// ---------------------------------------------------------------------------

function StatCardSkeleton() {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 animate-pulse">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-lg bg-gray-200" />
        <div className="h-4 w-24 rounded bg-gray-200" />
      </div>
      <div className="h-7 w-32 rounded bg-gray-200" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quick actions
// ---------------------------------------------------------------------------

interface QuickAction {
  label: string;
  to: string;
  icon: React.ReactNode;
  permissionKey?: string;
}

function QuickActions() {
  const { hasPermission } = useAuth();

  const actions: QuickAction[] = [
    {
      label: 'Новый чек',
      to: '/checks/new',
      icon: <PlusCircle className="h-5 w-5" />,
      permissionKey: 'checks_create',
    },
    {
      label: 'Найти клиента',
      to: '/clients',
      icon: <Search className="h-5 w-5" />,
      permissionKey: 'clients_view',
    },
    {
      label: 'Журнал чеков',
      to: '/checks',
      icon: <FileText className="h-5 w-5" />,
      permissionKey: 'checks_view',
    },
    {
      label: 'Отчёты',
      to: '/reports',
      icon: <BarChart3 className="h-5 w-5" />,
      permissionKey: 'financial_reports',
    },
  ];

  const visible = actions.filter((a) => !a.permissionKey || hasPermission(a.permissionKey as any));

  if (visible.length === 0) return null;

  return (
    <section>
      <h2 className="text-lg font-semibold text-gray-900 mb-3">Быстрые действия</h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {visible.map((action) => (
          <Link
            key={action.to}
            to={action.to}
            className="flex flex-col items-center justify-center gap-2 bg-white rounded-xl border border-gray-100 shadow-sm p-4
              hover:border-primary-300 hover:shadow-md text-gray-700 hover:text-primary-600 transition-all"
          >
            {action.icon}
            <span className="text-sm font-medium text-center">{action.label}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Error banner
// ---------------------------------------------------------------------------

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl p-4 text-red-700">
      <AlertCircle className="h-5 w-5 flex-shrink-0" />
      <p className="text-sm">{message}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dashboard stats section (admin / owner / other non-master roles)
// ---------------------------------------------------------------------------

function StaffStatusCircles() {
  const navigate = useNavigate();
  const { data: todayData } = useQuery<TodayEmployeeStatus[]>({
    queryKey: ['schedule-today'],
    queryFn: async () => {
      const res = await scheduleApi.getToday();
      return res.data;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const statuses = todayData ?? [];
  if (statuses.length === 0) return null;

  const isSick = (s: TodayEmployeeStatus) => (s.note || '').toLowerCase().includes('больнич');
  const isAbsent = (s: TodayEmployeeStatus) => (s.note || '').toLowerCase().includes('прогул');
  // Manual "Shift" or actual arrival counts as on shift
  const isOnShift = (s: TodayEmployeeStatus) => s.isWorking || !!s.actualArrival || s.lateStatus === 'on_time';

  const getCircleColor = (s: TodayEmployeeStatus) => {
    if (isSick(s)) return 'bg-rose-400 ring-rose-300';
    if (s.isDayOff) return 'bg-gray-400 ring-gray-300';
    if (s.lateStatus === 'late_major') return 'bg-orange-500 ring-orange-400';
    if (s.lateStatus === 'late_minor') return 'bg-yellow-300 ring-yellow-200';
    if (isOnShift(s)) return 'bg-green-500 ring-green-400';
    if (isAbsent(s)) return 'bg-red-500 ring-red-400';
    if (s.hasSchedule) return 'bg-gray-300 ring-gray-200';
    return 'bg-gray-200 ring-gray-100';
  };

  const getStatusLabel = (s: TodayEmployeeStatus) => {
    if (isSick(s)) return 'Больничный';
    if (s.isDayOff) return 'Выходной';
    if (s.lateStatus === 'late_major') return `Опозд. >${'\u00A0'}1ч`;
    if (s.lateStatus === 'late_minor') return `Опозд. <${'\u00A0'}1ч`;
    if (isOnShift(s)) return 'На смене';
    if (isAbsent(s)) return 'Прогул';
    if (s.hasSchedule) return 'Не пришёл';
    return '';
  };

  const getStatusEmoji = (s: TodayEmployeeStatus) => {
    if (isSick(s)) return '🏥';
    if (s.isDayOff) return '🌙';
    if (isAbsent(s)) return '❌';
    return null;
  };

  // Group: 1) on-shift (on-time first, then late <1h, then late >1h), 2) not arrived, 3) absent, 4) sick, 5) day off
  const sortByLateness = (a: TodayEmployeeStatus, b: TodayEmployeeStatus) => {
    const rank = (s: TodayEmployeeStatus) =>
      s.lateStatus === 'late_major' ? 3 : s.lateStatus === 'late_minor' ? 2 : 1;
    return rank(a) - rank(b);
  };
  const onShiftAll = statuses
    .filter(
      (s) =>
        (isOnShift(s) || s.lateStatus === 'late_minor' || s.lateStatus === 'late_major') &&
        !s.isDayOff &&
        !isSick(s) &&
        !isAbsent(s),
    )
    .sort(sortByLateness);
  const notArrived = statuses.filter(
    (s) => !isOnShift(s) && !s.isDayOff && s.hasSchedule && !isSick(s) && !isAbsent(s) && !s.lateStatus,
  );
  const absent = statuses.filter((s) => isAbsent(s));
  const dayOff = statuses.filter((s) => s.isDayOff && !isSick(s));
  const sick = statuses.filter((s) => isSick(s));

  const renderGroup = (title: string, icon: string, items: TodayEmployeeStatus[]) => {
    if (items.length === 0) return null;
    return (
      <div>
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <span>{icon}</span> {title} <span className="text-gray-300">({items.length})</span>
        </p>
        {/* Fixed-width, left-packed avatars (flex-wrap) instead of a 1fr grid —
            on a wide desktop card the old grid-cols-5 stretched 4 people across
            the whole width ("расплывшийся сотрудник"). Now they pack tightly. */}
        <div className="flex flex-wrap gap-2.5 sm:gap-3">
          {items.map((s) => (
            <button
              type="button"
              key={s.userId}
              onClick={() => navigate(`/employees/${s.userId}`)}
              className="flex w-[62px] flex-col items-center gap-1 min-w-0 group focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2 rounded-lg p-1 transition-transform active:scale-95"
              title={getStatusLabel(s)}
            >
              <div className="relative">
                <div
                  className={`w-11 h-11 rounded-full ring-2 flex items-center justify-center text-xs font-bold text-white transition-all group-hover:ring-4 group-hover:scale-105 ${getCircleColor(s)}`}
                >
                  {s.fullName
                    .split(' ')
                    .map((w) => w[0])
                    .join('')
                    .slice(0, 2)}
                </div>
                {getStatusEmoji(s) && (
                  <span className="absolute -bottom-0.5 -right-0.5 text-xs">{getStatusEmoji(s)}</span>
                )}
              </div>
              <span className="text-[10px] text-gray-500 w-full truncate text-center group-hover:text-gray-900 transition-colors">
                {s.fullName.split(' ')[0]}
              </span>
              <span className="text-[9px] text-gray-400 w-full truncate text-center">{getStatusLabel(s)}</span>
            </button>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="rounded-2xl border border-gray-100 bg-white shadow-sm p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-gray-900">Сотрудники сегодня</h3>
        <div className="flex items-center gap-2 text-[11px] text-gray-400 flex-wrap">
          {onShiftAll.length > 0 && (
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-green-500" /> {onShiftAll.length}
            </span>
          )}
          {notArrived.length > 0 && (
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-gray-300" /> {notArrived.length}
            </span>
          )}
          {absent.length > 0 && (
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-red-500" /> {absent.length}
            </span>
          )}
          {dayOff.length > 0 && (
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-gray-400" /> {dayOff.length}
            </span>
          )}
          {sick.length > 0 && (
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-rose-400" /> {sick.length}
            </span>
          )}
        </div>
      </div>

      {renderGroup('На смене', '✅', onShiftAll)}
      {renderGroup('Ещё не пришёл', '⏳', notArrived)}
      {renderGroup('Прогул', '❌', absent)}
      {renderGroup('Выходной', '🌙', dayOff)}
      {renderGroup('Больничный', '🏥', sick)}
    </div>
  );
}

function ShiftControl() {
  const queryClient = useQueryClient();
  const { data: myShifts } = useQuery<Shift[]>({
    queryKey: ['shifts', 'my'],
    queryFn: async () => {
      const res = await shiftsApi.getMy();
      return res.data;
    },
    staleTime: 10_000,
  });

  const openShift = useMutation({
    mutationFn: () => shiftsApi.open(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      queryClient.invalidateQueries({ queryKey: ['schedule-today'] });
      queryClient.invalidateQueries({ queryKey: ['schedule'] });
      toast.success('Смена открыта');
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Ошибка'),
  });

  const closeShift = useMutation({
    mutationFn: (id: string) => shiftsApi.close(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      queryClient.invalidateQueries({ queryKey: ['schedule-today'] });
      toast.success('Смена закрыта');
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Ошибка'),
  });

  const currentShift = myShifts?.find((s) => !s.closedAt);
  const isLoading = openShift.isPending || closeShift.isPending;

  return (
    <div className="rounded-2xl border border-gray-100 bg-white shadow-sm p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className={`flex h-10 w-10 items-center justify-center rounded-xl ${currentShift ? 'bg-green-100' : 'bg-gray-100'}`}
          >
            <Clock className={`h-5 w-5 ${currentShift ? 'text-green-600' : 'text-gray-400'}`} />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">{currentShift ? 'Смена открыта' : 'Смена закрыта'}</p>
            {currentShift && (
              <p className="text-xs text-gray-400">
                с {new Date(currentShift.openedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
              </p>
            )}
          </div>
        </div>
        {currentShift ? (
          <button
            onClick={() => closeShift.mutate(currentShift.id)}
            disabled={isLoading}
            className="flex items-center gap-2 px-4 py-2.5 bg-red-50 text-red-600 text-sm font-medium rounded-xl hover:bg-red-100 transition-colors disabled:opacity-50"
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
            Закрыть
          </button>
        ) : (
          <button
            onClick={() => openShift.mutate()}
            disabled={isLoading}
            className="flex items-center gap-2 px-4 py-2.5 bg-green-50 text-green-600 text-sm font-medium rounded-xl hover:bg-green-100 transition-colors disabled:opacity-50"
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Открыть смену
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Revenue/Profit Wave Chart Component
// ---------------------------------------------------------------------------

type ChartPeriod = 'today' | 'week' | 'month' | 'year';
const periodLabels: Record<ChartPeriod, string> = {
  today: 'Сегодня',
  week: 'Неделя',
  month: 'Месяц',
  year: 'Год',
};

function getOffsetLabel(period: ChartPeriod, offset: number): string {
  const now = new Date();
  switch (period) {
    case 'today': {
      const d = addDays(now, offset);
      return format(d, 'd MMMM yyyy', { locale: ru });
    }
    case 'week': {
      const wStart = addWeeks(startOfWeek(now, { weekStartsOn: 1 }), offset);
      const wEnd = addDays(wStart, 6);
      return `${format(wStart, 'd MMM', { locale: ru })} — ${format(wEnd, 'd MMM', { locale: ru })}`;
    }
    case 'month': {
      const m = addMonths(startOfMonth(now), offset);
      return format(m, 'LLLL yyyy', { locale: ru });
    }
    case 'year': {
      const y = addYears(startOfYear(now), offset);
      return format(y, 'yyyy');
    }
    default:
      return '';
  }
}

function RevenueChart() {
  const [period, setPeriod] = useState<ChartPeriod>('week');
  const [offset, setOffset] = useState(0);

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-chart', period, offset],
    queryFn: async () => {
      const res = await checksApi.getDashboardChart(period, offset);
      return res.data;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const maxValue = useMemo(() => {
    if (!data?.points?.length) return 1;
    return Math.max(...data.points.map((p: { revenue: number }) => p.revenue), 1);
  }, [data]);

  const maxProfit = useMemo(() => {
    if (!data?.points?.length) return 1;
    return Math.max(...data.points.map((p: { profit: number }) => p.profit), 1);
  }, [data]);

  const formatLabel = (dateStr: string, idx: number, total: number): string => {
    if (period === 'today') return '';
    if (period === 'year') {
      const months = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
      const parts = dateStr.split('-');
      return months[parseInt(parts[1]) - 1] || '';
    }
    const d = new Date(dateStr);
    if (period === 'week') {
      const days = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
      return days[d.getDay()];
    }
    // Month: render the full sequence of days (1..N) — small font + tabular-nums
    // keeps the strip readable and aligned. Earlier we skipped every 3rd/5th
    // day which read as "1,6,11,16…"; now you see 1,2,3,4,…,30.
    return `${d.getDate()}`;
  };

  const handlePeriodChange = (p: ChartPeriod) => {
    setPeriod(p);
    setOffset(0);
  };

  // Build SVG wave path
  const buildWavePath = (values: number[], height: number, width: number, max: number): string => {
    if (values.length === 0) return '';
    const padding = 16;
    const stepX = (width - padding * 2) / Math.max(values.length - 1, 1);
    const points = values.map((v, i) => ({
      x: padding + i * stepX,
      y: height - (v / max) * (height - 24) - 12,
    }));

    if (points.length === 1) {
      return `M ${points[0].x} ${points[0].y} L ${points[0].x} ${points[0].y}`;
    }

    let path = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const cpx = (prev.x + curr.x) / 2;
      path += ` C ${cpx} ${prev.y}, ${cpx} ${curr.y}, ${curr.x} ${curr.y}`;
    }
    return path;
  };

  const buildAreaPath = (values: number[], height: number, width: number, max: number): string => {
    const wavePath = buildWavePath(values, height, width, max);
    if (!wavePath) return '';
    const padding = 16;
    const stepX = (width - padding * 2) / Math.max(values.length - 1, 1);
    const lastX = padding + (values.length - 1) * stepX;
    return `${wavePath} L ${lastX} ${height} L ${padding} ${height} Z`;
  };

  const chartHeight = 160;
  const chartWidth = 600;

  const revenueValues = data?.points?.map((p: { revenue: number }) => p.revenue) ?? [];
  const profitValues = data?.points?.map((p: { profit: number }) => p.profit) ?? [];

  // Calculate change percentages
  const prevRevenue = revenueValues.length > 1 ? revenueValues[revenueValues.length - 2] : 0;
  const lastRevenue = revenueValues.length > 0 ? revenueValues[revenueValues.length - 1] : 0;
  const revChange = prevRevenue > 0 ? Math.round(((lastRevenue - prevRevenue) / prevRevenue) * 100) : 0;

  return (
    <div className="rounded-3xl bg-gradient-to-br from-blue-950 via-slate-900 to-blue-950 overflow-hidden shadow-xl ring-1 ring-white/5 transition-shadow hover:shadow-2xl">
      {/* Header */}
      <div className="px-5 pt-5 pb-3">
        <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-[0.18em] mb-3">Аналитика</p>
        <div className="flex items-center gap-1 bg-white/10 rounded-xl p-1 backdrop-blur-sm mb-2">
          {(Object.keys(periodLabels) as ChartPeriod[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => handlePeriodChange(p)}
              className={`flex-1 py-2 text-[12px] font-semibold rounded-lg transition-all text-center ${
                period === p ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-300 hover:text-white'
              }`}
            >
              {periodLabels[p]}
            </button>
          ))}
        </div>
        {data && revChange !== 0 && (
          <p className={`text-xs font-medium text-center ${revChange > 0 ? 'text-cyan-400' : 'text-red-400'}`}>
            {revChange > 0 ? '+' : ''}
            {revChange}% к пред. периоду
          </p>
        )}

        {/* Period navigation */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setOffset((o) => o - 1)}
            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-sm font-medium text-slate-300 capitalize">{getOffsetLabel(period, offset)}</span>
          <button
            type="button"
            onClick={() => setOffset((o) => (o < 0 ? o + 1 : 0))}
            disabled={offset >= 0}
            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors disabled:opacity-20"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Chart area */}
      <div className="px-2">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
          </div>
        ) : !data?.points?.length ? (
          <div className="text-center py-16 text-sm text-slate-500">Нет данных</div>
        ) : (
          <div>
            {/* SVG Chart */}
            <div className="relative" style={{ height: `${chartHeight + 20}px` }}>
              <svg
                viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                className="w-full"
                style={{ height: `${chartHeight}px` }}
                preserveAspectRatio="none"
              >
                <defs>
                  <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgb(37,99,235)" stopOpacity="0.4" />
                    <stop offset="100%" stopColor="rgb(37,99,235)" stopOpacity="0" />
                  </linearGradient>
                  <linearGradient id="profGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgb(6,182,212)" stopOpacity="0.3" />
                    <stop offset="100%" stopColor="rgb(6,182,212)" stopOpacity="0" />
                  </linearGradient>
                </defs>
                {/* Subtle grid */}
                {[0.25, 0.5, 0.75].map((pct) => (
                  <line
                    key={pct}
                    x1="16"
                    y1={chartHeight * (1 - pct)}
                    x2={chartWidth - 16}
                    y2={chartHeight * (1 - pct)}
                    stroke="rgba(255,255,255,0.06)"
                    strokeWidth="1"
                  />
                ))}
                {/* Revenue area + line */}
                <path d={buildAreaPath(revenueValues, chartHeight, chartWidth, maxValue)} fill="url(#revGrad)" />
                <path
                  d={buildWavePath(revenueValues, chartHeight, chartWidth, maxValue)}
                  fill="none"
                  stroke="rgb(37,99,235)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />
                {/* Profit area + line */}
                <path d={buildAreaPath(profitValues, chartHeight, chartWidth, maxProfit)} fill="url(#profGrad)" />
                <path
                  d={buildWavePath(profitValues, chartHeight, chartWidth, maxProfit)}
                  fill="none"
                  stroke="rgb(6,182,212)"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
              {/* X-axis labels — absolutely positioned to line up exactly with the
                  SVG point x-coordinates (which are padding + i * step), so the
                  numeric day labels sit perfectly under their data points. The
                  earlier flex layout couldn't honour the chart padding and made
                  long-period (month) labels drift off their points. */}
              {period !== 'today' && (
                <div className="relative mt-1 h-4">
                  {data.points.map((point: { date: string }, idx: number) => {
                    const label = formatLabel(point.date, idx, data.points.length);
                    if (!label) return null;
                    const padding = 16;
                    const range = chartWidth - 2 * padding;
                    const denom = Math.max(data.points.length - 1, 1);
                    const xUnits = padding + (idx / denom) * range;
                    const xPct = (xUnits / chartWidth) * 100;
                    return (
                      <span
                        key={idx}
                        className={`absolute -translate-x-1/2 tabular-nums ${
                          period === 'month' ? 'text-[8.5px]' : 'text-[10px]'
                        } text-slate-500`}
                        style={{ left: `${xPct}%` }}
                      >
                        {label}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Bottom stats row */}
      {data && (
        <div className="grid grid-cols-3 gap-px bg-white/5 mt-2">
          <div className="bg-slate-900/50 backdrop-blur px-4 py-3 text-center">
            <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Оборот</p>
            <p className="text-base font-bold text-white mt-0.5">{formatMoney(data.totalRevenue)}</p>
          </div>
          <div className="bg-slate-900/50 backdrop-blur px-4 py-3 text-center">
            <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Прибыль</p>
            <p className="text-base font-bold text-cyan-400 mt-0.5">{formatMoney(data.totalProfit)}</p>
          </div>
          <div className="bg-slate-900/50 backdrop-blur px-4 py-3 text-center">
            <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Чеков</p>
            <p className="text-base font-bold text-white mt-0.5">{data.totalChecks || '—'}</p>
          </div>
        </div>
      )}

      {/* Scrollable details */}
      {(data?.points?.length ?? 0) > 0 && data && (
        <div className="px-4 py-3">
          <div className="flex overflow-x-auto gap-2 pb-1 scrollbar-hide">
            {data.points.map(
              (point: { date: string; revenue: number; profit: number; checkCount: number }, idx: number) => (
                <div key={idx} className="flex-shrink-0 text-center px-3 py-2 rounded-xl bg-white/5 min-w-[64px]">
                  <p className="text-[9px] text-slate-500 font-medium">
                    {formatLabel(point.date, idx, data.points.length)}
                  </p>
                  <p className="text-[11px] font-bold text-blue-300">{formatMoney(point.revenue)}</p>
                  <p className="text-[9px] text-cyan-400">{formatMoney(point.profit)}</p>
                </div>
              ),
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Admin / Director Dashboard
// ---------------------------------------------------------------------------

function AdminDashboard() {
  const { user } = useAuth();
  const isOwner =
    user?.role === (UserRoleEnum.DIRECTOR as UserRole) || user?.role === (UserRoleEnum.SUPERADMIN as UserRole);

  // Admin (non-owner): only the staff roster — cap its width so a handful of
  // people don't sprawl across an ultra-wide monitor.
  if (!isOwner) {
    return (
      <div className="max-w-3xl">
        <StaffStatusCircles />
      </div>
    );
  }

  // Owner/director: real SaaS dashboard grid. On desktop (xl) the analytics +
  // staff roster occupy the main 2/3 column, while telephony KPIs sit in a
  // compact 1/3 side column — previously "Звонки" spanned the whole screen.
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-3 xl:items-start">
      <div className="space-y-5 xl:col-span-2">
        <RevenueChart />
        <StaffStatusCircles />
      </div>
      <div className="space-y-5">
        {/* Upcoming / overdue installment payments (owner-class). */}
        <InstallmentsWidget />
        {/* Calls today (replaces the old employee ranking widget — owner asked
            to surface telephony on the dashboard instead, since the employees
            section already exposes per-master ranking inside each profile). */}
        <CallsWidget />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Master salary summary
// ---------------------------------------------------------------------------

function MasterDashboard() {
  const { user } = useAuth();
  const { data, isLoading, isError } = useQuery<SalarySummary>({
    queryKey: ['salary', 'my-summary'],
    queryFn: async () => {
      const res = await salaryApi.getMy();
      return res.data;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <StatCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (isError || !data) {
    return <ErrorBanner message="Не удалось загрузить данные по зарплате" />;
  }

  const initials =
    user?.fullName
      ?.split(' ')
      .map((w) => w[0])
      .join('')
      .slice(0, 2) || 'М';
  const greeting = getGreeting();

  return (
    <div className="space-y-4">
      {/* ── Profile card ── */}
      <div className="rounded-2xl bg-gradient-to-br from-primary-600 to-primary-800 p-5 text-white shadow-lg">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/20 text-2xl font-bold backdrop-blur-sm">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-white/60">{greeting}</p>
            <p className="text-lg font-bold truncate">{user?.fullName || 'Мастер'}</p>
            <p className="text-sm text-white/70">
              Услуги {data.salaryPercent}%{data.productSalaryPercent ? ` · Товары ${data.productSalaryPercent}%` : ''}
            </p>
          </div>
        </div>
      </div>

      {/* ── Today stats: orders + earnings ── */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-white border border-gray-100 shadow-sm p-4">
          <div className="flex items-center gap-2.5 mb-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50">
              <ClipboardList className="h-4 w-4 text-blue-600" />
            </div>
            <span className="text-xs text-gray-400 font-medium">Заказов сегодня</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">{data.todayChecks || '—'}</p>
          <p className="text-[11px] text-gray-400 mt-0.5">За месяц: {data.monthChecks ?? 0}</p>
        </div>
        <div className="rounded-xl bg-white border border-gray-100 shadow-sm p-4">
          <div className="flex items-center gap-2.5 mb-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-green-50">
              <TrendingUp className="h-4 w-4 text-green-600" />
            </div>
            <span className="text-xs text-gray-400 font-medium">Сегодня</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">{data.today ? formatMoney(data.today) : '—'}</p>
          <p className="text-[11px] text-gray-400 mt-0.5">За месяц: {formatMoney(data.month)}</p>
        </div>
      </div>

      {/* ── Today cash register — different shade section ── */}
      <div className="rounded-2xl bg-gradient-to-br from-slate-50 to-slate-100 border border-slate-200 p-4 shadow-sm">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Касса сегодня</p>
        <div className="grid grid-cols-3 gap-2.5">
          <div className="rounded-xl bg-white p-3 text-center shadow-sm">
            <Banknote className="h-4 w-4 text-green-500 mx-auto mb-1.5" />
            <p className="text-sm font-bold text-gray-900">{formatMoney(data.todayCash ?? 0)}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">Наличные</p>
          </div>
          <div className="rounded-xl bg-white p-3 text-center shadow-sm">
            <CreditCard className="h-4 w-4 text-blue-500 mx-auto mb-1.5" />
            <p className="text-sm font-bold text-gray-900">{formatMoney(data.todayCard ?? 0)}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">Карта</p>
          </div>
          <div className="rounded-xl bg-white p-3 text-center shadow-sm">
            <ShieldCheck className="h-4 w-4 text-orange-500 mx-auto mb-1.5" />
            <p className="text-sm font-bold text-gray-900">{formatMoney(data.todayWarranty ?? 0)}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">Гарантия</p>
          </div>
        </div>
      </div>

      {/* ── Product earning breakdown (if any) ── */}
      {(data.todayService !== undefined || data.todayProduct !== undefined) &&
        (data.todayService || 0) + (data.todayProduct || 0) > 0 && (
          <div className="rounded-xl bg-white border border-gray-100 shadow-sm p-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Структура заработка сегодня
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-blue-50 p-3">
                <p className="text-xs text-blue-600 font-medium">С услуг</p>
                <p className="text-lg font-bold text-gray-900">{formatMoney(data.todayService ?? 0)}</p>
              </div>
              <div className="rounded-lg bg-green-50 p-3">
                <p className="text-xs text-green-600 font-medium">С товаров</p>
                <p className="text-lg font-bold text-gray-900">{formatMoney(data.todayProduct ?? 0)}</p>
              </div>
            </div>
          </div>
        )}

      {/* ── Product promotions for master ── */}
      {data.productPromotions &&
        data.productPromotions.length > 0 &&
        data.productPromotions.some((p) => p.percent > 0) && (
          <div className="rounded-2xl bg-gradient-to-br from-emerald-50 to-green-50 border border-green-200 shadow-sm overflow-hidden">
            <div className="px-4 pt-4 pb-2 flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-green-100">
                <Gift className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm font-bold text-gray-900">Бонус с товаров</p>
                <p className="text-[11px] text-gray-500">Продавай эти товары и получай % с прибыли</p>
              </div>
            </div>
            <div className="px-3 pb-3">
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {data.productPromotions
                  .filter((p) => p.percent > 0)
                  .map((promo) => (
                    <div
                      key={promo.productId}
                      className="flex items-center gap-3 bg-white rounded-xl px-3 py-2.5 shadow-sm"
                    >
                      {promo.photo ? (
                        <img
                          src={promo.photo}
                          alt={promo.productName}
                          className="w-10 h-10 rounded-lg object-cover flex-shrink-0"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                          <Package className="w-5 h-5 text-gray-300" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{promo.productName}</p>
                        <p className="text-[11px] text-gray-400">Цена: {formatMoney(promo.sellPrice)}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-bold text-green-600">+{formatMoney(promo.estimatedBonus)}</p>
                        <p className="text-[10px] text-gray-400">{promo.percent}% с прибыли</p>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
            {data.productSalaryPercent && data.productSalaryPercent > 0 && (
              <div className="border-t border-green-200 px-4 py-2.5 bg-green-50/50">
                <p className="text-xs text-green-700">
                  Также <span className="font-bold">{data.productSalaryPercent}%</span> со всех остальных товаров
                </p>
              </div>
            )}
          </div>
        )}

      <MasterRankWidget userId={user?.id} />
    </div>
  );
}

function MasterRankWidget({ userId }: { userId?: string }) {
  const [selectedMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const monthStart = `${selectedMonth}-01`;
  const monthEnd = (() => {
    const [y, m] = selectedMonth.split('-').map(Number);
    return `${y}-${String(m).padStart(2, '0')}-${new Date(y, m, 0).getDate()}`;
  })();

  const { data: monthEntries = [] } = useQuery({
    queryKey: ['schedule', monthStart, monthEnd],
    queryFn: async () => {
      const res = await scheduleApi.getAll({ dateFrom: monthStart, dateTo: monthEnd });
      return res.data as any[];
    },
    enabled: !!userId,
  });

  const { data: usersData = [] } = useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const res = await usersApi.getAll();
      return res.data as any[];
    },
  });

  const masters = (usersData as any[]).filter((u: any) => u.isActive && u.role === 'master');

  // Use SHARED attendance utility — identical logic to RatingTab on schedule.
  const stats = calculateAttendanceStats((monthEntries as any[]) || []);
  const ranked = masters
    .map((u: any) => {
      const s = stats[u.id] || emptyBreakdown();
      return { id: u.id, score: attendanceScore(s), full: s.full, total: s.total };
    })
    .sort((a: any, b: any) => b.score - a.score || b.full - a.full);

  if (!userId || ranked.length === 0) return null;
  const myRank = ranked.findIndex((r: any) => r.id === userId) + 1;
  const me = ranked.find((r: any) => r.id === userId);
  if (!me || myRank === 0) return null;

  const medal = myRank === 1 ? '🥇' : myRank === 2 ? '🥈' : myRank === 3 ? '🥉' : null;
  const scoreColor = me.score >= 90 ? 'text-green-600' : me.score >= 70 ? 'text-yellow-600' : 'text-red-500';
  const monthName = new Date(
    parseInt(selectedMonth.split('-')[0]),
    parseInt(selectedMonth.split('-')[1]) - 1,
  ).toLocaleDateString('ru-RU', { month: 'long' });

  return (
    <Link
      to="/schedule"
      className="block rounded-2xl border border-gray-100 bg-white shadow-sm p-4 hover:shadow-md transition-shadow"
    >
      <div className="flex items-center gap-4">
        <div
          className={`flex items-center justify-center w-14 h-14 rounded-full border-2 ${myRank <= 3 ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-200'}`}
        >
          <span className="text-2xl">{medal || `#${myRank}`}</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Мой рейтинг</p>
          <p className="text-base font-bold text-gray-900 capitalize mt-0.5">{monthName}</p>
          <p className="text-xs text-gray-500 mt-0.5">
            <span className={`font-bold ${scoreColor}`}>{me.score}%</span> посещаемость · {me.full}/{me.total} смен
          </p>
        </div>
        <ChevronRight className="h-5 w-5 text-gray-300 flex-shrink-0" />
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const { user } = useAuth();
  const isMaster = user?.role === (UserRoleEnum.MASTER as UserRole);
  const isOwner =
    user?.role === (UserRoleEnum.DIRECTOR as UserRole) || user?.role === (UserRoleEnum.SUPERADMIN as UserRole);

  const greeting = getGreeting();
  const displayName = user?.fullName?.split(' ')[0] || user?.username || '';

  return (
    <div className="space-y-5">
      {/* Header — only for admin/owner */}
      {!isMaster && (
        <div>
          <h1 className="text-xl font-bold text-gray-900">
            {greeting}, {displayName}!
          </h1>
          <p className="text-xs text-gray-400 mt-0.5">Обзор показателей автосервиса</p>
        </div>
      )}

      {/* Shift control — hidden for owner/director */}
      {!isOwner && <ShiftControl />}

      {/* Stats */}
      {isMaster ? <MasterDashboard /> : <AdminDashboard />}

      {/* Quick actions */}
      <QuickActions />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Time-based greeting
// ---------------------------------------------------------------------------

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'Доброе утро';
  if (hour >= 12 && hour < 17) return 'Добрый день';
  if (hour >= 17 && hour < 22) return 'Добрый вечер';
  return 'Доброй ночи';
}
