import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { LayoutGrid, User as UserIcon, Car, RefreshCw, Settings2, MapPin, BadgeCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import { checksApi, usersApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import PageHeader from '../components/PageHeader';
import QueryState from '../components/QueryState';
import EmptyState from '../components/EmptyState';
import { WorkStatusPicker, columnBadgeStyle, columnDotStyle } from '../components/WorkStatusPicker';
import WorkBoardColumnsModal from '../components/WorkBoardColumnsModal';
import { PlateBadge } from '../components/checks/checkBadges';
import { ErrorRow } from '../components/dashboard/shared';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { IconButton } from '../ui/IconButton';
import { Money } from '../ui/Money';
import { Skeleton } from '../ui/Skeleton';
import { cn } from '../ui/cn';
import { focusRing } from '../ui/tokens';
import type { Check, ChecksBoard, PosSettings, User, WorkBoardColumn } from '../types';

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
  shiftModeEnabled,
}: {
  check: Check;
  columns: WorkBoardColumn[];
  canEdit: boolean;
  pending: boolean;
  onMove: (id: string, key: string) => void;
  /** Бейдж «Оплачено — выдать» показываем ТОЛЬКО при включённом режиме
   *  кассовой смены: «Выдана» — кассирская веха; на легаси-доске delivered_at
   *  пуст у всех оплаченных чеков и бейдж висел бы вечно. */
  shiftModeEnabled: boolean;
}) {
  const carLabel = check.car?.makeModel;
  const plate = check.car?.plateNumber;
  const assignees = check.assignees ?? [];

  return (
    <Card as="article" padding="sm" className="space-y-2.5" aria-label={`Заказ №${check.number}`}>
      <div className="flex items-start justify-between gap-2">
        <Link
          to={`/checks/${check.id}`}
          className={cn('rounded-sm text-sm font-semibold text-ink hover:text-accent-text', focusRing)}
        >
          Заказ №{check.number}
        </Link>
        <Money value={check.totalRevenue} className="text-sm font-semibold text-ink" />
      </div>

      <div className="flex min-w-0 items-center gap-2">
        <UserIcon className="h-3.5 w-3.5 flex-shrink-0 text-ink-4" aria-hidden="true" />
        <span className="truncate text-sm text-ink-2">{check.client?.fullName ?? 'Розничный покупатель'}</span>
      </div>

      {(carLabel || plate) && (
        <div className="flex min-w-0 items-center gap-2">
          <Car className="h-3.5 w-3.5 flex-shrink-0 text-ink-4" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-sm text-ink-2">{carLabel ?? '—'}</span>
          {plate && <PlateBadge plate={plate} />}
        </div>
      )}

      {/* Место + исполнители (Round 14, режим «Кассир») */}
      {(check.location?.name || assignees.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {check.location?.name && (
            <Badge tone="info" size="sm" icon={MapPin}>
              {check.location.name}
            </Badge>
          )}
          {assignees.slice(0, 3).map((a) => (
            <Badge key={a.id} size="sm">
              {shortName(a.fullName)}
            </Badge>
          ))}
          {assignees.length > 3 && <span className="text-2xs font-medium text-ink-3">+{assignees.length - 3}</span>}
        </div>
      )}

      {/* «Оплачено — выдать» (Round 14): заказ оплачен (не отложен), стоит на
          доске и ещё не выдан — мастеру пора отдавать машину клиенту. */}
      {shiftModeEnabled && !check.isDeferred && check.workStatus != null && !check.deliveredAt && (
        <Badge tone="ok" icon={BadgeCheck} className="w-full justify-center">
          Оплачено — выдать
        </Badge>
      )}

      {canEdit && (
        <WorkStatusPicker
          value={check.workStatus}
          columns={columns}
          disabled={pending}
          onChange={(key) => onMove(check.id, key)}
          className="w-full"
        />
      )}
    </Card>
  );
}

