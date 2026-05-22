/**
 * EmployeesScreen — список сотрудников.
 *
 * Apple-like ряды:
 *   • градиентный аватар (стабильный hash-цвет от имени);
 *   • статус сегодня — pill с цветом и иконкой (на смене / опоздал /
 *     выходной / больничный / прогул / нет данных);
 *   • роль;
 *   • для мастеров — метрики дня (чеков / выручка) из existing
 *     `checksApi.getRanking()`. Если данных нет — метрики не рисуются,
 *     не плодим пустые «—».
 *
 * Финансовые цифры (выручка, чеков мастера) показываем только
 * пользователям с финансовым доступом: владелец / директор / админ.
 * Обычный мастер не должен видеть выручку коллеги — это противоречит
 * permission-логике в backend (`reports/profit_view`) и просто плохая
 * управленческая практика.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, RefreshControl, Platform } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import IosScreenHeader from '../components/IosScreenHeader';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { usersApi, scheduleApi, checksApi, employeesApi } from '../api/services';
import { ListSkeleton } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import AnimatedCard from '../components/AnimatedCard';
import FreshnessBadge from '../components/FreshnessBadge';
import { useAuth } from '../contexts/AuthContext';
import { useColors } from '../contexts/ThemeContext';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import type { User, TodayEmployeeStatus, EmployeeRanking } from '../../../shared/types';
import { roleLabels } from '../../../shared/utils/formatters';

const ROLE_BADGE: Record<string, { bg: string; text: string }> = {
  superadmin: { bg: colors.red[50], text: colors.red[700] },
  director: { bg: colors.purple[50], text: colors.purple[700] },
  admin: { bg: colors.blue[50], text: colors.blue[700] },
  master: { bg: colors.green[50], text: colors.green[700] },
};

const AVATAR_COLORS: Array<[string, string]> = [
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
function getInitials(fullName?: string): string {
  if (!fullName) return '?';
  const parts = fullName.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return parts[0][0]?.toUpperCase() || '?';
}
function formatMoney(v: number): string {
  return (
    Math.round(v)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'
  );
}

interface StatusInfo {
  label: string;
  bg: string;
  fg: string;
  icon: keyof typeof Ionicons.glyphMap;
}
function statusInfo(s?: TodayEmployeeStatus): StatusInfo {
  if (!s) return { label: 'Нет данных', bg: colors.gray[100], fg: colors.gray[500], icon: 'help-circle-outline' };
  const note = (s.note || '').toLowerCase();
  if (note.includes('больнич'))
    return { label: 'Больничный', bg: colors.rose[50], fg: colors.rose[700], icon: 'medkit-outline' };
  if (s.isDayOff) return { label: 'Выходной', bg: colors.gray[100], fg: colors.gray[600], icon: 'moon-outline' };
  if (s.lateStatus === 'late_major')
    return {
      label: `Опозд. ${s.lateMinutes} мин`,
      bg: colors.orange[50],
      fg: colors.orange[700],
      icon: 'time-outline',
    };
  if (s.lateStatus === 'late_minor')
    return { label: `Опозд. ${s.lateMinutes} мин`, bg: colors.amber[50], fg: colors.amber[700], icon: 'time-outline' };
  if (s.isWorking || s.actualArrival || s.lateStatus === 'on_time')
    return { label: 'На смене', bg: colors.green[50], fg: colors.green[700], icon: 'checkmark-circle-outline' };
  if (note.includes('прогул'))
    return { label: 'Прогул', bg: colors.red[50], fg: colors.red[700], icon: 'alert-circle-outline' };
  if (s.hasSchedule)
    return { label: 'Не пришёл', bg: colors.red[50], fg: colors.red[700], icon: 'alert-circle-outline' };
  return { label: '—', bg: colors.gray[100], fg: colors.gray[500], icon: 'remove-outline' };
}

interface EmployeeRowProps {
  user: User;
  index: number;
  status?: TodayEmployeeStatus;
  todayRevenue?: number;
  todayChecks?: number;
  showFinancials: boolean;
  onPress: (id: string) => void;
  /** onPressIn — fires the detail prefetch BEFORE the navigation push. */
  onPressIn: (id: string) => void;
  palette: ReturnType<typeof useColors>;
}
const EmployeeRow = React.memo(function EmployeeRow({
  user,
  index,
  status,
  todayRevenue,
  todayChecks,
  showFinancials,
  onPress,
  onPressIn,
  palette,
}: EmployeeRowProps) {
  const role = ROLE_BADGE[user.role] || ROLE_BADGE.master;
  const avatarColors = getAvatarColors(user.fullName);
  const sb = statusInfo(status);
  const isMaster = user.role === 'master';
  const hasMetrics = isMaster && showFinancials && (todayChecks !== undefined || todayRevenue !== undefined);

  return (
    <AnimatedCard
      index={index}
      style={[styles.row, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
      onPress={() => onPress(user.id)}
      onPressIn={() => onPressIn(user.id)}
    >
      <View style={styles.rowMain}>
        <LinearGradient colors={avatarColors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.avatar}>
          <Text style={styles.avatarText}>{getInitials(user.fullName)}</Text>
        </LinearGradient>

        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.name, { color: palette.text.primary }]} numberOfLines={1}>
            {user.fullName}
          </Text>
          <View style={styles.subRow}>
            <View style={[styles.roleBadge, { backgroundColor: role.bg }]}>
              <Text style={[styles.roleBadgeText, { color: role.text }]}>{roleLabels[user.role] || user.role}</Text>
            </View>
            <View style={[styles.statusPill, { backgroundColor: sb.bg }]}>
              <Ionicons name={sb.icon} size={11} color={sb.fg} />
              <Text style={[styles.statusPillText, { color: sb.fg }]} numberOfLines={1}>
                {sb.label}
              </Text>
            </View>
          </View>
        </View>

        <Ionicons name="chevron-forward" size={18} color={palette.text.tertiary} />
      </View>

      {hasMetrics && (
        <View style={[styles.metricsRow, { borderTopColor: palette.border.subtle }]}>
          <View style={styles.metricItem}>
            <Ionicons name="receipt-outline" size={11} color={palette.text.tertiary} />
            <Text style={[styles.metricLabel, { color: palette.text.secondary }]}>Чеков сегодня</Text>
            <Text style={[styles.metricValue, { color: palette.text.primary }]}>{todayChecks ?? 0}</Text>
          </View>
          <View style={[styles.metricDivider, { backgroundColor: palette.border.subtle }]} />
          <View style={styles.metricItem}>
            <Ionicons name="cash-outline" size={11} color={palette.text.tertiary} />
            <Text style={[styles.metricLabel, { color: palette.text.secondary }]}>Выручка</Text>
            <Text style={[styles.metricValue, { color: palette.text.primary }]}>{formatMoney(todayRevenue ?? 0)}</Text>
          </View>
        </View>
      )}
    </AnimatedCard>
  );
});

