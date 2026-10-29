import { useState, type FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Truck, Pencil } from 'lucide-react';
import toast from 'react-hot-toast';

import { suppliersApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import {
  Badge,
  Button,
  DataTable,
  Field,
  IconButton,
  Input,
  Modal,
  Money,
  PageHeader,
  Pagination,
  SearchInput,
  Textarea,
  Toolbar,
  cn,
  toneChip,
} from '../ui';
import type { DataTableColumn } from '../ui';
import PhoneInput from '../components/PhoneInput';
import type { Supplier, PaginatedResponse } from '../types';
import { formatPhone } from '../../../shared/validation/phone';
import { countLabel } from '../components/warehouse/format';
import { pageParam, useUrlParams } from '../components/warehouse/useUrlParams';

const LIMIT = 20;
const FORM_ID = 'supplier-form';

interface SupplierFormData {
  name: string;
  phone: string;
  contactPerson: string;
  comment: string;
}

const emptyForm: SupplierFormData = { name: '', phone: '', contactPerson: '', comment: '' };

type MoneyKey = 'totalPurchases' | 'totalPaid' | 'currentDebt';
const sumBy = (rows: Supplier[], key: MoneyKey) => rows.reduce((sum, r) => sum + (r[key] || 0), 0);

export default function SuppliersPage() {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  // ROLE-ONLY: создание/редактирование/удаление поставщиков — только с
  // suppliers_manage (байпас superadmin/director — внутри hasPermission;
  // admin — по матрице роли). Просмотр (suppliers_access) — у всех, кто попал.
  const canManage = hasPermission('suppliers_manage');

  // Поиск и страница — в URL: возврат из карточки поставщика возвращает на тот же список.
  const [params, setParam] = useUrlParams();
  const search = params.get('q') ?? '';
  const page = pageParam(params);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [form, setForm] = useState<SupplierFormData>(emptyForm);

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['suppliers', search, page],
    // В кеш кладём ТОЛЬКО тело ответа. Раньше здесь лежал сырой axios-ответ
    // (select: res.data): его функции/XHR не проходят structured clone, и
    // persistent-кеш (IndexedDB, ключ 'suppliers' в whitelist) падал целиком.
    queryFn: async () => {
      const res = await suppliersApi.getAll({ search, page, limit: LIMIT });
      return res.data as PaginatedResponse<Supplier>;
    },
  });

  const createMutation = useMutation({
    mutationFn: (payload: SupplierFormData) => suppliersApi.create(payload),
    onSuccess: () => {
      toast.success('Поставщик создан');
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      closeModal();
    },
    onError: () => toast.error('Ошибка при создании поставщика'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: SupplierFormData }) => suppliersApi.update(id, payload),
    onSuccess: () => {
      toast.success('Поставщик обновлён');
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      closeModal();
    },
    onError: () => toast.error('Ошибка при обновлении поставщика'),
  });

  const openCreateModal = () => {
    setEditingSupplier(null);
    setForm(emptyForm);
    setIsModalOpen(true);
  };

  const openEditModal = (supplier: Supplier) => {
    setEditingSupplier(supplier);
    setForm({
      name: supplier.name,
      phone: supplier.phone || '',
      contactPerson: supplier.contactPerson || '',
      comment: supplier.comment || '',
    });
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingSupplier(null);
    setForm(emptyForm);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error('Введите название поставщика');
      return;
    }
    if (editingSupplier) updateMutation.mutate({ id: editingSupplier.id, payload: form });
    else createMutation.mutate(form);
  };

  const isSubmitting = createMutation.isPending || updateMutation.isPending;
  const suppliers = data?.data ?? [];
  const total = data?.total ?? 0;

  const columns: DataTableColumn<Supplier>[] = [
    {
      key: 'name',
      header: 'Поставщик',
      primary: true,
      sortable: true,
      render: (s) => (
        <span className="flex min-w-0 items-center gap-3">
          <span
            className={cn(
              'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg',
              s.isSystem ? toneChip.accent : toneChip.neutral,
            )}
          >
            <Truck className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="truncate">{s.name}</span>
          {s.isSystem && (
            <Badge tone="accent" size="sm">
              Системный
            </Badge>
          )}
        </span>
      ),
      footer: (rows) => `Итого на странице (${rows.length})`,
    },
    {
      key: 'contactPerson',
      header: 'Контакт',
      hideBelow: 'md',
      truncate: true,
      width: 200,
      render: (s) =>
        s.isSystem ? (
          <span className="text-ink-3">Покупка б/у у клиентов</span>
        ) : (
          s.contactPerson || <span className="text-ink-3">—</span>
        ),
    },
    {
      key: 'phone',
      header: 'Телефон',
      hideBelow: 'lg',
      render: (s) =>
        s.phone && !s.isSystem ? (
          <span className="tabular-nums">{formatPhone(s.phone)}</span>
        ) : (
          <span className="text-ink-3">—</span>
        ),
    },
    {
      key: 'totalPurchases',
      header: 'Закупки',
      numeric: true,
      sortable: true,
      hideBelow: 'sm',
      render: (s) => <Money value={s.totalPurchases} />,
      footer: (rows) => <Money value={sumBy(rows, 'totalPurchases')} />,
    },
    {
      key: 'totalPaid',
      header: 'Оплачено',
      numeric: true,
      sortable: true,
      hideBelow: 'md',
      render: (s) => <Money value={s.totalPaid} />,
      footer: (rows) => <Money value={sumBy(rows, 'totalPaid')} />,
    },
    {
      key: 'currentDebt',
      header: 'Долг',
      numeric: true,
      sortable: true,
      render: (s) => (
        <Money value={s.currentDebt} className={s.currentDebt > 0 ? 'font-semibold text-bad-text' : 'text-ink-3'} />
      ),
      footer: (rows) => {
        const debt = sumBy(rows, 'currentDebt');
        return <Money value={debt} className={debt > 0 ? 'text-bad-text' : undefined} />;
      },
    },
    {
      key: 'status',
      header: 'Статус',
      hideBelow: 'sm',
      render: (s) =>
        s.currentDebt > 0 ? (
          <Badge tone="bad" dot>
            Долг
          </Badge>
        ) : (
          <Badge tone="ok" dot>
            Оплачено
          </Badge>
        ),
    },
    ...(canManage
      ? ([
          {
            key: 'actions',
            header: <span className="sr-only">Действия</span>,
            interactive: true,
            align: 'right',
            width: 56,
            // Системного поставщика не редактируем (backend вернёт 403).
            render: (s) =>
              s.isSystem ? null : (
                <IconButton label={`Изменить: ${s.name}`} icon={Pencil} size="sm" onClick={() => openEditModal(s)} />
              ),
          },
        ] as DataTableColumn<Supplier>[])
      : []),
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Поставщики"
        icon={Truck}
        subtitle={data ? `${countLabel(total, ['поставщик', 'поставщика', 'поставщиков'])} в базе` : undefined}
        actions={
          canManage ? (
            <Button icon={Plus} onClick={openCreateModal}>
              Новый поставщик
            </Button>
          ) : undefined
        }
      />

      <Toolbar>
        <SearchInput
          value={search}
          onChange={(value) => setParam({ q: value, page: null }, { replace: true })}
          placeholder="Название или контакт…"
          className="w-full sm:w-72"
        />
      </Toolbar>

      <DataTable
        rows={suppliers}
        rowKey={(s) => s.id}
        rowHref={(s) => `/suppliers/${s.id}`}
        rowLabel={(s) => `Открыть поставщика ${s.name}`}
        columns={columns}
        caption="Поставщики: закупки, оплаты и долг"
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        isFetching={isFetching}
        emptyState={{
          icon: Truck,
          title: search ? 'Ничего не найдено' : 'Поставщиков пока нет',
          description: search
            ? `По запросу «${search}» поставщиков нет`
            : 'Добавьте первого поставщика, чтобы вести поставки и оплаты',
          action: canManage && !search ? { label: 'Новый поставщик', onClick: openCreateModal } : undefined,
        }}
      />

      <Pagination page={page} total={total} limit={LIMIT} onChange={(p) => setParam({ page: p === 1 ? null : p })} />

      <Modal
        isOpen={isModalOpen}
        onClose={closeModal}
        title={editingSupplier ? 'Редактировать поставщика' : 'Новый поставщик'}
        description={editingSupplier?.name}
        footer={
          <>
            <Button variant="secondary" onClick={closeModal} disabled={isSubmitting}>
              Отмена
            </Button>
            <Button type="submit" form={FORM_ID} loading={isSubmitting}>
              {editingSupplier ? 'Сохранить' : 'Создать'}
            </Button>
          </>
        }
      >
        <form id={FORM_ID} onSubmit={handleSubmit} className="space-y-4">
          <Field label="Название" htmlFor="supplier-name" required>
            <Input
              id="supplier-name"
              name="organization"
              autoComplete="organization"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="ООО «Запчасти»"
            />
          </Field>

          <Field label="Контактное лицо" htmlFor="supplier-contact">
            <Input
              id="supplier-contact"
              name="name"
              autoComplete="name"
              value={form.contactPerson}
              onChange={(e) => setForm({ ...form, contactPerson: e.target.value })}
              placeholder="Иван Иванов"
            />
          </Field>

          <Field label="Телефон" htmlFor="supplier-phone">
            <PhoneInput
              id="supplier-phone"
              name="tel"
              autoComplete="tel"
              value={form.phone}
              onChange={(value) => setForm({ ...form, phone: value })}
              placeholder="+7 (XXX) XXX-XX-XX"
            />
          </Field>

          <Field label="Комментарий" htmlFor="supplier-comment">
            <Textarea
              id="supplier-comment"
              rows={3}
              value={form.comment}
              onChange={(e) => setForm({ ...form, comment: e.target.value })}
              placeholder="Заметки о поставщике…"
            />
          </Field>
        </form>
      </Modal>
    </div>
  );
}
