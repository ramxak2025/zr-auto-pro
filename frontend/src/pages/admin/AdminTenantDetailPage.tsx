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
  CalendarPlus,
  CreditCard,
  LogIn,
  Banknote,
  Package,
  Activity,
  Clock,
  ClipboardList,
  PauseCircle,
  PlayCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { format, parseISO, isPast, formatDistanceToNow } from 'date-fns';
import { ru } from 'date-fns/locale';

import { tenantsApi, usersApi, plansApi } from '../../api/services';
import { useAuth } from '../../contexts/AuthContext';
import { Tenant, User, UserRole, UserPermissions, TenantCabinet, SubscriptionStatus, Plan } from '../../types';
import Modal from '../../components/Modal';
import ConfirmDialog from '../../components/ConfirmDialog';
import LoadingSpinner from '../../components/LoadingSpinner';
import EmptyState from '../../components/EmptyState';
import { roleLabels } from '../../../../shared/utils/formatters';

const EXTEND_PRESETS = [30, 90] as const;

function formatRub(value: number | undefined | null): string {
  return `${(value ?? 0).toLocaleString('ru-RU')} ₽`;
}

const roleBadgeMap: Record<string, string> = {
  director: 'badge-blue',
  admin: 'badge-green',
  master: 'badge-yellow',
};

// Subscription status → badge label/class for the cabinet header (102).
const subStatusMeta: Record<SubscriptionStatus, { label: string; badge: string }> = {
  active: { label: 'Активна', badge: 'badge-green' },
  expired: { label: 'Истекла', badge: 'badge-yellow' },
  suspended: { label: 'Приостановлена', badge: 'badge-red' },
};

const defaultPermissions: UserPermissions = {
  checks_view: true,
  checks_create: true,
  checks_edit: false,
  checks_delete: false,
  checks_change_datetime: false,
  profit_view: false,
  clients_view: true,
  clients_edit: false,
  warehouse_access: false,
  suppliers_access: false,
  financial_reports: false,
  export_data: false,
  user_management: false,
  schedule_view: false,
  salary_view: false,
  marketing_access: false,
};

// ----------- Tenant Edit Form -----------
interface TenantFormData {
  name: string;
  phone: string;
  address: string;
  email: string;
  description: string;
  maxUsers: number;
  voiceMinutesExtra: number;
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
  const { refreshUser } = useAuth();

  // Subscription management modals
  const [extendModalOpen, setExtendModalOpen] = useState(false);
  const [customDays, setCustomDays] = useState('');
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [impersonateConfirm, setImpersonateConfirm] = useState(false);

  // Suspend / unsuspend (102)
  const [suspendModalOpen, setSuspendModalOpen] = useState(false);
  const [suspendReason, setSuspendReason] = useState('');
  const [unsuspendConfirm, setUnsuspendConfirm] = useState(false);

