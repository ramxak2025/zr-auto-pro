import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { reportsApi } from '../api/services';
import LoadingSpinner from '../components/LoadingSpinner';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import type { FinancialReport } from '../../shared/types';

function formatMoney(v: number) { return Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'; }

export default function ReportsScreen() {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const now = new Date();
  const [dateFrom] = useState(new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10));
  const [dateTo] = useState(now.toISOString().slice(0, 10));

  const { data: report, isLoading } = useQuery<FinancialReport>({
    queryKey: ['financial-report', dateFrom, dateTo],
    queryFn: async () => { const res = await reportsApi.getFinancial({ dateFrom, dateTo }); return res.data; },
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['financial-report'] });
    setRefreshing(false);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>← Назад</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Отчёты</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />}>
        {isLoading ? <LoadingSpinner /> : !report ? (
          <Text style={styles.empty}>Нет данных</Text>
        ) : (
          <>
            <View style={styles.periodCard}>
              <Text style={styles.periodText}>Период: {dateFrom} — {dateTo}</Text>
              <Text style={styles.periodChecks}>{report.checkCount} чеков</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Выручка</Text>
              <Text style={styles.bigValue}>{formatMoney(report.revenue)}</Text>
            </View>

            <View style={styles.row}>
              <View style={[styles.card, { flex: 1 }]}>
                <Text style={styles.cardLabel}>Себест. товаров</Text>
                <Text style={styles.cardValue}>{formatMoney(report.productCost)}</Text>
              </View>
              <View style={[styles.card, { flex: 1 }]}>
                <Text style={styles.cardLabel}>Зарплаты</Text>
                <Text style={styles.cardValue}>{formatMoney(report.salaries)}</Text>
              </View>
            </View>

            <View style={styles.row}>
              <View style={[styles.card, { flex: 1 }]}>
                <Text style={styles.cardLabel}>Валовая прибыль</Text>
                <Text style={[styles.cardValue, { color: colors.green[600] }]}>{formatMoney(report.grossProfit)}</Text>
              </View>
              <View style={[styles.card, { flex: 1 }]}>
                <Text style={styles.cardLabel}>Чистая прибыль</Text>
                <Text style={[styles.cardValue, report.netProfit >= 0 ? { color: colors.green[600] } : { color: colors.red[500] }]}>{formatMoney(report.netProfit)}</Text>
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.gray[50] },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing[4], paddingVertical: spacing[3], backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.gray[200] },
  backText: { fontSize: fontSize.sm, color: colors.primary[600], fontWeight: fontWeight.medium },
  title: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.gray[900] },
  scrollContent: { padding: spacing[4], gap: spacing[3], paddingBottom: spacing[8] },
  empty: { textAlign: 'center', padding: spacing[8], color: colors.gray[400] },
  periodCard: { backgroundColor: colors.primary[50], borderRadius: borderRadius['2xl'], padding: spacing[4], flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  periodText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.primary[700] },
  periodChecks: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.primary[700] },
  card: { backgroundColor: colors.white, borderRadius: borderRadius['2xl'], borderWidth: 1, borderColor: colors.gray[100], padding: spacing[4] },
  cardTitle: { fontSize: fontSize.xs, color: colors.gray[500], marginBottom: spacing[1] },
  bigValue: { fontSize: fontSize['2xl'], fontWeight: fontWeight.bold, color: colors.gray[900] },
  row: { flexDirection: 'row', gap: spacing[3] },
  cardLabel: { fontSize: fontSize.xs, color: colors.gray[500], marginBottom: spacing[1] },
  cardValue: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.gray[900] },
});
