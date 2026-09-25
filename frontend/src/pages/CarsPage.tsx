import { useState, type MouseEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Car, Pencil } from 'lucide-react';
import toast from 'react-hot-toast';
import { carsApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import { useTenantTimezone } from '../hooks/useTenantTimezone';
import { useVinEnabled } from '../hooks/useVinEnabled';
import SearchInput from '../components/SearchInput';
import Pagination from '../components/Pagination';
import PageHeader from '../components/PageHeader';
import CarFormModal, { EMPTY_CAR_FORM, type CarFormValues } from '../components/clients/CarFormModal';
import { VinLine, carVin, vinDuplicateError, type VinDuplicateInfo } from '../components/vin';
import { Badge } from '../ui/Badge';
import { DataTable, type DataTableColumn } from '../ui/DataTable';
import { IconButton } from '../ui/IconButton';
import { Toolbar } from '../ui/Toolbar';
import { Car as CarType, PaginatedResponse } from '../types';
import type { UpdateCarRequest } from '../../../shared/api/types';
import { formatPhone } from '../../../shared/validation/phone';
import { formatDateShort } from '../../../shared/utils/formatters';
import { apiErrorMessage } from '../../../shared/utils/apiError';

const LIMIT = 20;

export default function CarsPage() {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const timeZone = useTenantTimezone();
  const vinEnabled = useVinEnabled();
  // Правка машины (госномер / марка / VIN / комментарий) — тот же ключ, что и
  // правка карточки клиента; создание авто по-прежнему из карточки клиента.
  const canEdit = hasPermission('clients_edit');

  // Поиск и страница — в URL: возврат из карточки клиента не сбрасывает поиск.
  const [params, setParams] = useSearchParams();
  const search = params.get('q') ?? '';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const limit = LIMIT;
  const updateParams = (next: { q?: string; page?: number }) => {
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        const q = next.q ?? search;
        const pg = next.page ?? page;
        if (q) p.set('q', q);
        else p.delete('q');
        if (pg > 1) p.set('page', String(pg));
        else p.delete('page');
        return p;
      },
      { replace: true },
    );
  };

  const { data, isLoading, isError, refetch, isFetching } = useQuery<PaginatedResponse<CarType>>({
    queryKey: ['cars', { search, page, limit }],
    queryFn: async () => {
      const res = await carsApi.getAll({ search, page, limit });
      return res.data;
    },
  });

  // ── Редактирование машины (общая форма с карточкой клиента) ─────────────
  const [editingCar, setEditingCar] = useState<CarType | null>(null);
  const [vinError, setVinError] = useState<VinDuplicateInfo | null>(null);

  const updateMutation = useMutation({
    mutationFn: ({ carId, payload }: { carId: string; payload: UpdateCarRequest }) => carsApi.update(carId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cars'] });
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      toast.success('Автомобиль обновлён');
      setEditingCar(null);
    },
    onError: (err) => {
      // 409 VIN_DUPLICATE — под полем VIN с именем клиента, форму не закрываем.
      const dup = vinDuplicateError(err);
      if (dup) {
        setVinError(dup);
        return;
      }
      toast.error(apiErrorMessage(err) ?? 'Ошибка при обновлении автомобиля');
    },
  });

  const openEdit = (car: CarType, e?: MouseEvent) => {
    e?.stopPropagation();
    setVinError(null);
    setEditingCar(car);
  };

  const submitEdit = (values: CarFormValues) => {
    if (!editingCar) return;
    setVinError(null);
    const payload: UpdateCarRequest = {
      plateNumber: values.plateNumber,
      makeModel: values.makeModel,
      comment: values.comment || undefined,
    };
    // VIN уходит только при включённой опции; пустая строка = очистить.
    if (vinEnabled) payload.vin = values.vin || null;
    updateMutation.mutate({ carId: editingCar.id, payload });
  };

  const cars = data?.data || [];
  const total = data?.total || 0;

  const columns: DataTableColumn<CarType>[] = [
    {
      key: 'plateNumber',
      header: 'Госномер',
      primary: true,
      sortable: true,
      sortValue: (c) => c.plateNumber,
      render: (c) => (
        <span className="min-w-0">
          <span className="flex items-center gap-2">
            <Car className="h-4 w-4 flex-shrink-0 text-ink-4" aria-hidden="true" />
            {c.plateNumber ? (
              <span className="whitespace-nowrap font-semibold tabular-nums tracking-wide">{c.plateNumber}</span>
            ) : (
              <Badge outline size="sm">
                Без номера
              </Badge>
            )}
          </span>
          {/* На узких экранах марка и владелец — под номером (колонки скрыты). */}
          <span className="mt-0.5 block truncate pl-6 text-xs font-normal text-ink-3 md:hidden">
            {c.makeModel}
            {c.client?.fullName ? ` · ${c.client.fullName}` : ''}
          </span>
        </span>
      ),
    },
    {
      key: 'makeModel',
      header: 'Марка и модель',
      hideBelow: 'md',
      sortable: true,
      sortValue: (c) => c.makeModel,
      render: (c) => {
        const vin = vinEnabled ? carVin(c) : null;
        return (
          <span className="min-w-0">
            <span className="block truncate text-ink">{c.makeModel}</span>
            {/* VIN под маркой там, где отдельная колонка VIN не помещается. */}
            {vin && (
              <span className="mt-0.5 block lg:hidden">
                <VinLine vin={vin} />
              </span>
            )}
          </span>
        );
      },
    },
    ...(vinEnabled
      ? [
          {
            key: 'vin',
            header: 'VIN',
            hideBelow: 'lg',
            width: 236,
            render: (c: CarType) => {
              const vin = carVin(c);
              return vin ? <VinLine vin={vin} /> : <span className="text-ink-4">—</span>;
            },
          } satisfies DataTableColumn<CarType>,
        ]
      : []),
    {
      key: 'owner',
      header: 'Владелец',
      hideBelow: 'md',
      render: (c) =>
        c.client ? (
          <span className="min-w-0">
            <span className="block truncate text-ink">{c.client.fullName}</span>
            {c.client.phone && (
              <span className="block truncate text-xs tabular-nums text-ink-3">{formatPhone(c.client.phone)}</span>
            )}
          </span>
        ) : (
          <span className="text-ink-4">—</span>
        ),
    },
    {
      key: 'createdAt',
      header: 'Добавлен',
      hideBelow: 'lg',
      width: 120,
      sortable: true,
      sortValue: (c) => c.createdAt,
      render: (c) => (
        <span className="whitespace-nowrap tabular-nums text-ink-3">{formatDateShort(c.createdAt, timeZone)}</span>
      ),
    },
    ...(canEdit
      ? [
          {
            key: 'actions',
            header: <span className="sr-only">Действия</span>,
            interactive: true,
            width: 56,
            align: 'right',
            render: (c: CarType) => (
              <IconButton label="Редактировать автомобиль" icon={Pencil} size="sm" onClick={(e) => openEdit(c, e)} />
            ),
          } satisfies DataTableColumn<CarType>,
        ]
      : []),
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Автомобили"
        icon={Car}
        subtitle={data ? `${total.toLocaleString('ru-RU')} в базе` : undefined}
      />

      <Toolbar>
        <SearchInput
          value={search}
          onChange={(val) => updateParams({ q: val, page: 1 })}
          placeholder={vinEnabled ? 'Госномер, марка или VIN' : 'Госномер или марка'}
          className="w-full sm:w-80"
        />
      </Toolbar>

      <DataTable
        caption="Список автомобилей"
        columns={columns}
        rows={cars}
        rowKey={(c) => c.id}
        rowHref={(c) => `/clients/${c.clientId}`}
        rowLabel={(c) => `${c.plateNumber || 'Без номера'} ${c.makeModel} — открыть карточку клиента`}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        isFetching={isFetching}
        errorTitle="Не удалось загрузить автомобили"
        emptyState={{
          icon: Car,
          title: search ? 'Ничего не найдено' : 'Автомобилей пока нет',
          description: search
            ? vinEnabled
              ? 'Попробуйте другой госномер, марку или VIN'
              : 'Попробуйте другой госномер или марку'
            : 'Автомобили добавляются в карточке клиента',
        }}
      />

      <Pagination page={page} total={total} limit={limit} onChange={(p) => updateParams({ page: p })} />

      <CarFormModal
        isOpen={!!editingCar}
        onClose={() => setEditingCar(null)}
        title="Редактировать автомобиль"
        description={editingCar?.client ? `Владелец: ${editingCar.client.fullName}` : undefined}
        initial={
          editingCar
            ? {
                plateNumber: editingCar.plateNumber,
                makeModel: editingCar.makeModel,
                vin: carVin(editingCar) ?? '',
                comment: editingCar.comment || '',
              }
            : EMPTY_CAR_FORM
        }
        vinEnabled={vinEnabled}
        submitting={updateMutation.isPending}
        submitLabel="Сохранить"
        vinError={vinError}
        currentClientId={editingCar?.clientId}
        onSubmit={submitEdit}
      />
    </div>
  );
}
