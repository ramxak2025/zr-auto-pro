import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { AdminPage, AdminAmount, AdminGroup, AdminRow, AdminHeading, AdminState } from './AdminUI';
import { formatMoneyExact, formatMonthShort, balanceCaption } from './adminShared';
import { usePlatformSession } from './usePlatformData';
import { assertPlatformSession } from './platformSession';
export default function AdminIncomeScreen() {
  const navigation = useNavigation<any>();
  const { session, allowed, role } = usePlatformSession();
  const summary = useQuery({
    queryKey: ['manager', 'summary', session.data.key],
    enabled: allowed && role === 'manager',
    queryFn: async () => {
      assertPlatformSession(session, allowed && role === 'manager');
      const r = await session.manager.summary();
      assertPlatformSession(session);
      return r.data;
    },
  });
  const analytics = useQuery({
    queryKey: ['manager', 'analytics', session.data.key],
    enabled: allowed && role === 'manager',
    queryFn: async () => {
      assertPlatformSession(session, allowed && role === 'manager');
      const r = await session.manager.analytics();
      assertPlatformSession(session);
      return r.data;
    },
  });
  const refresh = () => {
    void summary.refetch();
    void analytics.refetch();
  };
  return (
    <AdminPage
      title="Доход"
      subtitle="Мои оплаты и доли"
      refreshing={summary.isRefetching || analytics.isRefetching}
      onRefresh={refresh}
    >
      <AdminAmount
        label="Моя доля за этот месяц"
        value={summary.data ? formatMoneyExact(summary.data.myShareThisMonth) : '—'}
        detail="Доля зафиксирована в момент каждого оплаченного продления"
      />
      <AdminState loading={summary.isPending} error={summary.isError} onRetry={refresh} />
      {summary.data ? (
        <AdminGroup>
          <AdminRow label="Оплачено за месяц" value={formatMoneyExact(summary.data.paidThisMonth)} />
          <AdminRow label="Доля владельца за месяц" value={formatMoneyExact(summary.data.ownerShareThisMonth)} />
          <AdminRow
            label="Расчёты с владельцем"
            detail={balanceCaption(summary.data.balance)}
            value={formatMoneyExact(summary.data.balance)}
            onPress={() => navigation.navigate('ManagerLedger')}
          />
        </AdminGroup>
      ) : null}
      <AdminHeading>Последние 6 месяцев</AdminHeading>
      <AdminState loading={analytics.isPending} error={analytics.isError} onRetry={refresh} />
      {analytics.data ? (
        <AdminGroup>
          {analytics.data.monthly.map((month) => (
            <AdminRow
              key={month.month}
              label={`${formatMonthShort(month.month)} ${month.month.slice(0, 4)}`}
              value={formatMoneyExact(month.myShare)}
              detail={`Оплаты ${formatMoneyExact(month.paidRevenue)} · владельцу ${formatMoneyExact(month.ownerShare)}`}
            />
          ))}
        </AdminGroup>
      ) : null}
      <AdminGroup>
        <AdminRow
          label="Оплаты и расчёты"
          detail="Подробная история операций"
          icon="receipt"
          onPress={() => navigation.navigate('ManagerLedger')}
        />
      </AdminGroup>
    </AdminPage>
  );
}
