/**
 * AdminTenantDetailScreen — full tenant management for the superadmin.
 *
 *   • Tenant identity + subscription summary.
 *   • «Показатели клиента» — activity metrics from getMetrics(id) (заказ-наряды
 *     30д/всего, выручка 30д/всего, последняя активность, сотрудники, товары).
 *   • Subscription actions:
 *       – Продлить (+30 / +90 / произвольно дней → extend)
 *       – Сменить тариф (plan picker → assignPlan, resyncs price + maxUsers)
 *       – Активен toggle (update)
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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRoute } from '@react-navigation/native';
import { tenantsApi, plansApi, usersApi } from '../../api/services';
import IosScreenHeader from '../../components/IosScreenHeader';
import { Text } from '../../platform/Typography';
import { haptic } from '../../platform/haptics';
import { useAuth } from '../../contexts/AuthContext';
import { useColors } from '../../contexts/ThemeContext';
import { useIosSurface } from '../../platform/iosSurface';
import { colors, spacing, borderRadius, getBadgeColors } from '../../theme';
import { useAdminTabBarScrollInsets } from '../../hooks/useAdminTabBarHeight';
import type { Tenant, Plan, TenantMetrics, User, PermissionKey } from '../../../../shared/types';
import { UserRole, PERMISSION_KEYS, ROLE_PERMISSION_DEFAULTS } from '../../../../shared/types';
import type { UpdateUserRequest } from '../../../../shared/api/types';
import { formatPhone, normalizePhone, isValidPhone } from '../../../../shared/validation/phone';
import {
  formatMoney,
  formatFullDate,
  formatDateTime,
  isExpired,
  tenantStatus,
  StatusChip,
  InitialAvatar,
} from './adminShared';

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

  const [customExtendOpen, setCustomExtendOpen] = React.useState(false);
  const [customDays, setCustomDays] = React.useState('');
  const [busy, setBusy] = React.useState<null | 'extend' | 'plan' | 'toggle' | 'impersonate'>(null);
  const [editingUser, setEditingUser] = React.useState<UserDraft | null>(null);
  const [savingUser, setSavingUser] = React.useState(false);

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

  const { data: metrics } = useQuery<TenantMetrics>({
    queryKey: ['admin-tenant-metrics', id],
    queryFn: async () => (await tenantsApi.getMetrics(id)).data,
  });

  const { data: plans = [] } = useQuery<Plan[]>({
    queryKey: ['admin-plans'],
    queryFn: async () => (await plansApi.getAll()).data,
  });

  const invalidate = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['admin-tenant', id] });
    queryClient.invalidateQueries({ queryKey: ['admin-tenants'] });
    queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
  }, [queryClient, id]);

  const extendMutation = useMutation({
    mutationFn: async (days: number) => {
      setBusy('extend');
      await tenantsApi.extend(id, days);
    },
    onSuccess: () => {
      haptic('success');
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

  const toggleMutation = useMutation({
    mutationFn: async (next: boolean) => {
      setBusy('toggle');
      await tenantsApi.update(id, { isActive: next });
    },
    onSuccess: () => {
      haptic('success');
      invalidate();
    },
    onError: () => {
      haptic('error');
      Alert.alert('Ошибка', 'Не удалось изменить статус');
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
    onSuccess: () => {
      haptic('success');
      setEditingUser(null);
      queryClient.invalidateQueries({ queryKey: ['admin-tenant', id] });
      queryClient.invalidateQueries({ queryKey: ['admin-tenant-metrics', id] });
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
      queryClient.invalidateQueries({ queryKey: ['admin-tenant-metrics', id] });
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

  const handleExtend = React.useCallback(() => {
    haptic('tap');
    Alert.alert('Продлить подписку', tenant ? `«${tenant.name}»` : undefined, [
      { text: '+30 дней', onPress: () => extendMutation.mutate(30) },
      { text: '+90 дней', onPress: () => extendMutation.mutate(90) },
      {
        text: 'Произвольно…',
        onPress: () => {
          setCustomDays('');
          setCustomExtendOpen(true);
        },
      },
      { text: 'Отмена', style: 'cancel' },
    ]);
  }, [extendMutation, tenant]);

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

  const handleToggle = React.useCallback(() => {
    if (!tenant) return;
    haptic('tap');
    Alert.alert(
      tenant.isActive ? 'Отключить тенанта?' : 'Активировать тенанта?',
      `«${tenant.name}» будет ${tenant.isActive ? 'отключён' : 'активирован'}.`,
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: tenant.isActive ? 'Отключить' : 'Активировать',
          style: tenant.isActive ? 'destructive' : 'default',
          onPress: () => toggleMutation.mutate(!tenant.isActive),
        },
      ],
    );
  }, [tenant, toggleMutation]);

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

  const planName = tenant.plan?.name || plans.find((p) => p.id === tenant.planId)?.name || 'Не назначен';
  const expired = isExpired(tenant.subscriptionEnd);

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
            <StatusChip status={tenantStatus(tenant)} />
          </View>
          <InfoRow label="Тариф" value={planName} palette={palette} />
          <InfoRow label="Стоимость" value={`${formatMoney(tenant.monthlyPrice)}/мес`} palette={palette} />
          <InfoRow
            label="Оплачено до"
            value={formatFullDate(tenant.subscriptionEnd)}
            valueColor={expired ? colors.red[600] : undefined}
            palette={palette}
          />
          <InfoRow label="Макс. польз." value={String(tenant.maxUsers)} palette={palette} />
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
            onPress={handleExtend}
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
            icon={tenant.isActive ? 'pause-circle-outline' : 'play-circle-outline'}
            label={tenant.isActive ? 'Отключить тенанта' : 'Активировать тенанта'}
            onPress={handleToggle}
            loading={busy === 'toggle'}
            danger={tenant.isActive}
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

      {/* Custom-days extend modal */}
      <Modal
        visible={customExtendOpen}
        transparent
        statusBarTranslucent
        animationType="fade"
        onRequestClose={() => setCustomExtendOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setCustomExtendOpen(false)}>
          <Pressable style={[styles.modalCard, { backgroundColor: palette.bg.card }]} onPress={() => {}}>
            <Text style={[styles.modalTitle, { color: palette.text.primary }]}>На сколько дней продлить?</Text>
            <TextInput
              style={[styles.modalInput, { color: palette.text.primary, borderColor: palette.border.subtle }]}
              placeholder="например, 14"
              placeholderTextColor={palette.text.tertiary}
              keyboardType="number-pad"
              value={customDays}
              onChangeText={setCustomDays}
              autoFocus
            />
            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancel} onPress={() => setCustomExtendOpen(false)}>
                <Text style={[styles.modalCancelText, { color: palette.text.secondary }]}>Отмена</Text>
              </Pressable>
              <Pressable
                style={[styles.modalConfirm, { backgroundColor: palette.accent.primary }]}
                onPress={() => {
                  const n = parseInt(customDays, 10);
                  if (!Number.isFinite(n) || n <= 0) {
                    Alert.alert('Неверное число', 'Введите положительное число дней.');
                    return;
                  }
                  setCustomExtendOpen(false);
                  extendMutation.mutate(n);
                }}
              >
                <Text style={styles.modalConfirmText}>Продлить</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Create / edit employee sheet */}
      <Modal
        visible={!!editingUser}
        transparent
        statusBarTranslucent
        animationType="slide"
        onRequestClose={() => setEditingUser(null)}
      >
        <View style={styles.sheetBackdrop}>
          <View style={[styles.sheet, { backgroundColor: palette.bg.canvas }]}>
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
                <View style={[styles.inputWrap, surface.cardCompact]}>
                  <TextInput
                    style={[styles.sheetInput, { color: palette.text.primary }]}
                    placeholder="Минимум 6 символов"
                    placeholderTextColor={palette.text.tertiary}
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    value={editingUser.password}
                    onChangeText={(v) => setEditingUser({ ...editingUser, password: v })}
                  />
                </View>

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
          </View>
        </View>
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
  modalInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    fontSize: 16,
  },
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
