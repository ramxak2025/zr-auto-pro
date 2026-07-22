import { useMemo, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ScrollText, User as UserIcon, Clock, Loader2, ChevronDown } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';

import { adminApi } from '../../api/services';
import QueryState from '../../components/QueryState';
import { AdminPageHeader, Chip } from '../../components/admin/adminUi';
import { auditActionLabel, auditActionBadgeClass } from '../../components/admin/auditActions';

const PAGE_SIZE = 50;

export default function AdminAuditLogPage() {
  // Фильтр по типу действия — клиентский, поверх загруженных страниц.
  const [actionFilter, setActionFilter] = useState('');

  // GET /admin/audit-log принимает limit/offset (аддитивная пагинация; без
  // параметров backend отдаёт прежние 50) — через shared-фабрику adminApi.
  const { data, isLoading, isError, isFetching, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery({
      queryKey: ['admin-audit-log'],
      queryFn: async ({ pageParam }) => {
        const res = await adminApi.listAuditLog({ limit: PAGE_SIZE, offset: pageParam });
        return res.data;
      },
      initialPageParam: 0,
      getNextPageParam: (lastPage, allPages) =>
        lastPage.length === PAGE_SIZE ? allPages.length * PAGE_SIZE : undefined,
    });

  const rows = useMemo(() => (data?.pages ?? []).flat(), [data]);

  // Чипы — только реально встречающиеся в журнале действия.
  const presentActions = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => set.add(r.action));
    return Array.from(set);
  }, [rows]);

  const visibleRows = actionFilter ? rows.filter((r) => r.action === actionFilter) : rows;

  return (
    <div>
      <AdminPageHeader title="Журнал действий" subtitle="Операции администраторов платформы — новые сверху" />

      {presentActions.length > 1 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Chip active={actionFilter === ''} onClick={() => setActionFilter('')}>
            Все
          </Chip>
          {presentActions.map((action) => (
            <Chip
              key={action}
              active={actionFilter === action}
              onClick={() => setActionFilter(actionFilter === action ? '' : action)}
            >
              {auditActionLabel(action)}
            </Chip>
          ))}
        </div>
      )}

      <QueryState
        isLoading={isLoading}
        isError={isError}
        onRetry={refetch}
        isFetching={isFetching && !isFetchingNextPage}
        errorTitle="Не удалось загрузить журнал"
        isEmpty={rows.length === 0}
        empty={{
          icon: ScrollText,
          title: 'Журнал пуст',
          description: 'Действия администраторов платформы появятся здесь',
        }}
        minHeight="min-h-[40vh]"
      >
        {visibleRows.length === 0 ? (
          <div className="card flex flex-col items-center justify-center gap-2 py-12 text-center">
            <ScrollText className="h-8 w-8 text-gray-300" />
            <p className="text-sm text-gray-500">Нет записей с этим действием среди загруженных.</p>
          </div>
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Действие</th>
                  <th>Кто</th>
                  <th>Объект</th>
                  <th>Когда</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((entry) => {
                  const when = (() => {
                    try {
                      return format(parseISO(entry.createdAt), 'd MMM yyyy, HH:mm', { locale: ru });
                    } catch {
                      return entry.createdAt;
                    }
                  })();
                  return (
                    <tr key={entry.id}>
                      <td>
                        <span className={auditActionBadgeClass(entry.action)}>{auditActionLabel(entry.action)}</span>
                      </td>
                      <td>
                        <span className="inline-flex items-center gap-1.5 text-gray-700">
                          <UserIcon className="w-3.5 h-3.5 text-gray-400" />
                          {entry.actorName || 'Система'}
                        </span>
                      </td>
                      <td>
                        {entry.targetName || entry.targetType ? (
                          <span className="text-gray-700">
                            {entry.targetName || entry.targetId}
                            {entry.targetType && (
                              <span className="text-gray-400 ml-1.5 text-xs">({entry.targetType})</span>
                            )}
                          </span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td>
                        <span className="inline-flex items-center gap-1.5 text-gray-500 whitespace-nowrap">
                          <Clock className="w-3.5 h-3.5 text-gray-400" />
                          {when}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Пагинация: догружаем историю страницами по 50 */}
        {hasNextPage && (
          <div className="mt-4 flex justify-center">
            <button
              type="button"
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
              className="btn-secondary"
            >
              {isFetchingNextPage ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Загрузка…
                </>
              ) : (
                <>
                  <ChevronDown className="w-4 h-4" />
                  Показать ещё
                </>
              )}
            </button>
          </div>
        )}
      </QueryState>
    </div>
  );
}
