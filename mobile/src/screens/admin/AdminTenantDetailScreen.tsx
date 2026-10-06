/**
 * AdminTenantDetailScreen — карточка автосервиса платформы: суперадмин (`/tenants/*`)
 * и менеджер (`/manager/tenants/*`, только свои клиенты). Режим — из AdminModeProvider.
 *
 *   • Tenant identity + subscription summary (AUTHORITATIVE status from the
 *     composed getCabinet(id): active / expired / suspended + plan + price).
 *   • «Показатели клиента» — activity metrics from cabinet.metrics (заказ-наряды
 *     30д/всего, выручка 30д/всего, последняя активность, сотрудники, товары).
 *   • Subscription actions:
 *       – Продлить → ExtendSubscriptionSheet (платно/бесплатно; у менеджера — доля владельца)
 *       – Сменить тариф (plan picker → assignPlan, resyncs price + maxUsers)
 *       – Приостановить (suspend с причиной) / Возобновить (unsuspend) — hard
 *         gate on every tenant device, mirrored by the status chip here
 *       – Войти как владелец (impersonate → AuthContext.beginImpersonation)
 *   • Только суперадмин: «Менеджер · Передать», филиалы и сотрудники автосервиса.
 *   • Только менеджер: «Сбросить пароль владельца». Удаления, реквизитов, сотрудников и
 *     филиалов у менеджера нет — сервер их ему не отдаёт.
 */
import React from 'react';
import { AdminSheet } from './adminSheet';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  ActivityIndicator,
  TextInput,
  Switch,
  Share,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRoute } from '@react-navigation/native';
import { tenantsApi, plansApi, usersApi, managerApi } from '../../api/services';
import IosScreenHeader from '../../components/IosScreenHeader';
import { Text } from '../../platform/Typography';
import { haptic } from '../../platform/haptics';
import { useAuth } from '../../contexts/AuthContext';
import { useColors } from '../../contexts/ThemeContext';
import { useIosSurface } from '../../platform/iosSurface';
import { colors, spacing, borderRadius, getBadgeColors } from '../../theme';
import { useAdminTabBarScrollInsets } from '../../hooks/useAdminTabBarHeight';
import { extractApiErrorMessage } from '../../utils/apiError';
import type {
  Tenant,
  Plan,
  TenantCabinet,
  SubscriptionStatus,
  User,
  PermissionKey,
  TenantPoint,
} from '../../../../shared/types';
import { UserRole, PERMISSION_KEYS, ROLE_PERMISSION_DEFAULTS } from '../../../../shared/types';
import type { UpdateUserRequest } from '../../../../shared/api/types';
import { formatPhone, normalizePhone, isValidPhone } from '../../../../shared/validation/phone';
import {
  formatMoney,
  formatFullDate,
  formatDateTime,
  genPassword,
  invalidatePlatformQueries,
  subscriptionStatusInfo,
  periodKindChip,
  useAdminMode,
  StatusChip,
  InitialAvatar,
} from './adminShared';
import ExtendSubscriptionSheet from './ExtendSubscriptionSheet';
import PlanPickerSheet from './PlanPickerSheet';
import TransferManagerSheet from './TransferManagerSheet';
import EmployeeAvatar from '../../components/EmployeeAvatar';
import ResetOwnerPasswordSheet from './ResetOwnerPasswordSheet';

/** Selectable per-tenant roles (superadmin can't be assigned from this screen). */
const SELECTABLE_ROLES: { role: UserRole; label: string }[] = [
  { role: UserRole.DIRECTOR, label: 'Директор' },
  { role: UserRole.ADMIN, label: 'Админ' },
  { role: UserRole.MASTER, label: 'Мастер' },
];

const ROLE_LABELS: Record<string, string> = {
  superadmin: 'Суперадмин',
  manager: 'Менеджер',
  director: 'Директор',
  admin: 'Админ',
  master: 'Мастер',
};

/** Materialize a full PermissionKey→bool map from a role's sparse defaults. */
function permissionsForRole(role: UserRole): Record<PermissionKey, boolean> {
  const defaults = ROLE_PERMISSION_DEFAULTS[role] ?? {};
  const map = {} as Record<PermissionKey, boolean>;
  for (const key of PERMISSION_KEYS) map[key] = defaults[key] === true;
  return map;
}

/** Editable employee form state. Strings for controlled inputs; coerced on save. */
interface UserDraft {
  id?: string;
  fullName: string;
  phone: string;
  password: string;
  role: UserRole;
  salaryPercent: string;
  isActive: boolean;
}

function toUserDraft(u?: User): UserDraft {
  return {
    id: u?.id,
    fullName: u?.fullName ?? '',
    phone: u?.phone ? formatPhone(u.phone) : '',
    password: '',
    role: u?.role ?? UserRole.MASTER,
    salaryPercent: u ? String(u.salaryPercent ?? 0) : '0',
    isActive: u ? u.isActive : true,
  };
}

/** Editable branch-point form state (156, tenant_points). */
interface PointDraft {
  id?: string;
  name: string;
  address: string;
  isActive: boolean;
  /**
   * ОСНОВНОЙ сервис тенанта (160, tenant_points.is_main) — сам автосервис
   * владельца, а не открытый позже филиал. Нужен форме, чтобы не предлагать
   * «Архивировать» и «Удалить»: сервер их запрещает (400 «Основной сервис
   * нельзя удалить или заархивировать…»), и кнопка вела бы в тупик. Новая
   * точка основной не бывает — основной уже существует.
   */
  isMain: boolean;
}

function toPointDraft(p?: TenantPoint): PointDraft {
  return {
    id: p?.id,
    name: p?.name ?? '',
    address: p?.address ?? '',
    isActive: p ? p.isActive : true,
    isMain: p?.isMain ?? false,
  };
}

