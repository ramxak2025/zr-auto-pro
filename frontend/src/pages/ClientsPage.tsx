import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Users, Phone, Calendar, Trash2, Edit2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { clientsApi } from '../api/services';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import SearchInput from '../components/SearchInput';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';
import Pagination from '../components/Pagination';
import PhoneInput from '../components/PhoneInput';
import { Client, PaginatedResponse } from '../types';

export default function ClientsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

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

  // Query
  const { data, isLoading } = useQuery<PaginatedResponse<Client>>({
    queryKey: ['clients', { search, page, limit }],
    queryFn: async () => {
      const res = await clientsApi.getAll({ search, page, limit });
      return res.data;
    },
  });

  // Mutations
  const createMutation = useMutation({
    mutationFn: (data: { fullName: string; phone: string; comment?: string }) =>
      clientsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      toast.success('Клиент создан');
      closeModal();
    },
    onError: () => {
      toast.error('Ошибка при создании клиента');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { fullName: string; phone: string; comment?: string } }) =>
      clientsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      toast.success('Клиент обновлён');
      closeModal();
    },
    onError: () => {
      toast.error('Ошибка при обновлении клиента');
    },
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

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const payload = { fullName, phone, comment: comment || undefined };
    if (editingClient) {
      updateMutation.mutate({ id: editingClient.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
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
        <button onClick={openCreateModal} className="btn-primary">
          <Plus className="w-4 h-4" />
          Новый клиент
        </button>
      </div>

      {/* Search */}
      <div className="mb-4">
        <SearchInput
          value={search}
          onChange={(val) => {
            setSearch(val);
            setPage(1);
          }}
          placeholder="Поиск по имени или телефону..."
        />
      </div>

      {/* Content */}
      {isLoading ? (
        <LoadingSpinner />
      ) : clients.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Нет клиентов"
          description={search ? 'По вашему запросу ничего не найдено' : 'Добавьте первого клиента'}
          action={
            !search
              ? { label: 'Добавить клиента', onClick: openCreateModal }
              : undefined
          }
        />
      ) : (
        <>
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Имя</th>
                  <th>Телефон</th>
                  <th>Кол-во авто</th>
                  <th>Дата</th>
                  <th className="w-24">Действия</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((client) => (
                  <tr
                    key={client.id}
                    onClick={() => navigate(`/clients/${client.id}`)}
                    className="cursor-pointer hover:bg-gray-50"
                  >
                    <td>
                      <div className="flex items-center gap-2">
                        <Users className="w-4 h-4 text-gray-400 flex-shrink-0" />
                        <span className="font-medium text-gray-900">
                          {client.fullName}
                        </span>
                      </div>
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <Phone className="w-4 h-4 text-gray-400 flex-shrink-0" />
                        <span className="text-gray-600">{client.phone}</span>
                      </div>
                    </td>
                    <td>
                      <span className="badge-info">
                        {client.cars?.length || 0}
                      </span>
                    </td>
                    <td>
                      <div className="flex items-center gap-2 text-gray-500">
                        <Calendar className="w-4 h-4 flex-shrink-0" />
                        {formatDate(client.createdAt)}
                      </div>
                    </td>
                    <td>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={(e) => openEditModal(client, e)}
                          className="p-1.5 text-gray-400 hover:text-primary-600 rounded-lg hover:bg-gray-100 transition-colors"
                          title="Редактировать"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={(e) => handleDelete(client.id, e)}
                          className="p-1.5 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors"
                          title="Удалить"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination
            page={page}
            total={total}
            limit={limit}
            onChange={setPage}
          />
        </>
      )}

      {/* Create/Edit Modal */}
      <Modal
        isOpen={modalOpen}
        onClose={closeModal}
        title={editingClient ? 'Редактировать клиента' : 'Новый клиент'}
      >
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
            <PhoneInput
              value={phone}
              onChange={setPhone}
              placeholder="+7 (___) ___-__-__"
              required
            />
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
              disabled={createMutation.isPending || updateMutation.isPending}
              className="btn-primary"
            >
              {editingClient ? 'Сохранить' : 'Создать'}
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
    </div>
  );
}
