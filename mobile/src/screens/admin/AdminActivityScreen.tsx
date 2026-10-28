import React from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { AdminPage, AdminGroup, AdminRow, AdminState, AdminAction } from './AdminUI';
import { usePlatformSession } from './usePlatformData';
import { assertPlatformSession } from './platformSession';
import { actionLabel } from './auditActions';
import { formatDateTime } from './adminShared';
export default function AdminActivityScreen() {
  const { session, allowed, role } = usePlatformSession();
  const query = useInfiniteQuery({
    queryKey: ['manager', 'operator-audit', session.data.key, session.data.generation],
    enabled: allowed,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      assertPlatformSession(session, allowed);
      const params = { limit: 30, offset: pageParam };
      const r = role === 'manager' ? await session.manager.auditLog(params) : await session.admin.listAuditLog(params);
      assertPlatformSession(session, allowed);
      return r.data;
    },
    getNextPageParam: (last, pages) => (last.length === 30 ? pages.length * 30 : undefined),
  });
  return (
    <AdminPage
      composition="navigation"
      title="Журнал действий"
      subtitle={role === 'manager' ? 'Мои действия' : 'Действия на платформе'}
      back
      onRefresh={() => {
        if (allowed) void query.refetch();
      }}
      refreshing={query.isRefetching}
    >
      <AdminState
        loading={query.isPending}
        error={query.isError}
        onRetry={() => {
          if (allowed) void query.refetch();
        }}
        empty={query.data?.pages[0].length === 0 ? 'Записи появятся после действий с клиентами.' : undefined}
      />
      {query.data ? (
        <AdminGroup>
          {query.data.pages.flat().map((entry) => (
            <AdminRow
              key={entry.id}
              label={actionLabel(entry.action)}
              detail={`${entry.targetName || ''} · ${entry.actorName || 'Система'} · ${formatDateTime(entry.createdAt)}`}
            />
          ))}
        </AdminGroup>
      ) : null}
      {query.hasNextPage ? (
        <AdminAction
          label="Показать ещё"
          disabled={query.isFetchingNextPage}
          onPress={() => void query.fetchNextPage()}
        />
      ) : null}
    </AdminPage>
  );
}