export default function AdminTenantDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const id: string = route.params?.id;
  const palette = useColors();
  const surface = useIosSurface();
  const queryClient = useQueryClient();
  const { contentInset, contentContainerPaddingBottom } = useAdminTabBarScrollInsets();
  const { beginImpersonation } = useAuth();
  const isManager = useAdminMode() === 'manager';

  const [extendOpen, setExtendOpen] = React.useState(false);
  const [planPickerOpen, setPlanPickerOpen] = React.useState(false);
  const [transferOpen, setTransferOpen] = React.useState(false);
  const [resetPasswordOpen, setResetPasswordOpen] = React.useState(false);
  const [suspendOpen, setSuspendOpen] = React.useState(false);
  const [suspendReason, setSuspendReason] = React.useState('');
  const [busy, setBusy] = React.useState<null | 'plan' | 'suspend' | 'impersonate'>(null);
  const [editingUser, setEditingUser] = React.useState<UserDraft | null>(null);
  const [savingUser, setSavingUser] = React.useState(false);
  const [pwVisible, setPwVisible] = React.useState(false);
  const [editingPoint, setEditingPoint] = React.useState<PointDraft | null>(null);
  const [savingPoint, setSavingPoint] = React.useState(false);

  const {
    data: tenant,
    isLoading: tenantLoading,
    isError: tenantError,
    refetch: refetchTenant,
  } = useQuery<Tenant>({
    queryKey: isManager ? ['manager', 'tenant', id] : ['admin-tenant', id],
    queryFn: async () => (isManager ? await managerApi.tenant(id) : await tenantsApi.getById(id)).data,
  });

  // Active employees of THIS tenant (embedded in getById). Defensive filter:
  // hide dismissed/purged even if a stale snapshot still carries them.
  const tenantUsers = React.useMemo(
    () => (tenant?.users ?? []).filter((u) => !u.dismissedAt && !u.purgedAt),
    [tenant?.users],
  );

  // Сброс пароля меняет пароль САМОГО СТАРОГО активного директора — его и показываем в
  // тексте «Поделиться». Если сервер сотрудников менеджеру не отдал, подсказки просто нет.
  const ownerUser = React.useMemo(
    () =>
      tenantUsers
        .filter((u) => u.role === UserRole.DIRECTOR && u.isActive)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0] ?? null,
    [tenantUsers],
  );

  // Composed cabinet (102): identity + AUTHORITATIVE subscription status/plan +
  // the activity metrics in one payload. Replaces the old standalone metrics
  // query — `cabinet.metrics` feeds the grid, `cabinet.subscription` drives the
  // status chip + suspend/resume action so the card mirrors what the gate
  // enforces on the tenant's own devices.
  const { data: cabinet } = useQuery<TenantCabinet>({
    queryKey: isManager ? ['manager', 'cabinet', id] : ['admin-tenant-cabinet', id],
    queryFn: async () => (isManager ? await managerApi.cabinet(id) : await tenantsApi.getCabinet(id)).data,
  });
  const metrics = cabinet?.metrics;
  const sub = cabinet?.subscription;

  const { data: plans = [] } = useQuery<Plan[]>({
    queryKey: ['admin-plans'],
    queryFn: async () => (await plansApi.getAll()).data,
  });

  // ── Мульти-точки (156) — живые + архивные точки тенанта. Заводит/архивирует
  // ТОЛЬКО суперадмин; их количество и есть лимит точек тенанта. ──
  const { data: points = [] } = useQuery<TenantPoint[]>({
    queryKey: ['admin-tenant-points', id],
    queryFn: async () => (await tenantsApi.points.list(id)).data,
    enabled: !isManager,
  });

  const invalidate = React.useCallback(() => invalidatePlatformQueries(queryClient, id), [queryClient, id]);

  const invalidatePoints = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['admin-tenant-points', id] });
  }, [queryClient, id]);

  const assignPlanMutation = useMutation({
    mutationFn: async (planId: string) => {
      setBusy('plan');
      if (isManager) await managerApi.assignPlan(id, { planId });
      else await tenantsApi.assignPlan(id, planId);
    },
    onSuccess: () => {
      haptic('success');
      invalidate();
    },
    onError: (error) => {
      haptic('error');
      Alert.alert('Ошибка', extractApiErrorMessage(error, 'Не удалось сменить тариф'));
    },
    onSettled: () => setBusy(null),
  });

  const suspendMutation = useMutation({
    mutationFn: async (reason: string) => {
      setBusy('suspend');
      // status → 'suspended', is_active forced false server-side. Empty reason
      // is sent as undefined so the backend stores NULL rather than ''.
      const trimmed = reason.trim();
      if (isManager) await managerApi.suspend(id, trimmed ? { reason: trimmed } : undefined);
      else await tenantsApi.suspend(id, trimmed || undefined);
    },
    onSuccess: () => {
      haptic('success');
      setSuspendOpen(false);
      setSuspendReason('');
      invalidate();
    },
    onError: (error) => {
      haptic('error');
      Alert.alert(
        'Ошибка',
        extractApiErrorMessage(
          error,
          isManager ? 'Не удалось приостановить автосервис' : 'Не удалось приостановить тенанта',
        ),
      );
    },
    onSettled: () => setBusy(null),
  });

  const unsuspendMutation = useMutation({
    mutationFn: async () => {
      setBusy('suspend');
      // Lifts the suspension (re-activate); the subscription WINDOW is untouched,
      // so an already-expired tenant returns to 'expired', not 'active'.
      if (isManager) await managerApi.unsuspend(id);
      else await tenantsApi.unsuspend(id);
    },
    onSuccess: () => {
      haptic('success');
      invalidate();
    },
    onError: (error) => {
      haptic('error');
      Alert.alert('Ошибка', extractApiErrorMessage(error, 'Не удалось возобновить работу'));
    },
    onSettled: () => setBusy(null),
  });

  // ── Per-tenant employee management (parity with web AdminTenantDetailPage) ──
  const saveUserMutation = useMutation({
    mutationFn: async (draft: UserDraft) => {
      setSavingUser(true);
      const salaryPercent = Number(draft.salaryPercent) || 0;
      if (draft.id) {
        const payload: UpdateUserRequest = {
          fullName: draft.fullName.trim(),
          phone: normalizePhone(draft.phone),
          role: draft.role,
          salaryPercent,
          isActive: draft.isActive,
          ...(draft.password ? { password: draft.password } : {}),
        };
        await usersApi.update(draft.id, payload);
      } else {
        // `tenantId` lets the superadmin create the user UNDER the target tenant
        // (the backend honours it for superadmin). Extra fields beyond
        // CreateUserRequest are accepted server-side; passing a variable keeps
        // TS structural typing happy.
        const payload = {
          fullName: draft.fullName.trim(),
          phone: normalizePhone(draft.phone),
          password: draft.password,
          role: draft.role,
          salaryPercent,
          isActive: draft.isActive,
          tenantId: id,
          permissions: permissionsForRole(draft.role),
        };
        await usersApi.create(payload);
      }
    },
    onSuccess: (_res: unknown, draft: UserDraft) => {
      haptic('success');
      setEditingUser(null);
      queryClient.invalidateQueries({ queryKey: ['admin-tenant', id] });
      queryClient.invalidateQueries({ queryKey: ['admin-tenant-cabinet', id] });
      // Пароли хранятся только bcrypt-хэшем и позже не восстановимы — единственный
      // момент увидеть/передать действующий пароль это сразу после установки.
      if (draft.password) {
        const phone = draft.phone.trim() ? formatPhone(draft.phone) : '';
        const creds = `${draft.fullName.trim()}${phone ? `\nТелефон: ${phone}` : ''}\nПароль: ${draft.password}`;
        Alert.alert('Пароль установлен', creds, [
          {
            text: 'Поделиться',
            onPress: () => {
              // expo-clipboard в проекте нет — «Скопировать» доступно в системном share-листе.
              Share.share({ message: `Autexa — вход\n${creds}` }).catch(() => {});
            },
          },
          { text: 'Готово', style: 'cancel' },
        ]);
      }
    },
    onError: (error: unknown) => {
      haptic('error');
      const msg = (error as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
      const reason = Array.isArray(msg) ? msg.filter((m): m is string => typeof m === 'string').join('\n') : msg;
      Alert.alert(
        'Ошибка',
        typeof reason === 'string' && reason.trim()
          ? reason
          : editingUser?.id
            ? 'Не удалось сохранить сотрудника'
            : 'Не удалось создать сотрудника',
      );
    },
    onSettled: () => setSavingUser(false),
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (userId: string) => {
      await usersApi.remove(userId);
    },
    onSuccess: () => {
      haptic('success');
      setEditingUser(null);
      queryClient.invalidateQueries({ queryKey: ['admin-tenant', id] });
      queryClient.invalidateQueries({ queryKey: ['admin-tenant-cabinet', id] });
    },
    onError: () => {
      haptic('error');
      Alert.alert('Ошибка', 'Не удалось уволить сотрудника');
    },
  });

  // ── Мульти-точки (156) — CRUD точки из карточки тенанта ──
  const savePointMutation = useMutation({
    mutationFn: async (draft: PointDraft) => {
      setSavingPoint(true);
      const payload = { name: draft.name.trim(), address: draft.address.trim() || undefined };
      if (draft.id) {
        await tenantsApi.points.update(id, draft.id, payload);
      } else {
        await tenantsApi.points.create(id, payload);
      }
    },
    onSuccess: () => {
      haptic('success');
      setEditingPoint(null);
      invalidatePoints();
    },
    onError: (error: unknown) => {
      haptic('error');
      const msg = (error as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
      const reason = Array.isArray(msg) ? msg.filter((m): m is string => typeof m === 'string').join('\n') : msg;
      Alert.alert(
        'Ошибка',
        typeof reason === 'string' && reason.trim()
          ? reason
          : editingPoint?.id
            ? 'Не удалось сохранить автосервис'
            : 'Не удалось создать филиал',
      );
    },
    onSettled: () => setSavingPoint(false),
  });

  const toggleArchivePointMutation = useMutation({
    mutationFn: async (point: { id: string; isActive: boolean }) =>
      tenantsApi.points.update(id, point.id, { isActive: !point.isActive }),
    onSuccess: (_res, point) => {
      haptic('success');
      setEditingPoint((prev) => (prev && prev.id === point.id ? { ...prev, isActive: !point.isActive } : prev));
      invalidatePoints();
    },
    onError: () => {
      haptic('error');
      Alert.alert('Ошибка', 'Не удалось изменить статус филиала');
    },
  });

  const removePointMutation = useMutation({
    mutationFn: async (pointId: string) => tenantsApi.points.remove(id, pointId),
    onSuccess: () => {
      haptic('success');
      setEditingPoint(null);
      invalidatePoints();
    },
    onError: () => {
      haptic('error');
      Alert.alert('Ошибка', 'Не удалось удалить филиал');
    },
  });

  const handleSavePoint = React.useCallback(() => {
    if (!editingPoint) return;
    if (!editingPoint.name.trim()) {
      haptic('error');
      Alert.alert('Укажите название', 'Название автосервиса обязательно.');
      return;
    }
    savePointMutation.mutate(editingPoint);
  }, [editingPoint, savePointMutation]);

  const handleDeletePoint = React.useCallback(() => {
    if (!editingPoint?.id) return;
    const name = editingPoint.name.trim() || 'Филиал';
    haptic('warning');
    Alert.alert('Удалить филиал?', `«${name}» станет архивным. Историю заказ-нарядов это не затронет.`, [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: () => editingPoint.id && removePointMutation.mutate(editingPoint.id),
      },
    ]);
  }, [editingPoint, removePointMutation]);

  const handleSaveUser = React.useCallback(() => {
    if (!editingUser) return;
    if (!editingUser.fullName.trim()) {
      haptic('error');
      Alert.alert('Укажите имя', 'Имя сотрудника обязательно.');
      return;
    }
    if (!editingUser.phone.trim() || !isValidPhone(editingUser.phone)) {
      haptic('error');
      Alert.alert('Неверный телефон', 'Введите корректный номер телефона.');
      return;
    }
    if (!editingUser.id && editingUser.password.length < 8) {
      haptic('error');
      Alert.alert('Нужен пароль', 'При создании сотрудника укажите пароль (минимум 8 символов).');
      return;
    }
    if (editingUser.id && editingUser.password && editingUser.password.length < 8) {
      haptic('error');
      Alert.alert('Слабый пароль', 'Пароль должен быть не менее 8 символов.');
      return;
    }
    saveUserMutation.mutate(editingUser);
  }, [editingUser, saveUserMutation]);

  const handleDeleteUser = React.useCallback(() => {
    if (!editingUser?.id) return;
    const name = editingUser.fullName.trim() || 'Сотрудник';
    haptic('warning');
    Alert.alert(
      'Уволить сотрудника?',
      `«${name}» переедет в «Уволенные». Историю заказ-нарядов и смен это не затронет.`,
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Уволить',
          style: 'destructive',
          onPress: () => editingUser.id && deleteUserMutation.mutate(editingUser.id),
        },
      ],
    );
  }, [editingUser, deleteUserMutation]);

  // Форма продления (сумма, тип, срок, доля владельца) — в общей шторке, одна на оба режима.
  const openExtend = React.useCallback(() => {
    haptic('tap');
    setExtendOpen(true);
  }, []);

  const handleChangePlan = React.useCallback(() => {
    if (!tenant) return;
    if (!plans.some((p) => p.isActive && p.id !== tenant.planId)) {
      Alert.alert('Нет доступных тарифов', 'Все активные тарифы уже назначены.');
      return;
    }
    haptic('tap');
    setPlanPickerOpen(true);
  }, [plans, tenant]);

  const openSuspend = React.useCallback(() => {
    haptic('tap');
    setSuspendReason('');
    setSuspendOpen(true);
  }, []);

  const handleUnsuspend = React.useCallback(() => {
    if (!tenant) return;
    haptic('tap');
    Alert.alert(
      'Возобновить работу?',
      `Доступ для сотрудников «${tenant.name}» будет восстановлен. Если срок подписки уже истёк — продлите её отдельно.`,
      [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Возобновить', onPress: () => unsuspendMutation.mutate() },
      ],
    );
  }, [tenant, unsuspendMutation]);

  const handleImpersonate = React.useCallback(() => {
    if (!tenant) return;
    haptic('warning');
    Alert.alert(
      'Войти как владелец?',
      `Вы войдёте в аккаунт «${tenant.name}» как директор на 30 минут. Это действие фиксируется в журнале. ` +
        `Чтобы вернуться в ${isManager ? 'кабинет менеджера' : 'админ-панель'}, нужно будет выйти и заново войти под своим логином.`,
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Войти',
          style: 'destructive',
          onPress: async () => {
            try {
              setBusy('impersonate');
              const res = await (isManager ? managerApi.impersonate(tenant.id) : tenantsApi.impersonate(tenant.id));
              // Swaps the stored token + user; role flips to 'director' → the
              // root navigator re-renders into the tenant's car-service tree.
              await beginImpersonation(res.data.token, res.data.user);
            } catch (error) {
              haptic('error');
              Alert.alert('Ошибка', extractApiErrorMessage(error, 'Не удалось войти как владелец'));
              setBusy(null);
            }
          },
        },
      ],
    );
  }, [tenant, isManager, beginImpersonation]);

  if (!tenant) {
    return (
      <View style={[styles.root, { backgroundColor: palette.bg.canvas }]}>
        <IosScreenHeader title={isManager ? 'Автосервис' : 'Тенант'} onBack={() => navigation.goBack()} />
        {tenantError && !tenantLoading ? (
          <View style={styles.stateBlock}>
            <Ionicons name="cloud-offline-outline" size={40} color={palette.text.tertiary} />
            <Text style={[styles.stateText, { color: palette.text.secondary }]}>
              {isManager ? 'Не удалось загрузить автосервис' : 'Не удалось загрузить тенанта'}
            </Text>
            <Pressable
              onPress={() => {
                haptic('tap');
                refetchTenant();
              }}
              style={[styles.retryBtn, { backgroundColor: palette.accent.primarySoft }]}
            >
              <Text style={[styles.retryText, { color: palette.accent.primaryText }]}>Повторить</Text>
            </Pressable>
          </View>
        ) : (
          <ActivityIndicator color={palette.accent.primary} style={{ marginTop: spacing[10] }} />
        )}
      </View>
    );
  }

  const planName =
    sub?.planName || tenant.plan?.name || plans.find((p) => p.id === tenant.planId)?.name || 'Не назначен';
  // Authoritative status from the cabinet; while it loads, derive a sensible
  // placeholder from the embedded tenant so the chip never flickers «active».
  const status: SubscriptionStatus = sub?.status ?? (tenant.isActive ? 'active' : 'suspended');
  const suspended = status === 'suspended';
  const expired = status === 'expired';
  const monthlyPrice = sub?.planPrice ?? tenant.monthlyPrice;
  const subscriptionEnd = sub?.subscriptionEnd ?? tenant.subscriptionEnd;
  // 122 — «Оплачено до …» / «Бесплатно до …» from the authoritative period kind.
  const periodChip = periodKindChip(sub?.currentPeriodKind, subscriptionEnd, palette.mode);

  return (
    <View style={[styles.root, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title={tenant.name} onBack={() => navigation.goBack()} />

      <ScrollView
        contentInset={contentInset}
        contentContainerStyle={[styles.scroll, { paddingBottom: contentContainerPaddingBottom }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Subscription summary */}
        <View style={[styles.card, surface.card]}>
          <View style={styles.summaryHead}>
            <Text style={[styles.summaryTitle, { color: palette.text.primary }]}>Подписка</Text>
            <StatusChip status={subscriptionStatusInfo(status, palette.mode)} />
          </View>
          {periodChip ? (
            <View style={styles.periodChipRow}>
              <StatusChip status={periodChip} />
            </View>
          ) : null}
          <InfoRow label="Тариф" value={planName} palette={palette} />
          <InfoRow label="Стоимость" value={`${formatMoney(monthlyPrice)}/мес`} palette={palette} />
          <InfoRow
            label="Оплачено до"
            value={formatFullDate(subscriptionEnd)}
            valueColor={expired ? colors.red[600] : undefined}
            palette={palette}
          />
          {suspended ? (
            <InfoRow
              label="Приостановлена"
              value={sub?.suspendedAt ? formatFullDate(sub.suspendedAt) : '—'}
              valueColor={colors.amber[700]}
              palette={palette}
            />
          ) : null}
          {suspended && sub?.suspendedReason ? (
            <InfoRow label="Причина" value={sub.suspendedReason} palette={palette} />
          ) : null}
          <InfoRow label="Макс. польз." value={String(sub?.maxUsers ?? tenant.maxUsers)} palette={palette} />
          {tenant.phone ? <InfoRow label="Телефон" value={tenant.phone} palette={palette} /> : null}
          {tenant.email ? <InfoRow label="Email" value={tenant.email} palette={palette} /> : null}
          {!isManager ? (
            <ManagerRow
              name={tenant.managerName}
              palette={palette}
              onPress={() => {
                haptic('tap');
                setTransferOpen(true);
              }}
            />
          ) : null}
          <InfoRow label="Создан" value={formatFullDate(tenant.createdAt)} palette={palette} last />
        </View>

        {/* Client metrics */}
        <Text style={[styles.sectionLabel, { color: palette.text.tertiary }]}>Показатели клиента</Text>
        <View style={styles.metricsGrid}>
          <MetricBox
            value={metrics ? String(metrics.checksLast30d) : '—'}
            label="Заказ-наряды · 30д"
            surfaceCard={surface.card}
            palette={palette}
          />
          <MetricBox
            value={metrics ? String(metrics.checksTotal) : '—'}
            label="Заказ-наряды · всего"
            surfaceCard={surface.card}
            palette={palette}
          />
          <MetricBox
            value={metrics ? formatMoney(metrics.revenueLast30d) : '—'}
            label="Выручка · 30д"
            surfaceCard={surface.card}
            palette={palette}
          />
          <MetricBox
            value={metrics ? formatMoney(metrics.revenueTotal) : '—'}
            label="Выручка · всего"
            surfaceCard={surface.card}
            palette={palette}
          />
          <MetricBox
            value={metrics ? `${metrics.activeUsersCount}/${metrics.usersCount}` : '—'}
            label="Активные сотрудники"
            surfaceCard={surface.card}
            palette={palette}
          />
          <MetricBox
            value={metrics ? String(metrics.productsCount) : '—'}
            label="Товары на складе"
            surfaceCard={surface.card}
            palette={palette}
          />
        </View>
        <View style={[styles.card, surface.card]}>
          <InfoRow
            label="Последняя активность"
            value={metrics ? formatDateTime(metrics.lastActivityAt) : '—'}
            palette={palette}
            last
          />
        </View>

        {/* Actions */}
        <Text style={[styles.sectionLabel, { color: palette.text.tertiary }]}>Управление</Text>
        <View style={{ gap: spacing[2.5] }}>
          <ActionButton
            icon="time-outline"
            label="Продлить подписку"
            onPress={openExtend}
            palette={palette}
            surfaceCard={surface.card}
          />
          <ActionButton
            icon="swap-horizontal-outline"
            label="Сменить тариф"
            onPress={handleChangePlan}
            loading={busy === 'plan'}
            palette={palette}
            surfaceCard={surface.card}
          />
          <ActionButton
            icon={suspended ? 'play-circle-outline' : 'pause-circle-outline'}
            label={suspended ? 'Возобновить работу' : 'Приостановить'}
            onPress={suspended ? handleUnsuspend : openSuspend}
            loading={busy === 'suspend'}
            danger={!suspended}
            palette={palette}
            surfaceCard={surface.card}
          />
          {isManager ? (
            <ActionButton
              icon="lock-closed-outline"
              label="Сбросить пароль владельца"
              onPress={() => {
                haptic('tap');
                setResetPasswordOpen(true);
              }}
              palette={palette}
              surfaceCard={surface.card}
            />
          ) : null}
          {/* Impersonation — primary destructive accent. */}
          <Pressable
            onPress={handleImpersonate}
            disabled={busy === 'impersonate'}
            style={[styles.impersonateBtn, { backgroundColor: palette.accent.primary }]}
          >
            {busy === 'impersonate' ? (
              <ActivityIndicator size="small" color={colors.white} />
            ) : (
              <>
                <Ionicons name="enter-outline" size={18} color={colors.white} />
                <Text style={styles.impersonateText}>Войти как владелец</Text>
              </>
            )}
          </Pressable>
        </View>

        {/* Филиалы и сотрудники — только у суперадмина: менеджеру сервер их не отдаёт. */}
        {!isManager ? (
          <>
            {/* Points (156/160, tenant_points) — superadmin CRUD автосервисов
            тенанта. Первым идёт ОСНОВНОЙ сервис (сам автосервис владельца, с
            его историей), дальше открытые позже филиалы; порядок задаёт сервер.
            «Удалить» здесь = архив (isActive=false); история заказ-нарядов
            автосервис сохраняет. */}
            <View style={styles.employeesHead}>
              <Text style={[styles.sectionLabel, { color: palette.text.tertiary, marginTop: 0 }]}>
                Автосервисы ({points.length})
              </Text>
              <Pressable
                onPress={() => {
                  haptic('tap');
                  setEditingPoint(toPointDraft());
                }}
                style={[styles.employeesAdd, { backgroundColor: palette.accent.primary }]}
                hitSlop={6}
              >
                <Ionicons name="add" size={18} color={colors.white} />
              </Pressable>
            </View>

            {points.length === 0 ? (
              <View style={[styles.card, surface.card, styles.emptyUsers]}>
                <Ionicons name="location-outline" size={28} color={palette.text.tertiary} />
                <Text style={[styles.emptyUsersText, { color: palette.text.secondary }]}>
                  У этого тенанта один автосервис — филиалы не заведены
                </Text>
              </View>
            ) : (
              <View style={{ gap: spacing[2.5] }}>
                {points.map((p) => (
                  <Pressable
                    key={p.id}
                    onPress={() => {
                      haptic('tap');
                      setEditingPoint(toPointDraft(p));
                    }}
                    style={[styles.userRow, surface.card]}
                  >
                    <InitialAvatar name={p.name} palette={palette} size={38} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.userName, { color: palette.text.primary }]} numberOfLines={1}>
                        {p.name}
                      </Text>
                      {p.address ? (
                        <Text style={[styles.userMeta, { color: palette.text.tertiary }]} numberOfLines={1}>
                          {p.address}
                        </Text>
                      ) : null}
                    </View>
                    {/* Основной сервис подписан явно: его нельзя ни удалить, ни
                    заархивировать, и суперадмин должен видеть это ДО того, как
                    откроет карточку. */}
                    {p.isMain && (
                      <View style={[styles.userBadge, { backgroundColor: palette.accent.primarySoft }]}>
                        <Text style={[styles.userBadgeText, { color: palette.accent.primary }]}>Основной</Text>
                      </View>
                    )}
                    {!p.isActive && (
                      <View style={[styles.userBadge, { backgroundColor: getBadgeColors(palette.mode).gray.bg }]}>
                        <Text style={[styles.userBadgeText, { color: getBadgeColors(palette.mode).gray.text }]}>
                          Архив
                        </Text>
                      </View>
                    )}
                    <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} />
                  </Pressable>
                ))}
              </View>
            )}

            {/* Employees */}
            <View style={styles.employeesHead}>
              <Text style={[styles.sectionLabel, { color: palette.text.tertiary, marginTop: 0 }]}>
                Сотрудники ({tenantUsers.length})
              </Text>
              <Pressable
                onPress={() => {
                  haptic('tap');
                  setPwVisible(false);
                  setEditingUser(toUserDraft());
                }}
                style={[styles.employeesAdd, { backgroundColor: palette.accent.primary }]}
                hitSlop={6}
              >
                <Ionicons name="add" size={18} color={colors.white} />
              </Pressable>
            </View>

            {tenantUsers.length === 0 ? (
              <View style={[styles.card, surface.card, styles.emptyUsers]}>
                <Ionicons name="people-outline" size={28} color={palette.text.tertiary} />
                <Text style={[styles.emptyUsersText, { color: palette.text.secondary }]}>
                  У этого автосервиса пока нет сотрудников
                </Text>
              </View>
            ) : (
              <View style={{ gap: spacing[2.5] }}>
                {tenantUsers.map((u) => (
                  <Pressable
                    key={u.id}
                    onPress={() => {
                      haptic('tap');
                      setPwVisible(false);
                      setEditingUser(toUserDraft(u));
                    }}
                    style={[styles.userRow, surface.card]}
                  >
                    <EmployeeAvatar
                      userId={u.id}
                      avatar={u.avatar}
                      style={{ width: 38, height: 38, borderRadius: 19, overflow: 'hidden' }}
                      imageStyle={{ width: 38, height: 38, borderRadius: 19 }}
                    >
                      <InitialAvatar name={u.fullName} palette={palette} size={38} />
                    </EmployeeAvatar>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.userName, { color: palette.text.primary }]} numberOfLines={1}>
                        {u.fullName}
                      </Text>
                      <Text style={[styles.userMeta, { color: palette.text.tertiary }]} numberOfLines={1}>
                        {ROLE_LABELS[u.role] ?? u.role}
                        {u.phone ? ` · ${formatPhone(u.phone)}` : ''}
                      </Text>
                    </View>
                    {!u.isActive && (
                      <View style={[styles.userBadge, { backgroundColor: getBadgeColors(palette.mode).gray.bg }]}>
                        <Text style={[styles.userBadgeText, { color: getBadgeColors(palette.mode).gray.text }]}>
                          Выкл
                        </Text>
                      </View>
                    )}
                    <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} />
                  </Pressable>
                ))}
              </View>
            )}
          </>
        ) : null}
        <Pressable
          accessibilityRole="button"
          onPress={() => navigation.navigate('AdminTenantAudit', { id: tenant.id, name: tenant.name })}
          style={[styles.card, surface.card, { flexDirection: 'row', alignItems: 'center', gap: spacing[3] }]}
        >
          <Ionicons name="document-text-outline" size={22} color={palette.accent.primary} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: palette.text.primary, fontSize: 16, fontWeight: '600' }}>Журнал действий</Text>
            <Text style={{ color: palette.text.tertiary, marginTop: spacing[1] }}>История этого автосервиса</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={palette.text.tertiary} />
        </Pressable>
      </ScrollView>

      {/* Продление — общая шторка суперадмина и менеджера (сумма, срок, доля владельца). */}
      <ExtendSubscriptionSheet
        visible={extendOpen}
        onClose={() => setExtendOpen(false)}
        tenant={{
          id: tenant.id,
          name: tenant.name,
          subscriptionEnd,
          monthlyPrice,
          managerId: tenant.managerId ?? null,
          managerName: tenant.managerName ?? null,
        }}
        planPrice={monthlyPrice}
        currentKind={sub?.currentPeriodKind ?? tenant.currentPeriodKind ?? null}
      />

      <PlanPickerSheet
        visible={planPickerOpen}
        tenantName={tenant.name}
        currentPlanId={tenant.planId}
        plans={plans}
        saving={assignPlanMutation.isPending}
        onClose={() => setPlanPickerOpen(false)}
        onPick={(planId) => assignPlanMutation.mutate(planId, { onSuccess: () => setPlanPickerOpen(false) })}
      />

      {!isManager ? (
        <TransferManagerSheet
          visible={transferOpen}
          onClose={() => setTransferOpen(false)}
          tenant={{
            id: tenant.id,
            name: tenant.name,
            managerId: tenant.managerId ?? null,
            managerName: tenant.managerName ?? null,
          }}
        />
      ) : (
        <ResetOwnerPasswordSheet
          visible={resetPasswordOpen}
          onClose={() => setResetPasswordOpen(false)}
          tenant={{
            id: tenant.id,
            name: tenant.name,
            owner: ownerUser ? { fullName: ownerUser.fullName, phone: ownerUser.phone } : null,
          }}
        />
      )}

      <AdminSheet
        visible={suspendOpen}
        title="Приостановить автосервис?"
        saveLabel="Приостановить"
        destructive
        saving={busy === 'suspend'}
        onClose={() => setSuspendOpen(false)}
        onSave={() => suspendMutation.mutate(suspendReason)}
      >
        <Text style={[styles.modalHint, { color: palette.text.secondary }]}>
          Доступ ко всем разделам для сотрудников «{tenant.name}» будет закрыт до возобновления.{' '}
          {isManager ? 'Причина видна только вам и владельцу платформы.' : 'Причина видна только в админ-панели.'}
        </Text>
        <TextInput
          style={[
            styles.modalInput,
            styles.modalInputMultiline,
            { color: palette.text.primary, borderColor: palette.border.subtle },
          ]}
          placeholder="Причина (необязательно)"
          placeholderTextColor={palette.text.tertiary}
          value={suspendReason}
          onChangeText={setSuspendReason}
          multiline
          maxLength={200}
        />
      </AdminSheet>

      {/* Employee forms share the safe-area / keyboard-aware sheet. */}
      <AdminSheet
        visible={!!editingUser}
        title={editingUser?.id ? 'Сотрудник' : 'Новый сотрудник'}
        onClose={() => setEditingUser(null)}
        onSave={handleSaveUser}
        saving={savingUser}
      >
        {editingUser && (
          <>
            <Text style={[styles.fieldLabel, { color: palette.text.tertiary }]}>Имя</Text>
            <View style={[styles.inputWrap, surface.cardCompact]}>
              <TextInput
                style={[styles.sheetInput, { color: palette.text.primary }]}
                placeholder="ФИО сотрудника"
                placeholderTextColor={palette.text.tertiary}
                value={editingUser.fullName}
                onChangeText={(v) => setEditingUser({ ...editingUser, fullName: v })}
              />
            </View>

            <Text style={[styles.fieldLabel, { color: palette.text.tertiary }]}>Телефон</Text>
            <View style={[styles.inputWrap, surface.cardCompact]}>
              <TextInput
                style={[styles.sheetInput, { color: palette.text.primary }]}
                placeholder="+7 (___) ___-__-__"
                placeholderTextColor={palette.text.tertiary}
                keyboardType="phone-pad"
                value={editingUser.phone}
                onChangeText={(v) => setEditingUser({ ...editingUser, phone: formatPhone(v) })}
              />
            </View>

            <Text style={[styles.fieldLabel, { color: palette.text.tertiary }]}>
              {editingUser.id ? 'Новый пароль (необязательно)' : 'Пароль'}
            </Text>
            <View style={[styles.inputWrap, styles.pwRow, surface.cardCompact]}>
              <TextInput
                style={[styles.sheetInput, styles.pwInput, { color: palette.text.primary }]}
                placeholder="Минимум 8 символов"
                placeholderTextColor={palette.text.tertiary}
                secureTextEntry={!pwVisible}
                autoCapitalize="none"
                autoCorrect={false}
                value={editingUser.password}
                onChangeText={(v) => setEditingUser({ ...editingUser, password: v })}
              />
              <Pressable onPress={() => setPwVisible((v) => !v)} hitSlop={8}>
                <Ionicons
                  name={pwVisible ? 'eye-off-outline' : 'eye-outline'}
                  size={20}
                  color={palette.text.tertiary}
                />
              </Pressable>
            </View>
            <Pressable
              onPress={() => {
                haptic('select');
                setPwVisible(true);
                setEditingUser({ ...editingUser, password: genPassword() });
              }}
              style={styles.genPwBtn}
              hitSlop={4}
            >
              <Ionicons name="sparkles-outline" size={14} color={palette.accent.primary} />
              <Text style={[styles.genPwText, { color: palette.accent.primary }]}>Сгенерировать пароль</Text>
            </Pressable>

            <Text style={[styles.fieldLabel, { color: palette.text.tertiary }]}>Роль</Text>
            <View style={styles.roleRow}>
              {SELECTABLE_ROLES.map(({ role, label }) => {
                const on = editingUser.role === role;
                return (
                  <Pressable
                    key={role}
                    onPress={() => {
                      haptic('select');
                      setEditingUser({ ...editingUser, role });
                    }}
                    style={[
                      styles.roleChip,
                      {
                        backgroundColor: on ? palette.accent.primary : palette.bg.card,
                        borderColor: on ? palette.accent.primary : palette.border.subtle,
                      },
                    ]}
                  >
                    <Text style={[styles.roleChipText, { color: on ? colors.white : palette.text.secondary }]}>
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={[styles.fieldLabel, { color: palette.text.tertiary }]}>Процент зарплаты</Text>
            <View style={[styles.inputWrap, surface.cardCompact]}>
              <TextInput
                style={[styles.sheetInput, { color: palette.text.primary }]}
                placeholder="0"
                placeholderTextColor={palette.text.tertiary}
                keyboardType="number-pad"
                value={editingUser.salaryPercent}
                onChangeText={(v) => setEditingUser({ ...editingUser, salaryPercent: v.replace(/[^0-9]/g, '') })}
              />
            </View>

            <View style={[styles.switchBox, surface.cardCompact]}>
              <Text style={[styles.switchLabel, { color: palette.text.primary }]}>
                {editingUser.isActive ? 'Активен' : 'Отключён'}
              </Text>
              <Switch
                value={editingUser.isActive}
                onValueChange={(v) => {
                  haptic('select');
                  setEditingUser({ ...editingUser, isActive: v });
                }}
                trackColor={{ true: palette.accent.primary }}
              />
            </View>

            {editingUser.id && (
              <Pressable
                onPress={handleDeleteUser}
                disabled={deleteUserMutation.isPending}
                style={[styles.deleteUserBtn, { borderColor: colors.red[200] }]}
              >
                {deleteUserMutation.isPending ? (
                  <ActivityIndicator size="small" color={colors.red[600]} />
                ) : (
                  <>
                    <Ionicons name="person-remove-outline" size={18} color={colors.red[600]} />
                    <Text style={[styles.deleteUserText, { color: colors.red[600] }]}>Уволить сотрудника</Text>
                  </>
                )}
              </Pressable>
            )}
          </>
        )}
      </AdminSheet>

      {/* Branch editor; archive/delete are available only for existing branches. */}
      <AdminSheet
        visible={!!editingPoint}
        title={editingPoint?.isMain ? 'Основной сервис' : editingPoint?.id ? 'Филиал' : 'Новый филиал'}
        onClose={() => setEditingPoint(null)}
        onSave={handleSavePoint}
        saving={savingPoint}
      >
        {editingPoint && (
          <>
            <Text style={[styles.fieldLabel, { color: palette.text.tertiary }]}>Название</Text>
            <View style={[styles.inputWrap, surface.cardCompact]}>
              <TextInput
                style={[styles.sheetInput, { color: palette.text.primary }]}
                placeholder="Например, «на Ленина»"
                placeholderTextColor={palette.text.tertiary}
                value={editingPoint.name}
                onChangeText={(v) => setEditingPoint({ ...editingPoint, name: v })}
              />
            </View>

            <Text style={[styles.fieldLabel, { color: palette.text.tertiary }]}>Адрес</Text>
            <View style={[styles.inputWrap, surface.cardCompact]}>
              <TextInput
                style={[styles.sheetInput, { color: palette.text.primary }]}
                placeholder="г. Москва, ул. Ленина, д. 1"
                placeholderTextColor={palette.text.tertiary}
                value={editingPoint.address}
                onChangeText={(v) => setEditingPoint({ ...editingPoint, address: v })}
              />
            </View>

            {/* Основной сервис = сам автосервис владельца: сервер
                      отвечает 400 и на архив, и на удаление («Его можно
                      переименовать»). Кнопок здесь нет вовсе — иначе
                      суперадмин упирался бы в отказ вместо объяснения. */}
            {editingPoint.isMain ? (
              <Text style={[styles.mainPointNote, { color: palette.text.tertiary }]}>
                Это основной сервис — сам автосервис тенанта со всей его историей. Удалить или заархивировать его
                нельзя, можно только переименовать и поменять адрес.
              </Text>
            ) : null}

            {editingPoint.id && !editingPoint.isMain && (
              <>
                <Pressable
                  onPress={() =>
                    editingPoint.id &&
                    toggleArchivePointMutation.mutate({ id: editingPoint.id, isActive: editingPoint.isActive })
                  }
                  disabled={toggleArchivePointMutation.isPending}
                  style={[styles.archivePointBtn, { borderColor: palette.border.subtle }]}
                >
                  {toggleArchivePointMutation.isPending ? (
                    <ActivityIndicator size="small" color={palette.text.secondary} />
                  ) : (
                    <>
                      <Ionicons
                        name={editingPoint.isActive ? 'archive-outline' : 'arrow-undo-outline'}
                        size={18}
                        color={palette.text.secondary}
                      />
                      <Text style={[styles.archivePointText, { color: palette.text.secondary }]}>
                        {editingPoint.isActive ? 'Архивировать' : 'Разархивировать'}
                      </Text>
                    </>
                  )}
                </Pressable>

                <Pressable
                  onPress={handleDeletePoint}
                  disabled={removePointMutation.isPending}
                  style={[styles.deleteUserBtn, { borderColor: colors.red[200] }]}
                >
                  {removePointMutation.isPending ? (
                    <ActivityIndicator size="small" color={colors.red[600]} />
                  ) : (
                    <>
                      <Ionicons name="trash-outline" size={18} color={colors.red[600]} />
                      <Text style={[styles.deleteUserText, { color: colors.red[600] }]}>Удалить филиал</Text>
                    </>
                  )}
                </Pressable>
              </>
            )}
          </>
        )}
      </AdminSheet>
    </View>
  );
}

function InfoRow({
  label,
  value,
  valueColor,
  palette,
  last,
}: {
  label: string;
  value: string;
  valueColor?: string;
  palette: ReturnType<typeof useColors>;
  last?: boolean;
}) {
  return (
    <View
      style={[
        styles.infoRow,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.border.subtle },
      ]}
    >
      <Text style={[styles.infoLabel, { color: palette.text.secondary }]}>{label}</Text>
      <Text style={[styles.infoValue, { color: valueColor ?? palette.text.primary }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

/** «Менеджер · Передать» — строка карточки суперадмина; вся строка нажимается и открывает выбор менеджера. */
function ManagerRow({
  name,
  palette,
  onPress,
}: {
  name?: string | null;
  palette: ReturnType<typeof useColors>;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Передать автосервис другому менеджеру"
      style={[
        styles.infoRow,
        { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.border.subtle },
      ]}
    >
      <Text style={[styles.infoLabel, { color: palette.text.secondary }]}>Менеджер</Text>
      <Text
        style={[styles.managerValue, { color: name ? palette.text.primary : palette.text.tertiary }]}
        numberOfLines={1}
      >
        {name || 'Без менеджера'}
      </Text>
      <Text style={[styles.transferText, { color: palette.accent.primary }]}>Передать</Text>
    </Pressable>
  );
}

function MetricBox({
  value,
  label,
  surfaceCard,
  palette,
}: {
  value: string;
  label: string;
  surfaceCard: object;
  palette: ReturnType<typeof useColors>;
}) {
  return (
    <View style={[styles.metricBox, surfaceCard]}>
      <Text style={[styles.metricValue, { color: palette.text.primary }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={[styles.metricLabel, { color: palette.text.tertiary }]} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

function ActionButton({
  icon,
  label,
  onPress,
  loading,
  danger,
  palette,
  surfaceCard,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  loading?: boolean;
  danger?: boolean;
  palette: ReturnType<typeof useColors>;
  surfaceCard: object;
}) {
  const tint = danger ? colors.red[600] : palette.text.primary;
  return (
    <Pressable onPress={onPress} disabled={loading} style={[styles.actionBtn, surfaceCard]}>
      <Ionicons name={icon} size={20} color={tint} />
      <Text style={[styles.actionLabel, { color: tint }]}>{label}</Text>
      {loading ? (
        <ActivityIndicator size="small" color={palette.accent.primary} />
      ) : (
        <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { alignItems: 'center' },
  scroll: { paddingHorizontal: spacing[4], paddingTop: spacing[1], gap: spacing[3] },
  card: { paddingHorizontal: spacing[4], paddingVertical: spacing[1] },
  summaryHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'transparent',
  },
  summaryTitle: { fontSize: 16, fontWeight: '700' },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing[3],
    gap: spacing[3],
  },
  infoLabel: { fontSize: 14 },
  infoValue: { fontSize: 14, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  managerValue: { fontSize: 14, fontWeight: '600', flex: 1, textAlign: 'right' },
  transferText: { fontSize: 14, fontWeight: '700' },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: spacing[2],
    marginLeft: spacing[1],
  },
  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2.5] },
  metricBox: { width: '47.5%', padding: spacing[3.5], gap: spacing[1] },
  metricValue: { fontSize: 19, fontWeight: '800', letterSpacing: -0.5 },
  metricLabel: { fontSize: 11.5, fontWeight: '500' },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3.5],
  },
  actionLabel: { fontSize: 15, fontWeight: '600', flex: 1 },
  impersonateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[4],
    borderRadius: borderRadius['2xl'],
    marginTop: spacing[1],
  },
  impersonateText: { color: colors.white, fontSize: 16, fontWeight: '700' },
  periodChipRow: { flexDirection: 'row', paddingBottom: spacing[3] },
  // Suspension form
  modalHint: { fontSize: 13, lineHeight: 19 },
  modalInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    fontSize: 16,
  },
  modalInputMultiline: { minHeight: 72, textAlignVertical: 'top' },
  // Error / retry state
  stateBlock: { alignItems: 'center', justifyContent: 'center', paddingTop: spacing[16], gap: spacing[3] },
  stateText: { fontSize: 15, textAlign: 'center' },
  retryBtn: { paddingHorizontal: spacing[5], paddingVertical: spacing[2.5], borderRadius: borderRadius.full },
  retryText: { fontSize: 14, fontWeight: '700' },
  // Employees
  employeesHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing[2],
    marginLeft: spacing[1],
  },
  employeesAdd: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  emptyUsers: { alignItems: 'center', gap: spacing[2], paddingVertical: spacing[6] },
  emptyUsersText: { fontSize: 14, textAlign: 'center' },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[3],
  },
  userName: { fontSize: 15, fontWeight: '700' },
  userMeta: { fontSize: 12, marginTop: 2 },
  userBadge: { paddingHorizontal: spacing[2], paddingVertical: 3, borderRadius: borderRadius.full },
  userBadgeText: { fontSize: 10, fontWeight: '700' },
  // Employee form
  fieldLabel: { fontSize: 12, fontWeight: '600', marginLeft: spacing[1], marginTop: spacing[2] },
  inputWrap: { paddingHorizontal: spacing[3] },
  sheetInput: { fontSize: 16, paddingVertical: spacing[3] },
  pwRow: { flexDirection: 'row', alignItems: 'center' },
  pwInput: { flex: 1 },
  genPwBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing[1],
    marginTop: spacing[1.5],
    marginLeft: spacing[1],
  },
  genPwText: { fontSize: 13, fontWeight: '600' },
  roleRow: { flexDirection: 'row', gap: spacing[2] },
  roleChip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  roleChipText: { fontSize: 14, fontWeight: '600' },
  switchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    marginTop: spacing[3],
  },
  switchLabel: { fontSize: 15, fontWeight: '600' },
  deleteUserBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[3.5],
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: spacing[5],
  },
  deleteUserText: { fontSize: 15, fontWeight: '700' },
  // Points sheet — neutral archive/unarchive toggle (delete reuses deleteUserBtn).
  // Пояснение в карточке основного сервиса: почему нет кнопок архива/удаления.
  mainPointNote: { fontSize: 12, lineHeight: 17, marginTop: spacing[4] },
  archivePointBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[3.5],
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: spacing[5],
  },
  archivePointText: { fontSize: 15, fontWeight: '700' },
});
