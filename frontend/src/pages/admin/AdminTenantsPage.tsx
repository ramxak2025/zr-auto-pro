import { useState } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Building2,
  Plus,
  Eye,
  Power,
  Trash2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { adminApi } from '../../api/services';
import type { Tenant, PaginatedResponse } from '../../types';
import Modal from '../../components/Modal';
import SearchInput from '../../components/SearchInput';
import Pagination from '../../components/Pagination';
import ConfirmDialog from '../../components/ConfirmDialog';
import LoadingSpinner from '../../components/LoadingSpinner';
import EmptyState from '../../components/EmptyState';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

type StatusFilter = 'all' | 'active' | 'inactive';

// ---------------------------------------------------------------------------
// Create Tenant Modal
// ---------------------------------------------------------------------------

interface CreateTenantForm {
  name: string;
  phone: string;
  email: string;
  address: string;
  description: string;
  maxUsers: number;
  ownerUsername: string;
  ownerPassword: string;
  ownerFullName: string;
}

const emptyForm: CreateTenantForm = {
  name: '',
  phone: '',
  email: '',
  address: '',
  description: '',
  maxUsers: 5,
  ownerUsername: '',
  ownerPassword: '',
  ownerFullName: '',
};

function CreateTenantModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<CreateTenantForm>(emptyForm);

  const createMutation = useMutation({
    mutationFn: (data: CreateTenantForm) => adminApi.createTenant(data),
    onSuccess: () => {
      toast.success('Автосервис успешно создан');
      queryClient.invalidateQueries({ queryKey: ['admin', 'tenants'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'stats'] });
      setForm(emptyForm);
      onClose();
    },
    onError: () => {
      toast.error('Не удалось создать автосервис');
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.ownerUsername.trim() || !form.ownerPassword.trim() || !form.ownerFullName.trim()) {
      toast.error('Заполните все обязательные поля');
      return;
    }
    createMutation.mutate(form);
  }

  function handleChange(field: keyof CreateTenantForm, value: string | number) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function handleClose() {
    setForm(emptyForm);
    onClose();
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Добавить автосервис" size="lg">
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Section 1: Tenant info */}
        <div>
          <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-4">
            Информация об автосервисе
          </h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Name */}
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Название <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => handleChange('name', e.target.value)}
                placeholder="Например: Автосервис Прогресс"
                required
                className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>

            {/* Phone */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Телефон
              </label>
              <input
                type="text"
                value={form.phone}
                onChange={(e) => handleChange('phone', e.target.value)}
                placeholder="+7 (999) 123-45-67"
                className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>

            {/* Email */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Email
              </label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => handleChange('email', e.target.value)}
                placeholder="info@autoservice.ru"
                className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>

            {/* Address */}
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Адрес
              </label>
              <input
                type="text"
                value={form.address}
                onChange={(e) => handleChange('address', e.target.value)}
                placeholder="г. Москва, ул. Примерная, д. 1"
                className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>

            {/* Description */}
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Описание
              </label>
              <textarea
                value={form.description}
                onChange={(e) => handleChange('description', e.target.value)}
                rows={3}
                placeholder="Краткое описание автосервиса..."
                className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 resize-none"
              />
            </div>

            {/* Max Users */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Макс. пользователей
              </label>
              <input
                type="number"
                min={1}
                max={100}
                value={form.maxUsers}
                onChange={(e) => handleChange('maxUsers', parseInt(e.target.value, 10) || 1)}
                className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-gray-200" />

        {/* Section 2: Owner account */}
        <div>
          <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-4">
            Аккаунт владельца
          </h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Owner Full Name */}
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                ФИО владельца <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={form.ownerFullName}
                onChange={(e) => handleChange('ownerFullName', e.target.value)}
                placeholder="Иванов Иван Иванович"
                required
                className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>

            {/* Owner Username */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Имя пользователя <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={form.ownerUsername}
                onChange={(e) => handleChange('ownerUsername', e.target.value)}
                placeholder="owner_login"
                required
                className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>

            {/* Owner Password */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Пароль <span className="text-red-500">*</span>
              </label>
              <input
                type="password"
                value={form.ownerPassword}
                onChange={(e) => handleChange('ownerPassword', e.target.value)}
                placeholder="Минимум 6 символов"
                required
                className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 border-t border-gray-200 pt-4">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50"
          >
            Отмена
          </button>
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {createMutation.isPending ? (
              <>
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Создание...
              </>
            ) : (
              <>
                <Plus className="h-4 w-4" />
                Создать автосервис
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function AdminTenantsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [page, setPage] = useState(1);
  const limit = 10;

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Tenant | null>(null);

  // Build query params
  const params: Record<string, any> = { page, limit };
  if (search.trim()) params.search = search.trim();
  if (statusFilter === 'active') params.isActive = true;
  if (statusFilter === 'inactive') params.isActive = false;

  const { data, isLoading } = useQuery<PaginatedResponse<Tenant>>({
    queryKey: ['admin', 'tenants', params],
    queryFn: async () => {
      const res = await adminApi.getTenants(params);
      return res.data;
    },
    placeholderData: keepPreviousData,
  });

  const tenants = data?.data || [];
  const total = data?.total || 0;

  // Activate / Deactivate mutation
  const toggleActiveMutation = useMutation({
    mutationFn: (tenant: Tenant) =>
      tenant.isActive
        ? adminApi.deactivateTenant(tenant.id)
        : adminApi.activateTenant(tenant.id),
    onSuccess: (_data, tenant) => {
      toast.success(
        tenant.isActive
          ? `${tenant.name} деактивирован`
          : `${tenant.name} активирован`,
      );
      queryClient.invalidateQueries({ queryKey: ['admin', 'tenants'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'stats'] });
    },
    onError: () => {
      toast.error('Не удалось изменить статус');
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (id: string) => adminApi.deleteTenant(id),
    onSuccess: () => {
      toast.success('Автосервис удалён');
      queryClient.invalidateQueries({ queryKey: ['admin', 'tenants'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'stats'] });
      setDeleteTarget(null);
    },
    onError: () => {
      toast.error('Не удалось удалить автосервис');
    },
  });

  // Reset page when search or filter changes
  function handleSearchChange(v: string) {
    setSearch(v);
    setPage(1);
  }

  function handleFilterChange(filter: StatusFilter) {
    setStatusFilter(filter);
    setPage(1);
  }

  const filterButtons: { label: string; value: StatusFilter }[] = [
    { label: 'Все', value: 'all' },
    { label: 'Активные', value: 'active' },
    { label: 'Неактивные', value: 'inactive' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Автосервисы</h1>
          <p className="mt-1 text-sm text-gray-500">
            Управление автосервисами платформы
          </p>
        </div>
        <button
          onClick={() => setIsCreateOpen(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700"
        >
          <Plus className="h-4 w-4" />
          Добавить автосервис
        </button>
      </div>

      {/* Toolbar: search + filter */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="w-full max-w-sm">
          <SearchInput
            value={search}
            onChange={handleSearchChange}
            placeholder="Поиск по названию..."
          />
        </div>
        <div className="inline-flex rounded-lg border border-gray-300 bg-white shadow-sm">
          {filterButtons.map((btn) => (
            <button
              key={btn.value}
              onClick={() => handleFilterChange(btn.value)}
              className={`px-4 py-2 text-sm font-medium transition-colors first:rounded-l-lg last:rounded-r-lg ${
                statusFilter === btn.value
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              {btn.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        {isLoading ? (
          <LoadingSpinner />
        ) : tenants.length === 0 ? (
          <EmptyState
            icon={Building2}
            title="Автосервисы не найдены"
            description={
              search
                ? 'Попробуйте изменить запрос поиска'
                : 'Добавьте первый автосервис для начала работы'
            }
            action={
              !search ? (
                <button
                  onClick={() => setIsCreateOpen(true)}
                  className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700"
                >
                  <Plus className="h-4 w-4" />
                  Добавить автосервис
                </button>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/50">
                    <th className="px-4 py-3 font-medium text-gray-500">Название</th>
                    <th className="px-4 py-3 font-medium text-gray-500">Email</th>
                    <th className="px-4 py-3 font-medium text-gray-500">Телефон</th>
                    <th className="px-4 py-3 font-medium text-gray-500 text-center">Пользователей</th>
                    <th className="px-4 py-3 font-medium text-gray-500">Статус</th>
                    <th className="px-4 py-3 font-medium text-gray-500">Дата создания</th>
                    <th className="px-4 py-3 font-medium text-gray-500 text-right">Действия</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {tenants.map((tenant) => (
                    <tr
                      key={tenant.id}
                      className="hover:bg-gray-50 transition-colors cursor-pointer"
                      onClick={() => navigate(`/tenants/${tenant.id}`)}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                            <Building2 className="h-4 w-4" />
                          </div>
                          <span className="font-medium text-gray-900">{tenant.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{tenant.email || '--'}</td>
                      <td className="px-4 py-3 text-gray-600">{tenant.phone || '--'}</td>
                      <td className="px-4 py-3 text-center text-gray-600">
                        {tenant.users?.length ?? '--'}
                      </td>
                      <td className="px-4 py-3">
                        {tenant.isActive ? (
                          <span className="inline-flex items-center rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700">
                            Активен
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-700">
                            Неактивен
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-500">{formatDate(tenant.createdAt)}</td>
                      <td className="px-4 py-3">
                        <div
                          className="flex items-center justify-end gap-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {/* View */}
                          <button
                            onClick={() => navigate(`/tenants/${tenant.id}`)}
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                            title="Просмотр"
                          >
                            <Eye className="h-4 w-4" />
                          </button>

                          {/* Activate / Deactivate */}
                          <button
                            onClick={() => toggleActiveMutation.mutate(tenant)}
                            className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
                              tenant.isActive
                                ? 'text-amber-500 hover:bg-amber-50 hover:text-amber-600'
                                : 'text-green-500 hover:bg-green-50 hover:text-green-600'
                            }`}
                            title={tenant.isActive ? 'Деактивировать' : 'Активировать'}
                          >
                            <Power className="h-4 w-4" />
                          </button>

                          {/* Delete */}
                          <button
                            onClick={() => setDeleteTarget(tenant)}
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

            {/* Pagination */}
            <div className="border-t border-gray-100 px-4">
              <Pagination
                page={page}
                total={total}
                limit={limit}
                onChange={setPage}
              />
            </div>
          </>
        )}
      </div>

      {/* Create modal */}
      <CreateTenantModal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} />

      {/* Delete confirmation */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        title="Удалить автосервис"
        message={`Вы уверены, что хотите удалить "${deleteTarget?.name}"? Это действие необратимо. Все данные автосервиса, включая пользователей, клиентов и заказ-наряды, будут удалены.`}
        confirmText="Удалить"
        variant="danger"
      />
    </div>
  );
}
