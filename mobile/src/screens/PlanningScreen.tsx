/**
 * PlanningScreen — «Постоянные расходы и мотивация» (v3.0.1 ФИЧА 1).
 *
 * Владельческий (director / superadmin) конфиг планирования, который питает
 * НАЧИСЛЕННУЮ чистую прибыль на дашборде (DashboardV2.netProfitAccrual). Два
 * независимых раздела, оба через `planningApi` (backend planning/, миграция 132,
 * owner-class + financial_reports закрыты на сервере):
 *
 *   1. «Постоянные расходы» — плановые ежемесячные суммы (аренда/коммуналка/
 *      реклама/другое). Амортизируются по календарным дням в начисленной прибыли.
 *      CRUD: getFixedCosts / createFixedCost / updateFixedCost / deleteFixedCost.
 *
 *   2. «Мотивация сотрудников» — компенсация не-сдельных сотрудников: оклад/мес,
 *      % с оборота или % с прибыли. Один конфиг на сотрудника (upsert по
 *      tenant+employee). % мастеру за конкретную работу настраивается отдельно —
 *      в услугах/чеке (об этом есть заметка в разделе).
 *
 * Экран самогейтится до владельца; строка в «Ещё → Финансы» тоже roles-filtered.
 * Живёт в MoreStack, поэтому floating tab bar остаётся виден. Дашборд открывает
 * его через navigate('Main', { screen: 'MoreTab', params: { screen: 'Planning' } }).
 *
 * Только presentation + config: контракт (`planningApi`, типы) уже существует.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet, Switch, Platform, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import IosScreenHeader from '../components/IosScreenHeader';
import LoadingSpinner from '../components/LoadingSpinner';
import QueryErrorState from '../components/QueryErrorState';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import { planningApi, usersApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import { useColors } from '../contexts/ThemeContext';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { haptic } from '../platform/haptics';
import { colors, fontSize, fontWeight, borderRadius, spacing, softTint } from '../theme';
import { iosSectionLabel, useShadow } from '../platform/iosSurface';
import { UserRole } from '../../../shared/types';
import type {
  FixedCost,
  FixedCostCategory,
  EmployeeCompensation,
  EmployeeCompensationType,
  User,
} from '../../../shared/types';
import { formatMoney, roleLabels } from '../../../shared/utils/formatters';

// ── Метаданные категорий постоянных расходов ────────────────────────────────

const CATEGORY_ORDER: FixedCostCategory[] = ['rent', 'utilities', 'marketing', 'other'];
const CATEGORY_META: Record<FixedCostCategory, { label: string; icon: keyof typeof Ionicons.glyphMap; color: string }> =
  {
    rent: { label: 'Аренда', icon: 'business-outline', color: colors.indigo[600] },
    utilities: { label: 'Коммуналка', icon: 'flash-outline', color: colors.teal[600] },
    marketing: { label: 'Реклама', icon: 'megaphone-outline', color: colors.violet[600] },
    other: { label: 'Другое', icon: 'ellipsis-horizontal-circle-outline', color: colors.slate[500] },
  };

// ── Метаданные типов мотивации ──────────────────────────────────────────────

const COMP_ORDER: EmployeeCompensationType[] = ['fixed_monthly', 'pct_turnover', 'pct_profit'];
const COMP_META: Record<
  EmployeeCompensationType,
  { label: string; short: string; hint: string; unit: 'money' | 'percent' }
> = {
  fixed_monthly: { label: 'Оклад / мес', short: 'Оклад', hint: 'Фиксированная сумма в месяц', unit: 'money' },
  pct_turnover: { label: '% с оборота', short: '% оборот', hint: 'Процент от выручки за период', unit: 'percent' },
  pct_profit: { label: '% с прибыли', short: '% прибыль', hint: 'Процент от прибыли по чекам', unit: 'percent' },
};

// ── Парсинг ввода ────────────────────────────────────────────────────────────

/** Целые рубли из строки (только цифры). */
function parseMoney(s: string): number {
  const digits = s.replace(/\D/g, '');
  return digits ? parseInt(digits, 10) : 0;
}
/** Процент 0..100 (допускаем дробь через точку/запятую). */
function parsePercent(s: string): number {
  const n = parseFloat(s.replace(',', '.').replace(/[^\d.]/g, ''));
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}
/** Компактная подпись значения мотивации для строки сотрудника. */
function compValueLabel(c: EmployeeCompensation): string {
  return COMP_META[c.type].unit === 'money' ? `${formatMoney(c.amount)} / мес` : `${c.amount}%`;
}