function BoardSkeleton() {
  return (
    <div
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
      aria-busy="true"
      aria-label="Загрузка доски"
    >
      {Array.from({ length: 4 }).map((_, col) => (
        <div key={col} className="space-y-3">
          <Skeleton className="h-9 w-full" />
          {Array.from({ length: col % 2 ? 1 : 2 }).map((__, i) => (
            <div key={i} className="space-y-2 rounded-xl border border-line bg-surface p-4 shadow-card">
              <Skeleton variant="text" className="w-1/2" />
              <Skeleton variant="text" className="w-2/3" />
              <Skeleton className="h-8 w-full" />
            </div>
          ))}
        </div>
      ))}
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
  // Значение живёт в URL (?assignee=), чтобы F5 и пересылка ссылки его держали.
  const [params, setParams] = useSearchParams();
  const assigneeFilter = params.get('assignee') ?? '';
  const setAssigneeFilter = (id: string) => {
    const next = new URLSearchParams(params);
    if (id) next.set('assignee', id);
    else next.delete('assignee');
    setParams(next, { replace: true });
  };

  const {
    data: masters,
    isError: mastersError,
    refetch: refetchMasters,
    isFetching: mastersFetching,
  } = useQuery<User[]>({
    queryKey: ['masters'],
    queryFn: async () => (await usersApi.getMasters()).data,
    staleTime: 60_000,
  });

  const { data, isLoading, isError, isFetching, refetch } = useQuery<ChecksBoard>({
    queryKey: [...BOARD_KEY, assigneeFilter || 'all'],
    queryFn: async () => (await checksApi.board(assigneeFilter ? { assigneeId: assigneeFilter } : undefined)).data,
    staleTime: 30_000,
  });

  // Режим кассовой смены (092/Round 14) — гейтит бейдж «Оплачено — выдать»
  // на карточках: вне режима выдача — не веха, бейдж не имеет смысла. При
  // ошибке запроса бейдж просто не показывается (fail-closed).
  const { data: posSettings } = useQuery<PosSettings>({
    queryKey: ['checks', 'pos-settings'],
    queryFn: async () => (await checksApi.getPosSettings()).data,
    staleTime: 60_000,
  });
  const shiftModeEnabled = !!posSettings?.shiftModeEnabled;

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

  const mastersList = masters ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Доска работ"
        icon={LayoutGrid}
        subtitle={
          isLoading
            ? 'Активные заказ-наряды по стадиям. Не влияет на оплату.'
            : `${total} на доске · стадии работ, не влияет на оплату`
        }
        actions={
          <>
            {canConfigure && (
              <Button variant="secondary" icon={Settings2} onClick={() => setSettingsOpen(true)}>
                Настроить колонки
              </Button>
            )}
            <IconButton
              label="Обновить доску"
              icon={RefreshCw}
              variant="secondary"
              loading={isFetching && !isLoading}
              onClick={() => refetch()}
            />
          </>
        }
      />

      {/* Фильтр по мастеру (Round 14): «Все» + чип на каждого сотрудника */}
      {mastersError ? (
        <ErrorRow
          message="Не удалось загрузить список сотрудников"
          onRetry={() => refetchMasters()}
          loading={mastersFetching}
        />
      ) : mastersList.length > 0 ? (
        <div
          role="group"
          aria-label="Фильтр по исполнителю"
          className="-mb-1 flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar"
        >
          <FilterChip active={!assigneeFilter} onClick={() => setAssigneeFilter('')}>
            Все
          </FilterChip>
          {mastersList.map((m) => (
            <FilterChip
              key={m.id}
              active={assigneeFilter === m.id}
              onClick={() => setAssigneeFilter(assigneeFilter === m.id ? '' : m.id)}
            >
              {shortName(m.fullName)}
            </FilterChip>
          ))}
        </div>
      ) : null}

      <QueryState
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        isFetching={isFetching}
        loader={<BoardSkeleton />}
        errorTitle="Не удалось загрузить доску"
      >
        {columns.length === 0 ? (
          <EmptyState
            icon={LayoutGrid}
            title="На доске нет колонок"
            description={
              canConfigure
                ? 'Добавьте стадии работ («Приёмка», «В работе», «Готово») — заказы будут двигаться по ним.'
                : 'Обратитесь к руководителю, чтобы настроить доску.'
            }
            action={canConfigure ? { label: 'Настроить колонки', onClick: () => setSettingsOpen(true) } : undefined}
          />
        ) : (
          <>
            {total === 0 && (
              <p className="rounded-lg border border-line bg-surface px-4 py-3 text-center text-sm text-ink-3 shadow-card">
                {assigneeFilter
                  ? 'У этого сотрудника нет заказов на доске.'
                  : 'Нет заказ-нарядов на доске. Откройте чек и нажмите «Поставить на доску».'}
              </p>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {columns.map((column) => {
                const items = data?.groups[column.key] ?? [];
                return (
                  <section key={column.id} className="flex min-w-0 flex-col" aria-labelledby={`col-${column.id}`}>
                    <div
                      className="mb-3 flex items-center gap-2 rounded-lg px-3 py-2"
                      style={columnBadgeStyle(column.color)}
                    >
                      <span
                        className="h-2 w-2 flex-shrink-0 rounded-full"
                        style={columnDotStyle(column.color)}
                        aria-hidden="true"
                      />
                      <h2 id={`col-${column.id}`} className="truncate text-sm font-semibold">
                        {column.label}
                      </h2>
                      <span className="ml-auto text-xs font-semibold tabular-nums opacity-80">{items.length}</span>
                    </div>

                    <div className="space-y-3">
                      {items.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-line-strong py-8 text-center">
                          <p className="text-xs text-ink-3">Пусто</p>
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
                            shiftModeEnabled={shiftModeEnabled}
                          />
                        ))
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          </>
        )}
      </QueryState>

      {canConfigure && <WorkBoardColumnsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'h-8 flex-shrink-0 whitespace-nowrap rounded-lg border px-3 text-xs font-medium transition-[background-color,border-color,color] duration-150',
        focusRing,
        active
          ? 'border-accent bg-accent text-white'
          : 'border-line-strong bg-surface text-ink-2 hover:bg-surface-2 hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}
