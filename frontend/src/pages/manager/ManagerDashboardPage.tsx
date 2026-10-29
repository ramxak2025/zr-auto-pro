import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { differenceInCalendarDays, parseISO } from 'date-fns';
import {
  Building2,
  CalendarClock,
  CalendarPlus,
  CheckCircle2,
  LayoutDashboard,
  PiggyBank,
  Plus,
  Scale,
  Wallet,
} from 'lucide-react';

import { managerApi } from '../../api/services';
import type { Tenant } from '../../types';
import PageHeader from '../../components/PageHeader';
import { Button, buttonClasses } from '../../ui/Button';
import { Card, CardHeader } from '../../ui/Card';
import { Skeleton } from '../../ui/Skeleton';
import { StatCard } from '../../ui/StatCard';
import { cn } from '../../ui/cn';
import { focusRing } from '../../ui/tokens';
import { pluralRu } from '../../components/knowledge/utils';
import { ErrorRow, formatDateRu, isTenantExpired } from '../../components/admin/adminUi';
import { balanceCaption, balanceTone, formatRubExact } from '../../components/admin/MoneyExact';
import { managerKeys } from '../../components/admin/managerQueryKeys';
import { formatPercent } from '../../components/admin/numberInput';
import { useManagerSummary } from '../../components/admin/useManagerSummary';

/*
 * Обзор менеджера: сколько клиентов и кто из них скоро уйдёт, деньги за месяц, моя доля
 * и долг перед владельцем платформы. Плитки — из /manager/summary, список — из своих автосервисов.
 */

const EXPIRING_DAYS = 7;

interface ExpiringRow {
  tenant: Tenant;
  endsAt: string;
  daysLeft: number;
}

/** Действующие автосервисы, у которых подписка закончится в ближайшие 7 дней: сначала самые срочные. */
function pickExpiring(tenants: Tenant[]): ExpiringRow[] {
  const rows: ExpiringRow[] = [];
  for (const tenant of tenants) {
    if (!tenant.subscriptionEnd || tenant.suspendedAt || isTenantExpired(tenant)) continue;
    const daysLeft = differenceInCalendarDays(parseISO(tenant.subscriptionEnd), new Date());
    if (daysLeft <= EXPIRING_DAYS) rows.push({ tenant, endsAt: tenant.subscriptionEnd, daysLeft });
  }
  return rows.sort((a, b) => a.daysLeft - b.daysLeft);
}

function daysLeftLabel(daysLeft: number): string {
  if (daysLeft <= 0) return 'сегодня';
  if (daysLeft === 1) return 'завтра';
  return `через ${daysLeft} ${pluralRu(daysLeft, 'день', 'дня', 'дней')}`;
}

