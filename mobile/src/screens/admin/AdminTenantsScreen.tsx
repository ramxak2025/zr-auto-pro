/**
 * AdminTenantsScreen — searchable tenant directory for the superadmin, and «Автосервисы»
 * (only the manager's own clients) for a platform manager.
 *
 * Status chips (Все / Активные / Истекают / Истёкшие / Приостановлены) filter the list;
 * tapping a row pushes AdminTenantDetailScreen onto the tab's native-stack (Apple-Mail
 * pattern — the admin bar stays visible).
 *
 * Superadmin: a second chip row filters by manager, the row shows «Менеджер: …», and the
 * «+» header opens a create/edit sheet (same visual language as AdminPlansScreen) so the
 * superadmin can register a new car service without leaving the app:
 *   • Компания — название (обяз.), телефон, адрес, email, описание.
 *   • Подписка — тариф (plansApi), менеджер (необязательно), макс. польз., дата окончания,
 *     примечание; при редактировании — надбавка минут голоса (115, voiceMinutesExtra).
 *   • Директор — имя, телефон, пароль (опционально, только при создании).
 *   • Активен — тумблер (только при редактировании).
 *
 * Manager: «+» opens ManagerCreateTenantSheet (пробный доступ вместо даты окончания),
 * данные — `managerApi.tenants()`, удаления и правки реквизитов нет.
 */
import React from 'react';
import {
  View,
  StyleSheet,
  TextInput,
  Pressable,
  ScrollView,
  FlatList,
  Modal,
  Switch,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { tenantsApi, plansApi, managerApi, adminManagersApi } from '../../api/services';
import IosScreenHeader from '../../components/IosScreenHeader';
import { Text } from '../../platform/Typography';
import { haptic } from '../../platform/haptics';
import { useColors } from '../../contexts/ThemeContext';
import { useIosSurface } from '../../platform/iosSurface';
import { colors, spacing, borderRadius } from '../../theme';
import { useAdminTabBarScrollInsets } from '../../hooks/useAdminTabBarHeight';
import { toLocalISODate } from '../../utils/dates';
import { formatPhone, normalizePhone, isValidPhone } from '../../../../shared/validation/phone';
import type { Tenant, Plan, PlatformManager } from '../../../../shared/types';
import type { CreateTenantRequest, UpdateTenantRequest } from '../../../../shared/api/types';
import {
  formatMoney,
  isExpired,
  daysLeft,
  tenantRowStatus,
  periodKindChip,
  invalidatePlatformQueries,
  useAdminMode,
  StatusChip,
  InitialAvatar,
} from './adminShared';
import ManagerCreateTenantSheet from './ManagerCreateTenantSheet';

type FilterKey = 'all' | 'active' | 'expiring' | 'expired' | 'suspended';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'Все' },
  { key: 'active', label: 'Активные' },
  { key: 'expiring', label: 'Истекают' },
  { key: 'expired', label: 'Истёкшие' },
  { key: 'suspended', label: 'Приостановлены' },
];

/** Фильтр по менеджеру (только суперадмин): все / без менеджера / конкретный менеджер по id. */
const MANAGER_ALL = 'all';
const MANAGER_NONE = 'none';

/** «Истекают» — подписка закончится в ближайшие 7 дней (как плашка «7 дн.» в чипе статуса). */
const EXPIRING_DAYS = 7;

/** Приостановленный автосервис живёт только в «Приостановлены»: сервер шлёт его с `isActive = false`. */
function matchesFilter(t: Tenant, key: FilterKey): boolean {
  if (key === 'all') return true;
  if (key === 'suspended') return !!t.suspendedAt;
  if (t.suspendedAt) return false;
  if (key === 'expired') return isExpired(t.subscriptionEnd) || !t.isActive;
  const active = t.isActive && !isExpired(t.subscriptionEnd);
  if (key === 'active') return active;
  const left = daysLeft(t.subscriptionEnd);
  return active && left !== null && left <= EXPIRING_DAYS;
}

/** Editable form state. Everything is a string for controlled inputs; coerced on save. */
interface TenantDraft {
  id?: string;
  // Company
  name: string;
  phone: string;
  address: string;
  email: string;
  description: string;
  // Subscription
  planId: string | null;
  /** Менеджер-владелец клиента (create only); null — клиент владельца платформы. */
  managerId: string | null;
  maxUsers: string;
  subscriptionEnd: string; // YYYY-MM-DD
  subscriptionNote: string;
  // Director (create only)
  directorName: string;
  directorPhone: string;
  directorPassword: string;
  // Edit only
  isActive: boolean;
  /** 115 — индивидуальная надбавка минут голоса (edit only, нет в CreateTenantRequest). */
  voiceMinutesExtra: string;
}

