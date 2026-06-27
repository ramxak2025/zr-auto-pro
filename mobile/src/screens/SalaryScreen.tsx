/**
 * SalaryScreen — owner-facing payroll screen for the current month.
 *
 * Layout (top to bottom):
 *   • IosScreenHeader: title "Зарплата" + month-switcher chip in the
 *     trailing slot ("‹ Май 2026 ›"), matching ScheduleScreen.
 *   • Sticky FOT row: "ФОТ: 250 000 ₽ · 80 000 выплачено · 170 000 к выплате".
 *   • FlashList of compact employee cards (~68pt tall):
 *       avatar 36pt | name + percent micro-row | spacer | amount big | chevron
 *       sub-row chips: "N чеков · X ₽ услуги · Y ₽ товары · Z ₽ премии"
 *       status pill: Выплачено / Аванс выдан / К выплате
 *
 * Tapping a card opens a <BottomSheet> with:
 *   • Hero (name, month, total to pay)
 *   • Breakdown (услуги / товары / премии)
 *   • Premiums list (cash / rate_bonus) with reason text
 *   • Payment history with confirmedAt timestamps
 *   • Two CTAs:
 *       — "Выдать аванс" / "Выдать зарплату" — opens payment form
 *       — "Премия" — opens premium form
 *
 * On successful payment, the SalaryEnvelopeAnimation overlay plays —
 * envelope springs in, money explodes outward, then envelope flies to
 * the top-right and onComplete fires.
 *
 * Premium add fires a small success haptic; the form closes immediately
 * since premiums are local-only (don't trigger the celebratory envelope).
 *
 * Roles:
 *   • Master (the only role that can be a recipient too) — sees the
 *     screen as-is but the "Выдать"/"Премия" buttons are hidden.
 *   • Director / superadmin — full controls.
 *   • Admin — read-only (matches the existing behaviour).
 */
import React, { useState, useMemo, useCallback } from 'react';
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
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import IosScreenHeader from '../components/IosScreenHeader';
import LoadingSpinner from '../components/LoadingSpinner';
import QueryErrorState from '../components/QueryErrorState';
import Modal from '../components/Modal';
import { BottomSheet } from '../components/BottomSheet';
import SalaryEnvelopeAnimation from '../components/SalaryEnvelopeAnimation';
import { salaryApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import { useColors } from '../contexts/ThemeContext';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { Text } from '../platform/Typography';
import { haptic } from '../platform/haptics';
import { colors, fontSize, fontWeight, borderRadius, spacing, softTint } from '../theme';
import type { SemanticPalette } from '../theme/palette';
import { UserRole } from '../../../shared/types';
import type { MasterSalary, SalaryPayment, SalaryPremium } from '../../../shared/types';

// ── Helpers ────────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
] as const;

const MONTH_NAMES_GEN = [
  'Января',
  'Февраля',
  'Марта',
  'Апреля',
  'Мая',
  'Июня',
  'Июля',
  'Августа',
  'Сентября',
  'Октября',
  'Ноября',
  'Декабря',
] as const;

const RUBLE = '₽';

function formatMoney(v: number): string {
  if (!Number.isFinite(v)) v = 0;
  return (
    Math.round(v)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ' ') +
    ' ' +
    RUBLE
  );
}

