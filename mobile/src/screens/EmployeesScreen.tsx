/**
 * EmployeesScreen — list of all active staff. Each row → EmployeeDetail.
 *
 * Mirrors the web Employees page: avatar with status dot, name, role badge,
 * today status string. Lives inside the More tab stack.
 */
import React, { useMemo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, RefreshControl,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { usersApi, scheduleApi } from '../api/services';
import { ListSkeleton } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import type { User, TodayEmployeeStatus } from '../../../shared/types';
import { roleLabels } from '../../../shared/utils/formatters';

const ROLE_BADGE: Record<string, { bg: string; text: string }> = {
  superadmin: { bg: colors.red[50], text: colors.red[700] },
  director: { bg: colors.purple[50], text: colors.purple[700] },
  admin: { bg: colors.blue[50], text: colors.blue[700] },
  master: { bg: colors.green[50], text: colors.green[700] },
};

const statusDotColor = (s?: TodayEmployeeStatus): string => {
  if (!s) return colors.gray[200];
  const note = (s.note || '').toLowerCase();
  if (note.includes('больнич')) return colors.rose[400];
  if (s.isDayOff) return colors.gray[400];
  if (s.lateStatus === 'late_major') return colors.orange[500];
  if (s.lateStatus === 'late_minor') return colors.yellow[300];
  if (s.isWorking || s.actualArrival || s.lateStatus === 'on_time') return colors.green[500];
  if (note.includes('прогул')) return colors.red[500];
  if (s.hasSchedule) return colors.gray[300];
  return colors.gray[200];
};

const statusLabel = (s?: TodayEmployeeStatus): string => {
  if (!s) return 'Нет данных';
  const note = (s.note || '').toLowerCase();
  if (note.includes('больнич')) return 'Больничный';
  if (s.isDayOff) return 'Выходной';
  if (s.lateStatus === 'late_major') return `Опозд. >1 ч`;
  if (s.lateStatus === 'late_minor') return `Опозд. ${s.lateMinutes} мин`;
  if (s.isWorking || s.actualArrival || s.lateStatus === 'on_time') return 'На смене';
  if (note.includes('прогул')) return 'Прогул';
  if (s.hasSchedule) return 'Не пришёл';
  return '—';
};

export default function EmployeesScreen() {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = React.useState(false);

  const { data: users, isLoading } = useQuery<User[]>({
    queryKey: ['users-all'],
    queryFn: async () => { const res = await usersApi.getAll(); return res.data; },
    staleTime: 60_000,
  });

  const { data: today } = useQuery<TodayEmployeeStatus[]>({
    queryKey: ['schedule-today'],
    queryFn: async () => { const res = await scheduleApi.getToday(); return res.data; },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const todayMap = useMemo(() => {
    const map = new Map<string, TodayEmployeeStatus>();
    (today ?? []).forEach((s) => map.set(s.userId, s));
    return map;
  }, [today]);

  const sortedUsers = useMemo(
    () => (users ?? [])
      .filter((u) => u.isActive)
      .sort((a, b) => a.fullName.localeCompare(b.fullName, 'ru')),
    [users],
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['users-all'] }),
      queryClient.invalidateQueries({ queryKey: ['schedule-today'] }),
    ]);
    setRefreshing(false);
  };

  const renderItem = ({ item }: { item: User }) => {
    const status = todayMap.get(item.id);
    const initials = item.fullName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const role = ROLE_BADGE[item.role] || ROLE_BADGE.master;
    return (
      <TouchableOpacity
        style={styles.row}
        onPress={() => navigation.navigate('EmployeeDetail', { id: item.id })}
        activeOpacity={0.7}
      >
        <View style={styles.avatarWrap}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <View style={[styles.dot, { backgroundColor: statusDotColor(status) }]} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.name} numberOfLines={1}>{item.fullName}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[1.5], marginTop: 2 }}>
            <View style={[styles.badge, { backgroundColor: role.bg }]}>
              <Text style={[styles.badgeText, { color: role.text }]}>{roleLabels[item.role] || item.role}</Text>
            </View>
            <Text style={styles.status} numberOfLines={1}>{statusLabel(status)}</Text>
          </View>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.gray[300]} />
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <LinearGradient colors={[colors.white, colors.gray[50]] as [string, string]} style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={20} color={colors.primary[600]} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerIcon}>
            <Ionicons name="people-circle-outline" size={18} color={colors.cyan[600]} />
          </View>
          <Text style={styles.title}>Сотрудники</Text>
        </View>
        <View style={{ width: 40 }} />
      </LinearGradient>

      {isLoading ? (
        <ListSkeleton count={6} />
      ) : sortedUsers.length === 0 ? (
        <EmptyState title="Сотрудников пока нет" description="Пригласите команду через раздел «Пользователи»." />
      ) : (
        <FlashList
          data={sortedUsers}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.gray[50] },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing[4], paddingVertical: spacing[3],
    borderBottomWidth: 1, borderBottomColor: colors.gray[100],
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary[50],
    alignItems: 'center', justifyContent: 'center',
  },
  headerCenter: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  headerIcon: {
    width: 30, height: 30, borderRadius: borderRadius.lg,
    backgroundColor: colors.cyan[50], alignItems: 'center', justifyContent: 'center',
  },
  title: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.gray[900], letterSpacing: -0.3 },
  list: { paddingHorizontal: spacing[4], paddingTop: spacing[3], paddingBottom: spacing[8] },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing[3],
    backgroundColor: colors.white, borderRadius: borderRadius['2xl'],
    borderWidth: 1, borderColor: colors.gray[100],
    padding: spacing[3], marginBottom: spacing[2],
  },
  avatarWrap: { position: 'relative' },
  avatar: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: colors.blue[50],
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.blue[700] },
  dot: {
    position: 'absolute', bottom: -2, right: -2, width: 12, height: 12,
    borderRadius: 6, borderWidth: 2, borderColor: colors.white,
  },
  name: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  badge: { paddingHorizontal: spacing[2], paddingVertical: 2, borderRadius: borderRadius.full },
  badgeText: { fontSize: 10, fontWeight: fontWeight.semibold },
  status: { fontSize: fontSize.xs, color: colors.gray[500], flex: 1 },
});
