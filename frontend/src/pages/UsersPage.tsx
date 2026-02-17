import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Users, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

import { usersApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import { User, UserRole, UserPermissions } from '../types';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';

const roleBadgeMap: Record<string, string> = {
  director: 'badge-blue',
  admin: 'badge-green',
  master: 'badge-yellow',
};

const roleLabels: Record<string, string> = {
  director: 'Директор',
  admin: 'Админ',
  master: 'Мастер',
};

const permissionLabels: Record<keyof UserPermissions, string> = {
  checks_view: 'Просмотр заказ-нарядов',
  checks_create: 'Создание заказ-нарядов',
  checks_edit: 'Редактирование заказ-нарядов',
  checks_delete: 'Удаление заказ-нарядов',
  profit_view: 'Просмотр прибыли',
  clients_view: 'Просмотр клиентов',
  clients_edit: 'Редактирование клиентов',
  warehouse_access: 'Доступ к складу',
  suppliers_access: 'Доступ к поставщикам',
  financial_reports: 'Финансовые отчёты',
  export_data: 'Экспорт данных',
  user_management: 'Управление сотрудниками',
};

interface UserFormData {
  fullName: string;
  username: string;
  password: string;
  phone: string;
  role: UserRole;
  salaryPercent: number;
  isActive: boolean;
  permissions: UserPermissions;
}

const defaultPermissions: UserPermissions = {
  checks_view: true,
  checks_create: true,
  checks_edit: false,
  checks_delete: false,
  profit_view: false,
  clients_view: true,
  clients_edit: false,
  warehouse_access: false,
  suppliers_access: false,
  financial_reports: false,
  export_data: false,
  user_management: false,
};

const emptyForm: UserFormData = {
  fullName: '',
  username: '',
  password: '',
  phone: '',
  role: UserRole.MASTER,
  salaryPercent: 0,
  isActive: true,
  permissions: { ...defaultPermissions },
};

export default function UsersPage() {
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();

  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [form, setForm] = useState<UserFormData>({ ...emptyForm });
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => usersApi.getAll(),
    select: (res) => res.data as User[],
  });

  const users = data ?? [];

  const createMutation = useMutation({
    mutationFn: (data: any) => usersApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success('Сотрудник создан');
      closeModal();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Ошибка создания сотрудника');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => usersApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success('Сотрудник обновлён');
      closeModal();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Ошибка обновления');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => usersApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success('Сотрудник удалён');
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Ошибка удаления');
    },
  });

  if (!hasPermission('user_management')) {
    return (
      <EmptyState
        icon={Users}
        title="Нет доступа"
        description="У вас нет прав для управления сотрудниками"
      />
    );
  }

  const openCreate = () => {
    setEditingUser(null);
    setForm({ ...emptyForm });
    setModalOpen(true);
  };

  const openEdit = (user: User) => {
    setEditingUser(user);
    setForm({
      fullName: user.fullName,
      username: user.username,
      password: '',
      phone: user.phone || '',
      role: user.role,
      salaryPercent: user.salaryPercent,
      isActive: user.isActive,
      permissions: { ...defaultPermissions, ...user.permissions },
    });
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingUser(null);
    setForm({ ...emptyForm });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.fullName.trim() || !form.username.trim()) {
      toast.error('Заполните обязательные поля');
      return;
    }
    if (!editingUser && !form.password) {
      toast.error('Введите пароль');
      return;
    }

    const payload: any = {
      fullName: form.fullName,
      username: form.username,
      phone: form.phone || undefined,
      role: form.role,
      salaryPercent: Number(form.salaryPercent),
      isActive: form.isActive,
      permissions: form.permissions,
    };

    if (!editingUser) {
      payload.password = form.password;
      createMutation.mutate(payload);
    } else {
      if (form.password) {
        payload.password = form.password;
      }
      updateMutation.mutate({ id: editingUser.id, data: payload });
    }
  };

  const togglePermission = (key: keyof UserPermissions) => {
    setForm((prev) => ({
      ...prev,
      permissions: {
        ...prev.permissions,
        [key]: !prev.permissions[key],
      },
    }));
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  if (isLoading) return <LoadingSpinner />;

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <h1 className="page-title">Сотрудники</h1>
        <button onClick={openCreate} className="btn-primary">
          <Plus className="w-4 h-4" />
          Новый сотрудник
        </button>
      </div>

      {/* Table */}
      {users.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Нет сотрудников"
          description="Добавьте первого сотрудника"
          action={{ label: 'Добавить', onClick: openCreate }}
        />
      ) : (
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Имя</th>
                <th>Логин</th>
                <th>Роль</th>
                <th>% ставка</th>
                <th>Статус</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td className="font-medium text-gray-900">{user.fullName}</td>
                  <td>{user.username}</td>
                  <td>
                    <span className={roleBadgeMap[user.role] || 'badge-gray'}>
                      {roleLabels[user.role] || user.role}
                    </span>
                  </td>
                  <td>{user.salaryPercent}%</td>
                  <td>
                    {user.isActive ? (
                      <span className="badge-green">Активен</span>
                    ) : (
                      <span className="badge-red">Неактивен</span>
                    )}
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => openEdit(user)}
                        className="p-1.5 text-gray-400 hover:text-primary-600 rounded-lg hover:bg-gray-100 transition-colors"
                        title="Редактировать"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setDeleteId(user.id)}
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
        title={editingUser ? 'Редактировать сотрудника' : 'Новый сотрудник'}
        size="lg"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Full Name */}
          <div>
            <label className="label">ФИО</label>
            <input
              type="text"
              className="input"
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              placeholder="Иванов Иван Иванович"
              required
            />
          </div>

          {/* Username */}
          <div>
            <label className="label">Логин</label>
            <input
              type="text"
              className="input"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              placeholder="ivanov"
              required
            />
          </div>

          {/* Password */}
          {!editingUser ? (
            <div>
              <label className="label">Пароль</label>
              <input
                type="password"
                className="input"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="Введите пароль"
                required
              />
            </div>
          ) : (
            <div>
              <label className="label">Новый пароль (оставьте пустым, чтобы не менять)</label>
              <input
                type="password"
                className="input"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="Новый пароль"
              />
            </div>
          )}

          {/* Phone */}
          <div>
            <label className="label">Телефон</label>
            <input
              type="tel"
              className="input"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="+998 (90) 123-45-67"
            />
          </div>

          {/* Role */}
          <div>
            <label className="label">Роль</label>
            <select
              className="input"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })}
            >
              <option value={UserRole.DIRECTOR}>Директор</option>
              <option value={UserRole.ADMIN}>Админ</option>
              <option value={UserRole.MASTER}>Мастер</option>
            </select>
          </div>

          {/* Salary Percent */}
          <div>
            <label className="label">% ставка от услуг</label>
            <input
              type="number"
              className="input"
              value={form.salaryPercent}
              onChange={(e) => setForm({ ...form, salaryPercent: Number(e.target.value) })}
              min={0}
              max={100}
              step={1}
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
              {form.isActive ? 'Активен' : 'Неактивен'}
            </span>
          </div>

          {/* Permissions */}
          <div>
            <label className="label">Права доступа</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
              {(Object.keys(permissionLabels) as (keyof UserPermissions)[]).map((key) => (
                <label key={key} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.permissions[key]}
                    onChange={() => togglePermission(key)}
                    className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                  />
                  <span className="text-sm text-gray-700">{permissionLabels[key]}</span>
                </label>
              ))}
            </div>
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
              ) : editingUser ? (
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
        title="Удалить сотрудника"
        message="Вы уверены, что хотите удалить этого сотрудника? Это действие нельзя отменить."
        confirmText="Удалить"
        variant="danger"
      />
    </div>
  );
}