  // Tenant edit modal
  const [tenantModalOpen, setTenantModalOpen] = useState(false);
  const [tenantForm, setTenantForm] = useState<TenantFormData>({
    name: '',
    phone: '',
    address: '',
    email: '',
    description: '',
    maxUsers: 5,
    voiceMinutesExtra: 0,
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

  // Composed superadmin cabinet: identity + subscription status/plan + activity
  // metrics in one call (replaces the standalone GET /tenants/:id/metrics fetch).
  const { data: cabinet } = useQuery({
    queryKey: ['tenant-cabinet', id],
    queryFn: () => tenantsApi.getCabinet(id!),
    select: (res) => res.data as TenantCabinet,
    enabled: !!id,
    staleTime: 60_000,
  });

  const metrics = cabinet?.metrics;
  const subStatus = cabinet?.subscription;

  // Active plans for the assign-plan picker.
  const { data: plans } = useQuery({
    queryKey: ['plans'],
    queryFn: () => plansApi.getAll(),
    select: (res) => (res.data as Plan[]).filter((p) => p.isActive),
  });

  // Defensive: hide dismissed/purged employees from the active tenant list even
  // if a stale cache snapshot carries them (backend already excludes them).
  const tenantUsers = (tenant?.users ?? []).filter((u) => !u.dismissedAt && !u.purgedAt);

  // Mutations
  const updateTenantMutation = useMutation({
    mutationFn: (data: any) => tenantsApi.update(id!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenant', id] });
      queryClient.invalidateQueries({ queryKey: ['tenants'] });
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
      toast.success('Автосервис обновлён');
      setTenantModalOpen(false);
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Ошибка обновления');
    },
  });

  // ── Subscription management ──
  const invalidateTenant = () => {
    queryClient.invalidateQueries({ queryKey: ['tenant', id] });
    queryClient.invalidateQueries({ queryKey: ['tenant-cabinet', id] });
    queryClient.invalidateQueries({ queryKey: ['tenants'] });
    queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
  };

  const extendMutation = useMutation({
    mutationFn: (days: number) => tenantsApi.extend(id!, days),
    onSuccess: (_res, days) => {
      invalidateTenant();
      toast.success(`Подписка продлена на ${days} дн.`);
      setExtendModalOpen(false);
      setCustomDays('');
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Не удалось продлить подписку');
    },
  });

  const assignPlanMutation = useMutation({
    mutationFn: (planId: string) => tenantsApi.assignPlan(id!, planId),
    onSuccess: () => {
      invalidateTenant();
      toast.success('Тариф назначен');
      setPlanModalOpen(false);
      setSelectedPlanId('');
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Не удалось назначить тариф');
    },
  });

  const impersonateMutation = useMutation({
    mutationFn: () => tenantsApi.impersonate(id!),
    onSuccess: async (res) => {
      const { token } = res.data;
      // Swap the session to the tenant owner: clear superadmin cache so none of
      // the platform-level data bleeds into the impersonated session, then write
      // the short-lived director token and reload into the tenant's app.
      await queryClient.cancelQueries().catch(() => {});
      queryClient.clear();
      localStorage.setItem('token', token);
      await refreshUser();
      toast.success('Вход выполнен от имени владельца');
      window.location.href = '/dashboard';
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Не удалось войти как владелец');
    },
  });

  // ── Suspend / unsuspend (102) ──
  // Suspend forces is_active=false server-side → every employee hits the hard
  // gate; the subscription window itself is untouched, so unsuspend simply
  // restores access.
  const suspendMutation = useMutation({
    mutationFn: (reason: string | undefined) => tenantsApi.suspend(id!, reason),
    onSuccess: () => {
      invalidateTenant();
      toast.success('Автосервис приостановлен');
      setSuspendModalOpen(false);
      setSuspendReason('');
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Не удалось приостановить');
    },
  });

  const unsuspendMutation = useMutation({
    mutationFn: () => tenantsApi.unsuspend(id!),
    onSuccess: () => {
      invalidateTenant();
      toast.success('Работа автосервиса возобновлена');
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Не удалось возобновить');
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
    mutationFn: ({ userId, data }: { userId: string; data: any }) => usersApi.update(userId, data),
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
      queryClient.invalidateQueries({ queryKey: ['users-dismissed'] });
      toast.success('Сотрудник уволен');
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Ошибка увольнения');
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
      voiceMinutesExtra: tenant.voiceMinutesExtra ?? 0,
      isActive: tenant.isActive,
      subscriptionEnd: tenant.subscriptionEnd ? tenant.subscriptionEnd.slice(0, 10) : '',
      subscriptionNote: tenant.subscriptionNote || '',
    });
    setTenantModalOpen(true);
  };

  const openPlanModal = () => {
    setSelectedPlanId(tenant?.planId || '');
    setPlanModalOpen(true);
  };

  const handleCustomExtend = () => {
    const days = Number(customDays);
    if (!Number.isFinite(days) || days <= 0) {
      toast.error('Введите количество дней (больше 0)');
      return;
    }
    extendMutation.mutate(Math.round(days));
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
      voiceMinutesExtra: Number(tenantForm.voiceMinutesExtra),
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
    };

    if (editingUser) {
      // РЕДАКТИРОВАНИЕ: permissions в payload НЕ кладём. Раньше сюда всегда
      // уходила захардкоженная { ...defaultPermissions } — каждый суперадмин-
      // edit сотрудника молча затирал права, настроенные владельцем в
      // приложении (users.service пишет permissions при любом присутствии
      // ключа). Права правит владелец через свой редактор; отсюда — только
      // профиль. При СОЗДАНИИ дефолты оставляем — у нового юзера прав ещё нет.
      if (userForm.password) payload.password = userForm.password;
      updateUserMutation.mutate({ userId: editingUser.id, data: payload });
    } else {
      if (!userForm.password) {
        toast.error('Введите пароль');
        return;
      }
      payload.password = userForm.password;
      payload.permissions = { ...defaultPermissions };
      createUserMutation.mutate(payload);
    }
  };

  const isUserSaving = createUserMutation.isPending || updateUserMutation.isPending;

  if (isLoading) return <LoadingSpinner />;

  if (!tenant) {
    return (
      <EmptyState
        icon={Building2}
        title="Автосервис не найден"
        action={{ label: 'Назад', onClick: () => navigate('/admin/tenants') }}
      />
    );
  }

  const subscriptionEnd = tenant.subscriptionEnd ? parseISO(tenant.subscriptionEnd) : null;
  const isExpired = subscriptionEnd ? isPast(subscriptionEnd) : false;

  // Suspension drives the header action + cabinet banner. Prefer the cabinet
  // status; fall back to the tenant's own suspendedAt marker until it resolves.
  const isSuspended = subStatus ? subStatus.status === 'suspended' : !!tenant.suspendedAt;

  return (
    <div>
      {/* Back + Header */}
      <div className="mb-6">
        <button
          onClick={() => navigate('/admin/tenants')}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-3"
        >
          <ArrowLeft className="w-4 h-4" />
          Назад к автосервисам
        </button>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="page-title">{tenant.name}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => setExtendModalOpen(true)} className="btn-secondary btn-sm">
              <CalendarPlus className="w-4 h-4" />
              Продлить
            </button>
            <button onClick={openPlanModal} className="btn-secondary btn-sm">
              <CreditCard className="w-4 h-4" />
              Тариф
            </button>
            <button onClick={() => setImpersonateConfirm(true)} className="btn-secondary btn-sm">
              <LogIn className="w-4 h-4" />
              Войти как владелец
            </button>
            {isSuspended ? (
              <button
                onClick={() => setUnsuspendConfirm(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-green-200 bg-green-50 px-3 py-1.5 text-xs font-medium text-green-700 transition-colors hover:bg-green-100"
              >
                <PlayCircle className="w-4 h-4" />
                Возобновить
              </button>
            ) : (
              <button
                onClick={() => setSuspendModalOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 transition-colors hover:bg-red-100"
              >
                <PauseCircle className="w-4 h-4" />
                Приостановить
              </button>
            )}
            <button onClick={openTenantEdit} className="btn-secondary btn-sm">
              <Pencil className="w-4 h-4" />
              Редактировать
            </button>
          </div>
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
              <div className="text-sm text-gray-500">Примечание: {tenant.subscriptionNote}</div>
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

      {/* Subscription status (superadmin cabinet) */}
      {subStatus && (
        <div className="card card-body mb-6">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Подписка</h2>
            <span className={subStatusMeta[subStatus.status].badge}>{subStatusMeta[subStatus.status].label}</span>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Тариф</p>
              <p className="text-sm font-semibold text-gray-900">{subStatus.planName || 'Не назначен'}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Стоимость</p>
              <p className="text-sm font-semibold text-gray-900">{formatRub(subStatus.planPrice)}/мес</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Оплачено до</p>
              {subStatus.subscriptionEnd ? (
                <p
                  className={`text-sm font-semibold ${
                    subStatus.status === 'expired' ? 'text-red-600' : 'text-gray-900'
                  }`}
                >
                  {format(parseISO(subStatus.subscriptionEnd), 'd MMMM yyyy', { locale: ru })}
                </p>
              ) : (
                <p className="text-sm font-semibold text-gray-400">Не указано</p>
              )}
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Сотрудников</p>
              <p className="text-sm font-semibold text-gray-900">
                {subStatus.currentUsers} / {subStatus.maxUsers}
              </p>
            </div>
          </div>

          {subStatus.status === 'suspended' && (
            <div className="mt-4 flex items-start gap-3 rounded-lg bg-red-50 p-4">
              <PauseCircle className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-red-700">
                  Работа приостановлена
                  {subStatus.suspendedAt
                    ? ` ${format(parseISO(subStatus.suspendedAt), 'd MMMM yyyy', { locale: ru })}`
                    : ''}
                </p>
                {subStatus.suspendedReason && (
                  <p className="text-sm text-red-600 mt-0.5">Причина: {subStatus.suspendedReason}</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Activity metrics (показатели клиента) */}
      {metrics && (
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">Показатели клиента</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="card card-body">
              <div className="flex items-center gap-2 text-gray-500 mb-1">
                <ClipboardList className="w-4 h-4" />
                <span className="text-xs">Заказ-наряды</span>
              </div>
              <p className="text-xl font-bold text-gray-900">{metrics.checksTotal}</p>
              <p className="text-xs text-gray-500">за 30 дней: {metrics.checksLast30d}</p>
            </div>

            <div className="card card-body">
              <div className="flex items-center gap-2 text-gray-500 mb-1">
                <Banknote className="w-4 h-4" />
                <span className="text-xs">Выручка</span>
              </div>
              <p className="text-xl font-bold text-gray-900">{formatRub(metrics.revenueTotal)}</p>
              <p className="text-xs text-gray-500">за 30 дней: {formatRub(metrics.revenueLast30d)}</p>
            </div>

            <div className="card card-body">
              <div className="flex items-center gap-2 text-gray-500 mb-1">
                <Users className="w-4 h-4" />
                <span className="text-xs">Сотрудники</span>
              </div>
              <p className="text-xl font-bold text-gray-900">{metrics.usersCount}</p>
              <p className="text-xs text-gray-500">активных: {metrics.activeUsersCount}</p>
            </div>

            <div className="card card-body">
              <div className="flex items-center gap-2 text-gray-500 mb-1">
                <Package className="w-4 h-4" />
                <span className="text-xs">Товары / активность</span>
              </div>
              <p className="text-xl font-bold text-gray-900">{metrics.productsCount}</p>
              <p className="text-xs text-gray-500 flex items-center gap-1">
                {metrics.lastActivityAt ? (
                  <>
                    <Clock className="w-3 h-3" />
                    {formatDistanceToNow(parseISO(metrics.lastActivityAt), {
                      addSuffix: true,
                      locale: ru,
                    })}
                  </>
                ) : (
                  <>
                    <Activity className="w-3 h-3" />
                    нет активности
                  </>
                )}
              </p>
            </div>
          </div>
        </div>
      )}

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
          description="Создайте первого сотрудника"
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
                        title="Уволить"
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
        title="Редактировать автосервис"
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
              onChange={(e) => setTenantForm({ ...tenantForm, description: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Максимум пользователей</label>
            <input
              type="number"
              className="input"
              value={tenantForm.maxUsers}
              onChange={(e) => setTenantForm({ ...tenantForm, maxUsers: Number(e.target.value) })}
              min={1}
            />
          </div>
          <div className="flex items-center gap-3">
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                className="sr-only peer"
                checked={tenantForm.isActive}
                onChange={(e) => setTenantForm({ ...tenantForm, isActive: e.target.checked })}
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary-500/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600" />
            </label>
            <span className="text-sm font-medium text-gray-700">{tenantForm.isActive ? 'Активна' : 'Неактивна'}</span>
          </div>
          <div>
            <label className="label">Подписка до</label>
            <input
              type="date"
              className="input"
              value={tenantForm.subscriptionEnd}
              onChange={(e) => setTenantForm({ ...tenantForm, subscriptionEnd: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Примечание к подписке</label>
            <input
              type="text"
              className="input"
              value={tenantForm.subscriptionNote}
              onChange={(e) => setTenantForm({ ...tenantForm, subscriptionNote: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Доп. минуты голоса (надбавка)</label>
            <input
              type="number"
              className="input"
              value={tenantForm.voiceMinutesExtra}
              onChange={(e) => setTenantForm({ ...tenantForm, voiceMinutesExtra: Number(e.target.value) })}
              min={0}
              step={1}
            />
            <p className="mt-1 text-xs text-gray-500">
              Прибавляется к пакету минут голосового ввода из тарифа. 0 = без надбавки.
            </p>
          </div>
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200">
            <button type="button" onClick={() => setTenantModalOpen(false)} className="btn-secondary">
              Отмена
            </button>
            <button type="submit" disabled={updateTenantMutation.isPending} className="btn-primary">
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
              onChange={(e) => setUserForm({ ...userForm, role: e.target.value as UserRole })}
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
              onChange={(e) => setUserForm({ ...userForm, salaryPercent: Number(e.target.value) })}
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
                onChange={(e) => setUserForm({ ...userForm, isActive: e.target.checked })}
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary-500/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600" />
            </label>
            <span className="text-sm font-medium text-gray-700">{userForm.isActive ? 'Активен' : 'Неактивен'}</span>
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

      {/* Dismiss User Confirmation */}
      <ConfirmDialog
        isOpen={!!deleteUserId}
        onClose={() => setDeleteUserId(null)}
        onConfirm={() => {
          if (deleteUserId) deleteUserMutation.mutate(deleteUserId);
          setDeleteUserId(null);
        }}
        title="Уволить сотрудника"
        message="Уволить сотрудника? Он переместится в Уволенные, восстановить можно в течение года."
        confirmText="Уволить"
        variant="danger"
      />

      {/* Extend Subscription Modal */}
      <Modal isOpen={extendModalOpen} onClose={() => setExtendModalOpen(false)} title="Продлить подписку" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-gray-500">
            Подписка до:{' '}
            <span className="font-medium text-gray-700">
              {subscriptionEnd ? format(subscriptionEnd, 'd MMMM yyyy', { locale: ru }) : 'не указано'}
            </span>
          </p>

          <div className="grid grid-cols-2 gap-3">
            {EXTEND_PRESETS.map((days) => (
              <button
                key={days}
                onClick={() => extendMutation.mutate(days)}
                disabled={extendMutation.isPending}
                className="btn-secondary justify-center"
              >
                +{days} дней
              </button>
            ))}
          </div>

          <div>
            <label className="label">Своё количество дней</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                className="input"
                value={customDays}
                onChange={(e) => setCustomDays(e.target.value)}
                placeholder="например, 14"
                min={1}
              />
              <button
                onClick={handleCustomExtend}
                disabled={extendMutation.isPending}
                className="btn-primary whitespace-nowrap"
              >
                {extendMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Продлить'}
              </button>
            </div>
          </div>
        </div>
      </Modal>

      {/* Assign Plan Modal */}
      <Modal isOpen={planModalOpen} onClose={() => setPlanModalOpen(false)} title="Назначить тариф" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-gray-500">
            Назначение тарифа синхронизирует цену и лимит сотрудников автосервиса.
          </p>

          <div>
            <label className="label">Тариф</label>
            <select className="input" value={selectedPlanId} onChange={(e) => setSelectedPlanId(e.target.value)}>
              <option value="">— Выберите тариф —</option>
              {(plans ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {formatRub(p.monthlyPrice)}/мес · до {p.maxUsers} сотр.
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-200">
            <button type="button" onClick={() => setPlanModalOpen(false)} className="btn-secondary">
              Отмена
            </button>
            <button
              type="button"
              disabled={!selectedPlanId || assignPlanMutation.isPending}
              onClick={() => selectedPlanId && assignPlanMutation.mutate(selectedPlanId)}
              className="btn-primary"
            >
              {assignPlanMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Назначение...
                </>
              ) : (
                'Назначить'
              )}
            </button>
          </div>
        </div>
      </Modal>

      {/* Impersonate Confirmation */}
      <ConfirmDialog
        isOpen={impersonateConfirm}
        onClose={() => setImpersonateConfirm(false)}
        onConfirm={() => {
          setImpersonateConfirm(false);
          impersonateMutation.mutate();
        }}
        title="Войти как владелец"
        message={`Вы войдёте в аккаунт владельца «${tenant.name}» под временной сессией (30 минут). Текущая сессия суперадмина будет заменена — потребуется повторный вход. Продолжить?`}
        confirmText="Войти"
        variant="primary"
      />

      {/* Suspend Modal (reason + confirm) */}
      <Modal
        isOpen={suspendModalOpen}
        onClose={() => setSuspendModalOpen(false)}
        title="Приостановить автосервис"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-500">
            Сотрудники «{tenant.name}» потеряют доступ к приложению до возобновления. Срок подписки при этом не
            меняется.
          </p>
          <div>
            <label className="label">Причина (необязательно)</label>
            <textarea
              className="input"
              rows={3}
              value={suspendReason}
              onChange={(e) => setSuspendReason(e.target.value)}
              placeholder="Например: задолженность по оплате"
            />
          </div>
          <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-200">
            <button type="button" onClick={() => setSuspendModalOpen(false)} className="btn-secondary">
              Отмена
            </button>
            <button
              type="button"
              disabled={suspendMutation.isPending}
              onClick={() => suspendMutation.mutate(suspendReason.trim() || undefined)}
              className="btn-danger"
            >
              {suspendMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Приостановка...
                </>
              ) : (
                'Приостановить'
              )}
            </button>
          </div>
        </div>
      </Modal>

      {/* Unsuspend Confirmation */}
      <ConfirmDialog
        isOpen={unsuspendConfirm}
        onClose={() => setUnsuspendConfirm(false)}
        onConfirm={() => {
          setUnsuspendConfirm(false);
          unsuspendMutation.mutate();
        }}
        title="Возобновить работу"
        message={`Возобновить доступ для «${tenant.name}»? Сотрудники снова смогут работать в приложении.`}
        confirmText="Возобновить"
        variant="primary"
      />
    </div>
  );
}
