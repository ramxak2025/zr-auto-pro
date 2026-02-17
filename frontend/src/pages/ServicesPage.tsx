import { useState, FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Wrench, Edit2, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { servicesApi } from '../api/services';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import SearchInput from '../components/SearchInput';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';
import Pagination from '../components/Pagination';
import { Service, PaginatedResponse } from '../types';

const SERVICE_CATEGORIES = [
  'Все',
  'Диагностика',
  'ТО',
  'Ремонт двигателя',
  'Ходовая',
  'Электрика',
  'Кузовные работы',
  'Шиномонтаж',
  'Другое',
];

export default function ServicesPage() {
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [categoryFilter, setCategoryFilter] = useState('Все');
  const limit = 20;

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingService, setEditingService] = useState<Service | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [defaultPrice, setDefaultPrice] = useState('');

  // Delete confirm
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Query
  const { data, isLoading } = useQuery<PaginatedResponse<Service>>({
    queryKey: ['services', { search, page, limit, category: categoryFilter === 'Все' ? undefined : categoryFilter }],
    queryFn: async () => {
      const params: any = { search, page, limit };
      if (categoryFilter !== 'Все') {
        params.category = categoryFilter;
      }
      const res = await servicesApi.getAll(params);
      return res.data;
    },
  });

  // Mutations
  const createMutation = useMutation({
    mutationFn: (data: { name: string; category?: string; defaultPrice: number }) =>
      servicesApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['services'] });
      toast.success('Услуга создана');
      closeModal();
    },
    onError: () => {
      toast.error('Ошибка при создании услуги');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { name: string; category?: string; defaultPrice: number } }) =>
      servicesApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['services'] });
      toast.success('Услуга обновлена');
      closeModal();
    },
    onError: () => {
      toast.error('Ошибка при обновлении услуги');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => servicesApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['services'] });
      toast.success('Услуга удалена');
    },
    onError: () => {
      toast.error('Ошибка при удалении услуги');
    },
  });

  // Modal handlers
  const openCreateModal = () => {
    setEditingService(null);
    setName('');
    setCategory('');
    setDefaultPrice('');
    setModalOpen(true);
  };

  const openEditModal = (service: Service, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingService(service);
    setName(service.name);
    setCategory(service.category || '');
    setDefaultPrice(String(service.defaultPrice));
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingService(null);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const payload = {
      name,
      category: category || undefined,
      defaultPrice: Number(defaultPrice),
    };
    if (editingService) {
      updateMutation.mutate({ id: editingService.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  // Delete handlers
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

  const services = data?.data || [];
  const total = data?.total || 0;

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ru-RU').format(amount);
  };

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <h1 className="page-title">Услуги</h1>
        <button onClick={openCreateModal} className="btn-primary">
          <Plus className="w-4 h-4" />
          Новая услуга
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
          placeholder="Поиск по названию услуги..."
        />
      </div>

      {/* Category Filter Tabs */}
      <div className="flex flex-wrap gap-2 mb-4">
        {SERVICE_CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => {
              setCategoryFilter(cat);
              setPage(1);
            }}
            className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${
              categoryFilter === cat
                ? 'bg-primary-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Content */}
      {isLoading ? (
        <LoadingSpinner />
      ) : services.length === 0 ? (
        <EmptyState
          icon={Wrench}
          title="Нет услуг"
          description={
            search || categoryFilter !== 'Все'
              ? 'По вашему запросу ничего не найдено'
              : 'Добавьте первую услугу'
          }
          action={
            !search && categoryFilter === 'Все'
              ? { label: 'Добавить услугу', onClick: openCreateModal }
              : undefined
          }
        />
      ) : (
        <>
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Название</th>
                  <th>Категория</th>
                  <th>Цена по умолчанию</th>
                  <th className="w-24">Действия</th>
                </tr>
              </thead>
              <tbody>
                {services.map((service) => (
                  <tr key={service.id}>
                    <td>
                      <div className="flex items-center gap-2">
                        <Wrench className="w-4 h-4 text-gray-400 flex-shrink-0" />
                        <span className="font-medium text-gray-900">
                          {service.name}
                        </span>
                      </div>
                    </td>
                    <td>
                      {service.category ? (
                        <span className="badge-default">{service.category}</span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="font-medium text-gray-900">
                      {formatCurrency(service.defaultPrice)} сум
                    </td>
                    <td>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={(e) => openEditModal(service, e)}
                          className="p-1.5 text-gray-400 hover:text-primary-600 rounded-lg hover:bg-gray-100 transition-colors"
                          title="Редактировать"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={(e) => handleDelete(service.id, e)}
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

      {/* Create/Edit Service Modal */}
      <Modal
        isOpen={modalOpen}
        onClose={closeModal}
        title={editingService ? 'Редактировать услугу' : 'Новая услуга'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Название</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input"
              placeholder="Название услуги"
              required
            />
          </div>

          <div>
            <label className="label">Категория</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="input"
            >
              <option value="">Без категории</option>
              {SERVICE_CATEGORIES.filter((c) => c !== 'Все').map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">Цена по умолчанию</label>
            <input
              type="number"
              value={defaultPrice}
              onChange={(e) => setDefaultPrice(e.target.value)}
              className="input"
              placeholder="0"
              min="0"
              required
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
              {editingService ? 'Сохранить' : 'Создать'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirm */}
      <ConfirmDialog
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={confirmDelete}
        title="Удалить услугу"
        message="Вы уверены, что хотите удалить эту услугу? Это действие нельзя отменить."
        confirmText="Удалить"
        variant="danger"
      />
    </div>
  );
}
