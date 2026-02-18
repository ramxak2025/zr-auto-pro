import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Plus, Pencil, Trash2, Building2, Loader2, UserPlus } from 'lucide-react';
import toast from 'react-hot-toast';
import { format, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';

import { tenantsApi } from '../../api/services';
import { Tenant } from '../../types';
import Modal from '../../components/Modal';
import ConfirmDialog from '../../components/ConfirmDialog';
import LoadingSpinner from '../../components/LoadingSpinner';
import EmptyState from '../../components/EmptyState';

interface TenantFormData {
  name: string;
  phone: string;
  address: string;
  email: string;
  description: string;
  maxUsers: number;
  isActive: boolean;
  subscriptionEnd: string;
  subscriptionNote: string;
  directorName: string;
  directorPhone: string;
  directorPassword: string;
}

const emptyForm: TenantFormData = {
  name: '',
  phone: '',
  address: '',
  email: '',
  description: '',
  maxUsers: 5,
  isActive: true,
  subscriptionEnd: '',
  subscriptionNote: '',
  directorName: '',
  directorPhone: '',
  directorPassword: '',
};

function formatPhone(raw: string): string {
  let digits = raw.replace(/\D/g, '');
  if (digits.length > 0 && digits[0] === '8') {
    digits = '7' + digits.slice(1);
  }
  if (digits.length === 0) return '';
  if (digits.length <= 1) return `+${digits}`;
  if (digits.length <= 4) return `+${digits.slice(0, 1)} (${digits.slice(1)}`;
  if (digits.length <= 7)
    return `+${digits.slice(0, 1)} (${digits.slice(1, 4)}) ${digits.slice(4)}`;
  if (digits.length <= 9)
    return `+${digits.slice(0, 1)} (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  return `+${digits.slice(0, 1)} (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9, 11)}`;
}

export default function AdminTenantsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [modalOpen, setModalOpen] = useState(false);
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null);
  const [form, setForm] = useState<TenantFormData>({ ...emptyForm });
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['tenants'],
    queryFn: () => tenantsApi.getAll(),
    select: (res) => res.data as Tenant[],
  });

  const tenants = data ?? [];

  const createMutation = useMutation({
    mutationFn: (data: any) => tenantsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenants'] });
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
      toast.success('Организация создана');
      closeModal();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Ошибка создания организации');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => tenantsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenants'] });
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
      toast.success('Организация обновлена');
      closeModal();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Ошибка обновления');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => tenantsApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenants'] });
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
      toast.success('Организация удалена');
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Ошибка удаления');
    },
  });

  const openCreate = () => {
    setEditingTenant(null);
    setForm({ ...emptyForm });
    setModalOpen(true);
  };

  const openEdit = (tenant: Tenant) => {
    setEditingTenant(tenant);
    setForm({
      name: tenant.name,
      phone: tenant.phone || '',
      address: tenant.address || '',
      email: tenant.email || '',
      description: tenant.description || '',
      maxUsers: tenant.maxUsers,
      isActive: tenant.isActive,
      subscriptionEnd: tenant.subscriptionEnd
        ? tenant.subscriptionEnd.slice(0, 10)
        : '',
      subscriptionNote: tenant.subscriptionNote || '',
      directorName: '',
      directorPhone: '',
      directorPassword: '',
    });
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingTenant(null);
    setForm({ ...emptyForm });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error('Введите название организации');
      return;
    }

    const isCreating = !editingTenant;

    if (isCreating && !form.directorPhone.trim()) {
      toast.error('Введите телефон директора');
      return;
    }
    if (isCreating && !form.directorPassword.trim()) {
      toast.error('Введите пароль директора');
      return;
    }

    const payload: any = {
      name: form.name,
      phone: form.phone || undefined,
      address: form.address || undefined,
      email: form.email || undefined,
      description: form.description || undefined,
      maxUsers: Number(form.maxUsers),
      isActive: form.isActive,
      subscriptionEnd: form.subscriptionEnd || null,
      subscriptionNote: form.subscriptionNote || null,
    };

    if (isCreating) {
      payload.directorName = form.directorName || undefined;
      payload.directorPhone = form.directorPhone;
      payload.directorPassword = form.directorPassword;
    }

    if (editingTenant) {
      updateMutation.mutate({ id: editingTenant.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  if (isLoading) return <LoadingSpinner />;

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <h1 className="page-title">Организации</h1>
        <button onClick={openCreate} className="btn-primary">
          <Plus className="w-4 h-4" />
          Новая организация
        </button>
      </div>

      {/* Table */}
      {tenants.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="Нет организаций"
          description="Создайте первую организацию"
          action={{ label: 'Создать', onClick: openCreate }}
        />
      ) : (
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Название</th>
                <th>Slug</th>
                <th>Телефон</th>
                <th>Пользователей</th>
                <th>Статус</th>
                <th>Подписка до</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((tenant) => (
                <tr
                  key={tenant.id}
                  className="cursor-pointer"
                  onClick={() => navigate(`/admin/tenants/${tenant.id}`)}
                >
                  <td className="font-medium text-gray-900">{tenant.name}</td>
                  <td className="text-gray-500">{tenant.slug || '-'}</td>
                  <td>{tenant.phone || '-'}</td>
                  <td>
                    <span className="badge-blue">
                      {tenant.userCount ?? tenant.users?.length ?? 0} / {tenant.maxUsers}
                    </span>
                  </td>
                  <td>
                    {tenant.isActive ? (
                      <span className="badge-green">Активна</span>
                    ) : (
                      <span className="badge-red">Неактивна</span>
                    )}
                  </td>
                  <td>
                    {tenant.subscriptionEnd ? (
                      <span className="text-sm">
                        {format(parseISO(tenant.subscriptionEnd), 'd MMM yyyy', { locale: ru })}
                      </span>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                  <td>
                    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => openEdit(tenant)}
                        className="p-1.5 text-gray-400 hover:text-primary-600 rounded-lg hover:bg-gray-100 transition-colors"
                        title="Редактировать"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setDeleteId(tenant.id)}
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
      )}

      {/* Create / Edit Modal */}
      <Modal
        isOpen={modalOpen}
        onClose={closeModal}
        title={editingTenant ? 'Редактировать организацию' : 'Новая организация'}
        size="lg"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div>
            <label className="label">Название</label>
            <input
              type="text"
              className="input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="ООО Автосервис"
              required
            />
          </div>

          {/* Phone */}
          <div>
            <label className="label">Телефон организации</label>
            <input
              type="tel"
              className="input"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="+7 (XXX) XXX-XX-XX"
            />
          </div>

          {/* Address */}
          <div>
            <label className="label">Адрес</label>
            <input
              type="text"
              className="input"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              placeholder="Город, улица, дом"
            />
          </div>

          {/* Email */}
          <div>
            <label className="label">Email</label>
            <input
              type="email"
              className="input"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="info@example.com"
            />
          </div>

          {/* Description */}
          <div>
            <label className="label">Описание</label>
            <textarea
              className="input"
              rows={2}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Краткое описание"
            />
          </div>

          {/* Director section — only for new tenants */}
          {!editingTenant && (
            <div className="bg-primary-50 rounded-xl p-4 space-y-3 border border-primary-100">
              <div className="flex items-center gap-2 text-primary-700 font-medium text-sm">
                <UserPlus className="w-4 h-4" />
                Директор (владелец автосервиса)
              </div>

              <div>
                <label className="label">ФИО директора</label>
                <input
                  type="text"
                  className="input"
                  value={form.directorName}
                  onChange={(e) => setForm({ ...form, directorName: e.target.value })}
                  placeholder="Иванов Иван Иванович"
                />
              </div>

              <div>
                <label className="label">Телефон директора (для входа) *</label>
                <input
                  type="tel"
                  inputMode="numeric"
                  className="input"
                  value={form.directorPhone}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, '');
                    setForm({ ...form, directorPhone: formatPhone(digits) });
                  }}
                  placeholder="+7 (XXX) XXX-XX-XX"
                  required
                />
              </div>

              <div>
                <label className="label">Пароль директора *</label>
                <input
                  type="text"
                  className="input"
                  value={form.directorPassword}
                  onChange={(e) => setForm({ ...form, directorPassword: e.target.value })}
                  placeholder="Минимум 4 символа"
                  required
                />
              </div>
            </div>
          )}

          {/* Max Users */}
          <div>
            <label className="label">Максимум пользователей</label>
            <input
              type="number"
              className="input"
              value={form.maxUsers}
              onChange={(e) => setForm({ ...form, maxUsers: Number(e.target.value) })}
              min={1}
            />
          </div>

          {/* Active Toggle */}
          <div className="flex items-center gap-3">
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                className="sr-only peer"
                checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary-500/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600" />
            </label>
            <span className="text-sm font-medium text-gray-700">
              {form.isActive ? 'Активна' : 'Неактивна'}
            </span>
          </div>

          {/* Subscription End */}
          <div>
            <label className="label">Подписка до</label>
            <input
              type="date"
              className="input"
              value={form.subscriptionEnd}
              onChange={(e) => setForm({ ...form, subscriptionEnd: e.target.value })}
            />
          </div>

          {/* Subscription Note */}
          <div>
            <label className="label">Примечание к подписке</label>
            <input
              type="text"
              className="input"
              value={form.subscriptionNote}
              onChange={(e) => setForm({ ...form, subscriptionNote: e.target.value })}
              placeholder="Например: Оплачено до марта"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200">
            <button type="button" onClick={closeModal} className="btn-secondary">
              Отмена
            </button>
            <button type="submit" disabled={isSaving} className="btn-primary">
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Сохранение...
                </>
              ) : editingTenant ? (
                'Сохранить'
              ) : (
                'Создать'
              )}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => {
          if (deleteId) deleteMutation.mutate(deleteId);
          setDeleteId(null);
        }}
        title="Удалить организацию"
        message="Вы уверены, что хотите удалить эту организацию? Все данные будут потеряны. Это действие нельзя отменить."
        confirmText="Удалить"
        variant="danger"
      />
    </div>
  );
}
