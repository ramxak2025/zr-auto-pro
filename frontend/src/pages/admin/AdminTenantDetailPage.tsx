import { useId, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  Banknote,
  Building2,
  CalendarDays,
  CalendarPlus,
  ChevronDown,
  ClipboardList,
  Clock,
  CreditCard,
  Gift,
  Info,
  LogIn,
  Mail,
  MapPin,
  Package,
  PauseCircle,
  Pencil,
  Phone,
  PlayCircle,
  Plus,
  StickyNote,
  Trash2,
  Users,
  Wallet,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { format, parseISO, isPast, formatDistanceToNow, addDays, addYears } from 'date-fns';
import { ru } from 'date-fns/locale';

import { tenantsApi, usersApi, plansApi } from '../../api/services';
import type { ExtendSubscriptionRequest } from '../../api/services';
import { useAuth } from '../../contexts/AuthContext';
import { Tenant, User, UserRole, TenantCabinet, SubscriptionStatus, Plan } from '../../types';
import { formatMoney, roleLabels } from '../../../../shared/utils/formatters';
import { formatPhone } from '../../../../shared/validation/phone';
import PageHeader from '../../components/PageHeader';
import Modal from '../../components/Modal';
import ConfirmDialog from '../../components/ConfirmDialog';
import QueryState from '../../components/QueryState';
import Switch from '../../components/Switch';
import EmptyState from '../../components/EmptyState';
import SubscriptionPeriodBadge from '../../components/SubscriptionPeriodBadge';
import { writeSessionToken } from '../../utils/sessionToken';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Card, CardHeader } from '../../ui/Card';
import { DataTable, type DataTableColumn } from '../../ui/DataTable';
import { DropdownMenu, type MenuEntry } from '../../ui/DropdownMenu';
import { Field } from '../../ui/Field';
import { IconButton } from '../../ui/IconButton';
import { Input } from '../../ui/Input';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { Select } from '../../ui/Select';
import { Skeleton } from '../../ui/Skeleton';
import { Textarea } from '../../ui/Textarea';
import { cn } from '../../ui/cn';
import { focusRing, type Tone } from '../../ui/tokens';
import {
  ErrorRow,
  InfoRow,
  MiniStat,
  TenantStatusBadges,
  ToggleChip,
  formatDateRu,
} from '../../components/admin/adminUi';

// Quick-fill presets — each computes the new "until" date from the anchor
// (current end if still in the future, otherwise today). They only set the
// date; the paid/free mode is chosen separately above.
const EXTEND_PRESETS: { label: string; add: (d: Date) => Date }[] = [
  { label: '+30 дней', add: (d) => addDays(d, 30) },
  { label: '+90 дней', add: (d) => addDays(d, 90) },
  { label: '+год', add: (d) => addYears(d, 1) },
];

// Роль — метка, не статус: владелец — акцент, остальные нейтральны.
const roleTone: Record<string, Tone> = {
  director: 'accent',
  admin: 'info',
  master: 'neutral',
};

// Subscription status → badge label/tone for the cabinet header (102).
const subStatusMeta: Record<SubscriptionStatus, { label: string; tone: Tone }> = {
  active: { label: 'Подписка активна', tone: 'ok' },
  expired: { label: 'Подписка истекла', tone: 'warn' },
  suspended: { label: 'Приостановлена', tone: 'bad' },
};

const digitsOnly = (v: string) => v.replace(/[^\d]/g, '');

// ----------- Tenant Edit Form -----------
interface TenantFormData {
  name: string;
  phone: string;
  address: string;
  email: string;
  description: string;
  maxUsers: string;
  voiceMinutesExtra: string;
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
  salaryPercent: string;
  isActive: boolean;
}

const emptyUserForm: UserFormData = {
  fullName: '',
  phone: '',
  password: '',
  role: UserRole.MASTER,
  salaryPercent: '0',
  isActive: true,
};

