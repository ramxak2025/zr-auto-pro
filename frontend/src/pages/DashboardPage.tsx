import { Link } from 'react-router-dom';
import { BarChart3, FileText, Search } from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { useAuth } from '../contexts/AuthContext';
import { useTenantCalendar, useTenantTimezone } from '../hooks/useTenantTimezone';
import { getGreeting } from '../../../shared/utils/formatters';
import type { UserPermissions, UserRole } from '../types';
import { UserRole as UserRoleEnum } from '../types';
import PageHeader from '../components/PageHeader';
import InstallmentsWidget from '../components/InstallmentsWidget';
import { buttonClasses } from '../ui/Button';
import KpiStrip from '../components/dashboard/KpiStrip';
import RevenueChart from '../components/dashboard/RevenueChart';
import StaffTodayCard from '../components/dashboard/StaffTodayCard';
import NetProfitCard from '../components/dashboard/NetProfitCard';
import DeferredChecksCard from '../components/dashboard/DeferredChecksCard';
import ShiftControl from '../components/dashboard/ShiftControl';
import MasterDashboard from '../components/dashboard/MasterDashboard';
import CallsWidget from '../components/dashboard/CallsWidget';
import CallFunnelWidget from '../components/dashboard/CallFunnelWidget';
import { dayKeyToDate } from '../components/dashboard/shared';

// ---------------------------------------------------------------------------
// Быстрые переходы в шапке. «Новый чек» не дублируем: на десктопе он живёт в
// верхней панели оболочки, на телефоне — центральная кнопка нижнего бара.
// ---------------------------------------------------------------------------

interface QuickLink {
  label: string;
  to: string;
  icon: typeof Search;
  permission?: keyof UserPermissions;
}

const quickLinks: QuickLink[] = [
  { label: 'Найти клиента', to: '/clients', icon: Search, permission: 'clients_view' },
  { label: 'Журнал', to: '/checks', icon: FileText, permission: 'checks_view' },
  { label: 'Отчёты', to: '/reports', icon: BarChart3, permission: 'financial_reports' },
];

function QuickLinks() {
  const { hasPermission } = useAuth();
  const visible = quickLinks.filter((a) => !a.permission || hasPermission(a.permission));
  if (visible.length === 0) return null;
  return (
    <>
      {visible.map((a) => {
        const Icon = a.icon;
        return (
          <Link key={a.to} to={a.to} className={buttonClasses({ variant: 'secondary' })}>
            <Icon className="h-4 w-4" aria-hidden="true" />
            {a.label}
          </Link>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Панель владельца / администратора
// ---------------------------------------------------------------------------

function AdminDashboard() {
  const { hasPermission } = useAuth();
  // Финансовый дашборд (net profit, графики, рассрочка) — по ключу
  // financial_reports (backend /reports/dashboard-v2 гейтится им же; волна
  // Битрикс24). Без права — только ростер сотрудников.
  const canSeeFinance = hasPermission('financial_reports');
  // Чистая прибыль — отдельный ключ profit_view: держатель financial_reports
  // без profit_view видит аналитику (оборот/чеки), но не карту прибыли.
  const canSeeProfit = hasPermission('profit_view');
  const canSeeCalls = hasPermission('calls_view');

  if (!canSeeFinance) {
    return (
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3 xl:items-start">
        <div className="space-y-5 xl:col-span-2">
          <StaffTodayCard />
          <DeferredChecksCard />
        </div>
        {canSeeCalls && (
          <div className="space-y-5">
            <CallFunnelWidget />
            <CallsWidget />
          </div>
        )}
      </div>
    );
  }

  // Владелец/директор: KPI-полоса, слева — динамика и люди, справа — деньги и звонки.
  return (
    <div className="space-y-5">
      <KpiStrip />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3 xl:items-start">
        <div className="space-y-5 xl:col-span-2">
          <RevenueChart />
          <StaffTodayCard />
          <DeferredChecksCard />
        </div>
        <div className="space-y-5">
          {canSeeProfit && <NetProfitCard />}
          {canSeeCalls && <CallFunnelWidget />}
          <InstallmentsWidget />
          {canSeeCalls && <CallsWidget />}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Страница
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const { user } = useAuth();
  // Приветствие и дата — по времени АВТОСЕРВИСА (157), а не машины владельца.
  const tenantTz = useTenantTimezone();
  const { today } = useTenantCalendar();
  const isMaster = user?.role === (UserRoleEnum.MASTER as UserRole);
  const isOwner =
    user?.role === (UserRoleEnum.DIRECTOR as UserRole) || user?.role === (UserRoleEnum.SUPERADMIN as UserRole);
  const attendanceMode = user?.tenant?.attendanceMode ?? (user?.tenant?.shiftsEnabled ? 'manual' : 'admin');

  const greeting = getGreeting(tenantTz);
  const displayName = user?.fullName?.split(' ')[0] || user?.username || '';
  const todayLabel = format(dayKeyToDate(today), 'EEEE, d MMMM', { locale: ru });

  return (
    <div className="space-y-5">
      <PageHeader
        title={displayName ? `${greeting}, ${displayName}` : greeting}
        subtitle={`${todayLabel.charAt(0).toUpperCase()}${todayLabel.slice(1)} · обзор автосервиса`}
        actions={!isMaster ? <QuickLinks /> : undefined}
      />

      {/* Смена — сотрудникам; владельцу/директору не показывается */}
      {!isOwner && attendanceMode === 'manual' && <ShiftControl />}

      {isMaster ? (
        <>
          <MasterDashboard />
          <DeferredChecksCard />
        </>
      ) : (
        <AdminDashboard />
      )}
    </div>
  );
}
