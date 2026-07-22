/**
 * DismissedEmployeesScreen — «Уволенные», the recycle-bin for employees.
 *
 * Mobile counterpart to the products TrashScreen, but for staff. Lists
 * dismissed-not-purged users (`usersApi.listDismissed()`) with two actions
 * per row:
 *
 *   • «Восстановить» (restore) → confirm → `usersApi.restore(id)` — the
 *     employee returns to active lists / schedule / master picker.
 *   • «Удалить полностью» (purge) → DESTRUCTIVE confirm → `usersApi.purge(id)`
 *     — the row is kept so historical чеки / смены still resolve the name,
 *     but the user vanishes from «Уволенные» and can no longer be restored.
 *
 * Each row shows avatar + name + role + «Уволен <дата>» plus a relative
 * hint («N дней назад» and «можно восстановить ещё N дней» up to a year),
 * all derived from `dismissedAt`.
 *
 * Interaction mirrors SuppliersScreen: a swipe reveals the two trailing
 * actions, AND the same two actions are always visible as inline buttons
 * on the right of the row (so the affordance is discoverable without a
 * swipe — same model TrashScreen uses).
 *
 * Gating: manager roles only (director / admin / superadmin). Mutations are
 * optimistic (the row is dropped immediately) and invalidate ['users'],
 * ['users-all'], ['users-dismissed'] so the Сотрудники lists and the entry
 * point count stay in sync.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { View, StyleSheet, RefreshControl, Alert, Platform } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Swipeable } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import CachedImage from '../components/CachedImage';
import { ListSkeleton } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import QueryErrorState from '../components/QueryErrorState';
import IosScreenHeader from '../components/IosScreenHeader';
import { Text } from '../platform/Typography';
import { PressableScale } from '../platform/PressableScale';
import { haptic } from '../platform/haptics';
import { useAuth } from '../contexts/AuthContext';
import { useColors } from '../contexts/ThemeContext';
import type { SemanticPalette } from '../theme/palette';
import { usersApi } from '../api/services';
import { getImageUrl } from '../api/axios';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { colors, spacing } from '../theme';
import type { User } from '../../../shared/types';
import { roleLabels } from '../../../shared/utils/formatters';

const AVATAR_SIZE = 44;
const RESTORE_WINDOW_DAYS = 365; // restorable within a year of dismissal

// ── Avatar fallback (stable hash-gradient initials) — same palette as the
//    active EmployeesScreen so a dismissed row reads as the same person. ──
const AVATAR_COLORS: Array<[string, string]> = [
  [colors.gray[400], colors.gray[500]],
  [colors.gray[400], colors.gray[600]],
  [colors.gray[500], colors.gray[600]],
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

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days since `iso` (>=0). Returns null on an invalid date. */
function daysSince(iso?: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / DAY_MS));
}

function formatDismissedDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' });
}

/** Russian plural for "день/дня/дней". */
function pluralDays(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'день';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'дня';
  return 'дней';
}

/** «N дней назад» relative line for the dismissal moment. */
function relativeAgo(days: number): string {
  if (days <= 0) return 'сегодня';
  if (days === 1) return 'вчера';
  return `${days} ${pluralDays(days)} назад`;
}

/** «можно восстановить ещё N дней» — null once the year window has passed. */
function restoreHint(days: number): string | null {
  const left = RESTORE_WINDOW_DAYS - days;
  if (left <= 0) return null;
  return `можно восстановить ещё ${left} ${pluralDays(left)}`;
}

