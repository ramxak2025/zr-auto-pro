import { useState, type FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Wrench, Pencil, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { servicesApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import {
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  Field,
  IconButton,
  Input,
  Modal,
  Money,
  PageHeader,
  Pagination,
  SearchInput,
  Toolbar,
} from '../ui';
import type { DataTableColumn } from '../ui';
import type { Service, PaginatedResponse } from '../types';
import { countLabel, formatPercent, parseNumberInput } from '../components/warehouse/format';
import { pageParam, useUrlParams } from '../components/warehouse/useUrlParams';

const LIMIT = 20;
const FORM_ID = 'service-form';

interface ServicePayload {
  name: string;
  category?: string;
  defaultPrice: number;
  masterPercent?: number | null;
  warrantyDays?: number | null;
}

export default function ServicesPage() {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  // ROLE-ONLY: управление каталогом (add/edit/delete + %/гарантия) — только с
  // services_manage (байпас superadmin/director — внутри hasPermission; admin —
  // по матрице роли). services_view (просмотр + в чек) — у всех, кто сюда
  // попал; backend всё равно вернёт 403 без права.
  const canManage = hasPermission('services_manage');

  // Поиск и страница — в URL: F5 и «Назад» сохраняют список.
  const [params, setParam] = useUrlParams();
  const search = params.get('q') ?? '';
  const page = pageParam(params);

  // Модалка формы
  const [modalOpen, setModalOpen] = useState(false);
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [defaultPrice, setDefaultPrice] = useState('');
  const [masterPercent, setMasterPercent] = useState('');
  const [warrantyDays, setWarrantyDays] = useState('');

  const [deleteTarget, setDeleteTarget] = useState<Service | null>(null);

  const { data, isLoading, isError, isFetching, refetch } = useQuery<PaginatedResponse<Service>>({
    // Ключ прежний: фильтр по категории в UI не заведён → category: undefined.
    queryKey: ['services', { search, page, limit: LIMIT, category: undefined }],
    queryFn: async () => {
      const res = await servicesApi.getAll({ search, page, limit: LIMIT });
      return res.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: (payload: ServicePayload) => servicesApi.create(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['services'] });
      toast.success('Услуга создана');
      closeModal();
    },
    onError: () => toast.error('Ошибка при создании услуги'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: ServicePayload }) => servicesApi.update(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['services'] });
      toast.success('Услуга обновлена');
      closeModal();
    },
    onError: () => toast.error('Ошибка при обновлении услуги'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => servicesApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['services'] });
      toast.success('Услуга удалена');
    },
    onError: () => toast.error('Ошибка при удалении услуги'),
  });

  const openCreate = () => {
    setEditingService(null);
    setName('');
    setCategory('');
    setDefaultPrice('');
    setMasterPercent('');
    setWarrantyDays('');
    setModalOpen(true);
  };

  const openEdit = (service: Service) => {
    setEditingService(service);
    setName(service.name);
    setCategory(service.category || '');
    setDefaultPrice(String(service.defaultPrice));
    setMasterPercent(service.masterPercent != null ? String(service.masterPercent) : '');
    setWarrantyDays(service.warrantyDays != null ? String(service.warrantyDays) : '');
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingService(null);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('Введите название услуги');
      return;
    }
    const price = parseNumberInput(defaultPrice);
    if (price === null || price < 0) {
      toast.error('Введите цену по умолчанию');
      return;
    }
    const pctRaw = masterPercent.trim();
    const pct = pctRaw === '' ? null : parseNumberInput(pctRaw);
    if (pctRaw !== '' && (pct === null || pct < 0 || pct > 100)) {
      toast.error('Процент мастера — число от 0 до 100');
      return;
    }
    const wdRaw = warrantyDays.trim();
    const wdParsed = wdRaw === '' ? null : parseNumberInput(wdRaw);
    if (wdRaw !== '' && wdParsed === null) {
      toast.error('Срок гарантии — целое число дней');
      return;
    }
    const payload: ServicePayload = {
      name: name.trim(),
      category: category.trim() || undefined,
      defaultPrice: price,
      masterPercent: pct,
      warrantyDays: wdParsed === null ? null : Math.max(0, Math.floor(wdParsed)),
    };
    if (editingService) updateMutation.mutate({ id: editingService.id, payload });
    else createMutation.mutate(payload);
  };

  const services = data?.data ?? [];
  const total = data?.total ?? 0;
  const saving = createMutation.isPending || updateMutation.isPending;

  const columns: DataTableColumn<Service>[] = [
    {
      key: 'name',
      header: 'Название',
      sortable: true,
      render: (s) => (
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-surface-3 text-ink-3">
            <Wrench className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="truncate font-medium text-ink">{s.name}</span>
        </span>
      ),
    },
    {
      key: 'category',
      header: 'Категория',
      hideBelow: 'sm',
      render: (s) => (s.category ? <Badge outline>{s.category}</Badge> : <span className="text-ink-3">—</span>),
    },
    {
      key: 'defaultPrice',
      header: 'Цена по умолчанию',
      numeric: true,
      sortable: true,
      render: (s) => <Money value={s.defaultPrice} className="font-medium text-ink" />,
    },
    ...(canManage
      ? ([
          {
            key: 'masterPercent',
            header: '% мастера',
            numeric: true,
            hideBelow: 'md',
            render: (s) =>
              s.masterPercent != null ? (
                <span className="font-medium text-ink-2">{formatPercent(s.masterPercent)}</span>
              ) : (
                <span className="text-ink-3">стандарт</span>
              ),
          },
        ] as DataTableColumn<Service>[])
      : []),
    {
      key: 'warrantyDays',
      header: 'Гарантия',
      numeric: true,
      hideBelow: 'md',
      render: (s) =>
        s.warrantyDays != null && s.warrantyDays > 0 ? (
          <span className="text-ink-2">{s.warrantyDays} дн.</span>
        ) : (
          <span className="text-ink-3">—</span>
        ),
    },
    ...(canManage
      ? ([
          {
            key: 'actions',
            header: <span className="sr-only">Действия</span>,
            interactive: true,
            align: 'right',
            width: 96,
            render: (s) => (
              <span className="inline-flex items-center justify-end gap-1">
                <IconButton label={`Изменить: ${s.name}`} icon={Pencil} size="sm" onClick={() => openEdit(s)} />
                <IconButton
                  label={`Удалить: ${s.name}`}
                  icon={Trash2}
                  size="sm"
                  variant="danger"
                  onClick={() => setDeleteTarget(s)}
                />
              </span>
            ),
          },
        ] as DataTableColumn<Service>[])
      : []),
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Услуги"
        icon={Wrench}
        subtitle={data ? `${countLabel(total, ['услуга', 'услуги', 'услуг'])} в прайс-листе` : undefined}
        actions={
          canManage ? (
            <Button icon={Plus} onClick={openCreate}>
              Новая услуга
            </Button>
          ) : undefined
        }
      />

      <Toolbar>
        <SearchInput
          value={search}
          onChange={(value) => setParam({ q: value, page: null }, { replace: true })}
          placeholder="Название услуги…"
          className="w-full sm:w-72"
        />
      </Toolbar>

      <DataTable
        rows={services}
        rowKey={(s) => s.id}
        columns={columns}
        caption="Прайс-лист услуг"
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        isFetching={isFetching}
        emptyState={{
          icon: Wrench,
          title: search ? 'Ничего не найдено' : 'Услуг пока нет',
          description: search
            ? `По запросу «${search}» услуг нет — попробуйте другое название`
            : 'Добавьте первую услугу, чтобы выбирать её в чеке',
          action: canManage && !search ? { label: 'Добавить услугу', onClick: openCreate } : undefined,
        }}
      />

      <Pagination page={page} total={total} limit={LIMIT} onChange={(p) => setParam({ page: p === 1 ? null : p })} />

      <Modal
        isOpen={modalOpen}
        onClose={closeModal}
        title={editingService ? 'Редактировать услугу' : 'Новая услуга'}
        description={editingService ? editingService.name : 'Услуга появится в списке для выбора в чеке'}
        footer={
          <>
            <Button variant="secondary" onClick={closeModal} disabled={saving}>
              Отмена
            </Button>
            <Button type="submit" form={FORM_ID} loading={saving}>
              {editingService ? 'Сохранить' : 'Создать'}
            </Button>
          </>
        }
      >
        <form id={FORM_ID} onSubmit={handleSubmit} className="space-y-4">
          <Field label="Название" htmlFor="service-name" required>
            <Input
              id="service-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Например: Замена масла"
              autoComplete="off"
              required
            />
          </Field>

          <Field label="Категория" htmlFor="service-category" hint="Например: Диагностика, ТО, Ходовая">
            <Input
              id="service-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Без категории"
              autoComplete="off"
            />
          </Field>

          <Field label="Цена по умолчанию, ₽" htmlFor="service-price" required>
            <Input
              id="service-price"
              inputMode="decimal"
              value={defaultPrice}
              onChange={(e) => setDefaultPrice(e.target.value)}
              placeholder="0"
              className="tabular-nums"
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Особый % мастера"
              htmlFor="service-percent"
              hint="Если заполнено — используется вместо стандартного процента мастера"
            >
              <Input
                id="service-percent"
                inputMode="decimal"
                value={masterPercent}
                onChange={(e) => setMasterPercent(e.target.value)}
                placeholder="Стандартный"
                className="tabular-nums"
              />
            </Field>
            <Field
              label="Гарантия, дней"
              htmlFor="service-warranty"
              hint="Дней с момента продажи; пусто — без гарантии"
            >
              <Input
                id="service-warranty"
                inputMode="numeric"
                value={warrantyDays}
                onChange={(e) => setWarrantyDays(e.target.value)}
                placeholder="Без гарантии"
                className="tabular-nums"
              />
            </Field>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        title="Удалить услугу"
        message={`Удалить «${deleteTarget?.name ?? ''}»? Это действие нельзя отменить.`}
        confirmText="Удалить"
        variant="danger"
      />
    </div>
  );
}
