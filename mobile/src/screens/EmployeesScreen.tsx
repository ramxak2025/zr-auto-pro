/**
 * EmployeesScreen — compact, dense iOS list (owner: «компактно, чтобы было
 * видно всех сотрудников»). The previous 2-column "game-card" grid showed
 * too few people per screen; this lays the team out as tight, clean list
 * rows where the whole staff is visible with minimal scrolling.
 *
 * Each row:
 *   • leading avatar (photo OR stable hash-gradient initials) — 44pt;
 *   • name (headline) + role (subhead) stacked;
 *   • trailing chevron только. Посещаемость («на смене» / опоздал / …) в
 *     списке сотрудников НЕ показываем — это раздел «Расписание»; здесь она
 *     лишний шум (owner). Сводка «На смене: X из Y» остаётся в подзаголовке.
 *   • for masters AND viewers with financial access — a compact "чеков ·
 *     выручка" line under the name (`showFinancials`).
 *
 * Финансовые цифры (выручка, чеков мастера) показываем только
 * пользователям с финансовым доступом: владелец / директор / админ.
 * Обычный мастер не должен видеть выручку коллеги.
 *
 * #5 — сотрудники с `hiddenEverywhere` (напр. владелец) полностью
 * скрыты из списка.
 *
 * Visual-system parity (Клиенты / Поставщики / Склад):
 *   • `SearchInput` под шапкой — поиск по имени / роли / телефону;
 *   • фильтр-чипсы по ролям (рендерятся только когда ролей ≥ 2);
 *   • trailing «+» в шапке (менеджеры) — ведёт в «Пользователи», где
 *     живёт единственная форма создания сотрудника (не дублируем её);
 *   • `QueryErrorState` когда запрос упал и кэша нет.
 *
 * Производительность: FlashList (single column), `React.memo` row со
 * стабильным `renderItem`, `PressableScale` + haptic, prefetch-on-press
 * (`onPressIn`) канонического `['employee-full-profile', id]`.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { View, StyleSheet, RefreshControl, Platform, ScrollView, TouchableOpacity } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import IosScreenHeader from '../components/IosScreenHeader';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import CachedImage from '../components/CachedImage';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { usersApi, scheduleApi, checksApi, employeesApi } from '../api/services';
import { ListSkeleton } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import QueryErrorState from '../components/QueryErrorState';
import SearchInput from '../components/SearchInput';
import FreshnessBadge from '../components/FreshnessBadge';
import { Text } from '../platform/Typography';
import { PressableScale } from '../platform/PressableScale';
import { haptic } from '../platform/haptics';
import { useAuth } from '../contexts/AuthContext';
import { useColors } from '../contexts/ThemeContext';
import type { SemanticPalette } from '../theme/palette';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { colors, spacing } from '../theme';
import type { User, TodayEmployeeStatus, EmployeeRanking } from '../../../shared/types';
import { roleLabels } from '../../../shared/utils/formatters';

const SCREEN_PADDING = spacing[4]; // 16pt
const AVATAR_SIZE = 44;
const ROW_HEIGHT = 68; // dense but comfortable — fits ~11 rows per iPhone screen

const ROLE_META: Record<string, { icon: keyof typeof Ionicons.glyphMap; chipIcon: keyof typeof Ionicons.glyphMap }> = {
  superadmin: { icon: 'shield-checkmark', chipIcon: 'shield-checkmark-outline' },
  director: { icon: 'briefcase', chipIcon: 'briefcase-outline' },
  admin: { icon: 'key', chipIcon: 'key-outline' },
  master: { icon: 'construct', chipIcon: 'construct-outline' },
};

// Стабильный порядок ролей в фильтр-чипсах (иерархия, как в UsersScreen).
const ROLE_CHIP_ORDER = ['superadmin', 'director', 'admin', 'master'];

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
function formatMoneyCompact(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace('.0', '')}М`;
  if (abs >= 10_000) return `${Math.round(v / 1000)}к`;
  return String(Math.round(v));
}

interface EmployeeRowProps {
  user: User;
  todayRevenue?: number;
  todayChecks?: number;
  showFinancials: boolean;
  palette: SemanticPalette;
  onPress: (id: string) => void;
  /** onPressIn — fires the detail prefetch BEFORE the navigation push. */
  onPressIn: (id: string) => void;
}
const EmployeeRow = React.memo(function EmployeeRow({
  user,
  todayRevenue,
  todayChecks,
  showFinancials,
  palette,
  onPress,
  onPressIn,
}: EmployeeRowProps) {
  const avatarColors = getAvatarColors(user.fullName);
  const roleIcon = (ROLE_META[user.role] || ROLE_META.master).icon;
  const isMaster = user.role === 'master';
  const showMetrics = isMaster && showFinancials && (todayChecks !== undefined || todayRevenue !== undefined);

  return (
    <PressableScale
      onPress={() => onPress(user.id)}
      onPressIn={() => onPressIn(user.id)}
      scaleTo={0.98}
      hapticIntent="tap"
      style={[styles.row, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
    >
      {/* Avatar */}
      <View style={styles.avatarWrap}>
        {user.avatar ? (
          <CachedImage source={{ uri: user.avatar }} style={styles.avatar} resizeMode="cover" />
        ) : (
          <LinearGradient colors={avatarColors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.avatar}>
            <Text style={styles.avatarInitials}>{getInitials(user.fullName)}</Text>
          </LinearGradient>
        )}
      </View>

      {/* Name + role (+ master metrics) */}
      <View style={styles.rowBody}>
        <Text style={[styles.rowName, { color: palette.text.primary }]} numberOfLines={1}>
          {user.fullName || '—'}
        </Text>
        <View style={styles.rowMetaLine}>
          <Ionicons name={roleIcon} size={12} color={palette.text.tertiary} />
          <Text style={[styles.rowRole, { color: palette.text.secondary }]} numberOfLines={1}>
            {roleLabels[user.role] || user.role}
          </Text>
          {showMetrics && (
            <>
              <View style={[styles.metaDot, { backgroundColor: palette.border.strong }]} />
              <Text style={[styles.rowMetrics, { color: palette.text.tertiary }]} numberOfLines={1}>
                {`${todayChecks ?? 0} чек. · ${formatMoneyCompact(todayRevenue ?? 0)} ₽`}
              </Text>
            </>
          )}
        </View>
      </View>

      {/* Chevron — открывает карточку сотрудника. Без статус-пилюли:
          посещаемость / «на смене» живёт в разделе «Расписание». */}
      <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} />
    </PressableScale>
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

  const {
    data: users,
    isLoading,
    isFetching,
    isError,
    refetch,
    dataUpdatedAt,
  } = useQuery<User[]>({
    queryKey: ['users-all'],
    queryFn: async () => {
      const res = await usersApi.getAll();
      return res.data;
    },
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });

  // ── Поиск + фильтр по роли (client-side: весь штат уже на руках) ──
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');

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

  // «Уволенные» recycle-bin count for the footer affordance. Manager roles
  // only (director / admin / superadmin manage dismissals) — a master never
  // sees the entry point and we don't fire the request for them.
  const canManageDismissed = me?.role === 'director' || me?.role === 'superadmin' || me?.role === 'admin';

  const { data: dismissed } = useQuery<User[]>({
    queryKey: ['users-dismissed'],
    queryFn: async () => {
      const res = await usersApi.listDismissed();
      return res.data;
    },
    enabled: canManageDismissed,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
  const dismissedCount = (dismissed ?? []).filter((u) => !!u.dismissedAt && !u.purgedAt).length;

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
    return (
      (users ?? [])
        // #5 — fully hidden employees (e.g. the owner) never appear.
        // Defensive: a dismissed / purged user must never surface among the
        // active staff even from a stale cache (the API already excludes them).
        .filter((u) => u.isActive && !u.hiddenEverywhere && !u.dismissedAt && !u.purgedAt)
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
        })
    );
  }, [users, todayMap]);

  // Роли, реально присутствующие в штате — чипсы рисуем только когда их ≥ 2.
  const presentRoles = useMemo(() => {
    const set = new Set(sortedUsers.map((u) => u.role as string));
    return ROLE_CHIP_ORDER.filter((r) => set.has(r));
  }, [sortedUsers]);

  // Поиск (имя / роль / телефон) + чип роли поверх отсортированного списка.
  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    const qDigits = q.replace(/\D/g, '');
    return sortedUsers.filter((u) => {
      if (roleFilter !== 'all' && u.role !== roleFilter) return false;
      if (!q) return true;
      if ((u.fullName || '').toLowerCase().includes(q)) return true;
      if ((roleLabels[u.role] || u.role).toLowerCase().includes(q)) return true;
      if (qDigits.length >= 3 && (u.phone || '').replace(/\D/g, '').includes(qDigits)) return true;
      return false;
    });
  }, [sortedUsers, search, roleFilter]);

  const isFiltering = search.trim().length > 0 || roleFilter !== 'all';

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

  // Navigate to the «Уволенные» recycle bin (lives in the MoreStack, so the
  // back-nav stays within the Сотрудники section).
  const onOpenDismissed = useCallback(() => {
    haptic('tap');
    navigation.navigate('DismissedEmployees');
  }, [navigation]);

  // «+» — добавление сотрудника. Единственная форма создания живёт в разделе
  // «Пользователи» (UsersScreen, feature-gate `users_manage`) — не дублируем
  // её здесь, а ведём менеджера прямо туда.
  const onAddEmployee = useCallback(() => {
    haptic('tap');
    navigation.navigate('Users');
  }, [navigation]);

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

  // Memoised "on smena" counter for the header subtitle.
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

  // Stable renderItem keeps FlashList recycling healthy — without it the
  // list got a new function identity each parent render (refresh toggle,
  // SWR refetch) and re-rendered every memoised row.
  const renderItem = useCallback(
    ({ item }: { item: User }) => {
      const r = rankingMap.get(item.id);
      return (
        <EmployeeRow
          user={item}
          todayChecks={r?.checkCount}
          todayRevenue={r?.revenue}
          showFinancials={showFinancials}
          palette={palette}
          onPress={onOpen}
          onPressIn={onPressInRow}
        />
      );
    },
    [rankingMap, showFinancials, palette, onOpen, onPressInRow],
  );

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader
        title="Сотрудники"
        subtitle={users === undefined ? undefined : `На смене: ${onSmena} из ${sortedUsers.length}`}
        onBack={() => navigation.goBack()}
        trailing={
          canManageDismissed ? (
            <TouchableOpacity
              style={[styles.addBtn, { backgroundColor: palette.accent.primary }]}
              onPress={onAddEmployee}
              accessibilityRole="button"
              accessibilityLabel="Добавить сотрудника"
            >
              <Ionicons name="add" size={18} color={colors.white} />
            </TouchableOpacity>
          ) : undefined
        }
      />
      {/* FreshnessBadge — HYBRID-perf plan. Driven by the users-all query. */}
      <View style={styles.freshnessRow}>
        <FreshnessBadge query={{ isFetching, isLoading, dataUpdatedAt }} />
      </View>

      {users === undefined && isError ? (
        // Запрос упал и кэша нет — честный error-state с Retry (глобальный
        // stale-while-revalidate покрывает случай «кэш есть, фон упал»).
        <QueryErrorState
          title="Не удалось загрузить сотрудников"
          description="Проверьте соединение и попробуйте ещё раз."
          onRetry={() => refetch()}
        />
      ) : users === undefined ? (
        <ListSkeleton count={9} />
      ) : sortedUsers.length === 0 ? (
        <View style={{ flex: 1 }}>
          <EmptyState
            icon="people"
            title="Сотрудников пока нет"
            description="Пригласите команду через раздел «Пользователи»."
          />
          {/* Даже при пустом штате «Уволенные» должны оставаться доступными —
              иначе уволив всех, менеджер теряет вход в корзину. */}
          {canManageDismissed && dismissedCount > 0 ? (
            <View style={{ paddingHorizontal: SCREEN_PADDING }}>
              <DismissedFooter count={dismissedCount} palette={palette} onPress={onOpenDismissed} />
            </View>
          ) : null}
        </View>
      ) : (
        <>
          {/* Поиск — тот же SearchInput, что в Клиентах / Складе. */}
          <View style={styles.searchWrap}>
            <SearchInput value={search} onChange={setSearch} placeholder="Имя, роль или телефон" />
          </View>

          {/* Фильтр-чипсы по ролям — только когда в штате ≥ 2 разных ролей. */}
          {presentRoles.length >= 2 ? (
            <View style={styles.chipsBar}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
                <RoleChip
                  active={roleFilter === 'all'}
                  label="Все"
                  icon="apps-outline"
                  onPress={() => {
                    haptic('select');
                    setRoleFilter('all');
                  }}
                  palette={palette}
                />
                {presentRoles.map((r) => (
                  <RoleChip
                    key={r}
                    active={roleFilter === r}
                    label={roleLabels[r] || r}
                    icon={(ROLE_META[r] || ROLE_META.master).chipIcon}
                    onPress={() => {
                      haptic('select');
                      setRoleFilter((prev) => (prev === r ? 'all' : r));
                    }}
                    palette={palette}
                  />
                ))}
              </ScrollView>
            </View>
          ) : null}

          <FlashList
            data={filteredUsers}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            ItemSeparatorComponent={Spacer}
            ListEmptyComponent={
              <EmptyState
                icon="search"
                title="Ничего не найдено"
                description={search.trim() ? `Запрос: «${search.trim()}»` : 'Под выбранный фильтр никто не попал'}
              />
            }
            ListFooterComponent={
              // Во время поиска/фильтра футер прячем — он не результат запроса.
              canManageDismissed && !isFiltering ? (
                <DismissedFooter count={dismissedCount} palette={palette} onPress={onOpenDismissed} />
              ) : null
            }
            contentContainerStyle={[styles.list, Platform.OS === 'android' ? { paddingBottom: tabBarHeight } : null]}
            contentInset={{ bottom: tabBarHeight }}
            scrollIndicatorInsets={{ bottom: tabBarHeight }}
            automaticallyAdjustContentInsets={false}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />
            }
          />
        </>
      )}
    </View>
  );
}

