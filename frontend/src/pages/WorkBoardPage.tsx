import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { LayoutGrid, User as UserIcon, Car, RefreshCw, Settings2, MapPin, BadgeCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import { checksApi, usersApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import LoadingSpinner from '../components/LoadingSpinner';
import PageHeader from '../components/PageHeader';
import { WorkStatusPicker, columnBadgeStyle, columnDotStyle } from '../components/WorkStatusPicker';
import WorkBoardColumnsModal from '../components/WorkBoardColumnsModal';
import type { Check, ChecksBoard, User, WorkBoardColumn } from '../types';

import { formatMoney } from '../../../shared/utils/formatters';

// Stable query key — invalidated by setWorkStatus mutations everywhere.
// Фильтр по исполнителю (Round 14) добавляется суффиксом — префикс совпадает,
// так что существующие инвалидации ['checks'] / BOARD_KEY накрывают все варианты.
const BOARD_KEY = ['checks', 'board'] as const;

/** «Иванов Иван Иванович» → «Иванов И.» — компактно на карточке доски. */
function shortName(fullName: string | null): string {
  if (!fullName) return '—';
  const [last, first] = fullName.trim().split(/\s+/);
  return first ? `${last} ${first[0]}.` : last;
}

function CheckCard({
  check,
  columns,
  canEdit,
  pending,
  onMove,
}: {
  check: Check;
  columns: WorkBoardColumn[];
  canEdit: boolean;
  pending: boolean;
  onMove: (id: string, key: string) => void;
}) {
  const carLabel = check.car?.makeModel;
  const plate = check.car?.plateNumber;

  return (
    <div className="card p-3.5 space-y-2.5">
      {/* Header: number + total */}
      <div className="flex items-start justify-between gap-2">
        <Link
          to={`/checks/${check.id}`}
          className="text-sm font-bold text-gray-900 hover:text-primary-600 transition-colors"
        >
          Заказ #{check.number}
        </Link>
        <span className="text-sm font-bold text-primary-600 whitespace-nowrap">{formatMoney(check.totalRevenue)}</span>
      </div>

      {/* Client */}
      <div className="flex items-center gap-2 min-w-0">
        <UserIcon className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
        <span className="text-sm text-gray-700 truncate">{check.client?.fullName ?? 'Розничный покупатель'}</span>
      </div>

      {/* Car */}
      {(carLabel || plate) && (
        <div className="flex items-center gap-2 min-w-0">
          <Car className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
          <span className="text-sm text-gray-500 truncate">{carLabel ?? '—'}</span>
          {plate && (
            <span className="ml-auto text-[11px] font-semibold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded-md whitespace-nowrap">
              {plate}
            </span>
          )}
        </div>
      )}

      {/* Место + исполнители (Round 14, режим «Кассир») */}
      {(check.location?.name || (check.assignees?.length ?? 0) > 0) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {check.location?.name && (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-700 bg-sky-50 px-1.5 py-0.5 rounded-md">
              <MapPin className="h-3 w-3 flex-shrink-0" />
              {check.location.name}
            </span>
          )}
          {(check.assignees ?? []).slice(0, 3).map((a) => (
            <span key={a.id} className="text-[11px] font-medium text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded-md">
              {shortName(a.fullName)}
            </span>
          ))}
          {(check.assignees?.length ?? 0) > 3 && (
            <span className="text-[11px] font-medium text-gray-400">+{(check.assignees?.length ?? 0) - 3}</span>
          )}
        </div>
      )}

      {/* «Оплачено — выдать» (Round 14): заказ оплачен (не отложен), стоит на
          доске и ещё не выдан — мастеру пора отдавать машину клиенту. */}
      {!check.isDeferred && check.workStatus != null && !check.deliveredAt && (
        <div className="flex items-center gap-1.5 rounded-lg bg-green-50 border border-green-200 px-2 py-1">
          <BadgeCheck className="h-3.5 w-3.5 text-green-600 flex-shrink-0" />
          <span className="text-[11px] font-bold uppercase tracking-wide text-green-700">Оплачено — выдать</span>
        </div>
      )}

      {/* Move control */}
      {canEdit && (
        <WorkStatusPicker
          value={check.workStatus}
          columns={columns}
          disabled={pending}
          onChange={(key) => onMove(check.id, key)}
          className="w-full mt-1"
        />
      )}
    </div>
  );
}

export default function WorkBoardPage() {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const canEdit = hasPermission('checks_edit');
  // Настройка колонок доски — ключ checks_board_manage (backend CRUD
  // /checks/board-columns; волна Битрикс24).
  const canConfigure = hasPermission('checks_board_manage');
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Round 14: фильтр «машины конкретного мастера» — ?assigneeId= в board-запрос
  // (сервер матчит check_assignees ∪ главный мастер ∪ исполнители строк услуг).
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const { data: masters } = useQuery<User[]>({
    queryKey: ['masters'],
    queryFn: async () => (await usersApi.getMasters()).data,
    staleTime: 60_000,
  });

  const { data, isLoading, isError, isFetching, refetch } = useQuery<ChecksBoard>({
    queryKey: [...BOARD_KEY, assigneeFilter || 'all'],
    queryFn: async () => (await checksApi.board(assigneeFilter ? { assigneeId: assigneeFilter } : undefined)).data,
    staleTime: 30_000,
  });

  const columns = useMemo(() => (data?.columns ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder), [data]);

  const moveMutation = useMutation({
    mutationFn: ({ id, key }: { id: string; key: string }) => checksApi.setWorkStatus(id, key),
    // Optimistic: карточка сразу перелетает в целевую колонку. Если сервер
    // отказал (главный случай — 400 «Заказ не оплачен» при переводе
    // отложенного заказа в «Выдана»), снимок возвращается — карточка
    // НЕ двигается, а тост объясняет почему.
    onMutate: async ({ id, key }) => {
      await queryClient.cancelQueries({ queryKey: BOARD_KEY });
      const snapshots = queryClient.getQueriesData<ChecksBoard>({ queryKey: BOARD_KEY });
      for (const [qk, board] of snapshots) {
        if (!board) continue;
        let moved: Check | undefined;
        const groups: Record<string, Check[]> = {};
        for (const [colKey, items] of Object.entries(board.groups)) {
          groups[colKey] = items.filter((c) => {
            if (c.id === id) {
              moved = c;
              return false;
            }
            return true;
          });
        }
        if (!moved) continue;
        groups[key] = [{ ...moved, workStatus: key }, ...(groups[key] ?? [])];
        queryClient.setQueryData(qk, { ...board, groups });
      }
      return { snapshots };
    },
    onError: (err: any, _vars, ctx) => {
      ctx?.snapshots?.forEach(([qk, board]) => queryClient.setQueryData(qk, board));
      const msg = err?.response?.data?.message;
      toast.error(
        err?.response?.status === 400 && msg === 'Заказ не оплачен'
          ? 'Заказ не оплачен — выдать можно только после приёма оплаты кассиром'
          : (msg ?? 'Не удалось изменить статус'),
      );
    },
    onSuccess: (_res, { key }) => {
      const label = columns.find((c) => c.key === key)?.label ?? key;
      toast.success(`Перемещено: ${label}`);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['checks'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  const handleMove = (id: string, key: string) => {
    moveMutation.mutate({ id, key });
  };

  const total = useMemo(() => {
    if (!data) return 0;
    return columns.reduce((sum, c) => sum + (data.groups[c.key]?.length ?? 0), 0);
  }, [data, columns]);

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="space-y-5 pb-6">
      {/* Header */}
      <PageHeader
        title="Доска работ"
        icon={LayoutGrid}
        subtitle="Активные заказ-наряды по стадиям. Не влияет на оплату."
        actions={
          <>
            {canConfigure && (
              <button
                onClick={() => setSettingsOpen(true)}
                className="btn-ghost btn-sm"
                title="Настроить колонки"
                aria-label="Настроить колонки"
              >
                <Settings2 className="h-4 w-4" />
                <span className="hidden sm:inline">Настроить колонки</span>
              </button>
            )}
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="btn-ghost btn-sm"
              title="Обновить"
              aria-label="Обновить"
            >
              <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Обновить</span>
            </button>
          </>
        }
      />

      {/* Фильтр по мастеру (Round 14): «Все» + чип на каждого сотрудника */}
      {(masters ?? []).length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 -mb-1">
          <button
            type="button"
            onClick={() => setAssigneeFilter('')}
            className={`flex-shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
              !assigneeFilter ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Все
          </button>
          {(masters ?? []).map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setAssigneeFilter(assigneeFilter === m.id ? '' : m.id)}
              className={`flex-shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                assigneeFilter === m.id ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {shortName(m.fullName)}
            </button>
          ))}
        </div>
      )}

      {isError ? (
        <div className="card card-body text-center">
          <p className="text-sm text-gray-500">Не удалось загрузить доску.</p>
          <button onClick={() => refetch()} className="btn-secondary mt-3 mx-auto">
            Повторить
          </button>
        </div>
      ) : columns.length === 0 ? (
        <div className="card card-body text-center">
          <p className="text-sm text-gray-500">
            На доске нет колонок.
            {canConfigure
              ? ' Нажмите «Настроить колонки», чтобы добавить стадии.'
              : ' Обратитесь к руководителю, чтобы настроить доску.'}
          </p>
          {canConfigure && (
            <button onClick={() => setSettingsOpen(true)} className="btn-primary mt-3 mx-auto">
              <Settings2 className="h-4 w-4" />
              Настроить колонки
            </button>
          )}
        </div>
      ) : (
        <>
          {total === 0 && (
            <div className="card card-body text-center">
              <p className="text-sm text-gray-500">
                Нет заказ-нарядов на доске. Откройте чек и нажмите «Поставить на доску».
              </p>
            </div>
          )}

          {/* Columns */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {columns.map((column) => {
              const items = data?.groups[column.key] ?? [];
              return (
                <div key={column.id} className="flex flex-col min-w-0">
                  {/* Column header */}
                  <div
                    className="flex items-center gap-2 rounded-xl px-3 py-2 mb-3"
                    style={columnBadgeStyle(column.color)}
                  >
                    <span className="h-2 w-2 rounded-full" style={columnDotStyle(column.color)} />
                    <span className="text-sm font-semibold">{column.label}</span>
                    <span className="ml-auto text-xs font-bold tabular-nums opacity-70">{items.length}</span>
                  </div>

                  {/* Cards */}
                  <div className="space-y-3">
                    {items.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-gray-200 py-8 text-center">
                        <p className="text-xs text-gray-500">Пусто</p>
                      </div>
                    ) : (
                      items.map((check) => (
                        <CheckCard
                          key={check.id}
                          check={check}
                          columns={columns}
                          canEdit={canEdit}
                          pending={moveMutation.isPending && moveMutation.variables?.id === check.id}
                          onMove={handleMove}
                        />
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {canConfigure && <WorkBoardColumnsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
