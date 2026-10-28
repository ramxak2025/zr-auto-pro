import { randomUUID } from 'expo-crypto';
import {
  costRevision,
  costRate,
  costStatus,
  plannedCostState,
  isVehicleCost,
  vehicleCostHint,
  costConflictMessage,
  isCostConflict,
  costRequestIntent,
} from '../../../shared/utils/planningCosts';
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
import React, { useCallback, useRef, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, StyleSheet, Switch, Platform, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import IosScreenHeader from '../components/IosScreenHeader';
import PointIndicator from '../components/PointIndicator';
import LoadingSpinner from '../components/LoadingSpinner';
import QueryErrorState from '../components/QueryErrorState';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import { planningApi, usersApi } from '../api/services';
import EmployeeAvatar from '../components/EmployeeAvatar';
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
import { useScreenSectionScroll } from '../components/ScreenSectionHeader';
import { ScreenSectionScrollView } from '../components/ScreenSectionScrollable';
import { HeaderAction } from '../components/ScreenHeaderControls';

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
  const section = useScreenSectionScroll();
  const deniedSection = useScreenSectionScroll({ composition: 'navigation' });
  const navigation = useNavigation<any>();
  const palette = useColors();
  const shadow = useShadow();
  const tabBarHeight = useTabBarHeight();
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();

  // Постоянные расходы/мотивация — ключ financial_reports (сервер: класс
  // planning.controller → @RequirePermission('financial_reports'); admin живёт
  // по матрице из /auth/me, сид reports.view=true — доступ как у API).
  const isOwner = hasPermission('financial_reports');

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

  // Команда ТЕКУЩЕГО филиала (167): оклады заводятся сотрудникам этого
  // автосервиса, и сервер отдаёт в списке окладов тоже только их.
  const { data: users } = useQuery<User[]>({
    queryKey: ['users', 'point'],
    queryFn: async () => {
      const res = await usersApi.getAll({ scope: 'point' });
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

  const intentId = useRef(costRequestIntent(randomUUID));
  const fixedBusy = useRef(false);
  const [fixedMessage, setFixedMessage] = useState('');
  const fixedFailure = async (error: unknown) => {
    fixedBusy.current = false;
    haptic('error');
    if (isCostConflict(error)) {
      const latest = await refetchFixed();
      if (editingFixed) setEditingFixed(latest.data?.find((c) => c.id === editingFixed.id) ?? editingFixed);
      setFixedMessage(costConflictMessage);
      Alert.alert('Расход изменился', costConflictMessage);
    } else {
      setFixedMessage('Не удалось сохранить. Введённые данные сохранены — повторите попытку.');
      Alert.alert('Ошибка', 'Не удалось сохранить. Повторите попытку.');
    }
  };
  const saveFixedMutation = useMutation({
    mutationFn: (v: {
      id?: string;
      body: Parameters<typeof planningApi.fixedCosts.create>[0] | Parameters<typeof planningApi.fixedCosts.update>[1];
    }) =>
      v.id
        ? planningApi.fixedCosts.update(v.id, v.body)
        : planningApi.fixedCosts.create(v.body as Parameters<typeof planningApi.fixedCosts.create>[0]),
    onSuccess: () => {
      haptic('success');
      invalidateFixed();
      queryClient.invalidateQueries({ queryKey: ['dashboard-v2'] });
      setFixedModalOpen(false);
    },
    onError: fixedFailure,
    onSettled: () => {
      fixedBusy.current = false;
    },
  });
  const deleteFixedMutation = useMutation({
    mutationFn: (cost: FixedCost) =>
      planningApi.fixedCosts.remove(
        cost.id,
        isVehicleCost(cost)
          ? {
              revision: costRevision(cost),
              requestId: intentId.current({ operation: 'archive', id: cost.id, revision: cost.revision }),
            }
          : undefined,
      ),
    onSuccess: () => {
      haptic('success');
      invalidateFixed();
      setFixedModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ['dashboard-v2'] });
    },
    onError: fixedFailure,
    onSettled: () => {
      fixedBusy.current = false;
    },
  });
  const toggleFixedMutation = useMutation({
    mutationFn: ({ cost, active }: { cost: FixedCost; active: boolean }) =>
      planningApi.fixedCosts.update(
        cost.id,
        isVehicleCost(cost)
          ? {
              active,
              revision: cost.revision,
              requestId: intentId.current({ id: cost.id, active, revision: cost.revision }),
            }
          : { active },
      ),
    onSuccess: () => {
      invalidateFixed();
      queryClient.invalidateQueries({ queryKey: ['dashboard-v2'] });
    },
    onError: fixedFailure,
    onSettled: () => {
      fixedBusy.current = false;
    },
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
  const [fMode, setFMode] = useState<'monthly' | 'per_vehicle_day'>('monthly');
  const [fName, setFName] = useState('');
  const [fCategory, setFCategory] = useState<FixedCostCategory>('rent');
  const [fAmount, setFAmount] = useState('');
  const [fActive, setFActive] = useState(true);

  const openFixedCreate = useCallback(() => {
    haptic('tap');
    setEditingFixed(null);
    intentId.current = costRequestIntent(randomUUID);
    setFixedMessage('');
    setFMode('monthly');
    setFName('');
    setFCategory('rent');
    setFAmount('');
    setFActive(true);
    setFixedModalOpen(true);
  }, []);

  const openFixedEdit = useCallback((c: FixedCost) => {
    haptic('tap');
    setEditingFixed(c);
    intentId.current = costRequestIntent(randomUUID);
    setFixedMessage('');
    setFMode(c.mode ?? 'monthly');
    setFName(c.name);
    setFCategory(c.category);
    setFAmount(String(isVehicleCost(c) ? (plannedCostState(c).perVehicleDayAmount ?? 0) : c.monthlyAmount || ''));
    setFActive(plannedCostState(c).active);
    setFixedModalOpen(true);
  }, []);

  const submitFixed = useCallback(() => {
    if (fixedBusy.current) return;
    const name = fName.trim();
    const raw = fAmount.trim().replace(',', '.');
    const amount = Number(raw);
    if (!name) return Alert.alert('Укажите название', 'Например: «Аренда бокса».');
    if (
      !/^\d+(?:\.\d{1,2})?$/.test(raw) ||
      !Number.isFinite(amount) ||
      amount < 0 ||
      amount > 100000000 ||
      (fMode === 'monthly' && amount === 0)
    )
      return Alert.alert('Укажите сумму', 'Допустимо не более двух знаков после запятой.');
    fixedBusy.current = true;
    setFixedMessage('');
    const base = { name, category: fCategory, active: fActive };
    if (fMode === 'per_vehicle_day') {
      const body = {
        ...base,
        mode: fMode,
        perVehicleDayAmount: amount,
        ...(editingFixed ? { revision: editingFixed.revision } : {}),
      };
      saveFixedMutation.mutate({
        id: editingFixed?.id,
        body: { ...body, requestId: intentId.current({ id: editingFixed?.id, ...body }) },
      });
    } else saveFixedMutation.mutate({ id: editingFixed?.id, body: { ...base, monthlyAmount: amount } });
  }, [fName, fAmount, fCategory, fActive, fMode, editingFixed, saveFixedMutation]);

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
  const staff = useMemo(
    () =>
      (users ?? [])
        .filter((u) => u.role !== UserRole.SUPERADMIN)
        .slice()
        .sort((a, b) => {
          const aUnassigned = a.directionId == null;
          const bUnassigned = b.directionId == null;
          if (aUnassigned !== bUnassigned) return aUnassigned ? 1 : -1;
          const group = (a.directionName?.trim() || '\uffff').localeCompare(b.directionName?.trim() || '\uffff', 'ru');
          if (group !== 0) return group;
          const groupId = (a.directionId ?? '').localeCompare(b.directionId ?? '');
          if (groupId !== 0) return groupId;
          return (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.fullName.localeCompare(b.fullName, 'ru');
        }),
    [users],
  );
  const staffGroups = useMemo(() => {
    const groups = new Map<string | null, { id: string | null; label: string; users: User[] }>();
    staff.forEach((employee) => {
      const id = employee.directionId ?? null;
      const label = id === null ? 'Без направления' : employee.directionName?.trim() || 'Без названия';
      const group = groups.get(id) ?? { id, label, users: [] };
      group.users.push(employee);
      groups.set(id, group);
    });
    return [...groups.values()].sort((a, b) => {
      if (a.id === null) return b.id === null ? 0 : 1;
      if (b.id === null) return -1;
      return a.label.localeCompare(b.label, 'ru') || a.id.localeCompare(b.id);
    });
  }, [staff]);

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
        <IosScreenHeader scroll={deniedSection} title="Постоянные расходы" onBack={() => navigation.goBack()} />
        <ScreenSectionScrollView
          style={{ flex: 1 }}
          onScroll={deniedSection.onScroll}
          scrollEventThrottle={16}
          contentInsetAdjustmentBehavior="never"
          reserveSafeAreaBottom
          contentContainerStyle={{ flexGrow: 1, paddingTop: deniedSection.contentTop + 12, paddingBottom: 24 }}
        >
          <View style={styles.restricted}>
            <Ionicons name="lock-closed-outline" size={40} color={palette.text.tertiary} />
            <Text style={[styles.restrictedText, { color: palette.text.secondary }]}>
              Планирование постоянных расходов и мотивации доступно сотрудникам с правом «Финансовые отчёты».
            </Text>
          </View>
        </ScreenSectionScrollView>
      </View>
    );
  }

  const cardBase = [styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }, shadow];

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader
        trailing={
          <HeaderAction label="Добавить расход" title="Добавить" icon="add" tone="primary" onPress={openFixedCreate} />
        }
        context={<PointIndicator variant="chip" style={styles.pointChipRow} />}
        scroll={section}
        title="Постоянные расходы"
        subtitle="Для расчёта чистой прибыли"
        onBack={() => navigation.goBack()}
      />

      {/* Автосервис плана (167): постоянка — на каждый филиал своя, и владелец
          обязан видеть, чей план перед ним. Только подпись: филиал выбран
          при входе / в разделе «Филиалы». */}

      {fixedError && fixedCosts === undefined ? (
        <ScreenSectionScrollView
          style={{ flex: 1 }}
          onScroll={section.onScroll}
          scrollEventThrottle={16}
          contentInsetAdjustmentBehavior="never"
          reserveSafeAreaBottom
          contentContainerStyle={{ flexGrow: 1, paddingTop: section.contentTop + 12, paddingBottom: 24 }}
        >
          <QueryErrorState description="Проверьте соединение и попробуйте ещё раз" onRetry={() => refetchFixed()} />
        </ScreenSectionScrollView>
      ) : fixedCosts === undefined ? (
        <ScreenSectionScrollView
          style={{ flex: 1 }}
          onScroll={section.onScroll}
          scrollEventThrottle={16}
          contentInsetAdjustmentBehavior="never"
          reserveSafeAreaBottom
          contentContainerStyle={{ flexGrow: 1, paddingTop: section.contentTop + 12, paddingBottom: 24 }}
        >
          <LoadingSpinner />
        </ScreenSectionScrollView>
      ) : (
        <ScreenSectionScrollView
          onScroll={section.onScroll}
          scrollEventThrottle={16}
          contentInsetAdjustmentBehavior="never"
          style={{ flex: 1 }}
          reserveSafeAreaBottom
          contentContainerStyle={[
            {
              paddingHorizontal: spacing[4],
              paddingTop: spacing[3],
              paddingBottom: tabBarHeight + spacing[6],
              gap: spacing[4],
            },
            { paddingTop: section.contentTop + spacing[3] },
          ]}
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
              Ежемесячные суммы распределяются по дням месяца. Расходы за автомобиль считаются отдельно, по фактическим
              визитам.
            </Text>
          </View>

          {/* ── Постоянные расходы ──────────────────────────────────────── */}
          <View>
            <View style={styles.sectionHead}>
              <Text style={[iosSectionLabel, styles.sectionLabel, { color: palette.text.secondary }]}>
                Постоянные расходы
              </Text>
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
                        {isVehicleCost(c) && (
                          <Text style={{ color: palette.text.tertiary, fontSize: 11, marginTop: 3 }}>
                            Сегодня: {costStatus(c)}
                          </Text>
                        )}
                        {c.pending && (
                          <Text style={{ color: palette.accent.primaryText, fontSize: 11, marginTop: 3 }}>
                            С {c.pending.effectiveFrom}: {costStatus(c.pending)} ·{' '}
                            {formatMoney(c.pending.perVehicleDayAmount, 2)} / авто в день
                          </Text>
                        )}
                      </View>
                      <View style={styles.fixedAmountCol}>
                        <Text style={[styles.fixedAmount, { color: palette.text.primary }]} numberOfLines={1}>
                          {formatMoney(costRate(c), 2)}
                        </Text>
                        <Text style={[styles.fixedPerMonth, { color: palette.text.tertiary }]}>
                          {isVehicleCost(c) ? '/ авто в день' : '/ мес'}
                        </Text>
                      </View>
                      <Switch
                        value={plannedCostState(c).active && !plannedCostState(c).archived}
                        accessibilityLabel={`Учитывать расход ${c.name}${isVehicleCost(c) ? ' с завтра' : ''}`}
                        disabled={toggleFixedMutation.isPending || deleteFixedMutation.isPending}
                        onValueChange={(v) => {
                          if (fixedBusy.current) return;
                          fixedBusy.current = true;
                          haptic('select');
                          toggleFixedMutation.mutate({ cost: c, active: v });
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
                {staffGroups.map((group) => (
                  <View key={JSON.stringify([group.id === null, group.id])}>
                    <View
                      style={{
                        paddingHorizontal: spacing[4],
                        paddingVertical: spacing[2],
                        backgroundColor: palette.bg.muted,
                        borderBottomWidth: StyleSheet.hairlineWidth,
                        borderBottomColor: palette.border.subtle,
                      }}
                    >
                      <Text
                        style={{
                          color: palette.text.tertiary,
                          fontSize: fontSize.xs,
                          fontWeight: fontWeight.bold,
                          letterSpacing: 0.6,
                          textTransform: 'uppercase',
                        }}
                      >
                        {group.label}
                      </Text>
                    </View>
                    {group.users.map((u, idx) => {
                      const comp = compByUser.get(u.id);
                      return (
                        <TouchableOpacity
                          key={u.id}
                          style={[
                            styles.compRow,
                            idx < group.users.length - 1 && {
                              borderBottomWidth: StyleSheet.hairlineWidth,
                              borderBottomColor: palette.border.subtle,
                            },
                          ]}
                          activeOpacity={0.65}
                          onPress={() => openComp(u)}
                        >
                          <EmployeeAvatar
                            userId={u.id}
                            avatar={u.avatar}
                            style={[styles.compAvatar, { backgroundColor: palette.accent.primarySoft }]}
                            imageStyle={styles.compAvatar}
                          >
                            <Text style={[styles.compAvatarText, { color: palette.accent.primaryText }]}>
                              {initials(u.fullName)}
                            </Text>
                          </EmployeeAvatar>
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
                ))}
              </View>
            )}
          </View>
        </ScreenSectionScrollView>
      )}

      {/* ── Модалка постоянного расхода ──────────────────────────────────── */}
      <Modal
        visible={fixedModalOpen}
        onClose={() => {
          if (!fixedBusy.current) setFixedModalOpen(false);
        }}
        title={editingFixed ? 'Постоянный расход' : 'Новый постоянный расход'}
      >
        {fixedMessage ? (
          <Text accessibilityRole="alert" style={{ color: colors.red[600], marginBottom: spacing[3] }}>
            {fixedMessage}
          </Text>
        ) : null}
        {editingFixed ? (
          <Text style={{ color: palette.text.secondary, marginBottom: spacing[3] }}>
            Расчёт: {fMode === 'per_vehicle_day' ? '₽ за автомобиль в день' : '₽ в месяц'}. Единица не меняется.
          </Text>
        ) : (
          <View accessibilityRole="radiogroup" style={[styles.chipRow, { marginBottom: spacing[3] }]}>
            {(['monthly', 'per_vehicle_day'] as const).map((mode) => (
              <TouchableOpacity
                key={mode}
                accessibilityRole="radio"
                accessibilityState={{ checked: mode === fMode }}
                onPress={() => setFMode(mode)}
                style={[
                  styles.catChip,
                  {
                    minHeight: 44,
                    backgroundColor: mode === fMode ? palette.accent.primarySoft : palette.bg.muted,
                    borderColor: palette.border.subtle,
                  },
                ]}
              >
                <Text style={{ color: palette.text.primary }}>{mode === 'monthly' ? 'В месяц' : 'За авто в день'}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
        {fMode === 'per_vehicle_day' && (
          <View style={{ gap: spacing[2], marginBottom: spacing[3] }}>
            <Text style={{ color: palette.text.secondary }}>{vehicleCostHint}</Text>
            <Text style={{ color: palette.text.tertiary }}>
              {editingFixed
                ? 'Изменения, пауза и архив — с завтрашнего дня автосервиса.'
                : 'Учитывается с сегодняшнего дня. Списание в кассе не создаётся.'}
            </Text>
            {editingFixed && (
              <Text style={{ color: palette.text.tertiary }}>
                Сейчас: {formatMoney(costRate(editingFixed), 2)} / авто в день · {costStatus(editingFixed)}
                {editingFixed.pending ? `; изменения с ${editingFixed.pending.effectiveFrom}` : ''}
              </Text>
            )}
          </View>
        )}
        <Text style={[styles.formLabel, { color: palette.text.secondary }]}>Название</Text>
        <TextInput
          accessibilityLabel="Название расхода"
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

        <Text style={[styles.formLabel, { color: palette.text.secondary, marginTop: spacing[4] }]}>
          {fMode === 'per_vehicle_day' ? 'За автомобиль в день' : 'Сумма в месяц'}
        </Text>
        <View style={[styles.amountWrap, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}>
          <TextInput
            value={fAmount}
            onChangeText={setFAmount}
            placeholder="0"
            placeholderTextColor={palette.text.tertiary}
            keyboardType="decimal-pad"
            accessibilityLabel={fMode === 'per_vehicle_day' ? 'Сумма за автомобиль в день' : 'Сумма в месяц'}
            style={[styles.amountInput, { color: palette.text.primary }]}
          />
          <Text style={[styles.amountUnit, { color: palette.text.tertiary }]}>
            {fMode === 'per_vehicle_day' ? '₽ / авто в день' : '₽ / мес'}
          </Text>
        </View>

        <View style={[styles.switchRow, { borderTopColor: palette.border.subtle }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.switchLabel, { color: palette.text.primary }]}>Учитывать в прибыли</Text>
            <Text style={[styles.switchHint, { color: palette.text.tertiary }]} numberOfLines={1}>
              {fMode === 'per_vehicle_day'
                ? editingFixed
                  ? 'Планируемый статус с завтра'
                  : 'Учитывается с сегодняшнего дня'
                : fActive
                  ? 'Активен — амортизируется по дням'
                  : 'На паузе — не влияет на прибыль'}
            </Text>
          </View>
          <Switch
            accessibilityLabel="Учитывать расход в прибыли"
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
            onPress={() => {
              if (fixedBusy.current) return;
              Alert.alert(
                isVehicleCost(editingFixed) ? 'Архивировать расход?' : 'Удалить расход?',
                isVehicleCost(editingFixed)
                  ? 'Архив с завтрашнего дня автосервиса. Сегодня расход ещё учитывается; история сохранится.'
                  : 'Постоянный расход перестанет учитываться в прибыли. Это действие необратимо.',
                [
                  { text: 'Отмена', style: 'cancel' },
                  {
                    text: isVehicleCost(editingFixed) ? 'В архив' : 'Удалить',
                    style: 'destructive',
                    onPress: () => {
                      if (fixedBusy.current) return;
                      fixedBusy.current = true;
                      deleteFixedMutation.mutate(editingFixed);
                    },
                  },
                ],
              );
            }}
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
  pointChipRow: { marginHorizontal: spacing[4], marginBottom: spacing[2], alignSelf: 'flex-start' },
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
