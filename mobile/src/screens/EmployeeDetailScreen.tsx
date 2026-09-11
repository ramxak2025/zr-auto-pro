/**
 * EmployeeDetailScreen — focused profile of a single staff member.
 *
 * Owner feedback: the previous version stacked far too much (radar,
 * year heatmap, career timeline, team-rank medals, service mastery,
 * a heavy "analysis/traits" card, lifetime records sprawl, owner
 * back-office). The owner asked to keep ONLY what concerns the employee:
 *
 *   1. ЕГО ГРАФИК      — today's shift + arrival + lateness (schedule/today).
 *   2. ЕГО ПОКАЗАТЕЛИ  — efficiency / discipline / activity / rating tiles.
 *   3. ЕГО ПОСЛЕДНИЕ ЧЕКИ — recent checks (lazy, fetched on open).
 *   4. ЕГО ЗАРПЛАТА    — period earnings/revenue (owner-like or self only).
 *   5. ЕГО ИНВЕНТАРЬ   — equipment issued to him (lazy).
 *   6. ЕГО ЗНАЧКИ      — achievements / badges.
 *
 * Kept: the hero (avatar + name + role/class + rank badge) and the
 * quick-actions bar (Call / WhatsApp / Schedule / Salary).
 *
 * Unified visual-system additions (Сотрудники redesign):
 *   • «Контакты» card — телефон (tap-to-call, long-press → share sheet со
 *     «Скопировать») + WhatsApp;
 *   • «Роль и доступ» card — роль / должность / команда / дата найма /
 *     ставка (ставка — только менеджеры или сам сотрудник);
 *   • «Уволить сотрудника» — destructive пункт в меню ⋯ (менеджеры; нельзя
 *     себя / superadmin / владельца — зеркало canDelete из UsersScreen),
 *     destructive-confirm Alert → usersApi.remove() (soft-dismiss), после
 *     успеха ['user', id] инвалидируется и экран сам падает в read-only
 *     «Уволен» состояние.
 *
 * Data:
 *   • `employeesApi.fullProfile()` → stats / lifetime / achievements /
 *     yearHeatmap (used ONLY to compute salary period totals — not drawn).
 *   • `scheduleApi.getToday()` → today's attendance (his schedule).
 *   • `checksApi.getAll({ masterId })` → recent checks (lazy below-the-fold).
 *   • `equipmentApi.getByUser()` → issued inventory (lazy below-the-fold).
 *
 * NOT-FOUND vs LOADING vs ERROR (owner bug «нет сотрудника»):
 *   • while the route id is momentarily undefined → loading skeleton;
 *   • while the profile query is pending and we have no cached data →
 *     loading skeleton (NOT "не найден");
 *   • if persisted/cached data is present → render it immediately;
 *   • on a transient/network error with no data → retryable error state;
 *   • "Сотрудник не найден" ONLY when the query truly resolved with no
 *     employee OR a real 404 (`error?.response?.status === 404`).
 *
 * Bug fix preserved: `formatHM` handles both ISO timestamps and plain
 * "HH:mm" strings from the DB TEXT columns.
 */
import React, { useCallback, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Easing,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Image as ExpoImage } from 'expo-image';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { RouteProp, useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { checksApi, employeesApi, equipmentApi, knowledgeApi, scheduleApi, usersApi } from '../api/services';
import CachedImage from '../components/CachedImage';
import LoadingSpinner from '../components/LoadingSpinner';
import { ListSkeleton, Skeleton } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import IosScreenHeader from '../components/IosScreenHeader';
import { useAuth } from '../contexts/AuthContext';
import { useColors } from '../contexts/ThemeContext';
import { colors, fontSize, fontWeight, borderRadius, spacing, softTint } from '../theme';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { haptic } from '../platform/haptics';
import { PressableScale } from '../platform/PressableScale';
import { Text } from '../platform/Typography';
import type {
  Check,
  CourseProgress,
  EmployeeFullProfile,
  EmployeeAchievement,
  KnowledgeCourse,
  RegulationUserSummary,
  TodayEmployeeStatus,
  User,
} from '../../../shared/types';
import { roleLabels } from '../../../shared/utils/formatters';
import { formatPhone } from '../../../shared/validation/phone';
import { ShareCardModal } from '../components/employee/ShareCardModal';
import { EditProfileModal } from '../components/employee/EditProfileModal';
import { AwardAchievementModal } from '../components/employee/AwardAchievementModal';
import { UserPointsSheet } from '../components/employee/UserPointsSheet';
import { usePointAccess } from '../hooks/usePoints';
import { rankFromLifetime, progressToNextRank, rankLabelUpper } from '../components/employee/rank';

type RouteParams = { EmployeeDetail: { id: string } };

// ── Formatters ────────────────────────────────────────────────────────────
/**
 * Compact RU money formatter: 1 234 567 → "1.2М ₽", 12 345 → "12.3к ₽".
 */
const formatMoneyCompact = (v: number): string => {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace('.0', '')}М ₽`;
  if (abs >= 100_000) return `${Math.round(v / 1000)}к ₽`;
  if (abs >= 10_000) return `${(v / 1000).toFixed(1).replace('.0', '')}к ₽`;
  return `${Math.round(v)} ₽`;
};

const formatMoneyFull = (v: number): string =>
  Math.round(v)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽';

/**
 * Accepts both ISO timestamps (actualArrival) and plain "HH:mm" strings
 * (shiftStart/shiftEnd stored as TEXT in DB). Falls back to "—".
 */
const formatHM = (raw?: string | null): string => {
  if (!raw) return '—';
  const hm = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (hm) {
    const h = hm[1].padStart(2, '0');
    return `${h}:${hm[2]}`;
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
};

const formatShortDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });

const formatLongDate = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
};

function statusBadge(s?: TodayEmployeeStatus): { text: string; bg: string; fg: string } {
  if (!s) return { text: '—', bg: 'rgba(255,255,255,0.18)', fg: '#fff' };
  const note = (s.note || '').toLowerCase();
  if (note.includes('больнич')) return { text: 'Б/Л', bg: 'rgba(244,114,182,0.30)', fg: '#fff' };
  if (s.isDayOff) return { text: 'Выходной', bg: 'rgba(255,255,255,0.18)', fg: '#fff' };
  if (s.lateStatus === 'late_major')
    return { text: `Опоздал +${s.lateMinutes}'`, bg: 'rgba(248,113,113,0.34)', fg: '#fff' };
  if (s.lateStatus === 'late_minor')
    return { text: `Опоздал +${s.lateMinutes}'`, bg: 'rgba(251,191,36,0.34)', fg: '#fff' };
  if (s.isWorking || s.actualArrival || s.lateStatus === 'on_time')
    return { text: 'На смене', bg: 'rgba(52,211,153,0.32)', fg: '#fff' };
  if (s.hasSchedule) return { text: 'Не пришёл', bg: 'rgba(248,113,113,0.30)', fg: '#fff' };
  return { text: '—', bg: 'rgba(255,255,255,0.16)', fg: '#fff' };
}

function getInitials(fullName?: string): string {
  if (!fullName) return '?';
  const parts = fullName.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return parts[0][0]?.toUpperCase() || '?';
}

// ──────────────────────────────────────────────────────────────────────────
//  Main screen
// ──────────────────────────────────────────────────────────────────────────

