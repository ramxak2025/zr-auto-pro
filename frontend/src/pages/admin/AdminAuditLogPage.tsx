import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ChevronDown, ScrollText, User as UserIcon } from 'lucide-react';

import { adminApi } from '../../api/services';
import type { AuditLogEntry } from '../../types';
import PageHeader from '../../components/PageHeader';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { DataTable, type DataTableColumn } from '../../ui/DataTable';
import { Select } from '../../ui/Select';
import { Toolbar } from '../../ui/Toolbar';
import { formatDateRu } from '../../components/admin/adminUi';
import { auditActionLabel, auditActionTone } from '../../components/admin/auditActions';

const PAGE_SIZE = 50;

export default function AdminAuditLogPage() {
  // Фильтр по типу действия — клиентский, поверх загруженных страниц; живёт в URL.
  const [params, setParams] = useSearchParams();
  const actionFilter = params.get('action') ?? '';

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

  // В фильтре — только реально встречающиеся в журнале действия.
  const presentActions = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => set.add(r.action));
    return Array.from(set).sort((a, b) => auditActionLabel(a).localeCompare(auditActionLabel(b), 'ru'));
  }, [rows]);

  const visibleRows = actionFilter ? rows.filter((r) => r.action === actionFilter) : rows;

  const columns: DataTableColumn<AuditLogEntry>[] = [
    {
      key: 'action',
      header: 'Действие',
      render: (e) => <Badge tone={auditActionTone(e.action)}>{auditActionLabel(e.action)}</Badge>,
    },
    {
      key: 'actor',
      header: 'Кто',
      hideBelow: 'sm',
      render: (e) => (
        <span className="inline-flex items-center gap-1.5 text-ink-2">
          <UserIcon className="h-3.5 w-3.5 text-ink-4" aria-hidden="true" />
          {e.actorName || 'Система'}
        </span>
      ),
    },
    {
      key: 'target',
      header: 'Объект',
      hideBelow: 'md',
      render: (e) =>
        e.targetName || e.targetType ? (
          <span className="text-ink-2">
            {e.targetName || e.targetId}
            {e.targetType && <span className="ml-1.5 text-xs text-ink-3">({e.targetType})</span>}
          </span>
        ) : (
          <span className="text-ink-3">—</span>
        ),
    },
    {
      key: 'when',
      header: 'Когда',
      width: 170,
      render: (e) => <span className="whitespace-nowrap tabular-nums text-ink-2">{formatDateRu(e.createdAt)}</span>,
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Журнал действий"
        icon={ScrollText}
        subtitle="Операции администраторов платформы — новые сверху"
      />

      {presentActions.length > 1 && (
        <Toolbar>
          <Select
            aria-label="Действие"
            value={actionFilter}
            onChange={(e) => setParams(e.target.value ? { action: e.target.value } : {}, { replace: true })}
            className="w-64"
          >
            <option value="">Все действия</option>
            {presentActions.map((action) => (
              <option key={action} value={action}>
                {auditActionLabel(action)}
              </option>
            ))}
          </Select>
        </Toolbar>
      )}

      <DataTable
        caption="Журнал действий администраторов платформы"
        rows={visibleRows}
        rowKey={(e) => e.id}
        columns={columns}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        isFetching={isFetching && !isFetchingNextPage}
        errorTitle="Не удалось загрузить журнал"
        emptyState={
          actionFilter && rows.length > 0
            ? {
                icon: ScrollText,
                title: 'Нет записей с этим действием',
                description: 'Среди загруженных записей таких нет — снимите фильтр или догрузите историю.',
                action: { label: 'Показать все', onClick: () => setParams({}, { replace: true }) },
              }
            : {
                icon: ScrollText,
                title: 'Журнал пуст',
                description: 'Действия администраторов платформы появятся здесь',
              }
        }
      />

      {/* Догружаем историю страницами по 50 */}
      {hasNextPage && (
        <div className="flex justify-center">
          <Button variant="secondary" icon={ChevronDown} onClick={() => fetchNextPage()} loading={isFetchingNextPage}>
            Показать ещё
          </Button>
        </div>
      )}
    </div>
  );
}
