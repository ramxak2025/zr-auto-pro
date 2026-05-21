import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import IosScreenHeader from '../components/IosScreenHeader';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { reportsApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import { useColors } from '../contexts/ThemeContext';
import LoadingSpinner from '../components/LoadingSpinner';
import AnimatedCard from '../components/AnimatedCard';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import type { FinancialReport } from '../../../shared/types';

function formatMoney(v: number) {
  const abs = Math.abs(Math.round(v));
  const formatted = abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${v < 0 ? '-' : ''}${formatted} ₽`;
}

function toDateStr(d: Date) {
  return d.toISOString().slice(0, 10);
}

const PERIODS = [
  { key: 'today', label: 'Сегодня' },
  { key: 'week', label: 'Неделя' },
  { key: 'month', label: 'Месяц' },
] as const;

function getDateRange(period: string) {
  const now = new Date();
  const today = toDateStr(now);
  if (period === 'today') return { from: today, to: today };
  if (period === 'week') {
    const day = now.getDay();
    const diff = day === 0 ? 6 : day - 1;
    const monday = new Date(now);
    monday.setDate(now.getDate() - diff);
    return { from: toDateStr(monday), to: today };
  }
  return { from: toDateStr(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
}

function pctOf(part: number, total: number) {
  if (total <= 0) return '0';
  return ((part / total) * 100).toFixed(1);
}

export default function ReportsScreen() {
  const navigation = useNavigation<any>();
  const { hasPermission } = useAuth();
  const palette = useColors();
  const queryClient = useQueryClient();
  const tabBarHeight = useTabBarHeight();
  const [refreshing, setRefreshing] = useState(false);
  const [period, setPeriod] = useState<string>('month');
  const [dateFrom, setDateFrom] = useState(getDateRange('month').from);
  const [dateTo, setDateTo] = useState(getDateRange('month').to);

  const canView = hasPermission('financial_reports');

  const { data: report, isLoading } = useQuery<FinancialReport>({
    queryKey: ['financial-report', dateFrom, dateTo],
    queryFn: async () => {
      const res = await reportsApi.getFinancial({ dateFrom, dateTo });
      return res.data;
    },
    enabled: canView,
    // SWR — keep previous period's report visible while the user
    // taps between Сегодня / Неделя / Месяц.
    placeholderData: (prev) => prev,
  });

  // Отдельный запрос на агрегаты брака/списаний за тот же период. Бэкенд
  // принимает `from` / `to` (а не `dateFrom` / `dateTo`), и значения
  // совпадают с YYYY-MM-DD из основного фильтра выше.
  const { data: defectWriteoff } = useQuery({
    queryKey: ['defect-writeoff-report', dateFrom, dateTo],
    queryFn: async () => {
      const res = await reportsApi.defectWriteoff({ from: dateFrom, to: dateTo });
      return res.data;
    },
    enabled: canView,
    placeholderData: (prev) => prev,
  });

  const handlePeriodChange = (p: string) => {
    setPeriod(p);
    const range = getDateRange(p);
    setDateFrom(range.from);
    setDateTo(range.to);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['financial-report'] });
    setRefreshing(false);
  };

  if (!canView) {
    return (
      <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
        <IosScreenHeader title="Отчёты" onBack={() => navigation.goBack()} />
        <View style={styles.accessDenied}>
          <Ionicons name="lock-closed" size={40} color={palette.text.tertiary} />
          <Text style={[styles.adTitle, { color: palette.text.primary }]}>Доступ ограничен</Text>
          <Text style={[styles.adDesc, { color: palette.text.secondary }]}>
            У вас нет прав для просмотра финансовых отчетов
          </Text>
        </View>
      </View>
    );
  }

  const marginPct = report && report.revenue > 0 ? ((report.netProfit / report.revenue) * 100).toFixed(1) : '0';

  const avgCheck =
    report && report.checkCount > 0 && report.revenue > 0 ? formatMoney(report.revenue / report.checkCount) : '—';

  const otherExpenses = (report as any)?.otherExpenses ?? 0;

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title="Отчёты" onBack={() => navigation.goBack()} />

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarHeight + spacing[4] }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />
        }
      >
        {/* Period selector */}
        <View style={styles.periodRow}>
          {PERIODS.map((p) => (
            <TouchableOpacity
              key={p.key}
              style={[
                styles.periodChip,
                { backgroundColor: palette.bg.muted },
                period === p.key && styles.periodChipActive,
              ]}
              onPress={() => handlePeriodChange(p.key)}
            >
              <Text
                style={[
                  styles.periodText,
                  { color: palette.text.secondary },
                  period === p.key && styles.periodTextActive,
                ]}
              >
                {p.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Cold-start: spinner only until any report lands. Once we
            have one (even from a previous period via SWR), keep it
            visible across period changes. */}
        {report === undefined ? (
          <LoadingSpinner />
        ) : !report && !isLoading ? (
          <Text style={[styles.empty, { color: palette.text.tertiary }]}>Нет данных за выбранный период</Text>
        ) : (
          <>
            {/* Hero: Net Profit */}
            <AnimatedCard index={0}>
              <LinearGradient
                colors={report.netProfit >= 0 ? ['#059669', '#047857'] : ['#dc2626', '#b91c1c']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.heroCard}
              >
                <View style={styles.heroTop}>
                  <Ionicons
                    name={report.netProfit >= 0 ? 'trending-up' : 'trending-down'}
                    size={16}
                    color="rgba(255,255,255,0.6)"
                  />
                  <Text style={styles.heroLabel}>ЧИСТАЯ ПРИБЫЛЬ</Text>
                </View>
                <Text style={styles.heroValue}>{formatMoney(report.netProfit)}</Text>
                <Text style={styles.heroSub}>Маржа {marginPct}%</Text>
              </LinearGradient>
            </AnimatedCard>

            {/* Revenue + Gross Profit */}
            <AnimatedCard index={1} style={styles.twoCol}>
              <View style={[styles.metricCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
                <View style={styles.metricIconWrap}>
                  <View style={[styles.metricIcon, { backgroundColor: colors.blue[50] }]}>
                    <Ionicons name="trending-up" size={16} color={colors.blue[600]} />
                  </View>
                  <Text style={[styles.metricLabel, { color: palette.text.secondary }]}>Выручка</Text>
                </View>
                <Text style={[styles.metricValue, { color: palette.text.primary }]}>{formatMoney(report.revenue)}</Text>
              </View>

              <View style={[styles.metricCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
                <View style={styles.metricIconWrap}>
                  <View style={[styles.metricIcon, { backgroundColor: colors.green[50] }]}>
                    <Ionicons name="trending-up" size={16} color={colors.green[600]} />
                  </View>
                  <Text style={[styles.metricLabel, { color: palette.text.secondary }]}>Валовая прибыль</Text>
                </View>
                <Text style={[styles.metricValue, { color: palette.text.primary }]}>{formatMoney(report.grossProfit)}</Text>
              </View>
            </AnimatedCard>

            {/* Expenses breakdown */}
            <AnimatedCard
              index={2}
              style={[styles.expCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
            >
              <Text style={[styles.expTitle, { color: palette.text.tertiary }]}>РАСХОДЫ</Text>

              <View style={styles.expRow}>
                <View style={styles.expLeft}>
                  <View style={[styles.expIcon, { backgroundColor: colors.orange[50] }]}>
                    <Ionicons name="cube-outline" size={16} color={colors.orange[500]} />
                  </View>
                  <View>
                    <Text style={[styles.expName, { color: palette.text.primary }]}>Себестоимость товаров</Text>
                    {report.revenue > 0 && (
                      <Text style={[styles.expPct, { color: palette.text.tertiary }]}>
                        {pctOf(report.productCost, report.revenue)}% от выручки
                      </Text>
                    )}
                  </View>
                </View>
                <Text style={[styles.expAmount, { color: palette.text.primary }]}>{formatMoney(report.productCost)}</Text>
              </View>

              <View style={[styles.expDivider, { backgroundColor: palette.border.subtle }]} />

              <View style={styles.expRow}>
                <View style={styles.expLeft}>
                  <View style={[styles.expIcon, { backgroundColor: colors.violet[50] }]}>
                    <Ionicons name="people-outline" size={16} color={colors.violet[500]} />
                  </View>
                  <View>
                    <Text style={[styles.expName, { color: palette.text.primary }]}>Зарплаты мастерам</Text>
                    {report.revenue > 0 && (
                      <Text style={[styles.expPct, { color: palette.text.tertiary }]}>
                        {pctOf(report.salaries, report.revenue)}% от выручки
                      </Text>
                    )}
                  </View>
                </View>
                <Text style={[styles.expAmount, { color: palette.text.primary }]}>{formatMoney(report.salaries)}</Text>
              </View>

              {otherExpenses > 0 && (
                <>
                  <View style={[styles.expDivider, { backgroundColor: palette.border.subtle }]} />
                  <View style={styles.expRow}>
                    <View style={styles.expLeft}>
                      <View style={[styles.expIcon, { backgroundColor: colors.rose[50] }]}>
                        <Ionicons name="wallet-outline" size={16} color={colors.rose[500]} />
                      </View>
                      <View>
                        <Text style={[styles.expName, { color: palette.text.primary }]}>Прочие расходы</Text>
                        {report.revenue > 0 && (
                          <Text style={[styles.expPct, { color: palette.text.tertiary }]}>
                            {pctOf(otherExpenses, report.revenue)}% от выручки
                          </Text>
                        )}
                      </View>
                    </View>
                    <Text style={[styles.expAmount, { color: palette.text.primary }]}>{formatMoney(otherExpenses)}</Text>
                  </View>
                </>
              )}
            </AnimatedCard>

            {/* Check count */}
            <AnimatedCard
              index={3}
              style={[styles.checkCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
            >
              <View style={styles.checkLeft}>
                <View style={[styles.metricIcon, { backgroundColor: colors.primary[50] }]}>
                  <Ionicons name="receipt-outline" size={16} color={colors.primary[600]} />
                </View>
                <View>
                  <Text style={[styles.expName, { color: palette.text.primary }]}>Количество чеков</Text>
                  {report.checkCount > 0 && (
                    <Text style={[styles.expPct, { color: palette.text.tertiary }]}>Ср. чек: {avgCheck}</Text>
                  )}
                </View>
              </View>
              <Text style={styles.checkCount}>{report.checkCount}</Text>
            </AnimatedCard>

            {/* Defect + writeoff aggregates за тот же период. Сама секция
                всегда показывается (даже на нулях) — владельцу важно
                видеть, что данных нет, а не делать вид, что их не было.
                Источник — reports/defect-writeoff из shared/api. */}
            <AnimatedCard
              index={4}
              style={[styles.expCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
            >
              <Text style={[styles.expTitle, { color: palette.text.tertiary }]}>БРАК И СПИСАНИЯ</Text>

              <View style={styles.expRow}>
                <View style={styles.expLeft}>
                  <View style={[styles.expIcon, { backgroundColor: colors.amber[50] }]}>
                    <Ionicons name="warning-outline" size={16} color={colors.amber[600]} />
                  </View>
                  <View>
                    <Text style={[styles.expName, { color: palette.text.primary }]}>Перенос в брак</Text>
                    <Text style={[styles.expPct, { color: palette.text.tertiary }]}>
                      {defectWriteoff?.defectQty ?? 0} шт
                    </Text>
                  </View>
                </View>
                <Text style={[styles.expAmount, { color: palette.text.primary }]}>
                  {formatMoney(defectWriteoff?.defectValue ?? 0)}
                </Text>
              </View>

              <View style={[styles.expDivider, { backgroundColor: palette.border.subtle }]} />

              <View style={styles.expRow}>
                <View style={styles.expLeft}>
                  <View style={[styles.expIcon, { backgroundColor: colors.red[50] }]}>
                    <Ionicons name="trash-outline" size={16} color={colors.red[500]} />
                  </View>
                  <View>
                    <Text style={[styles.expName, { color: palette.text.primary }]}>Списано всего</Text>
                    <Text style={[styles.expPct, { color: palette.text.tertiary }]}>
                      {defectWriteoff?.writeoffQty ?? 0} шт
                    </Text>
                  </View>
                </View>
                <Text style={[styles.expAmount, { color: palette.text.primary }]}>
                  {formatMoney(defectWriteoff?.writeoffValue ?? 0)}
                </Text>
              </View>

              <View style={[styles.expDivider, { backgroundColor: palette.border.subtle }]} />

              <View style={styles.expRow}>
                <View style={styles.expLeft}>
                  <View style={[styles.expIcon, { backgroundColor: colors.rose[50] }]}>
                    <Ionicons name="receipt-outline" size={16} color={colors.rose[600]} />
                  </View>
                  <View>
                    <Text style={[styles.expName, { color: palette.text.primary }]}>Списано в расходы</Text>
                    <Text style={[styles.expPct, { color: palette.text.tertiary }]}>
                      {defectWriteoff?.writeoffExpensedQty ?? 0} шт
                    </Text>
                  </View>
                </View>
                <Text style={[styles.expAmount, { color: palette.text.primary }]}>
                  {formatMoney(defectWriteoff?.writeoffExpensedValue ?? 0)}
                </Text>
              </View>

              <View style={[styles.expDivider, { backgroundColor: palette.border.subtle }]} />

              <View style={styles.expRow}>
                <View style={styles.expLeft}>
                  <View style={[styles.expIcon, { backgroundColor: colors.indigo[50] }]}>
                    <Ionicons name="arrow-undo-outline" size={16} color={colors.indigo[600]} />
                  </View>
                  <View>
                    <Text style={[styles.expName, { color: palette.text.primary }]}>Возврат поставщику</Text>
                    <Text style={[styles.expPct, { color: palette.text.tertiary }]}>
                      {defectWriteoff?.returnedToSupplierQty ?? 0} шт
                    </Text>
                  </View>
                </View>
                <Text style={[styles.expAmount, { color: palette.text.primary }]}>
                  {formatMoney(defectWriteoff?.returnedToSupplierValue ?? 0)}
                </Text>
              </View>
            </AnimatedCard>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.gray[50] },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.gray[200],
  },
  headerCenter: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  headerIcon: { width: 36, height: 36, borderRadius: borderRadius.xl, alignItems: 'center', justifyContent: 'center' },
  backText: { fontSize: fontSize.sm, color: colors.primary[600], fontWeight: fontWeight.medium },
  title: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.gray[900] },
  scrollContent: { padding: spacing[4], gap: spacing[3], paddingBottom: spacing[8] },
  empty: { textAlign: 'center', padding: spacing[8], color: colors.gray[400], fontSize: fontSize.sm },
  // Access denied
  accessDenied: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing[8] },
  adTitle: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.gray[900], marginTop: spacing[4] },
  adDesc: { fontSize: fontSize.sm, color: colors.gray[500], textAlign: 'center', marginTop: spacing[2] },
  // Period
  periodRow: { flexDirection: 'row', gap: spacing[2] },
  periodChip: {
    flex: 1,
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.xl,
    backgroundColor: colors.gray[100],
    alignItems: 'center',
  },
  periodChipActive: { backgroundColor: colors.primary[600] },
  periodText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.gray[600] },
  periodTextActive: { color: colors.white },
  // Hero
  heroCard: { borderRadius: borderRadius['2xl'], padding: spacing[5], overflow: 'hidden' },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: spacing[1.5], marginBottom: spacing[1] },
  heroLabel: { fontSize: 11, fontWeight: fontWeight.bold, color: 'rgba(255,255,255,0.6)', letterSpacing: 1 },
  heroValue: { fontSize: 32, fontWeight: fontWeight.bold, color: colors.white },
  heroSub: { fontSize: fontSize.sm, color: 'rgba(255,255,255,0.5)', marginTop: 2 },
  // Two columns
  twoCol: { flexDirection: 'row', gap: spacing[3] },
  metricCard: {
    flex: 1,
    backgroundColor: colors.white,
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    borderColor: colors.gray[100],
    padding: spacing[4],
  },
  metricIconWrap: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginBottom: spacing[3] },
  metricIcon: { width: 32, height: 32, borderRadius: borderRadius.lg, alignItems: 'center', justifyContent: 'center' },
  metricLabel: { fontSize: fontSize.xs, fontWeight: fontWeight.medium, color: colors.gray[500] },
  metricValue: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.gray[900] },
  // Expenses
  expCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    borderColor: colors.gray[100],
    overflow: 'hidden',
  },
  expTitle: {
    fontSize: 11,
    fontWeight: fontWeight.bold,
    color: colors.gray[400],
    letterSpacing: 1,
    paddingHorizontal: spacing[4],
    paddingTop: spacing[4],
    paddingBottom: spacing[2],
  },
  expRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3.5],
  },
  expLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], flex: 1 },
  expIcon: { width: 36, height: 36, borderRadius: borderRadius.xl, alignItems: 'center', justifyContent: 'center' },
  expName: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[900] },
  expPct: { fontSize: 11, color: colors.gray[400], marginTop: 1 },
  expAmount: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900] },
  expDivider: { height: 1, backgroundColor: colors.gray[50], marginHorizontal: spacing[4] },
  // Check count
  checkCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.white,
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    borderColor: colors.gray[100],
    padding: spacing[4],
  },
  checkLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  checkCount: { fontSize: 28, fontWeight: fontWeight.bold, color: colors.primary[600] },
});
