import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Users,
} from 'lucide-react';
import { clientsApi } from '../api/services';
import type { Client, PaginatedResponse } from '../types';
import SearchInput from '../components/SearchInput';
import Pagination from '../components/Pagination';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';
import LoadingSpinner from '../components/LoadingSpinner';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('ru-RU');
}

// ---------------------------------------------------------------------------
// Client Form Modal
// ---------------------------------------------------------------------------

interface ClientFormData {
  fullName: string;
  phone: string;
  comment: string;
}

interface ClientFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  client?: Client | null;
  onSubmit: (data: ClientFormData) => void;
  isLoading: boolean;
}

function ClientFormModal({
  isOpen,
  onClose,
  client,
  onSubmit,
  isLoading,
}: ClientFormModalProps) {
  const [fullName, setFullName] = useState(client?.fullName || '');
  const [phone, setPhone] = useState(client?.phone || '');
  const [comment, setComment] = useState(client?.comment || '');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmedName = fullName.trim();
    if (!trimmedName) {
      toast.error('Введите ФИО клиента');
      return;
    }
    if (!phone.trim()) {
      toast.error('Введите телефон клиента');
      return;
    }
    onSubmit({
      fullName: trimmedName,
      phone: phone.trim(),
      comment: comment.trim(),
    });
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={client ? 'Редактировать клиента' : 'Новый клиент'}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            ФИО <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Иванов Иван Иванович"
            className="block w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Телефон <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+7 (___) ___-__-__"
            className="block w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Комментарий
          </label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            placeholder="Дополнительная информация..."
            className="block w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 resize-none"
          />
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
          >
            Отмена
          </button>
          <button
            type="submit"
            disabled={isLoading}
            className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-700 disabled:opacity-50"
          >
            {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
            {client ? 'Сохранить' : 'Создать'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

const LIMIT = 20;

export default function ClientsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  // Modal state
  const [formOpen, setFormOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Client | null>(null);

  // ---- Queries ----

  const {
    data: clientsData,
    isLoading,
    isError,
  } = useQuery<PaginatedResponse<Client>>({
    queryKey: ['clients', { search, page }],
    queryFn: async () => {
      const res = await clientsApi.getAll({
        search: search || undefined,
        page,
        limit: LIMIT,
      });
      return res.data;
    },
    keepPreviousData: true,
  } as any);

  // ---- Mutations ----

  const createMutation = useMutation({
    mutationFn: (data: ClientFormData) => clientsApi.create(data),
    onSuccess: () => {
      toast.success('Клиент создан');
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      closeForm();
    },
    onError: () => {
      toast.error('Не удалось создать клиента');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: ClientFormData }) =>
      clientsApi.update(id, data),
    onSuccess: () => {
      toast.success('Клиент обновлён');
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      closeForm();
    },
    onError: () => {
      toast.error('Не удалось обновить клиента');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => clientsApi.delete(id),
    onSuccess: () => {
      toast.success('Клиент удалён');
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      setDeleteTarget(null);
    },
    onError: () => {
      toast.error('Не удалось удалить клиента');
    },
  });

  // ---- Handlers ----

  function openCreate() {
    setEditingClient(null);
    setFormOpen(true);
  }

  function openEdit(client: Client) {
    setEditingClient(client);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingClient(null);
  }

  function handleFormSubmit(data: ClientFormData) {
    if (editingClient) {
      updateMutation.mutate({ id: editingClient.id, data });
    } else {
      createMutation.mutate(data);
    }
  }

  function handleSearchChange(v: string) {
    setSearch(v);
    setPage(1);
  }

  const clients = clientsData?.data || [];
  const total = clientsData?.total || 0;
  const isMutating = createMutation.isPending || updateMutation.isPending;

  // ---- Render ----

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900">Клиенты</h1>
          <p className="text-sm text-gray-500 mt-0.5">Всего: {total}</p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 rounded-lg bg-primary-600 px-3 md:px-4 py-2 md:py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary-700"
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Добавить клиента</span>
        </button>
      </div>

      {/* Search */}
      <div className="max-w-full md:max-w-sm">
        <SearchInput
          value={search}
          onChange={handleSearchChange}
          placeholder="Поиск по ФИО или телефону..."
        />
      </div>

      {/* Content */}
      {isLoading ? (
        <LoadingSpinner />
      ) : isError ? (
        <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
          <p className="text-sm">Не удалось загрузить список клиентов</p>
        </div>
      ) : clients.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white">
          <EmptyState
            icon={Users}
            title={search ? 'Ничего не найдено' : 'Нет клиентов'}
            description={
              search
                ? 'Попробуйте изменить параметры поиска'
                : 'Добавьте первого клиента для начала работы'
            }
            action={
              !search ? (
                <button
                  onClick={openCreate}
                  className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-700"
                >
                  <Plus className="h-4 w-4" />
                  Добавить клиента
                </button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <>
          {/* ─── Mobile card list ─── */}
          <div className="md:hidden space-y-3">
            {clients.map((client) => (
              <button
                key={client.id}
                type="button"
                onClick={() => navigate(`/clients/${client.id}`)}
                className="w-full text-left bg-white rounded-xl border border-gray-100 shadow-sm p-4 hover:shadow-md active:bg-gray-50 transition-all"
              >
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-gray-900 truncate">{client.fullName}</p>
                    <p className="text-sm text-gray-500 mt-0.5">{client.phone}</p>
                  </div>
                  <div className="flex items-center gap-1 ml-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); openEdit(client); }}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setDeleteTarget(client); }}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <p className="text-xs text-gray-400 mt-2">{formatDate(client.createdAt)}</p>
              </button>
            ))}
          </div>

          {/* ─── Desktop table ─── */}
          <div className="hidden md:block overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50/50">
                    <th className="px-4 py-3 font-semibold text-gray-600">ФИО</th>
                    <th className="px-4 py-3 font-semibold text-gray-600">Телефон</th>
                    <th className="px-4 py-3 font-semibold text-gray-600">Дата</th>
                    <th className="px-4 py-3 font-semibold text-gray-600 text-right">
                      Действия
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {clients.map((client) => (
                    <tr
                      key={client.id}
                      onClick={() => navigate(`/clients/${client.id}`)}
                      className="cursor-pointer transition-colors hover:bg-gray-50"
                    >
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {client.fullName}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{client.phone}</td>
                      <td className="px-4 py-3 text-gray-600">
                        {formatDate(client.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              openEdit(client);
                            }}
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                            title="Редактировать"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteTarget(client);
                            }}
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
                            title="Удалить"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <Pagination page={page} total={total} limit={LIMIT} onChange={setPage} />
        </>
      )}

      {/* Create / Edit Modal */}
      {formOpen && (
        <ClientFormModal
          key={editingClient?.id || 'new'}
          isOpen={formOpen}
          onClose={closeForm}
          client={editingClient}
          onSubmit={handleFormSubmit}
          isLoading={isMutating}
        />
      )}

      {/* Delete Confirm Dialog */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        title="Удалить клиента"
        message={`Вы уверены, что хотите удалить клиента "${deleteTarget?.fullName}"? Это действие нельзя отменить.`}
        confirmText="Удалить"
        variant="danger"
      />
    </div>
  );
}
