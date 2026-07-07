/**
 * AdminTenantsScreen — searchable tenant directory for the superadmin.
 *
 * Status chips (Все / Активные / Истёкшие) filter the list; tapping a row
 * pushes AdminTenantDetailScreen onto the tab's native-stack (Apple-Mail
 * pattern — the admin bar stays visible).
 *
 * The «+» header opens a create/edit sheet (same visual language as
 * AdminPlansScreen) so the superadmin can register a new car service without
 * leaving the app:
 *   • Компания — название (обяз.), телефон, адрес, email.
 *   • Подписка — тариф (plansApi), макс. польз., дата окончания.
 *   • Директор — имя, телефон, пароль (опционально, только при создании).
 *   • Активен — тумблер (только при редактировании).
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
import { tenantsApi, plansApi } from '../../api/services';
import IosScreenHeader from '../../components/IosScreenHeader';
import { Text } from '../../platform/Typography';
import { haptic } from '../../platform/haptics';
import { useColors } from '../../contexts/ThemeContext';
import { useIosSurface } from '../../platform/iosSurface';
import { colors, spacing, borderRadius } from '../../theme';
import { useAdminTabBarScrollInsets } from '../../hooks/useAdminTabBarHeight';
import { formatPhone, normalizePhone, isValidPhone } from '../../../../shared/validation/phone';
import type { Tenant, Plan } from '../../../../shared/types';
import type { CreateTenantRequest, UpdateTenantRequest } from '../../../../shared/api/types';
import { formatMoney, isExpired, tenantStatus, periodKindChip, StatusChip, InitialAvatar } from './adminShared';

type FilterKey = 'all' | 'active' | 'expired';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'Все' },
  { key: 'active', label: 'Активные' },
  { key: 'expired', label: 'Истёкшие' },
];

/** Editable form state. Everything is a string for controlled inputs; coerced on save. */
interface TenantDraft {
  id?: string;
  // Company
  name: string;
  phone: string;
  address: string;
  email: string;
  // Subscription
  planId: string | null;
  maxUsers: string;
  subscriptionEnd: string; // YYYY-MM-DD
  // Director (create only)
  directorName: string;
  directorPhone: string;
  directorPassword: string;
  // Edit only
  isActive: boolean;
}

