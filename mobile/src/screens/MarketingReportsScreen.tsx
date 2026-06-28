/**
 * MarketingReportsScreen — «Маркетинговые отчёты».
 *
 * One of the four «Маркетинг» directions (hub → this screen). Pure,
 * read-only marketing analytics, extracted out of the former
 * MarketingScreen «Сводка» tab so review-collection settings and the
 * numbers stop sharing one crowded tab:
 *
 *   • KPI grid       — всего отзывов, средний рейтинг, запросов отправлено,
 *                      отклик, конверсия, переходы на площадки.
 *   • Негатив        — highlighted unread «consecutive negative» alerts.
 *   • Воронка        — sent → responded → positive → redirected funnel.
 *   • Сотрудники     — per-master review ranking.
 *
 * Source: marketingApi.getDashboard() + getAlerts() — no new endpoint.
 */
import React from 'react';
import { View, ScrollView, StyleSheet, RefreshControl, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { useColors } from '../contexts/ThemeContext';
import { marketingApi } from '../api/services';
import { colors, fontSize, fontWeight, borderRadius, spacing, softTint } from '../theme';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import AnimatedCard from '../components/AnimatedCard';
import IosScreenHeader from '../components/IosScreenHeader';
import { Text } from '../platform/Typography';
import type { ReviewAlert } from '../../../shared/types';

function StarRating({ rating, size = 14 }: { rating: number; size?: number }) {
  const stars = [] as React.ReactElement[];
  for (let i = 1; i <= 5; i++) {
    stars.push(
      <Ionicons
        key={i}
        name={i <= Math.round(rating) ? 'star' : 'star-outline'}
        size={size}
        color={i <= Math.round(rating) ? colors.amber[600] : colors.gray[300]}
      />,
    );
  }
  return <View style={{ flexDirection: 'row', gap: 1 }}>{stars}</View>;
}

function FunnelBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const palette = useColors();
  const percent = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
        <Text style={[styles.funnelLabel, { color: palette.text.secondary }]}>{label}</Text>
        <Text style={[styles.funnelValue, { color: palette.text.primary }]}>
          {value} ({percent}%)
        </Text>
      </View>
      <View style={[styles.funnelBarBg, { backgroundColor: palette.bg.muted }]}>
        <View style={[styles.funnelBarFill, { width: `${percent}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

export default function MarketingReportsScreen() {
  const navigation = useNavigation<any>();
  const palette = useColors();
  const tabBarHeight = useTabBarHeight();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = React.useState(false);

  const dashboardQuery = useQuery({
    queryKey: ['marketing-dashboard'],
    queryFn: async () => (await marketingApi.getDashboard()).data,
    staleTime: 60_000,
  });
  const alertsQuery = useQuery({
    queryKey: ['marketing-alerts'],
    queryFn: async () => (await marketingApi.getAlerts()).data,
    staleTime: 60_000,
  });

  const data = dashboardQuery.data;
  const alerts: ReviewAlert[] = Array.isArray(alertsQuery.data) ? alertsQuery.data : [];
  const unreadNegative = alerts.filter((a) => !a.isRead && a.alertType === 'consecutive_negative').length;

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['marketing-dashboard'] }),
      queryClient.invalidateQueries({ queryKey: ['marketing-alerts'] }),
    ]);
    setRefreshing(false);
  };

  const stats = data
    ? [
        {
          label: 'Всего отзывов',
          value: data.totalReviews || 0,
          icon: 'chatbubbles-outline' as const,
          color: colors.primary[600],
          bg: colors.primary[50],
        },
        {
          label: 'Средний рейтинг',
          value: data.avgRating ? data.avgRating.toFixed(1) : '—',
          icon: 'star' as const,
          color: colors.amber[600],
          bg: colors.amber[50],
        },
        {
          label: 'Запросов отправлено',
          value: data.tokensSent || 0,
          icon: 'send-outline' as const,
          color: colors.teal[600],
          bg: colors.teal[50],
        },
        {
          label: 'Отклик',
          value: data.responseRate ? `${Math.round(data.responseRate)}%` : '—',
          icon: 'trending-up-outline' as const,
          color: colors.green[600],
          bg: colors.green[50],
        },
        {
          label: 'Конверсия',
          value: data.conversionRate ? `${Math.round(data.conversionRate)}%` : '—',
          icon: 'analytics-outline' as const,
          color: colors.blue[600],
          bg: colors.blue[50],
        },
        {
          label: 'Перешли на площадку',
          value: data.publicRedirects || 0,
          icon: 'open-outline' as const,
          color: colors.emerald[700],
          bg: colors.emerald[50],
        },
      ]
    : [];

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title="Маркетинговые отчёты" onBack={() => navigation.goBack()} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarHeight + spacing[4] }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.accent.primary} />
        }
        removeClippedSubviews
        scrollEventThrottle={16}
      >
        {dashboardQuery.isLoading && !data ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary[600]} />
        ) : !data ? (
          <View style={styles.emptyCard}>
            <Ionicons name="stats-chart-outline" size={36} color={palette.text.tertiary} />
            <Text style={[styles.emptyTitle, { color: palette.text.tertiary }]}>Нет данных</Text>
          </View>
        ) : (
          <View style={{ gap: spacing[4] }}>
            {/* Negative alerts highlight */}
            {unreadNegative > 0 && (
              <AnimatedCard
                index={0}
                style={
                  palette.mode === 'dark'
                    ? [
                        styles.alertCard,
                        { backgroundColor: softTint(colors.red[600], 'dark'), borderColor: palette.border.subtle },
                      ]
                    : styles.alertCard
                }
              >
                <View
                  style={[
                    styles.alertIcon,
                    { backgroundColor: palette.mode === 'dark' ? softTint(colors.red[600], 'dark') : colors.red[100] },
                  ]}
                >
                  <Ionicons
                    name="warning"
                    size={18}
                    color={palette.mode === 'dark' ? colors.red[300] : colors.red[600]}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={[styles.alertTitle, { color: palette.mode === 'dark' ? colors.red[300] : colors.red[700] }]}
                  >
                    {unreadNegative} новых негативных отзыва
                  </Text>
                  <Text
                    style={[styles.alertSub, { color: palette.mode === 'dark' ? colors.red[300] : colors.red[700] }]}
                  >
                    Откройте «Отзывы и репутация» — клиенты ждут реакции
                  </Text>
                </View>
              </AnimatedCard>
            )}

            {/* KPI Grid */}
            <View style={styles.statsGrid}>
              {stats.map((stat, idx) => (
                <AnimatedCard
                  key={stat.label}
                  index={idx + 1}
                  style={[styles.statCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
                >
                  <View
                    style={[
                      styles.statIconBox,
                      { backgroundColor: palette.mode === 'dark' ? softTint(stat.color, 'dark') : stat.bg },
                    ]}
                  >
                    <Ionicons name={stat.icon} size={18} color={stat.color} />
                  </View>
                  <Text style={[styles.statValue, { color: palette.text.primary }]}>{stat.value}</Text>
                  <Text style={[styles.statLabel, { color: palette.text.tertiary }]}>{stat.label}</Text>
                </AnimatedCard>
              ))}
            </View>

            {/* Review Funnel */}
            {data.totalReviews > 0 && (
              <AnimatedCard
                index={7}
                style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
              >
                <Text style={[styles.sectionTitle, { color: palette.text.primary }]}>Воронка отзывов</Text>
                <View style={{ gap: spacing[3] }}>
                  <FunnelBar
                    label="Ссылки отправлены"
                    value={data.tokensSent || 0}
                    max={data.tokensSent || 1}
                    color={colors.primary[500]}
                  />
                  <FunnelBar
                    label="Получен отклик"
                    value={data.totalReviews || 0}
                    max={data.tokensSent || 1}
                    color={colors.blue[600]}
                  />
                  <FunnelBar
                    label="Позитивные (4-5)"
                    value={data.positiveReviews || 0}
                    max={data.tokensSent || 1}
                    color={colors.green[500]}
                  />
                  <FunnelBar
                    label="Перешли на площадку"
                    value={data.publicRedirects || 0}
                    max={data.tokensSent || 1}
                    color={colors.emerald[700]}
                  />
                </View>
              </AnimatedCard>
            )}

            {/* Employee Ratings */}
            {data.employeeRatings && data.employeeRatings.length > 0 && (
              <AnimatedCard
                index={8}
                style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
              >
                <View style={styles.sectionHeaderRow}>
                  <Text style={[styles.sectionTitle, { color: palette.text.primary }]}>Рейтинг сотрудников</Text>
                  <Ionicons name="trophy-outline" size={18} color={colors.amber[600]} />
                </View>
                {data.employeeRatings.map((emp, idx) => (
                  <View
                    key={emp.employeeId || idx}
                    style={[styles.empRow, idx > 0 && [styles.empRowBorder, { borderTopColor: palette.border.subtle }]]}
                  >
                    <View style={[styles.empRankBadge, { backgroundColor: palette.bg.muted }]}>
                      {idx < 3 ? (
                        <Ionicons
                          name="trophy"
                          size={16}
                          color={idx === 0 ? '#FFD700' : idx === 1 ? '#C0C0C0' : '#CD7F32'}
                        />
                      ) : (
                        <Text style={[styles.empRankText, { color: palette.text.tertiary }]}>{idx + 1}</Text>
                      )}
                    </View>
                    <View style={styles.empInfo}>
                      <Text style={[styles.empName, { color: palette.text.primary }]} numberOfLines={1}>
                        {emp.employeeName}
                      </Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
                        <StarRating rating={emp.avgRating || 0} size={12} />
                        <Text style={[styles.empReviewCount, { color: palette.text.tertiary }]}>
                          {emp.reviewCount} отзывов
                        </Text>
                      </View>
                    </View>
                    <Text style={[styles.empRating, { color: palette.text.primary }]}>
                      {(emp.avgRating || 0).toFixed(1)}
                    </Text>
                  </View>
                ))}
              </AnimatedCard>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing[4] },

  // Alert
  alertCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    backgroundColor: colors.red[50],
    borderColor: colors.red[200],
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    padding: spacing[3.5],
  },
  alertIcon: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  alertTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.bold },
  alertSub: { fontSize: fontSize.xs, marginTop: 2 },

  // KPI Grid
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[3] },
  statCard: {
    width: '47%',
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    padding: spacing[4],
  },
  statIconBox: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.xl,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[3],
  },
  statValue: { fontSize: fontSize['2xl'], fontWeight: fontWeight.bold },
  statLabel: { fontSize: fontSize.xs, marginTop: 2 },

  // Card
  card: {
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    padding: spacing[4],
  },
  sectionTitle: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    marginBottom: spacing[3],
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing[3],
  },

  // Funnel
  funnelLabel: { fontSize: fontSize.xs },
  funnelValue: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold },
  funnelBarBg: { height: 8, borderRadius: 4, overflow: 'hidden' },
  funnelBarFill: { height: 8, borderRadius: 4 },

  // Employees
  empRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing[3], gap: spacing[3] },
  empRowBorder: { borderTopWidth: 1 },
  empRankBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empRankText: { fontSize: fontSize.sm, fontWeight: fontWeight.bold },
  empInfo: { flex: 1, minWidth: 0 },
  empName: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  empReviewCount: { fontSize: 11 },
  empRating: { fontSize: fontSize.lg, fontWeight: fontWeight.bold },

  // Empty
  emptyCard: { alignItems: 'center', paddingVertical: spacing[12], gap: spacing[3] },
  emptyTitle: { fontSize: fontSize.sm },
});
