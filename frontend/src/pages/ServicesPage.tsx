import { useState, FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Wrench, Edit2, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { servicesApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import SearchInput from '../components/SearchInput';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';
import Pagination from '../components/Pagination';
import { Service, PaginatedResponse, UserRole } from '../types';

const SERVICE_CATEGORIES: string[] = [];

export default function ServicesPage() {
  const queryClient = useQueryClient();
  const { hasPermission, user } = useAuth();
  // ROLE-ONLY: управление каталогом (add/edit/delete + %/гарантия) — только с
  // services_manage. Owner-class видит и делает всё. services_view (просмотр +
  // в чек) — у всех, кто сюда попал; backend всё равно вернёт 403 без права.
  const isOwnerClass =
    user?.role === UserRole.SUPERADMIN || user?.role === UserRole.DIRECTOR || user?.role === UserRole.ADMIN;
  const canManage = isOwnerClass || hasPermission('services_manage');

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
  const [masterPercent, setMasterPercent] = useState('');
  const [warrantyDays, setWarrantyDays] = useState('');

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
    mutationFn: (data: {
      name: string;
      category?: string;
      defaultPrice: number;
      masterPercent?: number | null;
      warrantyDays?: number | null;
    }) => servicesApi.create(data),
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
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: {
        name: string;
        category?: string;
        defaultPrice: number;
        masterPercent?: number | null;
        warrantyDays?: number | null;
      };
    }) => servicesApi.update(id, data),
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
    setMasterPercent('');
    setWarrantyDays('');
    setModalOpen(true);
  };

  const openEditModal = (service: Service, e: React.MouseEvent) => {
    e.stopPropagation();
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
    const pctVal = masterPercent.trim();
    const wdVal = warrantyDays.trim();
    const payload = {
      name,
      category: category || undefined,
      defaultPrice: Number(defaultPrice),
      masterPercent: pctVal === '' ? null : Number(pctVal),
      warrantyDays: wdVal === '' ? null : Math.max(0, Math.floor(Number(wdVal))),
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
  const avgPrice = services.length
    ? Math.round(services.reduce((sum, s) => sum + (s.defaultPrice || 0), 0) / services.length)
    : 0;
  const withWarranty = services.filter((s) => (s.warrantyDays ?? 0) > 0).length;

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ru-RU').format(amount);
  };

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <h1 className="page-title">Услуги</h1>
        {canManage && (
          <button onClick={openCreateModal} className="btn-primary">
            <Plus className="w-4 h-4" />
            Новая услуга
          </button>
        )}
      </div>

      {/* Search */}
      <div className="mb-4 max-w-md">
        <SearchInput
          value={search}
          onChange={(val) => {
            setSearch(val);
            setPage(1);
          }}
          placeholder="Поиск по названию услуги..."
        />
      </div>

      {/* Category Filter Tabs - dynamic from existing services */}
      {(() => {
        // No preset categories — filters only shown if categories exist in data
        return null;
      })()}

      {/* KPI strip */}
      {!isLoading && services.length > 0 && (
        <div className="grid grid-cols-3 gap-2.5 mb-4">
          <div className="rounded-xl bg-indigo-50 p-3">
            <p className="text-[10px] font-semibold text-indigo-500 uppercase tracking-wider">Всего услуг</p>
            <p className="text-base sm:text-lg font-bold text-indigo-700 mt-0.5">{total}</p>
          </div>
          <div className="rounded-xl bg-green-50 p-3">
            <p className="text-[10px] font-semibold text-green-500 uppercase tracking-wider">Средняя цена</p>
            <p className="text-base sm:text-lg font-bold text-green-700 mt-0.5">{formatCurrency(avgPrice)} ₽</p>
          </div>
          <div className="rounded-xl bg-orange-50 p-3">
            <p className="text-[10px] font-semibold text-orange-500 uppercase tracking-wider">С гарантией</p>
            <p className="text-base sm:text-lg font-bold text-orange-700 mt-0.5">{withWarranty}</p>
          </div>
        </div>
      )}

      {/* Content */}
      {isLoading ? (
        <LoadingSpinner />
      ) : services.length === 0 ? (
        <EmptyState
          icon={Wrench}
          title="Нет услуг"
          description={
            search || categoryFilter !== 'Все' ? 'По вашему запросу ничего не найдено' : 'Добавьте первую услугу'
          }
          action={
            canManage && !search && categoryFilter === 'Все'
              ? { label: 'Добавить услугу', onClick: openCreateModal }
              : undefined
          }
        />
      ) : (
        <>
          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {services.map((service) => (
              <div key={service.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-gray-900 text-sm">{service.name}</span>
                  {canManage && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={(e) => openEditModal(service, e)}
                        className="p-1.5 text-gray-400 hover:text-primary-600 rounded-lg"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={(e) => handleDelete(service.id, e)}
                        className="p-1.5 text-gray-400 hover:text-red-600 rounded-lg"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {service.category && <span className="badge-default text-[11px]">{service.category}</span>}
                  <span className="text-sm font-medium text-gray-900">{formatCurrency(service.defaultPrice)}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop table — dense, full-width */}
          <div className="hidden md:block table-container md:max-h-[70vh]">
            <table className="table [&_th]:sticky [&_th]:top-0 [&_th]:z-10">
              <thead>
                <tr>
                  <th>Название</th>
                  <th>Категория</th>
                  <th className="text-right">Цена по умолчанию</th>
                  {canManage && <th className="text-right">% мастера</th>}
                  <th className="text-right">Гарантия</th>
                  {canManage && <th className="w-24 text-right">Действия</th>}
                </tr>
              </thead>
              <tbody>
                {services.map((service) => (
                  <tr key={service.id}>
                    <td>
                      <div className="flex items-center gap-2">
                        <Wrench className="w-4 h-4 text-gray-400 flex-shrink-0" />
                        <span className="font-medium text-gray-900">{service.name}</span>
                      </div>
                    </td>
                    <td>
                      {service.category ? (
                        <span className="badge-default">{service.category}</span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="text-right font-medium text-gray-900">{formatCurrency(service.defaultPrice)} ₽</td>
                    {canManage && (
                      <td className="text-right">
                        {service.masterPercent != null ? (
                          <span className="font-medium text-gray-700">{service.masterPercent}%</span>
                        ) : (
                          <span className="text-gray-400">стандарт</span>
                        )}
                      </td>
                    )}
                    <td className="text-right">
                      {service.warrantyDays != null && service.warrantyDays > 0 ? (
                        <span className="badge-default">{service.warrantyDays} дн.</span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    {canManage && (
                      <td>
                        <div className="flex items-center justify-end gap-1">
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
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination page={page} total={total} limit={limit} onChange={setPage} />
        </>
      )}

      {/* Create/Edit Service Modal */}
      <Modal isOpen={modalOpen} onClose={closeModal} title={editingService ? 'Редактировать услугу' : 'Новая услуга'}>
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
            <input
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="input"
              placeholder="Например: Диагностика, ТО, Ходовая..."
            />
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

          <div>
            <label className="label">Особый % мастера</label>
            <input
              type="number"
              value={masterPercent}
              onChange={(e) => setMasterPercent(e.target.value)}
              className="input"
              placeholder="Оставьте пустым для стандартного процента"
              min="0"
              max="100"
              step="0.5"
            />
            <p className="text-xs text-gray-400 mt-1">
              Если заполнено — используется вместо стандартного процента мастера для этой услуги
            </p>
          </div>

          <div>
            <label className="label">Срок гарантии (дней)</label>
            <input
              type="number"
              value={warrantyDays}
              onChange={(e) => setWarrantyDays(e.target.value)}
              className="input"
              placeholder="Оставьте пустым — без гарантии"
              min="0"
              step="1"
            />
            <p className="text-xs text-gray-400 mt-1">
              Дней с момента продажи. На эту услугу можно будет оформить гарантийный возврат.
            </p>
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
