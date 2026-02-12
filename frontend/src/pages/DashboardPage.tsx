import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  FileText,
  CalendarDays,
  TrendingUp,
  PlusCircle,
  Search,
  AlertCircle,
  Wallet,
  BarChart3,
  Banknote,
  CreditCard,
  ShieldCheck,
  ClipboardList,
  Star,
  Trophy,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { reportsApi, salaryApi } from '../api/services';
import type { DashboardStats, SalarySummary, UserRole, EmployeeRanking } from '../types';
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
// Stat card
// ---------------------------------------------------------------------------

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string; // Tailwind bg color for the icon wrapper, e.g. "bg-blue-100"
  iconColor: string; // Tailwind text color for the icon, e.g. "text-blue-600"
}

function StatCard({ icon, label, value, color, iconColor }: StatCardProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 hover:shadow-md transition-shadow">
      <div className="flex items-center gap-3 mb-3">
        <div className={`flex items-center justify-center w-10 h-10 rounded-lg ${color}`}>
          <span className={iconColor}>{icon}</span>
        </div>
        <span className="text-sm text-gray-500">{label}</span>
      </div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
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

function AdminDashboard() {
  const { user } = useAuth();
  const isOwner = user?.role === (UserRoleEnum.OWNER as UserRole) || user?.role === (UserRoleEnum.SUPERADMIN as UserRole);

  const { data, isLoading, isError } = useQuery<DashboardStats>({
    queryKey: ['dashboard'],
    queryFn: async () => { const res = await reportsApi.getDashboard(); return res.data; },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const { data: ranking } = useQuery<EmployeeRanking>({
    queryKey: ['employee-ranking'],
    queryFn: async () => { const res = await reportsApi.getEmployeeRanking(); return res.data; },
    staleTime: 30_000,
    refetchInterval: 60_000,
    enabled: isOwner,
  });

  const [rankingTab, setRankingTab] = useState<'today' | 'month'>('today');

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)}
      </div>
    );
  }

  if (isError || !data) {
    return <ErrorBanner message="Не удалось загрузить данные дашборда" />;
  }

  const rankingData = rankingTab === 'today' ? (ranking?.today || []) : (ranking?.month || []);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={<Wallet className="h-5 w-5" />} label="Выручка сегодня" value={formatMoney(data.todayRevenue)} color="bg-green-100" iconColor="text-green-600" />
        <StatCard icon={<FileText className="h-5 w-5" />} label="Заказов сегодня" value={String(data.todayChecks)} color="bg-blue-100" iconColor="text-blue-600" />
        <StatCard icon={<CalendarDays className="h-5 w-5" />} label="Выручка за неделю" value={formatMoney(data.weekRevenue)} color="bg-purple-100" iconColor="text-purple-600" />
        <StatCard icon={<TrendingUp className="h-5 w-5" />} label="Выручка за месяц" value={formatMoney(data.monthRevenue)} color="bg-orange-100" iconColor="text-orange-600" />
      </div>

      {/* Profit cards for owner */}
      {isOwner && (
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-gradient-to-br from-emerald-500 to-emerald-700 rounded-xl p-5 text-white shadow-lg">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="h-4 w-4 text-emerald-200" />
              <span className="text-sm text-emerald-100">Прибыль сегодня</span>
            </div>
            <p className="text-2xl font-bold">{formatMoney(data.todayProfit)}</p>
          </div>
          <div className="bg-gradient-to-br from-violet-500 to-violet-700 rounded-xl p-5 text-white shadow-lg">
            <div className="flex items-center gap-2 mb-2">
              <BarChart3 className="h-4 w-4 text-violet-200" />
              <span className="text-sm text-violet-100">Прибыль за месяц</span>
            </div>
            <p className="text-2xl font-bold">{formatMoney(data.monthProfit)}</p>
          </div>
        </div>
      )}

      {/* Employee ranking for owner */}
      {isOwner && ranking && (
        <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100">
                  <Trophy className="h-5 w-5 text-amber-600" />
                </div>
                <h3 className="text-base font-bold text-gray-900">Рейтинг сотрудников</h3>
              </div>
              <div className="flex rounded-lg bg-gray-100 p-0.5">
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
      const res = await salaryApi.getMySummary();
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

  const levelPercent = Math.min(100, Math.round((data.month / 50000) * 100));
  const initials = user?.fullName?.split(' ').map((w) => w[0]).join('').slice(0, 2) || 'М';
  const greeting = getGreeting();

  // Achievement tiers
  const tier = levelPercent >= 80 ? { label: 'Эксперт', color: 'from-amber-400 to-yellow-500', star: 'text-amber-400', bg: 'bg-amber-500/20' }
    : levelPercent >= 50 ? { label: 'Профи', color: 'from-blue-400 to-indigo-500', star: 'text-blue-400', bg: 'bg-blue-500/20' }
    : levelPercent >= 25 ? { label: 'Опытный', color: 'from-emerald-400 to-teal-500', star: 'text-emerald-400', bg: 'bg-emerald-500/20' }
    : { label: 'Новичок', color: 'from-gray-400 to-slate-500', star: 'text-gray-300', bg: 'bg-white/10' };

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
          {/* Achievement badge */}
          <div className="flex flex-col items-center flex-shrink-0">
            <div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${tier.bg} backdrop-blur-sm`}>
              <Star className={`h-6 w-6 ${tier.star} fill-current`} />
            </div>
            <span className="text-[10px] font-bold text-white/80 mt-1">{tier.label}</span>
            <span className="text-[10px] text-white/50">{levelPercent}%</span>
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
