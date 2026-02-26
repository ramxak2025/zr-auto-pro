import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  RefreshControl, ActivityIndicator, Animated as RNAnimated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';
import { marketingApi } from '../api/services';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import AnimatedCard from '../components/AnimatedCard';
import { UserRole } from '../../../shared/types';

type TabKey = 'dashboard' | 'reviews' | 'integrations';

function StarRating({ rating, size = 14 }: { rating: number; size?: number }) {
  const stars = [];
  for (let i = 1; i <= 5; i++) {
    stars.push(
      <Ionicons
        key={i}
        name={i <= Math.round(rating) ? 'star' : 'star-outline'}
        size={size}
        color={i <= Math.round(rating) ? colors.amber[200] : colors.gray[300]}
      />
    );
  }
  return <View style={{ flexDirection: 'row', gap: 1 }}>{stars}</View>;
}

// ── Dashboard Tab ──
function DashboardTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['marketing-dashboard'],
    queryFn: async () => { const res = await marketingApi.getDashboard(); return res.data; },
  });

  if (isLoading) return <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary[600]} />;
  if (!data) return <Text style={styles.emptyText}>Нет данных</Text>;

  const stats = [
    { label: 'Всего отзывов', value: data.totalReviews || 0, icon: 'chatbubbles-outline' as const, color: colors.primary[600], bg: colors.primary[50] },
    { label: 'Средний рейтинг', value: data.averageRating ? data.averageRating.toFixed(1) : '—', icon: 'star' as const, color: colors.amber[600], bg: colors.amber[50] },
    { label: 'Токенов отправлено', value: data.tokensSent || 0, icon: 'send-outline' as const, color: colors.teal[600], bg: colors.teal[50] },
    { label: 'Отклик', value: data.responseRate ? `${Math.round(data.responseRate)}%` : '—', icon: 'trending-up-outline' as const, color: colors.green[600], bg: colors.green[50] },
  ];

  return (
    <View style={{ gap: spacing[4] }}>
      {/* Stats Grid */}
      <View style={styles.statsGrid}>
        {stats.map((stat, idx) => (
          <AnimatedCard key={stat.label} index={idx} style={styles.statCard}>
            <View style={[styles.statIconBox, { backgroundColor: stat.bg }]}>
              <Ionicons name={stat.icon} size={18} color={stat.color} />
            </View>
            <Text style={styles.statValue}>{stat.value}</Text>
            <Text style={styles.statLabel}>{stat.label}</Text>
          </AnimatedCard>
        ))}
      </View>

      {/* Review Funnel */}
      {data.totalReviews > 0 && (
        <AnimatedCard index={4} style={styles.card}>
          <Text style={styles.sectionTitle}>Воронка отзывов</Text>
          <View style={{ gap: spacing[3] }}>
            <FunnelBar label="Ссылки отправлены" value={data.tokensSent || 0} max={data.tokensSent || 1} color={colors.primary[500]} />
            <FunnelBar label="Получен отклик" value={data.totalReviews || 0} max={data.tokensSent || 1} color={colors.blue[600]} />
            <FunnelBar label="Позитивные (4-5)" value={data.positiveReviews || 0} max={data.tokensSent || 1} color={colors.green[500]} />
            <FunnelBar label="Перешли на площадку" value={data.publicRedirects || 0} max={data.tokensSent || 1} color={colors.emerald[700]} />
          </View>
        </AnimatedCard>
      )}

      {/* Employee Ratings */}
      {data.employeeRatings && data.employeeRatings.length > 0 && (
        <AnimatedCard index={5} style={styles.card}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Рейтинг сотрудников</Text>
            <Ionicons name="trophy-outline" size={18} color={colors.amber[600]} />
          </View>
          {data.employeeRatings.map((emp: any, idx: number) => (
            <View key={emp.employeeId || idx} style={[styles.empRow, idx > 0 && styles.empRowBorder]}>
              <View style={styles.empRankBadge}>
                {idx < 3 ? (
                  <Ionicons
                    name="trophy"
                    size={16}
                    color={idx === 0 ? '#FFD700' : idx === 1 ? '#C0C0C0' : '#CD7F32'}
                  />
                ) : (
                  <Text style={styles.empRankText}>{idx + 1}</Text>
                )}
              </View>
              <View style={styles.empInfo}>
                <Text style={styles.empName} numberOfLines={1}>{emp.employeeName}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
                  <StarRating rating={emp.averageRating || 0} size={12} />
                  <Text style={styles.empReviewCount}>{emp.reviewCount} отзывов</Text>
                </View>
              </View>
              <Text style={styles.empRating}>{(emp.averageRating || 0).toFixed(1)}</Text>
            </View>
          ))}
        </AnimatedCard>
      )}

      {/* Alerts */}
      {data.unreadAlerts > 0 && (
        <AnimatedCard index={6} style={[styles.card, styles.alertCard]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
            <Ionicons name="warning-outline" size={20} color={colors.red[600]} />
            <Text style={styles.alertText}>
              {data.unreadAlerts} непрочитанных оповещений
            </Text>
          </View>
        </AnimatedCard>
      )}
    </View>
  );
}

function FunnelBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const percent = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
        <Text style={styles.funnelLabel}>{label}</Text>
        <Text style={styles.funnelValue}>{value} ({percent}%)</Text>
      </View>
      <View style={styles.funnelBarBg}>
        <View style={[styles.funnelBarFill, { width: `${percent}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

// ── Reviews Tab ──
function ReviewsTab() {
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  const { data, isLoading } = useQuery({
    queryKey: ['marketing-reviews', month],
    queryFn: async () => { const res = await marketingApi.getReviews({ month }); return res.data; },
  });

  const reviews = data?.reviews || data || [];

  const navigateMonth = (dir: number) => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m - 1 + dir, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  const monthLabel = (() => {
    const [y, m] = month.split('-').map(Number);
    const names = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
    return `${names[m - 1]} ${y}`;
  })();

  return (
    <View style={{ gap: spacing[4] }}>
      {/* Month navigation */}
      <View style={styles.monthNav}>
        <TouchableOpacity onPress={() => navigateMonth(-1)} style={styles.monthBtn}>
          <Ionicons name="chevron-back" size={20} color={colors.gray[600]} />
        </TouchableOpacity>
        <Text style={styles.monthLabel}>{monthLabel}</Text>
        <TouchableOpacity onPress={() => navigateMonth(1)} style={styles.monthBtn}>
          <Ionicons name="chevron-forward" size={20} color={colors.gray[600]} />
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <ActivityIndicator color={colors.primary[600]} style={{ marginTop: 20 }} />
      ) : (Array.isArray(reviews) ? reviews : []).length === 0 ? (
        <View style={styles.emptyCard}>
          <Ionicons name="chatbubbles-outline" size={40} color={colors.gray[300]} />
          <Text style={styles.emptyTitle}>Нет отзывов за этот месяц</Text>
        </View>
      ) : (
        (Array.isArray(reviews) ? reviews : []).map((review: any, idx: number) => (
          <AnimatedCard key={review.id || idx} index={idx} style={styles.reviewCard}>
            <View style={styles.reviewHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.reviewClientName}>{review.clientName || 'Клиент'}</Text>
                <Text style={styles.reviewDate}>
                  {new Date(review.createdAt).toLocaleDateString('ru-RU')}
                </Text>
              </View>
              <StarRating rating={review.rating} size={16} />
            </View>
            {review.comment && (
              <Text style={styles.reviewComment}>{review.comment}</Text>
            )}
            {review.employeeName && (
              <View style={styles.reviewEmployeeTag}>
                <Ionicons name="person-outline" size={12} color={colors.gray[500]} />
                <Text style={styles.reviewEmployeeText}>{review.employeeName}</Text>
              </View>
            )}
          </AnimatedCard>
        ))
      )}
    </View>
  );
}

// ── Integrations Tab ──
function IntegrationsTab() {
  const { data: integrations, isLoading } = useQuery({
    queryKey: ['marketing-integrations'],
    queryFn: async () => { const res = await marketingApi.getIntegrations(); return res.data; },
  });

  const { data: platformLinks } = useQuery({
    queryKey: ['marketing-platform-links'],
    queryFn: async () => { const res = await marketingApi.getPlatformLinks(); return res.data; },
  });

  if (isLoading) return <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary[600]} />;

  const providers = [
    { key: 'sms_ru', name: 'SMS.RU', icon: 'chatbox-outline' as const, desc: 'SMS-рассылка' },
    { key: 'moi_zvonki', name: 'МоиЗвонки', icon: 'call-outline' as const, desc: 'SMS через МоиЗвонки' },
    { key: 'whatsapp', name: 'WhatsApp', icon: 'logo-whatsapp' as const, desc: 'Сообщения WhatsApp' },
    { key: 'email', name: 'Email', icon: 'mail-outline' as const, desc: 'Почтовые рассылки' },
  ];

  const platforms = [
    { key: 'google', name: 'Google Maps', icon: 'location-outline' as const },
    { key: 'yandex', name: 'Яндекс Карты', icon: 'navigate-outline' as const },
    { key: '2gis', name: '2GIS', icon: 'map-outline' as const },
  ];

  const activeIntegrations = Array.isArray(integrations) ? integrations : [];
  const activeLinks = Array.isArray(platformLinks) ? platformLinks : [];

  return (
    <View style={{ gap: spacing[4] }}>
      {/* Messaging Channels */}
      <AnimatedCard index={0} style={styles.card}>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Каналы отправки</Text>
          <Ionicons name="paper-plane-outline" size={16} color={colors.gray[400]} />
        </View>
        {providers.map((p, idx) => {
          const active = activeIntegrations.find((i: any) => i.provider === p.key);
          return (
            <View key={p.key} style={[styles.integrationRow, idx > 0 && styles.integrationBorder]}>
              <View style={[styles.integrationIcon, { backgroundColor: active ? colors.green[50] : colors.gray[50] }]}>
                <Ionicons name={p.icon} size={18} color={active ? colors.green[600] : colors.gray[400]} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.integrationName}>{p.name}</Text>
                <Text style={styles.integrationDesc}>{p.desc}</Text>
              </View>
              <View style={[styles.statusBadge, active ? styles.statusActive : styles.statusInactive]}>
                <Text style={[styles.statusText, active ? styles.statusTextActive : styles.statusTextInactive]}>
                  {active ? 'Активен' : 'Не настроен'}
                </Text>
              </View>
            </View>
          );
        })}
      </AnimatedCard>

      {/* Platform Links */}
      <AnimatedCard index={1} style={styles.card}>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Площадки для отзывов</Text>
          <Ionicons name="globe-outline" size={16} color={colors.gray[400]} />
        </View>
        {platforms.map((p, idx) => {
          const link = activeLinks.find((l: any) => l.platform === p.key);
          return (
            <View key={p.key} style={[styles.integrationRow, idx > 0 && styles.integrationBorder]}>
              <View style={[styles.integrationIcon, { backgroundColor: link ? colors.blue[50] : colors.gray[50] }]}>
                <Ionicons name={p.icon} size={18} color={link ? colors.blue[600] : colors.gray[400]} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.integrationName}>{p.name}</Text>
                {link && <Text style={styles.integrationDesc} numberOfLines={1}>{link.url}</Text>}
              </View>
              <View style={[styles.statusBadge, link ? styles.statusActive : styles.statusInactive]}>
                <Text style={[styles.statusText, link ? styles.statusTextActive : styles.statusTextInactive]}>
                  {link ? 'Настроен' : 'Не настроен'}
                </Text>
              </View>
            </View>
          );
        })}
      </AnimatedCard>

      <View style={styles.infoCard}>
        <Ionicons name="information-circle-outline" size={18} color={colors.blue[600]} />
        <Text style={styles.infoText}>Настройка интеграций доступна в веб-версии</Text>
      </View>
    </View>
  );
}

// ── Main Screen ──
export default function MarketingScreen() {
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabKey>('dashboard');
  const [refreshing, setRefreshing] = useState(false);

  const isMaster = user?.role === UserRole.MASTER;
  const tabs: { key: TabKey; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { key: 'dashboard', label: 'Обзор', icon: 'pie-chart-outline' },
    { key: 'reviews', label: 'Отзывы', icon: 'chatbubbles-outline' },
    { key: 'integrations', label: 'Каналы', icon: 'link-outline' },
  ];

  const onRefresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['marketing-dashboard'] });
    await queryClient.invalidateQueries({ queryKey: ['marketing-reviews'] });
    setRefreshing(false);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.primary[600]} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Маркетинг</Text>
        <View style={{ width: 36 }} />
      </View>

      {/* Tabs */}
      <View style={styles.tabBar}>
        {tabs.map(tab => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tab, activeTab === tab.key && styles.tabActive]}
            onPress={() => setActiveTab(tab.key)}
          >
            <Ionicons
              name={tab.icon}
              size={16}
              color={activeTab === tab.key ? colors.primary[600] : colors.gray[400]}
            />
            <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />}
      >
        {activeTab === 'dashboard' && <DashboardTab />}
        {activeTab === 'reviews' && <ReviewsTab />}
        {activeTab === 'integrations' && <IntegrationsTab />}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.gray[50] },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing[4], paddingVertical: spacing[3],
    backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.gray[100],
  },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primary[50], alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.gray[900] },
  // Tabs
  tabBar: {
    flexDirection: 'row', backgroundColor: colors.white, paddingHorizontal: spacing[4],
    paddingBottom: spacing[2], gap: spacing[2],
  },
  tab: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing[1.5],
    paddingVertical: spacing[2.5], borderRadius: borderRadius.xl, backgroundColor: colors.gray[50],
  },
  tabActive: { backgroundColor: colors.primary[50] },
  tabText: { fontSize: fontSize.xs, fontWeight: fontWeight.medium, color: colors.gray[400] },
  tabTextActive: { color: colors.primary[600] },
  // Content
  scroll: { flex: 1 },
  scrollContent: { padding: spacing[4], paddingBottom: spacing[8] },
  // Stats
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[3] },
  statCard: {
    width: '47%', backgroundColor: colors.white, borderRadius: borderRadius['2xl'],
    borderWidth: 1, borderColor: colors.gray[100], padding: spacing[4],
    shadowColor: colors.black, shadowOpacity: 0.04, shadowRadius: 4, elevation: 2,
  },
  statIconBox: { width: 36, height: 36, borderRadius: borderRadius.xl, alignItems: 'center', justifyContent: 'center', marginBottom: spacing[3] },
  statValue: { fontSize: fontSize['2xl'], fontWeight: fontWeight.bold, color: colors.gray[900] },
  statLabel: { fontSize: fontSize.xs, color: colors.gray[400], marginTop: 2 },
  // Card
  card: {
    backgroundColor: colors.white, borderRadius: borderRadius['2xl'], borderWidth: 1,
    borderColor: colors.gray[100], padding: spacing[4],
    shadowColor: colors.black, shadowOpacity: 0.04, shadowRadius: 4, elevation: 2,
  },
  sectionTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900], marginBottom: spacing[3] },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing[3] },
  // Funnel
  funnelLabel: { fontSize: fontSize.xs, color: colors.gray[600] },
  funnelValue: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  funnelBarBg: { height: 8, backgroundColor: colors.gray[100], borderRadius: 4, overflow: 'hidden' },
  funnelBarFill: { height: 8, borderRadius: 4 },
  // Employee ratings
  empRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing[3], gap: spacing[3] },
  empRowBorder: { borderTopWidth: 1, borderTopColor: colors.gray[50] },
  empRankBadge: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.gray[50], alignItems: 'center', justifyContent: 'center' },
  empRankText: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[400] },
  empInfo: { flex: 1, minWidth: 0 },
  empName: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  empReviewCount: { fontSize: 11, color: colors.gray[400] },
  empRating: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.gray[900] },
  // Alert
  alertCard: { backgroundColor: colors.red[50], borderColor: colors.red[200] },
  alertText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.red[700] },
  // Empty
  emptyText: { textAlign: 'center', padding: spacing[8], fontSize: fontSize.sm, color: colors.gray[400] },
  emptyCard: { alignItems: 'center', paddingVertical: spacing[12], gap: spacing[3] },
  emptyTitle: { fontSize: fontSize.sm, color: colors.gray[400] },
  // Reviews
  monthNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing[4] },
  monthBtn: { padding: spacing[2], borderRadius: borderRadius.full, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.gray[200] },
  monthLabel: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  reviewCard: {
    backgroundColor: colors.white, borderRadius: borderRadius['2xl'], borderWidth: 1,
    borderColor: colors.gray[100], padding: spacing[4],
    shadowColor: colors.black, shadowOpacity: 0.04, shadowRadius: 4, elevation: 2,
  },
  reviewHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  reviewClientName: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  reviewDate: { fontSize: fontSize.xs, color: colors.gray[400], marginTop: 2 },
  reviewComment: { fontSize: fontSize.sm, color: colors.gray[700], marginTop: spacing[3], lineHeight: 20 },
  reviewEmployeeTag: { flexDirection: 'row', alignItems: 'center', gap: spacing[1], marginTop: spacing[3], paddingTop: spacing[3], borderTopWidth: 1, borderTopColor: colors.gray[100] },
  reviewEmployeeText: { fontSize: fontSize.xs, color: colors.gray[500] },
  // Integrations
  integrationRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], paddingVertical: spacing[3] },
  integrationBorder: { borderTopWidth: 1, borderTopColor: colors.gray[50] },
  integrationIcon: { width: 40, height: 40, borderRadius: borderRadius.xl, alignItems: 'center', justifyContent: 'center' },
  integrationName: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[900] },
  integrationDesc: { fontSize: fontSize.xs, color: colors.gray[400], marginTop: 1 },
  statusBadge: { paddingHorizontal: spacing[2], paddingVertical: 3, borderRadius: borderRadius.full },
  statusActive: { backgroundColor: colors.green[50] },
  statusInactive: { backgroundColor: colors.gray[100] },
  statusText: { fontSize: 10, fontWeight: fontWeight.medium },
  statusTextActive: { color: colors.green[700] },
  statusTextInactive: { color: colors.gray[500] },
  // Info
  infoCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing[2],
    backgroundColor: colors.blue[50], borderRadius: borderRadius.xl, padding: spacing[4],
    borderWidth: 1, borderColor: colors.blue[200],
  },
  infoText: { fontSize: fontSize.sm, color: colors.blue[700], flex: 1 },
});