/** ISO date (or null) → YYYY-MM-DD for the input. */
function toDateInput(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function toDraft(tenant?: Tenant): TenantDraft {
  return {
    id: tenant?.id,
    name: tenant?.name ?? '',
    phone: tenant?.phone ? formatPhone(tenant.phone) : '',
    address: tenant?.address ?? '',
    email: tenant?.email ?? '',
    planId: tenant?.planId ?? null,
    maxUsers: tenant ? String(tenant.maxUsers) : '',
    subscriptionEnd: toDateInput(tenant?.subscriptionEnd),
    directorName: '',
    directorPhone: '',
    directorPassword: '',
    isActive: tenant ? tenant.isActive : true,
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
  const [search, setSearch] = React.useState('');
  const [filter, setFilter] = React.useState<FilterKey>('all');
  const [editing, setEditing] = React.useState<TenantDraft | null>(null);
  const [planPickerOpen, setPlanPickerOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const { data: tenants = [] } = useQuery<Tenant[]>({
    queryKey: ['admin-tenants'],
    queryFn: async () => (await tenantsApi.getAll()).data,
  });

  const { data: plans = [] } = useQuery<Plan[]>({
    queryKey: ['admin-plans'],
    queryFn: async () => (await plansApi.getAll()).data,
  });

  const activePlans = React.useMemo(() => plans.filter((p) => p.isActive), [plans]);

  const filtered = React.useMemo(() => {
    let list = tenants;
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (t) =>
          t.name.toLowerCase().includes(q) || t.phone?.toLowerCase().includes(q) || t.email?.toLowerCase().includes(q),
      );
    }
    if (filter === 'active') list = list.filter((t) => t.isActive && !isExpired(t.subscriptionEnd));
    else if (filter === 'expired') list = list.filter((t) => isExpired(t.subscriptionEnd) || !t.isActive);
    return [...list].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [tenants, search, filter]);

  const invalidate = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['admin-tenants'] });
    queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
  }, [queryClient]);

  const saveMutation = useMutation({
    mutationFn: async (draft: TenantDraft) => {
      setSaving(true);
      const selectedPlan = draft.planId ? activePlans.find((p) => p.id === draft.planId) : undefined;
      const maxUsers = parseInt(draft.maxUsers, 10);
      const subscriptionEnd = parseDate(draft.subscriptionEnd);

      if (draft.id) {
        const payload: UpdateTenantRequest = {
          name: draft.name.trim(),
          phone: draft.phone.trim() ? normalizePhone(draft.phone) : '',
          address: draft.address.trim(),
          email: draft.email.trim(),
          isActive: draft.isActive,
          planId: draft.planId ?? undefined,
          ...(Number.isFinite(maxUsers) && maxUsers > 0 ? { maxUsers } : {}),
          ...(selectedPlan ? { monthlyPrice: selectedPlan.monthlyPrice } : {}),
          ...(subscriptionEnd ? { subscriptionEnd } : {}),
        };
        await tenantsApi.update(draft.id, payload);
      } else {
        const payload: CreateTenantRequest = {
          name: draft.name.trim(),
          ...(draft.phone.trim() ? { phone: normalizePhone(draft.phone) } : {}),
          ...(draft.address.trim() ? { address: draft.address.trim() } : {}),
          ...(draft.email.trim() ? { email: draft.email.trim() } : {}),
          ...(draft.planId ? { planId: draft.planId } : {}),
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
    onError: () => {
      haptic('error');
      Alert.alert('Ошибка', editing?.id ? 'Не удалось сохранить изменения' : 'Не удалось создать автосервис');
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
        if (editing.directorPassword.length < 6) {
          haptic('error');
          Alert.alert('Нужен пароль директора', 'Пароль владельца — минимум 6 символов.');
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

  return (
    <View style={[styles.root, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader
        title="Тенанты"
        subtitle={`${tenants.length} организаций`}
        trailing={
          <Pressable
            onPress={() => {
              haptic('tap');
              setEditing(toDraft());
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
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRow}
          style={styles.chipsScroll}
        >
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <Pressable
                key={f.key}
                onPress={() => {
                  haptic('select');
                  setFilter(f.key);
                }}
                style={[
                  styles.chip,
                  {
                    backgroundColor: active ? palette.accent.primary : palette.bg.card,
                    borderColor: active ? palette.accent.primary : palette.border.subtle,
                  },
                ]}
              >
                <Text style={[styles.chipText, { color: active ? '#fff' : palette.text.secondary }]}>{f.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
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
            <Ionicons name="search-outline" size={40} color={palette.text.tertiary} />
            <Text style={[styles.emptyText, { color: palette.text.secondary }]}>Ничего не найдено</Text>
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
              </View>
              <View style={styles.rowChips}>
                <StatusChip status={tenantStatus(item, palette.mode)} />
                {period ? <StatusChip status={period} /> : null}
              </View>
              <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} />
            </Pressable>
          );
        }}
      />

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
                      setPlanPickerOpen(true);
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
                        placeholder="Минимум 6 символов"
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

      {/* Plan picker (nested over the sheet) */}
      <Modal
        visible={planPickerOpen}
        transparent
        statusBarTranslucent
        animationType="fade"
        onRequestClose={() => setPlanPickerOpen(false)}
      >
        <Pressable style={styles.pickerBackdrop} onPress={() => setPlanPickerOpen(false)}>
          <Pressable style={[styles.pickerSheet, { backgroundColor: palette.bg.canvas }]} onPress={() => {}}>
            <Text style={[styles.pickerTitle, { color: palette.text.primary }]}>Выберите тариф</Text>
            <ScrollView showsVerticalScrollIndicator={false} style={styles.pickerList}>
              {activePlans.map((p) => {
                const active = editing?.planId === p.id;
                return (
                  <Pressable
                    key={p.id}
                    onPress={() => {
                      haptic('select');
                      setEditing((prev) =>
                        prev
                          ? {
                              ...prev,
                              planId: p.id,
                              // Auto-suggest the plan's seat limit when none typed yet.
                              maxUsers: prev.maxUsers.trim() ? prev.maxUsers : String(p.maxUsers),
                            }
                          : prev,
                      );
                      setPlanPickerOpen(false);
                    }}
                    style={[styles.pickerOption, { borderBottomColor: palette.border.subtle }]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.pickerOptionName, { color: palette.text.primary }]}>{p.name}</Text>
                      <Text style={[styles.pickerOptionMeta, { color: palette.text.tertiary }]}>
                        {formatMoney(p.monthlyPrice)}/мес · до {p.maxUsers} польз.
                      </Text>
                    </View>
                    {active ? <Ionicons name="checkmark" size={20} color={palette.accent.primary} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
            <Pressable
              onPress={() => {
                haptic('select');
                setEditing((prev) => (prev ? { ...prev, planId: null } : prev));
                setPlanPickerOpen(false);
              }}
              style={styles.pickerClear}
            >
              <Text style={[styles.pickerClearText, { color: palette.text.secondary }]}>Без тарифа</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
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
  emptyText: { fontSize: 14 },
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
  inputWrap: { paddingHorizontal: spacing[3] },
  input: { fontSize: 16, paddingVertical: spacing[3] },
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
