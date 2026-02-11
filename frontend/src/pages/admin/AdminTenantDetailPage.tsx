import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Building2,
  Phone,
  Mail,
  MapPin,
  Users,
  Calendar,
  Power,
  Pencil,
  Trash2,
  FileText,
  Hash,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { adminApi } from '../../api/services';
import type { Tenant, User } from '../../types';
import Modal from '../../components/Modal';
import ConfirmDialog from '../../components/ConfirmDialog';
import LoadingSpinner from '../../components/LoadingSpinner';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const roleLabels: Record<string, string> = {
  superadmin: 'Суперадмин',
  owner: 'Владелец',
  admin: 'Администратор',
  master: 'Мастер',
  storekeeper: 'Товаровед',
  accountant: 'Бухгалтер',
};

const roleBadgeColors: Record<string, string> = {
  superadmin: 'bg-red-50 text-red-700',
  owner: 'bg-purple-50 text-purple-700',
  admin: 'bg-blue-50 text-blue-700',
  master: 'bg-green-50 text-green-700',
  storekeeper: 'bg-yellow-50 text-yellow-700',
  accountant: 'bg-gray-100 text-gray-600',
};

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

function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ---------------------------------------------------------------------------
// Info row component
// ---------------------------------------------------------------------------

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Phone;
  label: string;
  value: string | number | undefined;
}) {
  return (
    <div className="flex items-start gap-3 py-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gray-100 text-gray-500 flex-shrink-0">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">{label}</p>
        <p className="mt-0.5 text-sm text-gray-900">{value || '--'}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit Tenant Modal
// ---------------------------------------------------------------------------

interface EditTenantForm {
  name: string;
  phone: string;
  email: string;
  address: string;
  description: string;
  maxUsers: number;
}

function EditTenantModal({
  isOpen,
  onClose,
  tenant,
}: {
  isOpen: boolean;
  onClose: () => void;
  tenant: Tenant;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<EditTenantForm>({
    name: tenant.name,
    phone: tenant.phone || '',
    email: tenant.email || '',
    address: tenant.address || '',
    description: tenant.description || '',
    maxUsers: tenant.maxUsers,
  });

  const updateMutation = useMutation({
    mutationFn: (data: EditTenantForm) => adminApi.updateTenant(tenant.id, data),
    onSuccess: () => {
      toast.success('Автосервис обновлён');
      queryClient.invalidateQueries({ queryKey: ['admin', 'tenant', tenant.id] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'tenants'] });
      onClose();
    },
    onError: () => {
      toast.error('Не удалось обновить автосервис');
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error('Название обязательно');
      return;
    }
    updateMutation.mutate(form);
  }

  function handleChange(field: keyof EditTenantForm, value: string | number) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Редактировать автосервис" size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
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
              required
              className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>

          {/* Phone */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Телефон</label>
            <input
              type="text"
              value={form.phone}
              onChange={(e) => handleChange('phone', e.target.value)}
              className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>

          {/* Email */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => handleChange('email', e.target.value)}
              className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>

          {/* Address */}
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Адрес</label>
            <input
              type="text"
              value={form.address}
              onChange={(e) => handleChange('address', e.target.value)}
              className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>

          {/* Description */}
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Описание</label>
            <textarea
              value={form.description}
              onChange={(e) => handleChange('description', e.target.value)}
              rows={3}
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

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 border-t border-gray-200 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50"
          >
            Отмена
          </button>
          <button
            type="submit"
            disabled={updateMutation.isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {updateMutation.isPending ? (
              <>
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Сохранение...
              </>
            ) : (
              'Сохранить'
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

export default function AdminTenantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);

  const {
    data: tenant,
    isLoading,
    isError,
  } = useQuery<Tenant>({
    queryKey: ['admin', 'tenant', id],
    queryFn: async () => {
      const res = await adminApi.getTenant(id!);
      return res.data;
    },
    enabled: !!id,
  });

  // Toggle active
  const toggleActiveMutation = useMutation({
    mutationFn: () =>
      tenant?.isActive
        ? adminApi.deactivateTenant(id!)
        : adminApi.activateTenant(id!),
    onSuccess: () => {
      toast.success(
        tenant?.isActive
          ? `${tenant.name} деактивирован`
          : `${tenant?.name} активирован`,
      );
      queryClient.invalidateQueries({ queryKey: ['admin', 'tenant', id] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'tenants'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'stats'] });
    },
    onError: () => {
      toast.error('Не удалось изменить статус');
    },
  });

  // Delete
  const deleteMutation = useMutation({
    mutationFn: () => adminApi.deleteTenant(id!),
    onSuccess: () => {
      toast.success('Автосервис удалён');
      queryClient.invalidateQueries({ queryKey: ['admin', 'tenants'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'stats'] });
      navigate('/tenants');
    },
    onError: () => {
      toast.error('Не удалось удалить автосервис');
    },
  });

  if (isLoading) {
    return <LoadingSpinner size="lg" />;
  }

  if (isError || !tenant) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-100">
          <Building2 className="h-7 w-7 text-red-500" />
        </div>
        <h2 className="mt-4 text-lg font-semibold text-gray-900">
          Автосервис не найден
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          Возможно, он был удалён или указан неверный ID
        </p>
        <button
          onClick={() => navigate('/tenants')}
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700"
        >
          <ArrowLeft className="h-4 w-4" />
          К списку автосервисов
        </button>
      </div>
    );
  }

  const users: User[] = tenant.users || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/tenants')}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-500 shadow-sm transition-colors hover:bg-gray-50 hover:text-gray-700"
            title="Назад"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">{tenant.name}</h1>
              {tenant.isActive ? (
                <span className="inline-flex items-center rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700">
                  Активен
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-700">
                  Неактивен
                </span>
              )}
            </div>
            <p className="mt-0.5 text-sm text-gray-500">
              ID: {tenant.id}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Toggle active */}
          <button
            onClick={() => toggleActiveMutation.mutate()}
            disabled={toggleActiveMutation.isPending}
            className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium shadow-sm transition-colors disabled:opacity-50 ${
              tenant.isActive
                ? 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100'
                : 'border-green-300 bg-green-50 text-green-700 hover:bg-green-100'
            }`}
          >
            <Power className="h-4 w-4" />
            {tenant.isActive ? 'Деактивировать' : 'Активировать'}
          </button>

          {/* Edit */}
          <button
            onClick={() => setIsEditOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700"
          >
            <Pencil className="h-4 w-4" />
            Редактировать
          </button>

          {/* Delete */}
          <button
            onClick={() => setIsDeleteOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-red-300 bg-white px-4 py-2.5 text-sm font-medium text-red-600 shadow-sm transition-colors hover:bg-red-50"
          >
            <Trash2 className="h-4 w-4" />
            Удалить
          </button>
        </div>
      </div>

      {/* Content grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Info card */}
        <div className="lg:col-span-1">
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-100 px-5 py-4">
              <h2 className="text-base font-semibold text-gray-900">Информация</h2>
            </div>
            <div className="divide-y divide-gray-100 px-5">
              <InfoRow icon={Building2} label="Название" value={tenant.name} />
              <InfoRow icon={Phone} label="Телефон" value={tenant.phone} />
              <InfoRow icon={Mail} label="Email" value={tenant.email} />
              <InfoRow icon={MapPin} label="Адрес" value={tenant.address} />
              <InfoRow icon={FileText} label="Описание" value={tenant.description} />
              <InfoRow icon={Hash} label="Макс. пользователей" value={tenant.maxUsers} />
              <InfoRow icon={Calendar} label="Дата создания" value={formatDateTime(tenant.createdAt)} />
            </div>
          </div>
        </div>

        {/* Users section */}
        <div className="lg:col-span-2">
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-gray-900">Пользователи</h2>
                <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                  {users.length}
                </span>
              </div>
            </div>

            {users.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
                  <Users className="h-6 w-6 text-gray-400" />
                </div>
                <p className="mt-3 text-sm font-medium text-gray-900">Нет пользователей</p>
                <p className="mt-1 text-sm text-gray-500">
                  У этого автосервиса пока нет зарегистрированных пользователей
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50/50">
                      <th className="px-5 py-3 font-medium text-gray-500">Имя пользователя</th>
                      <th className="px-5 py-3 font-medium text-gray-500">ФИО</th>
                      <th className="px-5 py-3 font-medium text-gray-500">Роль</th>
                      <th className="px-5 py-3 font-medium text-gray-500">Статус</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {users.map((user) => (
                      <tr key={user.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-3">
                            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-50 text-indigo-600 text-xs font-semibold">
                              {user.fullName?.charAt(0) || user.username.charAt(0).toUpperCase()}
                            </div>
                            <span className="font-medium text-gray-900">{user.username}</span>
                          </div>
                        </td>
                        <td className="px-5 py-3 text-gray-600">{user.fullName}</td>
                        <td className="px-5 py-3">
                          <span
                            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                              roleBadgeColors[user.role] || 'bg-gray-100 text-gray-600'
                            }`}
                          >
                            {roleLabels[user.role] || user.role}
                          </span>
                        </td>
                        <td className="px-5 py-3">
                          {user.isActive ? (
                            <span className="inline-flex items-center rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700">
                              Активен
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-700">
                              Неактивен
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Edit modal */}
      {isEditOpen && (
        <EditTenantModal
          isOpen={isEditOpen}
          onClose={() => setIsEditOpen(false)}
          tenant={tenant}
        />
      )}

      {/* Delete confirmation */}
      <ConfirmDialog
        isOpen={isDeleteOpen}
        onClose={() => setIsDeleteOpen(false)}
        onConfirm={() => deleteMutation.mutate()}
        title="Удалить автосервис"
        message={`Вы уверены, что хотите удалить "${tenant.name}"? Это действие необратимо. Все данные автосервиса, включая пользователей, клиентов и заказ-наряды, будут безвозвратно удалены.`}
        confirmText="Удалить"
        variant="danger"
      />
    </div>
  );
}
