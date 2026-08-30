/**
 * AdminTenantDetailScreen — full tenant management for the superadmin.
 *
 *   • Tenant identity + subscription summary (AUTHORITATIVE status from the
 *     composed getCabinet(id): active / expired / suspended + plan + price).
 *   • «Показатели клиента» — activity metrics from cabinet.metrics (заказ-наряды
 *     30д/всего, выручка 30д/всего, последняя активность, сотрудники, товары).
 *   • Subscription actions:
 *       – Продлить (+30 / +90 / произвольно дней → extend)
 *       – Сменить тариф (plan picker → assignPlan, resyncs price + maxUsers)
 *       – Приостановить (suspend с причиной) / Возобновить (unsuspend) — hard
 *         gate on every tenant device, mirrored by the status chip here
 *       – Войти как владелец (impersonate → AuthContext.beginImpersonation)
 */
import React from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  ActivityIndicator,
  Modal,
  TextInput,
  Switch,
  Platform,
  Share,
} from 'react-native';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRoute } from '@react-navigation/native';
import { tenantsApi, plansApi, usersApi } from '../../api/services';
import IosScreenHeader from '../../components/IosScreenHeader';
import DateTimePickerModal from '../../components/DateTimePickerModal';
import { KeyboardAwareView } from '../../components/KeyboardAware';
import { Text } from '../../platform/Typography';
import { haptic } from '../../platform/haptics';
import { useAuth } from '../../contexts/AuthContext';
import { useColors } from '../../contexts/ThemeContext';
import { useIosSurface } from '../../platform/iosSurface';
import { colors, spacing, borderRadius, getBadgeColors } from '../../theme';
import { useAdminTabBarScrollInsets } from '../../hooks/useAdminTabBarHeight';
import type { Tenant, Plan, TenantCabinet, SubscriptionStatus, User, PermissionKey } from '../../../../shared/types';
import { UserRole, PERMISSION_KEYS, ROLE_PERMISSION_DEFAULTS } from '../../../../shared/types';
import type { UpdateUserRequest, ExtendSubscriptionRequest } from '../../../../shared/api/types';
import { formatPhone, normalizePhone, isValidPhone } from '../../../../shared/validation/phone';
import {
  formatMoney,
  formatFullDate,
  formatDateTime,
  subscriptionStatusInfo,
  periodKindChip,
  StatusChip,
  InitialAvatar,
} from './adminShared';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Extension presets — fill the «до» date under the chosen paid/free mode. */
const EXTEND_PRESETS: { label: string; days: number }[] = [
  { label: '+30 дней', days: 30 },
  { label: '+90 дней', days: 90 },
  { label: '+год', days: 365 },
];

/**
 * Backend anchors an extension on max(current end, now) — mirror that here so
 * the presets add days onto the ЖИВОЙ конец подписки, not «now», when the
 * tenant is still in-window.
 */
function anchorFrom(subscriptionEnd?: string | null): Date {
  const now = new Date();
  if (!subscriptionEnd) return now;
  const end = new Date(subscriptionEnd);
  return Number.isNaN(end.getTime()) || end < now ? now : end;
}

/** End of the given local day (23:59:59) — natural meaning of «оплачено до …». */
function endOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(23, 59, 59, 999);
  return c;
}

/** Selectable per-tenant roles (superadmin can't be assigned from this screen). */
const SELECTABLE_ROLES: { role: UserRole; label: string }[] = [
  { role: UserRole.DIRECTOR, label: 'Директор' },
  { role: UserRole.ADMIN, label: 'Админ' },
  { role: UserRole.MASTER, label: 'Мастер' },
];

