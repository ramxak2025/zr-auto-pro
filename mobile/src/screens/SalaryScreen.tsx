import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { salaryApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import LoadingSpinner from '../components/LoadingSpinner';
import AnimatedCard from '../components/AnimatedCard';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import type { MasterSalary } from '../../../shared/types';

function formatMoney(v: number) { return Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'; }

export default function SalaryScreen() {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [refreshing, setRefreshing] = useState(false);

  const now = new Date();
  const [dateFrom, setDateFrom] = useState(new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10));
  const [dateTo, setDateTo] = useState(now.toISOString().slice(0, 10));

  const { data: salaries, isLoading } = useQuery<MasterSalary[]>({
    queryKey: ['salary', dateFrom, dateTo],
    queryFn: async () => { const res = await salaryApi.getAll({ dateFrom, dateTo }); return res.data; },
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['salary'] });
    setRefreshing(false);
  };

  const totalEarnings = (salaries || []).reduce((s, m) => s + m.totalEarnings, 0);
  const totalRevenue = (salaries || []).reduce((s, m) => s + m.totalRevenue, 0);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={22} color={colors.gray[700]} />
        </TouchableOpacity>
        <Text style={styles.title}>Зарплата</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />}
      >
        {/* Summary */}
        <AnimatedCard style={styles.summaryCard} index={0}>
          <View style={styles.summaryRow}>
            <View style={{ flex: 1 }}>
              <Ionicons name="trending-up-outline" size={18} color="rgba(255,255,255,0.7)" style={{ marginBottom: 4 }} />
              <Text style={styles.summaryLabel}>Общая выручка</Text>
              <Text style={styles.summaryValue}>{formatMoney(totalRevenue)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Ionicons name="wallet-outline" size={18} color="rgba(255,255,255,0.7)" style={{ marginBottom: 4 }} />
              <Text style={styles.summaryLabel}>Зарплаты</Text>
              <Text style={styles.summaryValue}>{formatMoney(totalEarnings)}</Text>
            </View>
          </View>
        </AnimatedCard>

        {isLoading ? <LoadingSpinner /> : (
          (salaries || []).map((master, idx) => (
            <AnimatedCard key={master.masterId} style={styles.masterCard} index={idx + 1}>
              <View style={styles.masterTop}>
                <View style={styles.masterCircle}>
                  <Text style={styles.masterInitials}>
                    {master.masterName.split(' ').map(w => w[0]).join('').slice(0, 2)}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.masterName}>{master.masterName}</Text>
                  <Text style={styles.masterPercent}>
                    Услуги {master.salaryPercent}%{master.productSalaryPercent ? ` · Товары ${master.productSalaryPercent}%` : ''}
                  </Text>
                </View>
              </View>
              <View style={styles.masterStats}>
                <View style={styles.masterStatItem}>
                  <Text style={styles.masterStatLabel}>Выручка</Text>
                  <Text style={styles.masterStatValue}>{formatMoney(master.totalRevenue)}</Text>
                </View>
                <View style={styles.masterStatItem}>
                  <Text style={styles.masterStatLabel}>Заработок</Text>
                  <Text style={[styles.masterStatValue, { color: colors.green[600] }]}>{formatMoney(master.totalEarnings)}</Text>
                </View>
                <View style={styles.masterStatItem}>
                  <Text style={styles.masterStatLabel}>Чеков</Text>
                  <Text style={styles.masterStatValue}>{master.checkCount}</Text>
                </View>
              </View>
              {(master.serviceEarnings || master.productEarnings) ? (
                <View style={styles.earningsBreakdown}>
                  {master.serviceEarnings ? <Text style={styles.earningsItem}>С услуг: {formatMoney(master.serviceEarnings)}</Text> : null}
                  {master.productEarnings ? <Text style={styles.earningsItem}>С товаров: {formatMoney(master.productEarnings)}</Text> : null}
                </View>
              ) : null}
            </AnimatedCard>
          ))
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
  summaryCard: { backgroundColor: colors.primary[600], borderRadius: borderRadius['2xl'], padding: spacing[5] },
  summaryRow: { flexDirection: 'row', gap: spacing[4] },
  summaryLabel: { fontSize: fontSize.xs, color: 'rgba(255,255,255,0.7)' },
  summaryValue: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.white, marginTop: 4 },
  masterCard: { backgroundColor: colors.white, borderRadius: borderRadius['2xl'], borderWidth: 1, borderColor: colors.gray[100], padding: spacing[4] },
  masterTop: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], marginBottom: spacing[3] },
  masterCircle: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary[100], alignItems: 'center', justifyContent: 'center' },
  masterInitials: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.primary[700] },
  masterName: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  masterPercent: { fontSize: fontSize.xs, color: colors.gray[400], marginTop: 2 },
  masterStats: { flexDirection: 'row', gap: spacing[2] },
  masterStatItem: { flex: 1, backgroundColor: colors.gray[50], borderRadius: borderRadius.lg, padding: spacing[3] },
  masterStatLabel: { fontSize: 10, color: colors.gray[400] },
  masterStatValue: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900], marginTop: 4 },
  earningsBreakdown: { flexDirection: 'row', gap: spacing[4], marginTop: spacing[3], paddingTop: spacing[3], borderTopWidth: 1, borderTopColor: colors.gray[50] },
  earningsItem: { fontSize: fontSize.xs, color: colors.gray[500] },
});
