import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  FileText,
  CalendarDays,
  TrendingUp,
  Users,
  PlusCircle,
  Search,
  Loader2,
  AlertCircle,
  Wallet,
  BarChart3,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { reportsApi, salaryApi } from '../api/services';
import type { DashboardStats, SalarySummary, UserRole } from '../types';
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
  const { data, isLoading, isError } = useQuery<DashboardStats>({
    queryKey: ['dashboard'],
    queryFn: async () => {
      const res = await reportsApi.getDashboard();
      return res.data;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <StatCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (isError || !data) {
    return <ErrorBanner message="Не удалось загрузить данные дашборда" />;
  }

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <StatCard
        icon={<Wallet className="h-5 w-5" />}
        label="Выручка сегодня"
        value={formatMoney(data.todayRevenue)}
        color="bg-green-100"
        iconColor="text-green-600"
      />
      <StatCard
        icon={<FileText className="h-5 w-5" />}
        label="Заказов сегодня"
        value={String(data.todayChecks)}
        color="bg-blue-100"
        iconColor="text-blue-600"
      />
      <StatCard
        icon={<CalendarDays className="h-5 w-5" />}
        label="Выручка за неделю"
        value={formatMoney(data.weekRevenue)}
        color="bg-purple-100"
        iconColor="text-purple-600"
      />
      <StatCard
        icon={<TrendingUp className="h-5 w-5" />}
        label="Выручка за месяц"
        value={formatMoney(data.monthRevenue)}
        color="bg-orange-100"
        iconColor="text-orange-600"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Master salary summary
// ---------------------------------------------------------------------------

function MasterDashboard() {
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
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <StatCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (isError || !data) {
    return <ErrorBanner message="Не удалось загрузить данные по зарплате" />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Users className="h-4 w-4" />
        <span>
          Ставка: <strong className="text-gray-700">{data.salaryPercent}%</strong> от выручки по услугам
        </span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<Wallet className="h-5 w-5" />}
          label="Заработок сегодня"
          value={formatMoney(data.today)}
          color="bg-green-100"
          iconColor="text-green-600"
        />
        <StatCard
          icon={<CalendarDays className="h-5 w-5" />}
          label="За неделю"
          value={formatMoney(data.week)}
          color="bg-blue-100"
          iconColor="text-blue-600"
        />
        <StatCard
          icon={<TrendingUp className="h-5 w-5" />}
          label="За месяц"
          value={formatMoney(data.month)}
          color="bg-purple-100"
          iconColor="text-purple-600"
        />
        <StatCard
          icon={<BarChart3 className="h-5 w-5" />}
          label="Всего"
          value={formatMoney(data.total)}
          color="bg-orange-100"
          iconColor="text-orange-600"
        />
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
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          {greeting}, {displayName}!
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          {isMaster ? 'Ваша сводка по заработку' : 'Обзор показателей автосервиса'}
        </p>
      </div>

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
