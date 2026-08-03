/**
 * SalaryEmployeeCard — full-screen, month-paged salary card for ONE employee.
 *
 * Replaces the old bottom-sheet popup. Two entry points share this one body:
 *   • Owner drill-down: taps an employee in «Зарплата» → SalaryEmployeeScreen
 *     renders this with `canManagePayouts` / `canManagePremiums` (два разных
 *     матричных ключа — см. ниже) and the employee's name as the title.
 *   • Employee (admin/master) opens «Зарплата» → SalaryScreen renders this
 *     inline with their OWN id, оба can-props false, title «Моя зарплата».
 *
 * Data comes from `salaryApi.getEmployeeMonth(employeeId, 'YYYY-MM')` — a full
 * month breakdown (service / product earnings, motivation, premiums, fines,
 * payouts + statuses, legacy payments, and the netted totals). Month paging is
 * driven by the header chip (‹ Июнь 2026 ›) AND a horizontal swipe.
 *
 * Money UI is deliberately non-double-counting: «К выплате» (remainingAmount)
 * is the backend's already-netted number (earnings − fines − accepted payouts);
 * we render the server's figure verbatim and never re-subtract client-side.
 *
 * Owner actions — два независимых серверных ключа (у системного «Администратора»
 * payouts=false, а premiums=true, поэтому один общий prop нельзя):
 *   • canManagePayouts (salary_payouts_manage): «Выдать зарплату» / «Аванс» →
 *     createPayout (starts pending; the employee accepts/rejects via the global
 *     SalaryReceivedModal) + «Добавить штраф» → createFine (comment MANDATORY —
 *     submit blocked while the reason is empty; fines listed with remove).
 *   • canManagePremiums (salary_premiums_manage): «Премия» → premiums.create
 *     (cash / +% к ставке) — preserved from the old popup.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  ScrollView,
  RefreshControl,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import IosScreenHeader from '../IosScreenHeader';
import LoadingSpinner from '../LoadingSpinner';
import QueryErrorState from '../QueryErrorState';
import Modal from '../Modal';
import RateByMonthSheet from '../employee/RateByMonthSheet';
import { salaryApi } from '../../api/services';
import { useColors } from '../../contexts/ThemeContext';
import { useTabBarHeight } from '../../hooks/useTabBarHeight';
import { Text } from '../../platform/Typography';
import { haptic } from '../../platform/haptics';
import { colors, fontSize, fontWeight, borderRadius, spacing, softTint } from '../../theme';
import type { SemanticPalette } from '../../theme/palette';
import {
  RUBLE,
  formatMoney,
  formatMonthKey,
  monthLabelShort,
  monthLabelFull,
  formatDayMonth,
  formatDayMonthTime,
  addMonths,
  parseMonthKey,
} from './salaryFormat';
import type {
  SalaryMonthDetail,
  SalaryPayout,
  SalaryPayoutStatus,
  SalaryFine,
  SalaryPremium,
  SalaryPayment,
} from '../../../../shared/types';

// ── Props ───────────────────────────────────────────────────────────────────

export interface SalaryEmployeeCardProps {
  employeeId: string;
  employeeName: string;
  /** Header title. Owner drill-down → employee name; self-view → «Моя зарплата». */
  title: string;
  /** Header back handler. */
  onBack: () => void;
  /** Держатель salary_payouts_manage — выплаты / авансы / штрафы. */
  canManagePayouts: boolean;
  /** Держатель salary_premiums_manage — премии (у системного «Администратора»
   *  true при payouts=false — ключи независимы). */
  canManagePremiums: boolean;
  /**
   * Round 15 п.1 — держатель user_management (owner-class байпасится внутри
   * hasPermission): кнопка «Изменить процент за <месяц>» — пересчёт начислений
   * И прибыли ровно открытого в пейджере месяца (PATCH /users/:id/rate).
   */
  canManageRates?: boolean;
  /** 'YYYY-MM' to open on. Defaults to the current month. */
  initialMonth?: string;
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function parseAmount(s: string): number {
  return parseFloat(s.replace(/\s+/g, '').replace(',', '.'));
}

type Tone = 'green' | 'amber' | 'blue' | 'red' | 'muted';

function toneColors(tone: Tone, palette: SemanticPalette): { bg: string; text: string } {
  const dark = palette.mode === 'dark';
  switch (tone) {
    case 'green':
      return { bg: dark ? softTint(colors.green[600], 'dark') : colors.green[50], text: colors.green[600] };
    case 'amber':
      return { bg: dark ? softTint(colors.amber[600], 'dark') : colors.amber[50], text: colors.amber[700] };
    case 'red':
      return { bg: dark ? softTint(colors.red[600], 'dark') : colors.red[50], text: colors.red[600] };
    case 'blue':
      return { bg: palette.accent.primarySoft, text: palette.accent.primaryText };
    case 'muted':
    default:
      return { bg: palette.bg.muted, text: palette.text.tertiary };
  }
}

function heroStatus(d: SalaryMonthDetail): { label: string; tone: Tone } {
  const { remainingAmount: remaining, paidAmount: paid, totalEarnings: earned } = d;
  if (earned <= 0 && paid <= 0) return { label: 'Нет начислений', tone: 'muted' };
  if (remaining <= 0.5) return { label: 'Выплачено', tone: 'green' };
  if (paid > 0) return { label: 'Частично выплачено', tone: 'amber' };
  return { label: 'К выплате', tone: 'blue' };
}

