import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Users, Phone, Calendar, Trash2, Edit2, ShoppingBag, Download, Upload, Car } from 'lucide-react';
import toast from 'react-hot-toast';
import { clientsApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import DuplicateWarningDialog from '../components/DuplicateWarningDialog';
import SearchInput from '../components/SearchInput';
import QueryState from '../components/QueryState';
import IconButton from '../components/IconButton';
import Pagination from '../components/Pagination';
import PhoneInput from '../components/PhoneInput';
import { useClickableRow } from '../hooks/useClickableRow';
import { Client, PaginatedResponse } from '../types';
import { formatPhone } from '../../../shared/validation/phone';
import { apiErrorMessage, otherPointPhoneConflictMessage } from '../../../shared/utils/apiError';

// `useClickableRow` returns a static prop bag (no React state) — aliasing lets
// us call it per-row inside `.map` without tripping react-hooks/rules-of-hooks.
const clickableRowProps = useClickableRow;

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

export default function ClientsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();

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

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const limit = 20;

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
    onError: () => {
      toast.error('Ошибка при удалении клиента');
    },
  });

  const openCreateModal = () => {
    setEditingClient(null);
    setFullName('');
    setPhone('');
    setComment('');
    setModalOpen(true);
  };

  const openEditModal = (client: Client, e: React.MouseEvent) => {
    e.stopPropagation();
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

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteId(id);
    setConfirmOpen(true);
  };

  const confirmDelete = () => {
    if (deleteId) {
      deleteMutation.mutate(deleteId);
      setDeleteId(null);
    }
  };

  const clients = data?.data || [];
  const total = data?.total || 0;
  const withCars = clients.filter((c) => (c.cars?.length ?? 0) > 0).length;
  const totalCars = clients.reduce((sum, c) => sum + (c.cars?.length ?? 0), 0);

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <h1 className="page-title">Клиенты</h1>
        <div className="flex items-center gap-2">
          {canImport && (
            <button
              type="button"
              onClick={() => navigate('/clients/import')}
              className="btn-secondary hidden md:inline-flex"
              title="Импорт клиентов и авто (только на компьютере)"
            >
              <Upload className="w-4 h-4" />
              <span>Импорт</span>
            </button>
          )}
          {canExport && (
            <button
              type="button"
              onClick={async () => {
                try {
                  const res = await clientsApi.exportCsv();
                  const blob = new Blob([res.data as any], { type: 'text/csv;charset=utf-8' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = 'clients.csv';
                  a.click();
                  URL.revokeObjectURL(url);
                  toast.success('CSV скачан');
                } catch {
                  toast.error('Ошибка экспорта');
                }
              }}
              className="btn-secondary"
              title="Экспорт CSV"
            >
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline">CSV</span>
            </button>
          )}
          <button onClick={openCreateModal} className="btn-primary">
            <Plus className="w-4 h-4" />
            Новый клиент
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="mb-4 max-w-md">
        <SearchInput
          value={search}
          onChange={(val) => {
            setSearch(val);
            setPage(1);
          }}
          placeholder="Поиск по имени или телефону..."
        />
      </div>

      {/* Retail buyer card — always visible */}
      {(!search || 'розничный покупатель'.includes(search.toLowerCase())) && (
        <div className="mb-4">
          <div
            onClick={() => navigate('/clients/retail')}
            className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl border border-blue-200 p-4 active:bg-blue-100 transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100">
                <ShoppingBag className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">Розничный покупатель</p>
                <p className="text-xs text-gray-500">Чеки без привязки к клиенту</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* KPI strip */}
      {!isLoading && clients.length > 0 && (
        <div className="grid grid-cols-3 gap-2.5 mb-4">
          <div className="rounded-xl bg-blue-50 p-3">
            <p className="text-[10px] font-semibold text-blue-500 uppercase tracking-wider">Всего клиентов</p>
            <p className="text-base sm:text-lg font-bold text-blue-700 mt-0.5">{total}</p>
          </div>
          <div className="rounded-xl bg-emerald-50 p-3">
            <p className="text-[10px] font-semibold text-emerald-500 uppercase tracking-wider">С авто · на стр.</p>
            <p className="text-base sm:text-lg font-bold text-emerald-700 mt-0.5">{withCars}</p>
          </div>
          <div className="rounded-xl bg-gray-50 p-3">
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Автопарк · на стр.</p>
            <p className="text-base sm:text-lg font-bold text-gray-700 mt-0.5">{totalCars}</p>
          </div>
        </div>
      )}

      {/* Content */}
      <QueryState
        isLoading={isLoading}
        isError={isError}
        onRetry={refetch}
        isFetching={isFetching}
        isEmpty={clients.length === 0}
        empty={{
          icon: Users,
          title: 'Нет клиентов',
          description: search ? 'По вашему запросу ничего не найдено' : 'Добавьте первого клиента',
          action: !search ? { label: 'Добавить клиента', onClick: openCreateModal } : undefined,
        }}
        minHeight="min-h-[40vh]"
      >
        <>
          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {clients.map((client) => (
              <div
                key={client.id}
                {...clickableRowProps(() => navigate(`/clients/${client.id}`), { label: client.fullName })}
                className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 active:bg-gray-50 transition-colors cursor-pointer"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-gray-900 text-sm">{client.fullName}</span>
                  <div className="flex items-center gap-1">
                    {canEditClient && (
                      <IconButton
                        label="Редактировать"
                        icon={Edit2}
                        size="sm"
                        onClick={(e) => openEditModal(client, e)}
                      />
                    )}
                    {canDeleteClient && (
                      <IconButton
                        label="Удалить"
                        icon={Trash2}
                        variant="danger"
                        size="sm"
                        onClick={(e) => handleDelete(client.id, e)}
                      />
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-4 text-sm text-gray-500">
                  {client.phone ? (
                    <span className="flex items-center gap-1">
                      <Phone className="w-3.5 h-3.5" />
                      {formatPhone(client.phone)}
                    </span>
                  ) : !client.isRetail ? (
                    // Round 12 #3: бестелефонный клиент — серый плейсхолдер.
                    // Retail-строку не подписываем: у неё своя семантика.
                    <span className="text-gray-400">Без номера</span>
                  ) : null}
                  <span className="badge-info text-[11px]">{client.cars?.length || 0} авто</span>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop table — dense, full-width */}
          <div className="hidden md:block table-container md:max-h-[70vh]">
            <table className="table [&_th]:sticky [&_th]:top-0 [&_th]:z-10">
              <thead>
                <tr>
                  <th>Клиент</th>
                  <th>Телефон</th>
                  <th>Автомобили</th>
                  <th>Комментарий</th>
                  <th>Добавлен</th>
                  <th className="w-24 text-right">Действия</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((client) => {
                  const cars = client.cars ?? [];
                  return (
                    <tr
                      key={client.id}
                      {...clickableRowProps(() => navigate(`/clients/${client.id}`), { label: client.fullName })}
                      className="cursor-pointer hover:bg-gray-50"
                    >
                      <td>
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-blue-50 text-xs font-bold text-blue-700">
                            {clientInitials(client.fullName)}
                          </div>
                          <div className="min-w-0">
                            <span className="block font-medium text-gray-900 truncate">{client.fullName}</span>
                            {client.source && <span className="badge-default mt-0.5 text-[10px]">{client.source}</span>}
                          </div>
                        </div>
                      </td>
                      <td>
                        {client.phone ? (
                          <div className="flex items-center gap-2">
                            <Phone className="w-4 h-4 text-gray-400 flex-shrink-0" />
                            <span className="whitespace-nowrap text-gray-600">{formatPhone(client.phone)}</span>
                          </div>
                        ) : client.isRetail ? (
                          // Retail-строка: пустая ячейка как «нет данных», без
                          // «Без номера» — у розничного своя семантика.
                          <span className="text-gray-300">—</span>
                        ) : (
                          <span className="whitespace-nowrap text-gray-400">Без номера</span>
                        )}
                      </td>
                      <td>
                        {cars.length === 0 ? (
                          <span className="text-gray-300">—</span>
                        ) : (
                          <div className="flex flex-wrap items-center gap-1.5">
                            {cars.slice(0, 2).map((car) => (
                              <span
                                key={car.id}
                                className="inline-flex items-center gap-1 rounded-lg bg-gray-100 px-2 py-0.5 text-xs text-gray-700"
                              >
                                <Car className="w-3 h-3 text-gray-400" />
                                <span className="font-medium">{car.makeModel}</span>
                                {car.plateNumber && <span className="text-gray-400">{car.plateNumber}</span>}
                              </span>
                            ))}
                            {cars.length > 2 && (
                              <span className="text-xs font-medium text-gray-400">+{cars.length - 2}</span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="max-w-[260px]">
                        {client.comment ? (
                          <span className="block truncate text-gray-500" title={client.comment}>
                            {client.comment}
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td>
                        <div className="flex items-center gap-2 whitespace-nowrap text-gray-500">
                          <Calendar className="w-4 h-4 flex-shrink-0" />
                          {formatDate(client.createdAt)}
                        </div>
                      </td>
                      <td>
                        <div className="flex items-center justify-end gap-1">
                          {canEditClient && (
                            <button
                              onClick={(e) => openEditModal(client, e)}
                              className="p-1.5 text-gray-400 hover:text-primary-600 rounded-lg hover:bg-gray-100 transition-colors"
                              title="Редактировать"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                          )}
                          {canDeleteClient && (
                            <button
                              onClick={(e) => handleDelete(client.id, e)}
                              className="p-1.5 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors"
                              title="Удалить"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <Pagination page={page} total={total} limit={limit} onChange={setPage} />
        </>
      </QueryState>

      {/* Create/Edit Modal */}
      <Modal isOpen={modalOpen} onClose={closeModal} title={editingClient ? 'Редактировать клиента' : 'Новый клиент'}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">ФИО</label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="input"
              placeholder="Введите ФИО клиента"
              required
            />
          </div>

          <div>
            <label className="label">Телефон</label>
            <PhoneInput value={phone} onChange={setPhone} placeholder="+7 (___) ___-__-__" />
          </div>

          <div>
            <label className="label">Комментарий</label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              className="input"
              rows={3}
              placeholder="Комментарий (необязательно)"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200">
            <button type="button" onClick={closeModal} className="btn-secondary">
              Отмена
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending || updateMutation.isPending || submitting}
              className="btn-primary"
            >
              {editingClient ? 'Сохранить' : submitting ? 'Проверяем…' : 'Создать'}
            </button>
          </div>
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
