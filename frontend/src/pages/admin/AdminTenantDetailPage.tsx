import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Building2,
  Users,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  CalendarDays,
  Phone,
  Mail,
  MapPin,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { format, parseISO, isPast } from 'date-fns';
import { ru } from 'date-fns/locale';

import { tenantsApi, usersApi } from '../../api/services';
import { Tenant, User, UserRole, UserPermissions } from '../../types';
import Modal from '../../components/Modal';
import ConfirmDialog from '../../components/ConfirmDialog';
import LoadingSpinner from '../../components/LoadingSpinner';
import EmptyState from '../../components/EmptyState';

const roleBadgeMap: Record<string, string> = {
  director: 'badge-blue',
  admin: 'badge-green',
  master: 'badge-yellow',
};

const roleLabels: Record<string, string> = {
  superadmin: 'Суперадмин',
  director: 'Директор',
  admin: 'Админ',
  master: 'Мастер',
};

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

// ----------- Tenant Edit Form -----------
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
}

// ----------- User Form -----------
interface UserFormData {
  fullName: string;
  phone: string;
  password: string;
  role: UserRole;
  salaryPercent: number;
  isActive: boolean;
}

const emptyUserForm: UserFormData = {
  fullName: '',
  phone: '',
  password: '',
  role: UserRole.MASTER,
  salaryPercent: 0,
  isActive: true,
};

