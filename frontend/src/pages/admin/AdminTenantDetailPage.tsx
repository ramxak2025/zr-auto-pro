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
  Wallet,
  Gift,
  StickyNote,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { format, parseISO, isPast, formatDistanceToNow, addDays, addYears } from 'date-fns';
import { ru } from 'date-fns/locale';

import { tenantsApi, usersApi, plansApi } from '../../api/services';
import type { ExtendSubscriptionRequest } from '../../api/services';
import { useAuth } from '../../contexts/AuthContext';
import { Tenant, User, UserRole, TenantCabinet, SubscriptionStatus, Plan } from '../../types';
import Modal from '../../components/Modal';
import ConfirmDialog from '../../components/ConfirmDialog';
import QueryState from '../../components/QueryState';
import Switch from '../../components/Switch';
import EmptyState from '../../components/EmptyState';
import SubscriptionPeriodBadge from '../../components/SubscriptionPeriodBadge';
import { roleLabels } from '../../../../shared/utils/formatters';

// Quick-fill presets — each computes the new "until" date from the anchor
// (current end if still in the future, otherwise today). They only set the
// date; the paid/free mode is chosen separately above.
const EXTEND_PRESETS: { label: string; add: (d: Date) => Date }[] = [
  { label: '+30 дней', add: (d) => addDays(d, 30) },
  { label: '+90 дней', add: (d) => addDays(d, 90) },
  { label: '+год', add: (d) => addYears(d, 1) },
];

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
  const [extendMode, setExtendMode] = useState<'paid' | 'free'>('paid');
  const [extendAmount, setExtendAmount] = useState('');
  const [extendUntil, setExtendUntil] = useState(''); // YYYY-MM-DD
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
  const {
    data: tenant,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useQuery({
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
    mutationFn: (opts: ExtendSubscriptionRequest) => tenantsApi.extend(id!, opts),
    onSuccess: (_res, opts) => {
      invalidateTenant();
      toast.success(opts.type === 'paid' ? 'Подписка продлена (оплачено)' : 'Подписка продлена (бесплатно)');
      setExtendModalOpen(false);
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

  // Anchor for date math: the current end if it's still in the future,
  // otherwise today (a lapsed subscription restarts from now).
  const extendAnchor = (): Date => {
    const end = tenant?.subscriptionEnd ? parseISO(tenant.subscriptionEnd) : null;
    return end && !isPast(end) ? end : new Date();
  };

  const openExtendModal = () => {
    setExtendMode('paid');
    // Pre-fill amount with the plan price (a sensible default the operator can edit).
    setExtendAmount(subStatus?.planPrice ? String(subStatus.planPrice) : '');
    setExtendUntil(format(addDays(extendAnchor(), 30), 'yyyy-MM-dd'));
    setExtendModalOpen(true);
  };

  // Presets only fill the until-date under the chosen paid/free mode.
  const applyExtendPreset = (add: (d: Date) => Date) => {
    setExtendUntil(format(add(extendAnchor()), 'yyyy-MM-dd'));
  };

  const handleExtendSubmit = () => {
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    if (!extendUntil || extendUntil <= todayStr) {
      toast.error('Укажите дату окончания в будущем');
      return;
    }
    if (extendMode === 'paid') {
      const amount = Number(extendAmount);
      if (!Number.isFinite(amount) || amount <= 0) {
        toast.error('Введите сумму больше 0');
        return;
      }
      extendMutation.mutate({ type: 'paid', amount: Math.round(amount), until: extendUntil });
    } else {
      extendMutation.mutate({ type: 'free', until: extendUntil });
    }
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

    // ROLE-ONLY (126): permissions в payload НЕ отправляем ни при создании, ни
    // при редактировании — backend их игнорирует (users.service пишет пустую
    // карту, права определяет назначенная роль). Раньше create слал мёртвый
    // словарь defaultPermissions.
    const payload: any = {
      fullName: userForm.fullName,
      phone: userForm.phone,
      role: userForm.role,
      salaryPercent: Number(userForm.salaryPercent),
      isActive: userForm.isActive,
      tenantId: id,
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

  // Loading → inline loader; a transient fetch FAILURE → error+retry (not a
  // permanent "не найден"). Only a resolved-but-empty response is a real 404.
  if (isLoading || isError) {
    return (
      <QueryState
        isLoading={isLoading}
        isError={isError}
        onRetry={refetch}
        isFetching={isFetching}
        errorTitle="Не удалось загрузить автосервис"
        minHeight="min-h-[60vh]"
      >
        {null}
      </QueryState>
    );
  }

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

  // Extend-modal derived validation (paid → amount>0 + future date; free → future date).
  const extendTodayStr = format(new Date(), 'yyyy-MM-dd');
  const extendUntilValid = !!extendUntil && extendUntil > extendTodayStr;
  const extendAmountNum = Number(extendAmount);
  const extendAmountValid = Number.isFinite(extendAmountNum) && extendAmountNum > 0;
  const canSubmitExtend = extendUntilValid && (extendMode === 'free' || extendAmountValid);

  return (
    <div>
      {/* Back link */}
      <button
        onClick={() => navigate('/admin/tenants')}
        className="mb-3 flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700"
      >
        <ArrowLeft className="w-4 h-4" />
        Назад к автосервисам
      </button>

      {/* Header card: имя + статус + действия одной панелью */}
      <div className="card mb-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-primary-50">
              <Building2 className="h-5 w-5 text-primary-600" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-bold text-gray-900 md:text-2xl">{tenant.name}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {tenant.isActive ? (
                  <span className="badge-green">Активна</span>
                ) : (
                  <span className="badge-red">Отключена</span>
                )}
                {subStatus && (
                  <span className={subStatusMeta[subStatus.status].badge}>{subStatusMeta[subStatus.status].label}</span>
                )}
                <SubscriptionPeriodBadge
                  kind={subStatus?.currentPeriodKind ?? tenant.currentPeriodKind}
                  until={subStatus?.subscriptionEnd ?? tenant.subscriptionEnd}
                  size="sm"
                />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button onClick={openExtendModal} className="btn-primary btn-sm">
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
            <button onClick={openTenantEdit} className="btn-secondary btn-sm">
              <Pencil className="w-4 h-4" />
              Редактировать
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
          </div>
        </div>

        {subStatus?.status === 'suspended' && (
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

      <div className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* Подписка (superadmin cabinet) */}
        <div className="card p-5 xl:col-span-2">
          <h2 className="mb-4 text-base font-semibold text-gray-900">Подписка</h2>
          {subStatus ? (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <div>
                <p className="text-xs text-gray-500 mb-0.5">Тариф</p>
                <p className="text-sm font-semibold text-gray-900">{subStatus.planName || 'Не назначен'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-0.5">Стоимость</p>
                <p className="text-sm font-semibold tabular-nums text-gray-900">{formatRub(subStatus.planPrice)}/мес</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-0.5">Действует до</p>
                {subStatus.subscriptionEnd ? (
                  <p
                    className={`text-sm font-semibold tabular-nums ${
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
                <p className="text-sm font-semibold tabular-nums text-gray-900">
                  {subStatus.currentUsers} / {subStatus.maxUsers}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              Загрузка данных подписки…
            </div>
          )}

          {/* Показатели клиента */}
          {metrics && (
            <div className="mt-5 border-t border-gray-100 pt-4">
              <h3 className="mb-3 text-sm font-semibold text-gray-900">Показатели клиента</h3>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <div className="rounded-lg bg-gray-50 p-3">
                  <div className="mb-1 flex items-center gap-1.5 text-gray-500">
                    <ClipboardList className="h-3.5 w-3.5" />
                    <span className="text-xs">Заказ-наряды</span>
                  </div>
                  <p className="text-lg font-bold tabular-nums text-gray-900">{metrics.checksTotal}</p>
                  <p className="text-xs tabular-nums text-gray-500">за 30 дней: {metrics.checksLast30d}</p>
                </div>
                <div className="rounded-lg bg-gray-50 p-3">
                  <div className="mb-1 flex items-center gap-1.5 text-gray-500">
                    <Banknote className="h-3.5 w-3.5" />
                    <span className="text-xs">Выручка</span>
                  </div>
                  <p className="text-lg font-bold tabular-nums text-gray-900">{formatRub(metrics.revenueTotal)}</p>
                  <p className="text-xs tabular-nums text-gray-500">за 30 дней: {formatRub(metrics.revenueLast30d)}</p>
                </div>
                <div className="rounded-lg bg-gray-50 p-3">
                  <div className="mb-1 flex items-center gap-1.5 text-gray-500">
                    <Users className="h-3.5 w-3.5" />
                    <span className="text-xs">Сотрудники</span>
                  </div>
                  <p className="text-lg font-bold tabular-nums text-gray-900">{metrics.usersCount}</p>
                  <p className="text-xs tabular-nums text-gray-500">активных: {metrics.activeUsersCount}</p>
                </div>
                <div className="rounded-lg bg-gray-50 p-3">
                  <div className="mb-1 flex items-center gap-1.5 text-gray-500">
                    <Package className="h-3.5 w-3.5" />
                    <span className="text-xs">Товары / активность</span>
                  </div>
                  <p className="text-lg font-bold tabular-nums text-gray-900">{metrics.productsCount}</p>
                  <p className="flex items-center gap-1 text-xs text-gray-500">
                    {metrics.lastActivityAt ? (
                      <>
                        <Clock className="h-3 w-3" />
                        {formatDistanceToNow(parseISO(metrics.lastActivityAt), {
                          addSuffix: true,
                          locale: ru,
                        })}
                      </>
                    ) : (
                      <>
                        <Activity className="h-3 w-3" />
                        нет активности
                      </>
                    )}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Информация о тенанте */}
        <div className="card p-5">
          <h2 className="mb-4 text-base font-semibold text-gray-900">Информация</h2>
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-2">
              <Phone className="w-4 h-4 flex-shrink-0 text-gray-400" />
              <span className="text-gray-700">{tenant.phone || '—'}</span>
            </div>
            <div className="flex items-center gap-2">
              <Mail className="w-4 h-4 flex-shrink-0 text-gray-400" />
              <span className="truncate text-gray-700">{tenant.email || '—'}</span>
            </div>
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 flex-shrink-0 text-gray-400" />
              <span className="text-gray-700">{tenant.address || '—'}</span>
            </div>
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 flex-shrink-0 text-gray-400" />
              <span className="tabular-nums text-gray-700">
                Пользователей: {tenantUsers.length} / {tenant.maxUsers}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <CalendarDays className="w-4 h-4 flex-shrink-0 text-gray-400" />
              <span className="text-gray-500">Подписка до:</span>
              {subscriptionEnd ? (
                <span className={`tabular-nums ${isExpired ? 'font-medium text-red-600' : 'text-gray-700'}`}>
                  {format(subscriptionEnd, 'd MMM yyyy', { locale: ru })}
                </span>
              ) : (
                <span className="text-gray-400">не указано</span>
              )}
            </div>
            {tenant.subscriptionNote && (
              <div className="flex items-start gap-2">
                <StickyNote className="mt-0.5 w-4 h-4 flex-shrink-0 text-gray-400" />
                <span className="text-gray-600">{tenant.subscriptionNote}</span>
              </div>
            )}
            {tenant.slug && (
              <div className="text-gray-500">
                Slug: <span className="font-mono text-gray-700">{tenant.slug}</span>
              </div>
            )}
            {tenant.description && <p className="border-t border-gray-100 pt-3 text-gray-600">{tenant.description}</p>}
          </div>
        </div>
      </div>

      {/* Users Section */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-semibold text-gray-900">
          Пользователи <span className="tabular-nums text-gray-400">({tenantUsers.length})</span>
        </h2>
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
                <th className="text-right">Действия</th>
              </tr>
            </thead>
            <tbody>
              {tenantUsers.map((user) => (
                <tr key={user.id}>
                  <td className="font-medium text-gray-900">{user.fullName}</td>
                  <td className="tabular-nums">{user.phone}</td>
                  <td>
                    <span className={roleBadgeMap[user.role] || 'badge-gray'}>
                      {roleLabels[user.role] || user.role}
                    </span>
                  </td>
                  <td className="tabular-nums">{user.salaryPercent}%</td>
                  <td>
                    {user.isActive ? (
                      <span className="badge-green">Активен</span>
                    ) : (
                      <span className="badge-red">Неактивен</span>
                    )}
                  </td>
                  <td>
                    <div className="flex items-center justify-end gap-1">
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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
              <label className="label">Email</label>
              <input
                type="email"
                className="input"
                value={tenantForm.email}
                onChange={(e) => setTenantForm({ ...tenantForm, email: e.target.value })}
              />
            </div>
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
            <p className="mt-1 text-xs text-gray-500">
              Меняется автоматически при назначении тарифа. Ручное значение — осознанное исключение для этого
              автосервиса.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Switch
              checked={tenantForm.isActive}
              onChange={(v) => setTenantForm({ ...tenantForm, isActive: v })}
              label="Автосервис активен"
            />
            <span className="text-sm font-medium text-gray-700">{tenantForm.isActive ? 'Активна' : 'Неактивна'}</span>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
            <p className="mt-1 text-xs text-gray-500">
              Права сотрудника определяются ролью. Тонкая настройка ролей — в приложении владельца автосервиса.
            </p>
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
            <Switch
              checked={userForm.isActive}
              onChange={(v) => setUserForm({ ...userForm, isActive: v })}
              label="Сотрудник активен"
            />
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

      {/* Extend Subscription Modal — paid/free segmented flow */}
      <Modal isOpen={extendModalOpen} onClose={() => setExtendModalOpen(false)} title="Продлить подписку" size="sm">
        <div className="space-y-4">
          {/* Current period */}
          <div className="rounded-xl bg-gray-50 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-gray-500">Текущий срок</span>
              <span className="text-sm font-semibold tabular-nums text-gray-900">
                {subscriptionEnd ? format(subscriptionEnd, 'd MMMM yyyy', { locale: ru }) : 'не указан'}
              </span>
            </div>
            {subStatus?.currentPeriodKind && (
              <div className="mt-2">
                <SubscriptionPeriodBadge
                  kind={subStatus.currentPeriodKind}
                  until={subStatus.subscriptionEnd}
                  size="sm"
                />
              </div>
            )}
          </div>

          {/* Paid / Free segmented toggle */}
          <div>
            <label className="label">Тип продления</label>
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-gray-100 p-1">
              <button
                type="button"
                onClick={() => setExtendMode('paid')}
                className={`flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                  extendMode === 'paid' ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <Wallet className="h-4 w-4" />
                Платно
              </button>
              <button
                type="button"
                onClick={() => setExtendMode('free')}
                className={`flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                  extendMode === 'free' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <Gift className="h-4 w-4" />
                Бесплатно
              </button>
            </div>
            <p className="mt-1.5 text-xs text-gray-500">
              {extendMode === 'paid'
                ? 'Платёж запишется в выручку по подпискам.'
                : 'Бесплатное продление не учитывается как выручка.'}
            </p>
          </div>

          {/* Amount — paid only */}
          {extendMode === 'paid' && (
            <div>
              <label className="label">Сумма платежа, ₽</label>
              <input
                type="number"
                className="input tabular-nums"
                value={extendAmount}
                onChange={(e) => setExtendAmount(e.target.value)}
                placeholder="например, 2990"
                min={1}
                inputMode="numeric"
              />
            </div>
          )}

          {/* Quick presets fill the until-date */}
          <div>
            <label className="label">Быстрое продление</label>
            <div className="grid grid-cols-3 gap-2">
              {EXTEND_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => applyExtendPreset(preset.add)}
                  className="btn-secondary justify-center py-2 text-sm"
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-gray-400">
              Считаются от {subscriptionEnd && !isExpired ? 'текущего срока' : 'сегодня'} и подставляют дату ниже.
            </p>
          </div>

          {/* Until date */}
          <div>
            <label className="label">Действует до</label>
            <input
              type="date"
              className="input tabular-nums"
              value={extendUntil}
              min={extendTodayStr}
              onChange={(e) => setExtendUntil(e.target.value)}
            />
            {extendUntil && !extendUntilValid && (
              <p className="mt-1 text-xs text-red-600">Дата должна быть в будущем.</p>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-200">
            <button type="button" onClick={() => setExtendModalOpen(false)} className="btn-secondary">
              Отмена
            </button>
            <button
              type="button"
              onClick={handleExtendSubmit}
              disabled={!canSubmitExtend || extendMutation.isPending}
              className="btn-primary"
            >
              {extendMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Продление...
                </>
              ) : extendMode === 'paid' ? (
                extendAmountValid ? (
                  `Продлить · ${formatRub(extendAmountNum)}`
                ) : (
                  'Продлить'
                )
              ) : (
                'Продлить бесплатно'
              )}
            </button>
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
