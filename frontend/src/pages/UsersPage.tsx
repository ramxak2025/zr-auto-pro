import { useState, FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Plus,
  Pencil,
  Trash2,
  Shield,
  Loader2,
  Users,
  ChevronDown,
} from 'lucide-react';
import { usersApi } from '../api/services';
import type { User, UserPermissions, PaginatedResponse } from '../types';
import SearchInput from '../components/SearchInput';
import Pagination from '../components/Pagination';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import LoadingSpinner from '../components/LoadingSpinner';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LIMIT = 20;

const ROLE_LABELS: Record<string, string> = {
  owner: 'Владелец',
  admin: 'Администратор',
  master: 'Мастер',
  storekeeper: 'Товаровед',
  accountant: 'Бухгалтер',
};

const ROLE_BADGE_COLORS: Record<string, string> = {
  owner: 'bg-purple-100 text-purple-700',
  admin: 'bg-blue-100 text-blue-700',
  master: 'bg-green-100 text-green-700',
  storekeeper: 'bg-orange-100 text-orange-700',
  accountant: 'bg-gray-100 text-gray-700',
};

const PERMISSION_LABELS: Record<keyof UserPermissions, string> = {
  checks_view: 'Просмотр чеков',
  checks_create: 'Создание чеков',
  checks_edit: 'Редактирование чеков',
  checks_delete: 'Удаление чеков',
  profit_view: 'Просмотр прибыли',
  clients_view: 'Просмотр клиентов',
  clients_edit: 'Редактирование клиентов',
  warehouse_access: 'Доступ к складу',
  suppliers_access: 'Доступ к поставщикам',
  financial_reports: 'Финансовые отчёты',
  export_data: 'Экспорт данных',
  user_management: 'Управление пользователями',
};

const ROLE_OPTIONS = [
  { value: 'admin', label: 'Администратор' },
  { value: 'master', label: 'Мастер' },
  { value: 'storekeeper', label: 'Товаровед' },
  { value: 'accountant', label: 'Бухгалтер' },
];

// ---------------------------------------------------------------------------
// Toggle Switch
// ---------------------------------------------------------------------------

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (val: boolean) => void;
}

function ToggleSwitch({ checked, onChange }: ToggleSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:ring-offset-2 ${
        checked ? 'bg-green-500' : 'bg-gray-200'
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// User Form Modal
// ---------------------------------------------------------------------------

interface UserFormData {
  username: string;
  password: string;
  fullName: string;
  role: string;
  salaryPercent: number;
}

interface UserFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  user?: User | null;
  onSubmit: (data: UserFormData) => void;
  isLoading: boolean;
}

function UserFormModal({
  isOpen,
  onClose,
  user,
  onSubmit,
  isLoading,
}: UserFormModalProps) {
  const [username, setUsername] = useState(user?.username || '');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState(user?.fullName || '');
  const [role, setRole] = useState(user?.role || 'master');
  const [salaryPercent, setSalaryPercent] = useState(
    user?.salaryPercent ?? 0,
  );

  const isEdit = !!user;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!username.trim()) {
      toast.error('Введите логин');
      return;
    }
    if (!isEdit && !password.trim()) {
      toast.error('Введите пароль');
      return;
    }
    if (!fullName.trim()) {
      toast.error('Введите ФИО');
      return;
    }
    onSubmit({
      username: username.trim(),
      password: password.trim(),
      fullName: fullName.trim(),
      role,
      salaryPercent: role === 'master' ? salaryPercent : 0,
    });
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEdit ? 'Редактировать пользователя' : 'Новый пользователь'}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Логин <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="login"
            className="block w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Пароль {!isEdit && <span className="text-red-500">*</span>}
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={isEdit ? 'Оставьте пустым, чтобы не менять' : 'Введите пароль'}
            className="block w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            ФИО <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Иванов Иван Иванович"
            className="block w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Роль
          </label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="block w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900 shadow-sm transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          >
            {ROLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        {role === 'master' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Процент зарплаты (%)
            </label>
            <input
              type="number"
              min={0}
              max={100}
              value={salaryPercent}
              onChange={(e) => setSalaryPercent(Number(e.target.value))}
              className="block w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900 shadow-sm transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
        )}

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
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
            {isEdit ? 'Сохранить' : 'Создать'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Permissions Modal
// ---------------------------------------------------------------------------

interface PermissionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User;
}

