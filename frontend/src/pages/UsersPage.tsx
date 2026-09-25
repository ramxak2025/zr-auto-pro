import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  Building2,
  Gift,
  KeyRound,
  Package,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Shield,
  ShieldCheck,
  Trash2,
  UserX,
  Users,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';

import { productsApi, rolesApi, usersApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import { PaginatedResponse, Product, User, UserRole } from '../types';
import type { Role } from '../types';
import {
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  Field,
  IconButton,
  InlineLoader,
  Input,
  Modal,
  Money,
  PageHeader,
  SearchInput,
  Select,
  Toolbar,
} from '../ui';
import type { DataTableColumn } from '../ui';
import PhoneInput from '../components/PhoneInput';
import RateByMonthModal from '../components/RateByMonthModal';
import RolesManagement from '../components/RolesManagement';
import UserPointsModal from '../components/UserPointsModal';
import RoleBadge from '../components/company/RoleBadge';
import ToggleRow from '../components/company/ToggleRow';
import UserAvatar from '../components/company/UserAvatar';
import { ErrorRow } from '../components/dashboard/shared';
import { usePointAccess } from '../hooks/usePoints';
import { apiErrorMessage } from '../../../shared/utils/apiError';
import { roleLabels } from '../../../shared/utils/formatters';
import { formatPhone } from '../../../shared/validation/phone';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** 1 день, 2 дня, 5 дней. */
function pluralizeDays(n: number): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return 'дней';
  if (mod10 === 1) return 'день';
  if (mod10 >= 2 && mod10 <= 4) return 'дня';
  return 'дней';
}

/**
 * Окно восстановления — год с момента увольнения. Возвращает целые дни
 * (не меньше 0), чтобы сказать управляющему «можно восстановить ещё N дней».
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

interface UserFormData {
  fullName: string;
  phone: string;
  password: string;
  role: UserRole;
  /**
   * ROLE-ONLY (консолидация 2026-07): назначенная роль — ЕДИНСТВЕННЫЙ источник
   * прав сотрудника. null → без роли (сервер применяет легаси-дефолты строковой
   * роли `role`). Персональных галочек прав больше нет — доступ = роль.
   */
  roleId: string | null;
  salaryPercent: number;
  isActive: boolean;
}

const emptyForm: UserFormData = {
  fullName: '',
  phone: '',
  password: '',
  role: UserRole.MASTER,
  roleId: null,
  salaryPercent: 0,
  isActive: true,
};

const ROLE_OPTIONS = [
  { value: UserRole.DIRECTOR, label: 'Директор' },
  { value: UserRole.ADMIN, label: 'Админ' },
  { value: UserRole.MASTER, label: 'Мастер' },
];