/** ISO date (or null) → YYYY-MM-DD for the input. */
function toDateInput(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  // ЛОКАЛЬНЫЙ срез, не toISOString(): UTC-срез в RU-зонах (UTC+3…+12)
  // сдвигал дату окончания подписки на день назад (см. utils/dates.ts).
  return toLocalISODate(d);
}

function toDraft(tenant?: Tenant): TenantDraft {
  return {
    id: tenant?.id,
    name: tenant?.name ?? '',
    phone: tenant?.phone ? formatPhone(tenant.phone) : '',
    address: tenant?.address ?? '',
    email: tenant?.email ?? '',
    description: tenant?.description ?? '',
    planId: tenant?.planId ?? null,
    managerId: tenant?.managerId ?? null,
    maxUsers: tenant ? String(tenant.maxUsers) : '',
    subscriptionEnd: toDateInput(tenant?.subscriptionEnd),
    subscriptionNote: tenant?.subscriptionNote ?? '',
    directorName: '',
    directorPhone: '',
    directorPassword: '',
    isActive: tenant ? tenant.isActive : true,
    voiceMinutesExtra: tenant ? String(tenant.voiceMinutesExtra ?? 0) : '0',
  };
}

/** Parse a YYYY-MM-DD draft into an ISO string; returns undefined when empty/invalid. */
function parseDate(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!m) return undefined;
  const d = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

