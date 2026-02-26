import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { scheduleApi } from '../api/services';
import LoadingSpinner from '../components/LoadingSpinner';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import type { TodayEmployeeStatus } from '../../../shared/types';

export default function ScheduleScreen() {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const { data: todayData, isLoading } = useQuery<TodayEmployeeStatus[]>({
    queryKey: ['schedule-today'],
    queryFn: async () => { const res = await scheduleApi.getToday(); return res.data; },
    staleTime: 30_000,
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['schedule-today'] });
    setRefreshing(false);
  };

  const statuses = todayData ?? [];
  const isSick = (s: TodayEmployeeStatus) => (s.note || '').toLowerCase().includes('больнич');

  const getStatusInfo = (s: TodayEmployeeStatus) => {
    if (isSick(s)) return { label: 'Больничный', color: colors.rose[400], emoji: '🏥' };
    if (s.isDayOff) return { label: 'Выходной', color: colors.gray[400], emoji: '🌙' };
    if (s.lateStatus === 'late_major') return { label: 'Опоздание > 1ч', color: colors.orange[500], emoji: '⚠️' };
    if (s.lateStatus === 'late_minor') return { label: 'Опоздание < 1ч', color: colors.yellow[400], emoji: '⏰' };
    if (s.isWorking) return { label: 'На смене', color: colors.green[500], emoji: '✅' };
    if (s.hasSchedule) return { label: 'Не пришёл', color: colors.gray[300], emoji: '❌' };
    return { label: '—', color: colors.gray[200], emoji: '' };
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>← Назад</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Расписание</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />}>
        <Text style={styles.subtitle}>Сегодня</Text>

        {isLoading ? <LoadingSpinner /> : statuses.length === 0 ? (
          <Text style={styles.empty}>Расписание не настроено</Text>
        ) : (
          statuses.map(s => {
            const info = getStatusInfo(s);
            return (
              <View key={s.userId} style={styles.card}>
                <View style={styles.cardRow}>
                  <View style={[styles.statusDot, { backgroundColor: info.color }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.empName}>{s.fullName}</Text>
                    {s.shiftStart && s.shiftEnd && (
                      <Text style={styles.empShift}>{s.shiftStart} — {s.shiftEnd}</Text>
                    )}
                  </View>
                  <View style={styles.statusRight}>
                    <Text style={{ fontSize: 16 }}>{info.emoji}</Text>
                    <Text style={styles.statusLabel}>{info.label}</Text>
                  </View>
                </View>
                {s.actualArrival && (
                  <Text style={styles.arrivalText}>Пришёл: {new Date(s.actualArrival).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</Text>
                )}
                {s.note && <Text style={styles.noteText}>{s.note}</Text>}
              </View>
            );
          })
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
  subtitle: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  empty: { textAlign: 'center', padding: spacing[8], color: colors.gray[400] },
  card: { backgroundColor: colors.white, borderRadius: borderRadius['2xl'], borderWidth: 1, borderColor: colors.gray[100], padding: spacing[4] },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  statusDot: { width: 12, height: 12, borderRadius: 6 },
  empName: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  empShift: { fontSize: fontSize.xs, color: colors.gray[400], marginTop: 2 },
  statusRight: { alignItems: 'center', gap: 4 },
  statusLabel: { fontSize: 10, color: colors.gray[500] },
  arrivalText: { fontSize: fontSize.xs, color: colors.gray[400], marginTop: spacing[2] },
  noteText: { fontSize: fontSize.xs, color: colors.gray[500], marginTop: spacing[1], fontStyle: 'italic' },
});