export default function AdminTenantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Tenant edit modal
  const [tenantModalOpen, setTenantModalOpen] = useState(false);
  const [tenantForm, setTenantForm] = useState<TenantFormData>({
    name: '',
    phone: '',
    address: '',
    email: '',
    description: '',
    maxUsers: 5,
    isActive: true,
    subscriptionEnd: '',
    subscriptionNote: '',
  });

  // User modal
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [userForm, setUserForm] = useState<UserFormData>({ ...emptyUserForm });
  const [deleteUserId, setDeleteUserId] = useState<string | null>(null);

  // Queries
  const { data: tenant, isLoading } = useQuery({
    queryKey: ['tenant', id],
    queryFn: () => tenantsApi.getById(id!),
    select: (res) => res.data as Tenant,
    enabled: !!id,
  });

  const tenantUsers = tenant?.users ?? [];

  // Mutations
  const updateTenantMutation = useMutation({
    mutationFn: (data: any) => tenantsApi.update(id!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenant', id] });
      queryClient.invalidateQueries({ queryKey: ['tenants'] });
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
      toast.success('Организация обновлена');
      setTenantModalOpen(false);
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Ошибка обновления');
    },
  });

  const createUserMutation = useMutation({
    mutationFn: (data: any) => usersApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenant', id] });
      toast.success('Пользователь создан');
      closeUserModal();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Ошибка создания пользователя');
    },
  });

  const updateUserMutation = useMutation({
    mutationFn: ({ userId, data }: { userId: string; data: any }) =>
      usersApi.update(userId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenant', id] });
      toast.success('Пользователь обновлён');
      closeUserModal();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Ошибка обновления');
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: (userId: string) => usersApi.remove(userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenant', id] });
      toast.success('Пользователь удалён');
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Ошибка удаления');
    },
  });

  // Tenant edit handlers
  const openTenantEdit = () => {
    if (!tenant) return;
    setTenantForm({
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
    });
    setTenantModalOpen(true);
  };

  const handleTenantSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateTenantMutation.mutate({
      name: tenantForm.name,
      phone: tenantForm.phone || undefined,
      address: tenantForm.address || undefined,
      email: tenantForm.email || undefined,
      description: tenantForm.description || undefined,
      maxUsers: Number(tenantForm.maxUsers),
      isActive: tenantForm.isActive,
      subscriptionEnd: tenantForm.subscriptionEnd || null,
      subscriptionNote: tenantForm.subscriptionNote || null,
    });
  };

  // User handlers
  const openCreateUser = () => {
    setEditingUser(null);
    setUserForm({ ...emptyUserForm });
    setUserModalOpen(true);
  };

  const openEditUser = (user: User) => {
    setEditingUser(user);
    setUserForm({
      fullName: user.fullName,
      phone: user.phone || '',
      password: '',
      role: user.role,
      salaryPercent: user.salaryPercent,
      isActive: user.isActive,
    });
    setUserModalOpen(true);
  };

  const closeUserModal = () => {
    setUserModalOpen(false);
    setEditingUser(null);
    setUserForm({ ...emptyUserForm });
  };

  const handleUserSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!userForm.fullName.trim() || !userForm.phone.trim()) {
      toast.error('Заполните обязательные поля (ФИО и телефон)');
      return;
    }

    const payload: any = {
      fullName: userForm.fullName,
      phone: userForm.phone,
      role: userForm.role,
      salaryPercent: Number(userForm.salaryPercent),
      isActive: userForm.isActive,
      tenantId: id,
      permissions: { ...defaultPermissions },
    };

    if (editingUser) {
      if (userForm.password) payload.password = userForm.password;
      updateUserMutation.mutate({ userId: editingUser.id, data: payload });
    } else {
      if (!userForm.password) {
        toast.error('Введите пароль');
        return;
      }
      payload.password = userForm.password;
      createUserMutation.mutate(payload);
    }
  };

  const isUserSaving = createUserMutation.isPending || updateUserMutation.isPending;

  if (isLoading) return <LoadingSpinner />;

  if (!tenant) {
    return (
      <EmptyState
        icon={Building2}
        title="Организация не найдена"
        action={{ label: 'Назад', onClick: () => navigate('/admin/tenants') }}
      />
    );
  }

  const subscriptionEnd = tenant.subscriptionEnd
    ? parseISO(tenant.subscriptionEnd)
    : null;
  const isExpired = subscriptionEnd ? isPast(subscriptionEnd) : false;

  return (
    <div>
      {/* Back + Header */}
      <div className="mb-6">
        <button
          onClick={() => navigate('/admin/tenants')}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-3"
        >
          <ArrowLeft className="w-4 h-4" />
          Назад к организациям
        </button>
        <div className="flex items-center justify-between">
          <h1 className="page-title">{tenant.name}</h1>
          <button onClick={openTenantEdit} className="btn-secondary">
            <Pencil className="w-4 h-4" />
            Редактировать
          </button>
        </div>
      </div>

      {/* Tenant Info Card */}
      <div className="card card-body mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-3">
            {tenant.phone && (
              <div className="flex items-center gap-2 text-sm">
                <Phone className="w-4 h-4 text-gray-400" />
                <span className="text-gray-700">{tenant.phone}</span>
              </div>
            )}
            {tenant.email && (
              <div className="flex items-center gap-2 text-sm">
                <Mail className="w-4 h-4 text-gray-400" />
                <span className="text-gray-700">{tenant.email}</span>
              </div>
            )}
            {tenant.address && (
              <div className="flex items-center gap-2 text-sm">
                <MapPin className="w-4 h-4 text-gray-400" />
                <span className="text-gray-700">{tenant.address}</span>
              </div>
            )}
            <div className="flex items-center gap-2 text-sm">
              <Users className="w-4 h-4 text-gray-400" />
              <span className="text-gray-700">
                Пользователей: {tenantUsers.length} / {tenant.maxUsers}
              </span>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-gray-500">Статус:</span>
              {tenant.isActive ? (
                <span className="badge-green">Активна</span>
              ) : (
                <span className="badge-red">Неактивна</span>
              )}
            </div>
            <div className="flex items-center gap-2 text-sm">
              <CalendarDays className="w-4 h-4 text-gray-400" />
              <span className="text-gray-500">Подписка до:</span>
              {subscriptionEnd ? (
                <span className={isExpired ? 'text-red-600 font-medium' : 'text-gray-700'}>
                  {format(subscriptionEnd, 'd MMMM yyyy', { locale: ru })}
                  {isExpired && <span className="badge-red ml-1">Истекла</span>}
                </span>
              ) : (
                <span className="text-gray-400">Не указано</span>
              )}
            </div>
            {tenant.subscriptionNote && (
              <div className="text-sm text-gray-500">
                Примечание: {tenant.subscriptionNote}
              </div>
            )}
            {tenant.slug && (
              <div className="text-sm text-gray-500">
                Slug: <span className="font-mono text-gray-700">{tenant.slug}</span>
              </div>
            )}
          </div>
        </div>

        {tenant.description && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <p className="text-sm text-gray-600">{tenant.description}</p>
          </div>
        )}
      </div>

      {/* Users Section */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Пользователи</h2>
        <button onClick={openCreateUser} className="btn-primary btn-sm">
          <Plus className="w-4 h-4" />
          Новый пользователь
        </button>
      </div>

      {tenantUsers.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Нет пользователей"
          description="Создайте первого пользователя для этой организации"
          action={{ label: 'Создать', onClick: openCreateUser }}
        />
      ) : (
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Имя</th>
                <th>Телефон</th>
                <th>Роль</th>
                <th>% ставка</th>
                <th>Статус</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {tenantUsers.map((user) => (
                <tr key={user.id}>
                  <td className="font-medium text-gray-900">{user.fullName}</td>
                  <td>{user.phone}</td>
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
                        onClick={() => openEditUser(user)}
                        className="p-1.5 text-gray-400 hover:text-primary-600 rounded-lg hover:bg-gray-100 transition-colors"
                        title="Редактировать"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setDeleteUserId(user.id)}
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

      {/* Tenant Edit Modal */}
      <Modal
        isOpen={tenantModalOpen}
        onClose={() => setTenantModalOpen(false)}
        title="Редактировать организацию"
        size="lg"
      >
        <form onSubmit={handleTenantSubmit} className="space-y-4">
          <div>
            <label className="label">Название</label>
            <input
              type="text"
              className="input"
              value={tenantForm.name}
              onChange={(e) => setTenantForm({ ...tenantForm, name: e.target.value })}
              required
            />
          </div>
          <div>
            <label className="label">Телефон</label>
            <input
              type="tel"
              className="input"
              value={tenantForm.phone}
              onChange={(e) => setTenantForm({ ...tenantForm, phone: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Адрес</label>
            <input
              type="text"
              className="input"
              value={tenantForm.address}
              onChange={(e) => setTenantForm({ ...tenantForm, address: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Email</label>
            <input
              type="email"
              className="input"
              value={tenantForm.email}
              onChange={(e) => setTenantForm({ ...tenantForm, email: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Описание</label>
            <textarea
              className="input"
              rows={2}
              value={tenantForm.description}
              onChange={(e) =>
                setTenantForm({ ...tenantForm, description: e.target.value })
              }
            />
          </div>
          <div>
            <label className="label">Максимум пользователей</label>
            <input
              type="number"
              className="input"
              value={tenantForm.maxUsers}
              onChange={(e) =>
                setTenantForm({ ...tenantForm, maxUsers: Number(e.target.value) })
              }
              min={1}
            />
          </div>
          <div className="flex items-center gap-3">
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                className="sr-only peer"
                checked={tenantForm.isActive}
                onChange={(e) =>
                  setTenantForm({ ...tenantForm, isActive: e.target.checked })
                }
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary-500/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600" />
            </label>
            <span className="text-sm font-medium text-gray-700">
              {tenantForm.isActive ? 'Активна' : 'Неактивна'}
            </span>
          </div>
          <div>
            <label className="label">Подписка до</label>
            <input
              type="date"
              className="input"
              value={tenantForm.subscriptionEnd}
              onChange={(e) =>
                setTenantForm({ ...tenantForm, subscriptionEnd: e.target.value })
              }
            />
          </div>
          <div>
            <label className="label">Примечание к подписке</label>
            <input
              type="text"
              className="input"
              value={tenantForm.subscriptionNote}
              onChange={(e) =>
                setTenantForm({ ...tenantForm, subscriptionNote: e.target.value })
              }
            />
          </div>
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={() => setTenantModalOpen(false)}
              className="btn-secondary"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={updateTenantMutation.isPending}
              className="btn-primary"
            >
              {updateTenantMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Сохранение...
                </>
              ) : (
                'Сохранить'
              )}
            </button>
          </div>
        </form>
      </Modal>

      {/* User Create/Edit Modal */}
      <Modal
        isOpen={userModalOpen}
        onClose={closeUserModal}
        title={editingUser ? 'Редактировать пользователя' : 'Новый пользователь'}
        size="md"
      >
        <form onSubmit={handleUserSubmit} className="space-y-4">
          <div>
            <label className="label">ФИО</label>
            <input
              type="text"
              className="input"
              value={userForm.fullName}
              onChange={(e) => setUserForm({ ...userForm, fullName: e.target.value })}
              placeholder="Иванов Иван Иванович"
              required
            />
          </div>
          <div>
            <label className="label">Телефон (логин для входа)</label>
            <input
              type="tel"
              className="input"
              value={userForm.phone}
              onChange={(e) => setUserForm({ ...userForm, phone: e.target.value })}
              placeholder="+7 (XXX) XXX-XX-XX"
              required
            />
          </div>
          {!editingUser ? (
            <div>
              <label className="label">Пароль</label>
              <input
                type="password"
                className="input"
                value={userForm.password}
                onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
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
                value={userForm.password}
                onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
                placeholder="Новый пароль"
              />
            </div>
          )}
          <div>
            <label className="label">Роль</label>
            <select
              className="input"
              value={userForm.role}
              onChange={(e) =>
                setUserForm({ ...userForm, role: e.target.value as UserRole })
              }
            >
              <option value={UserRole.DIRECTOR}>Директор</option>
              <option value={UserRole.ADMIN}>Админ</option>
              <option value={UserRole.MASTER}>Мастер</option>
            </select>
          </div>
          <div>
            <label className="label">% ставка от услуг</label>
            <input
              type="number"
              className="input"
              value={userForm.salaryPercent}
              onChange={(e) =>
                setUserForm({ ...userForm, salaryPercent: Number(e.target.value) })
              }
              min={0}
              max={100}
            />
          </div>
          <div className="flex items-center gap-3">
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                className="sr-only peer"
                checked={userForm.isActive}
                onChange={(e) =>
                  setUserForm({ ...userForm, isActive: e.target.checked })
                }
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary-500/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600" />
            </label>
            <span className="text-sm font-medium text-gray-700">
              {userForm.isActive ? 'Активен' : 'Неактивен'}
            </span>
          </div>
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200">
            <button type="button" onClick={closeUserModal} className="btn-secondary">
              Отмена
            </button>
            <button type="submit" disabled={isUserSaving} className="btn-primary">
              {isUserSaving ? (
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

      {/* Delete User Confirmation */}
      <ConfirmDialog
        isOpen={!!deleteUserId}
        onClose={() => setDeleteUserId(null)}
        onConfirm={() => {
          if (deleteUserId) deleteUserMutation.mutate(deleteUserId);
          setDeleteUserId(null);
        }}
        title="Удалить пользователя"
        message="Вы уверены, что хотите удалить этого пользователя?"
        confirmText="Удалить"
        variant="danger"
      />
    </div>
  );
}