function payoutStatusMeta(status: SalaryPayoutStatus): {
  label: string;
  tone: Tone;
  icon: React.ComponentProps<typeof Ionicons>['name'];
} {
  switch (status) {
    case 'accepted':
      return { label: 'Принято', tone: 'green', icon: 'checkmark-circle' };
    case 'rejected':
      return { label: 'Отклонено', tone: 'red', icon: 'close-circle' };
    // Round 15 (153) — отменена владельцем: строка остаётся зачёркнутой.
    case 'cancelled':
      return { label: 'Отменена', tone: 'red', icon: 'ban-outline' };
    case 'pending':
    default:
      return { label: 'Ожидает', tone: 'amber', icon: 'time-outline' };
  }
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SalaryEmployeeCard({
  employeeId,
  employeeName,
  title,
  onBack,
  canManagePayouts,
  canManagePremiums,
  canManageRates = false,
  initialMonth,
}: SalaryEmployeeCardProps) {
  const palette = useColors();
  const queryClient = useQueryClient();
  const tabBarHeight = useTabBarHeight();

  const [month, setMonth] = useState<Date>(() => parseMonthKey(initialMonth));
  const monthKey = formatMonthKey(month);

  const [refreshing, setRefreshing] = useState(false);

  // Active owner form — one at a time (no stacked RNModals). The payout form's
  // initial type is stashed when the button opens it.
  const [activeForm, setActiveForm] = useState<null | 'payout' | 'fine' | 'premium'>(null);
  const [payoutInitialType, setPayoutInitialType] = useState<'salary' | 'advance'>('salary');

  // Round 15 — корректировки владельцем (153): цель действия сташится в state,
  // соответствующий Modal-форм рендерится внизу (те же правила: один за раз).
  const [rateSheetOpen, setRateSheetOpen] = useState(false);
  const [payoutToCancel, setPayoutToCancel] = useState<SalaryPayout | null>(null);
  const [payoutToEdit, setPayoutToEdit] = useState<SalaryPayout | null>(null);
  const [paymentToReverse, setPaymentToReverse] = useState<SalaryPayment | null>(null);
  const [fineToEdit, setFineToEdit] = useState<SalaryFine | null>(null);

  // ── Data ────────────────────────────────────────────────────────────────────
  const { data, isError, isFetching, refetch } = useQuery<SalaryMonthDetail>({
    queryKey: ['salary-employee-month', employeeId, monthKey],
    queryFn: async () => (await salaryApi.getEmployeeMonth(employeeId, monthKey)).data,
    // SWR — keep the previous month on screen while the next one loads, so
    // paging never flashes empty.
    placeholderData: (prev) => prev,
    enabled: !!employeeId,
  });

  // ── Month navigation ──────────────────────────────────────────────────────────
  const goPrev = useCallback(() => {
    haptic('select');
    setMonth((d) => addMonths(d, -1));
  }, []);
  const goNext = useCallback(() => {
    haptic('select');
    setMonth((d) => addMonths(d, 1));
  }, []);
  const resetMonth = useCallback(() => {
    haptic('tap');
    setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  }, []);

  // Horizontal swipe → month pager. `activeOffsetX` requires a clear sideways
  // drag and `failOffsetY` yields vertical drags to the ScrollView, so the
  // pager never fights the vertical scroll.
  const swipe = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-24, 24])
        .failOffsetY([-18, 18])
        .onEnd((e) => {
          if (e.translationX > 60) runOnJS(goPrev)();
          else if (e.translationX < -60) runOnJS(goNext)();
        }),
    [goPrev, goNext],
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  // ── Mutations ──────────────────────────────────────────────────────────────────
  const invalidate = useCallback(() => {
    // Refresh this employee's month card across ALL months + the owner list.
    queryClient.invalidateQueries({ queryKey: ['salary-employee-month', employeeId] });
    queryClient.invalidateQueries({ queryKey: ['salary'] });
  }, [queryClient, employeeId]);

  // Round 15 — корректировка двигает деньги (сторно расхода): устаревают
  // расходы и все денежные отчёты, не только зарплата.
  const invalidateMoney = useCallback(() => {
    invalidate();
    for (const key of [
      'expenses',
      'cashflow',
      'dashboard-v2',
      'dashboard-chart',
      'financial-report',
      'tag-analytics',
      'reports',
    ]) {
      queryClient.invalidateQueries({ queryKey: [key] });
    }
  }, [invalidate, queryClient]);

  const errorAlert = useCallback(
    (fallback: string) => (err: any) => {
      haptic('error');
      const friendly = err?.response?.data?.message || err?.response?.data?.error || err?.message || fallback;
      Alert.alert('Ошибка', String(Array.isArray(friendly) ? friendly.join('\n') : friendly));
    },
    [],
  );

  const payoutMutation = useMutation({
    mutationFn: (vars: { type: 'salary' | 'advance'; amount: number; comment?: string }) =>
      // 149 — карточка помесячная: выплата, выписанная с экрана июля (даже в
      // августе), относится к июлю (periodMonth = открытый месяц) — симметрично
      // премии (periodMonthYear ниже).
      // Adversarial-ревью Round 14: в отличие от платежей поставщикам, здесь
      // безусловная отправка periodMonth (в т.ч. = текущему месяцу) дневные
      // срезы «Расходов» НЕ ломает: зеркальный расход уходит в категорию
      // «Зарплата», которая исключена из P&L по имени, а лента расходов
      // фильтруется по дате факта (period_month там — только бейдж). Для
      // текущего месяца periodMonth совпадает с COALESCE-фолбэком сервера —
      // семантика идентична отсутствию поля.
      salaryApi.createPayout({
        employeeId,
        type: vars.type,
        amount: vars.amount,
        comment: vars.comment,
        periodMonth: monthKey,
      }),
    onSuccess: () => {
      setActiveForm(null);
      haptic('success');
      invalidate();
    },
    onError: errorAlert('Не удалось создать выплату'),
  });

  const fineMutation = useMutation({
    mutationFn: (vars: { amount: number; comment: string }) =>
      salaryApi.createFine({ userId: employeeId, amount: vars.amount, comment: vars.comment }),
    onSuccess: () => {
      setActiveForm(null);
      haptic('success');
      invalidate();
    },
    onError: errorAlert('Не удалось добавить штраф'),
  });

  const premiumMutation = useMutation({
    mutationFn: (vars: { type: 'cash' | 'rate_bonus'; amount?: number; bonusPercent?: number; reason: string }) =>
      salaryApi.premiums.create({
        userId: employeeId,
        type: vars.type,
        amount: vars.amount,
        bonusPercent: vars.bonusPercent,
        reason: vars.reason,
        periodMonthYear: monthKey,
      }),
    onSuccess: () => {
      setActiveForm(null);
      haptic('success');
      invalidate();
    },
    onError: errorAlert('Не удалось добавить премию'),
  });

  const removeFineMutation = useMutation({
    mutationFn: (id: string) => salaryApi.removeFine(id),
    onSuccess: () => {
      haptic('success');
      invalidate();
    },
    onError: errorAlert('Не удалось удалить штраф'),
  });

  const confirmRemoveFine = useCallback(
    (fine: SalaryFine) => {
      Alert.alert('Удалить штраф?', `«${fine.comment}» — ${formatMoney(fine.amount)}`, [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Удалить', style: 'destructive', onPress: () => removeFineMutation.mutate(fine.id) },
      ]);
    },
    [removeFineMutation],
  );

  const openPayout = useCallback((type: 'salary' | 'advance') => {
    haptic('tap');
    setPayoutInitialType(type);
    setActiveForm('payout');
  }, []);

  // ── Round 15 (153) — корректировки владельцем ──────────────────────────────
  const cancelPayoutMutation = useMutation({
    mutationFn: (vars: { id: string; reason?: string }) => salaryApi.cancelPayout(vars.id, vars.reason),
    onSuccess: (res) => {
      setPayoutToCancel(null);
      haptic('success');
      invalidateMoney();
      // Round 15 review-fix (п.4) — честный сигнал, как у сторно legacy-выплаты
      // ниже: расход принятой выплаты могли удалить руками раньше — тогда
      // сторнировать нечего, владелец проверяет «Расходы» сам.
      if (res?.data && res.data.expenseCompensated === false) {
        Alert.alert('Выплата отменена', 'Связанный расход не найден — проверьте раздел «Расходы» вручную');
      }
    },
    onError: errorAlert('Не удалось отменить выплату'),
  });

  const updatePayoutMutation = useMutation({
    mutationFn: (vars: { id: string; amount: number }) => salaryApi.updatePayout(vars.id, { amount: vars.amount }),
    onSuccess: () => {
      setPayoutToEdit(null);
      haptic('success');
      invalidate();
    },
    onError: errorAlert('Не удалось изменить выплату'),
  });

  const reversePaymentMutation = useMutation({
    mutationFn: (vars: { id: string; reason?: string }) => salaryApi.deletePayment(vars.id, vars.reason),
    onSuccess: (res) => {
      setPaymentToReverse(null);
      haptic('success');
      invalidateMoney();
      // Честный сигнал: у исторической выплаты расход мог быть удалён вручную —
      // тогда сторнировать нечего, владелец проверяет «Расходы» сам.
      if (res?.data && res.data.expenseCompensated === false) {
        Alert.alert('Выплата отменена', 'Связанный расход не найден — проверьте раздел «Расходы» вручную');
      }
    },
    onError: errorAlert('Не удалось отменить выплату'),
  });

  const updateFineMutation = useMutation({
    mutationFn: (vars: { id: string; amount: number; comment: string }) =>
      salaryApi.updatePenalty(vars.id, { amount: vars.amount, comment: vars.comment }),
    onSuccess: () => {
      setFineToEdit(null);
      haptic('success');
      invalidate();
    },
    onError: errorAlert('Не удалось изменить штраф'),
  });

  // Меню строки выплаты (кнопка ⋯): pending — изменить/отменить; accepted —
  // только отменить (правка принятой запрещена сервером: отменить и выдать
  // заново). Alert как action-sheet — работает на iOS и Android одинаково.
  const openPayoutMenu = useCallback((p: SalaryPayout) => {
    haptic('tap');
    const buttons: Array<{ text: string; style?: 'cancel' | 'destructive'; onPress?: () => void }> = [];
    if (p.status === 'pending') {
      buttons.push({ text: 'Изменить сумму', onPress: () => setPayoutToEdit(p) });
    }
    buttons.push({ text: 'Отменить выплату', style: 'destructive', onPress: () => setPayoutToCancel(p) });
    buttons.push({ text: 'Закрыть', style: 'cancel' });
    Alert.alert(p.type === 'advance' ? 'Аванс' : 'Зарплата', formatMoney(p.amount), buttons);
  }, []);

  const openPaymentMenu = useCallback((p: SalaryPayment) => {
    haptic('tap');
    Alert.alert(p.type === 'advance' ? 'Аванс' : p.type === 'premium' ? 'Премия' : 'Зарплата', formatMoney(p.amount), [
      { text: 'Отменить выплату', style: 'destructive', onPress: () => setPaymentToReverse(p) },
      { text: 'Закрыть', style: 'cancel' },
    ]);
  }, []);

  // ── Header ──────────────────────────────────────────────────────────────────────
  const monthChip = (
    <View style={[styles.monthChip, { backgroundColor: palette.bg.muted }]}>
      <TouchableOpacity onPress={goPrev} hitSlop={6} style={styles.monthChipBtn}>
        <Ionicons name="chevron-back" size={16} color={palette.text.secondary} />
      </TouchableOpacity>
      <TouchableOpacity onPress={resetMonth} activeOpacity={0.7}>
        <Text style={[styles.monthChipLabel, { color: palette.text.primary }]}>{monthLabelShort(month)}</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={goNext} hitSlop={6} style={styles.monthChipBtn}>
        <Ionicons name="chevron-forward" size={16} color={palette.text.secondary} />
      </TouchableOpacity>
    </View>
  );

  const suggestedPayout = Math.max(0, Math.round(data?.remainingAmount ?? 0));

  // ── Body ──────────────────────────────────────────────────────────────────────
  let body: React.ReactNode;
  if (isError && data === undefined) {
    body = <QueryErrorState description="Проверьте соединение и попробуйте ещё раз" onRetry={() => refetch()} />;
  } else if (data === undefined) {
    body = <LoadingSpinner />;
  } else {
    body = (
      <GestureHandlerRootView style={styles.flex}>
        <GestureDetector gesture={swipe}>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{
              paddingHorizontal: spacing[4],
              paddingTop: spacing[3],
              paddingBottom: tabBarHeight + spacing[6],
            }}
            contentInset={Platform.OS === 'ios' ? { bottom: tabBarHeight } : undefined}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.accent.primary} />
            }
          >
            <Hero data={data} month={month} palette={palette} loading={isFetching && !refreshing} />
            <TotalsGrid data={data} palette={palette} />
            <Breakdown data={data} palette={palette} />
            {canManageRates ? (
              <TouchableOpacity
                style={[styles.rateButton, { borderColor: palette.border.strong, backgroundColor: palette.bg.card }]}
                activeOpacity={0.8}
                onPress={() => {
                  haptic('tap');
                  setRateSheetOpen(true);
                }}
              >
                <Ionicons name="create-outline" size={18} color={colors.primary[600]} />
                <Text style={[styles.actionOutlineText, { color: palette.text.primary }]}>
                  Изменить процент за {monthLabelFull(month)}
                </Text>
              </TouchableOpacity>
            ) : null}
            <PayoutsSection
              payouts={data.payouts}
              palette={palette}
              canManage={canManagePayouts}
              onMenu={openPayoutMenu}
            />
            <FinesSection
              fines={data.fines}
              palette={palette}
              canManage={canManagePayouts}
              onRemove={confirmRemoveFine}
              onEdit={(f) => {
                haptic('tap');
                setFineToEdit(f);
              }}
              removingId={removeFineMutation.isPending ? removeFineMutation.variables : undefined}
            />
            <PremiumsSection premiums={data.premiums} palette={palette} />
            <PaymentsSection
              payments={data.payments}
              palette={palette}
              canManage={canManagePayouts}
              onMenu={openPaymentMenu}
            />

            {canManagePayouts || canManagePremiums ? (
              <View style={styles.actions}>
                {canManagePayouts && (
                  <>
                    <View style={styles.actionRow}>
                      <TouchableOpacity
                        style={styles.actionPrimary}
                        activeOpacity={0.85}
                        onPress={() => openPayout('salary')}
                      >
                        <LinearGradient
                          colors={[colors.green[500], colors.green[700]] as [string, string]}
                          style={styles.actionGradient}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 0 }}
                        >
                          <Ionicons name="paper-plane-outline" size={18} color={colors.white} />
                          <Text style={styles.actionPrimaryText}>Выдать зарплату</Text>
                        </LinearGradient>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.actionSecondary}
                        activeOpacity={0.85}
                        onPress={() => openPayout('advance')}
                      >
                        <LinearGradient
                          colors={[colors.amber[600], colors.orange[600]] as [string, string]}
                          style={styles.actionGradient}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 0 }}
                        >
                          <Ionicons name="card-outline" size={18} color={colors.white} />
                          <Text style={styles.actionPrimaryText}>Аванс</Text>
                        </LinearGradient>
                      </TouchableOpacity>
                    </View>
                    <TouchableOpacity
                      style={[styles.actionOutline, { borderColor: palette.border.strong }]}
                      activeOpacity={0.8}
                      onPress={() => {
                        haptic('tap');
                        setActiveForm('fine');
                      }}
                    >
                      <Ionicons name="remove-circle-outline" size={18} color={colors.red[600]} />
                      <Text style={[styles.actionOutlineText, { color: palette.text.primary }]}>Добавить штраф</Text>
                    </TouchableOpacity>
                  </>
                )}
                {canManagePremiums && (
                  <TouchableOpacity
                    style={[styles.actionOutline, { borderColor: palette.border.strong }]}
                    activeOpacity={0.8}
                    onPress={() => {
                      haptic('tap');
                      setActiveForm('premium');
                    }}
                  >
                    <Ionicons name="gift-outline" size={18} color={colors.rose[600]} />
                    <Text style={[styles.actionOutlineText, { color: palette.text.primary }]}>Премия</Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : null}
          </ScrollView>
        </GestureDetector>
      </GestureHandlerRootView>
    );
  }

  return (
    <View style={[styles.flex, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title={title} onBack={onBack} trailing={monthChip} />
      {body}

      {/* Payout form */}
      <Modal
        visible={activeForm === 'payout'}
        onClose={() => setActiveForm(null)}
        title={
          (payoutInitialType === 'salary' ? 'Выдать зарплату' : 'Выдать аванс') +
          (employeeName ? ' — ' + employeeName : '')
        }
      >
        <PayoutForm
          palette={palette}
          initialType={payoutInitialType}
          suggestedAmount={suggestedPayout}
          pending={payoutMutation.isPending}
          onSubmit={(vars) => payoutMutation.mutate(vars)}
          onCancel={() => setActiveForm(null)}
        />
      </Modal>

      {/* Fine form — comment MANDATORY */}
      <Modal
        visible={activeForm === 'fine'}
        onClose={() => setActiveForm(null)}
        title={'Штраф' + (employeeName ? ' — ' + employeeName : '')}
      >
        <FineForm
          palette={palette}
          pending={fineMutation.isPending}
          onSubmit={(vars) => fineMutation.mutate(vars)}
          onCancel={() => setActiveForm(null)}
        />
      </Modal>

      {/* Premium form */}
      <Modal
        visible={activeForm === 'premium'}
        onClose={() => setActiveForm(null)}
        title={'Премия' + (employeeName ? ' — ' + employeeName : '')}
      >
        <PremiumForm
          palette={palette}
          pending={premiumMutation.isPending}
          onSubmit={(vars) => premiumMutation.mutate(vars)}
          onCancel={() => setActiveForm(null)}
        />
      </Modal>

      {/* Round 15 п.1 — процент за открытый месяц (fixedMonth = пейджер). */}
      {canManageRates ? (
        <RateByMonthSheet
          visible={rateSheetOpen}
          onClose={() => setRateSheetOpen(false)}
          userId={employeeId}
          userName={employeeName}
          currentSalaryPercent={data?.salaryPercent ?? 0}
          currentProductPercent={data?.productSalaryPercent ?? 0}
          fixedMonth={monthKey}
        />
      ) : null}

      {/* Round 15 (153) — отмена выплаты (payout, pending/accepted) */}
      <Modal visible={payoutToCancel !== null} onClose={() => setPayoutToCancel(null)} title="Отменить выплату?">
        {payoutToCancel ? (
          <CancelReasonForm
            palette={palette}
            description={
              `${payoutToCancel.type === 'advance' ? 'Аванс' : 'Зарплата'} ${formatMoney(payoutToCancel.amount)}. ` +
              (payoutToCancel.status === 'accepted'
                ? 'Связанный расход будет сторнирован: сумма вернётся в «К выплате», касса и лента расходов обновятся. Прибыль не изменится.'
                : 'Сотрудник больше не увидит её в подтверждении.')
            }
            pending={cancelPayoutMutation.isPending}
            onSubmit={(reason) => cancelPayoutMutation.mutate({ id: payoutToCancel.id, reason })}
            onCancel={() => setPayoutToCancel(null)}
          />
        ) : null}
      </Modal>

      {/* Round 15 (153) — правка суммы pending-выплаты */}
      <Modal visible={payoutToEdit !== null} onClose={() => setPayoutToEdit(null)} title="Изменить сумму выплаты">
        {payoutToEdit ? (
          <EditAmountForm
            palette={palette}
            initialAmount={payoutToEdit.amount}
            pending={updatePayoutMutation.isPending}
            onSubmit={(amount) => updatePayoutMutation.mutate({ id: payoutToEdit.id, amount })}
            onCancel={() => setPayoutToEdit(null)}
          />
        ) : null}
      </Modal>

      {/* Round 15 (153) — сторно legacy-выплаты (salary_payments) */}
      <Modal visible={paymentToReverse !== null} onClose={() => setPaymentToReverse(null)} title="Отменить выплату?">
        {paymentToReverse ? (
          <CancelReasonForm
            palette={palette}
            description={
              `Выплата ${formatMoney(paymentToReverse.amount)} будет отменена (сторно): ` +
              '«выплачено» месяца уменьшится, связанный расход будет сторнирован. Прибыль не изменится.'
            }
            pending={reversePaymentMutation.isPending}
            onSubmit={(reason) => reversePaymentMutation.mutate({ id: paymentToReverse.id, reason })}
            onCancel={() => setPaymentToReverse(null)}
          />
        ) : null}
      </Modal>

      {/* Round 15 (153) — правка штрафа */}
      <Modal visible={fineToEdit !== null} onClose={() => setFineToEdit(null)} title="Изменить штраф">
        {fineToEdit ? (
          <FineForm
            palette={palette}
            pending={updateFineMutation.isPending}
            initialAmount={String(fineToEdit.amount)}
            initialComment={fineToEdit.comment}
            submitLabel="Сохранить"
            onSubmit={(vars) => updateFineMutation.mutate({ id: fineToEdit.id, ...vars })}
            onCancel={() => setFineToEdit(null)}
          />
        ) : null}
      </Modal>
    </View>
  );
}

// ── Hero ──────────────────────────────────────────────────────────────────────

function Hero({
  data,
  month,
  palette,
  loading,
}: {
  data: SalaryMonthDetail;
  month: Date;
  palette: SemanticPalette;
  loading: boolean;
}) {
  const status = heroStatus(data);
  const tone = toneColors(status.tone, palette);
  return (
    <View style={[styles.hero, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
      <View style={styles.heroTopRow}>
        <Text style={[styles.heroMonth, { color: palette.text.tertiary }]}>{monthLabelFull(month)}</Text>
        {loading ? <ActivityIndicator size="small" color={palette.text.tertiary} /> : null}
      </View>
      <Text style={[styles.heroLabel, { color: palette.text.secondary }]}>К выплате</Text>
      <Text style={[styles.heroAmount, { color: palette.text.primary }]} numberOfLines={1} adjustsFontSizeToFit>
        {formatMoney(data.remainingAmount)}
      </Text>
      <View style={[styles.heroPill, { backgroundColor: tone.bg }]}>
        <Text style={[styles.heroPillText, { color: tone.text }]}>{status.label}</Text>
      </View>
    </View>
  );
}

// ── Totals grid (Начислено / Штрафы / Выплачено / К выплате) ─────────────────────

function TotalsGrid({ data, palette }: { data: SalaryMonthDetail; palette: SemanticPalette }) {
  return (
    <View style={[styles.totalsCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
      <View style={styles.totalsRow}>
        <TotalTile
          label="Начислено"
          value={formatMoney(data.totalEarnings)}
          color={palette.text.primary}
          palette={palette}
        />
        <View style={[styles.totalsVDivider, { backgroundColor: palette.border.subtle }]} />
        <TotalTile
          label="Штрафы"
          value={data.finesAmount > 0 ? '− ' + formatMoney(data.finesAmount) : formatMoney(0)}
          color={data.finesAmount > 0 ? colors.red[600] : palette.text.secondary}
          palette={palette}
        />
      </View>
      <View style={[styles.totalsHDivider, { backgroundColor: palette.border.subtle }]} />
      <View style={styles.totalsRow}>
        <TotalTile label="Выплачено" value={formatMoney(data.paidAmount)} color={colors.green[600]} palette={palette} />
        <View style={[styles.totalsVDivider, { backgroundColor: palette.border.subtle }]} />
        <TotalTile
          label="К выплате"
          value={formatMoney(data.remainingAmount)}
          color={data.remainingAmount > 0.5 ? colors.amber[700] : palette.text.secondary}
          palette={palette}
        />
      </View>
    </View>
  );
}

function TotalTile({
  label,
  value,
  color,
  palette,
}: {
  label: string;
  value: string;
  color: string;
  palette: SemanticPalette;
}) {
  return (
    <View style={styles.totalTile}>
      <Text style={[styles.totalLabel, { color: palette.text.tertiary }]}>{label}</Text>
      <Text style={[styles.totalValue, { color }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
        {value}
      </Text>
    </View>
  );
}

// ── Breakdown (начисления) ──────────────────────────────────────────────────────

function Breakdown({ data, palette }: { data: SalaryMonthDetail; palette: SemanticPalette }) {
  const services = data.serviceEarnings || 0;
  const products = data.productEarnings || 0;
  const premiums = data.premiumsAmount || 0;
  const motivation = data.motivationAmount || 0;
  const fines = data.finesAmount || 0;
  return (
    <Section title="Начисления" icon="pie-chart-outline" palette={palette}>
      <BreakdownRow
        icon="cut-outline"
        color={colors.primary[600]}
        label="Услуги"
        sub={`${data.salaryPercent}% от выручки`}
        value={formatMoney(services)}
        palette={palette}
      />
      <BreakdownRow
        icon="cube-outline"
        color={colors.amber[700]}
        label="Товары"
        sub={data.productSalaryPercent ? `${data.productSalaryPercent}% от выручки` : 'Без процента'}
        value={formatMoney(products)}
        palette={palette}
      />
      {premiums > 0 ? (
        <BreakdownRow
          icon="gift-outline"
          color={colors.rose[600]}
          label="Премии"
          value={formatMoney(premiums)}
          palette={palette}
        />
      ) : null}
      {motivation > 0 ? (
        <BreakdownRow
          icon="trending-up-outline"
          color={colors.green[600]}
          label="Мотивация (акции)"
          sub="% от маржи акционных товаров"
          value={formatMoney(motivation)}
          palette={palette}
        />
      ) : null}
      {fines > 0 ? (
        <BreakdownRow
          icon="remove-circle-outline"
          color={colors.red[600]}
          label="Штрафы (вычет)"
          value={'− ' + formatMoney(fines)}
          valueColor={colors.red[600]}
          palette={palette}
        />
      ) : null}
    </Section>
  );
}

function BreakdownRow({
  icon,
  color,
  label,
  sub,
  value,
  valueColor,
  palette,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  color: string;
  label: string;
  sub?: string;
  value: string;
  valueColor?: string;
  palette: SemanticPalette;
}) {
  return (
    <View style={styles.breakdownRow}>
      <View style={[styles.breakdownIcon, { backgroundColor: palette.bg.muted }]}>
        <Ionicons name={icon} size={14} color={color} />
      </View>
      <View style={styles.flex}>
        <Text style={[styles.breakdownLabel, { color: palette.text.primary }]}>{label}</Text>
        {sub ? <Text style={[styles.breakdownSub, { color: palette.text.tertiary }]}>{sub}</Text> : null}
      </View>
      <Text style={[styles.breakdownValue, { color: valueColor ?? palette.text.primary }]}>{value}</Text>
    </View>
  );
}

// ── Payouts ──────────────────────────────────────────────────────────────────────

function PayoutsSection({
  payouts,
  palette,
  canManage,
  onMenu,
}: {
  payouts: SalaryPayout[];
  palette: SemanticPalette;
  canManage: boolean;
  onMenu: (p: SalaryPayout) => void;
}) {
  const list = Array.isArray(payouts) ? payouts : [];
  return (
    <Section title="Выплаты" icon="wallet-outline" palette={palette} count={list.length}>
      {list.length === 0 ? (
        <Text style={[styles.emptyInline, { color: palette.text.tertiary }]}>Выплат пока нет</Text>
      ) : (
        list.map((p) => <PayoutRow key={p.id} payout={p} palette={palette} canManage={canManage} onMenu={onMenu} />)
      )}
    </Section>
  );
}

function PayoutRow({
  payout,
  palette,
  canManage,
  onMenu,
}: {
  payout: SalaryPayout;
  palette: SemanticPalette;
  canManage: boolean;
  onMenu: (p: SalaryPayout) => void;
}) {
  const meta = payoutStatusMeta(payout.status);
  const tone = toneColors(meta.tone, palette);
  const typeLabel = payout.type === 'advance' ? 'Аванс' : 'Зарплата';
  const isCancelled = payout.status === 'cancelled';
  // Round 15 (153): корректируется только живая выплата — pending (изменить/
  // отменить) и accepted (отменить). rejected/cancelled — только история.
  const showMenu = canManage && (payout.status === 'pending' || payout.status === 'accepted');
  return (
    <View style={[styles.listRow, { borderBottomColor: palette.border.subtle }]}>
      <View style={styles.flex}>
        <View style={styles.listRowHead}>
          <Text style={[styles.listRowTitle, { color: palette.text.primary }]}>{typeLabel}</Text>
          <View style={[styles.statusPill, { backgroundColor: tone.bg }]}>
            <Ionicons name={meta.icon} size={11} color={tone.text} />
            <Text style={[styles.statusPillText, { color: tone.text }]}>{meta.label}</Text>
          </View>
        </View>
        <Text style={[styles.listRowMeta, { color: palette.text.tertiary }]} numberOfLines={1}>
          {formatDayMonth(payout.createdAt)}
          {payout.creatorName ? ` · от ${payout.creatorName}` : ''}
        </Text>
        {payout.comment ? (
          <Text style={[styles.listRowComment, { color: palette.text.tertiary }]} numberOfLines={2}>
            «{payout.comment}»
          </Text>
        ) : null}
        {isCancelled && payout.cancelReason ? (
          <Text style={[styles.listRowComment, { color: colors.red[600] }]} numberOfLines={2}>
            Причина отмены: {payout.cancelReason}
          </Text>
        ) : null}
      </View>
      <Text
        style={[
          styles.listRowAmount,
          {
            color: payout.status === 'rejected' || isCancelled ? palette.text.tertiary : palette.text.primary,
          },
          isCancelled ? styles.struckAmount : null,
        ]}
      >
        {formatMoney(payout.amount)}
      </Text>
      {showMenu ? (
        <TouchableOpacity onPress={() => onMenu(payout)} hitSlop={8} style={styles.removeBtn}>
          <Ionicons name="ellipsis-horizontal" size={16} color={palette.text.tertiary} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

// ── Fines ──────────────────────────────────────────────────────────────────────

function FinesSection({
  fines,
  palette,
  canManage,
  onRemove,
  onEdit,
  removingId,
}: {
  fines: SalaryFine[];
  palette: SemanticPalette;
  canManage: boolean;
  onRemove: (fine: SalaryFine) => void;
  /** Round 15 (153) — правка суммы/причины штрафа (PATCH, с аудитом). */
  onEdit: (fine: SalaryFine) => void;
  removingId?: string;
}) {
  const list = Array.isArray(fines) ? fines : [];
  if (list.length === 0 && !canManage) return null;
  return (
    <Section title="Штрафы" icon="remove-circle-outline" palette={palette} count={list.length}>
      {list.length === 0 ? (
        <Text style={[styles.emptyInline, { color: palette.text.tertiary }]}>Штрафов нет</Text>
      ) : (
        list.map((f) => (
          <View key={f.id} style={[styles.listRow, { borderBottomColor: palette.border.subtle }]}>
            <View style={styles.flex}>
              <Text style={[styles.listRowTitle, { color: palette.text.primary }]} numberOfLines={2}>
                {f.comment}
              </Text>
              <Text style={[styles.listRowMeta, { color: palette.text.tertiary }]} numberOfLines={1}>
                {formatDayMonth(f.date)}
                {f.creatorName ? ` · ${f.creatorName}` : ''}
              </Text>
            </View>
            <Text style={[styles.listRowAmount, { color: colors.red[600] }]}>− {formatMoney(f.amount)}</Text>
            {canManage ? (
              <>
                <TouchableOpacity onPress={() => onEdit(f)} hitSlop={8} style={styles.removeBtn}>
                  <Ionicons name="create-outline" size={16} color={palette.text.tertiary} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => onRemove(f)}
                  hitSlop={8}
                  disabled={removingId === f.id}
                  style={styles.removeBtn}
                >
                  {removingId === f.id ? (
                    <ActivityIndicator size="small" color={palette.text.tertiary} />
                  ) : (
                    <Ionicons name="trash-outline" size={16} color={palette.text.tertiary} />
                  )}
                </TouchableOpacity>
              </>
            ) : null}
          </View>
        ))
      )}
    </Section>
  );
}

// ── Premiums (read-only list) ───────────────────────────────────────────────────

function PremiumsSection({ premiums, palette }: { premiums: SalaryPremium[]; palette: SemanticPalette }) {
  const list = Array.isArray(premiums) ? premiums : [];
  if (list.length === 0) return null;
  return (
    <Section title="Премии" icon="gift-outline" palette={palette} count={list.length}>
      {list.map((p) => {
        const isCash = p.type === 'cash';
        const value = isCash ? formatMoney(p.amount || 0) : `+${p.bonusPercent || 0}% к ставке`;
        return (
          <View key={p.id} style={[styles.listRow, { borderBottomColor: palette.border.subtle }]}>
            <View style={styles.flex}>
              <Text style={[styles.listRowTitle, { color: palette.text.primary }]} numberOfLines={2}>
                {p.reason}
              </Text>
              {p.awarderName ? (
                <Text style={[styles.listRowMeta, { color: palette.text.tertiary }]} numberOfLines={1}>
                  от {p.awarderName}
                </Text>
              ) : null}
            </View>
            <Text style={[styles.listRowAmount, { color: isCash ? colors.rose[600] : colors.violet[600] }]}>
              {value}
            </Text>
          </View>
        );
      })}
    </Section>
  );
}

// ── Legacy payments ────────────────────────────────────────────────────────────

function PaymentsSection({
  payments,
  palette,
  canManage,
  onMenu,
}: {
  payments: SalaryPayment[];
  palette: SemanticPalette;
  canManage: boolean;
  onMenu: (p: SalaryPayment) => void;
}) {
  const list = Array.isArray(payments) ? payments : [];
  if (list.length === 0) return null;
  return (
    <Section title="Прошлые выплаты" icon="time-outline" palette={palette} count={list.length}>
      {list.map((p) => {
        const label = p.type === 'advance' ? 'Аванс' : p.type === 'premium' ? 'Премия' : 'Зарплата';
        const isReversed = !!p.reversedAt;
        return (
          <View key={p.id} style={[styles.listRow, { borderBottomColor: palette.border.subtle }]}>
            <View style={styles.flex}>
              <View style={styles.listRowHead}>
                <Text style={[styles.listRowTitle, { color: palette.text.primary }]}>{label}</Text>
                {isReversed ? (
                  <View style={[styles.statusPill, { backgroundColor: toneColors('red', palette).bg }]}>
                    <Ionicons name="ban-outline" size={11} color={toneColors('red', palette).text} />
                    <Text style={[styles.statusPillText, { color: toneColors('red', palette).text }]}>Отменена</Text>
                  </View>
                ) : null}
              </View>
              {isReversed ? (
                p.reversalReason ? (
                  <Text style={[styles.listRowComment, { color: colors.red[600] }]} numberOfLines={2}>
                    Причина отмены: {p.reversalReason}
                  </Text>
                ) : null
              ) : (
                <View style={styles.listRowConfirm}>
                  <Ionicons
                    name={p.confirmedAt ? 'checkmark-circle' : 'time-outline'}
                    size={12}
                    color={p.confirmedAt ? colors.green[600] : colors.amber[600]}
                  />
                  <Text
                    style={[styles.listRowMeta, { color: p.confirmedAt ? colors.green[600] : colors.amber[600] }]}
                    numberOfLines={1}
                  >
                    {p.confirmedAt ? `Получено ${formatDayMonthTime(p.confirmedAt)}` : 'Ждём подтверждения'}
                  </Text>
                </View>
              )}
            </View>
            <Text
              style={[
                styles.listRowAmount,
                { color: isReversed ? palette.text.tertiary : palette.text.primary },
                isReversed ? styles.struckAmount : null,
              ]}
            >
              {formatMoney(p.amount)}
            </Text>
            {canManage && !isReversed ? (
              <TouchableOpacity onPress={() => onMenu(p)} hitSlop={8} style={styles.removeBtn}>
                <Ionicons name="ellipsis-horizontal" size={16} color={palette.text.tertiary} />
              </TouchableOpacity>
            ) : null}
          </View>
        );
      })}
    </Section>
  );
}

// ── Section wrapper ────────────────────────────────────────────────────────────

function Section({
  title,
  icon,
  palette,
  count,
  children,
}: {
  title: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  palette: SemanticPalette;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <View style={[styles.section, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
      <View style={styles.sectionHeader}>
        <Ionicons name={icon} size={15} color={palette.text.secondary} />
        <Text style={[styles.sectionTitle, { color: palette.text.primary }]}>{title}</Text>
        <View style={styles.flex} />
        {typeof count === 'number' && count > 0 ? (
          <Text style={[styles.sectionCount, { color: palette.text.tertiary }]}>{count}</Text>
        ) : null}
      </View>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

// ── Payout form ────────────────────────────────────────────────────────────────

function PayoutForm({
  palette,
  initialType,
  suggestedAmount,
  pending,
  onSubmit,
  onCancel,
}: {
  palette: SemanticPalette;
  initialType: 'salary' | 'advance';
  suggestedAmount: number;
  pending: boolean;
  onSubmit: (vars: { type: 'salary' | 'advance'; amount: number; comment?: string }) => void;
  onCancel: () => void;
}) {
  const [type, setType] = useState<'salary' | 'advance'>(initialType);
  const [amount, setAmount] = useState(suggestedAmount > 0 ? String(suggestedAmount) : '');
  const [comment, setComment] = useState('');

  const submit = () => {
    const amt = parseAmount(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      Alert.alert('Ошибка', 'Укажите корректную сумму');
      return;
    }
    onSubmit({ type, amount: amt, comment: comment.trim() || undefined });
  };

  return (
    <>
      <FormField label="Тип" palette={palette}>
        <View style={[styles.toggleRow, { backgroundColor: palette.bg.muted }]}>
          <TypeChip
            active={type === 'salary'}
            onPress={() => {
              haptic('select');
              setType('salary');
            }}
            icon="wallet-outline"
            label="Зарплата"
            gradient={[colors.green[500], colors.green[700]]}
            palette={palette}
          />
          <TypeChip
            active={type === 'advance'}
            onPress={() => {
              haptic('select');
              setType('advance');
            }}
            icon="card-outline"
            label="Аванс"
            gradient={[colors.amber[600], colors.orange[600]]}
            palette={palette}
          />
        </View>
      </FormField>

      <FormField label="Сумма" palette={palette}>
        <View style={[styles.inputRow, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}>
          <Ionicons name="cash-outline" size={16} color={palette.text.tertiary} />
          <TextInput
            style={[styles.input, { color: palette.text.primary }]}
            value={amount}
            onChangeText={setAmount}
            keyboardType="numeric"
            placeholder="0"
            placeholderTextColor={palette.text.tertiary}
          />
          <Text style={[styles.currency, { color: palette.text.tertiary }]}>{RUBLE}</Text>
        </View>
      </FormField>

      <FormField label="Комментарий (необязательно)" palette={palette}>
        <View style={[styles.inputRow, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}>
          <Ionicons name="chatbubble-outline" size={14} color={palette.text.tertiary} />
          <TextInput
            style={[styles.input, { color: palette.text.primary }]}
            value={comment}
            onChangeText={setComment}
            placeholder="Добавить комментарий…"
            placeholderTextColor={palette.text.tertiary}
            multiline
          />
        </View>
      </FormField>

      <FormActions
        palette={palette}
        pending={pending}
        disabled={false}
        submitLabel="Выдать"
        submitColors={[colors.green[500], colors.green[700]]}
        onSubmit={submit}
        onCancel={onCancel}
      />
    </>
  );
}

// ── Fine form (comment MANDATORY) ───────────────────────────────────────────────

function FineForm({
  palette,
  pending,
  onSubmit,
  onCancel,
  initialAmount = '',
  initialComment = '',
  submitLabel = 'Оштрафовать',
}: {
  palette: SemanticPalette;
  pending: boolean;
  onSubmit: (vars: { amount: number; comment: string }) => void;
  onCancel: () => void;
  /** Round 15 (153) — режим правки существующего штрафа (префилл + «Сохранить»). */
  initialAmount?: string;
  initialComment?: string;
  submitLabel?: string;
}) {
  const [amount, setAmount] = useState(initialAmount);
  const [comment, setComment] = useState(initialComment);

  const amt = parseAmount(amount);
  const amountValid = Number.isFinite(amt) && amt > 0;
  const commentValid = comment.trim().length > 0;
  const valid = amountValid && commentValid;

  const submit = () => {
    if (!valid) return;
    onSubmit({ amount: amt, comment: comment.trim() });
  };

  return (
    <>
      <FormField label="Сумма штрафа" palette={palette}>
        <View style={[styles.inputRow, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}>
          <Ionicons name="cash-outline" size={16} color={palette.text.tertiary} />
          <TextInput
            style={[styles.input, { color: palette.text.primary }]}
            value={amount}
            onChangeText={setAmount}
            keyboardType="numeric"
            placeholder="0"
            placeholderTextColor={palette.text.tertiary}
          />
          <Text style={[styles.currency, { color: palette.text.tertiary }]}>{RUBLE}</Text>
        </View>
      </FormField>

      <FormField label="Причина (обязательно)" palette={palette}>
        <View
          style={[
            styles.inputRow,
            {
              backgroundColor: palette.bg.muted,
              borderColor: commentValid ? palette.border.subtle : colors.red[400],
              minHeight: 70,
            },
          ]}
        >
          <Ionicons name="document-text-outline" size={14} color={palette.text.tertiary} />
          <TextInput
            style={[styles.input, { color: palette.text.primary }]}
            value={comment}
            onChangeText={setComment}
            placeholder="За что начислен штраф"
            placeholderTextColor={palette.text.tertiary}
            multiline
          />
        </View>
        {!commentValid ? (
          <Text style={[styles.helper, { color: colors.red[500] }]}>Укажите, за что начислен штраф</Text>
        ) : null}
      </FormField>

      <FormActions
        palette={palette}
        pending={pending}
        disabled={!valid}
        submitLabel={submitLabel}
        submitColors={[colors.red[500], colors.red[600]]}
        onSubmit={submit}
        onCancel={onCancel}
      />
    </>
  );
}

// ── Round 15 (153) — корректировочные формы ────────────────────────────────────

/**
 * Подтверждение отмены выплаты (payout ИЛИ legacy payment) с необязательной
 * причиной. Причина уходит в аудит, пуш сотруднику и зачёркнутую строку.
 */
function CancelReasonForm({
  palette,
  description,
  pending,
  onSubmit,
  onCancel,
}: {
  palette: SemanticPalette;
  description: string;
  pending: boolean;
  onSubmit: (reason?: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <>
      <View style={[styles.warnBox, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}>
        <Ionicons name="alert-circle-outline" size={16} color={colors.red[600]} />
        <Text style={[styles.warnText, { color: palette.text.secondary }]}>{description}</Text>
      </View>
      <FormField label="Причина (необязательно)" palette={palette}>
        <View style={[styles.inputRow, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}>
          <Ionicons name="document-text-outline" size={14} color={palette.text.tertiary} />
          <TextInput
            style={[styles.input, { color: palette.text.primary }]}
            value={reason}
            onChangeText={setReason}
            placeholder="Например: выдана ошибочно"
            placeholderTextColor={palette.text.tertiary}
            multiline
          />
        </View>
      </FormField>
      <FormActions
        palette={palette}
        pending={pending}
        disabled={false}
        submitLabel="Отменить выплату"
        submitColors={[colors.red[500], colors.red[600]]}
        onSubmit={() => onSubmit(reason.trim() || undefined)}
        onCancel={onCancel}
      />
    </>
  );
}

/** Правка суммы PENDING-выплаты (принятую сервер не даёт менять — отмена+новая). */
function EditAmountForm({
  palette,
  initialAmount,
  pending,
  onSubmit,
  onCancel,
}: {
  palette: SemanticPalette;
  initialAmount: number;
  pending: boolean;
  onSubmit: (amount: number) => void;
  onCancel: () => void;
}) {
  const [amount, setAmount] = useState(String(initialAmount));
  const submit = () => {
    const amt = parseAmount(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      Alert.alert('Ошибка', 'Укажите корректную сумму');
      return;
    }
    onSubmit(amt);
  };
  return (
    <>
      <FormField label="Новая сумма" palette={palette}>
        <View style={[styles.inputRow, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}>
          <Ionicons name="cash-outline" size={16} color={palette.text.tertiary} />
          <TextInput
            style={[styles.input, { color: palette.text.primary }]}
            value={amount}
            onChangeText={setAmount}
            keyboardType="numeric"
            placeholder="0"
            placeholderTextColor={palette.text.tertiary}
          />
          <Text style={[styles.currency, { color: palette.text.tertiary }]}>{RUBLE}</Text>
        </View>
        <Text style={[styles.helper, { color: palette.text.tertiary }]}>
          Сотруднику придёт пуш с новой суммой — подтверждение остаётся за ним
        </Text>
      </FormField>
      <FormActions
        palette={palette}
        pending={pending}
        disabled={false}
        submitLabel="Сохранить"
        submitColors={[colors.primary[500], colors.primary[600]]}
        onSubmit={submit}
        onCancel={onCancel}
      />
    </>
  );
}

// ── Premium form ────────────────────────────────────────────────────────────────

function PremiumForm({
  palette,
  pending,
  onSubmit,
  onCancel,
}: {
  palette: SemanticPalette;
  pending: boolean;
  onSubmit: (vars: { type: 'cash' | 'rate_bonus'; amount?: number; bonusPercent?: number; reason: string }) => void;
  onCancel: () => void;
}) {
  const [type, setType] = useState<'cash' | 'rate_bonus'>('cash');
  const [amount, setAmount] = useState('');
  const [percent, setPercent] = useState('');
  const [reason, setReason] = useState('');

  const submit = () => {
    if (!reason.trim()) {
      Alert.alert('Ошибка', 'Опишите причину премии');
      return;
    }
    if (type === 'cash') {
      const amt = parseAmount(amount);
      if (!Number.isFinite(amt) || amt <= 0) {
        Alert.alert('Ошибка', 'Укажите сумму премии');
        return;
      }
      onSubmit({ type: 'cash', amount: amt, reason: reason.trim() });
    } else {
      const pct = parseAmount(percent);
      if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
        Alert.alert('Ошибка', 'Процент должен быть от 1 до 100');
        return;
      }
      onSubmit({ type: 'rate_bonus', bonusPercent: pct, reason: reason.trim() });
    }
  };

  return (
    <>
      <FormField label="Тип премии" palette={palette}>
        <View style={[styles.toggleRow, { backgroundColor: palette.bg.muted }]}>
          <TypeChip
            active={type === 'cash'}
            onPress={() => {
              haptic('select');
              setType('cash');
            }}
            icon="cash-outline"
            label="Сумма"
            gradient={[colors.rose[500], colors.rose[700]]}
            palette={palette}
          />
          <TypeChip
            active={type === 'rate_bonus'}
            onPress={() => {
              haptic('select');
              setType('rate_bonus');
            }}
            icon="trending-up-outline"
            label="% к ставке"
            gradient={[colors.violet[500], colors.violet[600]]}
            palette={palette}
          />
        </View>
      </FormField>

      {type === 'cash' ? (
        <FormField label="Сумма" palette={palette}>
          <View style={[styles.inputRow, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}>
            <Ionicons name="cash-outline" size={16} color={palette.text.tertiary} />
            <TextInput
              style={[styles.input, { color: palette.text.primary }]}
              value={amount}
              onChangeText={setAmount}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor={palette.text.tertiary}
            />
            <Text style={[styles.currency, { color: palette.text.tertiary }]}>{RUBLE}</Text>
          </View>
        </FormField>
      ) : (
        <FormField label="Бонус-процент" palette={palette}>
          <View style={[styles.inputRow, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}>
            <Ionicons name="trending-up-outline" size={16} color={palette.text.tertiary} />
            <TextInput
              style={[styles.input, { color: palette.text.primary }]}
              value={percent}
              onChangeText={setPercent}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor={palette.text.tertiary}
            />
            <Text style={[styles.currency, { color: palette.text.tertiary }]}>%</Text>
          </View>
          <Text style={[styles.helper, { color: palette.text.tertiary }]}>Добавится к проценту мастера на месяц</Text>
        </FormField>
      )}

      <FormField label="Причина" palette={palette}>
        <View
          style={[
            styles.inputRow,
            { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, minHeight: 70 },
          ]}
        >
          <Ionicons name="document-text-outline" size={14} color={palette.text.tertiary} />
          <TextInput
            style={[styles.input, { color: palette.text.primary }]}
            value={reason}
            onChangeText={setReason}
            placeholder="За что начисляется премия"
            placeholderTextColor={palette.text.tertiary}
            multiline
          />
        </View>
      </FormField>

      <FormActions
        palette={palette}
        pending={pending}
        disabled={false}
        submitLabel="Начислить"
        submitColors={[colors.rose[500], colors.rose[600]]}
        onSubmit={submit}
        onCancel={onCancel}
      />
    </>
  );
}

// ── Form building blocks ────────────────────────────────────────────────────────

function FormField({
  label,
  palette,
  children,
}: {
  label: string;
  palette: SemanticPalette;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.formField}>
      <Text style={[styles.formLabel, { color: palette.text.secondary }]}>{label}</Text>
      {children}
    </View>
  );
}

function FormActions({
  palette,
  pending,
  disabled,
  submitLabel,
  submitColors,
  onSubmit,
  onCancel,
}: {
  palette: SemanticPalette;
  pending: boolean;
  disabled: boolean;
  submitLabel: string;
  submitColors: [string, string];
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <View style={styles.formActions}>
      <TouchableOpacity
        style={[styles.cancelBtn, { backgroundColor: palette.bg.muted }]}
        onPress={onCancel}
        activeOpacity={0.75}
      >
        <Text style={[styles.cancelBtnText, { color: palette.text.secondary }]}>Отмена</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.submitBtn, (disabled || pending) && styles.submitBtnDisabled]}
        onPress={onSubmit}
        activeOpacity={0.75}
        disabled={disabled || pending}
      >
        {pending ? (
          <View style={[styles.submitGradient, { backgroundColor: submitColors[1] }]}>
            <ActivityIndicator color={colors.white} />
          </View>
        ) : (
          <LinearGradient
            colors={submitColors}
            style={styles.submitGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
          >
            <Ionicons name="checkmark" size={18} color={colors.white} />
            <Text style={styles.submitText}>{submitLabel}</Text>
          </LinearGradient>
        )}
      </TouchableOpacity>
    </View>
  );
}

function TypeChip({
  active,
  onPress,
  icon,
  label,
  gradient,
  palette,
}: {
  active: boolean;
  onPress: () => void;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  gradient: [string, string];
  palette: SemanticPalette;
}) {
  return (
    <TouchableOpacity style={styles.typeChip} activeOpacity={0.75} onPress={onPress}>
      {active ? (
        <LinearGradient colors={gradient} style={styles.typeChipInner} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
          <Ionicons name={icon} size={14} color={colors.white} />
          <Text style={styles.typeChipTextActive}>{label}</Text>
        </LinearGradient>
      ) : (
        <View style={styles.typeChipInner}>
          <Ionicons name={icon} size={14} color={palette.text.tertiary} />
          <Text style={[styles.typeChipText, { color: palette.text.secondary }]}>{label}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────────

const CARD_SHADOW = {
  shadowColor: '#000',
  shadowOpacity: 0.04,
  shadowRadius: 6,
  shadowOffset: { width: 0, height: 1 },
  ...(Platform.OS === 'android' ? { elevation: 1 } : null),
} as const;

const styles = StyleSheet.create({
  flex: { flex: 1 },

  // Header month chip
  monthChip: {
    flexDirection: 'row',
    alignItems: 'center',
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

  // Hero
  hero: {
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
    paddingBottom: spacing[4],
    alignItems: 'center',
    marginBottom: spacing[3],
    ...CARD_SHADOW,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    justifyContent: 'center',
    gap: spacing[2],
    minHeight: 20,
  },
  heroMonth: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  heroLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    marginTop: spacing[2],
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  heroAmount: {
    fontSize: 38,
    lineHeight: 46,
    fontWeight: fontWeight.bold,
    letterSpacing: -1,
    includeFontPadding: false,
    paddingTop: 2,
  },
  heroPill: {
    marginTop: spacing[2],
    paddingHorizontal: spacing[2.5],
    paddingVertical: 4,
    borderRadius: 999,
  },
  heroPillText: { fontSize: 11, fontWeight: fontWeight.semibold, letterSpacing: 0.2 },

  // Totals
  totalsCard: {
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    marginBottom: spacing[3],
    ...CARD_SHADOW,
  },
  totalsRow: { flexDirection: 'row', alignItems: 'center' },
  totalTile: { flex: 1, paddingVertical: spacing[2.5], paddingHorizontal: spacing[2], gap: 4 },
  totalLabel: { fontSize: 10, fontWeight: fontWeight.medium, textTransform: 'uppercase', letterSpacing: 0.4 },
  totalValue: {
    fontSize: fontSize.base,
    lineHeight: 22,
    fontWeight: fontWeight.bold,
    letterSpacing: -0.3,
    includeFontPadding: false,
  },
  totalsVDivider: { width: StyleSheet.hairlineWidth, height: 34 },
  totalsHDivider: { height: StyleSheet.hairlineWidth },

  // Section
  section: {
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: spacing[3],
    overflow: 'hidden',
    ...CARD_SHADOW,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[3.5],
    paddingTop: spacing[3],
    paddingBottom: spacing[1],
    gap: spacing[2],
  },
  sectionTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, letterSpacing: -0.2 },
  sectionCount: { fontSize: fontSize.xs, fontWeight: fontWeight.medium },
  sectionBody: { paddingHorizontal: spacing[3.5], paddingBottom: spacing[2] },
  emptyInline: { fontSize: fontSize.xs, paddingVertical: spacing[2.5], textAlign: 'center' },

  // Breakdown rows
  breakdownRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing[2], gap: spacing[3] },
  breakdownIcon: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  breakdownLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  breakdownSub: { fontSize: 11, marginTop: 1 },
  breakdownValue: { fontSize: fontSize.sm, fontWeight: fontWeight.bold },

  // Generic list row (payouts / fines / premiums / payments)
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingVertical: spacing[2.5],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  listRowHead: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], flexWrap: 'wrap' },
  listRowTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  listRowMeta: { fontSize: 11, marginTop: 2 },
  listRowComment: { fontSize: 11, fontStyle: 'italic', marginTop: 2 },
  listRowConfirm: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  listRowAmount: { fontSize: fontSize.sm, fontWeight: fontWeight.bold },
  // Round 15 (153) — отменённая/сторнированная строка: решение владельца —
  // показывать зачёркнутой, не прятать.
  struckAmount: { textDecorationLine: 'line-through' },
  removeBtn: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', marginLeft: spacing[1] },

  // Round 15 п.1 — вход в пересчёт процента открытого месяца.
  rateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[3],
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius['2xl'],
    marginBottom: spacing[3],
    ...CARD_SHADOW,
  },

  // Round 15 (153) — предупреждение в корректировочных формах.
  warnBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2],
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    marginBottom: spacing[4],
  },
  warnText: { flex: 1, fontSize: fontSize.xs, lineHeight: 16 },

  // Status pill
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
  },
  statusPillText: { fontSize: 10, fontWeight: fontWeight.semibold },

  // Owner actions
  actions: { marginTop: spacing[2], gap: spacing[2] },
  actionRow: { flexDirection: 'row', gap: spacing[2] },
  actionPrimary: { flex: 2, borderRadius: borderRadius['2xl'], overflow: 'hidden' },
  actionSecondary: { flex: 1, borderRadius: borderRadius['2xl'], overflow: 'hidden' },
  actionGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[3.5],
    gap: spacing[2],
  },
  actionPrimaryText: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.white, letterSpacing: -0.2 },
  actionOutline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[3],
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius['2xl'],
  },
  actionOutlineText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },

  // Forms
  formField: { marginBottom: spacing[4] },
  formLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    marginBottom: spacing[2],
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    gap: spacing[2],
  },
  input: { flex: 1, fontSize: fontSize.sm, padding: 0 },
  currency: { fontSize: fontSize.sm, fontWeight: fontWeight.bold },
  helper: { fontSize: fontSize.xs, marginTop: spacing[1] },
  formActions: { flexDirection: 'row', gap: spacing[3], marginTop: spacing[2] },
  cancelBtn: {
    flex: 1,
    borderRadius: borderRadius.xl,
    paddingVertical: spacing[3],
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  submitBtn: { flex: 2, borderRadius: borderRadius.xl, overflow: 'hidden' },
  submitBtnDisabled: { opacity: 0.5 },
  submitGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[3],
    borderRadius: borderRadius.xl,
  },
  submitText: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.white },

  // Type chip toggle
  toggleRow: { flexDirection: 'row', borderRadius: borderRadius.xl, padding: 3, gap: 3 },
  typeChip: { flex: 1, borderRadius: borderRadius.lg, overflow: 'hidden' },
  typeChipInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1.5],
    paddingVertical: spacing[2.5],
  },
  typeChipText: { fontSize: fontSize.xs, fontWeight: fontWeight.medium },
  typeChipTextActive: { fontSize: fontSize.xs, fontWeight: fontWeight.bold, color: colors.white },
});