function initials(name: string): string {
  const parts = (name || '').trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0]?.[0] || '?').toUpperCase();
}

// ═══════════════════════════════════════════════════════════════════════════
//  Screen
// ═══════════════════════════════════════════════════════════════════════════

export default function PlanningScreen() {
  const navigation = useNavigation<any>();
  const palette = useColors();
  const shadow = useShadow();
  const tabBarHeight = useTabBarHeight();
  const queryClient = useQueryClient();
  const { isRole } = useAuth();

  const isOwner = isRole(UserRole.DIRECTOR, UserRole.SUPERADMIN);

  // ── Queries ────────────────────────────────────────────────────────────
  const {
    data: fixedCosts,
    isError: fixedError,
    refetch: refetchFixed,
  } = useQuery<FixedCost[]>({
    queryKey: ['planning', 'fixed-costs'],
    queryFn: async () => {
      const res = await planningApi.fixedCosts.list();
      return Array.isArray(res.data) ? res.data : [];
    },
    enabled: isOwner,
    placeholderData: (prev) => prev,
  });

  const { data: compensation } = useQuery<EmployeeCompensation[]>({
    queryKey: ['planning', 'compensation'],
    queryFn: async () => {
      const res = await planningApi.compensation.list();
      return Array.isArray(res.data) ? res.data : [];
    },
    enabled: isOwner,
    placeholderData: (prev) => prev,
  });

  const { data: users } = useQuery<User[]>({
    queryKey: ['users'],
    queryFn: async () => {
      const res = await usersApi.getAll();
      return Array.isArray(res.data) ? res.data : [];
    },
    enabled: isOwner,
    placeholderData: (prev) => prev,
  });

  // ── Mutations: fixed costs ───────────────────────────────────────────────
  const invalidateFixed = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['planning', 'fixed-costs'] }),
    [queryClient],
  );
  const invalidateComp = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['planning', 'compensation'] }),
    [queryClient],
  );

  const saveFixedMutation = useMutation({
    mutationFn: (v: {
      id?: string;
      name: string;
      category: FixedCostCategory;
      monthlyAmount: number;
      active: boolean;
    }) =>
      v.id
        ? planningApi.fixedCosts.update(v.id, {
            name: v.name,
            category: v.category,
            monthlyAmount: v.monthlyAmount,
            active: v.active,
          })
        : planningApi.fixedCosts.create({
            name: v.name,
            category: v.category,
            monthlyAmount: v.monthlyAmount,
            active: v.active,
          }),
    onSuccess: () => {
      haptic('success');
      invalidateFixed();
      setFixedModalOpen(false);
    },
    onError: () => {
      haptic('error');
      Alert.alert('Ошибка', 'Не удалось сохранить постоянный расход');
    },
  });

  const deleteFixedMutation = useMutation({
    mutationFn: (id: string) => planningApi.fixedCosts.remove(id),
    onSuccess: () => {
      haptic('success');
      invalidateFixed();
    },
    onError: () => Alert.alert('Ошибка', 'Не удалось удалить'),
  });

  const toggleFixedMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => planningApi.fixedCosts.update(id, { active }),
    onMutate: async ({ id, active }) => {
      await queryClient.cancelQueries({ queryKey: ['planning', 'fixed-costs'] });
      const prev = queryClient.getQueryData<FixedCost[]>(['planning', 'fixed-costs']);
      queryClient.setQueryData<FixedCost[]>(['planning', 'fixed-costs'], (old) =>
        old ? old.map((c) => (c.id === id ? { ...c, active } : c)) : old,
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['planning', 'fixed-costs'], ctx.prev);
      Alert.alert('Ошибка', 'Не удалось изменить статус');
    },
    onSettled: () => invalidateFixed(),
  });

  const saveCompMutation = useMutation({
    mutationFn: (v: { userId: string; type: EmployeeCompensationType; amount: number; active: boolean }) =>
      planningApi.compensation.upsert(v),
    onSuccess: () => {
      haptic('success');
      invalidateComp();
      setCompModalOpen(false);
    },
    onError: () => {
      haptic('error');
      Alert.alert('Ошибка', 'Не удалось сохранить мотивацию');
    },
  });

  const deleteCompMutation = useMutation({
    mutationFn: (id: string) => planningApi.compensation.remove(id),
    onSuccess: () => {
      haptic('success');
      invalidateComp();
    },
    onError: () => Alert.alert('Ошибка', 'Не удалось удалить'),
  });

  // ── Fixed-cost modal state ───────────────────────────────────────────────
  const [fixedModalOpen, setFixedModalOpen] = useState(false);
  const [editingFixed, setEditingFixed] = useState<FixedCost | null>(null);
  const [fName, setFName] = useState('');
  const [fCategory, setFCategory] = useState<FixedCostCategory>('rent');
  const [fAmount, setFAmount] = useState('');
  const [fActive, setFActive] = useState(true);
  const [deleteFixedId, setDeleteFixedId] = useState<string | null>(null);

  const openFixedCreate = useCallback(() => {
    haptic('tap');
    setEditingFixed(null);
    setFName('');
    setFCategory('rent');
    setFAmount('');
    setFActive(true);
    setFixedModalOpen(true);
  }, []);

  const openFixedEdit = useCallback((c: FixedCost) => {
    haptic('tap');
    setEditingFixed(c);
    setFName(c.name);
    setFCategory(c.category);
    setFAmount(String(c.monthlyAmount || ''));
    setFActive(c.active);
    setFixedModalOpen(true);
  }, []);

  const submitFixed = useCallback(() => {
    const name = fName.trim();
    const monthlyAmount = parseMoney(fAmount);
    if (!name) {
      Alert.alert('Укажите название', 'Например: «Аренда бокса» или «Реклама Авито».');
      return;
    }
    if (monthlyAmount <= 0) {
      Alert.alert('Укажите сумму', 'Сумма в месяц должна быть больше нуля.');
      return;
    }
    saveFixedMutation.mutate({ id: editingFixed?.id, name, category: fCategory, monthlyAmount, active: fActive });
  }, [fName, fAmount, fCategory, fActive, editingFixed, saveFixedMutation]);

  // ── Compensation modal state ─────────────────────────────────────────────
  const [compModalOpen, setCompModalOpen] = useState(false);
  const [compUser, setCompUser] = useState<{ id: string; name: string } | null>(null);
  const [compExistingId, setCompExistingId] = useState<string | null>(null);
  const [cType, setCType] = useState<EmployeeCompensationType>('fixed_monthly');
  const [cAmount, setCAmount] = useState('');
  const [cActive, setCActive] = useState(true);
  const [deleteCompId, setDeleteCompId] = useState<string | null>(null);

  const compByUser = useMemo(() => {
    const map = new Map<string, EmployeeCompensation>();
    for (const c of compensation ?? []) map.set(c.userId, c);
    return map;
  }, [compensation]);

  const openComp = useCallback(
    (u: User) => {
      haptic('tap');
      const existing = compByUser.get(u.id);
      setCompUser({ id: u.id, name: u.fullName });
      setCompExistingId(existing?.id ?? null);
      setCType(existing?.type ?? 'fixed_monthly');
      setCAmount(existing ? String(existing.amount || '') : '');
      setCActive(existing ? existing.active : true);
      setCompModalOpen(true);
    },
    [compByUser],
  );

  const submitComp = useCallback(() => {
    if (!compUser) return;
    const isMoney = COMP_META[cType].unit === 'money';
    const amount = isMoney ? parseMoney(cAmount) : parsePercent(cAmount);
    if (amount <= 0) {
      Alert.alert('Укажите значение', isMoney ? 'Оклад должен быть больше нуля.' : 'Процент должен быть больше нуля.');
      return;
    }
    saveCompMutation.mutate({ userId: compUser.id, type: cType, amount, active: cActive });
  }, [compUser, cType, cAmount, cActive, saveCompMutation]);

  // Сотрудники для мотивации: реальные сотрудники автосервиса (без платформенного
  // суперадмина). Владелец/директор виден — на случай собственного оклада.
  const staff = useMemo(() => (users ?? []).filter((u) => u.role !== UserRole.SUPERADMIN), [users]);

  // Сумма постоянных расходов в месяц (только активные) + амортизация по дням.
  const fixedTotal = useMemo(
    () => (fixedCosts ?? []).reduce((s, c) => (c.active ? s + (c.monthlyAmount || 0) : s), 0),
    [fixedCosts],
  );
  const daysInMonth = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  }, []);
  const perDay = fixedTotal > 0 ? Math.round(fixedTotal / daysInMonth) : 0;

  // ── Owner gate ────────────────────────────────────────────────────────────
  if (!isOwner) {
    return (
      <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
        <IosScreenHeader title="Постоянные расходы" onBack={() => navigation.goBack()} />
        <View style={styles.restricted}>
          <Ionicons name="lock-closed-outline" size={40} color={palette.text.tertiary} />
          <Text style={[styles.restrictedText, { color: palette.text.secondary }]}>
            Планирование постоянных расходов и мотивации доступно только владельцу.
          </Text>
        </View>
      </View>
    );
  }

  const cardBase = [styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }, shadow];

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader
        title="Постоянные расходы"
        subtitle="Для расчёта чистой прибыли"
        onBack={() => navigation.goBack()}
      />

      {fixedError && fixedCosts === undefined ? (
        <QueryErrorState description="Проверьте соединение и попробуйте ещё раз" onRetry={() => refetchFixed()} />
      ) : fixedCosts === undefined ? (
        <LoadingSpinner />
      ) : (
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: spacing[4],
            paddingTop: spacing[3],
            paddingBottom: tabBarHeight + spacing[6],
            gap: spacing[4],
          }}
          contentInset={Platform.OS === 'ios' ? { bottom: tabBarHeight } : undefined}
          scrollIndicatorInsets={{ bottom: tabBarHeight }}
          showsVerticalScrollIndicator={false}
        >
          {/* ── Summary ─────────────────────────────────────────────────── */}
          <View style={cardBase}>
            <View style={styles.summaryRow}>
              <View style={styles.summaryCell}>
                <Text style={[styles.summaryLabel, { color: palette.text.tertiary }]}>ПОСТОЯНКА / МЕС</Text>
                <Text
                  style={[styles.summaryValue, { color: palette.text.primary }]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.7}
                >
                  {formatMoney(fixedTotal)}
                </Text>
              </View>
              <View style={[styles.summaryDivider, { backgroundColor: palette.border.subtle }]} />
              <View style={styles.summaryCell}>
                <Text style={[styles.summaryLabel, { color: palette.text.tertiary }]}>В ДЕНЬ ≈</Text>
                <Text
                  style={[styles.summaryValue, { color: palette.accent.primaryText }]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.7}
                >
                  {formatMoney(perDay)}
                </Text>
              </View>
            </View>
            <Text style={[styles.summaryHint, { color: palette.text.tertiary }]}>
              В прибыли постоянные расходы учитываются по дням (амортизация), а не разовым списанием.
            </Text>
          </View>

          {/* ── Постоянные расходы ──────────────────────────────────────── */}
          <View>
            <View style={styles.sectionHead}>
              <Text style={[iosSectionLabel, styles.sectionLabel, { color: palette.text.secondary }]}>
                Постоянные расходы
              </Text>
              <TouchableOpacity
                style={[styles.addBtn, { backgroundColor: palette.accent.primary }]}
                onPress={openFixedCreate}
                activeOpacity={0.85}
              >
                <Ionicons name="add" size={16} color={colors.white} />
                <Text style={styles.addBtnText}>Добавить</Text>
              </TouchableOpacity>
            </View>

            {fixedCosts.length === 0 ? (
              <TouchableOpacity style={[cardBase, styles.emptyCard]} activeOpacity={0.8} onPress={openFixedCreate}>
                <Ionicons name="repeat-outline" size={26} color={palette.text.tertiary} />
                <Text style={[styles.emptyTitle, { color: palette.text.secondary }]}>Пока нет постоянных расходов</Text>
                <Text style={[styles.emptySub, { color: palette.text.tertiary }]}>
                  Добавьте аренду, коммуналку, рекламу — и прибыль станет честной
                </Text>
              </TouchableOpacity>
            ) : (
              <View style={{ gap: spacing[2.5] }}>
                {fixedCosts.map((c) => {
                  const meta = CATEGORY_META[c.category] ?? CATEGORY_META.other;
                  const tileBg = palette.mode === 'dark' ? softTint(meta.color, 'dark') : `${meta.color}14`;
                  return (
                    <TouchableOpacity
                      key={c.id}
                      style={[cardBase, styles.fixedRow, !c.active && { opacity: 0.55 }]}
                      activeOpacity={0.72}
                      onPress={() => openFixedEdit(c)}
                    >
                      <View style={[styles.fixedIcon, { backgroundColor: tileBg }]}>
                        <Ionicons name={meta.icon} size={19} color={meta.color} />
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={[styles.fixedName, { color: palette.text.primary }]} numberOfLines={1}>
                          {c.name}
                        </Text>
                        <View style={styles.fixedSubRow}>
                          <Text style={[styles.fixedCategory, { color: meta.color }]}>{meta.label}</Text>
                          {!c.active && (
                            <View style={[styles.pausePill, { backgroundColor: palette.bg.muted }]}>
                              <Text style={[styles.pausePillText, { color: palette.text.tertiary }]}>Пауза</Text>
                            </View>
                          )}
                        </View>
                      </View>
                      <View style={styles.fixedAmountCol}>
                        <Text style={[styles.fixedAmount, { color: palette.text.primary }]} numberOfLines={1}>
                          {formatMoney(c.monthlyAmount)}
                        </Text>
                        <Text style={[styles.fixedPerMonth, { color: palette.text.tertiary }]}>/ мес</Text>
                      </View>
                      <Switch
                        value={c.active}
                        onValueChange={(v) => {
                          haptic('select');
                          toggleFixedMutation.mutate({ id: c.id, active: v });
                        }}
                        trackColor={{ false: palette.bg.muted, true: colors.green[500] }}
                        thumbColor={colors.white}
                        ios_backgroundColor={palette.bg.muted}
                        style={styles.fixedSwitch}
                      />
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>

          {/* ── Мотивация сотрудников ───────────────────────────────────── */}
          <View>
            <Text style={[iosSectionLabel, styles.sectionLabel, { color: palette.text.secondary }]}>
              Мотивация сотрудников
            </Text>

            {/* Заметка: % мастеру за работу — это отдельная настройка (услуги/чек). */}
            <View style={[styles.note, { backgroundColor: palette.bg.muted }]}>
              <Ionicons name="information-circle-outline" size={15} color={palette.text.tertiary} />
              <Text style={[styles.noteText, { color: palette.text.secondary }]}>
                Здесь — оклад и проценты не-сдельным сотрудникам. % мастеру за работу настраивается в услугах и в чеке.
              </Text>
            </View>

            {users === undefined ? (
              <View style={[cardBase, { alignItems: 'center', paddingVertical: spacing[6] }]}>
                <LoadingSpinner />
              </View>
            ) : staff.length === 0 ? (
              <View style={[cardBase, styles.emptyCard]}>
                <Ionicons name="people-outline" size={24} color={palette.text.tertiary} />
                <Text style={[styles.emptyTitle, { color: palette.text.secondary }]}>Нет сотрудников</Text>
              </View>
            ) : (
              <View style={[cardBase, { paddingVertical: 0, paddingHorizontal: 0 }]}>
                {staff.map((u, idx) => {
                  const comp = compByUser.get(u.id);
                  return (
                    <TouchableOpacity
                      key={u.id}
                      style={[
                        styles.compRow,
                        idx < staff.length - 1 && {
                          borderBottomWidth: StyleSheet.hairlineWidth,
                          borderBottomColor: palette.border.subtle,
                        },
                      ]}
                      activeOpacity={0.65}
                      onPress={() => openComp(u)}
                    >
                      <View style={[styles.compAvatar, { backgroundColor: palette.accent.primarySoft }]}>
                        <Text style={[styles.compAvatarText, { color: palette.accent.primaryText }]}>
                          {initials(u.fullName)}
                        </Text>
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={[styles.compName, { color: palette.text.primary }]} numberOfLines={1}>
                          {u.fullName}
                        </Text>
                        <Text style={[styles.compRole, { color: palette.text.tertiary }]} numberOfLines={1}>
                          {roleLabels[u.role] || u.role}
                        </Text>
                      </View>
                      {comp && comp.active ? (
                        <View style={styles.compValueCol}>
                          <Text style={[styles.compType, { color: palette.text.tertiary }]}>
                            {COMP_META[comp.type].short}
                          </Text>
                          <Text style={[styles.compValue, { color: colors.green[600] }]} numberOfLines={1}>
                            {compValueLabel(comp)}
                          </Text>
                        </View>
                      ) : comp ? (
                        <View style={[styles.compNotSet, { backgroundColor: palette.bg.muted }]}>
                          <Text style={[styles.compNotSetText, { color: palette.text.tertiary }]}>Пауза</Text>
                        </View>
                      ) : (
                        <View style={[styles.compNotSet, { backgroundColor: palette.bg.muted }]}>
                          <Text style={[styles.compNotSetText, { color: palette.text.tertiary }]}>Задать</Text>
                        </View>
                      )}
                      <Ionicons
                        name="chevron-forward"
                        size={16}
                        color={palette.text.tertiary}
                        style={{ marginLeft: 2 }}
                      />
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>
        </ScrollView>
      )}

      {/* ── Модалка постоянного расхода ──────────────────────────────────── */}
      <Modal
        visible={fixedModalOpen}
        onClose={() => setFixedModalOpen(false)}
        title={editingFixed ? 'Постоянный расход' : 'Новый постоянный расход'}
      >
        <Text style={[styles.formLabel, { color: palette.text.secondary }]}>Название</Text>
        <TextInput
          value={fName}
          onChangeText={setFName}
          placeholder="Например: Аренда бокса"
          placeholderTextColor={palette.text.tertiary}
          style={[
            styles.input,
            { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary },
          ]}
        />

        <Text style={[styles.formLabel, { color: palette.text.secondary, marginTop: spacing[4] }]}>Категория</Text>
        <View style={styles.chipRow}>
          {CATEGORY_ORDER.map((cat) => {
            const meta = CATEGORY_META[cat];
            const active = fCategory === cat;
            return (
              <TouchableOpacity
                key={cat}
                style={[
                  styles.catChip,
                  {
                    backgroundColor: active ? meta.color : palette.bg.muted,
                    borderColor: active ? meta.color : palette.border.subtle,
                  },
                ]}
                onPress={() => {
                  haptic('select');
                  setFCategory(cat);
                }}
                activeOpacity={0.8}
              >
                <Ionicons name={meta.icon} size={14} color={active ? colors.white : meta.color} />
                <Text style={[styles.catChipText, { color: active ? colors.white : palette.text.secondary }]}>
                  {meta.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={[styles.formLabel, { color: palette.text.secondary, marginTop: spacing[4] }]}>Сумма в месяц</Text>
        <View style={[styles.amountWrap, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}>
          <TextInput
            value={fAmount}
            onChangeText={(t) => setFAmount(t.replace(/\D/g, ''))}
            placeholder="0"
            placeholderTextColor={palette.text.tertiary}
            keyboardType="number-pad"
            style={[styles.amountInput, { color: palette.text.primary }]}
          />
          <Text style={[styles.amountUnit, { color: palette.text.tertiary }]}>₽ / мес</Text>
        </View>

        <View style={[styles.switchRow, { borderTopColor: palette.border.subtle }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.switchLabel, { color: palette.text.primary }]}>Учитывать в прибыли</Text>
            <Text style={[styles.switchHint, { color: palette.text.tertiary }]} numberOfLines={1}>
              {fActive ? 'Активен — амортизируется по дням' : 'На паузе — не влияет на прибыль'}
            </Text>
          </View>
          <Switch
            value={fActive}
            onValueChange={setFActive}
            trackColor={{ false: palette.bg.card, true: colors.green[500] }}
            thumbColor={colors.white}
            ios_backgroundColor={palette.bg.card}
          />
        </View>

        <TouchableOpacity
          style={[
            styles.saveBtn,
            { backgroundColor: palette.accent.primary },
            saveFixedMutation.isPending && { opacity: 0.6 },
          ]}
          onPress={submitFixed}
          disabled={saveFixedMutation.isPending}
          activeOpacity={0.85}
        >
          <Text style={styles.saveBtnText}>{editingFixed ? 'Сохранить' : 'Добавить расход'}</Text>
        </TouchableOpacity>

        {editingFixed && (
          <TouchableOpacity
            style={styles.deleteBtn}
            onPress={() => setDeleteFixedId(editingFixed.id)}
            activeOpacity={0.7}
          >
            <Ionicons name="trash-outline" size={16} color={colors.red[600]} />
            <Text style={styles.deleteBtnText}>Удалить расход</Text>
          </TouchableOpacity>
        )}
      </Modal>

      {/* ── Модалка мотивации сотрудника ─────────────────────────────────── */}
      <Modal visible={compModalOpen} onClose={() => setCompModalOpen(false)} title={compUser?.name || 'Мотивация'}>
        <Text style={[styles.formLabel, { color: palette.text.secondary }]}>Тип мотивации</Text>
        <View style={{ gap: spacing[2] }}>
          {COMP_ORDER.map((t) => {
            const meta = COMP_META[t];
            const active = cType === t;
            return (
              <TouchableOpacity
                key={t}
                style={[
                  styles.typeCard,
                  {
                    backgroundColor: active ? palette.accent.primarySoft : palette.bg.muted,
                    borderColor: active ? palette.accent.primary : palette.border.subtle,
                  },
                ]}
                onPress={() => {
                  haptic('select');
                  setCType(t);
                }}
                activeOpacity={0.8}
              >
                <Ionicons
                  name={active ? 'radio-button-on' : 'radio-button-off'}
                  size={18}
                  color={active ? palette.accent.primary : palette.text.tertiary}
                />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.typeLabel, { color: palette.text.primary }]}>{meta.label}</Text>
                  <Text style={[styles.typeHint, { color: palette.text.tertiary }]}>{meta.hint}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={[styles.formLabel, { color: palette.text.secondary, marginTop: spacing[4] }]}>
          {COMP_META[cType].unit === 'money' ? 'Оклад в месяц' : 'Процент'}
        </Text>
        <View style={[styles.amountWrap, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}>
          <TextInput
            value={cAmount}
            onChangeText={(t) =>
              setCAmount(COMP_META[cType].unit === 'money' ? t.replace(/\D/g, '') : t.replace(/[^\d.,]/g, ''))
            }
            placeholder="0"
            placeholderTextColor={palette.text.tertiary}
            keyboardType={COMP_META[cType].unit === 'money' ? 'number-pad' : 'decimal-pad'}
            style={[styles.amountInput, { color: palette.text.primary }]}
          />
          <Text style={[styles.amountUnit, { color: palette.text.tertiary }]}>
            {COMP_META[cType].unit === 'money' ? '₽ / мес' : '%'}
          </Text>
        </View>

        <View style={[styles.switchRow, { borderTopColor: palette.border.subtle }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.switchLabel, { color: palette.text.primary }]}>Активна</Text>
            <Text style={[styles.switchHint, { color: palette.text.tertiary }]} numberOfLines={1}>
              {cActive ? 'Учитывается в расчёте прибыли' : 'На паузе — не учитывается'}
            </Text>
          </View>
          <Switch
            value={cActive}
            onValueChange={setCActive}
            trackColor={{ false: palette.bg.card, true: colors.green[500] }}
            thumbColor={colors.white}
            ios_backgroundColor={palette.bg.card}
          />
        </View>

        <TouchableOpacity
          style={[
            styles.saveBtn,
            { backgroundColor: palette.accent.primary },
            saveCompMutation.isPending && { opacity: 0.6 },
          ]}
          onPress={submitComp}
          disabled={saveCompMutation.isPending}
          activeOpacity={0.85}
        >
          <Text style={styles.saveBtnText}>Сохранить</Text>
        </TouchableOpacity>

        {compExistingId && (
          <TouchableOpacity
            style={styles.deleteBtn}
            onPress={() => setDeleteCompId(compExistingId)}
            activeOpacity={0.7}
          >
            <Ionicons name="trash-outline" size={16} color={colors.red[600]} />
            <Text style={styles.deleteBtnText}>Удалить мотивацию</Text>
          </TouchableOpacity>
        )}
      </Modal>

      {/* ── Confirm delete: fixed cost ───────────────────────────────────── */}
      <ConfirmDialog
        visible={deleteFixedId !== null}
        onClose={() => setDeleteFixedId(null)}
        onConfirm={() => {
          if (deleteFixedId) deleteFixedMutation.mutate(deleteFixedId);
          setDeleteFixedId(null);
          setFixedModalOpen(false);
        }}
        title="Удалить расход?"
        message="Постоянный расход перестанет учитываться в прибыли. Это действие необратимо."
        confirmText="Удалить"
        variant="danger"
      />

      {/* ── Confirm delete: compensation ─────────────────────────────────── */}
      <ConfirmDialog
        visible={deleteCompId !== null}
        onClose={() => setDeleteCompId(null)}
        onConfirm={() => {
          if (deleteCompId) deleteCompMutation.mutate(deleteCompId);
          setDeleteCompId(null);
          setCompModalOpen(false);
        }}
        title="Удалить мотивацию?"
        message="Мотивация сотрудника перестанет учитываться в расчёте прибыли."
        confirmText="Удалить"
        variant="danger"
      />
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Styles
// ═══════════════════════════════════════════════════════════════════════════

const styles = StyleSheet.create({
  safe: { flex: 1 },
  restricted: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing[8],
    gap: spacing[3],
  },
  restrictedText: { fontSize: fontSize.sm, textAlign: 'center', lineHeight: 20 },

  card: {
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3.5],
  },

  // Summary
  summaryRow: { flexDirection: 'row', alignItems: 'center' },
  summaryCell: { flex: 1, alignItems: 'flex-start', gap: 4 },
  summaryDivider: { width: StyleSheet.hairlineWidth, height: 34, marginHorizontal: spacing[3] },
  summaryLabel: { fontSize: 10, fontWeight: fontWeight.bold, letterSpacing: 0.6 },
  summaryValue: {
    fontSize: fontSize.xl,
    lineHeight: 26,
    fontWeight: fontWeight.bold,
    letterSpacing: -0.4,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  summaryHint: { fontSize: 11, lineHeight: 15, marginTop: spacing[3] },

  // Section head
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing[2],
  },
  sectionLabel: { marginLeft: spacing[1], marginBottom: 0 },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing[3],
    paddingVertical: 6,
    borderRadius: borderRadius.full,
  },
  addBtnText: { color: colors.white, fontSize: fontSize.xs, fontWeight: fontWeight.bold },

  // Empty
  emptyCard: { alignItems: 'center', gap: spacing[1.5], paddingVertical: spacing[6] },
  emptyTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, textAlign: 'center' },
  emptySub: { fontSize: fontSize.xs, textAlign: 'center', lineHeight: 17, paddingHorizontal: spacing[4] },

  // Fixed-cost row
  fixedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  fixedIcon: { width: 40, height: 40, borderRadius: borderRadius.xl, alignItems: 'center', justifyContent: 'center' },
  fixedName: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, letterSpacing: -0.2 },
  fixedSubRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginTop: 2 },
  fixedCategory: { fontSize: 11, fontWeight: fontWeight.semibold },
  pausePill: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6 },
  pausePillText: { fontSize: 10, fontWeight: fontWeight.semibold },
  fixedAmountCol: { alignItems: 'flex-end' },
  fixedAmount: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    letterSpacing: -0.3,
    fontVariant: ['tabular-nums'],
  },
  fixedPerMonth: { fontSize: 10, marginTop: 1 },
  fixedSwitch: Platform.OS === 'ios' ? { transform: [{ scale: 0.82 }], marginLeft: -2 } : { marginLeft: -4 },

  // Note
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2],
    padding: spacing[3],
    borderRadius: borderRadius.lg,
    marginBottom: spacing[2.5],
  },
  noteText: { flex: 1, fontSize: 12, lineHeight: 16 },

  // Compensation row
  compRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    minHeight: 60,
  },
  compAvatar: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  compAvatarText: { fontSize: 13, fontWeight: fontWeight.bold, letterSpacing: 0.2 },
  compName: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, letterSpacing: -0.2 },
  compRole: { fontSize: 11, marginTop: 1 },
  compValueCol: { alignItems: 'flex-end' },
  compType: { fontSize: 10, fontWeight: fontWeight.medium, textTransform: 'uppercase', letterSpacing: 0.3 },
  compValue: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, letterSpacing: -0.2, fontVariant: ['tabular-nums'] },
  compNotSet: { paddingHorizontal: spacing[2.5], paddingVertical: 4, borderRadius: borderRadius.full },
  compNotSetText: { fontSize: 11, fontWeight: fontWeight.semibold },

  // Forms
  formLabel: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, marginBottom: spacing[2], letterSpacing: 0.2 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3.5],
    paddingVertical: Platform.OS === 'ios' ? spacing[3] : spacing[2],
    fontSize: fontSize.base,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  catChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing[3],
    paddingVertical: 8,
    borderRadius: borderRadius.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  catChipText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold },
  amountWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3.5],
  },
  amountInput: {
    flex: 1,
    paddingVertical: Platform.OS === 'ios' ? spacing[3] : spacing[2],
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    letterSpacing: -0.3,
    fontVariant: ['tabular-nums'],
  },
  amountUnit: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  typeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[3],
    borderRadius: borderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  typeLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  typeHint: { fontSize: 11, marginTop: 1 },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    marginTop: spacing[4],
    paddingTop: spacing[3.5],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  switchLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  switchHint: { fontSize: 11, marginTop: 1 },
  saveBtn: {
    marginTop: spacing[5],
    borderRadius: borderRadius.xl,
    paddingVertical: spacing[3.5],
    alignItems: 'center',
  },
  saveBtnText: { color: colors.white, fontSize: fontSize.base, fontWeight: fontWeight.bold },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    marginTop: spacing[3],
    paddingVertical: spacing[3],
  },
  deleteBtnText: { color: colors.red[600], fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
});
