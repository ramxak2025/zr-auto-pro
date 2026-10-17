import React from 'react';
import { Pressable } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { Text } from '../../platform/Typography';
import { Icon } from '../../platform/Icon';
import { useColors } from '../../contexts/ThemeContext';
import { AdminPage, AdminAmount, AdminGroup, AdminRow, AdminHeading, AdminState, AdminAction } from './AdminUI';
import { formatMoneyExact, useAdminMode, formatDate } from './adminShared';
import ManagerCreateTenantSheet from './ManagerCreateTenantSheet';
import { usePlatformSession, usePlatformReminders } from './usePlatformData';
import { assertPlatformSession } from './platformSession';
export default function AdminOverviewScreen() {
  return useAdminMode() === 'manager' ? <ManagerToday /> : <PlatformOverview />;
}
function ReminderBell() {
  const navigation = useNavigation<any>(),
    p = useColors();
  const query = usePlatformReminders();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Напоминания${query.data ? `: ${query.data.total} к выполнению` : ''}`}
      onPress={() => navigation.navigate('AdminReminders')}
      style={{ minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' }}
    >
      <Icon name="bell" size={23} color={p.accent.primary} />
      {query.data && query.data.total > 0 ? (
        <Text variant="caption" color={p.accent.primary}>
          {query.data.total}
        </Text>
      ) : null}
    </Pressable>
  );
}
function PlatformOverview() {
  const navigation = useNavigation<any>();
  const { session, allowed, role } = usePlatformSession();
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
  const tenants = useQuery({
    queryKey: ['admin-tenants', session.data.key],
    enabled: allowed && role === 'superadmin',
    queryFn: async () => {
      assertPlatformSession(session, allowed && role === 'superadmin');
      const r = await session.tenants.getAll();
      assertPlatformSession(session);
      return r.data;
    },
  });
  const refresh = () => {
    void stats.refetch();
    void tenants.refetch();
  };
  return (
    <AdminPage
      title="Обзор"
      subtitle="Autexa · платформа"
      trailing={<ReminderBell />}
      refreshing={stats.isRefetching || tenants.isRefetching}
      onRefresh={refresh}
    >
      <AdminAmount
        label="Собрано за этот месяц"
        value={stats.data ? formatMoneyExact(stats.data.paidRevenueThisMonth) : '—'}
        detail="Оплаченные продления подписок"
      />
      <AdminState loading={stats.isPending} error={stats.isError} onRetry={refresh} />
      {stats.data ? (
        <AdminGroup>
          <AdminRow
            label="Клиенты"
            value={String(stats.data.totalTenants)}
            onPress={() => navigation.navigate('AdminTenants')}
          />
          <AdminRow
            label="Включённые сервисы"
            value={String(stats.data.activeTenants)}
            detail="Доступ включён; срок подписки учитывается отдельно"
          />
          <AdminRow label="Новые за месяц" value={String(stats.data.newTenantsThisMonth)} />
          <AdminRow
            label="Долг менеджеров"
            value={formatMoneyExact(stats.data.managersBalanceTotal)}
            onPress={() => navigation.navigate('AdminTeam')}
          />
        </AdminGroup>
      ) : null}
      <AdminGroup>
        <AdminRow
          label="Напоминания"
          detail="Подписки и запланированные контакты"
          icon="bell"
          onPress={() => navigation.navigate('AdminReminders')}
        />
        <AdminRow
          label="Аналитика"
          detail="Выручка, продления и динамика"
          icon="chart-bar"
          onPress={() => navigation.navigate('AdminAnalytics')}
        />
      </AdminGroup>
      <AdminHeading>Последние клиенты</AdminHeading>
      <AdminState
        loading={tenants.isPending}
        error={tenants.isError}
        onRetry={refresh}
        empty={tenants.data?.length === 0 ? 'Новые автосервисы появятся здесь после подключения.' : undefined}
      />
      {tenants.data && tenants.data.length > 0 ? (
        <AdminGroup>
          {[...tenants.data]
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .slice(0, 5)
            .map((t) => (
              <AdminRow
                key={t.id}
                label={t.name}
                detail={`Подключён ${formatDate(t.createdAt)}`}
                onPress={() => navigation.navigate('AdminTenantDetail', { id: t.id })}
              />
            ))}
        </AdminGroup>
      ) : null}
    </AdminPage>
  );
}
function ManagerToday() {
  const navigation = useNavigation<any>();
  const { session, allowed, role } = usePlatformSession();
  const [createOpen, setCreateOpen] = React.useState(false);
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
  const refresh = () => {
    void summary.refetch();
  };
  return (
    <AdminPage
      title="Сегодня"
      subtitle="Мои клиенты и задачи"
      trailing={<ReminderBell />}
      refreshing={summary.isRefetching}
      onRefresh={refresh}
    >
      <AdminAmount
        label="Моя доля за этот месяц"
        value={summary.data ? formatMoneyExact(summary.data.myShareThisMonth) : '—'}
        detail="По оплаченным продлениям моих клиентов"
      />
      <AdminState loading={summary.isPending} error={summary.isError} onRetry={refresh} />
      {summary.data ? (
        <AdminGroup>
          <AdminRow
            label="Мои клиенты"
            value={String(summary.data.tenants.total)}
            onPress={() => navigation.navigate('AdminTenants')}
          />
          <AdminRow label="Активные подписки" value={String(summary.data.tenants.active)} />
          <AdminRow
            label="Истекают за 7 дней"
            value={String(summary.data.tenants.expiringIn7d)}
            onPress={() => navigation.navigate('AdminReminders')}
          />
          <AdminRow label="Подписка истекла" value={String(summary.data.tenants.expired)} />
        </AdminGroup>
      ) : null}
      <AdminGroup>
        <AdminRow
          label="Напоминания"
          detail="С кем связаться и какие подписки продлить"
          icon="bell"
          onPress={() => navigation.navigate('AdminReminders')}
        />
        <AdminRow label="Доход и расчёты" icon="wallet" onPress={() => navigation.navigate('AdminIncome')} />
      </AdminGroup>
      <AdminAction label="Подключить автосервис" onPress={() => setCreateOpen(true)} />
      <ManagerCreateTenantSheet visible={createOpen} onClose={() => setCreateOpen(false)} />
    </AdminPage>
  );
}