export default function AdminTenantsScreen() {
  const navigation = useNavigation<any>();
  const palette = useColors();
  const surface = useIosSurface();
  const queryClient = useQueryClient();
  const { contentInset, contentContainerPaddingBottom } = useAdminTabBarScrollInsets();
  const isManager = useAdminMode() === 'manager';
  const [search, setSearch] = React.useState('');
  const [filter, setFilter] = React.useState<FilterKey>('all');
  const [managerFilter, setManagerFilter] = React.useState<string>(MANAGER_ALL);
  const [editing, setEditing] = React.useState<TenantDraft | null>(null);
  const [picker, setPicker] = React.useState<'plan' | 'manager' | null>(null);
  const [managerCreateOpen, setManagerCreateOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const {
    data: tenants = [],
    isLoading,
    isError,
    refetch,
  } = useQuery<Tenant[]>({
    queryKey: isManager ? ['manager', 'tenants'] : ['admin-tenants'],
    queryFn: async () => (isManager ? (await managerApi.tenants()).data : (await tenantsApi.getAll()).data),
  });

  // Форма суперадмина: тарифы и менеджеры нужны только ей (у менеджера свой лист).
  const { data: plans = [] } = useQuery<Plan[]>({
    queryKey: ['admin-plans'],
    queryFn: async () => (await plansApi.getAll()).data,
    enabled: !isManager,
  });

  const { data: managers = [] } = useQuery<PlatformManager[]>({
    queryKey: ['admin-managers', 'list'],
    queryFn: async () => (await adminManagersApi.list()).data,
    enabled: !isManager,
  });

  const activePlans = React.useMemo(() => plans.filter((p) => p.isActive), [plans]);
  const activeManagers = React.useMemo(
    () => managers.filter((m) => m.isActive).sort((a, b) => a.fullName.localeCompare(b.fullName, 'ru')),
    [managers],
  );

  const filtered = React.useMemo(() => {
    let list = tenants;
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.phone?.toLowerCase().includes(q) ||
          t.email?.toLowerCase().includes(q) ||
          // У менеджера все клиенты его — имя в поиске только мешало бы.
          (!isManager && t.managerName?.toLowerCase().includes(q)),
      );
    }
    if (filter !== 'all') list = list.filter((t) => matchesFilter(t, filter));
    if (managerFilter === MANAGER_NONE) list = list.filter((t) => !t.managerId);
    else if (managerFilter !== MANAGER_ALL) list = list.filter((t) => t.managerId === managerFilter);
    return [...list].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [tenants, search, filter, managerFilter, isManager]);

  const managerChips = React.useMemo(
    () => [
      { key: MANAGER_ALL, label: 'Все менеджеры' },
      { key: MANAGER_NONE, label: 'Без менеджера' },
      ...managers.map((m) => ({ key: m.id, label: m.fullName })),
    ],
    [managers],
  );

  const invalidate = React.useCallback(() => invalidatePlatformQueries(queryClient), [queryClient]);

  const saveMutation = useMutation({
    mutationFn: async (draft: TenantDraft) => {
      setSaving(true);
      const selectedPlan = draft.planId ? activePlans.find((p) => p.id === draft.planId) : undefined;
      const maxUsers = parseInt(draft.maxUsers, 10);
      const subscriptionEnd = parseDate(draft.subscriptionEnd);

      // Индивидуальная надбавка минут голоса (115): NaN (пустой ввод) — поле
      // не шлём, значение на сервере не меняется.
      const voiceMinutesExtra = parseInt(draft.voiceMinutesExtra, 10);

      if (draft.id) {
        const payload: UpdateTenantRequest = {
          name: draft.name.trim(),
          phone: draft.phone.trim() ? normalizePhone(draft.phone) : '',
          address: draft.address.trim(),
          email: draft.email.trim(),
          // Пустая строка сознательно шлётся — так поле можно очистить
          // (тот же контракт, что у phone/address/email выше).
          description: draft.description.trim(),
          subscriptionNote: draft.subscriptionNote.trim(),
          isActive: draft.isActive,
          planId: draft.planId ?? undefined,
          ...(Number.isFinite(maxUsers) && maxUsers > 0 ? { maxUsers } : {}),
          ...(selectedPlan ? { monthlyPrice: selectedPlan.monthlyPrice } : {}),
          ...(subscriptionEnd ? { subscriptionEnd } : {}),
          ...(Number.isFinite(voiceMinutesExtra) && voiceMinutesExtra >= 0 ? { voiceMinutesExtra } : {}),
        };
        await tenantsApi.update(draft.id, payload);
      } else {
        const payload: CreateTenantRequest = {
          name: draft.name.trim(),
          ...(draft.phone.trim() ? { phone: normalizePhone(draft.phone) } : {}),
          ...(draft.address.trim() ? { address: draft.address.trim() } : {}),
          ...(draft.email.trim() ? { email: draft.email.trim() } : {}),
          ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
          ...(draft.subscriptionNote.trim() ? { subscriptionNote: draft.subscriptionNote.trim() } : {}),
          ...(draft.planId ? { planId: draft.planId } : {}),
          ...(draft.managerId ? { managerId: draft.managerId } : {}),
          ...(selectedPlan ? { monthlyPrice: selectedPlan.monthlyPrice } : {}),
          ...(Number.isFinite(maxUsers) && maxUsers > 0
            ? { maxUsers }
            : selectedPlan
              ? { maxUsers: selectedPlan.maxUsers }
              : {}),
          ...(subscriptionEnd ? { subscriptionEnd } : {}),
          ...(draft.directorName.trim() ? { directorName: draft.directorName.trim() } : {}),
          ...(draft.directorPhone.trim() ? { directorPhone: normalizePhone(draft.directorPhone) } : {}),
          ...(draft.directorPassword ? { directorPassword: draft.directorPassword } : {}),
        };
        await tenantsApi.create(payload);
      }
    },
    onSuccess: () => {
      haptic('success');
      setEditing(null);
      invalidate();
    },
    // Показываем ПРИЧИНУ с сервера, а не глухое «Не удалось сохранить».
    // Именно так осмысленный отказ («Пароль должен быть не менее 8 символов»,
    // «Действие недоступно без выбранного автосервиса») превращался для
    // владельца в бессодержательное «ошибка выходит». Зеркалит разбор ошибки
    // в AdminTenantDetailScreen: message может прийти массивом от
    // ValidationPipe — тогда склеиваем строки.
    onError: (error: unknown) => {
      haptic('error');
      const msg = (error as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
      const reason = Array.isArray(msg) ? msg.filter((m): m is string => typeof m === 'string').join('\n') : msg;
      Alert.alert(
        'Ошибка',
        typeof reason === 'string' && reason.trim()
          ? reason
          : editing?.id
            ? 'Не удалось сохранить изменения'
            : 'Не удалось создать автосервис',
      );
    },
    onSettled: () => setSaving(false),
  });

  const removeMutation = useMutation({
    mutationFn: async (tenantId: string) => {
      await tenantsApi.remove(tenantId);
    },
    onSuccess: () => {
      haptic('success');
      setEditing(null);
      invalidate();
    },
    onError: () => {
      haptic('error');
      Alert.alert('Ошибка', 'Не удалось удалить автосервис');
    },
  });

  const handleDelete = React.useCallback(() => {
    if (!editing?.id) return;
    const name = editing.name.trim() || 'этот автосервис';
    const tenantId = editing.id;
    haptic('warning');
    Alert.alert(
      'Удалить автосервис?',
      `«${name}» и все его данные — заказ-наряды, склад, сотрудники, отчёты — будут удалены без возможности восстановления.`,
      [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Удалить', style: 'destructive', onPress: () => removeMutation.mutate(tenantId) },
      ],
    );
  }, [editing, removeMutation]);

  const handleSave = React.useCallback(() => {
    if (!editing) return;
    if (!editing.name.trim()) {
      haptic('error');
      Alert.alert('Укажите название', 'Название автосервиса не может быть пустым.');
      return;
    }
    if (editing.phone.trim() && !isValidPhone(editing.phone)) {
      haptic('error');
      Alert.alert('Неверный телефон', 'Введите корректный номер телефона.');
      return;
    }
    if (editing.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(editing.email.trim())) {
      haptic('error');
      Alert.alert('Неверный email', 'Введите корректный адрес электронной почты.');
      return;
    }
    if (editing.subscriptionEnd.trim() && !parseDate(editing.subscriptionEnd)) {
      haptic('error');
      Alert.alert('Неверная дата', 'Введите дату окончания в формате ГГГГ-ММ-ДД.');
      return;
    }
    // Директор — all-or-nothing при создании: если тронули любое из полей, то
    // владелец создаётся и требует имя + корректный телефон + пароль ≥ 6.
    if (!editing.id) {
      const touchedDirector =
        editing.directorName.trim() || editing.directorPhone.trim() || editing.directorPassword.length > 0;
      if (touchedDirector) {
        if (!editing.directorName.trim()) {
          haptic('error');
          Alert.alert('Укажите имя директора', 'Для создания владельца заполните имя.');
          return;
        }
        if (!isValidPhone(editing.directorPhone)) {
          haptic('error');
          Alert.alert('Неверный телефон директора', 'Введите корректный номер телефона владельца.');
          return;
        }
        if (editing.directorPassword.length < 8) {
          haptic('error');
          Alert.alert('Нужен пароль директора', 'Пароль владельца — минимум 8 символов.');
          return;
        }
      }
    }
    saveMutation.mutate(editing);
  }, [editing, saveMutation]);

  const selectedPlanName = React.useMemo(() => {
    if (!editing?.planId) return null;
    return activePlans.find((p) => p.id === editing.planId)?.name ?? null;
  }, [editing?.planId, activePlans]);

  const selectedManagerName = React.useMemo(() => {
    if (!editing?.managerId) return null;
    return managers.find((m) => m.id === editing.managerId)?.fullName ?? null;
  }, [editing?.managerId, managers]);

  let emptyText = 'Ничего не найдено';
  if (isError && tenants.length === 0) emptyText = 'Не удалось загрузить список';
  else if (isManager && tenants.length === 0) emptyText = 'Пока нет автосервисов. Нажмите «+», чтобы завести первый.';

  return (
    <View style={[styles.root, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader
        title={isManager ? 'Автосервисы' : 'Тенанты'}
        subtitle={`${tenants.length} организаций`}
        trailing={
          <Pressable
            onPress={() => {
              haptic('tap');
              if (isManager) setManagerCreateOpen(true);
              else setEditing(toDraft());
            }}
            style={[styles.headerAdd, { backgroundColor: palette.accent.primary }]}
            hitSlop={6}
          >
            <Ionicons name="add" size={22} color={colors.white} />
          </Pressable>
        }
      />

      <View style={styles.controls}>
        {/* Search */}
        <View style={[styles.searchRow, surface.cardCompact]}>
          <Ionicons name="search-outline" size={18} color={palette.text.tertiary} />
          <TextInput
            style={[styles.searchInput, { color: palette.text.primary }]}
            placeholder="Поиск по названию, телефону…"
            placeholderTextColor={palette.text.tertiary}
            value={search}
            onChangeText={setSearch}
            autoCorrect={false}
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch('')} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color={palette.text.tertiary} />
            </Pressable>
          )}
        </View>

        {/* Status filter chips */}
        <FilterChips
          items={FILTERS}
          value={filter}
          onChange={setFilter}
          activeColor={palette.accent.primary}
          palette={palette}
        />

        {/* Manager filter chips — суперадмин, когда менеджеры уже заведены */}
        {!isManager && managers.length > 0 ? (
          <FilterChips
            items={managerChips}
            value={managerFilter}
            onChange={setManagerFilter}
            activeColor={palette.accent.primary}
            palette={palette}
          />
        ) : null}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(t) => t.id}
        contentInset={contentInset}
        contentContainerStyle={[styles.listContent, { paddingBottom: contentContainerPaddingBottom }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <View style={styles.emptyBlock}>
            {isLoading ? (
              <ActivityIndicator color={palette.accent.primary} />
            ) : (
              <>
                <Ionicons name="search-outline" size={40} color={palette.text.tertiary} />
                <Text style={[styles.emptyText, { color: palette.text.secondary }]}>{emptyText}</Text>
                {isError && tenants.length === 0 ? (
                  <Pressable onPress={() => void refetch()} hitSlop={8}>
                    <Text style={[styles.retryText, { color: palette.accent.primary }]}>Повторить</Text>
                  </Pressable>
                ) : null}
              </>
            )}
          </View>
        }
        renderItem={({ item }) => {
          const period = periodKindChip(item.currentPeriodKind, item.subscriptionEnd, palette.mode);
          return (
            <Pressable
              onPress={() => {
                haptic('tap');
                navigation.navigate('AdminTenantDetail', { id: item.id });
              }}
              style={[styles.row, surface.card]}
            >
              <InitialAvatar name={item.name} palette={palette} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.name, { color: palette.text.primary }]} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={[styles.meta, { color: palette.text.tertiary }]} numberOfLines={1}>
                  {item.plan?.name || 'Без тарифа'} · {formatMoney(item.monthlyPrice)}/мес ·{' '}
                  {item.userCount ?? item.users?.length ?? 0} польз.
                </Text>
                {!isManager && item.managerName ? (
                  <Text style={[styles.meta, { color: palette.text.secondary }]} numberOfLines={1}>
                    Менеджер: {item.managerName}
                  </Text>
                ) : null}
              </View>
              <View style={styles.rowChips}>
                <StatusChip status={tenantRowStatus(item, palette.mode)} />
                {period ? <StatusChip status={period} /> : null}
              </View>
              <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} />
            </Pressable>
          );
        }}
      />

      {/* Manager: new car service (name, owner, trial) */}
      {isManager ? (
        <ManagerCreateTenantSheet
          visible={managerCreateOpen}
          onClose={() => setManagerCreateOpen(false)}
          onOpenTenant={(tenant) => navigation.navigate('AdminTenantDetail', { id: tenant.id })}
        />
      ) : null}

      {/* Create / edit sheet */}
      <Modal
        visible={!!editing}
        transparent
        statusBarTranslucent
        animationType="slide"
        onRequestClose={() => setEditing(null)}
      >
        <View style={styles.sheetBackdrop}>
          <View style={[styles.sheet, { backgroundColor: palette.bg.canvas }]}>
            <View style={[styles.sheetHandleRow, { borderBottomColor: palette.border.subtle }]}>
              <Pressable onPress={() => setEditing(null)} hitSlop={8}>
                <Text style={[styles.sheetCancel, { color: palette.text.secondary }]}>Отмена</Text>
              </Pressable>
              <Text style={[styles.sheetTitle, { color: palette.text.primary }]}>
                {editing?.id ? 'Автосервис' : 'Новый автосервис'}
              </Text>
              <Pressable onPress={handleSave} disabled={saving} hitSlop={8}>
                {saving ? (
                  <ActivityIndicator size="small" color={palette.accent.primary} />
                ) : (
                  <Text style={[styles.sheetSave, { color: palette.accent.primary }]}>Сохранить</Text>
                )}
              </Pressable>
            </View>

            {editing && (
              <ScrollView
                contentContainerStyle={styles.sheetScroll}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                {/* ── Компания ── */}
                <Text style={[styles.sectionLabel, { color: palette.text.tertiary }]}>Компания</Text>
                <Field label="Название" palette={palette} surface={surface}>
                  <TextInput
                    style={[styles.input, { color: palette.text.primary }]}
                    placeholder="Например, Автосервис на Ленина"
                    placeholderTextColor={palette.text.tertiary}
                    value={editing.name}
                    onChangeText={(v) => setEditing({ ...editing, name: v })}
                    autoCorrect={false}
                  />
                </Field>
                <Field label="Телефон" palette={palette} surface={surface}>
                  <TextInput
                    style={[styles.input, { color: palette.text.primary }]}
                    placeholder="+7 (___) ___-__-__"
                    placeholderTextColor={palette.text.tertiary}
                    keyboardType="phone-pad"
                    value={editing.phone}
                    onChangeText={(v) => setEditing({ ...editing, phone: formatPhone(v) })}
                  />
                </Field>
                <Field label="Адрес" palette={palette} surface={surface}>
                  <TextInput
                    style={[styles.input, { color: palette.text.primary }]}
                    placeholder="Город, улица, дом"
                    placeholderTextColor={palette.text.tertiary}
                    value={editing.address}
                    onChangeText={(v) => setEditing({ ...editing, address: v })}
                  />
                </Field>
                <Field label="Email" palette={palette} surface={surface}>
                  <TextInput
                    style={[styles.input, { color: palette.text.primary }]}
                    placeholder="mail@example.com"
                    placeholderTextColor={palette.text.tertiary}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    value={editing.email}
                    onChangeText={(v) => setEditing({ ...editing, email: v })}
                  />
                </Field>
                <Field label="Описание" palette={palette} surface={surface}>
                  <TextInput
                    style={[styles.input, styles.inputMultiline, { color: palette.text.primary }]}
                    placeholder="Заметка об автосервисе"
                    placeholderTextColor={palette.text.tertiary}
                    multiline
                    value={editing.description}
                    onChangeText={(v) => setEditing({ ...editing, description: v })}
                  />
                </Field>

                {/* ── Подписка ── */}
                <Text style={[styles.sectionLabel, { color: palette.text.tertiary }]}>Подписка</Text>
                <View style={styles.field}>
                  <Text style={[styles.fieldLabel, { color: palette.text.tertiary }]}>Тариф</Text>
                  <Pressable
                    onPress={() => {
                      if (activePlans.length === 0) {
                        Alert.alert('Нет тарифов', 'Сначала создайте тариф в разделе «Тарифы».');
                        return;
                      }
                      haptic('tap');
                      setPicker('plan');
                    }}
                    style={[styles.pickerRow, surface.cardCompact]}
                  >
                    <Text
                      style={[
                        styles.pickerValue,
                        { color: selectedPlanName ? palette.text.primary : palette.text.tertiary },
                      ]}
                    >
                      {selectedPlanName ?? 'Не выбран'}
                    </Text>
                    <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} />
                  </Pressable>
                </View>
                {/* Менеджер клиента — только при создании и когда есть кого выбрать */}
                {!editing.id && activeManagers.length > 0 ? (
                  <View style={styles.field}>
                    <Text style={[styles.fieldLabel, { color: palette.text.tertiary }]}>Менеджер</Text>
                    <Pressable
                      onPress={() => {
                        haptic('tap');
                        setPicker('manager');
                      }}
                      style={[styles.pickerRow, surface.cardCompact]}
                    >
                      <Text
                        style={[
                          styles.pickerValue,
                          { color: selectedManagerName ? palette.text.primary : palette.text.tertiary },
                        ]}
                      >
                        {selectedManagerName ?? 'Без менеджера'}
                      </Text>
                      <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} />
                    </Pressable>
                  </View>
                ) : null}
                <View style={styles.fieldRow}>
                  <Field label="Макс. польз." palette={palette} surface={surface} flex>
                    <TextInput
                      style={[styles.input, { color: palette.text.primary }]}
                      placeholder="1"
                      placeholderTextColor={palette.text.tertiary}
                      keyboardType="number-pad"
                      value={editing.maxUsers}
                      onChangeText={(v) => setEditing({ ...editing, maxUsers: v.replace(/[^0-9]/g, '') })}
                    />
                  </Field>
                  <Field label="Оплачено до" palette={palette} surface={surface} flex>
                    <TextInput
                      style={[styles.input, { color: palette.text.primary }]}
                      placeholder="ГГГГ-ММ-ДД"
                      placeholderTextColor={palette.text.tertiary}
                      keyboardType="numbers-and-punctuation"
                      autoCorrect={false}
                      value={editing.subscriptionEnd}
                      onChangeText={(v) => setEditing({ ...editing, subscriptionEnd: v.replace(/[^0-9-]/g, '') })}
                    />
                  </Field>
                </View>
                <Field label="Примечание к подписке" palette={palette} surface={surface}>
                  <TextInput
                    style={[styles.input, { color: palette.text.primary }]}
                    placeholder="Например, договорённость об оплате"
                    placeholderTextColor={palette.text.tertiary}
                    value={editing.subscriptionNote}
                    onChangeText={(v) => setEditing({ ...editing, subscriptionNote: v })}
                  />
                </Field>
                {editing.id ? (
                  <>
                    <Field label="Доп. минуты голоса (надбавка)" palette={palette} surface={surface}>
                      <TextInput
                        style={[styles.input, { color: palette.text.primary }]}
                        placeholder="0"
                        placeholderTextColor={palette.text.tertiary}
                        keyboardType="number-pad"
                        value={editing.voiceMinutesExtra}
                        onChangeText={(v) => setEditing({ ...editing, voiceMinutesExtra: v.replace(/[^0-9]/g, '') })}
                      />
                    </Field>
                    <Text style={[styles.fieldHint, { color: palette.text.tertiary }]}>
                      Прибавляется к пакету минут голосового ввода из тарифа. 0 = без надбавки.
                    </Text>
                  </>
                ) : null}

                {/* ── Директор (только при создании) ── */}
                {!editing.id ? (
                  <>
                    <Text style={[styles.sectionLabel, { color: palette.text.tertiary }]}>Директор</Text>
                    <Text style={[styles.sectionHint, { color: palette.text.tertiary }]}>
                      Необязательно. Если указать, будет создан владелец автосервиса.
                    </Text>
                    <Field label="Имя" palette={palette} surface={surface}>
                      <TextInput
                        style={[styles.input, { color: palette.text.primary }]}
                        placeholder="Имя директора"
                        placeholderTextColor={palette.text.tertiary}
                        value={editing.directorName}
                        onChangeText={(v) => setEditing({ ...editing, directorName: v })}
                      />
                    </Field>
                    <Field label="Телефон" palette={palette} surface={surface}>
                      <TextInput
                        style={[styles.input, { color: palette.text.primary }]}
                        placeholder="+7 (___) ___-__-__"
                        placeholderTextColor={palette.text.tertiary}
                        keyboardType="phone-pad"
                        value={editing.directorPhone}
                        onChangeText={(v) => setEditing({ ...editing, directorPhone: formatPhone(v) })}
                      />
                    </Field>
                    <Field label="Пароль" palette={palette} surface={surface}>
                      <TextInput
                        style={[styles.input, { color: palette.text.primary }]}
                        placeholder="Минимум 8 символов"
                        placeholderTextColor={palette.text.tertiary}
                        secureTextEntry
                        autoCapitalize="none"
                        autoCorrect={false}
                        value={editing.directorPassword}
                        onChangeText={(v) => setEditing({ ...editing, directorPassword: v })}
                      />
                    </Field>
                  </>
                ) : (
                  <>
                    <Text style={[styles.sectionLabel, { color: palette.text.tertiary }]}>Статус</Text>
                    <View style={[styles.switchBox, surface.cardCompact]}>
                      <Text style={[styles.switchLabel, { color: palette.text.primary }]}>
                        {editing.isActive ? 'Активен' : 'Отключён'}
                      </Text>
                      <Switch
                        value={editing.isActive}
                        onValueChange={(v) => {
                          haptic('select');
                          setEditing({ ...editing, isActive: v });
                        }}
                        trackColor={{ true: palette.accent.primary }}
                      />
                    </View>
                  </>
                )}

                {/* Destructive: delete the whole tenant (existing only). */}
                {editing.id ? (
                  <Pressable
                    onPress={handleDelete}
                    disabled={removeMutation.isPending}
                    style={[styles.deleteTenantBtn, { borderColor: colors.red[200] }]}
                  >
                    {removeMutation.isPending ? (
                      <ActivityIndicator size="small" color={colors.red[600]} />
                    ) : (
                      <>
                        <Ionicons name="trash-outline" size={18} color={colors.red[600]} />
                        <Text style={[styles.deleteTenantText, { color: colors.red[600] }]}>Удалить автосервис</Text>
                      </>
                    )}
                  </Pressable>
                ) : null}

                <View style={{ height: spacing[8] }} />
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* Plan / manager pickers (nested over the sheet) */}
      <OptionPickerModal
        visible={picker === 'plan'}
        title="Выберите тариф"
        options={activePlans.map((p) => ({
          id: p.id,
          title: p.name,
          meta: `${formatMoney(p.monthlyPrice)}/мес · до ${p.maxUsers} польз.`,
        }))}
        selectedId={editing?.planId ?? null}
        clearLabel="Без тарифа"
        onSelect={(planId) => {
          const plan = activePlans.find((p) => p.id === planId);
          setEditing((prev) =>
            prev
              ? {
                  ...prev,
                  planId,
                  // Auto-suggest the plan's seat limit when none typed yet.
                  maxUsers: plan && !prev.maxUsers.trim() ? String(plan.maxUsers) : prev.maxUsers,
                }
              : prev,
          );
          setPicker(null);
        }}
        onClose={() => setPicker(null)}
        palette={palette}
      />
      <OptionPickerModal
        visible={picker === 'manager'}
        title="Выберите менеджера"
        options={activeManagers.map((m) => ({ id: m.id, title: m.fullName, meta: formatPhone(m.phone) }))}
        selectedId={editing?.managerId ?? null}
        clearLabel="Без менеджера"
        onSelect={(managerId) => {
          setEditing((prev) => (prev ? { ...prev, managerId } : prev));
          setPicker(null);
        }}
        onClose={() => setPicker(null)}
        palette={palette}
      />
    </View>
  );
}

