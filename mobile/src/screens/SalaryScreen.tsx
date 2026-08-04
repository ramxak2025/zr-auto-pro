/**
 * SalaryScreen — the «Зарплата» entry point. Branches by role:
 *
 *   • «Владелец» (director / superadmin) — sees the per-employee FOT list for
 *     the selected month. Tapping a row opens the full-screen
 *     <SalaryEmployeeScreen> (NOT a popup) where they can page months, read the
 *     full breakdown, issue payouts and fines, and award premiums.
 *
 *   • «Сотрудник» (admin / master) — sees ONLY their own salary as the same
 *     full-screen <SalaryEmployeeCard> (no employee list, no owner actions).
 *
 * The owner's row design (avatar | name + percent | amount | status pill +
 * chip stats) is unchanged from the previous iteration; only the tap target
 * moved from a bottom-sheet to a pushed screen.
 */
import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  Platform,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import IosScreenHeader from '../components/IosScreenHeader';
import LoadingSpinner from '../components/LoadingSpinner';
import Modal from '../components/Modal';
import QueryErrorState from '../components/QueryErrorState';
import SalaryEmployeeCard, { PayoutForm } from '../components/salary/SalaryEmployeeCard';
import { salaryApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import { useColors } from '../contexts/ThemeContext';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { Text } from '../platform/Typography';
import { haptic } from '../platform/haptics';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import type { SemanticPalette } from '../theme/palette';
import type { MasterSalary, SalaryMonthDetail } from '../../../shared/types';
import {
  formatMoney,
  formatMoneyShort,
  getInitials,
  getAvatarColors,
  monthLabelShort,
  monthLabelFull,
  formatMonthKey,
  monthBounds,
  addMonths,
} from '../components/salary/salaryFormat';

// ── Row status ─────────────────────────────────────────────────────────────

type RowStatus = 'paid' | 'advance' | 'pending' | 'empty';

function rowStatus(m: MasterSalary): RowStatus {
  if (m.totalEarnings <= 0 && m.paidAmount <= 0) return 'empty';
  if (m.remainingAmount <= 0.5) return 'paid';
  if (m.paidAmount > 0 && m.remainingAmount > 0.5) return 'advance';
  return 'pending';
}

function statusLabel(s: RowStatus): string {
  switch (s) {
    case 'paid':
      return 'Выплачено';
    case 'advance':
      return 'Аванс выдан';
    case 'empty':
      return 'Нет начислений';
    case 'pending':
    default:
      return 'К выплате';
  }
}

function statusColors(s: RowStatus, palette: SemanticPalette): { bg: string; text: string } {
  switch (s) {
    case 'paid':
      return { bg: palette.mode === 'dark' ? 'rgba(34,197,94,0.18)' : colors.green[50], text: colors.green[700] };
    case 'advance':
      return { bg: palette.mode === 'dark' ? 'rgba(245,158,11,0.18)' : colors.amber[50], text: colors.amber[700] };
    case 'empty':
      return { bg: palette.bg.muted, text: palette.text.tertiary };
    case 'pending':
    default:
      return { bg: palette.mode === 'dark' ? 'rgba(59,130,246,0.18)' : colors.primary[50], text: colors.primary[700] };
  }
}

/** Русское склонение слова «смена» для счётчика отработанных смен. */
function shiftsWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'смена';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'смены';
  return 'смен';
}

// ── Employee row (compact) ─────────────────────────────────────────────────

interface EmployeeRowProps {
  master: MasterSalary;
  palette: SemanticPalette;
  onOpen: (m: MasterSalary) => void;
  /**
   * Round 16 #1(б) — быстрое «Выдать» прямо из списка (без захода в карточку).
   * Передаётся только держателю salary_payouts_manage; кнопка видна, когда
   * по сотруднику реально есть «К выплате».
   */
  onIssue?: (m: MasterSalary) => void;
}

