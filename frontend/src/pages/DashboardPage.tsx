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
  Trophy,
  Play,
  Square,
  Clock,
  Loader2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';
import { checksApi, salaryApi, shiftsApi, scheduleApi } from '../api/services';
import type { SalarySummary, UserRole, EmployeeRanking, TodayEmployeeStatus, Shift } from '../types';
import { UserRole as UserRoleEnum } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatMoney(value: number): string {
  const rounded = Math.round(value);
  const formatted = rounded
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${formatted} \u20BD`;
}

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

  const visible = actions.filter(
    (a) => !a.permissionKey || hasPermission(a.permissionKey as any),
  );

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
  const { data: todayData } = useQuery<TodayEmployeeStatus[]>({
    queryKey: ['schedule-today'],
    queryFn: async () => { const res = await scheduleApi.getToday(); return res.data; },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const statuses = todayData ?? [];
  if (statuses.length === 0) return null;

  // Color scheme: green=shift, yellow=late<1h, orange=late>1h, red=absent, black=dayoff, gray=sick
  const getCircleColor = (s: TodayEmployeeStatus) => {
    const isSick = (s as any).isSickDay || (s.isDayOff && s.lateStatus === null && !s.isWorking && !s.hasSchedule === false);
    if (s.isDayOff && !isSick) return 'bg-gray-900 ring-gray-700';
    if (isSick) return 'bg-gray-400 ring-gray-300';
    if (s.lateStatus === 'late_major') return 'bg-orange-500 ring-orange-400';
    if (s.lateStatus === 'late_minor') return 'bg-yellow-400 ring-yellow-300';
    if (s.isWorking) return 'bg-green-500 ring-green-400';
    if (!s.isWorking && s.hasSchedule) return 'bg-red-500 ring-red-400';
    return 'bg-gray-300 ring-gray-200';
  };

  const getStatusLabel = (s: TodayEmployeeStatus) => {
    if (s.isDayOff) return 'Выходной';
    if (s.lateStatus === 'late_major') return `Опозд. ${s.lateMinutes}м`;
    if (s.lateStatus === 'late_minor') return `Опозд. ${s.lateMinutes}м`;
    if (s.isWorking) return 'На смене';
    if (s.hasSchedule) return 'Не пришёл';
    return '';
  };

  // Sort employees: 1. On shift (green/yellow/orange) 2. Expected but absent 3. Day off 4. Sick
  const sortPriority = (s: TodayEmployeeStatus): number => {
    if (s.isWorking && !s.isDayOff) return 0; // on shift (including late)
    if (!s.isWorking && !s.isDayOff && s.hasSchedule) return 1; // expected but absent
    if (s.isDayOff) return 2; // day off
    return 3; // no schedule
  };

  const sorted = [...statuses].sort((a, b) => sortPriority(a) - sortPriority(b));

  const onShift = sorted.filter(s => s.isWorking && !s.isDayOff);
  const absent = sorted.filter(s => !s.isWorking && !s.isDayOff && s.hasSchedule);
  const dayOff = sorted.filter(s => s.isDayOff);

  const renderGroup = (title: string, items: TodayEmployeeStatus[], emptyText?: string) => {
    if (items.length === 0 && !emptyText) return null;
    return (
      <div>
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">{title}</p>
        {items.length === 0 ? (
          <p className="text-xs text-gray-300 italic">{emptyText}</p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {items.map((s) => (
              <div key={s.userId} className="flex flex-col items-center gap-1" title={getStatusLabel(s)}>
                <div className={`w-11 h-11 rounded-full ring-2 flex items-center justify-center text-xs font-bold text-white ${getCircleColor(s)}`}>
                  {s.fullName.split(' ').map(w => w[0]).join('').slice(0, 2)}
                </div>
                <span className="text-[10px] text-gray-500 max-w-[60px] truncate text-center">{s.fullName.split(' ')[0]}</span>
                {getStatusLabel(s) && (
                  <span className="text-[9px] text-gray-400">{getStatusLabel(s)}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="rounded-2xl border border-gray-100 bg-white shadow-sm p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-gray-900">Сотрудники сегодня</h3>
        <div className="flex items-center gap-3 text-[11px] text-gray-400">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500" /> {onShift.length}</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" /> {absent.length}</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-900" /> {dayOff.length}</span>
        </div>
      </div>

      {renderGroup('На смене', onShift)}
      {renderGroup('Ожидается', absent)}
      {renderGroup('Выходной / Больничный', dayOff)}
    </div>
  );
}

function ShiftControl() {
  const queryClient = useQueryClient();
  const { data: myShifts } = useQuery<Shift[]>({
    queryKey: ['shifts', 'my'],
    queryFn: async () => { const res = await shiftsApi.getMy(); return res.data; },
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

  const currentShift = myShifts?.find(s => !s.closedAt);
  const isLoading = openShift.isPending || closeShift.isPending;

  return (
    <div className="rounded-2xl border border-gray-100 bg-white shadow-sm p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${currentShift ? 'bg-green-100' : 'bg-gray-100'}`}>
            <Clock className={`h-5 w-5 ${currentShift ? 'text-green-600' : 'text-gray-400'}`} />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">{currentShift ? 'Смена открыта' : 'Смена закрыта'}</p>
            {currentShift && (
              <p className="text-xs text-gray-400">с {new Date(currentShift.openedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</p>
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
// Revenue/Profit Chart Component
// ---------------------------------------------------------------------------

type ChartPeriod = 'today' | 'week' | 'month' | 'year';
const periodLabels: Record<ChartPeriod, string> = {
  today: 'Сегодня',
  week: 'Неделя',
  month: 'Месяц',
  year: 'Год',
};

function RevenueChart() {
  const [period, setPeriod] = useState<ChartPeriod>('week');

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-chart', period],
    queryFn: async () => {
      const res = await checksApi.getDashboardChart(period);
      return res.data;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const maxValue = useMemo(() => {
    if (!data?.points?.length) return 1;
    return Math.max(...data.points.map((p: { revenue: number }) => p.revenue), 1);
  }, [data]);

  const formatLabel = (dateStr: string): string => {
    if (period === 'year') {
      const months = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
      const parts = dateStr.split('-');
      return months[parseInt(parts[1]) - 1] || dateStr;
    }
    const d = new Date(dateStr);
    return `${d.getDate()}.${String(d.getMonth() + 1).padStart(2, '0')}`;
  };

  return (
    <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-100">
              <BarChart3 className="h-5 w-5 text-primary-600" />
            </div>
            <h3 className="text-base font-bold text-gray-900">Аналитика</h3>
          </div>
          <div className="flex rounded-lg bg-gray-100 p-0.5 self-start sm:self-auto">
            {(Object.keys(periodLabels) as ChartPeriod[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                className={`px-2.5 py-1.5 text-[11px] font-medium rounded-md transition-all ${
                  period === p ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {periodLabels[p]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="p-5">
        {/* Summary totals */}
        {data && (
          <div className="grid grid-cols-3 gap-3 mb-5">
            <div className="rounded-xl bg-green-50 p-3">
              <p className="text-[10px] font-semibold text-green-600 uppercase tracking-wider">Оборот</p>
              <p className="text-lg font-bold text-green-700 mt-0.5">{formatMoney(data.totalRevenue)}</p>
            </div>
            <div className="rounded-xl bg-blue-50 p-3">
              <p className="text-[10px] font-semibold text-blue-600 uppercase tracking-wider">Прибыль</p>
              <p className="text-lg font-bold text-blue-700 mt-0.5">{formatMoney(data.totalProfit)}</p>
            </div>
            <div className="rounded-xl bg-purple-50 p-3">
              <p className="text-[10px] font-semibold text-purple-600 uppercase tracking-wider">Чеки</p>
              <p className="text-lg font-bold text-purple-700 mt-0.5">{data.totalChecks}</p>
            </div>
          </div>
        )}

        {/* Bar chart */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-gray-300" />
          </div>
        ) : !data?.points?.length ? (
          <div className="text-center py-12 text-sm text-gray-400">Нет данных за выбранный период</div>
        ) : (
          <div className="space-y-2">
            {/* Legend */}
            <div className="flex items-center gap-4 text-[10px] text-gray-500 mb-3">
              <div className="flex items-center gap-1">
                <div className="w-2.5 h-2.5 rounded-sm bg-primary-500" />
                <span>Оборот</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-2.5 h-2.5 rounded-sm bg-emerald-500" />
                <span>Прибыль</span>
              </div>
            </div>

            {/* Bars */}
            <div className="flex items-end gap-1" style={{ height: '160px' }}>
              {data.points.map((point: { date: string; revenue: number; profit: number; checkCount: number }, idx: number) => {
                const heightPct = (point.revenue / maxValue) * 100;
                const profitPct = maxValue > 0 ? (point.profit / maxValue) * 100 : 0;
                return (
                  <div key={idx} className="flex-1 flex flex-col items-center gap-0.5 min-w-0 group relative">
                    {/* Tooltip */}
                    <div className="absolute bottom-full mb-2 hidden group-hover:block z-10">
                      <div className="bg-gray-900 text-white text-[10px] rounded-lg px-2.5 py-1.5 whitespace-nowrap shadow-lg">
                        <p className="font-semibold">{formatLabel(point.date)}</p>
                        <p>Оборот: {formatMoney(point.revenue)}</p>
                        <p>Прибыль: {formatMoney(point.profit)}</p>
                        <p>{point.checkCount} чеков</p>
                      </div>
                    </div>
                    {/* Revenue bar */}
                    <div className="w-full flex flex-col items-center justify-end" style={{ height: '140px' }}>
                      <div className="w-full flex gap-[1px] justify-center items-end" style={{ height: '100%' }}>
                        <div
                          className="flex-1 bg-primary-400 rounded-t-sm transition-all duration-300 max-w-3"
                          style={{ height: `${Math.max(heightPct, 2)}%` }}
                        />
                        <div
                          className="flex-1 bg-emerald-400 rounded-t-sm transition-all duration-300 max-w-3"
                          style={{ height: `${Math.max(profitPct, 0)}%` }}
                        />
                      </div>
                    </div>
                    {/* Label */}
                    <span className="text-[9px] text-gray-400 truncate w-full text-center">
                      {formatLabel(point.date)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Admin / Director Dashboard
// ---------------------------------------------------------------------------

function AdminDashboard() {
  const { user } = useAuth();
  const isOwner = user?.role === (UserRoleEnum.DIRECTOR as UserRole) || user?.role === (UserRoleEnum.SUPERADMIN as UserRole);

  const { data: ranking } = useQuery<EmployeeRanking>({
    queryKey: ['employee-ranking'],
    queryFn: async () => { const res = await checksApi.getRanking(); return res.data; },
    staleTime: 30_000,
    refetchInterval: 60_000,
    enabled: isOwner,
  });

  const [rankingTab, setRankingTab] = useState<'today' | 'month'>('today');

  const rankingData = rankingTab === 'today' ? (ranking?.today || []) : (ranking?.month || []);

  return (
    <div className="space-y-5">
      {/* Analytics chart on top */}
      {isOwner && <RevenueChart />}

      {/* Staff status circles */}
      <StaffStatusCircles />

      {/* Employee ranking for owner */}
      {isOwner && ranking && (
        <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100">
                  <Trophy className="h-5 w-5 text-amber-600" />
                </div>
                <h3 className="text-base font-bold text-gray-900">Рейтинг сотрудников</h3>
              </div>
              <div className="flex rounded-lg bg-gray-100 p-0.5 self-start sm:self-auto">
                <button type="button" onClick={() => setRankingTab('today')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${rankingTab === 'today' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                  Сегодня
                </button>
                <button type="button" onClick={() => setRankingTab('month')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${rankingTab === 'month' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                  За месяц
                </button>
              </div>
            </div>
          </div>
          <div className="divide-y divide-gray-50">
            {rankingData.length === 0 ? (
              <div className="p-8 text-center text-sm text-gray-400">Нет данных за выбранный период</div>
            ) : (
              rankingData.map((emp, idx) => {
                const medals = ['bg-amber-100 text-amber-600', 'bg-gray-100 text-gray-500', 'bg-orange-100 text-orange-600'];
                const medalColor = idx < 3 ? medals[idx] : 'bg-gray-50 text-gray-400';
                return (
                  <div key={emp.masterId} className="flex items-center gap-3 px-5 py-3.5 hover:bg-gray-50/50 transition-colors">
                    <div className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold flex-shrink-0 ${medalColor}`}>
                      {idx + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{emp.masterName}</p>
                      <p className="text-[11px] text-gray-400">{emp.checkCount} заказов</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-bold text-gray-900">{formatMoney(emp.revenue)}</p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
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

  const initials = user?.fullName?.split(' ').map((w) => w[0]).join('').slice(0, 2) || 'М';
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
            <p className="text-sm text-white/70">Ставка {data.salaryPercent}%</p>
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
          <p className="text-2xl font-bold text-gray-900">{data.todayChecks ?? 0}</p>
          <p className="text-[11px] text-gray-400 mt-0.5">За месяц: {data.monthChecks ?? 0}</p>
        </div>
        <div className="rounded-xl bg-white border border-gray-100 shadow-sm p-4">
          <div className="flex items-center gap-2.5 mb-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-green-50">
              <TrendingUp className="h-4 w-4 text-green-600" />
            </div>
            <span className="text-xs text-gray-400 font-medium">Сегодня</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">{formatMoney(data.today)}</p>
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const { user } = useAuth();
  const isMaster = user?.role === (UserRoleEnum.MASTER as UserRole);

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
          <p className="text-xs text-gray-400 mt-0.5">
            Обзор показателей автосервиса
          </p>
        </div>
      )}

      {/* Shift control */}
      <ShiftControl />

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