export default function EmployeesScreen() {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const { user: me, hasPermission } = useAuth();
  const palette = useColors();
  const tabBarHeight = useTabBarHeight();
  const [refreshing, setRefreshing] = React.useState(false);

  const showFinancials =
    me?.role === 'director' || me?.role === 'superadmin' || me?.role === 'admin' || hasPermission('profit_view');

  const { data: users, isLoading, isFetching, dataUpdatedAt } = useQuery<User[]>({
    queryKey: ['users-all'],
    queryFn: async () => {
      const res = await usersApi.getAll();
      return res.data;
    },
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });

  // Pause the 60-second poll when the screen isn't focused. With a tab
  // navigator the screen stays MOUNTED behind the active tab — TanStack
  // would otherwise keep firing background fetches that compete for the
  // JS thread with whatever the user is actually looking at.
  const [pollEnabled, setPollEnabled] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setPollEnabled(true);
      return () => setPollEnabled(false);
    }, []),
  );

  const { data: today } = useQuery<TodayEmployeeStatus[]>({
    queryKey: ['schedule-today'],
    queryFn: async () => {
      const res = await scheduleApi.getToday();
      return res.data;
    },
    staleTime: 30_000,
    refetchInterval: pollEnabled ? 60_000 : false,
    placeholderData: (prev) => prev,
  });

  // Финансовые метрики дня — только если у пользователя есть permission.
  // Иначе НЕ дёргаем endpoint, чтобы случайно не светить аналитику.
  const { data: ranking } = useQuery<EmployeeRanking>({
    queryKey: ['employee-ranking'],
    queryFn: async () => {
      const res = await checksApi.getRanking();
      return res.data;
    },
    enabled: showFinancials,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });

  const todayMap = useMemo(() => {
    const map = new Map<string, TodayEmployeeStatus>();
    (today ?? []).forEach((s) => map.set(s.userId, s));
    return map;
  }, [today]);

  const rankingMap = useMemo(() => {
    const map = new Map<string, { revenue: number; checkCount: number }>();
    (ranking?.today ?? []).forEach((r) => map.set(r.masterId, { revenue: r.revenue, checkCount: r.checkCount }));
    return map;
  }, [ranking]);

  const sortedUsers = useMemo(() => {
    return (users ?? [])
      .filter((u) => u.isActive)
      .sort((a, b) => {
        // На смене → опоздавшие → остальные → выходной/нет данных
        const sa = todayMap.get(a.id);
        const sb = todayMap.get(b.id);
        const rank = (s?: TodayEmployeeStatus): number => {
          if (!s) return 5;
          if (s.isWorking || s.actualArrival || s.lateStatus === 'on_time') return 0;
          if (s.lateStatus === 'late_minor' || s.lateStatus === 'late_major') return 1;
          if ((s.note || '').toLowerCase().includes('больнич')) return 4;
          if (s.isDayOff) return 4;
          if (s.hasSchedule) return 2;
          return 3;
        };
        const r = rank(sa) - rank(sb);
        if (r !== 0) return r;
        return a.fullName.localeCompare(b.fullName, 'ru');
      });
  }, [users, todayMap]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['users-all'] }),
      queryClient.invalidateQueries({ queryKey: ['schedule-today'] }),
      showFinancials ? queryClient.invalidateQueries({ queryKey: ['employee-ranking'] }) : Promise.resolve(),
    ]);
    setRefreshing(false);
  };

  const onOpen = useCallback((id: string) => navigation.navigate('EmployeeDetail', { id }), [navigation]);

  // Prefetch-on-tap — fires on `onPressIn` so the canonical
  // `['employee-full-profile', id]` query is already resolving by the
  // time EmployeeDetailScreen mounts.
  const onPressInRow = useCallback(
    (id: string) => {
      queryClient.prefetchQuery({
        queryKey: ['employee-full-profile', id],
        queryFn: async () => (await employeesApi.fullProfile(id)).data,
        staleTime: 60_000,
      });
    },
    [queryClient],
  );

  // Memoised "on smena" counter — running filter+length on every render
  // was negligible, but the result feeds the header subtitle and we get
  // a tidier deps graph for free.
  const onSmena = useMemo(
    () =>
      sortedUsers.filter((u) => {
        const s = todayMap.get(u.id);
        return (
          s?.isWorking ||
          s?.actualArrival ||
          s?.lateStatus === 'on_time' ||
          s?.lateStatus === 'late_minor' ||
          s?.lateStatus === 'late_major'
        );
      }).length,
    [sortedUsers, todayMap],
  );

  // Stable renderItem — without useCallback the FlashList received a new
  // function identity on every parent render (eg. refresh-state toggle,
  // background SWR refetch) and re-rendered every EmployeeRow even though
  // EmployeeRow is React.memo'd. Stable identity restores recycling.
  const renderItem = useCallback(
    ({ item, index }: { item: User; index: number }) => {
      const r = rankingMap.get(item.id);
      return (
        <EmployeeRow
          user={item}
          index={index}
          status={todayMap.get(item.id)}
          todayChecks={r?.checkCount}
          todayRevenue={r?.revenue}
          showFinancials={showFinancials}
          onPress={onOpen}
          onPressIn={onPressInRow}
          palette={palette}
        />
      );
    },
    [rankingMap, todayMap, showFinancials, onOpen, onPressInRow, palette],
  );

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader
        title="Сотрудники"
        subtitle={users === undefined ? undefined : `На смене: ${onSmena} из ${sortedUsers.length}`}
        onBack={() => navigation.goBack()}
      />
      {/* FreshnessBadge — HYBRID-perf plan. Driven by the users-all query. */}
      <View style={styles.freshnessRow}>
        <FreshnessBadge query={{ isFetching, isLoading, dataUpdatedAt }} />
      </View>

      {users === undefined ? (
        <ListSkeleton count={6} />
      ) : sortedUsers.length === 0 && !isLoading ? (
        <EmptyState title="Сотрудников пока нет" description="Пригласите команду через раздел «Пользователи»." />
      ) : (
        <FlashList
          data={sortedUsers}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          // FlashList v2 auto-measures rows; no estimatedItemSize.
          contentContainerStyle={[
            styles.list,
            // Android: contentInset ignored; ensure the list clears
            // the M3 NavigationBar (~80pt + system inset).
            Platform.OS === 'android' ? { paddingBottom: tabBarHeight } : null,
          ]}
          contentInset={{ bottom: tabBarHeight }}
          scrollIndicatorInsets={{ bottom: tabBarHeight }}
          automaticallyAdjustContentInsets={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.gray[50] },
  list: { paddingHorizontal: spacing[4], paddingTop: spacing[3], paddingBottom: spacing[8] },
  // FreshnessBadge slot — right-aligned below the header.
  freshnessRow: {
    paddingHorizontal: spacing[4],
    alignItems: 'flex-end',
    minHeight: 14,
  },

  row: {
    backgroundColor: colors.white,
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    borderColor: colors.gray[100],
    padding: spacing[3],
    marginBottom: spacing[2],
  },
  rowMain: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: fontSize.sm, fontWeight: '700', color: colors.white, letterSpacing: -0.2 },
  name: { fontSize: 15, fontWeight: fontWeight.semibold, color: colors.gray[900], letterSpacing: -0.2 },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[1.5], marginTop: 4 },
  roleBadge: { paddingHorizontal: spacing[2], paddingVertical: 2, borderRadius: borderRadius.full },
  roleBadgeText: { fontSize: 10, fontWeight: fontWeight.semibold, letterSpacing: 0.2 },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: borderRadius.full,
    flex: 1,
    minWidth: 0,
  },
  statusPillText: { fontSize: 11, fontWeight: fontWeight.semibold, letterSpacing: -0.1 },

  metricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing[2.5],
    paddingTop: spacing[2.5],
    borderTopWidth: 1,
    borderTopColor: colors.gray[100],
    gap: spacing[3],
  },
  metricItem: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 },
  metricLabel: { fontSize: 11, color: colors.gray[500], flex: 1 },
  metricValue: { fontSize: 13, fontWeight: '700', color: colors.gray[900], letterSpacing: -0.2 },
  metricDivider: { width: 1, height: 16, backgroundColor: colors.gray[200] },
});
