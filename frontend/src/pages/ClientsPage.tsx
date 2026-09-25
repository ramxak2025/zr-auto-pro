import { useState, FormEvent, type MouseEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Users, Trash2, Pencil, ShoppingBag, Download, Upload, Car, ChevronRight } from 'lucide-react';
import toast from 'react-hot-toast';
import { clientsApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import { useTenantTimezone } from '../hooks/useTenantTimezone';
import { useVinEnabled } from '../hooks/useVinEnabled';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import DuplicateWarningDialog from '../components/DuplicateWarningDialog';
import SearchInput from '../components/SearchInput';
import Pagination from '../components/Pagination';
import PageHeader from '../components/PageHeader';
import PhoneInput from '../components/PhoneInput';
import { Badge } from '../ui/Badge';
import { Button, buttonClasses } from '../ui/Button';
import { DataTable, type DataTableColumn } from '../ui/DataTable';
import { Field } from '../ui/Field';
import { IconButton } from '../ui/IconButton';
import { Input } from '../ui/Input';
import { Textarea } from '../ui/Textarea';
import { Toolbar } from '../ui/Toolbar';
import { cn } from '../ui/cn';
import { focusRing, toneChip } from '../ui/tokens';
import { Client, PaginatedResponse } from '../types';
import { formatPhone } from '../../../shared/validation/phone';
import { formatDateShort } from '../../../shared/utils/formatters';
import { apiErrorMessage, otherPointPhoneConflictMessage } from '../../../shared/utils/apiError';

const clientInitials = (name: string) =>
  name
    .split(' ')
    .map((w) => w[0])
    .filter(Boolean)
    .join('')
    .slice(0, 2)
    .toUpperCase();

/** SW-офлайн-очередь отвечает 202 {queued:true} — сервер запрос ещё НЕ видел. */
const isQueuedOffline = (res: { status?: number; data?: unknown } | undefined): boolean =>
  res?.status === 202 && (res?.data as { queued?: boolean } | undefined)?.queued === true;

const LIMIT = 20;

export default function ClientsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const timeZone = useTenantTimezone();
  const vinEnabled = useVinEnabled();

  // Волна «права как в Битрикс24»: только матрица (байпас superadmin/director —
  // внутри hasPermission; admin — по правам роли из /auth/me).
  //   clients_edit   — правка карточки клиента + импорт (backend imports/).
  //   clients_delete — удаление клиента (backend DELETE /clients/:id).
  //   export_data    — экспорт CSV (backend GET /clients/export-csv).
  // Создание клиента (openCreateModal) остаётся без гейта — мастер в Кассе.
  const canEditClient = hasPermission('clients_edit');
  const canDeleteClient = hasPermission('clients_delete');
  const canImport = hasPermission('clients_edit');
  const canExport = hasPermission('export_data');

  // Состояние списка — в URL: F5, «Назад» из карточки и пересылка ссылки
  // сохраняют поиск и страницу (аудит 2.5 P1).
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

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);

  // Delete confirm state
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Form state
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [comment, setComment] = useState('');

  // Duplicate-by-phone warning
  const [duplicateClient, setDuplicateClient] = useState<{
    id: string;
    fullName: string;
    phone: string;
    cars?: Array<{ plateNumber: string; makeModel: string }>;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Round 12 #3: клиент без телефона легален (backend коэрсит phone в ''),
  // но пустой номер чаще случайность — перед сохранением явный confirm.
  const [noPhoneConfirmOpen, setNoPhoneConfirmOpen] = useState(false);

  // Query
  const { data, isLoading, isError, refetch, isFetching } = useQuery<PaginatedResponse<Client>>({
    queryKey: ['clients', { search, page, limit }],
    queryFn: async () => {
      const res = await clientsApi.getAll({ search, page, limit });
      return res.data;
    },
  });

  /**
   * Единая реакция на отказ записи клиента.
   *
   * Раньше здесь стоял глухой текст, и владелец не видел НИ ОДНОЙ реальной
   * причины: ни 409 «клиент с этим номером уже добавлен», ни 400 про пустое
   * имя. Отдельная ветка — 161: номер занят карточкой ДРУГОГО ФИЛИАЛА. Там
   * сервер намеренно не отдаёт ни имени, ни id владельца (чужая база), поэтому
   * ссылку «перейти к клиенту» показывать нельзя — она вела бы в 404. Текст
   * сервера объясняет, что делать, и живёт на экране дольше обычного тоста.
   */
  const clientWriteError = (err: unknown, fallback: string) => {
    const otherPoint = otherPointPhoneConflictMessage(err);
    if (otherPoint) {
      toast.error(otherPoint, { duration: 8000 });
      return;
    }
    toast.error(apiErrorMessage(err) ?? fallback);
  };

  // Mutations
  const createMutation = useMutation({
    mutationFn: (data: { fullName: string; phone: string; comment?: string }) => clientsApi.create(data),
    onSuccess: (res) => {
      if (isQueuedOffline(res)) {
        // SW-офлайн: сервер клиента ещё НЕ создал — честный тост без «Клиент
        // создан» и без инвалидаций (сервер ничего нового не отдаст).
        toast('Нет сети — клиент поставлен в очередь и сохранится автоматически', { icon: '📡', duration: 5000 });
        closeModal();
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      toast.success('Клиент создан');
      closeModal();
    },
    onError: (err) => clientWriteError(err, 'Ошибка при создании клиента'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { fullName: string; phone: string; comment?: string } }) =>
      clientsApi.update(id, data),
    onSuccess: (res) => {
      if (isQueuedOffline(res)) {
        toast('Нет сети — изменения поставлены в очередь и сохранятся автоматически', { icon: '📡', duration: 5000 });
        closeModal();
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      toast.success('Клиент обновлён');
      closeModal();
    },
    onError: (err) => clientWriteError(err, 'Ошибка при обновлении клиента'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => clientsApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      toast.success('Клиент удалён');
    },
    onError: (err) => {
      toast.error(apiErrorMessage(err) ?? 'Ошибка при удалении клиента');
    },
  });

  const openCreateModal = () => {
    setEditingClient(null);
    setFullName('');
    setPhone('');
    setComment('');
    setModalOpen(true);
  };

  const openEditModal = (client: Client, e?: MouseEvent) => {
    e?.stopPropagation();
    setEditingClient(client);
    setFullName(client.fullName);
    setPhone(client.phone);
    setComment(client.comment || '');
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingClient(null);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const payload = { fullName, phone, comment: comment || undefined };
    const phoneDigits = phone.replace(/\D/g, '');
    if (editingClient) {
      // Стирание номера у клиента, у которого он был, — тоже случайность:
      // confirm отдельным текстом. Был без номера — сохраняем молча.
      if (phoneDigits.length === 0 && (editingClient.phone || '').replace(/\D/g, '').length > 0) {
        setNoPhoneConfirmOpen(true);
        return;
      }
      updateMutation.mutate({ id: editingClient.id, data: payload });
      return;
    }
    if (phoneDigits.length === 0) {
      // lookupByPhone('') не зовём — пустой ключ дедупа бессмыслен;
      // подтверждение → createMutation с phone:'' (см. confirmNoPhoneSubmit).
      setNoPhoneConfirmOpen(true);
      return;
    }
    // Pre-create duplicate check by phone — only on create.
    setSubmitting(true);
    try {
      const res = await clientsApi.lookupByPhone(phone);
      const existing = res.data;
      if (existing) {
        setDuplicateClient(existing);
        return;
      }
      createMutation.mutate(payload);
    } catch {
      // Fall back to creating anyway if the lookup endpoint failed.
      createMutation.mutate(payload);
    } finally {
      setSubmitting(false);
    }
  };

  // Подтверждённое сохранение без номера — существующие мутации, phone: ''.
  const confirmNoPhoneSubmit = () => {
    const payload = { fullName, phone, comment: comment || undefined };
    if (editingClient) {
      updateMutation.mutate({ id: editingClient.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const handleCreateAnyway = () => {
    setDuplicateClient(null);
    createMutation.mutate({ fullName, phone, comment: comment || undefined });
  };

  const handleOpenExistingClient = () => {
    if (!duplicateClient) return;
    const id = duplicateClient.id;
    setDuplicateClient(null);
    setModalOpen(false);
    navigate(`/clients/${id}`);
  };

  const handleDelete = (id: string, e?: MouseEvent) => {
    e?.stopPropagation();
    setDeleteId(id);
    setConfirmOpen(true);
  };

  const confirmDelete = () => {
    if (deleteId) {
      deleteMutation.mutate(deleteId);
      setDeleteId(null);
    }
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const res = await clientsApi.exportCsv();
      const blob = new Blob([res.data as BlobPart], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'clients.csv';
      a.click();
      URL.revokeObjectURL(url);
      toast.success('CSV скачан');
    } catch {
      toast.error('Ошибка экспорта');
    } finally {
      setExporting(false);
    }
  };

  const clients = data?.data || [];
  const total = data?.total || 0;
  const showRetailCard = !search || 'розничный покупатель'.includes(search.toLowerCase());
  const hasRowActions = canEditClient || canDeleteClient;

  const columns: DataTableColumn<Client>[] = [
    {
      key: 'name',
      header: 'Клиент',
      primary: true,
      sortable: true,
      sortValue: (c) => c.fullName,
      render: (c) => (
        <span className="flex min-w-0 items-center gap-3">
          <span
            className={cn(
              'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-2xs font-semibold',
              c.isRetail ? toneChip.neutral : toneChip.accent,
            )}
            aria-hidden="true"
          >
            {c.isRetail ? <ShoppingBag className="h-3.5 w-3.5" /> : clientInitials(c.fullName)}
          </span>
          <span className="min-w-0">
            <span className="block truncate">{c.fullName}</span>
            {/* На узких экранах телефон и число авто живут под именем —
                остальные колонки скрыты (hideBelow). */}
            <span className="block truncate text-xs font-normal text-ink-3 md:hidden">
              {c.phone ? formatPhone(c.phone) : c.isRetail ? '' : 'Без номера'}
              {(c.cars?.length ?? 0) > 0 ? ` · авто: ${c.cars?.length}` : ''}
            </span>
          </span>
          {c.source && (
            <Badge outline size="sm" className="hidden lg:inline-flex">
              {c.source}
            </Badge>
          )}
        </span>
      ),
    },
    {
      key: 'phone',
      header: 'Телефон',
      hideBelow: 'md',
      width: 180,
      render: (c) =>
        c.phone ? (
          <span className="whitespace-nowrap tabular-nums">{formatPhone(c.phone)}</span>
        ) : c.isRetail ? (
          // Retail-строка: пустая ячейка как «нет данных», без «Без номера» —
          // у розничного своя семантика.
          <span className="text-ink-4">—</span>
        ) : (
          <span className="whitespace-nowrap text-ink-3">Без номера</span>
        ),
    },
    {
      key: 'cars',
      header: 'Автомобили',
      hideBelow: 'lg',
      render: (c) => {
        const cars = c.cars ?? [];
        if (cars.length === 0) return <span className="text-ink-4">—</span>;
        return (
          <span className="flex flex-wrap items-center gap-1.5">
            {cars.slice(0, 2).map((car) => (
              <span
                key={car.id}
                className="inline-flex max-w-[220px] items-center gap-1 rounded-md bg-surface-3 px-2 py-0.5 text-xs text-ink-2"
              >
                <Car className="h-3 w-3 flex-shrink-0 text-ink-4" aria-hidden="true" />
                <span className="truncate font-medium">{car.makeModel}</span>
                {car.plateNumber && <span className="flex-shrink-0 tabular-nums text-ink-3">{car.plateNumber}</span>}
              </span>
            ))}
            {cars.length > 2 && <span className="text-xs font-medium text-ink-3">+{cars.length - 2}</span>}
          </span>
        );
      },
    },
    {
      key: 'comment',
      header: 'Комментарий',
      hideBelow: 'xl',
      truncate: true,
      width: 260,
      render: (c) =>
        c.comment ? (
          <span className="text-ink-3" title={c.comment}>
            {c.comment}
          </span>
        ) : (
          <span className="text-ink-4">—</span>
        ),
    },
    {
      key: 'createdAt',
      header: 'Добавлен',
      hideBelow: 'md',
      width: 120,
      sortable: true,
      sortValue: (c) => c.createdAt,
      render: (c) => (
        <span className="whitespace-nowrap tabular-nums text-ink-3">{formatDateShort(c.createdAt, timeZone)}</span>
      ),
    },
    ...(hasRowActions
      ? [
          {
            key: 'actions',
            header: <span className="sr-only">Действия</span>,
            interactive: true,
            width: 88,
            align: 'right',
            render: (c: Client) => (
              <span className="flex items-center justify-end gap-0.5">
                {canEditClient && (
                  <IconButton label="Редактировать" icon={Pencil} size="sm" onClick={(e) => openEditModal(c, e)} />
                )}
                {canDeleteClient && (
                  <IconButton
                    label="Удалить"
                    icon={Trash2}
                    variant="danger"
                    size="sm"
                    onClick={(e) => handleDelete(c.id, e)}
                  />
                )}
              </span>
            ),
          } satisfies DataTableColumn<Client>,
        ]
      : []),
  ];

  const isPending = createMutation.isPending || updateMutation.isPending || submitting;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Клиенты"
        icon={Users}
        subtitle={data ? `${total.toLocaleString('ru-RU')} в базе` : undefined}
        actions={
          <>
            {canImport && (
              <Link
                to="/clients/import"
                className={cn(buttonClasses({ variant: 'secondary' }), 'hidden md:inline-flex')}
                title="Импорт клиентов и авто из Excel/CSV (на компьютере)"
              >
                <Upload className="h-4 w-4" aria-hidden="true" />
                Импорт
              </Link>
            )}
            {canExport && (
              <Button variant="secondary" icon={Download} onClick={exportCsv} loading={exporting}>
                Экспорт CSV
              </Button>
            )}
            <Button icon={Plus} onClick={openCreateModal}>
              Новый клиент
            </Button>
          </>
        }
      />

      <Toolbar>
        <SearchInput
          value={search}
          onChange={(val) => updateParams({ q: val, page: 1 })}
          placeholder={vinEnabled ? 'Имя, телефон, госномер или VIN' : 'Имя, телефон или госномер'}
          className="w-full sm:w-80"
        />
      </Toolbar>

      {/* Розничный покупатель — точка входа в розничные чеки. Настоящая ссылка:
          Tab/Enter, Cmd+клик, средняя кнопка (аудит 2.5 P0). */}
      {showRetailCard && (
        <Link
          to="/clients/retail"
          className={cn(
            'card flex items-center gap-3 px-4 py-3 transition-[border-color,box-shadow] duration-150 hover:border-line-strong hover:shadow-pop',
            focusRing,
          )}
        >
          <span className={cn('flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg', toneChip.accent)}>
            <ShoppingBag className="h-[18px] w-[18px]" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-ink">Розничный покупатель</span>
            <span className="block text-xs text-ink-3">Чеки без привязки к клиенту</span>
          </span>
          <ChevronRight className="h-4 w-4 flex-shrink-0 text-ink-4" aria-hidden="true" />
        </Link>
      )}

      <DataTable
        caption="Список клиентов"
        columns={columns}
        rows={clients}
        rowKey={(c) => c.id}
        rowHref={(c) => `/clients/${c.id}`}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        isFetching={isFetching}
        errorTitle="Не удалось загрузить клиентов"
        emptyState={{
          icon: Users,
          title: search ? 'Ничего не найдено' : 'Клиентов пока нет',
          description: search ? 'Попробуйте другое имя, телефон или госномер' : 'Добавьте первого клиента',
          action: !search ? { label: 'Добавить клиента', onClick: openCreateModal } : undefined,
        }}
      />

      <Pagination page={page} total={total} limit={limit} onChange={(p) => updateParams({ page: p })} />

      {/* Create/Edit Modal */}
      <Modal
        isOpen={modalOpen}
        onClose={closeModal}
        title={editingClient ? 'Редактировать клиента' : 'Новый клиент'}
        footer={
          <>
            <Button variant="secondary" onClick={closeModal} disabled={isPending}>
              Отмена
            </Button>
            <Button type="submit" form="client-form" loading={isPending}>
              {editingClient ? 'Сохранить' : 'Создать'}
            </Button>
          </>
        }
      >
        <form id="client-form" onSubmit={handleSubmit} className="space-y-4">
          <Field label="ФИО" htmlFor="client-form-name" required>
            <Input
              id="client-form-name"
              name="fullName"
              autoComplete="name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Иванов Иван Иванович"
              required
            />
          </Field>

          <Field
            label="Телефон"
            htmlFor="client-form-phone"
            hint={!editingClient ? 'По номеру мы предупредим о дубле и найдём клиента в Кассе' : undefined}
          >
            <PhoneInput
              id="client-form-phone"
              name="phone"
              autoComplete="tel"
              value={phone}
              onChange={setPhone}
              placeholder="+7 (___) ___-__-__"
            />
          </Field>

          <Field label="Комментарий" htmlFor="client-form-comment">
            <Textarea
              id="client-form-comment"
              name="comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
              placeholder="Необязательно"
            />
          </Field>
        </form>
      </Modal>

      {/* Delete Confirm */}
      <ConfirmDialog
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={confirmDelete}
        title="Удалить клиента"
        message="Вы уверены, что хотите удалить этого клиента? Это действие нельзя отменить."
        confirmText="Удалить"
        variant="danger"
      />

      {/* No-phone confirm (Round 12 #3) — защита от случайно пропущенного
          номера при создании и от случайного стирания при редактировании. */}
      <ConfirmDialog
        isOpen={noPhoneConfirmOpen}
        onClose={() => setNoPhoneConfirmOpen(false)}
        onConfirm={confirmNoPhoneSubmit}
        title={editingClient ? 'Сохранить клиента без номера телефона?' : 'Создать клиента без номера телефона?'}
        message="Его нельзя будет найти поиском по номеру."
        confirmText="Без номера"
      />

      {/* Duplicate-by-phone warning */}
      <DuplicateWarningDialog
        isOpen={!!duplicateClient}
        onClose={() => setDuplicateClient(null)}
        onCreateAnyway={handleCreateAnyway}
        onOpenExisting={handleOpenExistingClient}
        title="Такой клиент уже есть"
        description={`Клиент с телефоном ${duplicateClient ? formatPhone(duplicateClient.phone) : formatPhone(phone)} уже существует в вашей базе. Открыть существующего, чтобы дополнить данные, или всё равно создать нового?`}
        existingLabel={duplicateClient?.fullName || ''}
        existingSubtitle={duplicateClient ? formatPhone(duplicateClient.phone) : undefined}
        existingCars={duplicateClient?.cars}
        openExistingLabel="Открыть карточку"
      />
    </div>
  );
}
