import React from 'react';
import { useNavigation } from '@react-navigation/native';
import { AdminPage, AdminGroup, AdminRow, AdminState, AdminAction } from './AdminUI';
import { formatDateTime } from './adminShared';
import { usePlatformReminders } from './usePlatformData';
export default function AdminRemindersScreen() {
  const navigation = useNavigation<any>();
  const query = usePlatformReminders();
  return (
    <AdminPage
      title="Напоминания"
      subtitle={query.data ? `${query.data.total} к выполнению` : 'Подписки и контакты'}
      back
      onRefresh={() => void query.refetch()}
      refreshing={query.isRefetching}
    >
      <AdminAction label="Настроить напоминания" onPress={() => navigation.navigate('AdminReminderSettings')} />
      <AdminState
        loading={query.isPending}
        error={query.isError}
        onRetry={() => void query.refetch()}
        empty={
          query.data?.total === 0
            ? 'На сегодня всё. Напоминания о подписках и запланированных контактах появятся здесь.'
            : undefined
        }
      />
      {query.data && query.data.items.length > 0 ? (
        <AdminGroup>
          {query.data.items.map((item) => (
            <AdminRow
              key={item.id}
              label={item.tenantName}
              icon={item.kind === 'follow_up' ? 'phone' : 'calendar'}
              detail={
                item.kind === 'follow_up'
                  ? `Связаться · ${formatDateTime(item.dueAt)}`
                  : `Подписка ${item.daysRemaining < 0 ? 'истекла' : item.daysRemaining === 0 ? 'истекает сегодня' : `истекает через ${item.daysRemaining} дн.`} · ${formatDateTime(item.dueAt)}`
              }
              onPress={() => navigation.navigate('AdminTenantDetail', { id: item.tenantId })}
            />
          ))}
        </AdminGroup>
      ) : null}
    </AdminPage>
  );
}
