import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { LayoutGrid, User as UserIcon, Car, RefreshCw, Settings2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { checksApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import LoadingSpinner from '../components/LoadingSpinner';
import { WorkStatusPicker, columnBadgeStyle, columnDotStyle } from '../components/WorkStatusPicker';
import WorkBoardColumnsModal from '../components/WorkBoardColumnsModal';
import type { Check, ChecksBoard, WorkBoardColumn } from '../types';
import { UserRole } from '../types';
import { formatMoney } from '../../../shared/utils/formatters';

// Stable query key — invalidated by setWorkStatus mutations everywhere.
const BOARD_KEY = ['checks', 'board'] as const;

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
  const { hasPermission, isRole } = useAuth();
  const canEdit = hasPermission('checks_edit');
  const canConfigure = isRole(UserRole.DIRECTOR, UserRole.ADMIN, UserRole.SUPERADMIN);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const { data, isLoading, isError, isFetching, refetch } = useQuery<ChecksBoard>({
    queryKey: BOARD_KEY,
    queryFn: async () => (await checksApi.board()).data,
    staleTime: 30_000,
  });

  const columns = useMemo(() => (data?.columns ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder), [data]);

  const moveMutation = useMutation({
    mutationFn: ({ id, key }: { id: string; key: string }) => checksApi.setWorkStatus(id, key),
    onSuccess: (_res, { key }) => {
      queryClient.invalidateQueries({ queryKey: ['checks'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      const label = columns.find((c) => c.key === key)?.label ?? key;
      toast.success(`Перемещено: ${label}`);
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message ?? 'Не удалось изменить статус');
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
      <div className="page-header">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50">
            <LayoutGrid className="h-5 w-5 text-primary-600" />
          </div>
          <div className="min-w-0">
            <h1 className="page-title">Доска работ</h1>
            <p className="text-sm text-gray-400 mt-0.5">Активные заказ-наряды по стадиям. Не влияет на оплату.</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {canConfigure && (
            <button onClick={() => setSettingsOpen(true)} className="btn-ghost btn-sm" title="Настроить колонки">
              <Settings2 className="h-4 w-4" />
              <span className="hidden sm:inline">Настроить колонки</span>
            </button>
          )}
          <button onClick={() => refetch()} disabled={isFetching} className="btn-ghost btn-sm" title="Обновить">
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Обновить</span>
          </button>
        </div>
      </div>

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
                        <p className="text-xs text-gray-400">Пусто</p>
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
