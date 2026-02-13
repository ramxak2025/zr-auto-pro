import { useState, FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Wrench,
} from 'lucide-react';
import { servicesApi } from '../api/services';
import { getApiError } from '../api/axios';
import type { Service, PaginatedResponse } from '../types';
import SearchInput from '../components/SearchInput';
import Pagination from '../components/Pagination';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';
import LoadingSpinner from '../components/LoadingSpinner';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatMoney(value: number): string {
  return value.toLocaleString('ru-RU') + ' \u20BD';
}

// ---------------------------------------------------------------------------
// Service Form Modal
// ---------------------------------------------------------------------------

interface ServiceFormData {
  name: string;
  category: string;
  defaultPrice: number;
}

interface ServiceFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  service?: Service | null;
  onSubmit: (data: ServiceFormData) => void;
  isLoading: boolean;
}

function ServiceFormModal({
  isOpen,
  onClose,
  service,
  onSubmit,
  isLoading,
}: ServiceFormModalProps) {
  const [name, setName] = useState(service?.name || '');
  const [category, setCategory] = useState(service?.category || '');
  const [defaultPrice, setDefaultPrice] = useState(
    service?.defaultPrice?.toString() || '0',
  );

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('Введите название услуги');
      return;
    }
    onSubmit({
      name: name.trim(),
      category: category.trim(),
      defaultPrice: parseFloat(defaultPrice) || 0,
    });
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={service ? 'Редактировать услугу' : 'Новая услуга'}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Название <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Название услуги"
            className="block w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Категория
          </label>
          <input
            type="text"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="Категория услуги"
            className="block w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Цена по умолчанию
          </label>
          <input
            type="number"
            value={defaultPrice}
            onChange={(e) => setDefaultPrice(e.target.value)}
            min="0"
            step="0.01"
            className="block w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900 shadow-sm transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
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
            {service ? 'Сохранить' : 'Создать'}
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

export default function ServicesPage() {
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  // Modal state
  const [formOpen, setFormOpen] = useState(false);
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Service | null>(null);

  // ---- Queries ----

  const {
    data: servicesData,
    isLoading,
    isError,
  } = useQuery<PaginatedResponse<Service>>({
    queryKey: ['services', { search, page }],
    queryFn: async () => {
      const res = await servicesApi.getAll({
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
    mutationFn: (data: ServiceFormData) => servicesApi.create(data),
    onSuccess: () => {
      toast.success('Услуга создана');
      queryClient.invalidateQueries({ queryKey: ['services'] });
      closeForm();
    },
    onError: (err) => toast.error(getApiError(err, 'Не удалось создать услугу')),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: ServiceFormData }) =>
      servicesApi.update(id, data),
    onSuccess: () => {
      toast.success('Услуга обновлена');
      queryClient.invalidateQueries({ queryKey: ['services'] });
      closeForm();
    },
    onError: (err) => toast.error(getApiError(err, 'Не удалось обновить услугу')),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => servicesApi.delete(id),
    onSuccess: () => {
      toast.success('Услуга удалена');
      queryClient.invalidateQueries({ queryKey: ['services'] });
      setDeleteTarget(null);
    },
    onError: (err) => toast.error(getApiError(err, 'Не удалось удалить услугу')),
  });

  // ---- Handlers ----

  function openCreate() {
    setEditingService(null);
    setFormOpen(true);
  }

  function openEdit(service: Service) {
    setEditingService(service);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingService(null);
  }

  function handleFormSubmit(data: ServiceFormData) {
    if (editingService) {
      updateMutation.mutate({ id: editingService.id, data });
    } else {
      createMutation.mutate(data);
    }
  }

  function handleSearchChange(v: string) {
    setSearch(v);
    setPage(1);
  }

  const services = servicesData?.data || [];
  const total = servicesData?.total || 0;
  const isMutating = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Услуги</h1>
          <p className="text-xs text-gray-400 mt-0.5">Всего: {total}</p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary-700 active:scale-[0.97]"
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Добавить</span>
        </button>
      </div>

      {/* Search */}
      <div className="max-w-full sm:max-w-sm">
        <SearchInput
          value={search}
          onChange={handleSearchChange}
          placeholder="Поиск по названию..."
        />
      </div>

      {/* Content */}
      {isLoading ? (
        <LoadingSpinner />
      ) : isError ? (
        <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
          <p className="text-sm">Не удалось загрузить список услуг</p>
        </div>
      ) : services.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white">
          <EmptyState
            icon={Wrench}
            title={search ? 'Ничего не найдено' : 'Нет услуг'}
            description={
              search
                ? 'Попробуйте изменить параметры поиска'
                : 'Добавьте первую услугу'
            }
            action={
              !search ? (
                <button
                  onClick={openCreate}
                  className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-700"
                >
                  <Plus className="h-4 w-4" />
                  Добавить услугу
                </button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <>
          {/* Mobile card list */}
          <div className="md:hidden space-y-1.5">
            {services.map((service) => (
              <div key={service.id} className="flex items-center gap-3 bg-white rounded-xl border border-gray-100 px-3 py-3 shadow-sm">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 flex-shrink-0">
                  <Wrench className="h-4 w-4 text-emerald-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{service.name}</p>
                  {service.category && (
                    <p className="text-[11px] text-gray-400 mt-0.5">{service.category}</p>
                  )}
                </div>
                <span className="text-sm font-bold text-gray-900 flex-shrink-0">{formatMoney(service.defaultPrice)}</span>
                <div className="flex items-center gap-0.5 flex-shrink-0">
                  <button onClick={() => openEdit(service)} className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:text-primary-600 hover:bg-primary-50 transition-colors">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => setDeleteTarget(service)} className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50/50">
                    <th className="px-4 py-3 font-semibold text-gray-600">Название</th>
                    <th className="px-4 py-3 font-semibold text-gray-600">Категория</th>
                    <th className="px-4 py-3 font-semibold text-gray-600 text-right">Цена</th>
                    <th className="px-4 py-3 font-semibold text-gray-600 text-right">Действия</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {services.map((service) => (
                    <tr key={service.id} className="transition-colors hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{service.name}</td>
                      <td className="px-4 py-3 text-gray-600">{service.category || '\u2014'}</td>
                      <td className="px-4 py-3 text-right font-medium text-gray-900">{formatMoney(service.defaultPrice)}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => openEdit(service)} className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600" title="Редактировать">
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button onClick={() => setDeleteTarget(service)} className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600" title="Удалить">
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
        <ServiceFormModal
          key={editingService?.id || 'new'}
          isOpen={formOpen}
          onClose={closeForm}
          service={editingService}
          onSubmit={handleFormSubmit}
          isLoading={isMutating}
        />
      )}

      {/* Delete Confirm */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        title="Удалить услугу"
        message={`Вы уверены, что хотите удалить услугу "${deleteTarget?.name}"? Это действие нельзя отменить.`}
        confirmText="Удалить"
        variant="danger"
      />
    </div>
  );
}