interface RowProps {
  user: User;
  palette: SemanticPalette;
  onRestore: (user: User) => void;
  onPurge: (user: User) => void;
  busy: boolean;
}
const DismissedRow = React.memo(function DismissedRow({ user, palette, onRestore, onPurge, busy }: RowProps) {
  const avatarColors = getAvatarColors(user.fullName);
  const avatarUrl = getImageUrl(user.avatar);
  const days = daysSince(user.dismissedAt);
  const hint = days !== null ? restoreHint(days) : null;

  const card = (
    <View style={[styles.row, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
      {/* Avatar (desaturated — dismissed) */}
      <View style={styles.avatarWrap}>
        {avatarUrl ? (
          <CachedImage source={{ uri: avatarUrl }} style={styles.avatar} resizeMode="cover" />
        ) : (
          <LinearGradient colors={avatarColors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.avatar}>
            <Text style={styles.avatarInitials}>{getInitials(user.fullName)}</Text>
          </LinearGradient>
        )}
      </View>

      {/* Name + role + dismissed meta */}
      <View style={styles.body}>
        <Text style={[styles.name, { color: palette.text.primary }]} numberOfLines={1}>
          {user.fullName || '—'}
        </Text>
        <Text style={[styles.role, { color: palette.text.secondary }]} numberOfLines={1}>
          {roleLabels[user.role] || user.role}
        </Text>
        <View style={styles.metaLine}>
          <Ionicons name="person-remove-outline" size={11} color={palette.text.tertiary} />
          <Text style={[styles.metaText, { color: palette.text.tertiary }]} numberOfLines={1}>
            {`Уволен ${formatDismissedDate(user.dismissedAt)}${days !== null ? ` · ${relativeAgo(days)}` : ''}`}
          </Text>
        </View>
        {hint ? (
          <Text style={[styles.hint, { color: colors.green[600] }]} numberOfLines={1}>
            {hint}
          </Text>
        ) : (
          <Text style={[styles.hint, { color: colors.orange[600] }]} numberOfLines={1}>
            окно восстановления истекло
          </Text>
        )}
      </View>

      {/* Inline always-visible actions (mirrors TrashScreen) */}
      <View style={styles.actions}>
        <PressableScale
          onPress={() => onRestore(user)}
          disabled={busy}
          scaleTo={0.92}
          hapticIntent="tap"
          style={[styles.actionBtn, { backgroundColor: palette.bg.muted }]}
          accessibilityLabel="Восстановить"
        >
          <Ionicons name="arrow-undo-outline" size={18} color={colors.green[600]} />
        </PressableScale>
        <PressableScale
          onPress={() => onPurge(user)}
          disabled={busy}
          scaleTo={0.92}
          hapticIntent="warning"
          style={[styles.actionBtn, { backgroundColor: palette.bg.muted }]}
          accessibilityLabel="Удалить полностью"
        >
          <Ionicons name="trash" size={18} color={colors.red[500]} />
        </PressableScale>
      </View>
    </View>
  );

  // Swipe reveals the same two actions with labels — iOS-native muscle
  // memory. Buttons above stay for discoverability (TrashScreen model).
  return (
    <Swipeable
      renderRightActions={() => (
        <View style={styles.swipeActionsRow}>
          <PressableScale
            onPress={() => onRestore(user)}
            disabled={busy}
            scaleTo={0.96}
            style={styles.swipeRestoreAction}
            accessibilityLabel="Восстановить"
          >
            <Ionicons name="arrow-undo-outline" size={20} color={colors.white} />
            <Text style={styles.swipeActionText}>Вернуть</Text>
          </PressableScale>
          <PressableScale
            onPress={() => onPurge(user)}
            disabled={busy}
            scaleTo={0.96}
            style={styles.swipePurgeAction}
            accessibilityLabel="Удалить полностью"
          >
            <Ionicons name="trash-outline" size={20} color={colors.white} />
            <Text style={styles.swipeActionText}>Удалить</Text>
          </PressableScale>
        </View>
      )}
      overshootRight={false}
    >
      {card}
    </Swipeable>
  );
});

export default function DismissedEmployeesScreen() {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const palette = useColors();
  const tabBarHeight = useTabBarHeight();
  const { hasPermission } = useAuth();
  const [refreshing, setRefreshing] = useState(false);

  // Гейт user_management — сервер гейтит restore/purge тем же ключом
  // («права как в Битрикс24», 2026-07: admin живёт по матрице из /auth/me,
  // superadmin/director байпасятся внутри hasPermission).
  const canManage = hasPermission('user_management');

  const {
    data: items,
    isLoading,
    isError,
    refetch,
  } = useQuery<User[]>({
    queryKey: ['users-dismissed'],
    queryFn: async () => {
      const res = await usersApi.listDismissed();
      return res.data;
    },
    enabled: canManage,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  // Defensive: backend already excludes purged rows, but a stale cache must
  // never surface a purged user in «Уволенные». Sort newest-dismissed first.
  const list = useMemo(() => {
    return (items ?? [])
      .filter((u) => !!u.dismissedAt && !u.purgedAt)
      .sort((a, b) => {
        const ta = a.dismissedAt ? new Date(a.dismissedAt).getTime() : 0;
        const tb = b.dismissedAt ? new Date(b.dismissedAt).getTime() : 0;
        return tb - ta;
      });
  }, [items]);

  const invalidateAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['users'] });
    queryClient.invalidateQueries({ queryKey: ['users-all'] });
    queryClient.invalidateQueries({ queryKey: ['users-dismissed'] });
  }, [queryClient]);

  // Optimistic removal from the local «Уволенные» cache so the row drops
  // instantly on either action; the invalidate then reconciles.
  const dropFromCache = useCallback(
    (id: string) => {
      queryClient.setQueryData<User[]>(['users-dismissed'], (prev) => (prev ?? []).filter((u) => u.id !== id));
    },
    [queryClient],
  );

  const restoreMut = useMutation({
    mutationFn: (id: string) => usersApi.restore(id),
    onMutate: (id: string) => dropFromCache(id),
    onSuccess: () => {
      haptic('success');
      invalidateAll();
    },
    onError: () => {
      invalidateAll();
      Alert.alert('Ошибка', 'Не удалось восстановить сотрудника');
    },
  });

  const purgeMut = useMutation({
    mutationFn: (id: string) => usersApi.purge(id),
    onMutate: (id: string) => dropFromCache(id),
    onSuccess: () => {
      haptic('success');
      invalidateAll();
    },
    onError: () => {
      invalidateAll();
      Alert.alert('Ошибка', 'Не удалось удалить сотрудника');
    },
  });

  const busy = restoreMut.isPending || purgeMut.isPending;

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['users-dismissed'] });
    setRefreshing(false);
  }, [queryClient]);

  const confirmRestore = useCallback(
    (user: User) => {
      haptic('tap');
      Alert.alert(
        'Восстановить сотрудника?',
        `${user.fullName || 'Сотрудник'} снова появится в списках, графике и Кассе.`,
        [
          { text: 'Отмена', style: 'cancel' },
          { text: 'Восстановить', onPress: () => restoreMut.mutate(user.id) },
        ],
      );
    },
    [restoreMut],
  );

  const confirmPurge = useCallback(
    (user: User) => {
      haptic('warning');
      Alert.alert(
        'Удалить полностью?',
        `${user.fullName || 'Сотрудник'} будет удалён без возможности восстановления. ` +
          'История сохранится: его чеки, смены и зарплаты останутся, но учётку вернуть будет нельзя.',
        [
          { text: 'Отмена', style: 'cancel' },
          { text: 'Удалить полностью', style: 'destructive', onPress: () => purgeMut.mutate(user.id) },
        ],
      );
    },
    [purgeMut],
  );

  const renderItem = useCallback(
    ({ item }: { item: User }) => (
      <DismissedRow user={item} palette={palette} onRestore={confirmRestore} onPurge={confirmPurge} busy={busy} />
    ),
    [palette, confirmRestore, confirmPurge, busy],
  );

  // Gate — non-managers can't open the recycle bin.
  if (!canManage) {
    return (
      <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
        <IosScreenHeader title="Уволенные" onBack={() => navigation.goBack()} />
        <EmptyState
          icon="lock"
          title="Нет доступа"
          description="Раздел «Уволенные» доступен только владельцу и администраторам."
        />
      </View>
    );
  }

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader
        title="Уволенные"
        subtitle={items === undefined ? undefined : `Всего: ${list.length}`}
        onBack={() => navigation.goBack()}
      />

      {items === undefined && isError ? (
        // Запрос упал и кэша нет — error-state с Retry (как в Сотрудниках).
        <QueryErrorState
          title="Не удалось загрузить «Уволенных»"
          description="Проверьте соединение и попробуйте ещё раз."
          onRetry={() => refetch()}
        />
      ) : isLoading && items === undefined ? (
        <ListSkeleton count={6} />
      ) : list.length === 0 ? (
        <EmptyState
          icon="people"
          title="Нет уволенных сотрудников"
          description="Здесь появятся сотрудники, которых вы уволили. В течение года их можно восстановить."
        />
      ) : (
        <FlashList
          data={list}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          ItemSeparatorComponent={Spacer}
          contentContainerStyle={[styles.list, Platform.OS === 'android' ? { paddingBottom: tabBarHeight } : null]}
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

function Spacer() {
  return <View style={{ height: spacing[2] }} />;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.gray[50] },
  list: { paddingHorizontal: spacing[4], paddingTop: spacing[3] },

  // ── Row ──
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
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
    opacity: 0.85,
  },
  avatarInitials: { color: colors.white, fontSize: 16, fontWeight: '800', letterSpacing: -0.4 },

  body: { flex: 1, minWidth: 0, gap: 2 },
  name: { fontSize: 16, fontWeight: '700', letterSpacing: -0.3 },
  role: { fontSize: 13, fontWeight: '500', letterSpacing: -0.1 },
  metaLine: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
  metaText: { fontSize: 11, fontWeight: '500', flexShrink: 1 },
  hint: { fontSize: 11, fontWeight: '600', marginTop: 1 },

  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing[1.5] },
  actionBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Swipe actions ──
  swipeActionsRow: { flexDirection: 'row', alignItems: 'center', marginLeft: spacing[2] },
  swipeRestoreAction: {
    width: 84,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: colors.green[600],
    borderTopLeftRadius: 16,
    borderBottomLeftRadius: 16,
  },
  swipePurgeAction: {
    width: 84,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: colors.red[500],
    borderTopRightRadius: 16,
    borderBottomRightRadius: 16,
  },
  swipeActionText: { color: colors.white, fontSize: 11, fontWeight: '700' },
});
