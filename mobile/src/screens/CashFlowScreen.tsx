import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { reportsApi } from '../api/services';
import LoadingSpinner from '../components/LoadingSpinner';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';

function formatMoney(v: number) { return Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'; }

export default function CashFlowScreen() {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const now = new Date();
  const [dateFrom] = useState(new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10));
  const [dateTo] = useState(now.toISOString().slice(0, 10));

  const { data: cashflow, isLoading } = useQuery<any>({
    queryKey: ['cashflow', dateFrom, dateTo],
    queryFn: async () => { const res = await reportsApi.getCashFlow({ dateFrom, dateTo }); return res.data; },
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['cashflow'] });
    setRefreshing(false);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>← Назад</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Движение денег</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />}>
        {isLoading ? <LoadingSpinner /> : !cashflow ? (
          <Text style={styles.empty}>Нет данных</Text>
        ) : (
          <>
            {/* Summary cards */}
            <View style={styles.summaryRow}>
              <View style={[styles.summaryCard, { backgroundColor: colors.green[50] }]}>
                <Text style={{ fontSize: 20 }}>💵</Text>
                <Text style={styles.summaryLabel}>Наличные</Text>
                <Text style={styles.summaryValue}>{formatMoney(cashflow.totalCash || 0)}</Text>
              </View>
              <View style={[styles.summaryCard, { backgroundColor: colors.blue[50] }]}>
                <Text style={{ fontSize: 20 }}>💳</Text>
                <Text style={styles.summaryLabel}>Карта</Text>
                <Text style={styles.summaryValue}>{formatMoney(cashflow.totalCard || 0)}</Text>
              </View>
              <View style={[styles.summaryCard, { backgroundColor: colors.yellow[50] }]}>
                <Text style={{ fontSize: 20 }}>🛡</Text>
                <Text style={styles.summaryLabel}>Гарантия</Text>
                <Text style={styles.summaryValue}>{formatMoney(cashflow.totalWarranty || 0)}</Text>
              </View>
            </View>

            <View style={styles.totalCard}>
              <Text style={styles.totalLabel}>Итого за период</Text>
              <Text style={styles.totalValue}>{formatMoney(cashflow.total || 0)}</Text>
            </View>

            {/* Daily breakdown */}
            {(cashflow.days || []).map((day: any) => (
              <View key={day.date} style={styles.dayCard}>
                <View style={styles.dayHeader}>
                  <Text style={styles.dayDate}>{new Date(day.date).toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' })}</Text>
                  <Text style={styles.dayTotal}>{formatMoney(day.total)}</Text>
                </View>
                <View style={styles.dayDetails}>
                  <Text style={styles.dayDetail}>Нал: {formatMoney(day.cash || 0)}</Text>
                  <Text style={styles.dayDetail}>Карта: {formatMoney(day.card || 0)}</Text>
                  {day.warranty > 0 && <Text style={styles.dayDetail}>Гарант: {formatMoney(day.warranty)}</Text>}
                </View>
              </View>
            ))}
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
  summaryRow: { flexDirection: 'row', gap: spacing[2] },
  summaryCard: { flex: 1, borderRadius: borderRadius.xl, padding: spacing[3], alignItems: 'center' },
  summaryLabel: { fontSize: 10, color: colors.gray[500], marginTop: 4 },
  summaryValue: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900], marginTop: 4 },
  totalCard: { backgroundColor: colors.white, borderRadius: borderRadius['2xl'], borderWidth: 2, borderColor: colors.primary[100], padding: spacing[4], flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[700] },
  totalValue: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.gray[900] },
  dayCard: { backgroundColor: colors.white, borderRadius: borderRadius.xl, borderWidth: 1, borderColor: colors.gray[100], padding: spacing[4] },
  dayHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dayDate: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[700] },
  dayTotal: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900] },
  dayDetails: { flexDirection: 'row', gap: spacing[3], marginTop: spacing[2], paddingTop: spacing[2], borderTopWidth: 1, borderTopColor: colors.gray[50] },
  dayDetail: { fontSize: fontSize.xs, color: colors.gray[400] },
});
