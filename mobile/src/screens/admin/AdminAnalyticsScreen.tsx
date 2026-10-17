import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { AdminPage, AdminAmount, AdminGroup, AdminRow, AdminHeading, AdminState } from './AdminUI';
import { formatMoneyExact, formatMonthShort } from './adminShared';
import { usePlatformSession } from './usePlatformData';
import { assertPlatformSession } from './platformSession';
export default function AdminAnalyticsScreen() {
  const { session, allowed, role } = usePlatformSession();
  const revenue = useQuery({
    queryKey: ['admin-subscription-revenue', session.data.key],
    enabled: allowed && role === 'superadmin',
    queryFn: async () => {
      assertPlatformSession(session, allowed && role === 'superadmin');
      const r = await session.admin.getSubscriptionRevenue();
      assertPlatformSession(session);
      return r.data;
    },
  });
  const stats = useQuery({
    queryKey: ['admin-stats', session.data.key],
    enabled: allowed && role === 'superadmin',
    queryFn: async () => {
      assertPlatformSession(session, allowed && role === 'superadmin');
      const r = await session.tenants.getStats();
      assertPlatformSession(session);
      return r.data;
    },
  });
  const refresh = () => {
    void revenue.refetch();
    void stats.refetch();
  };
  return (
    <AdminPage
      title="Аналитика"
      subtitle="Подписки платформы"
      onRefresh={refresh}
      refreshing={revenue.isRefetching || stats.isRefetching}
    >
      <AdminAmount
        label="Выручка за этот месяц"
        value={revenue.data ? formatMoneyExact(revenue.data.paidRevenueThisMonth) : '—'}
        detail="Фактически оплаченные продления. Бесплатные периоды не входят в выручку."
      />
      <AdminState loading={revenue.isPending} error={revenue.isError} onRetry={refresh} />
      {revenue.data ? (
        <>
          <AdminGroup>
            <AdminRow label="Оплаченных продлений" value={String(revenue.data.paidExtensionsThisMonth)} />
            <AdminRow label="Бесплатных продлений" value={String(revenue.data.freeExtensionsThisMonth)} />
            <AdminRow label="Выручка за всё время" value={formatMoneyExact(revenue.data.paidRevenueTotal)} />
          </AdminGroup>
          <AdminHeading>По месяцам</AdminHeading>
          <AdminGroup>
            {revenue.data.monthly.slice(-6).map((month) => (
              <AdminRow
                key={month.month}
                label={`${formatMonthShort(month.month)} ${month.month.slice(0, 4)}`}
                value={formatMoneyExact(month.paidRevenue)}
                detail={`${month.paidCount} платных · ${month.freeCount} бесплатных`}
              />
            ))}
          </AdminGroup>
          {revenue.data.monthly.length === 0 ? <AdminState empty="История появится после первого продления." /> : null}
        </>
      ) : null}
      <AdminHeading>Состояние платформы</AdminHeading>
      <AdminState loading={stats.isPending} error={stats.isError} onRetry={refresh} />
      {stats.data ? (
        <AdminGroup>
          <AdminRow label="Клиентов всего" value={String(stats.data.totalTenants)} />
          <AdminRow label="Включённые сервисы" value={String(stats.data.activeTenants)} />
          <AdminRow label="Новых за месяц" value={String(stats.data.newTenantsThisMonth)} />
          <AdminRow label="Пользователей" value={String(stats.data.totalUsers)} />
          <AdminRow label="MRR" detail="Текущая сумма месячных тарифов" value={formatMoneyExact(stats.data.mrr)} />
        </AdminGroup>
      ) : null}
    </AdminPage>
  );
}