export default function EmployeeDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<RouteParams, 'EmployeeDetail'>>();
  const id = route.params?.id;
  const queryClient = useQueryClient();
  const { user: viewer, hasPermission } = useAuth();
  const palette = useColors();
  const tabBarHeight = useTabBarHeight();

  const isSelf = !!viewer && viewer.id === id;
  // «Менеджер» = держатель user_management — тот же ключ, которым сервер
  // гейтит расширенный профиль/документы/увольнение (employees.service,
  // «права как в Битрикс24», 2026-07: admin живёт по матрице из /auth/me).
  const isOwnerLike = hasPermission('user_management');
  // Настройка филиалов имеет смысл только там, где филиалов больше одного:
  // одноточечный автосервис про мульти-точки не знает вовсе (163).
  const { multiPoint } = usePointAccess();

  // ── Full profile from the new endpoint ───────────────────────────────
  const {
    data: full,
    isLoading,
    isPending,
    isError,
    error,
    refetch,
    isRefetching,
  } = useQuery<EmployeeFullProfile>({
    queryKey: ['employee-full-profile', id],
    queryFn: async () => (await employeesApi.fullProfile(id)).data,
    enabled: !!id,
    staleTime: 60_000,
  });

  // ── Today's attendance from schedule/today (not in fullProfile) ─────
  const [pollEnabled, setPollEnabled] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setPollEnabled(true);
      return () => setPollEnabled(false);
    }, []),
  );
  const { data: todayList } = useQuery<TodayEmployeeStatus[]>({
    queryKey: ['schedule-today'],
    queryFn: async () => (await scheduleApi.getToday()).data,
    staleTime: 30_000,
    refetchInterval: pollEnabled ? 60_000 : false,
  });
  const today = (todayList ?? []).find((t) => t.userId === id);

  // Existing user record gives us phone + salaryPercent for finances /
  // quick-call. The full-profile endpoint doesn't carry these.
  const { data: userRecord } = useQuery<User>({
    queryKey: ['user', id],
    queryFn: async () => (await usersApi.getById(id)).data,
    enabled: !!id,
    staleTime: 60_000,
  });

  // ── Menu (share + edit + award) ──────────────────────────────────────
  const [menuOpen, setMenuOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [awardOpen, setAwardOpen] = useState(false);
  // 163 — «Филиалы сотрудника»: на каких филиалах он может работать. Право —
  // user_management (isOwnerLike ниже); у одноточечного тенанта пункта нет.
  const [pointsOpen, setPointsOpen] = useState(false);
  const [achievementsOpen, setAchievementsOpen] = useState(false);

  // ── Achievement remove (custom only, long press) ─────────────────────
  const removeAch = useMutation({
    mutationFn: (achId: string) => employeesApi.removeAchievement(id, achId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employee-full-profile', id] });
      haptic('warning');
    },
    onError: (e: any) => {
      Alert.alert('Ошибка', e?.response?.data?.message || e?.message || 'Не удалось удалить');
    },
  });

  // ── Увольнение (soft-dismiss → «Уволенные») ──────────────────────────
  // Тот же endpoint и те же invalidations, что у deleteMutation в
  // UsersScreen: usersApi.remove() НЕ удаляет учётку, а перемещает её в
  // корзину «Уволенные» (восстановима в течение года). Дополнительно
  // инвалидируем ['user', id] — refetch принесёт dismissedAt, и экран сам
  // перейдёт в read-only состояние «Уволен».
  const dismissMut = useMutation({
    mutationFn: () => usersApi.remove(id),
    onSuccess: () => {
      haptic('success');
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['users-all'] });
      queryClient.invalidateQueries({ queryKey: ['users-dismissed'] });
      queryClient.invalidateQueries({ queryKey: ['user', id] });
      Alert.alert('Готово', 'Сотрудник перемещён в «Уволенные»');
    },
    onError: (err: any) => Alert.alert('Ошибка', err?.response?.data?.message || 'Ошибка увольнения'),
  });

  // ── Period switch for SALARY section ─────────────────────────────────
  const [period, setPeriod] = useState<'week' | 'month' | 'year'>('month');

  const onRefresh = async () => {
    await Promise.all([refetch(), queryClient.invalidateQueries({ queryKey: ['schedule-today'] })]);
  };

  // ── Loading / error / not-found gating ───────────────────────────────
  // The route id can be momentarily undefined during a push transition —
  // never show "не найден" then.
  if (!id) {
    return (
      <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
        <IosScreenHeader title="Сотрудник" onBack={() => navigation.goBack()} />
        <LoadingSpinner />
      </View>
    );
  }

  // No data yet. Distinguish three cases:
  //   1. still pending / loading (and nothing in persisted cache) → skeleton;
  //   2. a real 404 (employee genuinely doesn't exist) → "не найден";
  //   3. any other error (timeout, 5xx, network) → retryable error state.
  if (!full) {
    const status = (error as any)?.response?.status;
    const isNotFound = isError && status === 404;

    if (isNotFound) {
      return (
        <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
          <IosScreenHeader title="Сотрудник" onBack={() => navigation.goBack()} />
          <EmptyState
            icon="person"
            title="Сотрудник не найден"
            description="Возможно учётка удалена или у вас нет к ней доступа."
          />
        </View>
      );
    }

    if (isError) {
      // Transient/network error — NOT "не найден". Offer retry.
      return (
        <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
          <IosScreenHeader title="Сотрудник" onBack={() => navigation.goBack()} />
          <EmptyState
            icon="warning"
            title="Не удалось загрузить"
            description="Проверьте соединение и попробуйте ещё раз."
            action={{ label: 'Повторить', onPress: () => refetch() }}
          />
        </View>
      );
    }

    // Still loading (pending) and nothing cached → skeleton, not a spinner.
    if (isLoading || isPending) {
      return (
        <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
          <IosScreenHeader title="Сотрудник" onBack={() => navigation.goBack()} />
          <View style={styles.scroll}>
            <Skeleton height={150} radius={borderRadius['3xl']} />
            <Skeleton height={140} radius={borderRadius['2xl']} />
            <ListSkeleton count={4} />
          </View>
        </View>
      );
    }

    // Fallthrough: query resolved successfully but produced nothing —
    // treat as genuinely not found.
    return (
      <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
        <IosScreenHeader title="Сотрудник" onBack={() => navigation.goBack()} />
        <EmptyState
          icon="person"
          title="Сотрудник не найден"
          description="Возможно учётка удалена или у вас нет к ней доступа."
        />
      </View>
    );
  }

  const { profile, stats, lifetime, yearHeatmap, achievements, serviceMastery } = full;

  // ── Dismissed / purged read-only guard ───────────────────────────────
  // The row still resolves so historical чеки / смены keep the name, and a
  // deep link or stale reference can land here even though active lists
  // exclude dismissed users server-side. When that happens we DON'T render
  // the full editable card — instead a read-only «Уволен» state with no
  // edit / award / actions. (`dismissedAt` / `purgedAt` live on the User
  // record, not the profile payload.)
  if (userRecord && (userRecord.dismissedAt || userRecord.purgedAt)) {
    return (
      <DismissedReadOnly
        navigation={navigation}
        palette={palette}
        fullName={profile.fullName || userRecord.fullName}
        roleLabel={roleLabels[profile.role] || profile.role}
        photoUrl={profile.photoUrl ?? null}
        dismissedAt={userRecord.dismissedAt ?? null}
        purged={!!userRecord.purgedAt}
        canManage={isOwnerLike}
      />
    );
  }

  // ── Rank derivation ──────────────────────────────────────────────────
  const rankInfo = rankFromLifetime(lifetime.totalRevenue, lifetime.totalChecks);
  const rankProgress = progressToNextRank(rankInfo, lifetime.totalRevenue);

  const className =
    profile.customTitle?.trim() || profile.positionTitle?.trim() || roleLabels[profile.role] || profile.role;
  const initials = getInitials(profile.fullName);
  const status = statusBadge(today);

  // ── Увольнение: gating зеркалит canDelete из UsersScreen ─────────────
  // (нельзя уволить себя, superadmin'а и владельца; действие видят только
  // менеджеры — director / admin / superadmin).
  const canDismiss = isOwnerLike && !isSelf && profile.role !== 'superadmin' && profile.role !== 'director';

  const confirmDismiss = () => {
    haptic('warning');
    Alert.alert(
      'Уволить сотрудника?',
      `${profile.fullName || 'Сотрудник'} будет перемещён в «Уволенные» и скрыт из списков, графика и Кассы. В течение года его можно восстановить.`,
      [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Уволить', style: 'destructive', onPress: () => dismissMut.mutate() },
      ],
    );
  };

  const shareData = {
    fullName: profile.fullName,
    className,
    initials,
    photoUrl: profile.photoUrl ?? null,
    rank: rankInfo,
    rings: {
      efficiency: stats.efficiency,
      discipline: stats.discipline,
      activity: stats.activity,
      rating: stats.rating,
    },
    trophies: achievements.slice(0, 3).map((a) => ({
      name: a.name,
      icon: a.icon,
      color: a.color,
    })),
    streakDays: full.streaks.disciplineStreak,
  };

  // ── Header trailing (⋯) ──────────────────────────────────────────────
  const trailing = (
    <Pressable
      onPress={() => {
        haptic('tap');
        setMenuOpen((v) => !v);
      }}
      style={[styles.headerBtn, { backgroundColor: palette.bg.muted }]}
      hitSlop={10}
    >
      <Ionicons name="ellipsis-horizontal" size={20} color={palette.text.primary} />
    </Pressable>
  );

  // ── Quick actions: phone + whatsapp + schedule + salary ──────────────
  const goCall = () => {
    haptic('tap');
    const phone = userRecord?.phone || '';
    if (phone) Linking.openURL(`tel:${String(phone).replace(/[^+\d]/g, '')}`);
    else Alert.alert('Нет номера', 'Телефон сотрудника не указан');
  };
  const goWhatsapp = () => {
    haptic('tap');
    const wa = profile.whatsapp;
    if (!wa) {
      Alert.alert('Нет WhatsApp', 'WhatsApp не указан в профиле');
      return;
    }
    Linking.openURL(`https://wa.me/${wa.replace(/[^\d]/g, '')}`);
  };
  // Long-press на телефоне — системный share sheet (в нём «Скопировать»,
  // без новой зависимости на clipboard-модуль).
  const sharePhone = () => {
    const phone = userRecord?.phone || '';
    if (!phone) return;
    haptic('select');
    Share.share({ message: formatPhone(phone) || phone }).catch(() => {});
  };
  const goSchedule = () => {
    haptic('tap');
    navigation.navigate('Main', { screen: 'MoreTab', params: { screen: 'Schedule', initial: false } });
  };
  const goSalary = () => {
    haptic('tap');
    navigation.navigate('Main', { screen: 'MoreTab', params: { screen: 'Salary', initial: false } });
  };

  // ── Period totals for salary (computed locally from year heatmap) ────
  const sharePct = (userRecord?.salaryPercent ?? 30) / 100;
  const periodTotals = computePeriodTotals(yearHeatmap, period, sharePct);

  const canSeeSalary = isOwnerLike || isSelf;
  const topAchievements = achievements.slice(0, 3);

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title="Сотрудник" onBack={() => navigation.goBack()} trailing={trailing} />

      {menuOpen && (
        <View style={[styles.menu, { backgroundColor: palette.bg.elevated, borderColor: palette.border.subtle }]}>
          <MenuItem
            icon="share-outline"
            label="Поделиться карточкой"
            onPress={() => {
              setMenuOpen(false);
              setShareOpen(true);
            }}
            palette={palette}
          />
          {isOwnerLike && (
            <>
              <View style={[styles.menuDivider, { backgroundColor: palette.border.subtle }]} />
              <MenuItem
                icon="create-outline"
                label="Редактировать"
                onPress={() => {
                  setMenuOpen(false);
                  setEditOpen(true);
                }}
                palette={palette}
              />
              <View style={[styles.menuDivider, { backgroundColor: palette.border.subtle }]} />
              <MenuItem
                icon="ribbon-outline"
                label="Выдать значок"
                onPress={() => {
                  setMenuOpen(false);
                  setAwardOpen(true);
                }}
                palette={palette}
              />
              {/* Доступ к филиалам настраивается ЗДЕСЬ (163) — в карточке
                  человека, а не в разделе «Филиалы»: там состав показывается
                  только для просмотра. У одноточечного тенанта пункта нет. */}
              {multiPoint && (
                <>
                  <View style={[styles.menuDivider, { backgroundColor: palette.border.subtle }]} />
                  <MenuItem
                    icon="business-outline"
                    label="Филиалы сотрудника"
                    onPress={() => {
                      setMenuOpen(false);
                      setPointsOpen(true);
                    }}
                    palette={palette}
                  />
                </>
              )}
            </>
          )}
          {canDismiss && (
            <>
              <View style={[styles.menuDivider, { backgroundColor: palette.border.subtle }]} />
              {/* Деструктив — стиль CheckDetailScreen: красный пункт +
                  destructive-confirm Alert перед мутацией. */}
              <MenuItem
                icon="person-remove-outline"
                label="Уволить сотрудника"
                destructive
                onPress={() => {
                  setMenuOpen(false);
                  confirmDismiss();
                }}
                palette={palette}
              />
            </>
          )}
        </View>
      )}

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: tabBarHeight + spacing[20] }]}
        contentInset={{ bottom: tabBarHeight }}
        scrollIndicatorInsets={{ bottom: tabBarHeight }}
        automaticallyAdjustContentInsets={false}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={onRefresh} tintColor={colors.primary[600]} />
        }
        showsVerticalScrollIndicator={false}
        removeClippedSubviews
        scrollEventThrottle={16}
      >
        {/* ── HERO ───────────────────────────────────────────────────── */}
        <Hero
          name={profile.fullName}
          className={className}
          initials={initials}
          photoUrl={profile.photoUrl ?? null}
          rank={rankInfo}
          rankProgress={rankProgress}
          status={status}
        />

        {/* ── КОНТАКТЫ — tap-to-call / long-press → share («Скопировать») ── */}
        <Card palette={palette}>
          <CardHeader icon="call-outline" title="Контакты" palette={palette} />
          <View style={{ gap: spacing[2] }}>
            <ContactRow
              icon="call-outline"
              label="Телефон"
              value={userRecord?.phone ? formatPhone(userRecord.phone) || userRecord.phone : 'Не указан'}
              missing={!userRecord?.phone}
              onPress={goCall}
              onLongPress={sharePhone}
              palette={palette}
            />
            <ContactRow
              icon="logo-whatsapp"
              label="WhatsApp"
              value={profile.whatsapp ? formatPhone(profile.whatsapp) || profile.whatsapp : 'Не указан'}
              missing={!profile.whatsapp}
              onPress={goWhatsapp}
              accent={colors.green[600]}
              palette={palette}
            />
          </View>
        </Card>

        {/* ── РОЛЬ И ДОСТУП ───────────────────────────────────────────── */}
        <Card palette={palette}>
          <CardHeader icon="id-card-outline" title="Роль и доступ" palette={palette} />
          <View style={{ gap: spacing[2.5] }}>
            <InfoRow label="Роль" value={roleLabels[profile.role] || profile.role} palette={palette} />
            {profile.customTitle?.trim() || profile.positionTitle?.trim() ? (
              <InfoRow
                label="Должность"
                value={(profile.customTitle?.trim() || profile.positionTitle?.trim()) as string}
                palette={palette}
              />
            ) : null}
            {userRecord?.team ? <InfoRow label="Команда" value={userRecord.team} palette={palette} /> : null}
            {profile.hireDate ? (
              <InfoRow label="В команде с" value={formatLongDate(profile.hireDate)} palette={palette} />
            ) : null}
            {/* Ставка — чувствительно: только менеджеры или сам сотрудник. */}
            {canSeeSalary && userRecord ? (
              <InfoRow label="Ставка с чека" value={`${userRecord.salaryPercent}%`} palette={palette} />
            ) : null}
          </View>
        </Card>

        {/* ── 1. ЕГО СТАТИСТИКА (смены + товары + услуга) ─────────────── */}
        <Card palette={palette}>
          <CardHeader icon="stats-chart-outline" title="Статистика" palette={palette} />
          <StatsSummary
            today={today}
            shifts={full.shifts}
            topProducts={lifetime.topProducts}
            serviceMastery={serviceMastery}
            accent={rankInfo.accent}
            palette={palette}
          />
        </Card>

        {/* ── 2. ЕГО ПОКАЗАТЕЛИ ───────────────────────────────────────── */}
        <Card palette={palette}>
          <CardHeader icon="pulse-outline" title="Показатели" palette={palette} />
          <View style={styles.statsGrid}>
            <StatTile label="Эффективность" value={stats.efficiency} accent={rankInfo.accent} palette={palette} />
            <StatTile label="Дисциплина" value={stats.discipline} accent={rankInfo.accent} palette={palette} />
            <StatTile label="Активность" value={stats.activity} accent={rankInfo.accent} palette={palette} />
            <StatTile label="Рейтинг" value={stats.rating} accent={rankInfo.accent} palette={palette} />
          </View>
          {/* Lifetime numbers folded into «показатели» as a compact footer. */}
          <View style={[styles.lifeFooter, { borderTopColor: palette.border.subtle }]}>
            <LifeStat label="Чеков" value={String(lifetime.totalChecks)} palette={palette} />
            <LifeStat label="Выручка" value={formatMoneyCompact(lifetime.totalRevenue)} palette={palette} />
            <LifeStat label="Клиентов" value={String(lifetime.clientsServed)} palette={palette} />
          </View>
        </Card>

        {/* ── 3. ЕГО ПОСЛЕДНИЕ ЧЕКИ (lazy) ───────────────────────────── */}
        <Card palette={palette}>
          <CardHeader icon="receipt-outline" title="Последние чеки" palette={palette} />
          <RecentChecks employeeId={id} palette={palette} navigation={navigation} />
        </Card>

        {/* ── 4. ЕГО ЗАРПЛАТА (owner-like or self) ────────────────────── */}
        {canSeeSalary ? (
          <Card palette={palette}>
            <View style={styles.cardHeaderRow}>
              <CardHeader icon="wallet-outline" title="Зарплата" palette={palette} />
              <Pressable onPress={goSalary} hitSlop={8}>
                <Text style={[styles.linkText, { color: rankInfo.accent }]}>Открыть</Text>
              </Pressable>
            </View>
            <PeriodSwitcher value={period} onChange={setPeriod} palette={palette} />
            <View style={[styles.tilesGrid, { marginTop: spacing[3] }]}>
              <MetricTile
                label="Заработано"
                value={formatMoneyCompact(periodTotals.earnings)}
                highlight
                palette={palette}
              />
              <MetricTile
                label="Выручка"
                value={formatMoneyCompact(periodTotals.revenue)}
                highlight
                palette={palette}
              />
              <MetricTile label="К выплате" value={formatMoneyCompact(periodTotals.toPay)} palette={palette} />
              <MetricTile label="Чеков" value={String(periodTotals.checks)} palette={palette} />
            </View>
            <Sparkline values={periodTotals.spark} accent={rankInfo.accent} palette={palette} />
          </Card>
        ) : null}

        {/* ── 5. ЕГО ИНВЕНТАРЬ (lazy) ─────────────────────────────────── */}
        <Card palette={palette}>
          <CardHeader icon="construct-outline" title="Инвентарь" palette={palette} />
          <Inventory employeeId={id} palette={palette} />
        </Card>

        {/* ── ЕГО РЕГЛАМЕНТЫ (manager-only, lazy) ─────────────────────── */}
        {isOwnerLike ? (
          <Card palette={palette}>
            <CardHeader icon="shield-checkmark-outline" title="Регламенты" palette={palette} />
            <RegulationsSummary employeeId={id} accent={rankInfo.accent} palette={palette} />
          </Card>
        ) : null}

        {/* ── ЕГО ОБУЧЕНИЕ (manager-only, lazy) ───────────────────────── */}
        {isOwnerLike ? (
          <Card palette={palette}>
            <CardHeader icon="school-outline" title="Обучение" palette={palette} />
            <LearningSummary employeeId={id} accent={rankInfo.accent} palette={palette} />
          </Card>
        ) : null}

        {/* ── 6. ЕГО ЗНАЧКИ ───────────────────────────────────────────── */}
        <Card palette={palette}>
          <View style={styles.cardHeaderRow}>
            <CardHeader icon="trophy-outline" title="Значки" palette={palette} />
            {achievements.length > 0 && (
              <Pressable
                onPress={() => {
                  haptic('tap');
                  setAchievementsOpen(true);
                }}
                hitSlop={8}
              >
                <Text style={[styles.linkText, { color: rankInfo.accent }]}>Все значки</Text>
              </Pressable>
            )}
          </View>
          {topAchievements.length === 0 ? (
            <Text style={[styles.mutedText, { color: palette.text.tertiary }]}>
              Пока ни одного значка. {isOwnerLike ? 'Выдайте первый через меню ⋯.' : ''}
            </Text>
          ) : (
            <View style={styles.trophyPreviewRow}>
              {topAchievements.map((a) => (
                <View
                  key={a.id}
                  style={[
                    styles.trophyPreview,
                    { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle },
                  ]}
                >
                  <Text style={styles.trophyPreviewIcon}>{a.icon || '🏆'}</Text>
                  <Text style={[styles.trophyPreviewName, { color: palette.text.primary }]} numberOfLines={2}>
                    {a.name}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </Card>
      </ScrollView>

      {/* ── Quick actions sticky bar (above tab bar) ─────────────────── */}
      <View
        pointerEvents="box-none"
        style={[
          styles.actionsBar,
          {
            bottom: tabBarHeight + spacing[2],
            backgroundColor: palette.bg.elevated,
            borderColor: palette.border.subtle,
          },
        ]}
      >
        <ActionBtn icon="call" label="Позвонить" onPress={goCall} palette={palette} />
        <ActionBtn
          icon="logo-whatsapp"
          label="WhatsApp"
          onPress={goWhatsapp}
          palette={palette}
          accent={colors.green[600]}
        />
        <ActionBtn icon="calendar" label="График" onPress={goSchedule} palette={palette} />
        {canSeeSalary && <ActionBtn icon="wallet" label="Зарплата" onPress={goSalary} palette={palette} />}
      </View>

      <ShareCardModal visible={shareOpen} onClose={() => setShareOpen(false)} data={shareData} />
      <EditProfileModal visible={editOpen} onClose={() => setEditOpen(false)} profile={profile} />
      <AwardAchievementModal visible={awardOpen} onClose={() => setAwardOpen(false)} employeeId={id} />
      {pointsOpen ? (
        <UserPointsSheet
          visible={pointsOpen}
          onClose={() => setPointsOpen(false)}
          userId={id}
          userName={profile.fullName}
        />
      ) : null}
      <AchievementsModal
        visible={achievementsOpen}
        onClose={() => setAchievementsOpen(false)}
        achievements={achievements}
        isOwnerLike={isOwnerLike}
        onAdd={() => {
          setAchievementsOpen(false);
          setAwardOpen(true);
        }}
        onLongPress={(a) => {
          if (a.type !== 'custom') return;
          Alert.alert('Удалить значок?', a.name, [
            { text: 'Отмена', style: 'cancel' },
            {
              text: 'Удалить',
              style: 'destructive',
              onPress: () => removeAch.mutate(a.id),
            },
          ]);
        }}
        palette={palette}
      />
    </View>
  );
}

// ──────────────────────────────────────────────────────────────────────────
//  Dismissed / purged read-only state
// ──────────────────────────────────────────────────────────────────────────

/**
 * DismissedReadOnly — shown when the loaded user is dismissed (in «Уволенные»)
 * or purged. Recognisable (avatar + name + role) but NON-editable: no rank
 * hero, no stats / salary / inventory cards, no edit / award menu, no
 * quick-actions. Managers get a hint that the employee can be restored from
 * «Уволенные» (dismissed-but-not-purged only).
 */
function DismissedReadOnly({
  navigation,
  palette,
  fullName,
  roleLabel,
  photoUrl,
  dismissedAt,
  purged,
  canManage,
}: {
  navigation: any;
  palette: ReturnType<typeof useColors>;
  fullName: string;
  roleLabel: string;
  photoUrl: string | null;
  dismissedAt: string | null;
  purged: boolean;
  canManage: boolean;
}) {
  const dateStr = dismissedAt
    ? new Date(dismissedAt).toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' })
    : null;

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title="Сотрудник" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
          <View style={styles.dismissedHeadRow}>
            <View style={styles.dismissedAvatarWrap}>
              {photoUrl ? (
                <PhotoCircle url={photoUrl} size={64} />
              ) : (
                <View style={[styles.dismissedAvatar, { backgroundColor: palette.bg.muted }]}>
                  <Text style={[styles.dismissedInitials, { color: palette.text.secondary }]}>
                    {getInitials(fullName)}
                  </Text>
                </View>
              )}
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.dismissedName, { color: palette.text.primary }]} numberOfLines={2}>
                {fullName || '—'}
              </Text>
              <Text style={[styles.dismissedRole, { color: palette.text.secondary }]} numberOfLines={1}>
                {roleLabel}
              </Text>
              <View style={[styles.dismissedPill, { backgroundColor: palette.bg.muted }]}>
                <Ionicons name="person-remove-outline" size={12} color={colors.orange[600]} />
                <Text style={[styles.dismissedPillText, { color: colors.orange[600] }]}>
                  {purged ? 'Удалён' : 'Уволен'}
                </Text>
              </View>
            </View>
          </View>

          <View style={[styles.dismissedDivider, { backgroundColor: palette.border.subtle }]} />

          <Text style={[styles.dismissedBody, { color: palette.text.secondary }]}>
            {purged
              ? 'Этот сотрудник удалён без возможности восстановления. Его история (чеки, смены, зарплаты) сохранена, но учётку вернуть нельзя.'
              : `Этот сотрудник в разделе «Уволенные»${dateStr ? ` с ${dateStr}` : ''}. Он скрыт из списков, графика и Кассы.${
                  canManage ? ' Восстановить его можно из «Уволенных».' : ''
                }`}
          </Text>

          {canManage && !purged ? (
            <PressableScale
              onPress={() => {
                haptic('tap');
                navigation.navigate('DismissedEmployees');
              }}
              scaleTo={0.97}
              hapticIntent="tap"
              style={styles.dismissedCta}
            >
              <Ionicons name="arrow-undo-outline" size={18} color={colors.white} />
              <Text style={styles.dismissedCtaText}>Открыть «Уволенные»</Text>
            </PressableScale>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

// ──────────────────────────────────────────────────────────────────────────
//  Building blocks
// ──────────────────────────────────────────────────────────────────────────

type Palette = ReturnType<typeof useColors>;

function Hero({
  name,
  className,
  initials,
  photoUrl,
  rank,
  rankProgress,
  status,
}: {
  name: string;
  className: string;
  initials: string;
  photoUrl: string | null;
  rank: ReturnType<typeof rankFromLifetime>;
  rankProgress: number;
  status: { text: string; bg: string; fg: string };
}) {
  return (
    <LinearGradient colors={rank.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
      <View style={styles.heroTopRow}>
        <View style={styles.heroAvatarWrap}>
          {photoUrl ? (
            <PhotoCircle url={photoUrl} size={80} />
          ) : (
            <View style={[styles.heroAvatar, { backgroundColor: 'rgba(255,255,255,0.18)' }]}>
              <Text style={styles.heroInitials}>{initials}</Text>
            </View>
          )}
          <View style={[styles.heroAvatarRing, { borderColor: rank.accent }]} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.heroName} numberOfLines={2}>
            {name}
          </Text>
          <Text style={styles.heroClass} numberOfLines={1}>
            {className}
          </Text>
          <View style={[styles.heroStatus, { backgroundColor: status.bg }]}>
            <Text style={[styles.heroStatusText, { color: status.fg }]}>{status.text}</Text>
          </View>
        </View>
      </View>

      <View style={styles.rankRow}>
        <View style={[styles.rankPill, { backgroundColor: rank.accent }]}>
          <Text style={styles.rankPillText}>{rankLabelUpper(rank)}</Text>
        </View>
        <View style={styles.rankProgressTrack}>
          <View
            style={[
              styles.rankProgressFill,
              {
                width: `${Math.max(4, Math.min(100, Math.round(rankProgress * 100)))}%`,
                backgroundColor: rank.accent,
              },
            ]}
          />
        </View>
        <Text style={styles.rankProgressLabel}>{`${Math.round(rankProgress * 100)}%`}</Text>
      </View>
    </LinearGradient>
  );
}

function PhotoCircle({ url, size }: { url: string; size: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden' }}>
      <ExpoImage
        source={{ uri: url }}
        style={{ width: size, height: size }}
        contentFit="cover"
        transition={200}
        placeholder={{ blurhash: 'L4SY{q?b00?b~q?b?b?b?b?b?b?b' }}
        placeholderContentFit="cover"
        cachePolicy="memory-disk"
      />
    </View>
  );
}

function Card({ children, palette }: { children: React.ReactNode; palette: Palette }) {
  return (
    <View style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
      {children}
    </View>
  );
}

function CardHeader({ icon, title, palette }: { icon: any; title: string; palette: Palette }) {
  return (
    <View style={styles.cardHeader}>
      <Ionicons name={icon} size={14} color={palette.text.tertiary} />
      <Text style={[styles.cardTitle, { color: palette.text.tertiary }]}>{title}</Text>
    </View>
  );
}

/**
 * StatTile — single 2×2 grid cell: label + numeric value (0–100) + a
 * progress bar. Clean, legible "показатель" at a glance (no SVG radar).
 */
function StatTile({
  label,
  value,
  accent,
  palette,
}: {
  label: string;
  value: number;
  accent: string;
  palette: Palette;
}) {
  const clamped = Math.round(Math.max(0, Math.min(100, value)));
  return (
    <View style={[styles.statTile, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}>
      <Text style={[styles.statTileLabel, { color: palette.text.tertiary }]} numberOfLines={1}>
        {label}
      </Text>
      <View style={styles.statTileValueRow}>
        <Text style={[styles.statTileValue, { color: palette.text.primary }]}>{clamped}</Text>
        <Text style={[styles.statTileUnit, { color: palette.text.tertiary }]}>/100</Text>
      </View>
      <View
        style={[styles.statTileProgressTrack, palette.mode === 'dark' && { backgroundColor: 'rgba(255,255,255,0.10)' }]}
      >
        <View style={[styles.statTileProgressFill, { width: `${clamped}%`, backgroundColor: accent }]} />
      </View>
    </View>
  );
}

/**
 * StatsSummary — заменяет «простыню смен» на компактную сводку:
 *   1. сегодняшняя смена (тонкая строка сверху — только если она есть);
 *   2. метрики смен (Смены / Опоздания / Лучший день);
 *   3. ТОП-3 товара (lifetime.topProducts, с фото если есть);
 *   4. ТОП услуга (serviceMastery — первая, самая «прокачанная»).
 *
 * `shifts` приходит только у тенантов с включённой фичей «Смены» (070) —
 * если её нет, блок метрик смен скрываем целиком, не показываем нули.
 */
function StatsSummary({
  today,
  shifts,
  topProducts,
  serviceMastery,
  accent,
  palette,
}: {
  today?: TodayEmployeeStatus;
  shifts?: EmployeeFullProfile['shifts'];
  topProducts?: NonNullable<EmployeeFullProfile['lifetime']['topProducts']>;
  serviceMastery: EmployeeFullProfile['serviceMastery'];
  accent: string;
  palette: Palette;
}) {
  const products = (topProducts ?? []).slice(0, 3);
  const topService = serviceMastery.length > 0 ? serviceMastery[0] : null;
  const hasShifts = !!shifts && shifts.total > 0;

  // Когда вообще нет ни смен, ни товаров, ни услуги — единый empty-state.
  if (!hasShifts && products.length === 0 && !topService && !today) {
    return (
      <Text style={[styles.mutedText, { color: palette.text.tertiary }]}>
        Пока недостаточно данных — статистика появится после первых смен и чеков.
      </Text>
    );
  }

  return (
    <View style={{ gap: spacing[3.5] }}>
      <TodayShiftStrip today={today} palette={palette} />

      {/* ── Метрики смен ─────────────────────────────────────────────── */}
      {hasShifts ? (
        <View style={styles.tilesRow}>
          <MetricTile label="Смены" value={String(shifts!.total)} palette={palette} />
          <MetricTile
            label="Опоздания"
            value={shifts!.lateCount > 0 ? String(shifts!.lateCount) : '0'}
            palette={palette}
          />
          <MetricTile
            label="Лучший день"
            value={shifts!.bestDay ? formatShortDate(shifts!.bestDay.date) : '—'}
            palette={palette}
          />
        </View>
      ) : null}

      {/* ── ТОП-3 товара ─────────────────────────────────────────────── */}
      {products.length > 0 ? (
        <View style={{ gap: spacing[2] }}>
          <Text style={[styles.subSectionTitle, { color: palette.text.tertiary }]}>Топ товаров</Text>
          <View style={{ gap: spacing[2] }}>
            {products.map((p, i) => (
              <TopProductRow key={p.productId} rank={i + 1} product={p} accent={accent} palette={palette} />
            ))}
          </View>
        </View>
      ) : null}

      {/* ── ТОП услуга ───────────────────────────────────────────────── */}
      {topService ? (
        <View style={{ gap: spacing[2] }}>
          <Text style={[styles.subSectionTitle, { color: palette.text.tertiary }]}>Топ услуга</Text>
          <TopServiceRow service={topService} palette={palette} />
        </View>
      ) : null}
    </View>
  );
}

/**
 * TodayShiftStrip — компактная строка о сегодняшней смене. Рисуется только
 * когда у сотрудника сегодня есть смена (start+end) или явный выходной;
 * иначе — ничего (без пустого «—»). shiftStart/shiftEnd — это "HH:mm" TEXT,
 * поэтому через formatHM().
 */
function TodayShiftStrip({ today, palette }: { today?: TodayEmployeeStatus; palette: Palette }) {
  const hasShift = !!(today?.shiftStart && today?.shiftEnd);
  if (!hasShift && !today?.isDayOff) return null;

  const startStr = formatHM(today?.shiftStart);
  const endStr = formatHM(today?.shiftEnd);
  const progress = computeShiftProgress(today);

  if (today?.isDayOff && !hasShift) {
    return (
      <View style={[styles.todayStrip, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}>
        <View style={[styles.todayStripIcon, { backgroundColor: palette.bg.card }]}>
          <Ionicons name="bed-outline" size={16} color={palette.text.tertiary} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.todayStripLabel, { color: palette.text.tertiary }]}>Сегодня</Text>
          <Text style={[styles.todayStripValue, { color: palette.text.primary }]}>Выходной</Text>
        </View>
      </View>
    );
  }

  const lateText = today && today.lateMinutes > 0 ? `опоздал на ${today.lateMinutes} мин` : null;
  const arrivalText = today?.actualArrival ? `пришёл в ${formatHM(today.actualArrival)}` : null;

  return (
    <View style={[styles.todayStrip, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}>
      {progress ? (
        <ShiftProgressRing progress={progress.ratio} />
      ) : (
        <View style={[styles.todayStripIcon, { backgroundColor: palette.bg.card }]}>
          <Ionicons name="calendar-outline" size={16} color={colors.primary[600]} />
        </View>
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.todayStripLabel, { color: palette.text.tertiary }]}>
          {progress ? 'Идёт смена' : 'Смена сегодня'}
        </Text>
        <Text style={[styles.todayStripValue, { color: palette.text.primary }]} numberOfLines={1}>
          {`${startStr} – ${endStr}`}
        </Text>
        {arrivalText || lateText ? (
          <Text
            style={[styles.todayStripSub, { color: lateText ? colors.orange[600] : palette.text.secondary }]}
            numberOfLines={1}
          >
            {lateText ?? arrivalText}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** TopProductRow — строка топ-товара: ранг + фото (если есть) + имя + кол-во. */
function TopProductRow({
  rank,
  product,
  accent,
  palette,
}: {
  rank: number;
  product: NonNullable<EmployeeFullProfile['lifetime']['topProducts']>[number];
  accent: string;
  palette: Palette;
}) {
  return (
    <View style={[styles.topRow, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}>
      <View style={[styles.topRank, { backgroundColor: accent }]}>
        <Text style={styles.topRankText}>{rank}</Text>
      </View>
      {product.photo ? (
        <CachedImage source={{ uri: product.photo }} style={styles.topPhoto} />
      ) : (
        <View style={[styles.topPhoto, styles.topPhotoPlaceholder, { backgroundColor: palette.bg.card }]}>
          <Ionicons name="cube-outline" size={16} color={palette.text.tertiary} />
        </View>
      )}
      <Text style={[styles.topName, { color: palette.text.primary }]} numberOfLines={1}>
        {product.name}
      </Text>
      <Text style={[styles.topCount, { color: palette.text.secondary }]}>{`${product.count} шт`}</Text>
    </View>
  );
}

/** TopServiceRow — строка топ-услуги: иконка + имя + tier-бейдж + кол-во. */
function TopServiceRow({
  service,
  palette,
}: {
  service: EmployeeFullProfile['serviceMastery'][number];
  palette: Palette;
}) {
  const tier = SERVICE_TIER_META[service.tier];
  // Dark: colored tiers (bronze/gold/platinum) become a translucent glow of
  // their own accent instead of a washed pale-[50] sticker; the silver tier is
  // a NEUTRAL gray[100] → fall back to palette.bg.muted. Light stays byte-identical.
  const tierBg =
    palette.mode === 'dark'
      ? tier.bg === colors.gray[100]
        ? palette.bg.muted
        : softTint(tier.color, 'dark')
      : tier.bg;
  return (
    <View style={[styles.topRow, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}>
      <View style={[styles.topPhoto, styles.topPhotoPlaceholder, { backgroundColor: palette.bg.card }]}>
        <Ionicons name="construct-outline" size={16} color={tier.color} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.topName, { color: palette.text.primary }]} numberOfLines={1}>
          {service.name}
        </Text>
        <View style={[styles.tierBadge, { backgroundColor: tierBg }]}>
          <Text style={[styles.tierBadgeText, { color: tier.color }]}>{tier.label}</Text>
        </View>
      </View>
      <Text style={[styles.topCount, { color: palette.text.secondary }]}>{`${service.count} раз`}</Text>
    </View>
  );
}

/** Цвета/подписи tier'ов service-mastery (semantic palette). */
const SERVICE_TIER_META: Record<
  EmployeeFullProfile['serviceMastery'][number]['tier'],
  { label: string; color: string; bg: string }
> = {
  bronze: { label: 'Бронза', color: colors.orange[600], bg: colors.orange[50] },
  silver: { label: 'Серебро', color: colors.slate[600], bg: colors.gray[100] },
  gold: { label: 'Золото', color: colors.amber[700], bg: colors.amber[50] },
  platinum: { label: 'Платина', color: colors.indigo[600], bg: colors.indigo[50] },
};

function ShiftProgressRing({ progress }: { progress: number }) {
  const palette = useColors();
  const pct = Math.max(0, Math.min(1, progress));
  const rotation = pct * 360;
  return (
    <View style={styles.ringWrap}>
      <View style={[styles.ringTrack, palette.mode === 'dark' && { borderColor: 'rgba(255,255,255,0.12)' }]} />
      <View
        style={[
          styles.ringFill,
          {
            transform: [{ rotate: `${rotation}deg` }],
            borderTopColor: colors.primary[500],
            borderRightColor: pct > 0.25 ? colors.primary[500] : 'transparent',
            borderBottomColor: pct > 0.5 ? colors.primary[500] : 'transparent',
            borderLeftColor: pct > 0.75 ? colors.primary[500] : 'transparent',
          },
        ]}
      />
      <Text style={styles.ringText}>{Math.round(pct * 100)}%</Text>
    </View>
  );
}

function MetricTile({
  label,
  value,
  highlight,
  palette,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  palette: Palette;
}) {
  return (
    <View
      style={[
        styles.tile,
        highlight
          ? styles.tileHighlight
          : { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, borderWidth: 1 },
      ]}
    >
      <Text style={[styles.tileLabel, { color: palette.text.tertiary }]} numberOfLines={1}>
        {label}
      </Text>
      <Text
        style={[styles.tileValue, { color: highlight ? colors.blue[700] : palette.text.primary }]}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

function PeriodSwitcher({
  value,
  onChange,
  palette,
}: {
  value: 'week' | 'month' | 'year';
  onChange: (v: 'week' | 'month' | 'year') => void;
  palette: Palette;
}) {
  const opts: Array<{ key: 'week' | 'month' | 'year'; label: string }> = [
    { key: 'week', label: 'Неделя' },
    { key: 'month', label: 'Месяц' },
    { key: 'year', label: 'Год' },
  ];
  return (
    <View style={[styles.segmented, { backgroundColor: palette.bg.muted }]}>
      {opts.map((o) => {
        const active = value === o.key;
        return (
          <Pressable
            key={o.key}
            onPress={() => {
              haptic('select');
              onChange(o.key);
            }}
            style={[
              styles.segmentedItem,
              active && {
                backgroundColor: palette.bg.elevated,
                shadowOpacity: 0.08,
                shadowOffset: { width: 0, height: 1 },
                shadowRadius: 2,
                elevation: 1,
              },
            ]}
          >
            <Text style={[styles.segmentedText, { color: active ? palette.text.primary : palette.text.secondary }]}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Sparkline({ values, accent, palette }: { values: number[]; accent: string; palette: Palette }) {
  if (values.length === 0) return null;
  const max = Math.max(1, ...values);
  return (
    <View style={[styles.sparkRow, { borderColor: palette.border.subtle }]}>
      {values.map((v, i) => {
        const h = Math.max(2, Math.round((v / max) * 36));
        return (
          <View
            key={i}
            style={{
              width: 4,
              height: h,
              borderRadius: 2,
              backgroundColor: v > 0 ? accent : palette.border.subtle,
              opacity: v > 0 ? 0.9 : 0.4,
            }}
          />
        );
      })}
    </View>
  );
}

function LifeStat({ label, value, palette }: { label: string; value: string; palette: Palette }) {
  return (
    <View style={styles.lifeStat}>
      <Text style={[styles.lifeStatLabel, { color: palette.text.tertiary }]}>{label}</Text>
      <Text style={[styles.lifeStatValue, { color: palette.text.primary }]}>{value}</Text>
    </View>
  );
}

function ActionBtn({
  icon,
  label,
  onPress,
  palette,
  accent,
}: {
  icon: any;
  label: string;
  onPress: () => void;
  palette: Palette;
  accent?: string;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      onPressIn={() => Animated.spring(scale, { toValue: 0.94, useNativeDriver: true, speed: 30 }).start()}
      onPressOut={() =>
        Animated.timing(scale, {
          toValue: 1,
          duration: 140,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start()
      }
      style={styles.actionBtn}
    >
      <Animated.View style={{ transform: [{ scale }], alignItems: 'center' }}>
        <View style={[styles.actionIconBox, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}>
          <Ionicons name={icon} size={18} color={accent || palette.text.primary} />
        </View>
        <Text style={[styles.actionLabel, { color: palette.text.secondary }]} numberOfLines={1}>
          {label}
        </Text>
      </Animated.View>
    </TouchableOpacity>
  );
}

function MenuItem({
  icon,
  label,
  onPress,
  palette,
  destructive,
}: {
  icon: any;
  label: string;
  onPress: () => void;
  palette: Palette;
  /** Красный пункт меню для необратимых действий (увольнение). */
  destructive?: boolean;
}) {
  const color = destructive ? colors.red[500] : palette.text.primary;
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.6} style={styles.menuItem}>
      <Ionicons name={icon} size={18} color={color} />
      <Text style={[styles.menuItemText, { color }]}>{label}</Text>
    </TouchableOpacity>
  );
}

/**
 * ContactRow — строка карточки «Контакты»: tap = действие (позвонить /
 * открыть WhatsApp), long-press = share sheet (скопировать). Та же
 * геометрия, что у checkRow / invRow — единый ритм внутри карточек.
 */
function ContactRow({
  icon,
  label,
  value,
  missing,
  onPress,
  onLongPress,
  accent,
  palette,
}: {
  icon: any;
  label: string;
  value: string;
  missing: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  accent?: string;
  palette: Palette;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.75}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      style={[styles.contactRow, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
    >
      <View style={[styles.contactIconBox, { backgroundColor: palette.bg.card }]}>
        <Ionicons name={icon} size={16} color={missing ? palette.text.tertiary : accent || colors.primary[600]} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.contactLabel, { color: palette.text.tertiary }]}>{label}</Text>
        <Text
          style={[styles.contactValue, { color: missing ? palette.text.tertiary : palette.text.primary }]}
          numberOfLines={1}
        >
          {value}
        </Text>
      </View>
      {!missing && <Ionicons name="chevron-forward" size={14} color={palette.text.tertiary} />}
    </TouchableOpacity>
  );
}

/** InfoRow — строка «лейбл слева — значение справа» (карточка «Роль и доступ»). */
function InfoRow({ label, value, palette }: { label: string; value: string; palette: Palette }) {
  return (
    <View style={styles.infoRow}>
      <Text style={[styles.infoLabel, { color: palette.text.secondary }]}>{label}</Text>
      <Text style={[styles.infoValue, { color: palette.text.primary }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

// ──────────────────────────────────────────────────────────────────────────
//  ЕГО ПОСЛЕДНИЕ ЧЕКИ — lazy, fetched when the card mounts (below the fold)
// ──────────────────────────────────────────────────────────────────────────

function RecentChecks({ employeeId, palette, navigation }: { employeeId: string; palette: Palette; navigation: any }) {
  const { data, isLoading } = useQuery<Check[]>({
    queryKey: ['employee-recent-checks', employeeId],
    queryFn: async () => {
      const res = await checksApi.getAll({ masterId: employeeId, page: 1, limit: 6 });
      return res.data.data;
    },
    staleTime: 30_000,
  });

  if (isLoading && !data) {
    return (
      <View style={{ gap: spacing[2] }}>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} height={48} radius={borderRadius.lg} />
        ))}
      </View>
    );
  }

  const checks = data ?? [];
  if (checks.length === 0) {
    return <Text style={[styles.mutedText, { color: palette.text.tertiary }]}>Пока нет ни одного чека.</Text>;
  }

  return (
    <View style={{ gap: spacing[2] }}>
      {checks.map((c) => (
        <TouchableOpacity
          key={c.id}
          activeOpacity={0.75}
          onPress={() => {
            haptic('tap');
            navigation.navigate('CheckDetail', { id: c.id });
          }}
          style={[styles.checkRow, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
        >
          <View style={[styles.checkIconBox, { backgroundColor: palette.bg.card }]}>
            <Ionicons name="receipt-outline" size={16} color={colors.primary[600]} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.checkTitle, { color: palette.text.primary }]} numberOfLines={1}>
              {`№ ${c.number}`}
              {c.car?.makeModel ? ` · ${c.car.makeModel}` : c.client?.fullName ? ` · ${c.client.fullName}` : ''}
            </Text>
            <Text style={[styles.checkMeta, { color: palette.text.tertiary }]} numberOfLines={1}>
              {formatShortDate(c.date)}
              {c.isReturned ? ' · возврат' : ''}
            </Text>
          </View>
          <Text
            style={[styles.checkAmount, { color: c.isReturned ? palette.text.tertiary : palette.text.primary }]}
            numberOfLines={1}
          >
            {formatMoneyFull(c.totalRevenue)}
          </Text>
          <Ionicons name="chevron-forward" size={14} color={palette.text.tertiary} />
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ──────────────────────────────────────────────────────────────────────────
//  ЕГО ИНВЕНТАРЬ — lazy, equipment issued to this employee
// ──────────────────────────────────────────────────────────────────────────

function Inventory({ employeeId, palette }: { employeeId: string; palette: Palette }) {
  const { data, isLoading } = useQuery<any[]>({
    queryKey: ['eq-user', employeeId],
    queryFn: async () => (await equipmentApi.getByUser(employeeId)).data,
    staleTime: 30_000,
  });

  if (isLoading && !data) {
    return (
      <View style={{ gap: spacing[2] }}>
        {[0, 1].map((i) => (
          <Skeleton key={i} height={44} radius={borderRadius.lg} />
        ))}
      </View>
    );
  }

  const active = (data ?? []).filter((i: any) => i.status === 'active');
  if (active.length === 0) {
    return <Text style={[styles.mutedText, { color: palette.text.tertiary }]}>Инвентарь не выдан.</Text>;
  }
  const total = active.reduce((s: number, i: any) => s + (i.cost || 0), 0);

  return (
    <View style={{ gap: spacing[2] }}>
      {active.map((item: any) => (
        <View
          key={item.id}
          style={[styles.invRow, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
        >
          {item.photo ? (
            <CachedImage source={{ uri: item.photo }} style={styles.invPhoto} />
          ) : (
            <View style={[styles.invPhoto, styles.invPhotoPlaceholder, { backgroundColor: palette.bg.card }]}>
              <Ionicons name="cube-outline" size={16} color={palette.text.tertiary} />
            </View>
          )}
          <Text style={[styles.invName, { color: palette.text.primary }]} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={[styles.invCost, { color: palette.text.secondary }]}>{formatMoneyFull(item.cost || 0)}</Text>
        </View>
      ))}
      <View style={styles.invTotalRow}>
        <Text style={[styles.invTotalLabel, { color: palette.text.tertiary }]}>Всего на руках</Text>
        <Text style={[styles.invTotalValue, { color: palette.text.primary }]}>{formatMoneyFull(total)}</Text>
      </View>
    </View>
  );
}

// ──────────────────────────────────────────────────────────────────────────
//  ЕГО РЕГЛАМЕНТЫ — lazy, how many regulations this employee acknowledged.
//  Manager view only (gated by the caller). Minimal: one progress line.
// ──────────────────────────────────────────────────────────────────────────

function RegulationsSummary({ employeeId, accent, palette }: { employeeId: string; accent: string; palette: Palette }) {
  const { data, isLoading } = useQuery<RegulationUserSummary>({
    queryKey: ['knowledge-regulation-summary', employeeId],
    queryFn: async () => (await knowledgeApi.regulationSummaryForUser(employeeId)).data,
    staleTime: 60_000,
  });

  if (isLoading && !data) {
    return <Skeleton height={40} radius={borderRadius.lg} />;
  }

  const total = data?.total ?? 0;
  const acknowledged = data?.acknowledged ?? 0;

  if (total === 0) {
    return <Text style={[styles.mutedText, { color: palette.text.tertiary }]}>Регламентов пока нет.</Text>;
  }

  const allDone = acknowledged >= total;
  const ratio = total > 0 ? Math.max(0, Math.min(1, acknowledged / total)) : 0;
  const barColor = allDone ? colors.green[500] : accent;

  return (
    <View style={{ gap: spacing[2] }}>
      <View style={styles.regSummaryRow}>
        <Text style={[styles.regSummaryValue, { color: palette.text.primary }]}>
          {acknowledged}/{total}
        </Text>
        <Text style={[styles.regSummaryLabel, { color: allDone ? colors.green[600] : palette.text.secondary }]}>
          {allDone ? 'Все ознакомлен' : 'ознакомлен'}
        </Text>
      </View>
      <View style={[styles.regSummaryTrack, { backgroundColor: palette.bg.muted }]}>
        <View style={[styles.regSummaryFill, { width: `${ratio * 100}%`, backgroundColor: barColor }]} />
      </View>
    </View>
  );
}

// ──────────────────────────────────────────────────────────────────────────
//  ЕГО ОБУЧЕНИЕ — lazy. How many courses this employee completed + a per-course
//  progress line. Manager view only (gated by the caller). Minimal: we read the
//  course list (cached) then one progress query per course.
// ──────────────────────────────────────────────────────────────────────────

function LearningSummary({ employeeId, accent, palette }: { employeeId: string; accent: string; palette: Palette }) {
  const { data: courses, isLoading } = useQuery<KnowledgeCourse[]>({
    queryKey: ['knowledge-courses'],
    queryFn: async () => (await knowledgeApi.listCourses()).data,
    staleTime: 60_000,
  });

  const progressQueries = useQueries({
    queries: (courses ?? []).map((c) => ({
      queryKey: ['knowledge-course-progress', c.id, employeeId],
      queryFn: async () => (await knowledgeApi.courseProgress(c.id, employeeId)).data,
      staleTime: 60_000,
    })),
  });

  if (isLoading && !courses) {
    return <Skeleton height={40} radius={borderRadius.lg} />;
  }

  if (!courses || courses.length === 0) {
    return <Text style={[styles.mutedText, { color: palette.text.tertiary }]}>Курсов пока нет.</Text>;
  }

  const rows = courses.map((c, i) => {
    const p = progressQueries[i]?.data as CourseProgress | undefined;
    return { course: c, percent: p?.percent ?? 0, completed: !!p?.completedAt };
  });
  const completedCount = rows.filter((r) => r.completed).length;

  return (
    <View style={{ gap: spacing[2.5] }}>
      <View style={styles.regSummaryRow}>
        <Text style={[styles.regSummaryValue, { color: palette.text.primary }]}>
          {completedCount}/{courses.length}
        </Text>
        <Text
          style={[
            styles.regSummaryLabel,
            { color: completedCount >= courses.length ? colors.green[600] : palette.text.secondary },
          ]}
        >
          {completedCount === courses.length ? 'все курсы пройдены' : 'курсов пройдено'}
        </Text>
      </View>
      <View style={{ gap: spacing[2] }}>
        {rows.slice(0, 4).map((r) => {
          const ratio = Math.max(0, Math.min(1, r.percent / 100));
          const barColor = r.completed ? colors.green[500] : accent;
          return (
            <View key={r.course.id} style={{ gap: 4 }}>
              <View style={styles.learnRowTop}>
                <Text style={[styles.learnCourseTitle, { color: palette.text.secondary }]} numberOfLines={1}>
                  {r.course.title}
                </Text>
                <Text style={[styles.learnPercent, { color: r.completed ? colors.green[600] : palette.text.tertiary }]}>
                  {r.completed ? 'пройден' : `${r.percent}%`}
                </Text>
              </View>
              <View style={[styles.regSummaryTrack, { backgroundColor: palette.bg.muted }]}>
                <View style={[styles.regSummaryFill, { width: `${ratio * 100}%`, backgroundColor: barColor }]} />
              </View>
            </View>
          );
        })}
        {rows.length > 4 ? (
          <Text style={[styles.mutedText, { color: palette.text.tertiary }]}>и ещё {rows.length - 4}…</Text>
        ) : null}
      </View>
    </View>
  );
}

// ──────────────────────────────────────────────────────────────────────────
//  Achievements Modal
// ──────────────────────────────────────────────────────────────────────────

function AchievementsModal({
  visible,
  onClose,
  achievements,
  isOwnerLike,
  onAdd,
  onLongPress,
  palette,
}: {
  visible: boolean;
  onClose: () => void;
  achievements: EmployeeAchievement[];
  isOwnerLike: boolean;
  onAdd: () => void;
  onLongPress: (a: EmployeeAchievement) => void;
  palette: Palette;
}) {
  const auto = achievements.filter((a) => a.type === 'auto');
  const custom = achievements.filter((a) => a.type === 'custom');

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={[styles.modalSheet, { backgroundColor: palette.bg.canvas, borderColor: palette.border.subtle }]}>
          <View style={[styles.modalHandle, { backgroundColor: palette.border.strong }]} />
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: palette.text.primary }]}>Все значки</Text>
            <Pressable onPress={onClose} hitSlop={10} style={styles.modalClose}>
              <Ionicons name="close" size={22} color={palette.text.primary} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.modalScroll} showsVerticalScrollIndicator={false}>
            {achievements.length === 0 && (
              <View
                style={[styles.emptyTrophy, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
              >
                <Text style={[styles.emptyTrophyText, { color: palette.text.tertiary }]}>
                  Значков пока нет. {isOwnerLike ? 'Выдайте первый ниже.' : ''}
                </Text>
              </View>
            )}

            {custom.length > 0 && (
              <View style={styles.modalSection}>
                <Text style={[styles.modalSectionTitle, { color: palette.text.tertiary }]}>Особые значки</Text>
                <View style={styles.trophyGrid}>
                  {custom.map((a) => (
                    <TouchableOpacity
                      key={a.id}
                      activeOpacity={0.85}
                      onLongPress={() => onLongPress(a)}
                      delayLongPress={400}
                      style={[
                        styles.trophyBadge,
                        styles.trophyBadgeCustom,
                        { borderColor: a.color || colors.amber[600] },
                      ]}
                    >
                      <Text style={styles.trophyIcon}>{a.icon || '🏆'}</Text>
                      <Text style={[styles.trophyName, { color: colors.gray[900] }]} numberOfLines={2}>
                        {a.name}
                      </Text>
                      {a.description ? (
                        <Text style={[styles.trophyDesc, { color: colors.gray[700] }]} numberOfLines={2}>
                          {a.description}
                        </Text>
                      ) : null}
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}

            {auto.length > 0 && (
              <View style={styles.modalSection}>
                <Text style={[styles.modalSectionTitle, { color: palette.text.tertiary }]}>Автоматические</Text>
                <View style={styles.trophyGrid}>
                  {auto.map((a) => (
                    <View
                      key={a.id}
                      style={[
                        styles.trophyBadge,
                        { borderColor: palette.border.subtle, backgroundColor: palette.bg.muted },
                      ]}
                    >
                      <Text style={styles.trophyIcon}>{a.icon || '🏆'}</Text>
                      <Text style={[styles.trophyName, { color: palette.text.primary }]} numberOfLines={2}>
                        {a.name}
                      </Text>
                      {a.description ? (
                        <Text style={[styles.trophyDesc, { color: palette.text.tertiary }]} numberOfLines={2}>
                          {a.description}
                        </Text>
                      ) : null}
                    </View>
                  ))}
                </View>
              </View>
            )}

            {isOwnerLike && (
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={onAdd}
                style={[styles.modalAddBtn, { borderColor: palette.border.subtle }]}
              >
                <Ionicons name="add-circle-outline" size={20} color={colors.primary[600]} />
                <Text style={[styles.modalAddBtnText, { color: colors.primary[700] }]}>Выдать новый значок</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ──────────────────────────────────────────────────────────────────────────
//  Period totals from the YEAR HEATMAP buffer
// ──────────────────────────────────────────────────────────────────────────

function computePeriodTotals(
  heatmap: EmployeeFullProfile['yearHeatmap'],
  period: 'week' | 'month' | 'year',
  sharePct: number,
): { earnings: number; revenue: number; toPay: number; checks: number; spark: number[] } {
  const now = new Date();
  let from: Date;
  if (period === 'week') {
    from = new Date(now);
    from.setDate(from.getDate() - 6);
  } else if (period === 'month') {
    from = new Date(now.getFullYear(), now.getMonth(), 1);
  } else {
    from = new Date(now.getFullYear(), 0, 1);
  }
  const within = heatmap.filter((d) => {
    const t = new Date(d.day).getTime();
    return t >= from.getTime() && t <= now.getTime();
  });
  const revenue = within.reduce((s, d) => s + d.revenue, 0);
  const checks = within.reduce((s, d) => s + d.checks, 0);
  const earnings = Math.round(revenue * Math.max(0, Math.min(1, sharePct)));
  const toPay = revenue - earnings;
  const spark = within.slice(-30).map((d) => d.revenue);
  return { earnings, revenue, toPay, checks, spark };
}

function computeShiftProgress(s?: TodayEmployeeStatus): { ratio: number; elapsedMs: number } | null {
  if (!s?.shiftStart || !s?.shiftEnd) return null;
  const startHM = /^(\d{1,2}):(\d{2})$/.exec(s.shiftStart);
  const endHM = /^(\d{1,2}):(\d{2})$/.exec(s.shiftEnd);
  if (!startHM || !endHM) return null;
  const now = new Date();
  const start = new Date(now);
  start.setHours(Number(startHM[1]), Number(startHM[2]), 0, 0);
  const end = new Date(now);
  end.setHours(Number(endHM[1]), Number(endHM[2]), 0, 0);
  if (end <= start) return null;
  if (now < start) return null;
  if (now >= end) return null;
  const ratio = (now.getTime() - start.getTime()) / (end.getTime() - start.getTime());
  return { ratio, elapsedMs: now.getTime() - start.getTime() };
}

// ──────────────────────────────────────────────────────────────────────────
//  Styles
// ──────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.gray[50] },
  scroll: { padding: spacing[4], gap: spacing[4] },

  // ── Dismissed / purged read-only state ──
  dismissedHeadRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  dismissedAvatarWrap: { width: 64, height: 64, borderRadius: 32, overflow: 'hidden' },
  dismissedAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dismissedInitials: { fontSize: 22, fontWeight: '800', letterSpacing: -0.5 },
  dismissedName: { fontSize: 19, fontWeight: '700', letterSpacing: -0.4 },
  dismissedRole: { fontSize: 14, fontWeight: '500', marginTop: 2 },
  dismissedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    marginTop: spacing[2],
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  dismissedPillText: { fontSize: 12, fontWeight: '700', letterSpacing: -0.1 },
  dismissedDivider: { height: StyleSheet.hairlineWidth, marginVertical: spacing[3.5] },
  dismissedBody: { fontSize: 14, lineHeight: 20, letterSpacing: -0.1 },
  dismissedCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    marginTop: spacing[4],
    paddingVertical: spacing[3],
    borderRadius: 14,
    backgroundColor: colors.primary[600],
  },
  dismissedCtaText: { color: colors.white, fontSize: 15, fontWeight: '600', letterSpacing: -0.2 },

  headerBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Menu popover ─────────────────────────────────────────────────────
  menu: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 96 : 76,
    right: spacing[3],
    minWidth: 220,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    paddingVertical: 4,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 16,
    elevation: 12,
    zIndex: 50,
  },
  menuDivider: { height: StyleSheet.hairlineWidth, marginVertical: 4 },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2.5],
    paddingHorizontal: spacing[4],
    paddingVertical: 12,
  },
  menuItemText: { fontSize: fontSize.base, fontWeight: fontWeight.medium },

  // ── Hero ─────────────────────────────────────────────────────────────
  hero: {
    borderRadius: borderRadius['3xl'],
    padding: spacing[5],
    overflow: 'hidden',
    gap: spacing[4],
  },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  heroAvatarWrap: { width: 80, height: 80, alignItems: 'center', justifyContent: 'center' },
  heroAvatar: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroAvatarRing: {
    position: 'absolute',
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 3,
  },
  heroInitials: { color: '#fff', fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  heroName: { color: '#fff', fontSize: 26, fontWeight: '800', letterSpacing: -0.5, lineHeight: 30 },
  heroClass: { color: 'rgba(255,255,255,0.78)', fontSize: 13, fontWeight: '500', marginTop: 4 },
  heroStatus: {
    alignSelf: 'flex-start',
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  heroStatusText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.4 },

  rankRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  rankPill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
  },
  rankPillText: { color: '#fff', fontSize: 12, fontWeight: '800', letterSpacing: 1.2 },
  rankProgressTrack: {
    flex: 1,
    height: 6,
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderRadius: 3,
    overflow: 'hidden',
  },
  rankProgressFill: { height: '100%', borderRadius: 3 },
  rankProgressLabel: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 11,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },

  // ── Cards ────────────────────────────────────────────────────────────
  card: {
    backgroundColor: '#fff',
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    padding: spacing[4],
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
    marginBottom: spacing[3],
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing[3],
  },
  cardTitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  linkText: {
    fontSize: 12,
    fontWeight: '600',
  },
  mutedText: { fontSize: 12 },

  // ── Регламенты summary ───────────────────────────────────────────────
  regSummaryRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing[2] },
  regSummaryValue: { fontSize: 22, fontWeight: '700', letterSpacing: -0.4 },
  regSummaryLabel: { fontSize: 13, fontWeight: '500' },
  regSummaryTrack: { height: 6, borderRadius: 3, overflow: 'hidden' },
  regSummaryFill: { height: 6, borderRadius: 3 },
  learnRowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing[2] },
  learnCourseTitle: { flex: 1, fontSize: 13, fontWeight: '500' },
  learnPercent: { fontSize: 12, fontWeight: '600' },

  // ── Stat tiles (показатели) ──────────────────────────────────────────
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[2],
  },
  statTile: {
    flexBasis: '48%',
    flexGrow: 1,
    minWidth: 0,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    gap: 6,
  },
  statTileLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  statTileValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  statTileValue: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.5,
    fontVariant: ['tabular-nums'],
  },
  statTileUnit: {
    fontSize: 11,
    fontWeight: '600',
  },
  statTileProgressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(15,23,42,0.06)',
    overflow: 'hidden',
  },
  statTileProgressFill: {
    height: '100%',
    borderRadius: 2,
  },

  // ── Lifetime footer (folded into показатели) ────────────────────────
  lifeFooter: {
    flexDirection: 'row',
    gap: spacing[3],
    marginTop: spacing[3],
    paddingTop: spacing[3],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  lifeStat: { flex: 1, alignItems: 'flex-start' },
  lifeStatLabel: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  lifeStatValue: { fontSize: 18, fontWeight: '800', letterSpacing: -0.5 },

  // ── Tiles & today ───────────────────────────────────────────────────
  tilesRow: { flexDirection: 'row', gap: spacing[2] },
  tilesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  tile: {
    flexBasis: '48%',
    flexGrow: 1,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.xl,
  },
  tileHighlight: { backgroundColor: '#EFF6FF', borderColor: '#DBEAFE', borderWidth: 1 },
  tileLabel: { fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  tileValue: { fontSize: 16, fontWeight: '700', letterSpacing: -0.3 },

  // ── Statистика: подзаголовок секции ─────────────────────────────────
  subSectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },

  // ── Сегодняшняя смена (тонкая строка сверху статистики) ─────────────
  todayStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[3],
    borderRadius: borderRadius.xl,
    borderWidth: 1,
  },
  todayStripIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayStripLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  todayStripValue: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.3,
    marginTop: 1,
    fontVariant: ['tabular-nums'],
  },
  todayStripSub: { fontSize: 12, fontWeight: '500', marginTop: 1 },

  // ── Топ товаров / услуги ────────────────────────────────────────────
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2.5],
    paddingVertical: 8,
    paddingHorizontal: spacing[3],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
  },
  topRank: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topRankText: { fontSize: 11, fontWeight: '800', color: colors.white, fontVariant: ['tabular-nums'] },
  topPhoto: { width: 32, height: 32, borderRadius: 10 },
  topPhotoPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  topName: { flex: 1, minWidth: 0, fontSize: 13, fontWeight: '600' },
  topCount: { fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  tierBadge: {
    alignSelf: 'flex-start',
    marginTop: 3,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  tierBadgeText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.2 },

  ringWrap: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  ringTrack: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 3,
    borderColor: 'rgba(15,23,42,0.08)',
  },
  ringFill: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 3,
    borderColor: 'transparent',
  },
  ringText: { fontSize: 11, fontWeight: '800', color: colors.primary[700], fontVariant: ['tabular-nums'] },

  // ── Segmented control (period) ─────────────────────────────────────
  segmented: {
    flexDirection: 'row',
    borderRadius: 10,
    padding: 3,
    gap: 2,
  },
  segmentedItem: {
    flex: 1,
    paddingVertical: 6,
    alignItems: 'center',
    borderRadius: 8,
  },
  segmentedText: { fontSize: 13, fontWeight: '600' },

  sparkRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
    height: 40,
    paddingTop: 4,
    marginTop: spacing[3],
    borderTopWidth: StyleSheet.hairlineWidth,
  },

  // ── Контакты / Роль и доступ ───────────────────────────────────────
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: 8,
    paddingHorizontal: spacing[3],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
  },
  contactIconBox: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contactLabel: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  contactValue: { fontSize: 14, fontWeight: '600', letterSpacing: -0.2, marginTop: 1 },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[3],
    minHeight: 22,
  },
  infoLabel: { fontSize: 13, fontWeight: '500' },
  infoValue: { flexShrink: 1, fontSize: 13, fontWeight: '700', letterSpacing: -0.2, textAlign: 'right' },

  // ── Recent checks ──────────────────────────────────────────────────
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: 8,
    paddingHorizontal: spacing[3],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
  },
  checkIconBox: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkTitle: { fontSize: 13, fontWeight: '700' },
  checkMeta: { fontSize: 11, marginTop: 1 },
  checkAmount: { fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },

  // ── Inventory ──────────────────────────────────────────────────────
  invRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: 8,
    paddingHorizontal: spacing[3],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
  },
  invPhoto: { width: 32, height: 32, borderRadius: 10 },
  invPhotoPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  invName: { flex: 1, minWidth: 0, fontSize: 13, fontWeight: '600' },
  invCost: { fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  invTotalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing[2],
    paddingHorizontal: spacing[1],
  },
  invTotalLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  invTotalValue: { fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },

  // ── Trophy preview (3 chips on main canvas) ─────────────────────────
  trophyPreviewRow: {
    flexDirection: 'row',
    gap: spacing[2],
  },
  trophyPreview: {
    flex: 1,
    minWidth: 0,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    paddingVertical: spacing[2.5],
    paddingHorizontal: spacing[2],
    alignItems: 'center',
    gap: 4,
  },
  trophyPreviewIcon: { fontSize: 26 },
  trophyPreviewName: { fontSize: 11, fontWeight: '700', textAlign: 'center', lineHeight: 14 },

  // ── Trophy badge (used in modal) ────────────────────────────────────
  trophyBadge: {
    width: '47%',
    minHeight: 130,
    borderRadius: borderRadius['2xl'],
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[2],
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 6,
  },
  trophyBadgeCustom: {
    backgroundColor: 'rgba(255,251,235,0.95)',
    shadowOpacity: 0.22,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 10,
    elevation: 4,
  },
  trophyIcon: { fontSize: 36 },
  trophyName: { fontSize: 12, fontWeight: '700', textAlign: 'center', lineHeight: 15 },
  trophyDesc: { fontSize: 10, textAlign: 'center', lineHeight: 13, marginTop: 2 },

  emptyTrophy: {
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
    borderRadius: borderRadius.xl,
    borderWidth: 1,
  },
  emptyTrophyText: { fontSize: 12 },

  // ── Quick actions sticky bar ───────────────────────────────────────
  actionsBar: {
    position: 'absolute',
    left: spacing[4],
    right: spacing[4],
    padding: spacing[2],
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-around',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
    elevation: 6,
  },
  actionBtn: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  actionIconBox: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 4,
  },
  actionLabel: { fontSize: 10, fontWeight: '600' },

  // ── Achievements modal ─────────────────────────────────────────────
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[6],
    maxHeight: '88%',
  },
  modalHandle: {
    alignSelf: 'center',
    width: 38,
    height: 5,
    borderRadius: 3,
    marginTop: 8,
    marginBottom: 4,
    opacity: 0.5,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing[2],
    marginBottom: spacing[2],
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  modalClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalScroll: {
    paddingBottom: spacing[6],
    gap: spacing[3],
  },
  modalSection: {
    gap: spacing[2],
  },
  modalSectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  trophyGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[2],
  },
  modalAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: spacing[4],
    paddingVertical: 14,
    borderRadius: borderRadius.xl,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    marginTop: spacing[2],
  },
  modalAddBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
});