function formatMoneyShort(v: number): string {
  // For chip rows where space is tight. 5 200 → 5.2k after ≥10 000 to
  // stay readable on iPhone SE width.
  if (Math.abs(v) >= 100000) return Math.round(v / 1000).toString() + ' к ' + RUBLE;
  return formatMoney(v);
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatMonthYear(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function formatPaymentDate(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getDate()} ${MONTH_NAMES_GEN[d.getMonth()]}`;
}

function formatConfirmedTimestamp(dateStr: string): string {
  const d = new Date(dateStr);
  const dd = d.getDate();
  const mm = MONTH_NAMES_GEN[d.getMonth()];
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${dd} ${mm} в ${hh}:${mi}`;
}

function getInitials(fullName?: string): string {
  if (!fullName) return '?';
  const parts = fullName.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return parts[0][0]?.toUpperCase() || '?';
}

const AVATAR_COLORS: [string, string][] = [
  [colors.primary[500], colors.primary[700]],
  [colors.green[500], colors.green[700]],
  [colors.orange[500], colors.orange[600]],
  [colors.purple[700], colors.indigo[600]],
  [colors.teal[600], colors.green[700]],
  [colors.rose[500], colors.rose[600]],
  [colors.amber[600], colors.orange[600]],
  [colors.blue[500], colors.blue[700]],
];

function getAvatarColors(name?: string): [string, string] {
  if (!name) return AVATAR_COLORS[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

// Status — calculated from the row's paid/remaining values.
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

// ── Employee row (compact) ─────────────────────────────────────────────────

interface EmployeeRowProps {
  master: MasterSalary;
  palette: SemanticPalette;
  onOpen: (m: MasterSalary) => void;
}

const EmployeeRow = React.memo(function EmployeeRow({ master, palette, onOpen }: EmployeeRowProps) {
  const avatar = getAvatarColors(master.masterName);
  const initials = getInitials(master.masterName);
  const status = rowStatus(master);
  const statusC = statusColors(status, palette);

  // Headline amount logic: when fully paid, surface the paidAmount (the
  // amount the owner cares about historically). When pending, surface
  // the remainingAmount — that's the actionable number.
  const headlineAmount = status === 'paid' ? master.paidAmount : master.remainingAmount;
  const headlineColor =
    status === 'paid' ? colors.green[600] : status === 'pending' ? palette.text.primary : colors.amber[600];

  const services = master.serviceEarnings || 0;
  const products = master.productEarnings || 0;
  const premiums = master.premiumsAmount || 0;
  const checks = master.checkCount || 0;

  return (
    <TouchableOpacity
      activeOpacity={0.72}
      onPress={() => {
        haptic('tap');
        onOpen(master);
      }}
      style={[styles.row, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
    >
      {/* Top line: avatar | name+pct | amount | chevron */}
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

      {/* Sub-line with chip stats — only render when there's content */}
      {checks + services + products + premiums > 0 ? (
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
          </Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
});

// ── Main Screen ────────────────────────────────────────────────────────────

export default function SalaryScreen() {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const { isRole } = useAuth();
  const palette = useColors();
  const canManagePayments = isRole(UserRole.DIRECTOR, UserRole.SUPERADMIN);
  const tabBarHeight = useTabBarHeight();

  // Month navigation — single source of truth.
  const [selectedMonth, setSelectedMonth] = useState<Date>(new Date());
  const year = selectedMonth.getFullYear();
  const monthIdx = selectedMonth.getMonth();
  const dateFrom = formatDate(new Date(year, monthIdx, 1));
  const dateTo = formatDate(new Date(year, monthIdx + 1, 0));
  const monthYear = formatMonthYear(selectedMonth);
  const monthLabel = `${MONTH_NAMES[monthIdx].slice(0, 3)} ${year}`;

  // Refreshing — manual pull-to-refresh.
  const [refreshing, setRefreshing] = useState(false);

  // Detail sheet — which employee row is expanded. We only store the
  // masterId so the detail sheet always reads the FRESHEST snapshot
  // from `salaries` (after a successful payment / premium mutation
  // we invalidate the query → list refetches → bottom-sheet contents
  // reflect the new paid/remaining numbers without needing manual
  // state sync).
  const [detailId, setDetailId] = useState<string | null>(null);

  // Form target — the master the user is paying / awarding for. Stored
  // separately from `detailId` because we MUST close the BottomSheet
  // before opening a follow-up `<Modal />`: iOS does not render two
  // stacked `RNModal`s at the same time — the inner one is silently
  // invisible. So we capture the master here, drop the sheet, and
  // submit handlers read from `formMasterId` instead of `detailMaster`.
  const [formMasterId, setFormMasterId] = useState<string | null>(null);
  const [formMasterName, setFormMasterName] = useState<string>('');

  // Payment form state.
  const [payModalVisible, setPayModalVisible] = useState(false);
  const [payType, setPayType] = useState<'salary' | 'advance'>('salary');
  const [payAmount, setPayAmount] = useState('');
  const [payComment, setPayComment] = useState('');
  const [payPendingFlag, setPayPendingFlag] = useState(false);

  // Premium form state.
  const [premiumModalVisible, setPremiumModalVisible] = useState(false);
  const [premiumType, setPremiumType] = useState<'cash' | 'rate_bonus'>('cash');
  const [premiumAmount, setPremiumAmount] = useState('');
  const [premiumPercent, setPremiumPercent] = useState('');
  const [premiumReason, setPremiumReason] = useState('');

  // Envelope animation overlay state.
  const [envelopeVisible, setEnvelopeVisible] = useState(false);
  const [envelopeAmount, setEnvelopeAmount] = useState(0);
  const [envelopeName, setEnvelopeName] = useState('');

  // ── Data ─────────────────────────────────────────────────────────────────

  const {
    data: salaries,
    isLoading,
    isError: isSalariesError,
    refetch: refetchSalaries,
  } = useQuery<MasterSalary[]>({
    queryKey: ['salary', dateFrom, dateTo],
    queryFn: async () => {
      const res = await salaryApi.getAll({ dateFrom, dateTo });
      return Array.isArray(res.data) ? res.data : [];
    },
    // SWR — keep previous month visible while user navigates between months.
    placeholderData: (prev) => prev,
  });

  // Derive the open detail master from the freshest list snapshot.
  const detailMaster = useMemo<MasterSalary | null>(() => {
    if (!detailId) return null;
    return (Array.isArray(salaries) ? salaries : []).find((m) => m.masterId === detailId) || null;
  }, [detailId, salaries]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['salary'] });
    setRefreshing(false);
  }, [queryClient]);

  // ── Mutations ────────────────────────────────────────────────────────────

  const paymentMutation = useMutation({
    mutationFn: (data: {
      userId: string;
      amount: number;
      monthYear: string;
      type: 'salary' | 'advance';
      comment?: string;
    }) => salaryApi.createPayment(data),
    onSuccess: (_, vars) => {
      // Close the payment form FIRST so the envelope can take the
      // foreground stage.
      setPayModalVisible(false);
      setPayComment('');
      setPayAmount('');
      // Snapshot the recipient name BEFORE clearing the stashed form
      // target so the envelope caption renders the right person.
      const masterName = formMasterName || detailMaster?.masterName || '';
      // Drop the detail sheet too (already dropped on openPayForm, but
      // belt-and-suspenders for the path where the user reopened it) —
      // the envelope deserves a clean stage.
      setDetailId(null);
      setEnvelopeAmount(vars.amount);
      setEnvelopeName(masterName);
      // Defer envelope by a tick on iOS — the just-dismissed <Modal/>
      // for the form needs to complete its hide animation before the
      // envelope's own RNModal can present cleanly.
      setTimeout(
        () => {
          setEnvelopeVisible(true);
        },
        Platform.OS === 'ios' ? 220 : 0,
      );
      setFormMasterId(null);
      queryClient.invalidateQueries({ queryKey: ['salary'] });
      // Salary paid out — cash leaves the till; owner expects the
      // dashboard cash position and cashflow ledger to drop immediately
      // without manual refresh.
      queryClient.invalidateQueries({ queryKey: ['dashboard-v2'] });
      queryClient.invalidateQueries({ queryKey: ['cashflow'] });
    },
    onError: (err: any) => {
      haptic('error');
      // eslint-disable-next-line no-console
      console.error('[Salary] payment error', err?.response?.status, err?.response?.data, err?.message);
      const friendly =
        err?.response?.data?.message || err?.response?.data?.error || err?.message || 'Не удалось создать выплату';
      Alert.alert('Ошибка', String(friendly));
    },
  });

  const premiumMutation = useMutation({
    mutationFn: (data: {
      userId: string;
      type: 'cash' | 'rate_bonus';
      amount?: number;
      bonusPercent?: number;
      reason: string;
      periodMonthYear?: string;
    }) => salaryApi.premiums.create(data),
    onSuccess: () => {
      setPremiumModalVisible(false);
      setPremiumAmount('');
      setPremiumPercent('');
      setPremiumReason('');
      setFormMasterId(null);
      haptic('success');
      queryClient.invalidateQueries({ queryKey: ['salary'] });
    },
    onError: (err: any) => {
      haptic('error');
      // eslint-disable-next-line no-console
      console.error('[Salary] premium error', err?.response?.status, err?.response?.data, err?.message);
      const friendly =
        err?.response?.data?.message || err?.response?.data?.error || err?.message || 'Не удалось добавить премию';
      Alert.alert('Ошибка', String(friendly));
    },
  });

  // ── Handlers ─────────────────────────────────────────────────────────────

  const openDetail = useCallback((m: MasterSalary) => {
    setDetailId(m.masterId);
  }, []);

  const closeDetail = useCallback(() => {
    setDetailId(null);
  }, []);

  const openPayForm = useCallback(
    (kind: 'salary' | 'advance') => {
      if (!detailMaster) return;
      haptic('tap');
      // Stash the master BEFORE closing the sheet — submitPayment reads
      // from formMaster* (not detailMaster) because once we drop the
      // sheet detailId goes null.
      setFormMasterId(detailMaster.masterId);
      setFormMasterName(detailMaster.masterName);
      setPayType(kind);
      setPayAmount(String(Math.max(0, Math.round(detailMaster.remainingAmount))));
      setPayComment('');
      // iOS cannot show two RNModals stacked: close the detail
      // BottomSheet first, then open the form on the next tick so the
      // first modal has time to dismiss before the second mounts.
      setDetailId(null);
      setTimeout(() => setPayModalVisible(true), Platform.OS === 'ios' ? 220 : 0);
    },
    [detailMaster],
  );

  const openPremiumForm = useCallback(() => {
    if (!detailMaster) return;
    haptic('tap');
    setFormMasterId(detailMaster.masterId);
    setFormMasterName(detailMaster.masterName);
    setPremiumType('cash');
    setPremiumAmount('');
    setPremiumPercent('');
    setPremiumReason('');
    // Same modal-stacking constraint as openPayForm.
    setDetailId(null);
    setTimeout(() => setPremiumModalVisible(true), Platform.OS === 'ios' ? 220 : 0);
  }, [detailMaster]);

  const submitPayment = useCallback(() => {
    if (!formMasterId) return;
    const amt = parseFloat(payAmount.replace(/\s+/g, '').replace(',', '.'));
    if (!Number.isFinite(amt) || amt <= 0) {
      Alert.alert('Ошибка', 'Укажите корректную сумму');
      return;
    }
    setPayPendingFlag(true);
    paymentMutation.mutate(
      {
        userId: formMasterId,
        amount: amt,
        monthYear,
        type: payType,
        comment: payComment || undefined,
      },
      {
        onSettled: () => setPayPendingFlag(false),
      },
    );
  }, [formMasterId, payAmount, payType, payComment, monthYear, paymentMutation]);

  const submitPremium = useCallback(() => {
    if (!formMasterId) return;
    if (!premiumReason.trim()) {
      Alert.alert('Ошибка', 'Опишите причину премии');
      return;
    }
    if (premiumType === 'cash') {
      const amt = parseFloat(premiumAmount.replace(/\s+/g, '').replace(',', '.'));
      if (!Number.isFinite(amt) || amt <= 0) {
        Alert.alert('Ошибка', 'Укажите сумму премии');
        return;
      }
      premiumMutation.mutate({
        userId: formMasterId,
        type: 'cash',
        amount: amt,
        reason: premiumReason.trim(),
        periodMonthYear: monthYear,
      });
    } else {
      const pct = parseFloat(premiumPercent.replace(/\s+/g, '').replace(',', '.'));
      if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
        Alert.alert('Ошибка', 'Процент должен быть от 1 до 100');
        return;
      }
      premiumMutation.mutate({
        userId: formMasterId,
        type: 'rate_bonus',
        bonusPercent: pct,
        reason: premiumReason.trim(),
        periodMonthYear: monthYear,
      });
    }
  }, [formMasterId, premiumReason, premiumType, premiumAmount, premiumPercent, monthYear, premiumMutation]);

  // ── Summary totals ───────────────────────────────────────────────────────

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

  // ── Month navigation ─────────────────────────────────────────────────────

  const prevMonthNav = useCallback(() => {
    haptic('select');
    setSelectedMonth((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  }, []);

  const nextMonthNav = useCallback(() => {
    haptic('select');
    setSelectedMonth((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1));
  }, []);

  const resetMonth = useCallback(() => {
    haptic('tap');
    setSelectedMonth(new Date());
  }, []);

  // Trailing slot — month chip with ‹ Май 2026 › arrows. Same look as
  // ScheduleScreen's header so the two screens read as siblings.
  const trailingMonthChip = (
    <View style={[styles.monthChip, { backgroundColor: palette.bg.muted }]}>
      <TouchableOpacity onPress={prevMonthNav} hitSlop={6} style={styles.monthChipBtn}>
        <Ionicons name="chevron-back" size={16} color={palette.text.secondary} />
      </TouchableOpacity>
      <TouchableOpacity onPress={resetMonth} activeOpacity={0.7}>
        <Text style={[styles.monthChipLabel, { color: palette.text.primary }]}>{monthLabel}</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={nextMonthNav} hitSlop={6} style={styles.monthChipBtn}>
        <Ionicons name="chevron-forward" size={16} color={palette.text.secondary} />
      </TouchableOpacity>
    </View>
  );

  // ── Render ───────────────────────────────────────────────────────────────

  const renderItem = useCallback(
    ({ item }: { item: MasterSalary }) => <EmployeeRow master={item} palette={palette} onOpen={openDetail} />,
    [palette, openDetail],
  );

  const keyExtractor = useCallback((item: MasterSalary) => item.masterId, []);

  // Summary card — three-column compact card. Renders as the first
  // ListHeaderComponent so it scrolls away with content; owner asked for
  // the FOT / Выплачено / К выплате row NOT to stick (it was hiding the
  // freshest rows when paging down). The card is built on `iosCard`
  // primitive so it sits inside the gray-50 canvas like every other
  // section card in the app.
  const summaryHeader = (
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
  );

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title="Зарплата" onBack={() => navigation.goBack()} trailing={trailingMonthChip} />

      {isSalariesError && salaries === undefined ? (
        // Запрос упал и кэша нет — честный error-state вместо вечного
        // спиннера. Пока есть прошлые данные, SWR показывает их.
        <QueryErrorState description="Проверьте соединение и попробуйте ещё раз" onRetry={() => refetchSalaries()} />
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
          // Summary card scrolls AWAY with content — owner explicitly
          // asked for non-sticky behaviour. The previous on-screen
          // sticky bar was obscuring rows when paging down on iPhone SE.
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

      {/* Detail sheet */}
      <BottomSheet
        visible={!!detailMaster}
        onClose={closeDetail}
        title={detailMaster?.masterName || ''}
        heightRatio={0.86}
      >
        {detailMaster ? (
          <DetailContent
            master={detailMaster}
            palette={palette}
            monthLabel={MONTH_NAMES[monthIdx] + ' ' + year}
            onPay={openPayForm}
            onPremium={openPremiumForm}
            canManage={canManagePayments}
          />
        ) : null}
      </BottomSheet>

      {/* Payment form modal */}
      <Modal
        visible={payModalVisible}
        onClose={() => {
          setPayModalVisible(false);
          setFormMasterId(null);
        }}
        title={
          (payType === 'salary' ? 'Выдать зарплату' : 'Выдать аванс') + (formMasterName ? ' — ' + formMasterName : '')
        }
      >
        <PaymentForm
          palette={palette}
          payType={payType}
          setPayType={setPayType}
          amount={payAmount}
          setAmount={setPayAmount}
          comment={payComment}
          setComment={setPayComment}
          submit={submitPayment}
          pending={paymentMutation.isPending || payPendingFlag}
          cancel={() => {
            setPayModalVisible(false);
            setFormMasterId(null);
          }}
        />
      </Modal>

      {/* Premium form modal */}
      <Modal
        visible={premiumModalVisible}
        onClose={() => {
          setPremiumModalVisible(false);
          setFormMasterId(null);
        }}
        title={'Премия сотруднику' + (formMasterName ? ' — ' + formMasterName : '')}
      >
        <PremiumForm
          palette={palette}
          premiumType={premiumType}
          setPremiumType={setPremiumType}
          amount={premiumAmount}
          setAmount={setPremiumAmount}
          percent={premiumPercent}
          setPercent={setPremiumPercent}
          reason={premiumReason}
          setReason={setPremiumReason}
          submit={submitPremium}
          pending={premiumMutation.isPending}
          cancel={() => {
            setPremiumModalVisible(false);
            setFormMasterId(null);
          }}
        />
      </Modal>

      {/* Celebratory envelope animation */}
      <SalaryEnvelopeAnimation
        visible={envelopeVisible}
        amount={envelopeAmount}
        employeeName={envelopeName}
        onComplete={() => setEnvelopeVisible(false)}
      />
    </View>
  );
}

// ── Tiny module-level helpers ─────────────────────────────────────────────

function ListSeparator() {
  return <View style={{ height: spacing[2.5] }} />;
}

// ── Detail sheet content ──────────────────────────────────────────────────

interface DetailContentProps {
  master: MasterSalary;
  palette: SemanticPalette;
  monthLabel: string;
  onPay: (type: 'salary' | 'advance') => void;
  onPremium: () => void;
  canManage: boolean;
}

function DetailContent({ master, palette, monthLabel, onPay, onPremium, canManage }: DetailContentProps) {
  // Collapsible state for breakdown rows. Default-expanded since the
  // breakdown is the primary content; user can collapse if it gets noisy.
  const [showBreakdown, setShowBreakdown] = useState(true);
  const [showPremiums, setShowPremiums] = useState(true);
  const [showHistory, setShowHistory] = useState(true);

  const services = master.serviceEarnings || 0;
  const products = master.productEarnings || 0;
  const premiumsAmount = master.premiumsAmount || 0;
  const premiumList: SalaryPremium[] = Array.isArray(master.premiums) ? master.premiums : [];
  const payments: SalaryPayment[] = Array.isArray(master.payments) ? master.payments : [];
  const status = rowStatus(master);
  const statusC = statusColors(status, palette);

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing[8] }}>
      {/* Hero */}
      <View style={styles.detailHero}>
        <Text style={[styles.detailHeroMonth, { color: palette.text.tertiary }]}>{monthLabel}</Text>
        <Text style={[styles.detailHeroAmount, { color: palette.text.primary }]}>
          {formatMoney(master.remainingAmount > 0.5 ? master.remainingAmount : master.paidAmount)}
        </Text>
        <View style={[styles.detailHeroPill, { backgroundColor: statusC.bg }]}>
          <Text style={[styles.detailHeroPillText, { color: statusC.text }]}>{statusLabel(status)}</Text>
        </View>
      </View>

      {/* Stats summary */}
      <View style={[styles.detailStatsCard, { backgroundColor: palette.bg.muted }]}>
        <DetailStatRow label="Начислено" value={formatMoney(master.totalEarnings)} palette={palette} />
        <DetailStatRow label="Выплачено" value={formatMoney(master.paidAmount)} palette={palette} />
        <DetailStatRow
          label="К выплате"
          value={formatMoney(master.remainingAmount)}
          highlight={master.remainingAmount > 0.5 ? colors.amber[700] : undefined}
          palette={palette}
        />
        <DetailStatRow label="Чеков" value={String(master.checkCount)} palette={palette} />
      </View>

      {/* Breakdown — collapsible */}
      <CollapsibleSection
        title="Разбивка"
        icon="pie-chart-outline"
        expanded={showBreakdown}
        onToggle={() => setShowBreakdown((v) => !v)}
        palette={palette}
      >
        <BreakdownRow
          icon="cut-outline"
          color={colors.primary[600]}
          label="Услуги"
          subLabel={`${master.salaryPercent}% от выручки`}
          value={services}
          palette={palette}
        />
        <BreakdownRow
          icon="cube-outline"
          color={colors.amber[700]}
          label="Товары"
          subLabel={master.productSalaryPercent ? `${master.productSalaryPercent}% от выручки` : 'Без процента'}
          value={products}
          palette={palette}
        />
        <BreakdownRow
          icon="gift-outline"
          color={colors.rose[600]}
          label="Премии (cash)"
          subLabel={premiumList.filter((p) => p.type === 'cash').length + ' шт'}
          value={premiumsAmount}
          palette={palette}
        />
      </CollapsibleSection>

      {/* Premiums list */}
      <CollapsibleSection
        title="Премии за месяц"
        icon="gift-outline"
        expanded={showPremiums}
        onToggle={() => setShowPremiums((v) => !v)}
        palette={palette}
        rightAccessory={
          <Text style={[styles.sectionCount, { color: palette.text.tertiary }]}>{premiumList.length}</Text>
        }
      >
        {premiumList.length === 0 ? (
          <Text style={[styles.emptyInline, { color: palette.text.tertiary }]}>Премий не начислялось</Text>
        ) : (
          premiumList.map((p) => <PremiumRow key={p.id} premium={p} palette={palette} />)
        )}
      </CollapsibleSection>

      {/* Payment history */}
      <CollapsibleSection
        title="История выплат"
        icon="time-outline"
        expanded={showHistory}
        onToggle={() => setShowHistory((v) => !v)}
        palette={palette}
        rightAccessory={<Text style={[styles.sectionCount, { color: palette.text.tertiary }]}>{payments.length}</Text>}
      >
        {payments.length === 0 ? (
          <Text style={[styles.emptyInline, { color: palette.text.tertiary }]}>Выплат пока нет</Text>
        ) : (
          payments.map((p) => <PaymentRow key={p.id} payment={p} palette={palette} />)
        )}
      </CollapsibleSection>

      {/* CTAs */}
      {canManage ? (
        <View style={styles.ctaRow}>
          <TouchableOpacity
            style={styles.ctaPrimary}
            activeOpacity={0.85}
            onPress={() => onPay(master.remainingAmount > 0.5 && master.paidAmount === 0 ? 'salary' : 'salary')}
          >
            <LinearGradient
              colors={[colors.green[500], colors.green[700]] as [string, string]}
              style={styles.ctaPrimaryGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
            >
              {/* Outline send glyph — owner explicitly asked NOT to use
                  the heavy filled wallet here. Clean stroke reads better
                  on the green gradient. */}
              <Ionicons name="paper-plane-outline" size={18} color={colors.white} />
              <Text style={styles.ctaPrimaryText}>Выдать зарплату</Text>
            </LinearGradient>
          </TouchableOpacity>
          <TouchableOpacity style={styles.ctaSecondary} activeOpacity={0.85} onPress={() => onPay('advance')}>
            <LinearGradient
              colors={[colors.amber[600], colors.orange[600]] as [string, string]}
              style={styles.ctaPrimaryGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
            >
              {/* Card-outline reads as "выдать наличные / аванс"
                  unambiguously — and is in the icon map. The previous
                  `flash` was filled and rendered as a heavy blob. */}
              <Ionicons name="card-outline" size={18} color={colors.white} />
              <Text style={styles.ctaPrimaryText}>Аванс</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      ) : null}

      {canManage ? (
        <TouchableOpacity style={styles.premiumCta} activeOpacity={0.8} onPress={onPremium}>
          <View style={[styles.premiumCtaInner, { borderColor: palette.border.strong }]}>
            {/* Gift-outline already mapped — used as the canonical
                "премия" affordance across the app. `ribbon` filled was
                rendering as a Circle blob before today's icon-map update. */}
            <Ionicons name="gift-outline" size={18} color={colors.rose[600]} />
            <Text style={[styles.premiumCtaText, { color: palette.text.primary }]}>Добавить премию</Text>
          </View>
        </TouchableOpacity>
      ) : null}
    </ScrollView>
  );
}

// ── Detail building blocks ────────────────────────────────────────────────

interface DetailStatRowProps {
  label: string;
  value: string;
  highlight?: string;
  palette: SemanticPalette;
}

function DetailStatRow({ label, value, highlight, palette }: DetailStatRowProps) {
  return (
    <View style={styles.statRow}>
      <Text style={[styles.statRowLabel, { color: palette.text.secondary }]}>{label}</Text>
      <Text style={[styles.statRowValue, { color: highlight ?? palette.text.primary }]}>{value}</Text>
    </View>
  );
}

interface CollapsibleSectionProps {
  title: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  expanded: boolean;
  onToggle: () => void;
  palette: SemanticPalette;
  rightAccessory?: React.ReactNode;
  children: React.ReactNode;
}

function CollapsibleSection({
  title,
  icon,
  expanded,
  onToggle,
  palette,
  rightAccessory,
  children,
}: CollapsibleSectionProps) {
  return (
    <View style={[styles.sectionWrap, { borderColor: palette.border.subtle }]}>
      <TouchableOpacity onPress={onToggle} activeOpacity={0.7} style={styles.sectionHeader}>
        <Ionicons name={icon} size={16} color={palette.text.secondary} />
        <Text style={[styles.sectionTitle, { color: palette.text.primary }]}>{title}</Text>
        <View style={{ flex: 1 }} />
        {rightAccessory}
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={16}
          color={palette.text.tertiary}
          style={{ marginLeft: spacing[1] }}
        />
      </TouchableOpacity>
      {expanded ? <View style={styles.sectionBody}>{children}</View> : null}
    </View>
  );
}

interface BreakdownRowProps {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  color: string;
  label: string;
  subLabel?: string;
  value: number;
  palette: SemanticPalette;
}

function BreakdownRow({ icon, color, label, subLabel, value, palette }: BreakdownRowProps) {
  return (
    <View style={styles.breakdownRow}>
      <View style={[styles.breakdownIcon, { backgroundColor: palette.bg.muted }]}>
        <Ionicons name={icon} size={14} color={color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.breakdownLabel, { color: palette.text.primary }]}>{label}</Text>
        {subLabel ? <Text style={[styles.breakdownSub, { color: palette.text.tertiary }]}>{subLabel}</Text> : null}
      </View>
      <Text style={[styles.breakdownValue, { color: palette.text.primary }]}>{formatMoney(value)}</Text>
    </View>
  );
}

interface PremiumRowProps {
  premium: SalaryPremium;
  palette: SemanticPalette;
}

function PremiumRow({ premium, palette }: PremiumRowProps) {
  const isCash = premium.type === 'cash';
  const value = isCash ? formatMoney(premium.amount || 0) : `+${premium.bonusPercent || 0}% к ставке`;
  return (
    <View style={[styles.premiumRow, { borderBottomColor: palette.border.subtle }]}>
      <View
        style={[
          styles.premiumIcon,
          {
            backgroundColor:
              palette.mode === 'dark'
                ? softTint(isCash ? colors.rose[600] : colors.violet[600], 'dark')
                : isCash
                  ? colors.rose[50]
                  : colors.violet[50],
          },
        ]}
      >
        <Ionicons
          name={isCash ? 'gift-outline' : 'trending-up-outline'}
          size={14}
          color={isCash ? colors.rose[600] : colors.violet[600]}
        />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.premiumReason, { color: palette.text.primary }]} numberOfLines={2}>
          {premium.reason}
        </Text>
        {premium.awarderName ? (
          <Text style={[styles.premiumMeta, { color: palette.text.tertiary }]} numberOfLines={1}>
            от {premium.awarderName}
          </Text>
        ) : null}
      </View>
      <Text style={[styles.premiumValue, { color: isCash ? colors.rose[600] : colors.violet[600] }]}>{value}</Text>
    </View>
  );
}

interface PaymentRowProps {
  payment: SalaryPayment;
  palette: SemanticPalette;
}

function PaymentRow({ payment, palette }: PaymentRowProps) {
  const isAdvance = payment.type === 'advance';
  const isPremium = payment.type === 'premium';
  const tone = isAdvance ? colors.amber[600] : isPremium ? colors.rose[600] : colors.green[600];
  const label = isAdvance ? 'Аванс' : isPremium ? 'Премия' : 'Зарплата';
  return (
    <View style={[styles.paymentRow, { borderBottomColor: palette.border.subtle }]}>
      <View style={styles.paymentRowLeft}>
        <View style={[styles.paymentTypeBadge, { borderColor: tone }]}>
          <Text style={[styles.paymentTypeBadgeText, { color: tone }]}>{label}</Text>
        </View>
        <Text style={[styles.paymentRowDate, { color: palette.text.tertiary }]}>{formatPaymentDate(payment.date)}</Text>
        {payment.comment ? (
          <Text style={[styles.paymentRowComment, { color: palette.text.tertiary }]} numberOfLines={2}>
            «{payment.comment}»
          </Text>
        ) : null}
        {payment.confirmedAt ? (
          <View style={styles.paymentRowConfirmed}>
            <Ionicons name="checkmark-circle" size={14} color={colors.green[600]} />
            <Text style={[styles.paymentRowConfirmedText, { color: colors.green[600] }]}>
              Получено {formatConfirmedTimestamp(payment.confirmedAt)}
            </Text>
          </View>
        ) : (
          <View style={styles.paymentRowConfirmed}>
            <Ionicons name="time-outline" size={12} color={colors.amber[600]} />
            <Text style={[styles.paymentRowConfirmedText, { color: colors.amber[600] }]}>Ждём подтверждения</Text>
          </View>
        )}
      </View>
      <Text style={[styles.paymentRowAmount, { color: palette.text.primary }]}>{formatMoney(payment.amount)}</Text>
    </View>
  );
}

// ── Forms ─────────────────────────────────────────────────────────────────

interface PaymentFormProps {
  palette: SemanticPalette;
  payType: 'salary' | 'advance';
  setPayType: (t: 'salary' | 'advance') => void;
  amount: string;
  setAmount: (v: string) => void;
  comment: string;
  setComment: (v: string) => void;
  submit: () => void;
  pending: boolean;
  cancel: () => void;
}

function PaymentForm({
  palette,
  payType,
  setPayType,
  amount,
  setAmount,
  comment,
  setComment,
  submit,
  pending,
  cancel,
}: PaymentFormProps) {
  return (
    <>
      <View style={styles.formField}>
        <Text style={[styles.formLabel, { color: palette.text.secondary }]}>Тип</Text>
        <View style={[styles.typeToggleRow, { backgroundColor: palette.bg.muted }]}>
          <TypeChip
            active={payType === 'salary'}
            onPress={() => {
              haptic('select');
              setPayType('salary');
            }}
            icon="wallet-outline"
            label="Зарплата"
            gradient={[colors.green[500], colors.green[700]]}
            palette={palette}
          />
          <TypeChip
            active={payType === 'advance'}
            onPress={() => {
              haptic('select');
              setPayType('advance');
            }}
            icon="flash-outline"
            label="Аванс"
            gradient={[colors.amber[600], colors.orange[600]]}
            palette={palette}
          />
        </View>
      </View>

      <View style={styles.formField}>
        <Text style={[styles.formLabel, { color: palette.text.secondary }]}>Сумма</Text>
        <View style={[styles.formInputRow, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}>
          <Ionicons name="cash-outline" size={16} color={palette.text.tertiary} />
          <TextInput
            style={[styles.formTextInput, { color: palette.text.primary }]}
            value={amount}
            onChangeText={setAmount}
            keyboardType="numeric"
            placeholder="0"
            placeholderTextColor={palette.text.tertiary}
          />
          <Text style={[styles.formCurrency, { color: palette.text.tertiary }]}>{RUBLE}</Text>
        </View>
      </View>

      <View style={styles.formField}>
        <Text style={[styles.formLabel, { color: palette.text.secondary }]}>Комментарий (необязательно)</Text>
        <View style={[styles.formInputRow, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}>
          <Ionicons name="chatbubble-outline" size={14} color={palette.text.tertiary} />
          <TextInput
            style={[styles.formTextInput, { color: palette.text.primary }]}
            value={comment}
            onChangeText={setComment}
            placeholder="Добавить комментарий…"
            placeholderTextColor={palette.text.tertiary}
            multiline
          />
        </View>
      </View>

      <View style={styles.formActions}>
        <TouchableOpacity
          style={[styles.cancelBtn, { backgroundColor: palette.bg.muted }]}
          onPress={cancel}
          activeOpacity={0.75}
        >
          <Text style={[styles.cancelBtnText, { color: palette.text.secondary }]}>Отмена</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.submitBtn} onPress={submit} activeOpacity={0.75} disabled={pending}>
          {pending ? (
            <View style={[styles.submitBtnGradient, { backgroundColor: colors.green[600] }]}>
              <ActivityIndicator color={colors.white} />
            </View>
          ) : (
            <LinearGradient
              colors={[colors.green[500], colors.green[700]] as [string, string]}
              style={styles.submitBtnGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
            >
              <Ionicons name="checkmark" size={18} color={colors.white} />
              <Text style={styles.submitBtnText}>Выдать</Text>
            </LinearGradient>
          )}
        </TouchableOpacity>
      </View>
    </>
  );
}

interface PremiumFormProps {
  palette: SemanticPalette;
  premiumType: 'cash' | 'rate_bonus';
  setPremiumType: (t: 'cash' | 'rate_bonus') => void;
  amount: string;
  setAmount: (v: string) => void;
  percent: string;
  setPercent: (v: string) => void;
  reason: string;
  setReason: (v: string) => void;
  submit: () => void;
  pending: boolean;
  cancel: () => void;
}

function PremiumForm({
  palette,
  premiumType,
  setPremiumType,
  amount,
  setAmount,
  percent,
  setPercent,
  reason,
  setReason,
  submit,
  pending,
  cancel,
}: PremiumFormProps) {
  return (
    <>
      <View style={styles.formField}>
        <Text style={[styles.formLabel, { color: palette.text.secondary }]}>Тип премии</Text>
        <View style={[styles.typeToggleRow, { backgroundColor: palette.bg.muted }]}>
          <TypeChip
            active={premiumType === 'cash'}
            onPress={() => {
              haptic('select');
              setPremiumType('cash');
            }}
            icon="cash-outline"
            label="Сумма"
            gradient={[colors.rose[500], colors.rose[700]]}
            palette={palette}
          />
          <TypeChip
            active={premiumType === 'rate_bonus'}
            onPress={() => {
              haptic('select');
              setPremiumType('rate_bonus');
            }}
            icon="trending-up-outline"
            label="% к ставке"
            gradient={[colors.violet[500], colors.violet[600]]}
            palette={palette}
          />
        </View>
      </View>

      {premiumType === 'cash' ? (
        <View style={styles.formField}>
          <Text style={[styles.formLabel, { color: palette.text.secondary }]}>Сумма</Text>
          <View
            style={[styles.formInputRow, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
          >
            <Ionicons name="cash-outline" size={16} color={palette.text.tertiary} />
            <TextInput
              style={[styles.formTextInput, { color: palette.text.primary }]}
              value={amount}
              onChangeText={setAmount}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor={palette.text.tertiary}
            />
            <Text style={[styles.formCurrency, { color: palette.text.tertiary }]}>{RUBLE}</Text>
          </View>
        </View>
      ) : (
        <View style={styles.formField}>
          <Text style={[styles.formLabel, { color: palette.text.secondary }]}>Бонус-процент</Text>
          <View
            style={[styles.formInputRow, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
          >
            <Ionicons name="trending-up-outline" size={16} color={palette.text.tertiary} />
            <TextInput
              style={[styles.formTextInput, { color: palette.text.primary }]}
              value={percent}
              onChangeText={setPercent}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor={palette.text.tertiary}
            />
            <Text style={[styles.formCurrency, { color: palette.text.tertiary }]}>%</Text>
          </View>
          <Text style={[styles.formHelper, { color: palette.text.tertiary }]}>
            Добавится к проценту мастера на текущий месяц
          </Text>
        </View>
      )}

      <View style={styles.formField}>
        <Text style={[styles.formLabel, { color: palette.text.secondary }]}>Причина</Text>
        <View
          style={[
            styles.formInputRow,
            { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, minHeight: 70 },
          ]}
        >
          <Ionicons name="document-text-outline" size={14} color={palette.text.tertiary} />
          <TextInput
            style={[styles.formTextInput, { color: palette.text.primary }]}
            value={reason}
            onChangeText={setReason}
            placeholder="За что начисляется премия"
            placeholderTextColor={palette.text.tertiary}
            multiline
          />
        </View>
      </View>

      <View style={styles.formActions}>
        <TouchableOpacity
          style={[styles.cancelBtn, { backgroundColor: palette.bg.muted }]}
          onPress={cancel}
          activeOpacity={0.75}
        >
          <Text style={[styles.cancelBtnText, { color: palette.text.secondary }]}>Отмена</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.submitBtn} onPress={submit} activeOpacity={0.75} disabled={pending}>
          {pending ? (
            <View style={[styles.submitBtnGradient, { backgroundColor: colors.rose[600] }]}>
              <ActivityIndicator color={colors.white} />
            </View>
          ) : (
            <LinearGradient
              colors={[colors.rose[500], colors.rose[600]] as [string, string]}
              style={styles.submitBtnGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
            >
              <Ionicons name="ribbon" size={18} color={colors.white} />
              <Text style={styles.submitBtnText}>Начислить</Text>
            </LinearGradient>
          )}
        </TouchableOpacity>
      </View>
    </>
  );
}

interface TypeChipProps {
  active: boolean;
  onPress: () => void;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  gradient: [string, string];
  palette: SemanticPalette;
}

function TypeChip({ active, onPress, icon, label, gradient, palette }: TypeChipProps) {
  return (
    <TouchableOpacity style={styles.typeChip} activeOpacity={0.75} onPress={onPress}>
      {active ? (
        <LinearGradient colors={gradient} style={styles.typeChipGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
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

// ── Styles ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1 },

  // Header trailing slot
  monthChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'transparent',
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing[1],
    paddingVertical: 4,
  },
  monthChipBtn: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthChipLabel: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    minWidth: 72,
    textAlign: 'center',
    letterSpacing: -0.2,
  },

  // Summary card — three-column compact card. Lives as the first
  // ListHeaderComponent inside the FlashList; it intentionally scrolls
  // away with content (owner wanted to see the freshest rows when paging
  // down). Hairline border + soft elevation matches `iosCard`.
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
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  summaryCell: {
    flex: 1,
    alignItems: 'flex-start',
    gap: 4,
  },
  summaryDivider: {
    width: StyleSheet.hairlineWidth,
    height: 32,
    marginHorizontal: spacing[3],
  },
  summaryCellLabel: {
    fontSize: 10,
    fontWeight: fontWeight.medium,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  summaryCellValue: {
    fontSize: fontSize.base,
    lineHeight: 22,
    fontWeight: fontWeight.bold,
    letterSpacing: -0.3,
    includeFontPadding: false,
  },

  // Empty state
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
  emptyTitle: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
  },
  emptySubtitle: {
    fontSize: fontSize.xs,
    textAlign: 'center',
  },

  // Compact row
  row: {
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    gap: spacing[2],
    minHeight: 68,
  },
  rowTopLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
  },
  rowAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowAvatarText: {
    fontSize: 13,
    fontWeight: fontWeight.bold,
    color: colors.white,
    letterSpacing: 0.2,
  },
  rowNameCol: {
    flex: 1,
    gap: 3,
  },
  rowName: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    letterSpacing: -0.2,
  },
  rowSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexWrap: 'wrap',
  },
  rowPercentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  rowPercentText: {
    fontSize: 10,
    fontWeight: fontWeight.semibold,
  },
  rowStatusPill: {
    paddingHorizontal: spacing[1.5],
    paddingVertical: 2,
    borderRadius: 8,
  },
  rowStatusText: {
    fontSize: 10,
    fontWeight: fontWeight.semibold,
  },
  rowAmountCol: {
    alignItems: 'flex-end',
    gap: 0,
  },
  rowAmount: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.bold,
    letterSpacing: -0.4,
  },
  rowChipsLine: {
    paddingLeft: 36 + spacing[3],
  },
  rowChipsText: {
    fontSize: 11,
    fontWeight: fontWeight.medium,
  },

  // Detail hero
  // Owner reported "верх суммы обрезан" inside the employee detail
  // sheet — the 36pt number under "Май 2026" was getting clipped at
  // the top edge of its Text box. lineHeight ≈ fontSize × 1.2 fixes
  // it; minHeight prevents the same regression if the wrapping View
  // ever picks up a fixed height.
  detailHero: {
    alignItems: 'center',
    paddingTop: spacing[3],
    paddingBottom: spacing[4],
    gap: 6,
  },
  detailHeroMonth: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  detailHeroAmount: {
    fontSize: 36,
    lineHeight: 44,
    fontWeight: fontWeight.bold,
    letterSpacing: -1,
    includeFontPadding: false,
    paddingTop: 2,
  },
  detailHeroPill: {
    marginTop: spacing[2],
    paddingHorizontal: spacing[2.5],
    paddingVertical: 4,
    borderRadius: 999,
  },
  detailHeroPillText: {
    fontSize: 11,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.2,
  },

  // Detail stats card
  detailStatsCard: {
    borderRadius: borderRadius['2xl'],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    marginBottom: spacing[3],
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing[1.5],
  },
  statRowLabel: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  statRowValue: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
  },

  // Collapsible section
  sectionWrap: {
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: spacing[3],
    overflow: 'hidden',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    gap: spacing[2],
  },
  sectionTitle: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    letterSpacing: -0.2,
  },
  sectionCount: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
  },
  sectionBody: {
    paddingHorizontal: spacing[3],
    paddingBottom: spacing[3],
  },
  emptyInline: {
    fontSize: fontSize.xs,
    paddingVertical: spacing[2],
    textAlign: 'center',
  },

  // Breakdown row
  breakdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing[2],
    gap: spacing[3],
  },
  breakdownIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  breakdownLabel: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
  breakdownSub: {
    fontSize: 11,
    marginTop: 1,
  },
  breakdownValue: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
  },

  // Premium row
  premiumRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2.5],
    paddingVertical: spacing[2.5],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  premiumIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  premiumReason: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  premiumMeta: {
    fontSize: 11,
    marginTop: 1,
  },
  premiumValue: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
  },

  // Payment history row
  paymentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingVertical: spacing[2.5],
    gap: spacing[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  paymentRowLeft: {
    flex: 1,
    gap: 4,
  },
  paymentTypeBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing[2],
    paddingVertical: 1,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  paymentTypeBadgeText: {
    fontSize: 10,
    fontWeight: fontWeight.bold,
    letterSpacing: 0.3,
  },
  paymentRowDate: {
    fontSize: 11,
  },
  paymentRowComment: {
    fontSize: 11,
    fontStyle: 'italic',
  },
  paymentRowConfirmed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  paymentRowConfirmedText: {
    fontSize: 11,
    fontWeight: fontWeight.medium,
  },
  paymentRowAmount: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
  },

  // CTAs
  ctaRow: {
    flexDirection: 'row',
    gap: spacing[2],
    marginTop: spacing[3],
  },
  ctaPrimary: {
    flex: 2,
    borderRadius: borderRadius['2xl'],
    overflow: 'hidden',
  },
  ctaSecondary: {
    flex: 1,
    borderRadius: borderRadius['2xl'],
    overflow: 'hidden',
  },
  ctaPrimaryGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[3.5],
    gap: spacing[2],
  },
  ctaPrimaryText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    color: colors.white,
    letterSpacing: -0.2,
  },
  premiumCta: {
    marginTop: spacing[2],
    borderRadius: borderRadius['2xl'],
    overflow: 'hidden',
  },
  premiumCtaInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[3],
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius['2xl'],
  },
  premiumCtaText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },

  // Forms (shared between payment + premium)
  formField: {
    marginBottom: spacing[4],
  },
  formLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    marginBottom: spacing[2],
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  formInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    gap: spacing[2],
  },
  formTextInput: {
    flex: 1,
    fontSize: fontSize.sm,
    padding: 0,
  },
  formCurrency: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
  },
  formHelper: {
    fontSize: fontSize.xs,
    marginTop: spacing[1],
  },
  formActions: {
    flexDirection: 'row',
    gap: spacing[3],
    marginTop: spacing[2],
  },
  cancelBtn: {
    flex: 1,
    borderRadius: borderRadius.xl,
    paddingVertical: spacing[3],
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
  submitBtn: {
    flex: 2,
    borderRadius: borderRadius.xl,
    overflow: 'hidden',
  },
  submitBtnGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[3],
    borderRadius: borderRadius.xl,
  },
  submitBtnText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    color: colors.white,
  },

  // Type chip toggle (used in both forms)
  typeToggleRow: {
    flexDirection: 'row',
    borderRadius: borderRadius.xl,
    padding: 3,
    gap: 3,
  },
  typeChip: {
    flex: 1,
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
  },
  typeChipGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1.5],
    paddingVertical: spacing[2.5],
  },
  typeChipInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1.5],
    paddingVertical: spacing[2.5],
  },
  typeChipText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
  },
  typeChipTextActive: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    color: colors.white,
  },
});