// ── Фильтр-чип роли — зеркалит FilterChip из ClientsScreen (та же геометрия
//    и активное состояние), чтобы разделы читались как одно приложение. ──
function RoleChip({
  active,
  label,
  icon,
  onPress,
  palette,
}: {
  active: boolean;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  palette: SemanticPalette;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[
        styles.chip,
        {
          backgroundColor: active ? palette.accent.primarySoft : palette.bg.muted,
          borderColor: active ? palette.accent.primary : palette.border.subtle,
        },
      ]}
    >
      <Ionicons name={icon} size={13} color={active ? palette.accent.primary : palette.text.secondary} />
      <Text
        style={[styles.chipLabel, { color: active ? palette.accent.primaryText : palette.text.secondary }]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// Tight 6pt gap between list rows — dense rhythm without per-row margins
// (which would offset the FlashList recycler's measurement).
function Spacer() {
  return <View style={{ height: spacing[1.5] }} />;
}

// Footer affordance into the «Уволенные» recycle bin. Manager-only; rendered
// below the active staff list, shows the dismissed count on the right.
function DismissedFooter({
  count,
  palette,
  onPress,
}: {
  count: number;
  palette: SemanticPalette;
  onPress: () => void;
}) {
  return (
    <PressableScale
      onPress={onPress}
      scaleTo={0.98}
      hapticIntent="tap"
      style={[styles.dismissedRow, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
    >
      <View style={[styles.dismissedIcon, { backgroundColor: palette.bg.muted }]}>
        <Ionicons name="person-remove-outline" size={18} color={palette.text.secondary} />
      </View>
      <Text style={[styles.dismissedLabel, { color: palette.text.primary }]} numberOfLines={1}>
        Уволенные сотрудники
      </Text>
      {count > 0 ? (
        <View style={[styles.dismissedBadge, { backgroundColor: palette.bg.muted }]}>
          <Text style={[styles.dismissedBadgeText, { color: palette.text.secondary }]}>{count}</Text>
        </View>
      ) : null}
      <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.gray[50] },
  list: { paddingHorizontal: SCREEN_PADDING, paddingTop: spacing[2], paddingBottom: spacing[8] },
  // FreshnessBadge slot — right-aligned below the header.
  freshnessRow: {
    paddingHorizontal: spacing[4],
    alignItems: 'flex-end',
    minHeight: 14,
  },

  // ── Header «+» (как в Клиентах) ──
  addBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Поиск + фильтр-чипсы (геометрия ClientsScreen) ──
  searchWrap: { paddingHorizontal: spacing[4] },
  // PINNED height — чипсы прижаты к верху, не растягиваются по flex-колонке
  // (тот же фикс, что #19.1 в Клиентах).
  chipsBar: {
    height: 44,
    flexGrow: 0,
    flexShrink: 0,
    justifyContent: 'center',
  },
  chipsRow: {
    paddingHorizontal: spacing[4],
    gap: spacing[2],
    alignItems: 'center',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    maxWidth: 220,
  },
  chipLabel: { fontSize: 13, fontWeight: '600', letterSpacing: -0.1 },

  // ── Compact list row ──
  row: {
    minHeight: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  avatarWrap: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    overflow: 'hidden',
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.4,
  },

  rowBody: { flex: 1, minWidth: 0, gap: 3 },
  rowName: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  rowMetaLine: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  rowRole: {
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: -0.1,
    flexShrink: 1,
  },
  metaDot: { width: 3, height: 3, borderRadius: 1.5 },
  rowMetrics: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: -0.1,
    flexShrink: 1,
  },

  // ── «Уволенные» footer affordance ──
  dismissedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    marginTop: spacing[3],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  dismissedIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dismissedLabel: { flex: 1, fontSize: 15, fontWeight: '600', letterSpacing: -0.2 },
  dismissedBadge: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dismissedBadgeText: { fontSize: 13, fontWeight: '700' },
});
