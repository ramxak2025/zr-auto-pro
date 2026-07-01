import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Pencil,
  Trash2,
  Users,
  Loader2,
  Package,
  X,
  Search,
  Gift,
  Archive,
  RotateCcw,
  UserX,
} from 'lucide-react';
import toast from 'react-hot-toast';

import { usersApi, productsApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import { User, UserRole, UserPermissions, Product, PaginatedResponse } from '../types';
import { ROLE_PERMISSION_DEFAULTS, PERMISSION_KEYS } from '../types';
import type { PermissionKey } from '../types';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';
import PhoneInput from '../components/PhoneInput';
import { roleLabels } from '../../../shared/utils/formatters';
import { formatPhone } from '../../../shared/validation/phone';

const roleBadgeMapDismissed: Record<string, string> = {
  director: 'badge-blue',
  admin: 'badge-green',
  master: 'badge-yellow',
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Russian day-noun pluralization: 1 день, 2 дня, 5 дней. */
function pluralizeDays(n: number): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return 'дней';
  if (mod10 === 1) return 'день';
  if (mod10 >= 2 && mod10 <= 4) return 'дня';
  return 'дней';
}

/**
 * Restore window: 1 year from dismissedAt. Returns whole days left (clamped to
 * ≥ 0). Used to tell the manager «можно восстановить ещё N дней».
 */
function restoreDaysLeft(dismissedAt: string): number {
  const dismissed = new Date(dismissedAt).getTime();
  if (Number.isNaN(dismissed)) return 0;
  const deadline = dismissed + 365 * MS_PER_DAY;
  return Math.max(0, Math.ceil((deadline - Date.now()) / MS_PER_DAY));
}

function formatDismissedDate(dismissedAt: string): string {
  const d = new Date(dismissedAt);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

const roleBadgeMap: Record<string, string> = {
  director: 'badge-blue',
  admin: 'badge-green',
  master: 'badge-yellow',
};

// Partial: the new server-enforced permission keys (checks_view_all,
// payment_edit, bookings_access, …) are optional in UserPermissions and don't
// yet have a row in this web editor — Partial keeps this map valid without
// forcing a label for every key. The rendered set (Object.keys below) is
// unchanged, so behaviour is identical.
const permissionLabels: Partial<Record<keyof UserPermissions, string>> = {
  checks_view: 'Просмотр заказ-нарядов',
  checks_create: 'Создание заказ-нарядов',
  checks_edit: 'Редактирование заказ-нарядов',
  checks_delete: 'Удаление заказ-нарядов',
  checks_change_datetime: 'Изменение даты/времени заказ-нарядов',
  accept_payment: 'Приём оплаты (кассир)',
  profit_view: 'Просмотр прибыли',
  clients_view: 'Просмотр клиентов',
  clients_edit: 'Редактирование клиентов',
  warehouse_access: 'Доступ к складу',
  suppliers_access: 'Доступ к поставщикам',
  financial_reports: 'Финансовые отчёты',
  export_data: 'Экспорт данных',
  user_management: 'Управление сотрудниками',
  schedule_view: 'Просмотр расписания',
  salary_view: 'Просмотр зарплат',
  marketing_access: 'Доступ к маркетингу',
};

interface UserFormData {
  fullName: string;
  phone: string;
  password: string;
  role: UserRole;
  salaryPercent: number;
  isActive: boolean;
  permissions: UserPermissions;
}

/**
 * Полная карта прав из РОЛЕВЫХ эффективных дефолтов (ROLE_PERMISSION_DEFAULTS —
 * та же таблица, которую зеркалит серверный PermissionsGuard для ключей,
 * отсутствующих в сохранённой карте). Ключ вне дефолтов роли → false.
 *
 * Фикс бага «права сбрасываются при сохранении»: раньше здесь была локальная
 * таблица defaultPermissions, расходившаяся с серверными фоллбэками
 * (у мастера checks_edit / schedule_view на сервере по умолчанию TRUE, тут были
 * FALSE), и она уезжала полной заменой карты при КАЖДОМ сохранении профиля.
 */
function permissionsFromRoleDefaults(role: UserRole): UserPermissions {
  const defaults = ROLE_PERMISSION_DEFAULTS[role] ?? {};
  const map = {} as Record<PermissionKey, boolean>;
  for (const key of PERMISSION_KEYS) map[key] = defaults[key] === true;
  return map;
}

const emptyForm: UserFormData = {
  fullName: '',
  phone: '',
  password: '',
  role: UserRole.MASTER,
  salaryPercent: 0,
  isActive: true,
  permissions: permissionsFromRoleDefaults(UserRole.MASTER),
};

export default function UsersPage() {
  const { hasPermission, user: currentUser } = useAuth();
  const queryClient = useQueryClient();

  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [form, setForm] = useState<UserFormData>({ ...emptyForm });
  // Матрица прав: пока авторитетная карта тянется с выделенного endpoint'а,
  // чекбоксы заблокированы; отправляем права ТОЛЬКО если владелец их трогал
  // (touched) — сохранение одного лишь профиля больше не переписывает права.
  const [permsLoading, setPermsLoading] = useState(false);
  const [permsTouched, setPermsTouched] = useState(false);
  const [permsLoadFailed, setPermsLoadFailed] = useState(false);
  // Сессия редактирования: поздний ответ GET-прав предыдущего сотрудника не
  // должен вливаться в форму текущего.
  const editSessionRef = useRef(0);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [commissionModalOpen, setCommissionModalOpen] = useState(false);
  const [commissionUserId, setCommissionUserId] = useState<string | null>(null);
  const [dismissedOpen, setDismissedOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => usersApi.getAll(),
    select: (res) => res.data as User[],
  });

  // Defensive: the backend already excludes dismissed/purged employees from the
  // active list, but if a stale persisted cache ever serves one, never show it.
  const users = (data ?? []).filter((u) => !u.dismissedAt && !u.purgedAt);

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
    // Права идут через ВЫДЕЛЕННЫЙ endpoint (self-lockout-guard на сервере), а не
    // в общем PATCH-теле: общий PATCH раньше вёз permissions из устаревшего
    // seed'а и сбрасывал права при любом сохранении профиля. __permissions
    // приходит только когда владелец реально менял чекбоксы.
    mutationFn: async ({ id, data, __permissions }: { id: string; data: any; __permissions?: UserPermissions }) => {
      await usersApi.update(id, data);
      if (__permissions) await usersApi.updatePermissions(id, __permissions);
    },
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
      queryClient.invalidateQueries({ queryKey: ['users-dismissed'] });
      toast.success('Сотрудник уволен');
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Ошибка увольнения');
    },
  });

  if (!hasPermission('user_management')) {
    return <EmptyState icon={Users} title="Нет доступа" description="У вас нет прав для управления сотрудниками" />;
  }

  const openCreate = () => {
    editSessionRef.current++; // инвалидируем возможный in-flight GET прав
    setEditingUser(null);
    setPermsLoading(false);
    setPermsTouched(false);
    setPermsLoadFailed(false);
    setForm({ ...emptyForm });
    setModalOpen(true);
  };

  const openEdit = (user: User) => {
    const session = ++editSessionRef.current;
    setEditingUser(user);
    setPermsLoading(true);
    setPermsTouched(false);
    setPermsLoadFailed(false);
    setForm({
      fullName: user.fullName,
      phone: user.phone || '',
      password: '',
      role: user.role,
      salaryPercent: user.salaryPercent,
      isActive: user.isActive,
      // Seed: ролевые эффективные дефолты + карта из строки списка (list может
      // быть stale — авторитетная карта дотягивается ниже).
      permissions: { ...permissionsFromRoleDefaults(user.role), ...user.permissions },
    });
    setModalOpen(true);
    // Авторитетная сохранённая карта — с выделенного endpoint'а, как на mobile.
    usersApi
      .getPermissions(user.id)
      .then((res) => {
        if (editSessionRef.current !== session) return;
        setForm((prev) => ({ ...prev, permissions: { ...permissionsFromRoleDefaults(user.role), ...res.data } }));
      })
      .catch(() => {
        if (editSessionRef.current !== session) return;
        setPermsLoadFailed(true);
      })
      .finally(() => {
        if (editSessionRef.current !== session) return;
        setPermsLoading(false);
      });
  };

  const closeModal = () => {
    editSessionRef.current++;
    setModalOpen(false);
    setEditingUser(null);
    setPermsLoading(false);
    setPermsTouched(false);
    setPermsLoadFailed(false);
    setForm({ ...emptyForm });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.fullName.trim()) {
      toast.error('Введите ФИО');
      return;
    }
    if (!form.phone.trim()) {
      toast.error('Введите номер телефона');
      return;
    }
    if (!editingUser && !form.password) {
      toast.error('Введите пароль');
      return;
    }

    // ВАЖНО: permissions в общем теле только при СОЗДАНИИ (id ещё нет, выделенный
    // endpoint недоступен). При редактировании общий PATCH прав не везёт — их
    // сохраняет выделенный endpoint ниже, и только если чекбоксы реально трогали.
    const payload: any = {
      fullName: form.fullName,
      phone: form.phone,
      role: form.role,
      salaryPercent: Number(form.salaryPercent),
      isActive: form.isActive,
    };

    if (!editingUser) {
      payload.password = form.password;
      payload.permissions = form.permissions;
      createMutation.mutate(payload);
    } else {
      if (form.password) {
        payload.password = form.password;
      }
      // Self-lockout net (как на mobile): редактируя СВОЙ аккаунт, нельзя снять
      // с себя user_management — иначе потеряешь доступ к этому же экрану.
      const editsOwnAccount = editingUser.id === currentUser?.id;
      const permissions: UserPermissions | undefined =
        permsLoading || !permsTouched
          ? undefined
          : editsOwnAccount
            ? { ...form.permissions, user_management: true }
            : form.permissions;
      updateMutation.mutate({ id: editingUser.id, data: payload, __permissions: permissions });
    }
  };

  const togglePermission = (key: keyof UserPermissions) => {
    setPermsTouched(true);
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
        <div className="flex items-center gap-2">
          <button onClick={() => setDismissedOpen(true)} className="btn-secondary">
            <Archive className="w-4 h-4" />
            Уволенные
          </button>
          <button onClick={openCreate} className="btn-primary">
            <Plus className="w-4 h-4" />
            Новый сотрудник
          </button>
        </div>
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
        <>
          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {users.map((user) => (
              <div key={user.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-semibold text-gray-900 text-sm truncate">{user.fullName}</span>
                    <span className={`flex-shrink-0 ${roleBadgeMap[user.role] || 'badge-gray'}`}>
                      {roleLabels[user.role] || user.role}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => openEdit(user)}
                      className="p-1.5 text-gray-400 hover:text-primary-600 rounded-lg"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    {user.id !== currentUser?.id && user.role !== 'superadmin' && user.role !== 'director' && (
                      <button
                        onClick={() => setDeleteId(user.id)}
                        className="p-1.5 text-gray-400 hover:text-red-600 rounded-lg"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 text-sm text-gray-500">
                  <span>{formatPhone(user.phone)}</span>
                  <span className="text-gray-300">|</span>
                  <span>{user.salaryPercent}%</span>
                  <span className="text-gray-300">|</span>
                  {user.isActive ? (
                    <span className="text-green-600 text-xs font-medium">Активен</span>
                  ) : (
                    <span className="text-red-500 text-xs font-medium">Неактивен</span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block table-container">
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
                {users.map((user) => (
                  <tr key={user.id}>
                    <td className="font-medium text-gray-900">{user.fullName}</td>
                    <td>{formatPhone(user.phone)}</td>
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
                        {user.id !== currentUser?.id && user.role !== 'superadmin' && user.role !== 'director' && (
                          <button
                            onClick={() => setDeleteId(user.id)}
                            className="p-1.5 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors"
                            title="Уволить"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
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

          {/* Phone (login) */}
          <div>
            <label className="label">Телефон (логин для входа)</label>
            <PhoneInput
              value={form.phone}
              onChange={(value) => setForm({ ...form, phone: value })}
              placeholder="+7 (XXX) XXX-XX-XX"
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

          {/* Product Commission — only for existing users */}
          {editingUser && (form.role === UserRole.MASTER || form.role === UserRole.ADMIN) && (
            <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-xl p-4 border border-green-200">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                    <Gift className="w-4 h-4 text-green-600" />
                    Комиссия с товаров
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {editingUser.productSalaryPercent
                      ? `${editingUser.productSalaryPercent}% с чистой прибыли`
                      : 'Не настроена'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setCommissionUserId(editingUser.id);
                    setCommissionModalOpen(true);
                  }}
                  className="text-sm font-medium text-green-700 hover:text-green-800 bg-green-100 hover:bg-green-200 px-3 py-1.5 rounded-lg transition-colors"
                >
                  Настроить
                </button>
              </div>
            </div>
          )}

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
            <span className="text-sm font-medium text-gray-700">{form.isActive ? 'Активен' : 'Неактивен'}</span>
          </div>

          {/* Permissions */}
          <div>
            <label className="label">Права доступа</label>
            {permsLoading && <p className="text-xs text-gray-400 mt-1">Загружаем сохранённые права…</p>}
            {permsLoadFailed && !permsLoading && (
              <p className="text-xs text-red-500 mt-1">
                Не удалось загрузить сохранённые права — показаны последние известные значения. Обновите страницу,
                прежде чем менять галочки.
              </p>
            )}
            <div className={`grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2 ${permsLoading ? 'opacity-50' : ''}`}>
              {(Object.keys(permissionLabels) as (keyof UserPermissions)[]).map((key) => (
                <label key={key} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!form.permissions[key]}
                    disabled={permsLoading}
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

      {/* Dismiss Confirmation */}
      <ConfirmDialog
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => {
          if (deleteId) deleteMutation.mutate(deleteId);
          setDeleteId(null);
        }}
        title="Уволить сотрудника"
        message="Уволить сотрудника? Он переместится в Уволенные, восстановить можно в течение года."
        confirmText="Уволить"
        variant="danger"
      />

      {/* Product Commission Modal */}
      {commissionUserId && (
        <ProductCommissionModal
          isOpen={commissionModalOpen}
          onClose={() => {
            setCommissionModalOpen(false);
            setCommissionUserId(null);
          }}
          userId={commissionUserId}
          userName={users.find((u) => u.id === commissionUserId)?.fullName || ''}
        />
      )}

      {/* «Уволенные» (dismissed employees) Modal */}
      <DismissedModal isOpen={dismissedOpen} onClose={() => setDismissedOpen(false)} />
    </div>
  );
}

// ─── «Уволенные» (dismissed employees recycle bin) ──────────────────

function DismissedModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [restoreUser, setRestoreUser] = useState<User | null>(null);
  const [purgeUser, setPurgeUser] = useState<User | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['users-dismissed'],
    queryFn: () => usersApi.listDismissed(),
    // Backend already excludes purged rows; filter defensively in case a stale
    // cache snapshot ever carries one.
    select: (res) => (res.data as User[]).filter((u) => !u.purgedAt),
    enabled: isOpen,
  });

  const dismissed = data ?? [];

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['users'] });
    queryClient.invalidateQueries({ queryKey: ['users-dismissed'] });
  };

  const restoreMutation = useMutation({
    mutationFn: (id: string) => usersApi.restore(id),
    onSuccess: () => {
      invalidate();
      toast.success('Сотрудник восстановлен');
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Ошибка восстановления');
    },
  });

  const purgeMutation = useMutation({
    mutationFn: (id: string) => usersApi.purge(id),
    onSuccess: () => {
      invalidate();
      toast.success('Сотрудник удалён полностью');
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Ошибка удаления');
    },
  });

  const busy = restoreMutation.isPending || purgeMutation.isPending;

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title="Уволенные сотрудники" size="lg">
        {isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="w-6 h-6 animate-spin text-primary-500" />
          </div>
        ) : dismissed.length === 0 ? (
          <div className="text-center py-10 text-gray-400">
            <UserX className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="text-sm font-medium text-gray-500">Нет уволенных сотрудников</p>
            <p className="text-xs mt-1">
              Уволенные сотрудники появятся здесь и могут быть восстановлены в течение года
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {dismissed.map((user) => {
              const daysLeft = user.dismissedAt ? restoreDaysLeft(user.dismissedAt) : 0;
              const canRestore = daysLeft > 0;
              return (
                <div
                  key={user.id}
                  className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-gray-50 rounded-xl border border-gray-100 px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-900 text-sm truncate">{user.fullName}</span>
                      <span className={`flex-shrink-0 ${roleBadgeMapDismissed[user.role] || 'badge-gray'}`}>
                        {roleLabels[user.role] || user.role}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {user.dismissedAt ? (
                        <>
                          Уволен {formatDismissedDate(user.dismissedAt)}
                          {' · '}
                          {canRestore ? (
                            <span className="text-gray-500">
                              можно восстановить ещё {daysLeft} {pluralizeDays(daysLeft)}
                            </span>
                          ) : (
                            <span className="text-red-500">срок восстановления истёк</span>
                          )}
                        </>
                      ) : (
                        'Уволен'
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => setRestoreUser(user)}
                      disabled={busy || !canRestore}
                      className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-700 bg-primary-50 hover:bg-primary-100 disabled:opacity-40 disabled:cursor-not-allowed px-3 py-1.5 rounded-lg transition-colors"
                      title={canRestore ? 'Восстановить' : 'Срок восстановления истёк'}
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Восстановить
                    </button>
                    <button
                      onClick={() => setPurgeUser(user)}
                      disabled={busy}
                      className="inline-flex items-center gap-1.5 text-sm font-medium text-red-700 bg-red-50 hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed px-3 py-1.5 rounded-lg transition-colors"
                      title="Удалить полностью"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Удалить полностью
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Modal>

      {/* Restore confirmation */}
      <ConfirmDialog
        isOpen={!!restoreUser}
        onClose={() => setRestoreUser(null)}
        onConfirm={() => {
          if (restoreUser) restoreMutation.mutate(restoreUser.id);
          setRestoreUser(null);
        }}
        title="Восстановить сотрудника"
        message={
          restoreUser
            ? `Восстановить сотрудника «${restoreUser.fullName}»? Он снова станет активным и появится во всех списках.`
            : ''
        }
        confirmText="Восстановить"
        variant="primary"
      />

      {/* Purge (delete completely) confirmation */}
      <ConfirmDialog
        isOpen={!!purgeUser}
        onClose={() => setPurgeUser(null)}
        onConfirm={() => {
          if (purgeUser) purgeMutation.mutate(purgeUser.id);
          setPurgeUser(null);
        }}
        title="Удалить полностью"
        message={
          purgeUser
            ? `Удалить сотрудника «${purgeUser.fullName}» полностью? История заказ-нарядов и смен сохранится, но восстановить сотрудника будет уже невозможно. Это действие необратимо.`
            : ''
        }
        confirmText="Удалить полностью"
        variant="danger"
      />
    </>
  );
}

// ─── Product Commission Configuration Modal ─────────────────────────

function ProductCommissionModal({
  isOpen,
  onClose,
  userId,
  userName,
}: {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  userName: string;
}) {
  const queryClient = useQueryClient();
  const [globalPct, setGlobalPct] = useState(0);
  const [items, setItems] = useState<Array<{ productId: string; percent: number; productName: string }>>([]);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);

  // Load current commissions
  const { data: commissionData, isLoading } = useQuery({
    queryKey: ['product-commissions', userId],
    queryFn: () => usersApi.getProductCommissions(userId),
    enabled: isOpen,
  });

  // Load all products
  const { data: productsData } = useQuery({
    queryKey: ['products-all-commission'],
    queryFn: () => productsApi.getAll({ limit: 1000 }),
    enabled: isOpen,
  });

  const allProducts: Product[] = (() => {
    const d = productsData?.data;
    if (!d) return [];
    return Array.isArray(d) ? d : (d as PaginatedResponse<Product>).data || [];
  })();

  useEffect(() => {
    if (commissionData?.data) {
      setGlobalPct(commissionData.data.productSalaryPercent || 0);
      setItems(
        (commissionData.data.items || []).map((i: any) => ({
          productId: i.productId,
          percent: i.percent,
          productName: i.productName,
        })),
      );
    }
  }, [commissionData]);

  const addProduct = useCallback((product: Product) => {
    setItems((prev) => {
      if (prev.some((i) => i.productId === product.id)) return prev;
      return [...prev, { productId: product.id, percent: 10, productName: product.name }];
    });
    setSearch('');
  }, []);

  const removeProduct = useCallback((productId: string) => {
    setItems((prev) => prev.filter((i) => i.productId !== productId));
  }, []);

  const updatePercent = useCallback((productId: string, pct: number) => {
    setItems((prev) => prev.map((i) => (i.productId === productId ? { ...i, percent: pct } : i)));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await usersApi.setProductCommissions(userId, {
        productSalaryPercent: globalPct,
        items: items.map((i) => ({ productId: i.productId, percent: i.percent })),
      });
      queryClient.invalidateQueries({ queryKey: ['product-commissions', userId] });
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success('Комиссии сохранены');
      onClose();
    } catch {
      toast.error('Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

  const searchResults =
    search.trim().length >= 2
      ? allProducts
          .filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
          .filter((p) => !items.some((i) => i.productId === p.id))
          .slice(0, 10)
      : [];

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: 'RUB',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(v);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Комиссия с товаров — ${userName}`} size="lg">
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-primary-500" />
        </div>
      ) : (
        <div className="space-y-5">
          {/* Global product commission */}
          <div className="bg-gradient-to-r from-primary-50 to-blue-50 rounded-xl p-4 border border-primary-100">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-gray-900">Глобальный % со всех товаров</p>
                <p className="text-xs text-gray-500 mt-0.5">С чистой прибыли каждого товара</p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={globalPct}
                  onChange={(e) => setGlobalPct(Math.max(0, Math.min(100, Number(e.target.value))))}
                  className="w-20 text-right text-sm font-semibold border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                />
                <span className="text-sm font-medium text-gray-500">%</span>
              </div>
            </div>
          </div>

          {/* Product-specific commissions */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-sm font-semibold text-gray-900">Индивидуальные товары</p>
                <p className="text-xs text-gray-500">Переопределяют глобальный процент</p>
              </div>
            </div>

            {/* Search to add products */}
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Найти и добавить товар..."
                className="input pl-10 w-full"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
              {searchResults.length > 0 && (
                <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-10 max-h-48 overflow-y-auto">
                  {searchResults.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => addProduct(p)}
                      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 text-left"
                    >
                      <Package className="w-4 h-4 text-gray-300 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-900 truncate">{p.name}</p>
                        <p className="text-xs text-gray-400">Прибыль: {formatCurrency(p.sellPrice - p.costPrice)}</p>
                      </div>
                      <Plus className="w-4 h-4 text-primary-500 flex-shrink-0" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Selected products with commissions */}
            {items.length === 0 ? (
              <div className="text-center py-6 text-gray-400">
                <Gift className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">Нет индивидуальных товаров</p>
                <p className="text-xs mt-1">Будет применяться глобальный %</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {items.map((item) => {
                  const product = allProducts.find((p) => p.id === item.productId);
                  const profit = product ? product.sellPrice - product.costPrice : 0;
                  const bonus = Math.round((profit * item.percent) / 100);
                  return (
                    <div key={item.productId} className="flex items-center gap-3 bg-gray-50 rounded-xl px-3 py-2.5">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{item.productName}</p>
                        <p className="text-xs text-gray-400">
                          Прибыль: {formatCurrency(profit)} → Бонус:{' '}
                          <span className="text-green-600 font-medium">{formatCurrency(bonus)}</span>
                        </p>
                      </div>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={1}
                        value={item.percent}
                        onChange={(e) =>
                          updatePercent(item.productId, Math.max(0, Math.min(100, Number(e.target.value))))
                        }
                        className="w-16 text-right text-sm font-medium border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                      />
                      <span className="text-xs text-gray-400">%</span>
                      <button
                        onClick={() => removeProduct(item.productId)}
                        className="p-1 text-red-400 hover:text-red-600"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200">
            <button type="button" onClick={onClose} className="btn-secondary">
              Отмена
            </button>
            <button onClick={handleSave} disabled={saving} className="btn-primary">
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Сохранение...
                </>
              ) : (
                'Сохранить'
              )}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
