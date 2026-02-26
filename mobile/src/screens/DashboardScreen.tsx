import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';
import { checksApi, salaryApi, shiftsApi, scheduleApi } from '../api/services';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import type { SalarySummary, EmployeeRanking, TodayEmployeeStatus, Shift } from '../../../shared/types';
import { UserRole } from '../../../shared/types';

function formatMoney(value: number): string {
  const rounded = Math.round(value);
  return rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' \u20BD';
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'Доброе утро';
  if (hour >= 12 && hour < 17) return 'Добрый день';
  if (hour >= 17 && hour < 22) return 'Добрый вечер';
  return 'Доброй ночи';
}

// ── Shift Control ──
function ShiftControl() {
  const queryClient = useQueryClient();
  const { data: myShifts } = useQuery<Shift[]>({
    queryKey: ['shifts', 'my'],
    queryFn: async () => { const res = await shiftsApi.getMy(); return res.data; },
    staleTime: 10_000,
  });

  const openShift = useMutation({
    mutationFn: () => shiftsApi.open(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      queryClient.invalidateQueries({ queryKey: ['schedule-today'] });
    },
  });

  const closeShift = useMutation({
    mutationFn: (id: string) => shiftsApi.close(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      queryClient.invalidateQueries({ queryKey: ['schedule-today'] });
    },
  });

  const currentShift = myShifts?.find(s => !s.closedAt);
  const isLoading = openShift.isPending || closeShift.isPending;

  return (
    <View style={styles.card}>
      <View style={styles.shiftRow}>
        <View style={styles.shiftLeft}>
          <View style={[styles.shiftIcon, currentShift ? styles.shiftIconOpen : styles.shiftIconClosed]}>
            <Text style={{ fontSize: 18 }}>⏰</Text>
          </View>
          <View>
            <Text style={styles.shiftTitle}>{currentShift ? 'Смена открыта' : 'Смена закрыта'}</Text>
            {currentShift && (
              <Text style={styles.shiftSince}>
                с {new Date(currentShift.openedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
              </Text>
            )}
          </View>
        </View>
        {currentShift ? (
          <TouchableOpacity
            style={styles.shiftCloseBtn}
            onPress={() => closeShift.mutate(currentShift.id)}
            disabled={isLoading}
          >
            {isLoading ? <ActivityIndicator size="small" color={colors.red[600]} /> : (
              <Text style={styles.shiftCloseBtnText}>Закрыть</Text>
            )}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.shiftOpenBtn}
            onPress={() => openShift.mutate()}
            disabled={isLoading}
          >
            {isLoading ? <ActivityIndicator size="small" color={colors.green[600]} /> : (
              <Text style={styles.shiftOpenBtnText}>Открыть смену</Text>
            )}
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

// ── Staff Status ──
function StaffStatus() {
  const { data: todayData } = useQuery<TodayEmployeeStatus[]>({
    queryKey: ['schedule-today'],
    queryFn: async () => { const res = await scheduleApi.getToday(); return res.data; },
    staleTime: 30_000,
  });

  const statuses = todayData ?? [];
  if (statuses.length === 0) return null;

  const isSick = (s: TodayEmployeeStatus) => (s.note || '').toLowerCase().includes('больнич');
  const getColor = (s: TodayEmployeeStatus) => {
    if (isSick(s)) return colors.rose[400];
    if (s.isDayOff) return colors.gray[400];
    if (s.lateStatus === 'late_major') return colors.orange[500];
    if (s.lateStatus === 'late_minor') return colors.yellow[400];
    if (s.isWorking) return colors.green[500];
    return colors.gray[300];
  };

  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>Сотрудники сегодня</Text>
      <View style={styles.staffGrid}>
        {statuses.map((s) => (
          <View key={s.userId} style={styles.staffItem}>
            <View style={[styles.staffCircle, { backgroundColor: getColor(s) }]}>
              <Text style={styles.staffInitials}>
                {s.fullName.split(' ').map(w => w[0]).join('').slice(0, 2)}
              </Text>
            </View>
            <Text style={styles.staffName} numberOfLines={1}>{s.fullName.split(' ')[0]}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// ── Employee Ranking ──
function EmployeeRankingSection() {
  const [tab, setTab] = useState<'today' | 'month'>('today');
  const { data: ranking } = useQuery<EmployeeRanking>({
    queryKey: ['employee-ranking'],
    queryFn: async () => { const res = await checksApi.getRanking(); return res.data; },
    staleTime: 30_000,
  });

  if (!ranking) return null;
  const data = tab === 'today' ? (ranking.today || []) : (ranking.month || []);

  return (
    <View style={styles.card}>
      <View style={styles.rankingHeader}>
        <Text style={styles.sectionTitle}>Рейтинг сотрудников</Text>
        <View style={styles.tabRow}>
          <TouchableOpacity
            style={[styles.tabBtn, tab === 'today' && styles.tabBtnActive]}
            onPress={() => setTab('today')}
          >
            <Text style={[styles.tabBtnText, tab === 'today' && styles.tabBtnTextActive]}>Сегодня</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabBtn, tab === 'month' && styles.tabBtnActive]}
            onPress={() => setTab('month')}
          >
            <Text style={[styles.tabBtnText, tab === 'month' && styles.tabBtnTextActive]}>За месяц</Text>
          </TouchableOpacity>
        </View>
      </View>
      {data.length === 0 ? (
        <Text style={styles.emptyText}>Нет данных за выбранный период</Text>
      ) : (
        data.map((emp, idx) => (
          <View key={emp.masterId} style={styles.rankingRow}>
            <View style={[styles.rankBadge, idx === 0 && styles.rankGold, idx === 1 && styles.rankSilver, idx === 2 && styles.rankBronze]}>
              <Text style={[styles.rankBadgeText, idx < 3 && styles.rankBadgeTextHighlight]}>{idx + 1}</Text>
            </View>
            <View style={styles.rankInfo}>
              <Text style={styles.rankName} numberOfLines={1}>{emp.masterName}</Text>
              <Text style={styles.rankSub}>{emp.checkCount} заказов</Text>
            </View>
            <Text style={styles.rankRevenue}>{formatMoney(emp.revenue)}</Text>
          </View>
        ))
      )}
    </View>
  );
}

// ── Master Dashboard ──
function MasterDashboard() {
  const { user } = useAuth();
  const { data, isLoading } = useQuery<SalarySummary>({
    queryKey: ['salary', 'my-summary'],
    queryFn: async () => { const res = await salaryApi.getMy(); return res.data; },
    staleTime: 30_000,
  });

  if (isLoading) return <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary[600]} />;
  if (!data) return <Text style={styles.errorBanner}>Не удалось загрузить данные</Text>;

  const initials = user?.fullName?.split(' ').map(w => w[0]).join('').slice(0, 2) || 'М';

  return (
    <View style={{ gap: spacing[4] }}>
      {/* Profile card */}
      <View style={styles.profileCard}>
        <View style={styles.profileRow}>
          <View style={styles.profileAvatar}>
            <Text style={styles.profileInitials}>{initials}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.profileGreeting}>{getGreeting()}</Text>
            <Text style={styles.profileName} numberOfLines={1}>{user?.fullName || 'Мастер'}</Text>
            <Text style={styles.profilePercent}>
              Услуги {data.salaryPercent}%{data.productSalaryPercent ? ` · Товары ${data.productSalaryPercent}%` : ''}
            </Text>
          </View>
        </View>
      </View>

      {/* Today stats */}
      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Заказов сегодня</Text>
          <Text style={styles.statValue}>{data.todayChecks || '—'}</Text>
          <Text style={styles.statSub}>За месяц: {data.monthChecks ?? 0}</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Сегодня</Text>
          <Text style={styles.statValue}>{data.today ? formatMoney(data.today) : '—'}</Text>
          <Text style={styles.statSub}>За месяц: {formatMoney(data.month)}</Text>
        </View>
      </View>

      {/* Cash register */}
      <View style={styles.cashSection}>
        <Text style={styles.cashTitle}>КАССА СЕГОДНЯ</Text>
        <View style={styles.cashGrid}>
          <View style={styles.cashItem}>
            <Text style={styles.cashEmoji}>💵</Text>
            <Text style={styles.cashAmount}>{formatMoney(data.todayCash ?? 0)}</Text>
            <Text style={styles.cashType}>Наличные</Text>
          </View>
          <View style={styles.cashItem}>
            <Text style={styles.cashEmoji}>💳</Text>
            <Text style={styles.cashAmount}>{formatMoney(data.todayCard ?? 0)}</Text>
            <Text style={styles.cashType}>Карта</Text>
          </View>
          <View style={styles.cashItem}>
            <Text style={styles.cashEmoji}>🛡</Text>
            <Text style={styles.cashAmount}>{formatMoney(data.todayWarranty ?? 0)}</Text>
            <Text style={styles.cashType}>Гарантия</Text>
          </View>
        </View>
      </View>

      {/* Earning structure */}
      {(data.todayService || data.todayProduct) ? (
        <View style={styles.card}>
          <Text style={styles.cashTitle}>СТРУКТУРА ЗАРАБОТКА СЕГОДНЯ</Text>
          <View style={styles.earningsRow}>
            <View style={[styles.earningBox, { backgroundColor: colors.blue[50] }]}>
              <Text style={[styles.earningLabel, { color: colors.blue[600] }]}>С услуг</Text>
              <Text style={styles.earningValue}>{formatMoney(data.todayService ?? 0)}</Text>
            </View>
            <View style={[styles.earningBox, { backgroundColor: colors.green[50] }]}>
              <Text style={[styles.earningLabel, { color: colors.green[600] }]}>С товаров</Text>
              <Text style={styles.earningValue}>{formatMoney(data.todayProduct ?? 0)}</Text>
            </View>
          </View>
        </View>
      ) : null}

      {/* Product promotions */}
      {data.productPromotions && data.productPromotions.length > 0 && data.productPromotions.some(p => p.percent > 0) && (
        <View style={styles.promoCard}>
          <View style={styles.promoHeader}>
            <Text style={{ fontSize: 18 }}>🎁</Text>
            <View>
              <Text style={styles.promoTitle}>Бонус с товаров</Text>
              <Text style={styles.promoSub}>Продавай эти товары и получай % с прибыли</Text>
            </View>
          </View>
          {data.productPromotions.filter(p => p.percent > 0).map(promo => (
            <View key={promo.productId} style={styles.promoItem}>
              <View style={{ flex: 1 }}>
                <Text style={styles.promoName} numberOfLines={1}>{promo.productName}</Text>
                <Text style={styles.promoPrice}>Цена: {formatMoney(promo.sellPrice)}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.promoBonus}>+{formatMoney(promo.estimatedBonus)}</Text>
                <Text style={styles.promoPercent}>{promo.percent}% с прибыли</Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ── Admin Dashboard ──
function AdminDashboard() {
  const { user } = useAuth();
  const isOwner = user?.role === UserRole.DIRECTOR || user?.role === UserRole.SUPERADMIN;

  return (
    <View style={{ gap: spacing[4] }}>
      {/* Revenue chart placeholder */}
      {isOwner && (
        <View style={styles.chartCard}>
          <Text style={styles.chartLabel}>АНАЛИТИКА</Text>
          <Text style={styles.chartPlaceholder}>Графики выручки доступны в веб-версии</Text>
        </View>
      )}
      <StaffStatus />
      {isOwner && <EmployeeRankingSection />}
    </View>
  );
}

// ── Quick Actions ──
function QuickActions() {
  const navigation = useNavigation<any>();
  const { hasPermission } = useAuth();

  const actions = [
    { label: 'Новый чек', screen: 'CheckCreate', perm: 'checks_create', emoji: '➕' },
    { label: 'Клиенты', screen: 'Clients', perm: 'clients_view', emoji: '👥' },
    { label: 'Журнал', tab: 'Checks', perm: 'checks_view', emoji: '📋' },
    { label: 'Отчёты', screen: 'Reports', perm: 'financial_reports', emoji: '📊' },
  ].filter(a => !a.perm || hasPermission(a.perm as any));

  if (actions.length === 0) return null;

  return (
    <View>
      <Text style={styles.sectionTitle}>Быстрые действия</Text>
      <View style={styles.quickGrid}>
        {actions.map(action => (
          <TouchableOpacity
            key={action.label}
            style={styles.quickItem}
            onPress={() => {
              if (action.tab) {
                navigation.navigate('Main', { screen: action.tab });
              } else if (action.screen) {
                navigation.navigate(action.screen);
              }
            }}
          >
            <Text style={{ fontSize: 20 }}>{action.emoji}</Text>
            <Text style={styles.quickLabel}>{action.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

// ── Main Dashboard ──
export default function DashboardScreen() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isMaster = user?.role === UserRole.MASTER;
  const isOwner = user?.role === UserRole.DIRECTOR || user?.role === UserRole.SUPERADMIN;
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries();
    setRefreshing(false);
  };

  const greeting = getGreeting();
  const displayName = user?.fullName?.split(' ')[0] || '';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent2}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />}
      >
        {/* Header for non-masters */}
        {!isMaster && (
          <View style={styles.headerSection}>
            <Text style={styles.headerTitle}>{greeting}, {displayName}!</Text>
            <Text style={styles.headerSub}>Обзор показателей автосервиса</Text>
          </View>
        )}

        {/* Shift control (not for owner) */}
        {!isOwner && <ShiftControl />}

        {/* Dashboard content */}
        {isMaster ? <MasterDashboard /> : <AdminDashboard />}

        {/* Quick actions */}
        <QuickActions />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.gray[50] },
  scroll: { flex: 1 },
  scrollContent2: { padding: spacing[4], gap: spacing[4], paddingBottom: spacing[8] },
  headerSection: { marginBottom: spacing[1] },
  headerTitle: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.gray[900] },
  headerSub: { fontSize: fontSize.xs, color: colors.gray[400], marginTop: 2 },
  card: {
    backgroundColor: colors.white,
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    borderColor: colors.gray[100],
    padding: spacing[4],
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  sectionTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900], marginBottom: spacing[3] },
  // Shift
  shiftRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  shiftLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  shiftIcon: { width: 40, height: 40, borderRadius: borderRadius.xl, alignItems: 'center', justifyContent: 'center' },
  shiftIconOpen: { backgroundColor: colors.green[100] },
  shiftIconClosed: { backgroundColor: colors.gray[100] },
  shiftTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  shiftSince: { fontSize: fontSize.xs, color: colors.gray[400] },
  shiftCloseBtn: { paddingHorizontal: spacing[4], paddingVertical: spacing[2.5], backgroundColor: colors.red[50], borderRadius: borderRadius.xl },
  shiftCloseBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.red[600] },
  shiftOpenBtn: { paddingHorizontal: spacing[4], paddingVertical: spacing[2.5], backgroundColor: colors.green[50], borderRadius: borderRadius.xl },
  shiftOpenBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.green[600] },
  // Staff
  staffGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[3] },
  staffItem: { alignItems: 'center', gap: spacing[1] },
  staffCircle: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  staffInitials: { fontSize: fontSize.xs, fontWeight: fontWeight.bold, color: colors.white },
  staffName: { fontSize: 10, color: colors.gray[500], maxWidth: 60, textAlign: 'center' },
  // Ranking
  rankingHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing[3] },
  tabRow: { flexDirection: 'row', backgroundColor: colors.gray[100], borderRadius: borderRadius.lg, padding: 2 },
  tabBtn: { paddingHorizontal: spacing[3], paddingVertical: spacing[1.5], borderRadius: borderRadius.md },
  tabBtnActive: { backgroundColor: colors.white, shadowColor: colors.black, shadowOpacity: 0.1, shadowRadius: 2, elevation: 2 },
  tabBtnText: { fontSize: fontSize.xs, fontWeight: fontWeight.medium, color: colors.gray[500] },
  tabBtnTextActive: { color: colors.gray[900] },
  rankingRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing[3], borderTopWidth: 1, borderTopColor: colors.gray[50] },
  rankBadge: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.gray[50], marginRight: spacing[3] },
  rankGold: { backgroundColor: colors.amber[100] },
  rankSilver: { backgroundColor: colors.gray[100] },
  rankBronze: { backgroundColor: colors.orange[50] },
  rankBadgeText: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[400] },
  rankBadgeTextHighlight: { color: colors.amber[600] },
  rankInfo: { flex: 1, minWidth: 0 },
  rankName: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  rankSub: { fontSize: 11, color: colors.gray[400] },
  rankRevenue: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900] },
  emptyText: { textAlign: 'center', padding: spacing[8], fontSize: fontSize.sm, color: colors.gray[400] },
  // Profile
  profileCard: { backgroundColor: colors.primary[600], borderRadius: borderRadius['2xl'], padding: spacing[5] },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[4] },
  profileAvatar: { width: 64, height: 64, borderRadius: borderRadius['2xl'], backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  profileInitials: { fontSize: fontSize['2xl'], fontWeight: fontWeight.bold, color: colors.white },
  profileGreeting: { fontSize: fontSize.xs, color: 'rgba(255,255,255,0.6)' },
  profileName: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.white },
  profilePercent: { fontSize: fontSize.sm, color: 'rgba(255,255,255,0.7)' },
  // Stats
  statsRow: { flexDirection: 'row', gap: spacing[3] },
  statCard: { flex: 1, backgroundColor: colors.white, borderRadius: borderRadius.xl, borderWidth: 1, borderColor: colors.gray[100], padding: spacing[4], shadowColor: colors.black, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1 },
  statLabel: { fontSize: fontSize.xs, color: colors.gray[400], fontWeight: fontWeight.medium, marginBottom: spacing[2] },
  statValue: { fontSize: fontSize['2xl'], fontWeight: fontWeight.bold, color: colors.gray[900] },
  statSub: { fontSize: 11, color: colors.gray[400], marginTop: 2 },
  // Cash
  cashSection: { backgroundColor: colors.slate[50], borderRadius: borderRadius['2xl'], borderWidth: 1, borderColor: colors.slate[200], padding: spacing[4] },
  cashTitle: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.slate[500], letterSpacing: 1, marginBottom: spacing[3] },
  cashGrid: { flexDirection: 'row', gap: spacing[2.5] },
  cashItem: { flex: 1, backgroundColor: colors.white, borderRadius: borderRadius.xl, padding: spacing[3], alignItems: 'center', shadowColor: colors.black, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1 },
  cashEmoji: { fontSize: 16, marginBottom: spacing[1.5] },
  cashAmount: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900] },
  cashType: { fontSize: 10, color: colors.gray[400], marginTop: 2 },
  // Earnings
  earningsRow: { flexDirection: 'row', gap: spacing[3] },
  earningBox: { flex: 1, borderRadius: borderRadius.lg, padding: spacing[3] },
  earningLabel: { fontSize: fontSize.xs, fontWeight: fontWeight.medium },
  earningValue: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.gray[900], marginTop: 4 },
  // Promo
  promoCard: { backgroundColor: colors.emerald[50], borderRadius: borderRadius['2xl'], borderWidth: 1, borderColor: colors.green[200], overflow: 'hidden' },
  promoHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing[2.5], padding: spacing[4] },
  promoTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900] },
  promoSub: { fontSize: 11, color: colors.gray[500] },
  promoItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.white, marginHorizontal: spacing[3], marginBottom: spacing[2], borderRadius: borderRadius.xl, padding: spacing[3], shadowColor: colors.black, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1 },
  promoName: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[900] },
  promoPrice: { fontSize: 11, color: colors.gray[400] },
  promoBonus: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.green[600] },
  promoPercent: { fontSize: 10, color: colors.gray[400] },
  // Chart
  chartCard: { backgroundColor: '#0f172a', borderRadius: borderRadius['3xl'], padding: spacing[5], overflow: 'hidden' },
  chartLabel: { fontSize: 11, fontWeight: fontWeight.medium, color: colors.slate[400], letterSpacing: 2, marginBottom: spacing[3] },
  chartPlaceholder: { fontSize: fontSize.sm, color: colors.slate[500], textAlign: 'center', paddingVertical: spacing[8] },
  // Error
  errorBanner: { backgroundColor: colors.red[50], borderRadius: borderRadius.xl, padding: spacing[4], fontSize: fontSize.sm, color: colors.red[700], textAlign: 'center', margin: spacing[4] },
  // Quick actions
  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[3] },
  quickItem: {
    width: '47%',
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.gray[100],
    padding: spacing[4],
    alignItems: 'center',
    gap: spacing[2],
    shadowColor: colors.black,
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  quickLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[700], textAlign: 'center' },
});