const ROLE_LABELS: Record<string, string> = {
  superadmin: 'Суперадмин',
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

// Генератор пароля для сотрудника: без неоднозначных символов (0/O, 1/l/I),
// чтобы пароль можно было продиктовать по телефону.
const PW_ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
function genPassword(len = 10): string {
  let out = '';
  for (let i = 0; i < len; i++) out += PW_ALPHABET[Math.floor(Math.random() * PW_ALPHABET.length)];
  return out;
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

export default function AdminTenantDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const id: string = route.params?.id;
  const palette = useColors();
  const surface = useIosSurface();
  const queryClient = useQueryClient();
  const { contentInset, contentContainerPaddingBottom } = useAdminTabBarScrollInsets();
  const { beginImpersonation } = useAuth();

  const [extendOpen, setExtendOpen] = React.useState(false);
  const [extendType, setExtendType] = React.useState<'paid' | 'free'>('paid');
  const [extendAmount, setExtendAmount] = React.useState('');
  const [extendUntil, setExtendUntil] = React.useState<Date | null>(null);
  const [extendDatePickerOpen, setExtendDatePickerOpen] = React.useState(false);
  const [suspendOpen, setSuspendOpen] = React.useState(false);
  const [suspendReason, setSuspendReason] = React.useState('');
  const [busy, setBusy] = React.useState<null | 'extend' | 'plan' | 'suspend' | 'impersonate'>(null);
  const [editingUser, setEditingUser] = React.useState<UserDraft | null>(null);
  const [savingUser, setSavingUser] = React.useState(false);
  const [pwVisible, setPwVisible] = React.useState(false);

  const {
    data: tenant,
    isLoading: tenantLoading,
    isError: tenantError,
    refetch: refetchTenant,
  } = useQuery<Tenant>({
    queryKey: ['admin-tenant', id],
    queryFn: async () => (await tenantsApi.getById(id)).data,
  });

  // Active employees of THIS tenant (embedded in getById). Defensive filter:
  // hide dismissed/purged even if a stale snapshot still carries them.
  const tenantUsers = React.useMemo(
    () => (tenant?.users ?? []).filter((u) => !u.dismissedAt && !u.purgedAt),
    [tenant?.users],
  );

  // Composed cabinet (102): identity + AUTHORITATIVE subscription status/plan +
  // the activity metrics in one payload. Replaces the old standalone metrics
  // query — `cabinet.metrics` feeds the grid, `cabinet.subscription` drives the
  // status chip + suspend/resume action so the card mirrors what the gate
  // enforces on the tenant's own devices.
  const { data: cabinet } = useQuery<TenantCabinet>({
    queryKey: ['admin-tenant-cabinet', id],
    queryFn: async () => (await tenantsApi.getCabinet(id)).data,
  });
  const metrics = cabinet?.metrics;
  const sub = cabinet?.subscription;

  const { data: plans = [] } = useQuery<Plan[]>({
    queryKey: ['admin-plans'],
    queryFn: async () => (await plansApi.getAll()).data,
  });

  const invalidate = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['admin-tenant', id] });
    queryClient.invalidateQueries({ queryKey: ['admin-tenant-cabinet', id] });
    queryClient.invalidateQueries({ queryKey: ['admin-tenants'] });
    queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
  }, [queryClient, id]);

  const extendMutation = useMutation({
    mutationFn: async (opts: ExtendSubscriptionRequest) => {
      setBusy('extend');
      await tenantsApi.extend(id, opts);
    },
    onSuccess: () => {
      haptic('success');
      setExtendOpen(false);
      invalidate();
    },
    onError: () => {
      haptic('error');
      Alert.alert('Ошибка', 'Не удалось продлить подписку');
    },
    onSettled: () => setBusy(null),
  });

  const assignPlanMutation = useMutation({
    mutationFn: async (planId: string) => {
      setBusy('plan');
      await tenantsApi.assignPlan(id, planId);
    },
    onSuccess: () => {
      haptic('success');
      invalidate();
    },
    onError: () => {
      haptic('error');
      Alert.alert('Ошибка', 'Не удалось сменить тариф');
    },
    onSettled: () => setBusy(null),
  });

  const suspendMutation = useMutation({
    mutationFn: async (reason: string) => {
      setBusy('suspend');
      // status → 'suspended', is_active forced false server-side. Empty reason
      // is sent as undefined so the backend stores NULL rather than ''.
      await tenantsApi.suspend(id, reason.trim() || undefined);
    },
    onSuccess: () => {
      haptic('success');
      setSuspendOpen(false);
      setSuspendReason('');
      invalidate();
    },
    onError: () => {
      haptic('error');
      Alert.alert('Ошибка', 'Не удалось приостановить тенанта');
    },
    onSettled: () => setBusy(null),
  });

  const unsuspendMutation = useMutation({
    mutationFn: async () => {
      setBusy('suspend');
      // Lifts the suspension (re-activate); the subscription WINDOW is untouched,
      // so an already-expired tenant returns to 'expired', not 'active'.
      await tenantsApi.unsuspend(id);
    },
    onSuccess: () => {
      haptic('success');
      invalidate();
    },
    onError: () => {
      haptic('error');
      Alert.alert('Ошибка', 'Не удалось возобновить работу');
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
    if (!editingUser.id && editingUser.password.length < 6) {
      haptic('error');
      Alert.alert('Нужен пароль', 'При создании сотрудника укажите пароль (минимум 6 символов).');
      return;
    }
    if (editingUser.id && editingUser.password && editingUser.password.length < 6) {
      haptic('error');
      Alert.alert('Слабый пароль', 'Пароль должен быть не короче 6 символов.');
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

  // Open the paid/free extend sheet — prefill the paid amount with the plan
  // price and default the mode to whatever the CURRENT period is (paid unless
  // the last period was explicitly free).
  const openExtend = React.useCallback(() => {
    haptic('tap');
    const price = sub?.planPrice ?? tenant?.monthlyPrice ?? 0;
    setExtendType(sub?.currentPeriodKind === 'free' ? 'free' : 'paid');
    setExtendAmount(price > 0 ? String(Math.round(price)) : '');
    setExtendUntil(null);
    setExtendOpen(true);
  }, [sub?.planPrice, sub?.currentPeriodKind, tenant?.monthlyPrice]);

  // Presets fill the «до» date onto the live subscription end (or now, если
  // истекла) — same anchor the backend uses for `days`.
  const applyExtendPreset = React.useCallback(
    (days: number) => {
      haptic('select');
      const anchor = anchorFrom(sub?.subscriptionEnd ?? tenant?.subscriptionEnd);
      setExtendUntil(endOfDay(new Date(anchor.getTime() + days * DAY_MS)));
    },
    [sub?.subscriptionEnd, tenant?.subscriptionEnd],
  );

  const submitExtend = React.useCallback(() => {
    if (!extendUntil) {
      haptic('error');
      Alert.alert('Укажите дату', 'Выберите дату, до которой продлить подписку.');
      return;
    }
    const until = endOfDay(extendUntil);
    if (until.getTime() <= Date.now()) {
      haptic('error');
      Alert.alert('Неверная дата', 'Дата окончания должна быть в будущем.');
      return;
    }
    if (extendType === 'paid') {
      const amount = Math.round(Number(extendAmount.replace(',', '.')));
      if (!Number.isFinite(amount) || amount <= 0) {
        haptic('error');
        Alert.alert('Укажите сумму', 'Для платного продления введите сумму больше нуля.');
        return;
      }
      extendMutation.mutate({ type: 'paid', amount, until: until.toISOString() });
    } else {
      extendMutation.mutate({ type: 'free', until: until.toISOString() });
    }
  }, [extendType, extendAmount, extendUntil, extendMutation]);

  const handleChangePlan = React.useCallback(() => {
    if (!tenant) return;
    const options = plans.filter((p) => p.isActive && p.id !== tenant.planId);
    if (options.length === 0) {
      Alert.alert('Нет доступных тарифов', 'Все активные тарифы уже назначены.');
      return;
    }
    haptic('tap');
    Alert.alert('Сменить тариф', `Выберите тариф для «${tenant.name}»`, [
      ...options.map((p) => ({
        text: `${p.name} · ${formatMoney(p.monthlyPrice)}/мес`,
        onPress: () => assignPlanMutation.mutate(p.id),
      })),
      { text: 'Отмена', style: 'cancel' as const },
    ]);
  }, [plans, tenant, assignPlanMutation]);

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
        'Чтобы вернуться в админ-панель, нужно будет выйти и заново войти под суперадмином.',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Войти',
          style: 'destructive',
          onPress: async () => {
            try {
              setBusy('impersonate');
              const res = await tenantsApi.impersonate(tenant.id);
              // Swaps the stored token + user; role flips to 'director' → the
              // root navigator re-renders into the tenant's car-service tree.
              await beginImpersonation(res.data.token, res.data.user);
            } catch {
              haptic('error');
              Alert.alert('Ошибка', 'Не удалось войти как владелец');
              setBusy(null);
            }
          },
        },
      ],
    );
  }, [tenant, beginImpersonation]);

  if (!tenant) {
    return (
      <View style={[styles.root, { backgroundColor: palette.bg.canvas }]}>
        <IosScreenHeader title="Тенант" onBack={() => navigation.goBack()} />
        {tenantError && !tenantLoading ? (
          <View style={styles.stateBlock}>
            <Ionicons name="cloud-offline-outline" size={40} color={palette.text.tertiary} />
            <Text style={[styles.stateText, { color: palette.text.secondary }]}>Не удалось загрузить тенанта</Text>
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
            loading={busy === 'extend'}
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
                <InitialAvatar name={u.fullName} palette={palette} size={38} />
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
                    <Text style={[styles.userBadgeText, { color: getBadgeColors(palette.mode).gray.text }]}>Выкл</Text>
                  </View>
                )}
                <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} />
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Paid / free extend sheet */}
      <Modal
        visible={extendOpen}
        transparent
        statusBarTranslucent
        animationType="slide"
        onRequestClose={() => setExtendOpen(false)}
      >
        <View style={styles.sheetBackdrop}>
          <View style={[styles.sheet, { backgroundColor: palette.bg.canvas }]}>
            <View style={[styles.sheetHandleRow, { borderBottomColor: palette.border.subtle }]}>
              <Pressable onPress={() => setExtendOpen(false)} hitSlop={8}>
                <Text style={[styles.sheetCancel, { color: palette.text.secondary }]}>Отмена</Text>
              </Pressable>
              <Text style={[styles.sheetTitle, { color: palette.text.primary }]}>Продлить подписку</Text>
              <Pressable onPress={submitExtend} disabled={busy === 'extend'} hitSlop={8}>
                {busy === 'extend' ? (
                  <ActivityIndicator size="small" color={palette.accent.primary} />
                ) : (
                  <Text style={[styles.sheetSave, { color: palette.accent.primary }]}>Продлить</Text>
                )}
              </Pressable>
            </View>

            <ScrollView
              contentContainerStyle={styles.sheetScroll}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {/* Current period recap */}
              <View style={[styles.extendRecap, surface.cardCompact]}>
                <Text style={[styles.extendRecapLabel, { color: palette.text.tertiary }]}>Сейчас действует до</Text>
                <Text
                  style={[styles.extendRecapValue, { color: expired ? colors.red[600] : palette.text.primary }]}
                  numberOfLines={1}
                >
                  {formatFullDate(subscriptionEnd)}
                </Text>
              </View>

              {/* Paid / free segmented control */}
              <Text style={[styles.fieldLabel, { color: palette.text.tertiary }]}>Тип продления</Text>
              <View style={styles.segmented}>
                {(['paid', 'free'] as const).map((t) => {
                  const on = extendType === t;
                  return (
                    <Pressable
                      key={t}
                      onPress={() => {
                        haptic('select');
                        setExtendType(t);
                      }}
                      style={[
                        styles.segment,
                        {
                          backgroundColor: on ? palette.accent.primary : palette.bg.card,
                          borderColor: on ? palette.accent.primary : palette.border.subtle,
                        },
                      ]}
                    >
                      <Ionicons
                        name={t === 'paid' ? 'card-outline' : 'gift-outline'}
                        size={16}
                        color={on ? colors.white : palette.text.secondary}
                      />
                      <Text style={[styles.segmentText, { color: on ? colors.white : palette.text.secondary }]}>
                        {t === 'paid' ? 'Платно' : 'Бесплатно'}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* Amount — paid only */}
              {extendType === 'paid' ? (
                <>
                  <Text style={[styles.fieldLabel, { color: palette.text.tertiary }]}>Сумма, ₽</Text>
                  <View style={[styles.inputWrap, surface.cardCompact]}>
                    <TextInput
                      style={[styles.sheetInput, styles.amountInput, { color: palette.text.primary }]}
                      placeholder="0"
                      placeholderTextColor={palette.text.tertiary}
                      keyboardType="number-pad"
                      value={extendAmount}
                      onChangeText={(v) => setExtendAmount(v.replace(/[^0-9]/g, ''))}
                    />
                  </View>
                </>
              ) : null}

              {/* Until date */}
              <Text style={[styles.fieldLabel, { color: palette.text.tertiary }]}>Продлить до</Text>
              <View style={styles.presetRow}>
                {EXTEND_PRESETS.map((p) => (
                  <Pressable
                    key={p.label}
                    onPress={() => applyExtendPreset(p.days)}
                    style={[
                      styles.presetChip,
                      { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
                    ]}
                  >
                    <Text style={[styles.presetChipText, { color: palette.text.secondary }]}>{p.label}</Text>
                  </Pressable>
                ))}
              </View>
              <Pressable
                onPress={() => {
                  haptic('tap');
                  setExtendDatePickerOpen(true);
                }}
                style={[styles.dateRow, surface.cardCompact]}
              >
                <Ionicons name="calendar-outline" size={18} color={palette.text.secondary} />
                <Text style={[styles.dateValue, { color: extendUntil ? palette.text.primary : palette.text.tertiary }]}>
                  {extendUntil ? formatFullDate(extendUntil.toISOString()) : 'Выбрать дату'}
                </Text>
                <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} />
              </Pressable>

              {/* Revenue hint — free is explicitly not revenue */}
              <View style={styles.extendHintRow}>
                <Ionicons
                  name={extendType === 'paid' ? 'trending-up-outline' : 'information-circle-outline'}
                  size={15}
                  color={extendType === 'paid' ? colors.green[600] : palette.text.tertiary}
                />
                <Text style={[styles.extendHintText, { color: palette.text.secondary }]}>
                  {extendType === 'paid'
                    ? 'Сумма попадёт в платную выручку от подписок.'
                    : 'Бесплатное продление не учитывается как выручка.'}
                </Text>
              </View>

              <View style={{ height: spacing[8] }} />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Date picker for the extend sheet (sibling Modal — the proven pattern). */}
      <DateTimePickerModal
        visible={extendDatePickerOpen}
        value={extendUntil ?? anchorFrom(subscriptionEnd)}
        mode="date"
        onConfirm={(d) => {
          setExtendUntil(d);
          setExtendDatePickerOpen(false);
        }}
        onCancel={() => setExtendDatePickerOpen(false)}
      />

      {/* Suspend-with-reason modal (cross-platform — Alert.prompt is iOS-only). */}
      <Modal
        visible={suspendOpen}
        transparent
        statusBarTranslucent
        animationType="fade"
        onRequestClose={() => setSuspendOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setSuspendOpen(false)}>
          <Pressable style={[styles.modalCard, { backgroundColor: palette.bg.card }]} onPress={() => {}}>
            <Text style={[styles.modalTitle, { color: palette.text.primary }]}>Приостановить тенанта?</Text>
            <Text style={[styles.modalHint, { color: palette.text.secondary }]}>
              Доступ ко всем разделам для сотрудников {tenant ? `«${tenant.name}»` : 'этого автосервиса'} будет закрыт
              до возобновления. Причина видна только в админ-панели.
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
            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancel} onPress={() => setSuspendOpen(false)}>
                <Text style={[styles.modalCancelText, { color: palette.text.secondary }]}>Отмена</Text>
              </Pressable>
              <Pressable
                style={[styles.modalConfirm, { backgroundColor: colors.red[600] }]}
                disabled={busy === 'suspend'}
                onPress={() => suspendMutation.mutate(suspendReason)}
              >
                {busy === 'suspend' ? (
                  <ActivityIndicator size="small" color={colors.white} />
                ) : (
                  <Text style={styles.modalConfirmText}>Приостановить</Text>
                )}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Create / edit employee sheet.
          Клавиатура (миграция на keyboard-controller): раньше эта шторка
          вообще НЕ обрабатывала клавиатуру — поля пароля/телефона могли
          прятаться под клавиатурой. RN-core <Modal> монтирует отдельное
          нативное окно → нужен вложенный KeyboardProvider (как в Modal.tsx /
          EditProfileModal.tsx). KeyboardAwareView вокруг sheet-контейнера
          поднимает шторку над клавиатурой на обеих платформах. */}
      <Modal
        visible={!!editingUser}
        transparent
        statusBarTranslucent
        animationType="slide"
        onRequestClose={() => setEditingUser(null)}
      >
        <KeyboardProvider>
          <View style={styles.sheetBackdrop}>
            <KeyboardAwareView style={[styles.sheet, { backgroundColor: palette.bg.canvas }]}>
              <View style={[styles.sheetHandleRow, { borderBottomColor: palette.border.subtle }]}>
                <Pressable onPress={() => setEditingUser(null)} hitSlop={8}>
                  <Text style={[styles.sheetCancel, { color: palette.text.secondary }]}>Отмена</Text>
                </Pressable>
                <Text style={[styles.sheetTitle, { color: palette.text.primary }]}>
                  {editingUser?.id ? 'Сотрудник' : 'Новый сотрудник'}
                </Text>
                <Pressable onPress={handleSaveUser} disabled={savingUser} hitSlop={8}>
                  {savingUser ? (
                    <ActivityIndicator size="small" color={palette.accent.primary} />
                  ) : (
                    <Text style={[styles.sheetSave, { color: palette.accent.primary }]}>Сохранить</Text>
                  )}
                </Pressable>
              </View>

              {editingUser && (
                <ScrollView
                  contentContainerStyle={styles.sheetScroll}
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                >
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
                      placeholder="Минимум 6 символов"
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

                  <View style={{ height: spacing[8] }} />
                </ScrollView>
              )}
            </KeyboardAwareView>
          </View>
        </KeyboardProvider>
      </Modal>
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
  // Extend sheet
  extendRecap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[3],
    marginBottom: spacing[1],
  },
  extendRecapLabel: { fontSize: 13, fontWeight: '500' },
  extendRecapValue: { fontSize: 14, fontWeight: '700', flexShrink: 1, textAlign: 'right' },
  segmented: { flexDirection: 'row', gap: spacing[2] },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1.5],
    paddingVertical: spacing[3],
    borderRadius: borderRadius.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  segmentText: { fontSize: 15, fontWeight: '700' },
  amountInput: { fontSize: 20, fontWeight: '700', fontVariant: ['tabular-nums'] },
  presetRow: { flexDirection: 'row', gap: spacing[2] },
  presetChip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  presetChipText: { fontSize: 13, fontWeight: '600' },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2.5],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3.5],
    marginTop: spacing[2],
  },
  dateValue: { flex: 1, fontSize: 16, fontWeight: '600' },
  extendHintRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2], marginTop: spacing[3] },
  extendHintText: { flex: 1, fontSize: 13, lineHeight: 18 },
  // Modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing[6],
  },
  modalCard: {
    width: '100%',
    borderRadius: borderRadius['2xl'],
    padding: spacing[5],
    gap: spacing[3],
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 24 },
      android: { elevation: 12 },
    }),
  },
  modalTitle: { fontSize: 17, fontWeight: '700' },
  modalHint: { fontSize: 13, lineHeight: 19 },
  modalInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    fontSize: 16,
  },
  modalInputMultiline: { minHeight: 72, textAlignVertical: 'top' },
  modalActions: { flexDirection: 'row', gap: spacing[3], marginTop: spacing[1] },
  modalCancel: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: spacing[3] },
  modalCancelText: { fontSize: 15, fontWeight: '600' },
  modalConfirm: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[3],
    borderRadius: borderRadius.xl,
  },
  modalConfirmText: { color: colors.white, fontSize: 15, fontWeight: '700' },
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
  // Employee sheet
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '92%',
    borderTopLeftRadius: borderRadius['3xl'],
    borderTopRightRadius: borderRadius['3xl'],
    paddingTop: spacing[2],
  },
  sheetHandleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetCancel: { fontSize: 15, fontWeight: '500' },
  sheetTitle: { fontSize: 16, fontWeight: '700' },
  sheetSave: { fontSize: 15, fontWeight: '700' },
  sheetScroll: { padding: spacing[4], gap: spacing[2] },
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
});