export default function AdminTenantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { refreshUser } = useAuth();
  const uid = useId();

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
    maxUsers: '5',
    voiceMinutesExtra: '0',
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
  const {
    data: cabinet,
    isError: cabinetError,
    refetch: refetchCabinet,
    isFetching: cabinetFetching,
  } = useQuery({
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
      // Через writeSessionToken, а не напрямую в localStorage: вкладка обязана
      // запомнить, каким токеном она теперь живёт (167). Иначе собственный
      // заслон «сессия обновлена в другой вкладке» принял бы этот вход за
      // чужой и заблокировал бы запросы ровно той вкладке, которая его сделала.
      writeSessionToken(token);
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
      maxUsers: String(tenant.maxUsers),
      voiceMinutesExtra: String(tenant.voiceMinutesExtra ?? 0),
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
      maxUsers: Math.max(1, Number(tenantForm.maxUsers) || 1),
      voiceMinutesExtra: Number(tenantForm.voiceMinutesExtra) || 0,
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
      salaryPercent: String(user.salaryPercent),
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
      salaryPercent: Number(userForm.salaryPercent) || 0,
      isActive: userForm.isActive,
      tenantId: id,
    };

    // Та же политика, что на сервере и в мобильной админке — 8 символов.
    if (userForm.password && userForm.password.length < 8) {
      toast.error('Пароль должен быть не менее 8 символов');
      return;
    }

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

  // Loading → скелет; сбой сети → ошибка с «Повторить» (не «не найден»).
  // Только успешно пустой ответ — настоящий 404.
  if (isLoading || isError) {
    return (
      <div className="space-y-5">
        <PageHeader title="Автосервис" icon={Building2} backTo="/admin/tenants" />
        {isLoading ? (
          <div className="space-y-5" aria-busy="true">
            <Card padding="md">
              <Skeleton className="h-6 w-1/3" />
              <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i}>
                    <Skeleton variant="text" className="w-20" />
                    <Skeleton className="mt-2 h-5 w-24" />
                  </div>
                ))}
              </div>
            </Card>
            <Card padding="md">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="mt-4 h-32 w-full" />
            </Card>
          </div>
        ) : (
          <Card padding="md">
            <QueryState
              isLoading={false}
              isError
              onRetry={refetch}
              isFetching={isFetching}
              errorTitle="Не удалось загрузить автосервис"
            >
              {null}
            </QueryState>
          </Card>
        )}
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="space-y-5">
        <PageHeader title="Автосервис" icon={Building2} backTo="/admin/tenants" />
        <Card padding="md">
          <EmptyState
            icon={Building2}
            title="Автосервис не найден"
            action={{ label: 'К списку автосервисов', onClick: () => navigate('/admin/tenants') }}
          />
        </Card>
      </div>
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

  const moreItems: MenuEntry[] = [
    { key: 'impersonate', label: 'Войти как владелец', icon: LogIn, onSelect: () => setImpersonateConfirm(true) },
    { type: 'separator', key: 'sep' },
    isSuspended
      ? { key: 'unsuspend', label: 'Возобновить работу', icon: PlayCircle, onSelect: () => setUnsuspendConfirm(true) }
      : {
          key: 'suspend',
          label: 'Приостановить',
          icon: PauseCircle,
          danger: true,
          onSelect: () => setSuspendModalOpen(true),
        },
  ];

  const userColumns: DataTableColumn<User>[] = [
    { key: 'fullName', header: 'Имя', render: (u) => <span className="font-medium text-ink">{u.fullName}</span> },
    {
      key: 'phone',
      header: 'Телефон',
      hideBelow: 'sm',
      render: (u) => <span className="tabular-nums text-ink-2">{u.phone ? formatPhone(u.phone) : '—'}</span>,
    },
    {
      key: 'role',
      header: 'Роль',
      render: (u) => <Badge tone={roleTone[u.role] ?? 'neutral'}>{roleLabels[u.role] || u.role}</Badge>,
    },
    {
      key: 'salaryPercent',
      header: 'Ставка',
      numeric: true,
      hideBelow: 'md',
      render: (u) => <span className="text-ink-2">{u.salaryPercent}%</span>,
    },
    {
      key: 'isActive',
      header: 'Статус',
      hideBelow: 'md',
      render: (u) =>
        u.isActive ? (
          <Badge tone="ok" dot>
            Активен
          </Badge>
        ) : (
          <Badge tone="bad" dot>
            Неактивен
          </Badge>
        ),
    },
    {
      key: 'actions',
      header: '',
      interactive: true,
      width: 88,
      render: (u) => (
        <span className="flex justify-end gap-0.5">
          <IconButton label={`Редактировать ${u.fullName}`} icon={Pencil} size="sm" onClick={() => openEditUser(u)} />
          <IconButton
            label={`Уволить ${u.fullName}`}
            icon={Trash2}
            size="sm"
            variant="danger"
            onClick={() => setDeleteUserId(u.id)}
          />
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={tenant.name}
        icon={Building2}
        backTo="/admin/tenants"
        subtitle={
          tenant.plan?.name
            ? `Тариф «${tenant.plan.name}» · ${formatMoney(tenant.monthlyPrice)}/мес`
            : 'Тариф не назначен'
        }
        meta={
          <>
            <TenantStatusBadges tenant={tenant} size="sm" />
            {subStatus && subStatus.status !== 'active' && (
              <Badge tone={subStatusMeta[subStatus.status].tone} size="sm">
                {subStatusMeta[subStatus.status].label}
              </Badge>
            )}
            <SubscriptionPeriodBadge
              kind={subStatus?.currentPeriodKind ?? tenant.currentPeriodKind}
              until={subStatus?.subscriptionEnd ?? tenant.subscriptionEnd}
              size="sm"
            />
          </>
        }
        actions={
          <>
            <Button icon={CalendarPlus} onClick={openExtendModal}>
              Продлить
            </Button>
            <Button variant="secondary" icon={CreditCard} onClick={openPlanModal}>
              Тариф
            </Button>
            <Button variant="secondary" icon={Pencil} onClick={openTenantEdit}>
              Редактировать
            </Button>
            <DropdownMenu
              aria-label="Ещё действия"
              items={moreItems}
              trigger={
                <Button variant="secondary" iconRight={ChevronDown}>
                  Ещё
                </Button>
              }
            />
          </>
        }
      />

      {isSuspended && (
        <div
          className="flex items-start gap-3 rounded-xl border border-bad/20 bg-bad-soft px-4 py-3 text-sm text-bad-text"
          role="status"
        >
          <PauseCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-bad" aria-hidden="true" />
          <div>
            <p className="font-medium">
              Работа приостановлена
              {subStatus?.suspendedAt ? ` ${formatDateRu(subStatus.suspendedAt, 'd MMMM yyyy')}` : ''}
            </p>
            {subStatus?.suspendedReason && <p className="mt-0.5">Причина: {subStatus.suspendedReason}</p>}
            <p className="mt-0.5 text-bad-text/80">Сотрудники не могут войти в приложение до возобновления.</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3 xl:items-start">
        {/* Подписка + показатели (superadmin cabinet) */}
        <Card padding="none" className="xl:col-span-2">
          <CardHeader icon={CreditCard} title="Подписка" subtitle="Тариф, срок и лимит сотрудников" />
          <div className="px-5 py-4">
            {cabinetError && !subStatus ? (
              <ErrorRow
                message="Не удалось загрузить данные подписки"
                onRetry={() => refetchCabinet()}
                loading={cabinetFetching}
              />
            ) : !subStatus ? (
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" aria-busy="true">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i}>
                    <Skeleton variant="text" className="w-20" />
                    <Skeleton className="mt-2 h-5 w-24" />
                  </div>
                ))}
              </div>
            ) : (
              <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <MiniStat label="Тариф" value={subStatus.planName || 'Не назначен'} />
                <MiniStat label="Стоимость" value={`${formatMoney(subStatus.planPrice)}/мес`} />
                <MiniStat
                  label="Действует до"
                  value={
                    subStatus.subscriptionEnd ? formatDateRu(subStatus.subscriptionEnd, 'd MMMM yyyy') : 'Не указано'
                  }
                  tone={subStatus.status === 'expired' ? 'bad' : 'neutral'}
                />
                <MiniStat label="Сотрудников" value={`${subStatus.currentUsers} / ${subStatus.maxUsers}`} />
              </dl>
            )}
          </div>

          {/* Показатели клиента — сигналы активности */}
          <div className="border-t border-line px-5 py-4">
            <h3 className="mb-3 text-sm font-semibold text-ink">Показатели клиента</h3>
            {cabinetError && !metrics ? (
              <p className="text-sm text-ink-3">Показатели недоступны — повторите загрузку выше.</p>
            ) : !metrics ? (
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-busy="true">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-[76px] w-full rounded-lg" />
                ))}
              </div>
            ) : (
              <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <MetricTile
                  icon={ClipboardList}
                  label="Заказ-наряды"
                  value={metrics.checksTotal}
                  hint={`за 30 дней: ${metrics.checksLast30d}`}
                />
                <MetricTile
                  icon={Banknote}
                  label="Выручка"
                  value={formatMoney(metrics.revenueTotal)}
                  hint={`за 30 дней: ${formatMoney(metrics.revenueLast30d)}`}
                />
                <MetricTile
                  icon={Users}
                  label="Сотрудники"
                  value={metrics.usersCount}
                  hint={`активных: ${metrics.activeUsersCount}`}
                />
                <MetricTile
                  icon={Package}
                  label="Товары · активность"
                  value={metrics.productsCount}
                  hint={
                    metrics.lastActivityAt ? (
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3 w-3" aria-hidden="true" />
                        {formatDistanceToNow(parseISO(metrics.lastActivityAt), { addSuffix: true, locale: ru })}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        <Activity className="h-3 w-3" aria-hidden="true" />
                        нет активности
                      </span>
                    )
                  }
                />
              </dl>
            )}
          </div>
        </Card>

        {/* Информация о тенанте */}
        <Card padding="none">
          <CardHeader icon={Info} iconTone="neutral" title="Информация" />
          <div className="space-y-3 px-5 py-4">
            <InfoRow icon={Phone} label="Телефон">
              {tenant.phone ? (
                <a
                  href={`tel:${tenant.phone}`}
                  className={cn('rounded tabular-nums hover:text-accent-text', focusRing)}
                >
                  {formatPhone(tenant.phone)}
                </a>
              ) : (
                '—'
              )}
            </InfoRow>
            <InfoRow icon={Mail} label="Email">
              {tenant.email ? (
                <a href={`mailto:${tenant.email}`} className={cn('rounded hover:text-accent-text', focusRing)}>
                  {tenant.email}
                </a>
              ) : (
                '—'
              )}
            </InfoRow>
            <InfoRow icon={MapPin} label="Адрес">
              {tenant.address || '—'}
            </InfoRow>
            <InfoRow icon={Users} label="Пользователей">
              <span className="tabular-nums">
                Пользователей: {tenantUsers.length} / {tenant.maxUsers}
              </span>
            </InfoRow>
            <InfoRow icon={CalendarDays} label="Подписка до">
              <span className="text-ink-3">Подписка до: </span>
              {subscriptionEnd ? (
                <span className={cn('tabular-nums', isExpired ? 'font-medium text-bad-text' : 'text-ink-2')}>
                  {format(subscriptionEnd, 'd MMM yyyy', { locale: ru })}
                </span>
              ) : (
                <span className="text-ink-3">не указано</span>
              )}
            </InfoRow>
            {tenant.subscriptionNote && (
              <InfoRow icon={StickyNote} label="Примечание">
                {tenant.subscriptionNote}
              </InfoRow>
            )}
            {tenant.slug && (
              <p className="text-sm text-ink-3">
                Slug: <span className="font-mono text-ink-2">{tenant.slug}</span>
              </p>
            )}
            {tenant.description && <p className="border-t border-line pt-3 text-sm text-ink-2">{tenant.description}</p>}
          </div>
        </Card>
      </div>

      {/* Сотрудники */}
      <Card padding="none">
        <CardHeader
          icon={Users}
          title="Сотрудники"
          subtitle={`${tenantUsers.length} из ${tenant.maxUsers} по лимиту тарифа`}
          divider={tenantUsers.length === 0}
          actions={
            <Button variant="secondary" size="sm" icon={Plus} onClick={openCreateUser}>
              Новый пользователь
            </Button>
          }
        />
        <DataTable
          bare
          caption={`Сотрудники автосервиса «${tenant.name}»`}
          rows={tenantUsers}
          rowKey={(u) => u.id}
          columns={userColumns}
          emptyState={{
            icon: Users,
            title: 'Нет пользователей',
            description: 'Создайте первого сотрудника',
            action: { label: 'Создать', onClick: openCreateUser },
          }}
        />
      </Card>

      {/* Редактирование автосервиса */}
      <Modal
        isOpen={tenantModalOpen}
        onClose={() => setTenantModalOpen(false)}
        title="Редактировать автосервис"
        size="lg"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setTenantModalOpen(false)}
              disabled={updateTenantMutation.isPending}
            >
              Отмена
            </Button>
            <Button type="submit" form={`${uid}-tenant-form`} loading={updateTenantMutation.isPending}>
              Сохранить
            </Button>
          </>
        }
      >
        <form id={`${uid}-tenant-form`} onSubmit={handleTenantSubmit} className="space-y-4">
          <Field label="Название" htmlFor={`${uid}-t-name`} required>
            <Input
              id={`${uid}-t-name`}
              autoComplete="organization"
              value={tenantForm.name}
              onChange={(e) => setTenantForm({ ...tenantForm, name: e.target.value })}
              required
            />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Телефон" htmlFor={`${uid}-t-phone`}>
              <Input
                id={`${uid}-t-phone`}
                type="tel"
                inputMode="tel"
                value={tenantForm.phone}
                onChange={(e) => setTenantForm({ ...tenantForm, phone: e.target.value })}
              />
            </Field>
            <Field label="Email" htmlFor={`${uid}-t-email`}>
              <Input
                id={`${uid}-t-email`}
                type="email"
                inputMode="email"
                value={tenantForm.email}
                onChange={(e) => setTenantForm({ ...tenantForm, email: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Адрес" htmlFor={`${uid}-t-address`}>
            <Input
              id={`${uid}-t-address`}
              autoComplete="street-address"
              value={tenantForm.address}
              onChange={(e) => setTenantForm({ ...tenantForm, address: e.target.value })}
            />
          </Field>
          <Field label="Описание" htmlFor={`${uid}-t-desc`}>
            <Textarea
              id={`${uid}-t-desc`}
              rows={2}
              value={tenantForm.description}
              onChange={(e) => setTenantForm({ ...tenantForm, description: e.target.value })}
            />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Максимум пользователей"
              htmlFor={`${uid}-t-max`}
              hint="Меняется автоматически при назначении тарифа. Ручное значение — осознанное исключение."
            >
              <Input
                id={`${uid}-t-max`}
                inputMode="numeric"
                className="tabular-nums"
                value={tenantForm.maxUsers}
                onChange={(e) => setTenantForm({ ...tenantForm, maxUsers: digitsOnly(e.target.value) })}
              />
            </Field>
            <Field
              label="Доп. минуты голоса"
              htmlFor={`${uid}-t-voice`}
              hint="Надбавка к пакету минут тарифа. 0 — без надбавки."
            >
              <Input
                id={`${uid}-t-voice`}
                inputMode="numeric"
                className="tabular-nums"
                value={tenantForm.voiceMinutesExtra}
                onChange={(e) => setTenantForm({ ...tenantForm, voiceMinutesExtra: digitsOnly(e.target.value) })}
                rightSlot={<span className="text-xs">мин</span>}
              />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Подписка до" htmlFor={`${uid}-t-sub`}>
              <Input
                id={`${uid}-t-sub`}
                type="date"
                className="tabular-nums"
                value={tenantForm.subscriptionEnd}
                onChange={(e) => setTenantForm({ ...tenantForm, subscriptionEnd: e.target.value })}
              />
            </Field>
            <Field label="Примечание к подписке" htmlFor={`${uid}-t-note`}>
              <Input
                id={`${uid}-t-note`}
                value={tenantForm.subscriptionNote}
                onChange={(e) => setTenantForm({ ...tenantForm, subscriptionNote: e.target.value })}
              />
            </Field>
          </div>
          <div className="flex items-center gap-3 border-t border-line pt-4">
            <Switch
              id={`${uid}-t-active`}
              checked={tenantForm.isActive}
              onChange={(v) => setTenantForm({ ...tenantForm, isActive: v })}
              label="Автосервис активен"
            />
            <label htmlFor={`${uid}-t-active`} className="text-sm font-medium text-ink-2">
              {tenantForm.isActive ? 'Автосервис активен' : 'Автосервис отключён — сотрудники не войдут'}
            </label>
          </div>
        </form>
      </Modal>

      {/* Пользователь: создание / редактирование */}
      <Modal
        isOpen={userModalOpen}
        onClose={closeUserModal}
        title={editingUser ? 'Редактировать пользователя' : 'Новый пользователь'}
        description="Права сотрудника определяются ролью; тонкая настройка ролей — в приложении владельца."
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={closeUserModal} disabled={isUserSaving}>
              Отмена
            </Button>
            <Button type="submit" form={`${uid}-user-form`} loading={isUserSaving}>
              {editingUser ? 'Сохранить' : 'Создать'}
            </Button>
          </>
        }
      >
        <form id={`${uid}-user-form`} onSubmit={handleUserSubmit} className="space-y-4">
          <Field label="ФИО" htmlFor={`${uid}-u-name`} required>
            <Input
              id={`${uid}-u-name`}
              autoComplete="off"
              value={userForm.fullName}
              onChange={(e) => setUserForm({ ...userForm, fullName: e.target.value })}
              placeholder="Иванов Иван Иванович"
              required
            />
          </Field>
          <Field label="Телефон (логин для входа)" htmlFor={`${uid}-u-phone`} required>
            <Input
              id={`${uid}-u-phone`}
              type="tel"
              inputMode="tel"
              autoComplete="off"
              className="tabular-nums"
              value={userForm.phone}
              onChange={(e) => setUserForm({ ...userForm, phone: e.target.value })}
              placeholder="+7 (XXX) XXX-XX-XX"
              required
            />
          </Field>
          <Field
            label={editingUser ? 'Новый пароль' : 'Пароль'}
            htmlFor={`${uid}-u-pass`}
            required={!editingUser}
            hint={editingUser ? 'Оставьте пустым, чтобы не менять. Минимум 8 символов.' : 'Минимум 8 символов'}
          >
            <Input
              id={`${uid}-u-pass`}
              type="password"
              autoComplete="new-password"
              value={userForm.password}
              onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
              required={!editingUser}
            />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Роль" htmlFor={`${uid}-u-role`}>
              <Select
                id={`${uid}-u-role`}
                value={userForm.role}
                onChange={(e) => setUserForm({ ...userForm, role: e.target.value as UserRole })}
              >
                <option value={UserRole.DIRECTOR}>Директор</option>
                <option value={UserRole.ADMIN}>Администратор</option>
                <option value={UserRole.MASTER}>Мастер</option>
              </Select>
            </Field>
            <Field label="Ставка от услуг" htmlFor={`${uid}-u-percent`}>
              <Input
                id={`${uid}-u-percent`}
                inputMode="numeric"
                className="tabular-nums"
                value={userForm.salaryPercent}
                onChange={(e) =>
                  setUserForm({
                    ...userForm,
                    salaryPercent: String(Math.min(100, Number(digitsOnly(e.target.value)) || 0)),
                  })
                }
                rightSlot={<span className="text-xs">%</span>}
              />
            </Field>
          </div>
          <div className="flex items-center gap-3 border-t border-line pt-4">
            <Switch
              id={`${uid}-u-active`}
              checked={userForm.isActive}
              onChange={(v) => setUserForm({ ...userForm, isActive: v })}
              label="Сотрудник активен"
            />
            <label htmlFor={`${uid}-u-active`} className="text-sm font-medium text-ink-2">
              {userForm.isActive ? 'Сотрудник активен' : 'Неактивен — вход закрыт'}
            </label>
          </div>
        </form>
      </Modal>

      {/* Увольнение */}
      <ConfirmDialog
        isOpen={!!deleteUserId}
        onClose={() => setDeleteUserId(null)}
        onConfirm={() => {
          if (deleteUserId) deleteUserMutation.mutate(deleteUserId);
          setDeleteUserId(null);
        }}
        title="Уволить сотрудника"
        message="Уволить сотрудника? Он переместится в «Уволенные», восстановить можно в течение года."
        confirmText="Уволить"
        variant="danger"
      />

      {/* Продление подписки — платно / бесплатно */}
      <Modal
        isOpen={extendModalOpen}
        onClose={() => setExtendModalOpen(false)}
        title="Продлить подписку"
        description={`Текущий срок: ${subscriptionEnd ? format(subscriptionEnd, 'd MMMM yyyy', { locale: ru }) : 'не указан'}`}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setExtendModalOpen(false)} disabled={extendMutation.isPending}>
              Отмена
            </Button>
            <Button onClick={handleExtendSubmit} disabled={!canSubmitExtend} loading={extendMutation.isPending}>
              {extendMode === 'paid'
                ? extendAmountValid
                  ? `Продлить · ${formatMoney(extendAmountNum)}`
                  : 'Продлить'
                : 'Продлить бесплатно'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {subStatus?.currentPeriodKind && (
            <SubscriptionPeriodBadge kind={subStatus.currentPeriodKind} until={subStatus.subscriptionEnd} />
          )}

          <Field
            label="Тип продления"
            hint={
              extendMode === 'paid'
                ? 'Платёж запишется в выручку по подпискам.'
                : 'Бесплатное продление не учитывается как выручка.'
            }
          >
            <SegmentedControl<'paid' | 'free'>
              aria-label="Тип продления"
              fullWidth
              value={extendMode}
              onChange={setExtendMode}
              options={[
                { value: 'paid', label: 'Платно', icon: Wallet },
                { value: 'free', label: 'Бесплатно', icon: Gift },
              ]}
            />
          </Field>

          {extendMode === 'paid' && (
            <Field
              label="Сумма платежа"
              htmlFor={`${uid}-ext-amount`}
              error={extendAmount && !extendAmountValid ? 'Введите сумму больше 0.' : undefined}
            >
              <Input
                id={`${uid}-ext-amount`}
                inputMode="decimal"
                className="tabular-nums"
                value={extendAmount}
                onChange={(e) => setExtendAmount(digitsOnly(e.target.value))}
                placeholder="например, 2990"
                invalid={!!extendAmount && !extendAmountValid}
                rightSlot={<span className="text-xs">₽</span>}
              />
            </Field>
          )}

          <Field
            label="Быстрое продление"
            hint={`Считается от ${subscriptionEnd && !isExpired ? 'текущего срока' : 'сегодня'} и подставляет дату ниже.`}
          >
            <div className="flex flex-wrap gap-2" role="group" aria-label="Быстрое продление">
              {EXTEND_PRESETS.map((preset) => {
                const presetDate = format(preset.add(extendAnchor()), 'yyyy-MM-dd');
                return (
                  <ToggleChip
                    key={preset.label}
                    active={extendUntil === presetDate}
                    onClick={() => applyExtendPreset(preset.add)}
                  >
                    {preset.label}
                  </ToggleChip>
                );
              })}
            </div>
          </Field>

          <Field
            label="Действует до"
            htmlFor={`${uid}-ext-until`}
            error={extendUntil && !extendUntilValid ? 'Дата должна быть в будущем.' : undefined}
          >
            <Input
              id={`${uid}-ext-until`}
              type="date"
              className="tabular-nums"
              value={extendUntil}
              min={extendTodayStr}
              invalid={!!extendUntil && !extendUntilValid}
              onChange={(e) => setExtendUntil(e.target.value)}
            />
          </Field>
        </div>
      </Modal>

      {/* Назначить тариф */}
      <Modal
        isOpen={planModalOpen}
        onClose={() => setPlanModalOpen(false)}
        title="Назначить тариф"
        description="Назначение тарифа синхронизирует цену и лимит сотрудников автосервиса."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPlanModalOpen(false)} disabled={assignPlanMutation.isPending}>
              Отмена
            </Button>
            <Button
              disabled={!selectedPlanId}
              onClick={() => selectedPlanId && assignPlanMutation.mutate(selectedPlanId)}
              loading={assignPlanMutation.isPending}
            >
              Назначить
            </Button>
          </>
        }
      >
        <Field label="Тариф" htmlFor={`${uid}-plan`}>
          <Select
            id={`${uid}-plan`}
            value={selectedPlanId}
            onChange={(e) => setSelectedPlanId(e.target.value)}
            placeholder="— Выберите тариф —"
          >
            {(plans ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {formatMoney(p.monthlyPrice)}/мес · до {p.maxUsers} сотр.
              </option>
            ))}
          </Select>
        </Field>
      </Modal>

      {/* Вход как владелец */}
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

      {/* Приостановка (причина + подтверждение) */}
      <Modal
        isOpen={suspendModalOpen}
        onClose={() => setSuspendModalOpen(false)}
        title="Приостановить автосервис"
        description={`Сотрудники «${tenant.name}» потеряют доступ до возобновления. Срок подписки не меняется.`}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setSuspendModalOpen(false)} disabled={suspendMutation.isPending}>
              Отмена
            </Button>
            <Button
              variant="danger"
              onClick={() => suspendMutation.mutate(suspendReason.trim() || undefined)}
              loading={suspendMutation.isPending}
            >
              Приостановить
            </Button>
          </>
        }
      >
        <Field label="Причина (необязательно)" htmlFor={`${uid}-suspend-reason`}>
          <Textarea
            id={`${uid}-suspend-reason`}
            rows={3}
            value={suspendReason}
            onChange={(e) => setSuspendReason(e.target.value)}
            placeholder="Например: задолженность по оплате"
          />
        </Field>
      </Modal>

      {/* Возобновление */}
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

/** Плитка показателя активности клиента: подпись с иконкой, значение, подсказка. */
function MetricTile({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Users;
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg bg-surface-2 p-3">
      <dt className="mb-1 flex items-center gap-1.5 text-xs text-ink-3">
        <Icon className="h-3.5 w-3.5 text-ink-4" aria-hidden="true" />
        {label}
      </dt>
      <dd>
        <p className="text-lg font-semibold tabular-nums tracking-tight text-ink">{value}</p>
        {hint && <p className="text-xs tabular-nums text-ink-3">{hint}</p>}
      </dd>
    </div>
  );
}