interface PickerOption {
  id: string;
  title: string;
  meta?: string;
}

/** Центральный список выбора поверх листа (тариф / менеджер); «очистить» — `onSelect(null)`. */
function OptionPickerModal({
  visible,
  title,
  options,
  selectedId,
  clearLabel,
  onSelect,
  onClose,
  palette,
}: {
  visible: boolean;
  title: string;
  options: PickerOption[];
  selectedId: string | null;
  clearLabel: string;
  onSelect: (id: string | null) => void;
  onClose: () => void;
  palette: ReturnType<typeof useColors>;
}) {
  return (
    <Modal visible={visible} transparent statusBarTranslucent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.pickerBackdrop} onPress={onClose}>
        <Pressable style={[styles.pickerSheet, { backgroundColor: palette.bg.canvas }]} onPress={() => {}}>
          <Text style={[styles.pickerTitle, { color: palette.text.primary }]}>{title}</Text>
          <ScrollView showsVerticalScrollIndicator={false} style={styles.pickerList}>
            {options.map((o) => (
              <Pressable
                key={o.id}
                onPress={() => {
                  haptic('select');
                  onSelect(o.id);
                }}
                style={[styles.pickerOption, { borderBottomColor: palette.border.subtle }]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.pickerOptionName, { color: palette.text.primary }]}>{o.title}</Text>
                  {o.meta ? (
                    <Text style={[styles.pickerOptionMeta, { color: palette.text.tertiary }]}>{o.meta}</Text>
                  ) : null}
                </View>
                {selectedId === o.id ? <Ionicons name="checkmark" size={20} color={palette.accent.primary} /> : null}
              </Pressable>
            ))}
          </ScrollView>
          <Pressable
            onPress={() => {
              haptic('select');
              onSelect(null);
            }}
            style={styles.pickerClear}
          >
            <Text style={[styles.pickerClearText, { color: palette.text.secondary }]}>{clearLabel}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** Горизонтальная строка чипов-фильтров (один и тот же вид для статуса и менеджера). */