function PermissionsModal({ isOpen, onClose, user }: PermissionsModalProps) {
  const queryClient = useQueryClient();
  const [perms, setPerms] = useState<UserPermissions>(() => ({
    checks_view: user.permissions?.checks_view ?? false,
    checks_create: user.permissions?.checks_create ?? false,
    checks_edit: user.permissions?.checks_edit ?? false,
    checks_delete: user.permissions?.checks_delete ?? false,
    profit_view: user.permissions?.profit_view ?? false,
    clients_view: user.permissions?.clients_view ?? false,
    clients_edit: user.permissions?.clients_edit ?? false,
    warehouse_access: user.permissions?.warehouse_access ?? false,
    suppliers_access: user.permissions?.suppliers_access ?? false,
    financial_reports: user.permissions?.financial_reports ?? false,
    export_data: user.permissions?.export_data ?? false,
    user_management: user.permissions?.user_management ?? false,
  }));

  const mutation = useMutation({
    mutationFn: () => usersApi.updatePermissions(user.id, perms),
    onSuccess: () => {
      toast.success('Права доступа обновлены');
      queryClient.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
    onError: () => {
      toast.error('Не удалось обновить права доступа');
    },
  });

  function togglePerm(key: keyof UserPermissions) {
    setPerms((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Права доступа - ${user.username}`} size="lg">
      <div className="space-y-3">
        {(Object.keys(PERMISSION_LABELS) as (keyof UserPermissions)[]).map((key) => (
          <div
            key={key}
            className="flex items-center justify-between rounded-lg border border-gray-100 px-4 py-3 transition-colors hover:bg-gray-50"
          >
            <span className="text-sm text-gray-700">{PERMISSION_LABELS[key]}</span>
            <ToggleSwitch
              checked={perms[key]}
              onChange={() => togglePerm(key)}
            />
          </div>
        ))}
      </div>

      <div className="mt-6 flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={onClose}
          disabled={mutation.isPending}
          className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
        >
          Отмена
        </button>
        <button
          type="button"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
        >
          {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Сохранить
        </button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function UsersPage() {
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  // Modal state
  const [formOpen, setFormOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [permissionsUser, setPermissionsUser] = useState<User | null>(null);

  // ---- Query ----
  const {
    data: usersData,
    isLoading,
    isError,
  } = useQuery<PaginatedResponse<User>>({
    queryKey: ['users', { search, page }],
    queryFn: async () => {
      const res = await usersApi.getAll({
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
    mutationFn: (data: UserFormData) => usersApi.create(data),
    onSuccess: () => {
      toast.success('Пользователь создан');
      queryClient.invalidateQueries({ queryKey: ['users'] });
      closeForm();
    },
    onError: () => {
      toast.error('Не удалось создать пользователя');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: UserFormData }) =>
      usersApi.update(id, data),
    onSuccess: () => {
      toast.success('Пользователь обновлён');
      queryClient.invalidateQueries({ queryKey: ['users'] });
      closeForm();
    },
    onError: () => {
      toast.error('Не удалось обновить пользователя');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => usersApi.delete(id),
    onSuccess: () => {
      toast.success('Пользователь удалён');
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setDeleteTarget(null);
    },
    onError: () => {
      toast.error('Не удалось удалить пользователя');
    },
  });

  // ---- Handlers ----
  function openCreate() {
    setEditingUser(null);
    setFormOpen(true);
  }

  function openEdit(u: User) {
    setEditingUser(u);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingUser(null);
  }

  function handleFormSubmit(data: UserFormData) {
    if (editingUser) {
      updateMutation.mutate({ id: editingUser.id, data });
    } else {
      createMutation.mutate(data);
    }
  }

  function handleSearchChange(v: string) {
    setSearch(v);
    setPage(1);
  }

  const users = usersData?.data || [];
  const total = usersData?.total || 0;
  const isMutating = createMutation.isPending || updateMutation.isPending;
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);

  // ---- Render ----
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Управление пользователями
          </h1>
          <p className="text-sm text-gray-500 mt-1">Всего: {total}</p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Добавить</span>
        </button>
      </div>

      {/* Search */}
      <div className="w-full sm:max-w-sm">
        <SearchInput
          value={search}
          onChange={handleSearchChange}
          placeholder="Поиск по логину или ФИО..."
        />
      </div>

      {/* Content */}
      {isLoading ? (
        <LoadingSpinner />
      ) : isError ? (
        <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
          <p className="text-sm">Не удалось загрузить список пользователей</p>
        </div>
      ) : users.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-12 text-center">
          <Users className="mx-auto h-12 w-12 text-gray-300" />
          <h3 className="mt-4 text-sm font-medium text-gray-900">
            {search ? 'Ничего не найдено' : 'Нет пользователей'}
          </h3>
          <p className="mt-1 text-sm text-gray-500">
            {search
              ? 'Попробуйте изменить параметры поиска'
              : 'Добавьте первого пользователя для начала работы'}
          </p>
          {!search && (
            <button
              onClick={openCreate}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              <Plus className="h-4 w-4" />
              Добавить пользователя
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Mobile accordion cards */}
          <div className="md:hidden space-y-2">
            {users.map((u) => {
              const isExpanded = expandedUserId === u.id;
              return (
                <div key={u.id} className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setExpandedUserId(isExpanded ? null : u.id)}
                    className="flex items-center gap-3 w-full px-4 py-3 text-left"
                  >
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-100 text-primary-700 text-sm font-semibold flex-shrink-0">
                      {u.fullName?.charAt(0) || 'U'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{u.fullName}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${ROLE_BADGE_COLORS[u.role] || 'bg-gray-100 text-gray-700'}`}>
                          {ROLE_LABELS[u.role] || u.role}
                        </span>
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${u.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                          {u.isActive ? 'Активен' : 'Неактивен'}
                        </span>
                      </div>
                    </div>
                    <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                  </button>
                  {isExpanded && (
                    <div className="border-t border-gray-100 px-4 py-3 space-y-3 bg-gray-50/50">
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <p className="text-[11px] text-gray-400 mb-0.5">Логин</p>
                          <p className="font-medium text-gray-900">{u.username}</p>
                        </div>
                        {u.role === 'master' && (
                          <div>
                            <p className="text-[11px] text-gray-400 mb-0.5">% зарплаты</p>
                            <p className="font-medium text-gray-900">{u.salaryPercent}%</p>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 pt-1">
                        <button onClick={() => setPermissionsUser(u)}
                          className="flex items-center gap-1.5 rounded-lg bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700 hover:bg-blue-100 transition-colors">
                          <Shield className="h-3.5 w-3.5" />Права
                        </button>
                        <button onClick={() => openEdit(u)}
                          className="flex items-center gap-1.5 rounded-lg bg-gray-100 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-200 transition-colors">
                          <Pencil className="h-3.5 w-3.5" />Изменить
                        </button>
                        <button onClick={() => setDeleteTarget(u)}
                          className="flex items-center gap-1.5 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-100 transition-colors ml-auto">
                          <Trash2 className="h-3.5 w-3.5" />Удалить
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50/50">
                    <th className="px-4 py-3 font-semibold text-gray-600">Логин</th>
                    <th className="px-4 py-3 font-semibold text-gray-600">ФИО</th>
                    <th className="px-4 py-3 font-semibold text-gray-600">Роль</th>
                    <th className="px-4 py-3 font-semibold text-gray-600 text-right">
                      % зарплаты
                    </th>
                    <th className="px-4 py-3 font-semibold text-gray-600">Статус</th>
                    <th className="px-4 py-3 font-semibold text-gray-600 text-right">
                      Действия
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {users.map((u) => (
                    <tr
                      key={u.id}
                      className="transition-colors hover:bg-gray-50"
                    >
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {u.username}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{u.fullName}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            ROLE_BADGE_COLORS[u.role] || 'bg-gray-100 text-gray-700'
                          }`}
                        >
                          {ROLE_LABELS[u.role] || u.role}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600 text-right">
                        {u.role === 'master' ? `${u.salaryPercent}%` : '\u2014'}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            u.isActive
                              ? 'bg-green-100 text-green-700'
                              : 'bg-red-100 text-red-700'
                          }`}
                        >
                          {u.isActive ? 'Активен' : 'Неактивен'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => setPermissionsUser(u)}
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-blue-50 hover:text-blue-600"
                            title="Права доступа"
                          >
                            <Shield className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => openEdit(u)}
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                            title="Редактировать"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => setDeleteTarget(u)}
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
          </div>

          <Pagination page={page} total={total} limit={LIMIT} onChange={setPage} />
        </>
      )}

      {/* Create / Edit Modal */}
      {formOpen && (
        <UserFormModal
          key={editingUser?.id || 'new'}
          isOpen={formOpen}
          onClose={closeForm}
          user={editingUser}
          onSubmit={handleFormSubmit}
          isLoading={isMutating}
        />
      )}

      {/* Permissions Modal */}
      {permissionsUser && (
        <PermissionsModal
          key={permissionsUser.id}
          isOpen={!!permissionsUser}
          onClose={() => setPermissionsUser(null)}
          user={permissionsUser}
        />
      )}

      {/* Delete Confirm Dialog */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        title="Удалить пользователя"
        message={`Вы уверены, что хотите удалить пользователя "${deleteTarget?.username}"? Это действие нельзя отменить.`}
        confirmText="Удалить"
        variant="danger"
      />
    </div>
  );
}