/** Число из поля процента: только цифры, 0–100. */
function clampPercent(raw: string): number {
  const n = Number(raw.replace(/[^\d]/g, ''));
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

export default function UsersPage() {
  const { hasPermission, refreshUser, user: currentUser } = useAuth();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const formId = useId();

  // Волна «права как в Битрикс24»: backend users/ и roles/ гейтятся ключом
  // user_management (не строкой роли), а /auth/me отдаёт эффективные права из
  // матрицы — гейт честный и для admin, и для кастомных ролей. Ручной
  // owner-class-байпас снят: superadmin/director проходят внутри hasPermission.
  const canManageUsers = hasPermission('user_management');

  const [modalOpen, setModalOpen] = useState(false);
  const [rolesOpen, setRolesOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [form, setForm] = useState<UserFormData>({ ...emptyForm });
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [commissionUserId, setCommissionUserId] = useState<string | null>(null);
  const [dismissedOpen, setDismissedOpen] = useState(false);
  // 150 — «Ставка по месяцам»: смена ставки за прошлый/будущий месяц + история.
  const [rateUser, setRateUser] = useState<User | null>(null);
  // 163 — «Филиалы сотрудника»: на каких филиалах человек может работать.
  // Сохраняется СВОЕЙ ручкой (PUT /users/:id/points), а не вместе с формой:
  // это отдельное правило доступа, и снятие филиала мгновенно выкидывает
  // сотрудника из сессии — такое нельзя проводить «заодно» с правкой имени.
  const [pointsUser, setPointsUser] = useState<User | null>(null);
  // Настройка филиалов имеет смысл только у тенанта, где их больше одного:
  // одноточечный автосервис про мульти-точки не знает вовсе.
  const { multiPoint } = usePointAccess();

  // Поиск по имени/телефону — в URL (?q=), чтобы F5 и «Назад» его не теряли.
  const q = params.get('q') ?? '';
  const setQuery = (value: string) => {
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (value) p.set('q', value);
        else p.delete('q');
        return p;
      },
      { replace: true },
    );
  };

  // В слоте ['users'] лежит МАССИВ сотрудников — так его пишут и читают все
  // остальные потребители (прогрев после входа в AuthContext, главная,
  // расписание, планирование) и так он кладётся в IndexedDB-снимок. Форма
  // слота обязана быть ОДНА.
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['users'],
    queryFn: async () => (await usersApi.getAll()).data as User[],
  });

  // Список ролей — для select'а «Роль (доступ)» в карточке сотрудника и для
  // модалки управления. Инвалидация ['roles'] в RolesManagement обновляет оба.
  const { data: rolesData, isLoading: rolesLoading } = useQuery({
    queryKey: ['roles'],
    queryFn: () => rolesApi.list(),
    select: (res) => res.data as Role[],
    enabled: canManageUsers,
  });
  const roles = useMemo(() => rolesData ?? [], [rolesData]);
  const systemRoles = roles.filter((r) => r.isSystem);
  const customRoles = roles.filter((r) => !r.isSystem);
  const roleNameById = useMemo(() => new Map(roles.map((r) => [r.id, r.name])), [roles]);

  // Защита: бэкенд уже исключает уволенных/удалённых из активного списка, но
  // устаревший персист-снимок не должен показать никого лишнего.
  const users = useMemo(() => (data ?? []).filter((u) => !u.dismissedAt && !u.purgedAt), [data]);

  const visibleUsers = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return users;
    const digits = needle.replace(/\D/g, '');
    return users.filter(
      (u) =>
        u.fullName.toLowerCase().includes(needle) ||
        (digits.length >= 3 && (u.phone || '').replace(/\D/g, '').includes(digits)),
    );
  }, [users, q]);

  const createMutation = useMutation({
    mutationFn: (payload: any) => usersApi.create(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success('Сотрудник создан');
      closeModal();
    },
    onError: (err: unknown) => {
      toast.error(apiErrorMessage(err) ?? 'Ошибка создания сотрудника');
    },
  });

  const updateMutation = useMutation({
    // ROLE-ONLY (консолидация 2026-07): доступ сотрудника задаётся ТОЛЬКО
    // назначенной ролью (PATCH /users/:id { roleId }). Персональные права
    // (GET/PATCH /users/:id/permissions) сняты — общий PATCH их больше не везёт.
    mutationFn: ({ id, payload }: { id: string; payload: any }) => usersApi.update(id, payload),
    onSuccess: (_res, vars) => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      // Смена СВОЕЙ роли (roleId) меняет собственные эффективные права —
      // рефетчим /auth/me, чтобы hasPermission-гейты обновились сразу.
      if (vars.id === currentUser?.id) void refreshUser();
      toast.success('Сотрудник обновлён');
      closeModal();
    },
    onError: (err: unknown) => {
      toast.error(apiErrorMessage(err) ?? 'Ошибка обновления');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => usersApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['users-dismissed'] });
      toast.success('Сотрудник уволен');
    },
    onError: (err: unknown) => {
      toast.error(apiErrorMessage(err) ?? 'Ошибка увольнения');
    },
  });

  const openCreate = () => {
    setEditingUser(null);
    setForm({ ...emptyForm });
    setModalOpen(true);
  };

  const openEdit = (user: User) => {
    setEditingUser(user);
    setForm({
      fullName: user.fullName,
      phone: user.phone || '',
      password: '',
      role: user.role,
      roleId: user.roleId ?? null,
      salaryPercent: user.salaryPercent,
      isActive: user.isActive,
    });
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingUser(null);
    setForm({ ...emptyForm });
  };

  const canDismiss = (user: User) =>
    user.id !== currentUser?.id && user.role !== 'superadmin' && user.role !== 'director';

  const columns = useMemo<DataTableColumn<User>[]>(
    () => [
      {
        key: 'fullName',
        header: 'Сотрудник',
        primary: true,
        sortable: true,
        render: (u) => (
          <span className="inline-flex min-w-0 items-center gap-2.5">
            <UserAvatar name={u.fullName} src={u.avatar} size="sm" />
            <span className="min-w-0">
              <span className="block truncate">{u.fullName}</span>
              {/* На телефоне колонка «Роль» скрыта — роль уходит второй строкой под имя */}
              <span className="block text-2xs font-normal text-ink-3 sm:hidden">
                {roleLabels[u.role] || u.role}
                {u.id === currentUser?.id ? ' · это вы' : ''}
              </span>
              {u.id === currentUser?.id && (
                <span className="hidden text-2xs font-normal text-ink-3 sm:block">Это вы</span>
              )}
            </span>
          </span>
        ),
      },
      {
        key: 'phone',
        header: 'Телефон',
        hideBelow: 'md',
        render: (u) => <span className="tabular-nums">{formatPhone(u.phone)}</span>,
      },
      { key: 'role', header: 'Роль', hideBelow: 'sm', render: (u) => <RoleBadge role={u.role} /> },
      {
        key: 'roleId',
        header: 'Роль доступа',
        hideBelow: 'lg',
        truncate: true,
        width: 200,
        render: (u) =>
          u.roleId && roleNameById.get(u.roleId) ? (
            roleNameById.get(u.roleId)
          ) : (
            <span className="text-ink-3">Без роли</span>
          ),
      },
      {
        key: 'salaryPercent',
        header: 'Ставка',
        numeric: true,
        sortable: true,
        hideBelow: 'sm',
        width: 96,
        render: (u) => `${u.salaryPercent ?? 0} %`,
      },
      {
        key: 'isActive',
        header: 'Статус',
        hideBelow: 'sm',
        width: 120,
        render: (u) =>
          u.isActive ? (
            <Badge tone="ok" dot>
              Активен
            </Badge>
          ) : (
            <Badge tone="neutral" dot>
              Неактивен
            </Badge>
          ),
      },
      {
        key: 'actions',
        header: <span className="sr-only">Действия</span>,
        interactive: true,
        width: 88,
        align: 'right',
        render: (u) => (
          <span className="inline-flex items-center gap-1">
            <IconButton label="Редактировать сотрудника" icon={Pencil} size="sm" onClick={() => openEdit(u)} />
            {canDismiss(u) && (
              <IconButton
                label="Уволить сотрудника"
                icon={Trash2}
                variant="danger"
                size="sm"
                onClick={() => setDeleteId(u.id)}
              />
            )}
          </span>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentUser?.id, roleNameById],
  );

  if (!canManageUsers) {
    return (
      <div className="space-y-5">
        <PageHeader title="Пользователи" icon={Shield} />
        <EmptyState icon={Users} title="Нет доступа" description="У вас нет прав для управления сотрудниками" />
      </div>
    );
  }

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
    // Проверяем длину ЗДЕСЬ, до запроса. Политика — 8 символов (её же держат
    // users.service и DTO).
    if (form.password && form.password.length < 8) {
      toast.error('Пароль должен быть не менее 8 символов');
      return;
    }

    // ROLE-ONLY: доступ = назначенная роль. Персональные права больше не
    // отправляются (эндпоинты сняты, PATCH /users их игнорирует).
    const payload: any = {
      fullName: form.fullName,
      phone: form.phone,
      role: form.role,
      salaryPercent: Number(form.salaryPercent),
      isActive: form.isActive,
    };

    if (!editingUser) {
      payload.password = form.password;
      createMutation.mutate(payload);
    } else {
      if (form.password) {
        payload.password = form.password;
      }
      // Назначение роли (единственный источник прав). Только держатель
      // user_management и только в edit-режиме: CreateUserRequest roleId не
      // принимает. null снимает роль (возврат к легаси-дефолтам строковой
      // роли). Сервер сам защищает от самолокаута.
      if (canManageUsers) {
        payload.roleId = form.roleId;
      }
      updateMutation.mutate({ id: editingUser.id, payload });
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  const rolesLink = (
    <button
      type="button"
      onClick={() => setRolesOpen(true)}
      className="rounded font-medium text-accent underline underline-offset-2 hover:text-accent-hover focus-ring"
    >
      «Роли»
    </button>
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Пользователи"
        icon={Shield}
        subtitle={isLoading ? 'Доступ и роли сотрудников' : `${users.length} активных · доступ задаётся ролью`}
        actions={
          <>
            <Button variant="secondary" icon={KeyRound} onClick={() => setRolesOpen(true)}>
              Роли
            </Button>
            <Button variant="secondary" icon={Archive} onClick={() => setDismissedOpen(true)}>
              Уволенные
            </Button>
            <Button icon={Plus} onClick={openCreate}>
              Новый сотрудник
            </Button>
          </>
        }
      />

      <Toolbar>
        <SearchInput value={q} onChange={setQuery} placeholder="Имя или телефон…" className="w-full sm:w-72" />
        {q && (
          <span className="text-sm text-ink-3">
            Найдено: <span className="tabular-nums text-ink">{visibleUsers.length}</span>
          </span>
        )}
      </Toolbar>

      <DataTable
        rows={visibleUsers}
        rowKey={(u) => u.id}
        onRowClick={openEdit}
        rowLabel={(u) => `Открыть карточку: ${u.fullName}`}
        columns={columns}
        isLoading={isLoading}
        isError={isError}
        onRetry={refetch}
        isFetching={isFetching}
        caption="Сотрудники с доступом в систему"
        emptyState={
          q
            ? { icon: Search, title: 'Никого не нашли', description: 'Измените запрос или очистите поиск' }
            : {
                icon: Users,
                title: 'Нет сотрудников',
                description: 'Добавьте первого сотрудника — он сможет войти по телефону и паролю',
                action: { label: 'Добавить', onClick: openCreate },
              }
        }
      />

      {/* Создание / редактирование */}
      <Modal
        isOpen={modalOpen}
        onClose={closeModal}
        title={editingUser ? 'Редактировать сотрудника' : 'Новый сотрудник'}
        description={
          editingUser
            ? `${roleLabels[editingUser.role] || editingUser.role} · ${formatPhone(editingUser.phone)}`
            : 'Логин — номер телефона, пароль не короче 8 символов'
        }
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={closeModal} disabled={isSaving}>
              Отмена
            </Button>
            <Button type="submit" form={formId} loading={isSaving}>
              {editingUser ? 'Сохранить' : 'Создать'}
            </Button>
          </>
        }
      >
        <form id={formId} onSubmit={handleSubmit} className="space-y-4">
          <Field label="ФИО" htmlFor={`${formId}-name`} required>
            <Input
              id={`${formId}-name`}
              name="name"
              autoComplete="name"
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              placeholder="Иванов Иван Иванович"
              required
            />
          </Field>

          <Field label="Телефон (логин для входа)" htmlFor={`${formId}-phone`} required>
            <PhoneInput
              id={`${formId}-phone`}
              name="tel"
              autoComplete="tel"
              value={form.phone}
              onChange={(value) => setForm({ ...form, phone: value })}
              placeholder="+7 (XXX) XXX-XX-XX"
            />
          </Field>

          <Field
            label={editingUser ? 'Новый пароль' : 'Пароль'}
            htmlFor={`${formId}-password`}
            required={!editingUser}
            hint={editingUser ? 'Оставьте пустым, чтобы не менять. Не короче 8 символов.' : 'Не короче 8 символов.'}
          >
            <Input
              id={`${formId}-password`}
              type="password"
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder={editingUser ? 'Новый пароль' : 'Введите пароль'}
              required={!editingUser}
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Роль" htmlFor={`${formId}-role`}>
              <Select
                id={`${formId}-role`}
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })}
                options={ROLE_OPTIONS}
              />
            </Field>

            <Field label="Ставка от услуг" htmlFor={`${formId}-percent`}>
              <Input
                id={`${formId}-percent`}
                inputMode="numeric"
                value={String(form.salaryPercent)}
                onChange={(e) => setForm({ ...form, salaryPercent: clampPercent(e.target.value) })}
                className="tabular-nums"
                rightSlot={<span className="text-sm text-ink-3">%</span>}
              />
            </Field>
          </div>
          {editingUser && (
            <p className="-mt-2 text-xs text-ink-3">
              Ставка меняется с текущего месяца. Задним числом или на будущее —{' '}
              <button
                type="button"
                onClick={() => setRateUser(editingUser)}
                className="rounded font-medium text-accent underline underline-offset-2 hover:text-accent-hover focus-ring"
              >
                ставка по месяцам
              </button>
              .
            </p>
          )}

          {/* Назначенная роль прав — ЕДИНСТВЕННЫЙ источник доступа (ROLE-ONLY).
              Только edit-режим: создание её не принимает (роль назначается после
              создания). Виден только owner-class. */}
          {editingUser && canManageUsers && (
            <Field
              label="Роль доступа"
              htmlFor={`${formId}-access`}
              hint={
                <>
                  Доступ сотрудника полностью определяется ролью. Что может роль — настраивается в {rolesLink}.
                  Изменения применяются в течение ~30 секунд.
                </>
              }
            >
              <Select
                id={`${formId}-access`}
                value={form.roleId ?? ''}
                onChange={(e) => setForm({ ...form, roleId: e.target.value || null })}
              >
                <option value="">Без роли (базовые права по типу «{roleLabels[form.role] || form.role}»)</option>
                {systemRoles.length > 0 && (
                  <optgroup label="Системные">
                    {systemRoles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                {customRoles.length > 0 && (
                  <optgroup label="Мои роли">
                    {customRoles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </Select>
            </Field>
          )}

          {/* Комиссия с товаров — только у существующих */}
          {editingUser && (form.role === UserRole.MASTER || form.role === UserRole.ADMIN) && (
            <SettingRow
              icon={Gift}
              title="Комиссия с товаров"
              description={
                editingUser.productSalaryPercent
                  ? `${editingUser.productSalaryPercent}% с чистой прибыли`
                  : 'Не настроена'
              }
              action={
                <Button variant="secondary" size="sm" onClick={() => setCommissionUserId(editingUser.id)}>
                  Настроить
                </Button>
              }
            />
          )}

          {/* ── Филиалы сотрудника (163) ──────────────────────────────────
              «Настройка, на каких филиалах они могут работать» — требование
              владельца дословно. Только в режиме редактирования: у ещё не
              созданного сотрудника нет id, которому назначать доступ. У
              одноточечного тенанта блока нет вовсе. */}
          {editingUser && canManageUsers && multiPoint && (
            <SettingRow
              icon={Building2}
              title="Филиалы сотрудника"
              description="Где он может работать — выбирается им при входе"
              action={
                <Button variant="secondary" size="sm" onClick={() => setPointsUser(editingUser)}>
                  Настроить
                </Button>
              }
            />
          )}

          <ToggleRow
            label="Активен"
            description="Неактивный сотрудник не может войти в систему, но остаётся в отчётах."
            checked={form.isActive}
            onChange={(v) => setForm({ ...form, isActive: v })}
          />

          {/* Права доступа — ROLE-ONLY (консолидация 2026-07). Персональных
              галочек прав больше нет: доступ сотрудника = его роль. */}
          {canManageUsers && (
            <div className="flex items-start gap-2.5 rounded-lg border border-line bg-surface-2 px-4 py-3">
              <ShieldCheck className="mt-0.5 h-4 w-4 flex-shrink-0 text-ink-3" aria-hidden="true" />
              <p className="text-xs leading-relaxed text-ink-2">
                Права доступа задаёт назначенная роль — отдельных галочек по сотруднику больше нет. Чтобы изменить, что
                может роль, откройте {rolesLink}.
              </p>
            </div>
          )}
        </form>
      </Modal>

      {/* Увольнение */}
      <ConfirmDialog
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => {
          if (deleteId) deleteMutation.mutate(deleteId);
          setDeleteId(null);
        }}
        title="Уволить сотрудника"
        message="Уволить сотрудника? Он переместится в «Уволенные», восстановить можно в течение года."
        confirmText="Уволить"
        variant="danger"
      />

      {/* Комиссия с товаров */}
      {commissionUserId && (
        <ProductCommissionModal
          isOpen={!!commissionUserId}
          onClose={() => setCommissionUserId(null)}
          userId={commissionUserId}
          userName={users.find((u) => u.id === commissionUserId)?.fullName || ''}
        />
      )}

      {/* 150 — «Ставка по месяцам»: пересчёт выбранного месяца + история. */}
      {rateUser && (
        <RateByMonthModal
          isOpen={!!rateUser}
          onClose={() => setRateUser(null)}
          userId={rateUser.id}
          userName={rateUser.fullName}
          currentSalaryPercent={rateUser.salaryPercent || 0}
          currentProductPercent={rateUser.productSalaryPercent || 0}
        />
      )}

      {/* 163 — «Филиалы сотрудника»: доступ к филиалам настраивается ЗДЕСЬ,
          в карточке человека; раздел «Филиалы» показывает состав только для
          просмотра. Сохраняется своей ручкой, отдельно от формы сотрудника. */}
      {pointsUser && (
        <UserPointsModal
          isOpen={!!pointsUser}
          onClose={() => setPointsUser(null)}
          userId={pointsUser.id}
          userName={pointsUser.fullName}
        />
      )}

      <DismissedModal isOpen={dismissedOpen} onClose={() => setDismissedOpen(false)} />

      {/* Роли и права (Bitrix24-style) — только owner-class */}
      {canManageUsers && (
        <RolesManagement
          isOpen={rolesOpen}
          onClose={() => setRolesOpen(false)}
          roles={roles}
          rolesLoading={rolesLoading}
          users={users}
        />
      )}
    </div>
  );
}

/** Строка настройки в карточке сотрудника: иконка · заголовок/пояснение ‖ действие. */
function SettingRow({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: typeof Gift;
  title: string;
  description: string;
  action: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface-2 px-4 py-3">
      <div className="flex min-w-0 items-start gap-2.5">
        <Icon className="mt-0.5 h-4 w-4 flex-shrink-0 text-ink-3" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">{title}</p>
          <p className="mt-0.5 text-xs text-ink-3">{description}</p>
        </div>
      </div>
      <div className="flex-shrink-0">{action}</div>
    </div>
  );
}

// ─── «Уволенные» (корзина сотрудников) ──────────────────────────────

function DismissedModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [restoreUser, setRestoreUser] = useState<User | null>(null);
  const [purgeUser, setPurgeUser] = useState<User | null>(null);

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['users-dismissed'],
    queryFn: () => usersApi.listDismissed(),
    // Бэкенд уже исключает удалённых; фильтруем на случай устаревшего снимка кеша.
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
    onError: (err: unknown) => {
      toast.error(apiErrorMessage(err) ?? 'Ошибка восстановления');
    },
  });

  const purgeMutation = useMutation({
    mutationFn: (id: string) => usersApi.purge(id),
    onSuccess: () => {
      invalidate();
      toast.success('Сотрудник удалён полностью');
    },
    onError: (err: unknown) => {
      toast.error(apiErrorMessage(err) ?? 'Ошибка удаления');
    },
  });

  const busy = restoreMutation.isPending || purgeMutation.isPending;

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title="Уволенные сотрудники"
        description="Восстановить можно в течение года после увольнения"
        size="lg"
      >
        {isLoading ? (
          <InlineLoader minHeight="py-10" />
        ) : isError ? (
          <ErrorRow message="Не удалось загрузить уволенных" onRetry={() => refetch()} loading={isFetching} />
        ) : dismissed.length === 0 ? (
          <EmptyState
            compact
            icon={UserX}
            title="Нет уволенных сотрудников"
            description="Уволенные появятся здесь и могут быть восстановлены в течение года"
          />
        ) : (
          <ul className="space-y-2">
            {dismissed.map((user) => {
              const daysLeft = user.dismissedAt ? restoreDaysLeft(user.dismissedAt) : 0;
              const canRestore = daysLeft > 0;
              return (
                <li
                  key={user.id}
                  className="flex flex-col gap-3 rounded-lg border border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <UserAvatar name={user.fullName} src={user.avatar} size="sm" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-ink">{user.fullName}</span>
                        <RoleBadge role={user.role} size="sm" />
                      </div>
                      <p className="mt-0.5 text-xs text-ink-3">
                        {user.dismissedAt ? (
                          <>
                            Уволен {formatDismissedDate(user.dismissedAt)}
                            {' · '}
                            {canRestore ? (
                              <>
                                можно восстановить ещё {daysLeft} {pluralizeDays(daysLeft)}
                              </>
                            ) : (
                              <span className="text-bad-text">срок восстановления истёк</span>
                            )}
                          </>
                        ) : (
                          'Уволен'
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={RotateCcw}
                      onClick={() => setRestoreUser(user)}
                      disabled={busy || !canRestore}
                      title={canRestore ? undefined : 'Срок восстановления истёк'}
                    >
                      Восстановить
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={Trash2}
                      onClick={() => setPurgeUser(user)}
                      disabled={busy}
                      className="text-bad-text hover:text-bad-text"
                    >
                      Удалить полностью
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Modal>

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

// ─── Комиссия с товаров ─────────────────────────────────────────────

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
  const idBase = useId();
  const [globalPct, setGlobalPct] = useState(0);
  const [items, setItems] = useState<Array<{ productId: string; percent: number; productName: string }>>([]);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);

  const { data: commissionData, isLoading } = useQuery({
    queryKey: ['product-commissions', userId],
    queryFn: () => usersApi.getProductCommissions(userId),
    enabled: isOpen,
  });

  const { data: productsData } = useQuery({
    queryKey: ['products-all-commission'],
    queryFn: () => productsApi.getAll({ limit: 1000 }),
    enabled: isOpen,
  });

  const allProducts: Product[] = useMemo(() => {
    const d = productsData?.data;
    if (!d) return [];
    return Array.isArray(d) ? d : (d as PaginatedResponse<Product>).data || [];
  }, [productsData]);

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
    } catch (err) {
      toast.error(apiErrorMessage(err) ?? 'Ошибка сохранения');
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

  const percentSlot = <span className="text-sm text-ink-3">%</span>;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Комиссия с товаров"
      description={userName}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Отмена
          </Button>
          <Button onClick={handleSave} loading={saving} disabled={isLoading}>
            Сохранить
          </Button>
        </>
      }
    >
      {isLoading ? (
        <InlineLoader minHeight="py-8" />
      ) : (
        <div className="space-y-5">
          {/* Глобальный процент */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface-2 px-4 py-3">
            <div className="min-w-0">
              <label htmlFor={`${idBase}-global`} className="block text-sm font-medium text-ink">
                Глобальный % со всех товаров
              </label>
              <p className="mt-0.5 text-xs text-ink-3">С чистой прибыли каждого товара</p>
            </div>
            <Input
              id={`${idBase}-global`}
              inputMode="numeric"
              value={String(globalPct)}
              onChange={(e) => setGlobalPct(clampPercent(e.target.value))}
              className="w-24 text-right tabular-nums"
              rightSlot={percentSlot}
            />
          </div>

          {/* Индивидуальные товары */}
          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium text-ink">Индивидуальные товары</p>
              <p className="text-xs text-ink-3">Переопределяют глобальный процент</p>
            </div>

            <div className="relative">
              <Input
                aria-label="Найти и добавить товар"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Найти и добавить товар…"
                leftIcon={Search}
                autoComplete="off"
                rightSlot={
                  search ? (
                    <IconButton label="Очистить поиск" icon={X} size="sm" onClick={() => setSearch('')} />
                  ) : undefined
                }
              />
              {searchResults.length > 0 && (
                <ul
                  role="listbox"
                  aria-label="Найденные товары"
                  className="absolute left-0 right-0 top-full z-10 mt-1 max-h-48 overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-pop"
                >
                  {searchResults.map((p) => (
                    <li key={p.id} role="option" aria-selected={false}>
                      <button
                        type="button"
                        onClick={() => addProduct(p)}
                        className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-surface-3 focus-ring"
                      >
                        <Package className="h-4 w-4 flex-shrink-0 text-ink-4" aria-hidden="true" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-ink">{p.name}</span>
                          <span className="block text-xs text-ink-3">
                            Прибыль: <Money value={p.sellPrice - p.costPrice} />
                          </span>
                        </span>
                        <Plus className="h-4 w-4 flex-shrink-0 text-accent" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {items.length === 0 ? (
              <EmptyState
                compact
                icon={Gift}
                title="Нет индивидуальных товаров"
                description="Будет применяться глобальный процент"
              />
            ) : (
              <ul className="max-h-60 space-y-2 overflow-y-auto">
                {items.map((item) => {
                  const product = allProducts.find((p) => p.id === item.productId);
                  const profit = product ? product.sellPrice - product.costPrice : 0;
                  const bonus = Math.round((profit * item.percent) / 100);
                  const inputId = `${idBase}-item-${item.productId}`;
                  return (
                    <li
                      key={item.productId}
                      className="flex items-center gap-3 rounded-lg border border-line px-3 py-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <label htmlFor={inputId} className="block truncate text-sm font-medium text-ink">
                          {item.productName}
                        </label>
                        <p className="text-xs text-ink-3">
                          Прибыль: <Money value={profit} /> → бонус:{' '}
                          <Money value={bonus} className="font-medium text-ok-text" />
                        </p>
                      </div>
                      <Input
                        id={inputId}
                        inputMode="numeric"
                        size="sm"
                        value={String(item.percent)}
                        onChange={(e) => updatePercent(item.productId, clampPercent(e.target.value))}
                        className="w-20 text-right tabular-nums"
                        rightSlot={percentSlot}
                      />
                      <IconButton
                        label={`Убрать ${item.productName}`}
                        icon={X}
                        size="sm"
                        variant="danger"
                        onClick={() => removeProduct(item.productId)}
                      />
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