function FilterChips<T extends string>({
  items,
  value,
  onChange,
  activeColor,
  palette,
}: {
  items: { key: T; label: string }[];
  value: T;
  onChange: (key: T) => void;
  activeColor: string;
  palette: ReturnType<typeof useColors>;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.chipsRow}
      style={styles.chipsScroll}
    >
      {items.map((f) => {
        const active = value === f.key;
        return (
          <Pressable
            key={f.key}
            onPress={() => {
              haptic('select');
              onChange(f.key);
            }}
            style={[
              styles.chip,
              {
                backgroundColor: active ? activeColor : palette.bg.card,
                borderColor: active ? activeColor : palette.border.subtle,
              },
            ]}
          >
            <Text style={[styles.chipText, { color: active ? '#fff' : palette.text.secondary }]}>{f.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function Field({
  label,
  children,
  palette,
  surface,
  flex,
}: {
  label: string;
  children: React.ReactNode;
  palette: ReturnType<typeof useColors>;
  surface: ReturnType<typeof useIosSurface>;
  flex?: boolean;
}) {
  return (
    <View style={[styles.field, flex && styles.fieldFlex]}>
      <Text style={[styles.fieldLabel, { color: palette.text.tertiary }]}>{label}</Text>
      <View style={[styles.inputWrap, surface.cardCompact]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  headerAdd: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  controls: { paddingHorizontal: spacing[4], gap: spacing[2.5], paddingBottom: spacing[2] },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
  },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: spacing[2.5] },
  chipsScroll: { flexGrow: 0 },
  chipsRow: { gap: spacing[2], paddingVertical: 2 },
  chip: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipText: { fontSize: 13, fontWeight: '600' },
  listContent: { paddingHorizontal: spacing[4], paddingTop: spacing[1], gap: spacing[2.5] },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], paddingVertical: spacing[3] },
  rowChips: { alignItems: 'flex-end', gap: 4 },
  name: { fontSize: 15, fontWeight: '700' },
  meta: { fontSize: 12, marginTop: 2 },
  emptyBlock: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing[16], gap: spacing[2] },
  emptyText: { fontSize: 14, textAlign: 'center' },
  retryText: { fontSize: 15, fontWeight: '600' },
  // Sheet
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
  sheetScroll: { padding: spacing[4], gap: spacing[3] },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: spacing[2],
    marginLeft: spacing[1],
  },
  sectionHint: { fontSize: 12, marginLeft: spacing[1], marginTop: -spacing[1] },
  field: { gap: spacing[1.5] },
  fieldRow: { flexDirection: 'row', gap: spacing[3] },
  fieldFlex: { flex: 1 },
  fieldLabel: { fontSize: 12, fontWeight: '600', marginLeft: spacing[1] },
  fieldHint: { fontSize: 11, marginLeft: spacing[1], marginTop: -spacing[1], lineHeight: 15 },
  inputWrap: { paddingHorizontal: spacing[3] },
  input: { fontSize: 16, paddingVertical: spacing[3] },
  inputMultiline: { minHeight: 72, textAlignVertical: 'top' },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3.5],
  },
  pickerValue: { fontSize: 16, flex: 1 },
  switchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
  },
  switchLabel: { fontSize: 15, fontWeight: '600' },
  // Plan picker
  pickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing[6],
  },
  pickerSheet: {
    width: '100%',
    maxHeight: '70%',
    borderRadius: borderRadius['2xl'],
    paddingVertical: spacing[4],
  },
  pickerTitle: {
    fontSize: 17,
    fontWeight: '700',
    paddingHorizontal: spacing[5],
    paddingBottom: spacing[3],
  },
  pickerList: { flexGrow: 0 },
  pickerOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[3.5],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pickerOptionName: { fontSize: 16, fontWeight: '600' },
  pickerOptionMeta: { fontSize: 12, marginTop: 2 },
  pickerClear: { alignItems: 'center', paddingTop: spacing[3.5] },
  pickerClearText: { fontSize: 15, fontWeight: '600' },
  deleteTenantBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[3.5],
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: spacing[4],
  },
  deleteTenantText: { fontSize: 15, fontWeight: '700' },
});