export default function ManagerDashboardPage() {
  const navigate = useNavigate();

  const {
    data: summary,
    isLoading: summaryLoading,
    isError: summaryError,
    isFetching: summaryFetching,
    refetch: refetchSummary,
  } = useManagerSummary();

  // Ключ тот же, что у списка «Мои автосервисы» без фильтра — данные общие.
  const {
    data: tenants,
    isLoading: tenantsLoading,
    isError: tenantsError,
    isFetching: tenantsFetching,
    refetch: refetchTenants,
  } = useQuery({
    queryKey: managerKeys.tenants('all'),
    queryFn: () => managerApi.tenants(),
    select: (res) => res.data,
  });

  const expiring = useMemo(() => pickExpiring(tenants ?? []), [tenants]);

  const sharePercent = summary ? formatPercent(100 - summary.ownerSharePercent) : null;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Обзор"
        icon={LayoutDashboard}
        subtitle="Ваши автосервисы, оплаты за месяц и расчёты с владельцем"
        actions={
          <Button icon={Plus} onClick={() => navigate('/manager/tenants?new=1')}>
            Новый автосервис
          </Button>
        }
      />

      {summaryError && !summary ? (
        <ErrorRow message="Не удалось загрузить сводку" onRetry={() => refetchSummary()} loading={summaryFetching} />
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard
            compact
            label="Клиентов"
            value={summary?.tenants.total ?? '—'}
            hint={summary && summary.tenants.suspended > 0 ? `приостановлено: ${summary.tenants.suspended}` : undefined}
            icon={Building2}
            loading={summaryLoading}
            to="/manager/tenants"
          />
          <StatCard
            compact
            label="Активных"
            value={summary?.tenants.active ?? '—'}
            hint={summary && summary.tenants.expired > 0 ? `истекло: ${summary.tenants.expired}` : undefined}
            icon={CheckCircle2}
            tone="ok"
            loading={summaryLoading}
            to="/manager/tenants?status=active"
          />
          <StatCard
            compact
            label={`Истекает за ${EXPIRING_DAYS} дней`}
            value={summary?.tenants.expiringIn7d ?? '—'}
            icon={CalendarClock}
            tone={summary && summary.tenants.expiringIn7d > 0 ? 'warn' : 'neutral'}
            loading={summaryLoading}
          />
          <StatCard
            compact
            label="Оплат за месяц"
            value={summary ? formatRubExact(summary.paidThisMonth) : '—'}
            hint="платные продления"
            icon={Wallet}
            loading={summaryLoading}
          />
          <StatCard
            compact
            label={sharePercent ? `Моя доля (${sharePercent} %)` : 'Моя доля'}
            value={summary ? formatRubExact(summary.myShareThisMonth) : '—'}
            hint="за этот месяц"
            icon={PiggyBank}
            loading={summaryLoading}
          />
          <StatCard
            compact
            label="Долг владельцу"
            value={summary ? formatRubExact(summary.balance) : '—'}
            hint={summary ? balanceCaption(summary.balance, 'manager') : undefined}
            icon={Scale}
            tone={summary ? balanceTone(summary.balance) : 'neutral'}
            loading={summaryLoading}
            to="/manager/ledger"
          />
        </div>
      )}

      <Card padding="none">
        <CardHeader
          icon={CalendarClock}
          iconTone="warn"
          title="Скоро истекают"
          subtitle={`Подписка заканчивается в ближайшие ${EXPIRING_DAYS} дней`}
          actions={
            summary && summary.tenants.expired > 0 ? (
              <Link
                to="/manager/tenants?status=expired"
                className={cn('rounded text-sm font-medium text-accent-text hover:underline', focusRing)}
              >
                Истёкшие: {summary.tenants.expired}
              </Link>
            ) : undefined
          }
        />
        {tenantsLoading ? (
          <div className="space-y-3 px-5 py-4" aria-busy="true">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : tenantsError && !tenants ? (
          <div className="px-5 py-4">
            <ErrorRow
              message="Не удалось загрузить автосервисы"
              onRetry={() => refetchTenants()}
              loading={tenantsFetching}
            />
          </div>
        ) : expiring.length === 0 ? (
          <p className="px-5 py-6 text-sm text-ink-3">
            {(tenants ?? []).length === 0
              ? 'У вас пока нет автосервисов. Заведите первый — пробный доступ откроется сразу.'
              : 'В ближайшую неделю никого продлевать не нужно.'}
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {expiring.map(({ tenant, endsAt, daysLeft }) => (
              <li key={tenant.id} className="flex items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/manager/tenants/${tenant.id}`}
                    className={cn(
                      'block truncate rounded text-sm font-medium text-ink hover:text-accent-text',
                      focusRing,
                    )}
                  >
                    {tenant.name}
                  </Link>
                  <p className="text-xs tabular-nums text-ink-3">
                    до {formatDateRu(endsAt, 'd MMM yyyy')} · {daysLeftLabel(daysLeft)}
                  </p>
                </div>
                <Link
                  to={`/manager/tenants/${tenant.id}?extend=1`}
                  className={buttonClasses({ variant: 'secondary', size: 'sm' })}
                  aria-label={`Продлить подписку «${tenant.name}»`}
                >
                  <CalendarPlus className="h-3.5 w-3.5" aria-hidden="true" />
                  Продлить
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
