import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Alert,
} from 'react-native';
import IosScreenHeader from '../components/IosScreenHeader';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { salaryApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import { useColors } from '../contexts/ThemeContext';
import LoadingSpinner from '../components/LoadingSpinner';
import Modal from '../components/Modal';
import AnimatedCard from '../components/AnimatedCard';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { UserRole } from '../../../shared/types';
import type { MasterSalary, SalaryPayment } from '../../../shared/types';

// ── Helpers ──

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
];

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
];

function formatMoney(v: number): string {
  return (
    Math.round(v)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' \u20BD'
  );
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatMonthYear(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function formatPaymentDate(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getDate()} ${MONTH_NAMES_GEN[d.getMonth()]} ${d.getFullYear()}`;
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

// ── Main Screen ──

export default function SalaryScreen() {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const { user, isRole } = useAuth();
  const palette = useColors();
  const canManagePayments = isRole(UserRole.DIRECTOR, UserRole.SUPERADMIN);
  const tabBarHeight = useTabBarHeight();

  // Month navigation state
  const [selectedMonth, setSelectedMonth] = useState<Date>(new Date());
  const year = selectedMonth.getFullYear();
  const month = selectedMonth.getMonth();
  const dateFrom = formatDate(new Date(year, month, 1));
  const dateTo = formatDate(new Date(year, month + 1, 0));
  const monthYear = formatMonthYear(selectedMonth);

  // Refreshing
  const [refreshing, setRefreshing] = useState(false);

  // Expanded master card
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Payment modal state
  const [payModalVisible, setPayModalVisible] = useState(false);
  const [payUserId, setPayUserId] = useState('');
  const [payUserName, setPayUserName] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [payMonthYear, setPayMonthYear] = useState(monthYear);
  const [payType, setPayType] = useState<'salary' | 'advance'>('salary');
  const [payComment, setPayComment] = useState('');

  // Data
  const { data: salaries, isLoading } = useQuery<MasterSalary[]>({
    queryKey: ['salary', dateFrom, dateTo],
    queryFn: async () => {
      const res = await salaryApi.getAll({ dateFrom, dateTo });
      return res.data;
    },
    // SWR — keep previous month's salary card visible while the user
    // navigates between months; no spinner mid-swipe.
    placeholderData: (prev) => prev,
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['salary'] });
    setRefreshing(false);
  };

  // Payment mutation
  const paymentMutation = useMutation({
    mutationFn: (data: {
      userId: string;
      amount: number;
      monthYear: string;
      type: 'salary' | 'advance';
      comment?: string;
    }) => salaryApi.createPayment(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['salary'] });
      setPayModalVisible(false);
      resetPayModal();
      Alert.alert('Готово', 'Выплата успешно создана');
    },
    onError: () => {
      Alert.alert('Ошибка', 'Не удалось создать выплату');
    },
  });

  const resetPayModal = () => {
    setPayAmount('');
    setPayType('salary');
    setPayComment('');
  };

  const openPayModal = (master: MasterSalary) => {
    setPayUserId(master.masterId);
    setPayUserName(master.masterName);
    setPayAmount(String(Math.round(master.remainingAmount)));
    setPayMonthYear(monthYear);
    setPayType('salary');
    setPayComment('');
    setPayModalVisible(true);
  };

  const submitPayment = () => {
    const amt = parseFloat(payAmount);
    if (!amt || amt <= 0) {
      Alert.alert('Ошибка', 'Укажите корректную сумму');
      return;
    }
    paymentMutation.mutate({
      userId: payUserId,
      amount: amt,
      monthYear: payMonthYear,
      type: payType,
      comment: payComment || undefined,
    });
  };

  // Previous month for month selector in modal
  const prevMonth = new Date(year, month - 1, 1);
  const prevMonthYear = formatMonthYear(prevMonth);

  // Summary
  const totalEarnings = useMemo(() => (salaries || []).reduce((s, m) => s + m.totalEarnings, 0), [salaries]);
  const totalPaid = useMemo(() => (salaries || []).reduce((s, m) => s + m.paidAmount, 0), [salaries]);
  const totalRemaining = useMemo(() => (salaries || []).reduce((s, m) => s + m.remainingAmount, 0), [salaries]);

  const prevMonthNav = () => setSelectedMonth(new Date(year, month - 1, 1));
  const nextMonthNav = () => setSelectedMonth(new Date(year, month + 1, 1));
  const goToToday = () => setSelectedMonth(new Date());

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title="Зарплата" onBack={() => navigation.goBack()} />

      {/* Month Navigation */}
      <View style={styles.monthNav}>
        <TouchableOpacity onPress={prevMonthNav} style={styles.monthNavBtn}>
          <Ionicons name="chevron-back" size={20} color={colors.primary[600]} />
        </TouchableOpacity>
        <TouchableOpacity onPress={goToToday} style={styles.monthCenter} activeOpacity={0.7}>
          <Text style={styles.monthTitle}>{MONTH_NAMES[month]}</Text>
          <Text style={styles.monthYear}>{year}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={nextMonthNav} style={styles.monthNavBtn}>
          <Ionicons name="chevron-forward" size={20} color={colors.primary[600]} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarHeight + spacing[4] }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* Summary Card */}
        <AnimatedCard style={{ borderRadius: borderRadius['2xl'], overflow: 'hidden' }} index={0}>
          <LinearGradient
            colors={[colors.green[600], colors.green[700]] as [string, string]}
            style={styles.summaryCard}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            <View style={styles.summaryHeader}>
              <Ionicons name="stats-chart" size={16} color="rgba(255,255,255,0.7)" />
              <Text style={styles.summaryHeaderText}>Итого за {MONTH_NAMES[month].toLowerCase()}</Text>
            </View>
            <View style={styles.summaryRow}>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryLabel}>Начислено</Text>
                <Text style={styles.summaryValue}>{formatMoney(totalEarnings)}</Text>
              </View>
              <View style={styles.summaryDivider} />
              <View style={styles.summaryItem}>
                <Text style={styles.summaryLabel}>Выплачено</Text>
                <Text style={styles.summaryValue}>{formatMoney(totalPaid)}</Text>
              </View>
              <View style={styles.summaryDivider} />
              <View style={styles.summaryItem}>
                <Text style={styles.summaryLabel}>Остаток</Text>
                <Text style={[styles.summaryValue, { fontSize: fontSize.lg }]}>{formatMoney(totalRemaining)}</Text>
              </View>
            </View>
            {/* Summary progress bar */}
            {totalEarnings > 0 && (
              <View style={styles.summaryProgressWrap}>
                <View style={styles.summaryProgressTrack}>
                  <View
                    style={[
                      styles.summaryProgressBar,
                      { width: `${Math.min((totalPaid / totalEarnings) * 100, 100)}%` },
                    ]}
                  />
                </View>
                <Text style={styles.summaryProgressText}>
                  {Math.round((totalPaid / totalEarnings) * 100)}% выплачено
                </Text>
              </View>
            )}
          </LinearGradient>
        </AnimatedCard>

        {/* Cold-start: spinner only until ANY response lands. Once we
            have data — even from cache — SWR keeps it visible across
            month navigation. */}
        {salaries === undefined ? (
          <LoadingSpinner />
        ) : (
          <>
            {/* Empty state — only when a real response said empty,
                NOT mid-fetch. Avoids "пусто" flash on month swipe. */}
            {salaries.length === 0 && !isLoading && (
              <View style={styles.emptyState}>
                <View style={styles.emptyIcon}>
                  <Ionicons name="wallet-outline" size={36} color={colors.gray[300]} />
                </View>
                <Text style={styles.emptyTitle}>Нет данных за этот месяц</Text>
                <Text style={styles.emptySubtitle}>Зарплата рассчитывается на основе закрытых чеков</Text>
              </View>
            )}

            {/* Master Cards */}
            {(salaries || []).map((master, idx) => {
              const isExpanded = expandedId === master.masterId;
              const avatarColors = getAvatarColors(master.masterName);
              const initials = getInitials(master.masterName);
              const paidPercent =
                master.totalEarnings > 0 ? Math.min((master.paidAmount / master.totalEarnings) * 100, 100) : 0;
              const payments = master.payments || [];

              return (
                <AnimatedCard key={master.masterId} style={styles.masterCard} index={idx + 1}>
                  {/* Master header row */}
                  <TouchableOpacity
                    style={styles.masterTop}
                    onPress={() => setExpandedId(isExpanded ? null : master.masterId)}
                    activeOpacity={0.7}
                  >
                    <LinearGradient
                      colors={avatarColors}
                      style={styles.masterAvatar}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                    >
                      <Text style={styles.masterInitials}>{initials}</Text>
                    </LinearGradient>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.masterName}>{master.masterName}</Text>
                      <View style={styles.percentRow}>
                        <View style={styles.percentBadge}>
                          <Ionicons name="cut-outline" size={10} color={colors.primary[600]} />
                          <Text style={styles.percentText}>{master.salaryPercent}%</Text>
                        </View>
                        {master.productSalaryPercent ? (
                          <View style={[styles.percentBadge, { backgroundColor: colors.amber[50] }]}>
                            <Ionicons name="cube-outline" size={10} color={colors.amber[600]} />
                            <Text style={[styles.percentText, { color: colors.amber[600] }]}>
                              {master.productSalaryPercent}%
                            </Text>
                          </View>
                        ) : null}
                      </View>
                    </View>
                    <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.gray[400]} />
                  </TouchableOpacity>

                  {/* Earnings breakdown */}
                  {master.serviceEarnings || master.productEarnings ? (
                    <View style={styles.earningsRow}>
                      {master.serviceEarnings ? (
                        <View style={styles.earningsPill}>
                          <Ionicons name="cut-outline" size={11} color={colors.primary[600]} />
                          <Text style={styles.earningsPillText}>Услуги: {formatMoney(master.serviceEarnings)}</Text>
                        </View>
                      ) : null}
                      {master.productEarnings ? (
                        <View style={[styles.earningsPill, { backgroundColor: colors.amber[50] }]}>
                          <Ionicons name="cube-outline" size={11} color={colors.amber[600]} />
                          <Text style={[styles.earningsPillText, { color: colors.amber[600] }]}>
                            Товары: {formatMoney(master.productEarnings)}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  ) : null}

                  {/* Stats badges */}
                  <View style={styles.masterStats}>
                    <View style={styles.statBadge}>
                      <Ionicons name="trending-up-outline" size={13} color={colors.blue[600]} />
                      <Text style={styles.statBadgeLabel}>Выручка</Text>
                      <Text style={styles.statBadgeValue}>{formatMoney(master.totalRevenue)}</Text>
                    </View>
                    <View style={styles.statBadge}>
                      <Ionicons name="receipt-outline" size={13} color={colors.purple[700]} />
                      <Text style={styles.statBadgeLabel}>Чеков</Text>
                      <Text style={styles.statBadgeValue}>{master.checkCount}</Text>
                    </View>
                  </View>

                  {/* Paid / Remaining with progress */}
                  <View style={styles.paymentSection}>
                    <View style={styles.paymentRow}>
                      <View style={styles.paymentItem}>
                        <Text style={styles.paymentLabel}>Начислено</Text>
                        <Text style={[styles.paymentValue, { color: colors.green[600] }]}>
                          {formatMoney(master.totalEarnings)}
                        </Text>
                      </View>
                      <View style={styles.paymentItem}>
                        <Text style={styles.paymentLabel}>Выплачено</Text>
                        <Text style={styles.paymentValue}>{formatMoney(master.paidAmount)}</Text>
                      </View>
                      <View style={styles.paymentItem}>
                        <Text style={styles.paymentLabel}>Остаток</Text>
                        <Text
                          style={[
                            styles.paymentValue,
                            { color: master.remainingAmount > 0 ? colors.orange[500] : colors.green[600] },
                          ]}
                        >
                          {formatMoney(master.remainingAmount)}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.progressTrack}>
                      <LinearGradient
                        colors={[colors.green[400], colors.green[600]] as [string, string]}
                        style={[styles.progressBar, { width: `${paidPercent}%` }]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                      />
                    </View>
                    <Text style={styles.progressLabel}>{Math.round(paidPercent)}% выплачено</Text>
                  </View>

                  {/* Expanded section */}
                  {isExpanded && (
                    <View style={styles.expandedSection}>
                      {/* Payment history */}
                      <View style={styles.historyHeader}>
                        <Ionicons name="time-outline" size={14} color={colors.gray[500]} />
                        <Text style={styles.historyTitle}>История выплат</Text>
                      </View>

                      {payments.length === 0 ? (
                        <View style={styles.noPayments}>
                          <Ionicons name="document-text-outline" size={20} color={colors.gray[300]} />
                          <Text style={styles.noPaymentsText}>Выплат пока нет</Text>
                        </View>
                      ) : (
                        payments.map((p: SalaryPayment) => (
                          <View key={p.id} style={styles.paymentHistoryItem}>
                            <View style={styles.paymentHistoryLeft}>
                              <View
                                style={[
                                  styles.paymentTypeBadge,
                                  { backgroundColor: p.type === 'salary' ? colors.green[50] : colors.amber[50] },
                                ]}
                              >
                                <Text
                                  style={[
                                    styles.paymentTypeBadgeText,
                                    { color: p.type === 'salary' ? colors.green[700] : colors.amber[600] },
                                  ]}
                                >
                                  {p.type === 'salary' ? 'Зарплата' : 'Аванс'}
                                </Text>
                              </View>
                              <Text style={styles.paymentHistoryDate}>{formatPaymentDate(p.date)}</Text>
                              {p.comment ? <Text style={styles.paymentHistoryComment}>{p.comment}</Text> : null}
                            </View>
                            <Text style={styles.paymentHistoryAmount}>{formatMoney(p.amount)}</Text>
                          </View>
                        ))
                      )}

                      {/* Pay button (directors/superadmins only) */}
                      {canManagePayments && (
                        <TouchableOpacity
                          style={styles.payBtn}
                          onPress={() => openPayModal(master)}
                          activeOpacity={0.7}
                        >
                          <LinearGradient
                            colors={[colors.green[500], colors.green[700]] as [string, string]}
                            style={styles.payBtnGradient}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 0 }}
                          >
                            <Ionicons name="card-outline" size={16} color={colors.white} />
                            <Text style={styles.payBtnText}>Выплатить</Text>
                          </LinearGradient>
                        </TouchableOpacity>
                      )}
                    </View>
                  )}
                </AnimatedCard>
              );
            })}
          </>
        )}
      </ScrollView>

      {/* Payment Modal */}
      <Modal visible={payModalVisible} onClose={() => setPayModalVisible(false)} title={`Выплата — ${payUserName}`}>
        {/* Amount */}
        <View style={styles.formField}>
          <Text style={styles.formLabel}>Сумма</Text>
          <View style={styles.formInputRow}>
            <Ionicons name="cash-outline" size={16} color={colors.gray[400]} />
            <TextInput
              style={styles.formTextInput}
              value={payAmount}
              onChangeText={setPayAmount}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor={colors.gray[300]}
            />
            <Text style={styles.formCurrency}>{'\u20BD'}</Text>
          </View>
        </View>

        {/* Month selector */}
        <View style={styles.formField}>
          <Text style={styles.formLabel}>Месяц</Text>
          <View style={styles.monthSelectorRow}>
            <TouchableOpacity
              style={[styles.monthChip, payMonthYear === monthYear && styles.monthChipActive]}
              onPress={() => setPayMonthYear(monthYear)}
              activeOpacity={0.7}
            >
              <Text style={[styles.monthChipText, payMonthYear === monthYear && styles.monthChipTextActive]}>
                {MONTH_NAMES[month]} {year}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.monthChip, payMonthYear === prevMonthYear && styles.monthChipActive]}
              onPress={() => setPayMonthYear(prevMonthYear)}
              activeOpacity={0.7}
            >
              <Text style={[styles.monthChipText, payMonthYear === prevMonthYear && styles.monthChipTextActive]}>
                {MONTH_NAMES[prevMonth.getMonth()]} {prevMonth.getFullYear()}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Type toggle */}
        <View style={styles.formField}>
          <Text style={styles.formLabel}>Тип</Text>
          <View style={styles.typeToggleRow}>
            <TouchableOpacity
              style={[styles.typeToggle, payType === 'salary' && styles.typeToggleActive]}
              onPress={() => setPayType('salary')}
              activeOpacity={0.7}
            >
              {payType === 'salary' ? (
                <LinearGradient
                  colors={[colors.green[500], colors.green[700]] as [string, string]}
                  style={styles.typeToggleGradient}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                >
                  <Ionicons name="wallet-outline" size={14} color={colors.white} />
                  <Text style={styles.typeToggleTextActive}>Зарплата</Text>
                </LinearGradient>
              ) : (
                <View style={styles.typeToggleInner}>
                  <Ionicons name="wallet-outline" size={14} color={colors.gray[500]} />
                  <Text style={styles.typeToggleText}>Зарплата</Text>
                </View>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.typeToggle, payType === 'advance' && styles.typeToggleActive]}
              onPress={() => setPayType('advance')}
              activeOpacity={0.7}
            >
              {payType === 'advance' ? (
                <LinearGradient
                  colors={[colors.amber[600], colors.orange[600]] as [string, string]}
                  style={styles.typeToggleGradient}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                >
                  <Ionicons name="flash-outline" size={14} color={colors.white} />
                  <Text style={styles.typeToggleTextActive}>Аванс</Text>
                </LinearGradient>
              ) : (
                <View style={styles.typeToggleInner}>
                  <Ionicons name="flash-outline" size={14} color={colors.gray[500]} />
                  <Text style={styles.typeToggleText}>Аванс</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* Comment */}
        <View style={styles.formField}>
          <Text style={styles.formLabel}>Комментарий (необязательно)</Text>
          <View style={styles.formInputRow}>
            <Ionicons name="chatbubble-outline" size={14} color={colors.gray[400]} />
            <TextInput
              style={styles.formTextInput}
              value={payComment}
              onChangeText={setPayComment}
              placeholder="Добавить комментарий..."
              placeholderTextColor={colors.gray[300]}
              multiline
            />
          </View>
        </View>

        {/* Actions */}
        <View style={styles.formActions}>
          <TouchableOpacity style={styles.cancelBtn} onPress={() => setPayModalVisible(false)}>
            <Text style={styles.cancelBtnText}>Отмена</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.submitBtn} onPress={submitPayment} activeOpacity={0.7}>
            {paymentMutation.isPending ? (
              <ActivityIndicator color={colors.white} size="small" />
            ) : (
              <LinearGradient
                colors={[colors.green[500], colors.green[700]] as [string, string]}
                style={styles.submitBtnGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
              >
                <Ionicons name="checkmark" size={16} color={colors.white} />
                <Text style={styles.submitBtnText}>Выплатить</Text>
              </LinearGradient>
            )}
          </TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
}

// ── Styles ──

const styles = StyleSheet.create({
  // Safe / Layout
  safe: { flex: 1, backgroundColor: colors.gray[50] },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.gray[100],
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  headerIcon: {
    width: 30,
    height: 30,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.gray[900],
    letterSpacing: -0.3,
  },

  // Month Navigation
  monthNav: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.gray[100],
  },
  monthNavBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthCenter: {
    alignItems: 'center',
  },
  monthTitle: {
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
    color: colors.gray[900],
    letterSpacing: -0.5,
  },
  monthYear: {
    fontSize: fontSize.xs,
    color: colors.gray[400],
    marginTop: 1,
  },

  // Scroll
  scrollContent: {
    padding: spacing[4],
    gap: spacing[3],
    paddingBottom: spacing[8],
  },

  // Summary Card
  summaryCard: {
    padding: spacing[5],
    borderRadius: borderRadius['2xl'],
  },
  summaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
    marginBottom: spacing[3],
  },
  summaryHeaderText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    color: 'rgba(255,255,255,0.7)',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center',
  },
  summaryDivider: {
    width: 1,
    height: 32,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  summaryLabel: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.6)',
    fontWeight: fontWeight.medium,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  summaryValue: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.bold,
    color: colors.white,
    marginTop: 4,
  },
  summaryProgressWrap: {
    marginTop: spacing[4],
    alignItems: 'center',
    gap: spacing[1.5],
  },
  summaryProgressTrack: {
    width: '100%',
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.2)',
    overflow: 'hidden',
  },
  summaryProgressBar: {
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.85)',
  },
  summaryProgressText: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.6)',
    fontWeight: fontWeight.medium,
  },

  // Empty state
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing[10],
    gap: spacing[2],
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[1],
  },
  emptyTitle: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    color: colors.gray[500],
  },
  emptySubtitle: {
    fontSize: fontSize.xs,
    color: colors.gray[400],
    textAlign: 'center',
  },

  // Master Card
  masterCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    borderColor: colors.gray[100],
    padding: spacing[4],
    shadowColor: colors.black,
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  masterTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
  },
  masterAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  masterInitials: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    color: colors.white,
  },
  masterName: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.gray[900],
  },
  percentRow: {
    flexDirection: 'row',
    gap: spacing[1.5],
    marginTop: 4,
  },
  percentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.primary[50],
    paddingHorizontal: spacing[1.5],
    paddingVertical: 2,
    borderRadius: borderRadius.full,
  },
  percentText: {
    fontSize: 10,
    fontWeight: fontWeight.semibold,
    color: colors.primary[600],
  },

  // Earnings row
  earningsRow: {
    flexDirection: 'row',
    gap: spacing[2],
    marginTop: spacing[3],
    flexWrap: 'wrap',
  },
  earningsPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    backgroundColor: colors.primary[50],
    paddingHorizontal: spacing[2.5],
    paddingVertical: spacing[1.5],
    borderRadius: borderRadius.full,
  },
  earningsPillText: {
    fontSize: 11,
    fontWeight: fontWeight.medium,
    color: colors.primary[700],
  },

  // Stats badges
  masterStats: {
    flexDirection: 'row',
    gap: spacing[2],
    marginTop: spacing[3],
  },
  statBadge: {
    flex: 1,
    backgroundColor: colors.gray[50],
    borderRadius: borderRadius.xl,
    padding: spacing[3],
    gap: 4,
  },
  statBadgeLabel: {
    fontSize: 10,
    color: colors.gray[400],
    fontWeight: fontWeight.medium,
  },
  statBadgeValue: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    color: colors.gray[900],
  },

  // Payment section
  paymentSection: {
    marginTop: spacing[3],
    paddingTop: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colors.gray[100],
  },
  paymentRow: {
    flexDirection: 'row',
    gap: spacing[2],
  },
  paymentItem: {
    flex: 1,
  },
  paymentLabel: {
    fontSize: 10,
    color: colors.gray[400],
    fontWeight: fontWeight.medium,
  },
  paymentValue: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    color: colors.gray[900],
    marginTop: 2,
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.gray[100],
    marginTop: spacing[2.5],
    overflow: 'hidden',
  },
  progressBar: {
    height: 6,
    borderRadius: 3,
    minWidth: 0,
  },
  progressLabel: {
    fontSize: 10,
    color: colors.gray[400],
    fontWeight: fontWeight.medium,
    marginTop: spacing[1],
    textAlign: 'right',
  },

  // Expanded section
  expandedSection: {
    marginTop: spacing[3],
    paddingTop: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colors.gray[100],
  },
  historyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
    marginBottom: spacing[2.5],
  },
  historyTitle: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.gray[600],
  },
  noPayments: {
    alignItems: 'center',
    paddingVertical: spacing[4],
    gap: spacing[1.5],
  },
  noPaymentsText: {
    fontSize: fontSize.xs,
    color: colors.gray[400],
  },
  paymentHistoryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing[2.5],
    borderBottomWidth: 1,
    borderBottomColor: colors.gray[50],
  },
  paymentHistoryLeft: {
    flex: 1,
    gap: 3,
  },
  paymentTypeBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: borderRadius.full,
  },
  paymentTypeBadgeText: {
    fontSize: 10,
    fontWeight: fontWeight.semibold,
  },
  paymentHistoryDate: {
    fontSize: fontSize.xs,
    color: colors.gray[500],
    marginTop: 2,
  },
  paymentHistoryComment: {
    fontSize: 11,
    color: colors.gray[400],
    fontStyle: 'italic',
  },
  paymentHistoryAmount: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    color: colors.gray[900],
  },

  // Pay button
  payBtn: {
    marginTop: spacing[3],
    borderRadius: borderRadius.xl,
    overflow: 'hidden',
  },
  payBtnGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[3],
    borderRadius: borderRadius.xl,
  },
  payBtnText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    color: colors.white,
  },

  // Form / Modal
  formField: {
    marginBottom: spacing[4],
  },
  formLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.gray[600],
    marginBottom: spacing[2],
  },
  formInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.gray[50],
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.gray[200],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    gap: spacing[2],
  },
  formTextInput: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.gray[900],
    padding: 0,
  },
  formCurrency: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    color: colors.gray[400],
  },

  // Month selector
  monthSelectorRow: {
    flexDirection: 'row',
    gap: spacing[2],
  },
  monthChip: {
    flex: 1,
    backgroundColor: colors.gray[50],
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.gray[200],
    paddingVertical: spacing[2.5],
    alignItems: 'center',
  },
  monthChipActive: {
    backgroundColor: colors.primary[50],
    borderColor: colors.primary[300],
  },
  monthChipText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    color: colors.gray[500],
  },
  monthChipTextActive: {
    color: colors.primary[700],
    fontWeight: fontWeight.semibold,
  },

  // Type toggle
  typeToggleRow: {
    flexDirection: 'row',
    backgroundColor: colors.gray[100],
    borderRadius: borderRadius.xl,
    padding: 3,
    gap: 3,
  },
  typeToggle: {
    flex: 1,
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
  },
  typeToggleActive: {
    shadowColor: colors.green[700],
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  typeToggleGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1.5],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.lg,
  },
  typeToggleInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1.5],
    paddingVertical: spacing[2.5],
  },
  typeToggleText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    color: colors.gray[500],
  },
  typeToggleTextActive: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    color: colors.white,
  },

  // Actions
  formActions: {
    flexDirection: 'row',
    gap: spacing[3],
    marginTop: spacing[2],
  },
  cancelBtn: {
    flex: 1,
    backgroundColor: colors.gray[100],
    borderRadius: borderRadius.xl,
    paddingVertical: spacing[3],
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.gray[600],
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
});
