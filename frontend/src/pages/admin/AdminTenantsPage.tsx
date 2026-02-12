import { useState } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Building2,
  Plus,
  Power,
  Trash2,
  Users,
  CalendarClock,
  ChevronRight,
  Search,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { adminApi } from '../../api/services';
import type { Tenant, PaginatedResponse } from '../../types';
import Modal from '../../components/Modal';
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

function getSubscriptionStatus(tenant: Tenant): {
  label: string;
  color: string;
  bg: string;
} {
  if (!tenant.subscriptionEnd) {
    return { label: 'Бессрочно', color: 'text-blue-700', bg: 'bg-blue-50' };
  }
  const end = new Date(tenant.subscriptionEnd);
  const now = new Date();
  const daysLeft = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (daysLeft < 0) {
    return { label: 'Истекла', color: 'text-red-700', bg: 'bg-red-50' };
  }
  if (daysLeft <= 7) {
    return { label: `${daysLeft} дн.`, color: 'text-orange-700', bg: 'bg-orange-50' };
  }
  return { label: `до ${formatDate(tenant.subscriptionEnd)}`, color: 'text-green-700', bg: 'bg-green-50' };
}

type StatusFilter = 'all' | 'active' | 'inactive' | 'expired';

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
  subscriptionEnd: string;
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
  subscriptionEnd: '',
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
    mutationFn: (data: CreateTenantForm) => adminApi.createTenant({
      ...data,
      subscriptionEnd: data.subscriptionEnd || undefined,
    }),
    onSuccess: () => {
      toast.success('Автосервис создан');
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

  const inputClass =
    'block w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20';

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Новый автосервис" size="lg">
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Section 1: Tenant info */}
        <div>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Информация
          </h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Название <span className="text-red-500">*</span>
              </label>
              <input type="text" value={form.name} onChange={(e) => handleChange('name', e.target.value)}
                placeholder="Например: Автосервис Прогресс" required className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Телефон</label>
              <input type="text" value={form.phone} onChange={(e) => handleChange('phone', e.target.value)}
                placeholder="+7 (999) 123-45-67" className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input type="email" value={form.email} onChange={(e) => handleChange('email', e.target.value)}
                placeholder="info@autoservice.ru" className={inputClass} />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Адрес</label>
              <input type="text" value={form.address} onChange={(e) => handleChange('address', e.target.value)}
                placeholder="г. Москва, ул. Примерная, д. 1" className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Макс. пользователей</label>
              <input type="number" min={1} max={100} value={form.maxUsers}
                onChange={(e) => handleChange('maxUsers', parseInt(e.target.value, 10) || 1)} className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Подписка до</label>
              <input type="date" value={form.subscriptionEnd}
                onChange={(e) => handleChange('subscriptionEnd', e.target.value)} className={inputClass} />
              <p className="text-[11px] text-gray-400 mt-1">Оставьте пустым для бессрочной</p>
            </div>
          </div>
        </div>

        <div className="border-t border-gray-200" />

        {/* Section 2: Owner account */}
        <div>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Аккаунт директора
          </h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                ФИО директора <span className="text-red-500">*</span>
              </label>
              <input type="text" value={form.ownerFullName} onChange={(e) => handleChange('ownerFullName', e.target.value)}
                placeholder="Иванов Иван Иванович" required className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Логин <span className="text-red-500">*</span>
              </label>
              <input type="text" value={form.ownerUsername} onChange={(e) => handleChange('ownerUsername', e.target.value)}
                placeholder="director_login" required className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Пароль <span className="text-red-500">*</span>
              </label>
              <input type="text" value={form.ownerPassword} onChange={(e) => handleChange('ownerPassword', e.target.value)}
                placeholder="Минимум 6 символов" required className={inputClass} />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-gray-200 pt-4">
          <button type="button" onClick={handleClose}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50">
            Отмена
          </button>
          <button type="submit" disabled={createMutation.isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50">
            {createMutation.isPending ? (
              <><div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />Создание...</>
            ) : (
              <><Plus className="h-4 w-4" />Создать</>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Tenant Card — for mobile-friendly list
// ---------------------------------------------------------------------------

function TenantCard({
  tenant,
  onNavigate,
  onToggleActive,
  onDelete,
}: {
  tenant: Tenant;
  onNavigate: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
}) {
  const sub = getSubscriptionStatus(tenant);
  const ownerUser = tenant.users?.find((u) => u.role === 'owner');
  const userCount = tenant.userCount ?? tenant.users?.length ?? 0;

  return (
    <div
      className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden hover:shadow-md transition-shadow cursor-pointer"
      onClick={onNavigate}
    >
      <div className="p-4">
        {/* Top row: name + status */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-bold text-gray-900 truncate">{tenant.name}</h3>
            {ownerUser && (
              <p className="text-[11px] text-gray-400 mt-0.5 truncate">
                {ownerUser.fullName}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {tenant.isActive ? (
              <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-700">
                Активен
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700">
                Откл.
              </span>
            )}
          </div>
        </div>

        {/* Stats row */}
        <div className="flex items-center gap-4 text-[12px] text-gray-500">
          <div className="flex items-center gap-1">
            <Users className="h-3.5 w-3.5" />
            <span>{userCount} чел.</span>
          </div>
          <div className="flex items-center gap-1">
            <CalendarClock className="h-3.5 w-3.5" />
            <span className={`font-medium ${sub.color}`}>{sub.label}</span>
          </div>
        </div>

        {/* Contact info */}
        {(tenant.phone || tenant.email) && (
          <div className="flex items-center gap-3 mt-2.5 text-[12px] text-gray-400">
            {tenant.phone && <span>{tenant.phone}</span>}
            {tenant.email && <span className="truncate">{tenant.email}</span>}
          </div>
        )}
      </div>

      {/* Footer actions */}
      <div
        className="flex items-center justify-between border-t border-gray-100 px-4 py-2"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="text-[11px] text-gray-400">{formatDate(tenant.createdAt)}</span>
        <div className="flex items-center gap-1">
          <button
            onClick={onToggleActive}
            className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${
              tenant.isActive
                ? 'text-amber-500 hover:bg-amber-50'
                : 'text-green-500 hover:bg-green-50'
            }`}
            title={tenant.isActive ? 'Деактивировать' : 'Активировать'}
          >
            <Power className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onDelete}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors"
            title="Удалить"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onNavigate}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
            title="Подробнее"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
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
  const limit = 20;

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

  let tenants = data?.data || [];
  const total = data?.total || 0;

  // Client-side filter for expired subscriptions
  if (statusFilter === 'expired') {
    tenants = tenants.filter((t) => {
      if (!t.subscriptionEnd) return false;
      return new Date(t.subscriptionEnd) < new Date();
    });
  }

  // Mutations
  const toggleActiveMutation = useMutation({
    mutationFn: (tenant: Tenant) =>
      tenant.isActive
        ? adminApi.deactivateTenant(tenant.id)
        : adminApi.activateTenant(tenant.id),
    onSuccess: (_data, tenant) => {
      toast.success(tenant.isActive ? `${tenant.name} деактивирован` : `${tenant.name} активирован`);
      queryClient.invalidateQueries({ queryKey: ['admin', 'tenants'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'stats'] });
    },
    onError: () => toast.error('Не удалось изменить статус'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => adminApi.deleteTenant(id),
    onSuccess: () => {
      toast.success('Автосервис удалён');
      queryClient.invalidateQueries({ queryKey: ['admin', 'tenants'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'stats'] });
      setDeleteTarget(null);
    },
    onError: () => toast.error('Не удалось удалить'),
  });

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
    { label: 'Откл.', value: 'inactive' },
    { label: 'Истекшие', value: 'expired' },
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Автосервисы</h1>
          <p className="mt-0.5 text-xs text-gray-500">
            {total} {total === 1 ? 'автосервис' : 'автосервисов'}
          </p>
        </div>
        <button
          onClick={() => setIsCreateOpen(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-700"
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Добавить</span>
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="Поиск по названию..."
          className="block w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-10 pr-4 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/10"
        />
      </div>

      {/* Filters */}
      <div className="flex gap-1.5 overflow-x-auto pb-0.5">
        {filterButtons.map((btn) => (
          <button
            key={btn.value}
            onClick={() => handleFilterChange(btn.value)}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
              statusFilter === btn.value
                ? 'bg-indigo-600 text-white'
                : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {btn.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {isLoading ? (
        <LoadingSpinner />
      ) : tenants.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="Автосервисы не найдены"
          description={
            search
              ? 'Попробуйте изменить запрос'
              : 'Добавьте первый автосервис'
          }
          action={
            !search ? (
              <button
                onClick={() => setIsCreateOpen(true)}
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-700"
              >
                <Plus className="h-4 w-4" />Добавить автосервис
              </button>
            ) : undefined
          }
        />
      ) : (
        <>
          {/* Cards grid */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {tenants.map((tenant) => (
              <TenantCard
                key={tenant.id}
                tenant={tenant}
                onNavigate={() => navigate(`/tenants/${tenant.id}`)}
                onToggleActive={() => toggleActiveMutation.mutate(tenant)}
                onDelete={() => setDeleteTarget(tenant)}
              />
            ))}
          </div>

          {/* Pagination */}
          {total > limit && (
            <div className="pt-2">
              <Pagination page={page} total={total} limit={limit} onChange={setPage} />
            </div>
          )}
        </>
      )}

      <CreateTenantModal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} />

      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        title="Удалить автосервис"
        message={`Удалить "${deleteTarget?.name}"? Все данные (пользователи, клиенты, заказ-наряды) будут удалены.`}
        confirmText="Удалить"
        variant="danger"
      />
    </div>
  );
}