const EmployeeRow = React.memo(function EmployeeRow({ master, palette, onOpen, onIssue }: EmployeeRowProps) {
  const avatar = getAvatarColors(master.masterName);
  const initials = getInitials(master.masterName);
  const status = rowStatus(master);
  const statusC = statusColors(status, palette);

  const headlineAmount = status === 'paid' ? master.paidAmount : master.remainingAmount;
  const headlineColor =
    status === 'paid' ? colors.green[600] : status === 'pending' ? palette.text.primary : colors.amber[600];

  const services = master.serviceEarnings || 0;
  const products = master.productEarnings || 0;
  const premiums = master.premiumsAmount || 0;
  const motivation = master.motivationAmount || 0;
  const checks = master.checkCount || 0;
  // v3.0.1 ФИЧА 4 — «в среднем за смену»: perDay = totalEarnings ÷ workedShifts
  // (сервер округляет; null при 0 смен, тогда строку не показываем). Смены
  // считаются по настройкам расписания тенанта.
  const workedShifts = master.workedShifts || 0;
  const perDay = master.perDay;
  const hasPerDay = perDay != null && workedShifts > 0;

  return (
    <TouchableOpacity
      activeOpacity={0.72}
      onPress={() => {
        haptic('tap');
        onOpen(master);
      }}
      style={[styles.row, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
    >
      <View style={styles.rowTopLine}>
        <LinearGradient colors={avatar} style={styles.rowAvatar} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
          <Text style={styles.rowAvatarText}>{initials}</Text>
        </LinearGradient>

        <View style={styles.rowNameCol}>
          <Text style={[styles.rowName, { color: palette.text.primary }]} numberOfLines={1}>
            {master.masterName}
          </Text>
          <View style={styles.rowSubRow}>
            <View style={[styles.rowPercentBadge, { backgroundColor: palette.accent.primarySoft }]}>
              <Text style={[styles.rowPercentText, { color: palette.accent.primaryText }]}>
                {master.salaryPercent}%
              </Text>
            </View>
            {master.productSalaryPercent ? (
              <View style={[styles.rowPercentBadge, { backgroundColor: palette.bg.muted }]}>
                <Ionicons name="cube-outline" size={9} color={palette.text.tertiary} />
                <Text style={[styles.rowPercentText, { color: palette.text.secondary }]}>
                  {master.productSalaryPercent}%
                </Text>
              </View>
            ) : null}
            <View style={[styles.rowStatusPill, { backgroundColor: statusC.bg }]}>
              <Text style={[styles.rowStatusText, { color: statusC.text }]}>{statusLabel(status)}</Text>
            </View>
          </View>
        </View>

        <View style={styles.rowAmountCol}>
          <Text style={[styles.rowAmount, { color: headlineColor }]} numberOfLines={1}>
            {formatMoney(headlineAmount)}
          </Text>
          <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} style={{ marginTop: 2 }} />
        </View>
      </View>

      {hasPerDay ? (
        <View style={styles.rowPerDayLine}>
          <View style={[styles.rowPerDayPill, { backgroundColor: palette.bg.muted }]}>
            <Ionicons name="calendar-outline" size={11} color={palette.text.tertiary} />
            <Text style={[styles.rowPerDayShifts, { color: palette.text.secondary }]}>
              {workedShifts} {shiftsWord(workedShifts)}
            </Text>
          </View>
          <Text style={[styles.rowPerDayValue, { color: palette.text.primary }]} numberOfLines={1}>
            ≈ {formatMoney(perDay as number)}
          </Text>
          <Text style={[styles.rowPerDayCaption, { color: palette.text.tertiary }]}>в среднем за смену</Text>
        </View>
      ) : null}

      {checks + services + products + premiums + motivation > 0 ? (
        <View style={styles.rowChipsLine}>
          <Text style={[styles.rowChipsText, { color: palette.text.secondary }]} numberOfLines={1}>
            <Text style={{ color: palette.text.primary, fontWeight: fontWeight.semibold }}>{checks}</Text> чеков
            {services ? (
              <>
                {'  ·  '}
                <Text style={{ color: palette.text.primary, fontWeight: fontWeight.semibold }}>
                  {formatMoneyShort(services)}
                </Text>{' '}
                услуги
              </>
            ) : null}
            {products ? (
              <>
                {'  ·  '}
                <Text style={{ color: palette.text.primary, fontWeight: fontWeight.semibold }}>
                  {formatMoneyShort(products)}
                </Text>{' '}
                товары
              </>
            ) : null}
            {premiums ? (
              <>
                {'  ·  '}
                <Text style={{ color: colors.amber[600], fontWeight: fontWeight.semibold }}>
                  {formatMoneyShort(premiums)}
                </Text>{' '}
                премии
              </>
            ) : null}
            {motivation ? (
              <>
                {'  ·  '}
                <Text style={{ color: colors.green[600], fontWeight: fontWeight.semibold }}>
                  {formatMoneyShort(motivation)}
                </Text>{' '}
                мотивация
              </>
            ) : null}
          </Text>
        </View>
      ) : null}

      {/* Round 16 #1(б) — «Выдать · N ₽» одним тапом из списка: открывает ту же
          PayoutForm с предзаполненной суммой «К выплате», без захода в карточку.
          Вложенный TouchableOpacity перехватывает тап у строки (паттерн
          clearXBadge в CashFlowScreen). */}
      {onIssue && master.remainingAmount > 0.5 ? (
        <TouchableOpacity
          style={[
            styles.rowIssueBtn,
            { backgroundColor: palette.mode === 'dark' ? 'rgba(34,197,94,0.16)' : colors.green[50] },
          ]}
          activeOpacity={0.75}
          onPress={() => {
            haptic('tap');
            onIssue(master);
          }}
          accessibilityRole="button"
          accessibilityLabel={`Выдать зарплату — ${master.masterName}, к выплате ${formatMoney(master.remainingAmount)}`}
        >
          <Ionicons name="paper-plane-outline" size={14} color={colors.green[700]} />
          <Text style={styles.rowIssueBtnText}>Выдать · {formatMoney(master.remainingAmount)}</Text>
        </TouchableOpacity>
      ) : null}
    </TouchableOpacity>
  );
});

function ListSeparator() {
  return <View style={{ height: spacing[2.5] }} />;
}

// ── Main screen ────────────────────────────────────────────────────────────

export default function SalaryScreen() {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const { hasPermission, user } = useAuth();
  const palette = useColors();
  const tabBarHeight = useTabBarHeight();

  // Список зарплат всей команды — ключ salary_view_all (сервер: GET /salary →
  // тот же ключ; «права как в Битрикс24», 2026-07: admin живёт по матрице из
  // /auth/me — сид salary.view='all' даёт ему командный список, как и API;
  // superadmin/director байпасятся внутри hasPermission).
  const isOwner = hasPermission('salary_view_all');

  // ── Employee self-view ─────────────────────────────────────────────────────
  // Без salary_view_all открывший «Зарплату» видит свою full-screen карту — no
  // list, no owner actions. Rendered from the SAME component the owner's
  // drill-down uses, so the two views can't drift.
  if (!isOwner) {
    if (!user) return <LoadingSpinner />;
    return (
      <SalaryEmployeeCard
        employeeId={user.id}
        employeeName={user.fullName}
        title="Моя зарплата"
        canManagePayouts={false}
        canManagePremiums={false}
        onBack={() => navigation.goBack()}
      />
    );
  }

  return (
    <OwnerSalaryList
      navigation={navigation}
      queryClient={queryClient}
      palette={palette}
      tabBarHeight={tabBarHeight}
      // salary_payouts_manage гейтит и «Выплату вне программы» (149), и быструю
      // выдачу из списка (Round 16 #1б) — это один и тот же серверный ключ.
      canManagePayouts={hasPermission('salary_payouts_manage')}
    />
  );
}

// ── Owner list (extracted so the hooks below never run for the employee
//    self-view early-return above) ─────────────────────────────────────────

interface OwnerSalaryListProps {
  navigation: any;
  queryClient: ReturnType<typeof useQueryClient>;
  palette: SemanticPalette;
  tabBarHeight: number;
  /** salary_payouts_manage: выплаты сотрудникам (быстрая выдача из списка) и
   *  «Выплата вне программы» — один серверный ключ. */
  canManagePayouts: boolean;
}

function OwnerSalaryList({ navigation, queryClient, palette, tabBarHeight, canManagePayouts }: OwnerSalaryListProps) {
  const [selectedMonth, setSelectedMonth] = useState<Date>(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );
  const { dateFrom, dateTo } = monthBounds(selectedMonth);
  const monthYear = formatMonthKey(selectedMonth);

  const [refreshing, setRefreshing] = useState(false);

  // ── 149 — «Выплата вне программы» (маркетолог, уборщица — не в users) ──────
  const [outsideOpen, setOutsideOpen] = useState(false);
  const [outsideName, setOutsideName] = useState('');
  const [outsideAmount, setOutsideAmount] = useState('');
  const [outsideComment, setOutsideComment] = useState('');
  const [outsideMonth, setOutsideMonth] = useState<Date>(() => new Date());

  const outsideMutation = useMutation({
    mutationFn: (vars: { recipientName: string; amount: number; periodMonth: string; comment?: string }) =>
      salaryApi.createOutsidePayout(vars),
    onSuccess: () => {
      haptic('success');
      setOutsideOpen(false);
      setOutsideName('');
      setOutsideAmount('');
      setOutsideComment('');
      // Расход появился в «Расходах» и двинул прибыль назначенного месяца.
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-v2'] });
      Alert.alert('Записано', 'Выплата записана в «Расходы» и отнесена к выбранному месяцу');
    },
    onError: (err: any) => {
      haptic('error');
      const msg = err?.response?.data?.message || 'Не удалось записать выплату';
      Alert.alert('Ошибка', String(Array.isArray(msg) ? msg.join('\n') : msg));
    },
  });

  const openOutside = useCallback(() => {
    haptic('tap');
    // Дефолт месяца — открытый в списке месяц (владелец обычно закрывает его).
    setOutsideMonth(new Date(selectedMonth.getFullYear(), selectedMonth.getMonth(), 1));
    setOutsideOpen(true);
  }, [selectedMonth]);

  const submitOutside = useCallback(() => {
    const amt = parseFloat(outsideAmount.replace(',', '.'));
    if (!outsideName.trim()) {
      Alert.alert('Ошибка', 'Укажите получателя');
      return;
    }
    if (!amt || amt <= 0) {
      Alert.alert('Ошибка', 'Укажите сумму');
      return;
    }
    outsideMutation.mutate({
      recipientName: outsideName.trim(),
      amount: amt,
      periodMonth: formatMonthKey(outsideMonth),
      comment: outsideComment.trim() || undefined,
    });
  }, [outsideAmount, outsideName, outsideComment, outsideMonth, outsideMutation]);

  const {
    data: salaries,
    isLoading,
    isError,
    refetch,
  } = useQuery<MasterSalary[]>({
    queryKey: ['salary', dateFrom, dateTo],
    queryFn: async () => {
      const res = await salaryApi.getAll({ dateFrom, dateTo });
      return Array.isArray(res.data) ? res.data : [];
    },
    placeholderData: (prev) => prev,
  });

  // ── Round 16 #1(б) — быстрая выдача из списка ──────────────────────────────
  // Кнопка «Выдать · N ₽» на строке открывает ту же PayoutForm, что и карточка
  // сотрудника; periodMonth = открытый в списке месяц (та же привязка, что и в
  // глубоком флоу). Подтверждение сотрудником не меняется — выплата уходит в
  // pending, сотрудник принимает через SalaryReceivedModal.
  const [payoutTarget, setPayoutTarget] = useState<MasterSalary | null>(null);

  // Месячная деталь цели — чтобы предупредить о ещё не принятых (pending)
  // выплатах: из списка их не видно, а из карточки видно. Ключ и форма данных
  // совпадают с карточкой сотрудника → кэш общий, открывается мгновенно.
  const { data: targetDetail } = useQuery<SalaryMonthDetail>({
    queryKey: ['salary-employee-month', payoutTarget?.masterId ?? 'none', monthYear],
    queryFn: async () => (await salaryApi.getEmployeeMonth(payoutTarget!.masterId, monthYear)).data,
    enabled: payoutTarget !== null,
  });

  // Оборона от глобального placeholderData (prev => prev): при смене цели
  // временно виден ответ ПРОШЛОГО сотрудника — сверяем userId/month из самого
  // ответа и прячем предупреждение, пока данные не про эту цель.
  const pendingForTarget = useMemo(() => {
    if (!payoutTarget || !targetDetail) return 0;
    if (targetDetail.userId !== payoutTarget.masterId || targetDetail.month !== monthYear) return 0;
    const payouts = Array.isArray(targetDetail.payouts) ? targetDetail.payouts : [];
    return payouts.filter((p) => p.status === 'pending').reduce((sum, p) => sum + (p.amount || 0), 0);
  }, [payoutTarget, targetDetail, monthYear]);

  const quickPayoutMutation = useMutation({
    mutationFn: (vars: { employeeId: string; type: 'salary' | 'advance'; amount: number; comment?: string }) =>
      salaryApi.createPayout({
        employeeId: vars.employeeId,
        type: vars.type,
        amount: vars.amount,
        comment: vars.comment,
        periodMonth: monthYear,
      }),
    onSuccess: () => {
      haptic('success');
      setPayoutTarget(null);
      // Тот же набор инвалидаций, что у карточки сотрудника: список + все
      // месячные детали (выплата видна и там, и там).
      queryClient.invalidateQueries({ queryKey: ['salary'] });
      queryClient.invalidateQueries({ queryKey: ['salary-employee-month'] });
    },
    onError: (err: any) => {
      haptic('error');
      const msg = err?.response?.data?.message || 'Не удалось создать выплату';
      Alert.alert('Ошибка', String(Array.isArray(msg) ? msg.join('\n') : msg));
    },
  });

  const openQuickIssue = useCallback((m: MasterSalary) => {
    setPayoutTarget(m);
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['salary'] });
    setRefreshing(false);
  }, [queryClient]);

  const openEmployee = useCallback(
    (m: MasterSalary) => {
      navigation.navigate('SalaryEmployee', {
        employeeId: m.masterId,
        employeeName: m.masterName,
        month: monthYear,
      });
    },
    [navigation, monthYear],
  );

  const totals = useMemo(() => {
    const rows = Array.isArray(salaries) ? salaries : [];
    let earnings = 0;
    let paid = 0;
    let remaining = 0;
    for (const r of rows) {
      earnings += r.totalEarnings || 0;
      paid += r.paidAmount || 0;
      remaining += r.remainingAmount || 0;
    }
    return { earnings, paid, remaining };
  }, [salaries]);

  const prevMonth = useCallback(() => {
    haptic('select');
    setSelectedMonth((d) => addMonths(d, -1));
  }, []);
  const nextMonth = useCallback(() => {
    haptic('select');
    setSelectedMonth((d) => addMonths(d, 1));
  }, []);
  const resetMonth = useCallback(() => {
    haptic('tap');
    setSelectedMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  }, []);

  const trailingMonthChip = (
    <View style={[styles.monthChip, { backgroundColor: palette.bg.muted }]}>
      <TouchableOpacity onPress={prevMonth} hitSlop={6} style={styles.monthChipBtn}>
        <Ionicons name="chevron-back" size={16} color={palette.text.secondary} />
      </TouchableOpacity>
      <TouchableOpacity onPress={resetMonth} activeOpacity={0.7}>
        <Text style={[styles.monthChipLabel, { color: palette.text.primary }]}>{monthLabelShort(selectedMonth)}</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={nextMonth} hitSlop={6} style={styles.monthChipBtn}>
        <Ionicons name="chevron-forward" size={16} color={palette.text.secondary} />
      </TouchableOpacity>
    </View>
  );

  const renderItem = useCallback(
    ({ item }: { item: MasterSalary }) => (
      <EmployeeRow
        master={item}
        palette={palette}
        onOpen={openEmployee}
        onIssue={canManagePayouts ? openQuickIssue : undefined}
      />
    ),
    [palette, openEmployee, canManagePayouts, openQuickIssue],
  );
  const keyExtractor = useCallback((item: MasterSalary) => item.masterId, []);

  const summaryHeader = (
    <View>
      <View style={[styles.summaryCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
        <View style={styles.summaryRow}>
          <View style={styles.summaryCell}>
            <Text style={[styles.summaryCellLabel, { color: palette.text.tertiary }]}>ФОТ месяца</Text>
            <Text
              style={[styles.summaryCellValue, { color: palette.text.primary }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.75}
            >
              {formatMoney(totals.earnings)}
            </Text>
          </View>
          <View style={[styles.summaryDivider, { backgroundColor: palette.border.subtle }]} />
          <View style={styles.summaryCell}>
            <Text style={[styles.summaryCellLabel, { color: palette.text.tertiary }]}>Выплачено</Text>
            <Text
              style={[styles.summaryCellValue, { color: colors.green[600] }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.75}
            >
              {formatMoney(totals.paid)}
            </Text>
          </View>
          <View style={[styles.summaryDivider, { backgroundColor: palette.border.subtle }]} />
          <View style={styles.summaryCell}>
            <Text style={[styles.summaryCellLabel, { color: palette.text.tertiary }]}>К выплате</Text>
            <Text
              style={[
                styles.summaryCellValue,
                { color: totals.remaining > 0.5 ? colors.amber[700] : palette.text.secondary },
              ]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.75}
            >
              {formatMoney(totals.remaining)}
            </Text>
          </View>
        </View>
      </View>

      {/* 149 — «Выплата вне программы»: получатель без аккаунта (маркетолог,
          уборщица) — расход выбранного месяца. Гейт salary_payouts_manage. */}
      {canManagePayouts ? (
        <TouchableOpacity
          style={[styles.outsideBtn, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
          activeOpacity={0.72}
          onPress={openOutside}
        >
          <View style={[styles.outsideBtnIcon, { backgroundColor: palette.bg.muted }]}>
            <Ionicons name="person-add-outline" size={16} color={palette.text.secondary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.outsideBtnTitle, { color: palette.text.primary }]}>Выплата вне программы</Text>
            <Text style={[styles.outsideBtnSubtitle, { color: palette.text.tertiary }]}>
              Маркетолог, уборщица — получатель без аккаунта
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} />
        </TouchableOpacity>
      ) : null}
    </View>
  );

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title="Зарплата" onBack={() => navigation.goBack()} trailing={trailingMonthChip} />

      {isError && salaries === undefined ? (
        <QueryErrorState description="Проверьте соединение и попробуйте ещё раз" onRetry={() => refetch()} />
      ) : salaries === undefined ? (
        <LoadingSpinner />
      ) : salaries.length === 0 && !isLoading ? (
        <ScrollView
          contentContainerStyle={[styles.emptyWrap, { paddingBottom: tabBarHeight + spacing[6] }]}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.accent.primary} />
          }
          showsVerticalScrollIndicator={false}
          contentInset={Platform.OS === 'ios' ? { bottom: tabBarHeight } : undefined}
        >
          {summaryHeader}
          <View style={[styles.emptyIcon, { backgroundColor: palette.bg.muted, marginTop: spacing[8] }]}>
            <Ionicons name="wallet-outline" size={36} color={palette.text.tertiary} />
          </View>
          <Text style={[styles.emptyTitle, { color: palette.text.secondary }]}>Нет данных за этот месяц</Text>
          <Text style={[styles.emptySubtitle, { color: palette.text.tertiary }]}>
            Зарплата рассчитывается на основе закрытых чеков
          </Text>
        </ScrollView>
      ) : (
        <FlashList
          data={salaries}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          ListHeaderComponent={summaryHeader}
          contentContainerStyle={{
            paddingHorizontal: spacing[4],
            paddingTop: spacing[3],
            paddingBottom: tabBarHeight + spacing[6],
          }}
          ItemSeparatorComponent={ListSeparator}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.accent.primary} />
          }
          showsVerticalScrollIndicator={false}
          contentInset={Platform.OS === 'ios' ? { bottom: tabBarHeight } : undefined}
        />
      )}

      {/* 149 — шит «Выплата вне программы»: получатель, сумма, месяц, комментарий. */}
      <Modal visible={outsideOpen} onClose={() => setOutsideOpen(false)} title="Выплата вне программы">
        <View style={styles.formField}>
          <Text style={[styles.formLabel, { color: palette.text.secondary }]}>Получатель *</Text>
          <TextInput
            value={outsideName}
            onChangeText={setOutsideName}
            style={[
              styles.formInput,
              { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary },
            ]}
            placeholder="Например: Маркетолог Ирина"
            placeholderTextColor={palette.text.tertiary}
          />
        </View>
        <View style={styles.formField}>
          <Text style={[styles.formLabel, { color: palette.text.secondary }]}>Сумма *</Text>
          <TextInput
            value={outsideAmount}
            onChangeText={setOutsideAmount}
            style={[
              styles.formInput,
              { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary },
            ]}
            keyboardType="numeric"
            placeholder="0"
            placeholderTextColor={palette.text.tertiary}
          />
        </View>
        <View style={styles.formField}>
          <Text style={[styles.formLabel, { color: palette.text.secondary }]}>За месяц</Text>
          <View
            style={[styles.formMonthRow, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
          >
            <TouchableOpacity
              style={styles.formMonthBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              onPress={() => {
                haptic('select');
                setOutsideMonth((m) => addMonths(m, -1));
              }}
            >
              <Ionicons name="chevron-back" size={18} color={palette.text.secondary} />
            </TouchableOpacity>
            <Text style={[styles.formMonthLabel, { color: palette.text.primary }]}>{monthLabelFull(outsideMonth)}</Text>
            <TouchableOpacity
              style={styles.formMonthBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              onPress={() => {
                haptic('select');
                setOutsideMonth((m) => addMonths(m, 1));
              }}
            >
              <Ionicons name="chevron-forward" size={18} color={palette.text.secondary} />
            </TouchableOpacity>
          </View>
          <Text style={[styles.formHint, { color: palette.text.tertiary }]}>
            Сумма уменьшит прибыль выбранного месяца; в кассе — сегодняшней датой
          </Text>
        </View>
        <View style={styles.formField}>
          <Text style={[styles.formLabel, { color: palette.text.secondary }]}>Комментарий</Text>
          <TextInput
            value={outsideComment}
            onChangeText={setOutsideComment}
            style={[
              styles.formInput,
              {
                backgroundColor: palette.bg.muted,
                borderColor: palette.border.subtle,
                color: palette.text.primary,
                height: 50,
                textAlignVertical: 'top',
              },
            ]}
            multiline
            placeholder="Необязательно"
            placeholderTextColor={palette.text.tertiary}
          />
        </View>
        <TouchableOpacity
          style={[styles.formSubmit, { backgroundColor: palette.accent.primary }]}
          onPress={submitOutside}
          disabled={outsideMutation.isPending}
        >
          {outsideMutation.isPending ? (
            <ActivityIndicator color={colors.white} size="small" />
          ) : (
            <Text style={styles.formSubmitText}>Записать выплату</Text>
          )}
        </TouchableOpacity>
      </Modal>

      {/* Round 16 #1(б) — быстрая выдача из списка: та же PayoutForm, что в
          карточке сотрудника (сумма предзаполнена «К выплате», тип — сегмент,
          комментарий необязателен → «Выдать» в один тап). */}
      <Modal
        visible={payoutTarget !== null}
        onClose={() => setPayoutTarget(null)}
        title={'Выдать — ' + (payoutTarget?.masterName ?? '')}
      >
        {payoutTarget ? (
          <>
            <View style={[styles.quickMetaRow, { backgroundColor: palette.bg.muted }]}>
              <Ionicons name="calendar-outline" size={13} color={palette.text.tertiary} />
              <Text style={[styles.quickMetaText, { color: palette.text.secondary }]}>
                Выплата за {monthLabelFull(selectedMonth).toLowerCase()} — попадёт в этот месяц
              </Text>
            </View>
            {pendingForTarget > 0 ? (
              <View
                style={[
                  styles.quickWarnRow,
                  { backgroundColor: palette.mode === 'dark' ? 'rgba(245,158,11,0.16)' : colors.amber[50] },
                ]}
              >
                <Ionicons name="time-outline" size={13} color={colors.amber[700]} />
                <Text style={[styles.quickMetaText, { color: colors.amber[700] }]}>
                  Уже ожидает подтверждения: {formatMoney(pendingForTarget)} — сотрудник ещё не принял прошлую выплату
                </Text>
              </View>
            ) : null}
            <PayoutForm
              palette={palette}
              initialType="salary"
              suggestedAmount={Math.max(0, Math.round(payoutTarget.remainingAmount || 0))}
              pending={quickPayoutMutation.isPending}
              onSubmit={(vars) => quickPayoutMutation.mutate({ employeeId: payoutTarget.masterId, ...vars })}
              onCancel={() => setPayoutTarget(null)}
            />
          </>
        ) : null}
      </Modal>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1 },

  monthChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'transparent',
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing[1],
    paddingVertical: 4,
  },
  monthChipBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  monthChipLabel: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    minWidth: 72,
    textAlign: 'center',
    letterSpacing: -0.2,
  },

  summaryCard: {
    marginHorizontal: spacing[4],
    marginTop: spacing[3],
    marginBottom: spacing[2],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3.5],
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 1 },
    ...(Platform.OS === 'android' ? { elevation: 1 } : null),
  },
  summaryRow: { flexDirection: 'row', alignItems: 'center' },
  summaryCell: { flex: 1, alignItems: 'flex-start', gap: 4 },
  summaryDivider: { width: StyleSheet.hairlineWidth, height: 32, marginHorizontal: spacing[3] },
  summaryCellLabel: { fontSize: 10, fontWeight: fontWeight.medium, textTransform: 'uppercase', letterSpacing: 0.4 },
  summaryCellValue: {
    fontSize: fontSize.base,
    lineHeight: 22,
    fontWeight: fontWeight.bold,
    letterSpacing: -0.3,
    includeFontPadding: false,
  },

  emptyWrap: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing[6],
    paddingTop: spacing[12],
    gap: spacing[2],
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[2],
  },
  emptyTitle: { fontSize: fontSize.base, fontWeight: fontWeight.semibold },
  emptySubtitle: { fontSize: fontSize.xs, textAlign: 'center' },

  // 149 — «Выплата вне программы» (кнопка под сводкой + форма в шите).
  outsideBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    marginHorizontal: spacing[4],
    marginBottom: spacing[2],
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[3],
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
  },
  outsideBtnIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outsideBtnTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, letterSpacing: -0.2 },
  outsideBtnSubtitle: { fontSize: 11, fontWeight: fontWeight.medium, marginTop: 1 },
  formField: { marginBottom: spacing[4] },
  formLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, marginBottom: spacing[1.5] },
  formInput: {
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[2.5],
    fontSize: fontSize.sm,
  },
  formMonthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1.5],
  },
  formMonthBtn: { padding: spacing[1.5] },
  formMonthLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, textTransform: 'capitalize' },
  formHint: { fontSize: 11, marginTop: spacing[1.5] },
  formSubmit: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.lg,
    paddingVertical: spacing[3],
    marginTop: spacing[1],
  },
  formSubmitText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.white },

  row: {
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    gap: spacing[2],
    minHeight: 68,
  },
  rowTopLine: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  rowAvatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  rowAvatarText: { fontSize: 13, fontWeight: fontWeight.bold, color: colors.white, letterSpacing: 0.2 },
  rowNameCol: { flex: 1, gap: 3 },
  rowName: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, letterSpacing: -0.2 },
  rowSubRow: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  rowPercentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  rowPercentText: { fontSize: 10, fontWeight: fontWeight.semibold },
  rowStatusPill: { paddingHorizontal: spacing[1.5], paddingVertical: 2, borderRadius: 8 },
  rowStatusText: { fontSize: 10, fontWeight: fontWeight.semibold },
  rowAmountCol: { alignItems: 'flex-end', gap: 0 },
  rowAmount: { fontSize: fontSize.base, fontWeight: fontWeight.bold, letterSpacing: -0.4 },
  rowChipsLine: { paddingLeft: 36 + spacing[3] },
  rowChipsText: { fontSize: 11, fontWeight: fontWeight.medium },

  // Round 16 #1(б) — нижняя полоса «Выдать · N ₽» на строке сотрудника.
  rowIssueBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1.5],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.xl,
    marginTop: spacing[0.5],
  },
  rowIssueBtnText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    color: colors.green[700],
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
  },

  // Round 16 #1(б) — инфострока и предупреждение в модале быстрой выдачи.
  quickMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[2.5],
    paddingVertical: spacing[2],
    marginBottom: spacing[3],
  },
  quickWarnRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[1.5],
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[2.5],
    paddingVertical: spacing[2],
    marginBottom: spacing[3],
  },
  quickMetaText: { flex: 1, fontSize: 11, fontWeight: fontWeight.medium, lineHeight: 15 },

  // «В среднем за смену» line — aligned under the name (skip avatar + gap).
  rowPerDayLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingLeft: 36 + spacing[3],
  },
  rowPerDayPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  rowPerDayShifts: {
    fontSize: 10,
    fontWeight: fontWeight.semibold,
    fontVariant: ['tabular-nums'],
  },
  rowPerDayValue: {
    fontSize: 12,
    fontWeight: fontWeight.bold,
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
  },
  rowPerDayCaption: { fontSize: 11, fontWeight: fontWeight.medium },
});
