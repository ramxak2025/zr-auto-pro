/**
 * EmployeeDetailScreen — "character card" full profile of a single
 * staff member. Game-like polish on top of Apple HIG: rank gradient
 * hero, animated 5-axis radar, streak chips, trophy case, year heatmap,
 * service mastery, lifetime stats, team rank, career timeline.
 *
 * Data source — `employeesApi.fullProfile()` returns the composite blob
 * documented in `EmployeeFullProfile`. The legacy `today` (per-day
 * status) is still pulled from `scheduleApi.getToday()` because the
 * full-profile blob doesn't carry attendance signals.
 *
 * Permissions:
 *   • base hero/radar/streaks/trophies/heatmap — visible to anyone who
 *     can open the page (gated upstream — only directors / admins land
 *     here from the employees list);
 *   • the "Owner-only" block (notes / documents / edit profile / award)
 *     is rendered only when `isOwnerLike` (admin/director/superadmin).
 *
 * Bug fix:
 *   The previous version called `new Date(shiftStart)` on "HH:mm"
 *   strings (the column is TEXT in DB), which produced
 *   "Invalid Date – Inva…" in the shift column. `formatHM` below
 *   handles both ISO timestamps and plain `HH:mm` values.
 */
import React, { useCallback, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Easing,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Image as ExpoImage } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  RouteProp,
  useFocusEffect,
  useNavigation,
  useRoute,
} from '@react-navigation/native';
import { employeesApi, scheduleApi, usersApi } from '../api/services';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';
import IosScreenHeader from '../components/IosScreenHeader';
import { useAuth } from '../contexts/AuthContext';
import { useColors } from '../contexts/ThemeContext';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { haptic } from '../platform/haptics';
import { Text } from '../platform/Typography';
import type {
  EmployeeFullProfile,
  EmployeeAchievement,
  TodayEmployeeStatus,
  User,
} from '../../../shared/types';
import { roleLabels } from '../../../shared/utils/formatters';
import { StatsRadar } from '../components/employee/StatsRadar';
import { YearHeatmap } from '../components/employee/YearHeatmap';
import { ShareCardModal } from '../components/employee/ShareCardModal';
import { EditProfileModal } from '../components/employee/EditProfileModal';
import { AwardAchievementModal } from '../components/employee/AwardAchievementModal';
import {
  rankFromLifetime,
  progressToNextRank,
  rankLabelUpper,
  SERVICE_TIER_COLOR,
} from '../components/employee/rank';

type RouteParams = { EmployeeDetail: { id: string } };

// ── Formatters ────────────────────────────────────────────────────────────
const formatMoney = (v: number): string =>
  Math.round(v)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽';

const formatMoneyShort = (v: number): string => {
  const n = Math.round(v);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M ₽`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k ₽`;
  return `${n} ₽`;
};

/**
 * Accepts both ISO timestamps (actualArrival) and plain "HH:mm" strings
 * (shiftStart/shiftEnd stored as TEXT in DB). Falls back to "—".
 */
const formatHM = (raw?: string | null): string => {
  if (!raw) return '—';
  // "HH:mm" plain — return as-is (with a thin space for readability).
  const hm = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (hm) {
    const h = hm[1].padStart(2, '0');
    return `${h}:${hm[2]}`;
  }
  // Otherwise parse as Date — ISO/RFC.
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
};

const formatDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' });

function statusBadge(s?: TodayEmployeeStatus): { text: string; bg: string; fg: string } {
  if (!s) return { text: '—', bg: 'rgba(255,255,255,0.18)', fg: '#fff' };
  const note = (s.note || '').toLowerCase();
  if (note.includes('больнич')) return { text: 'Б/Л', bg: 'rgba(244,114,182,0.30)', fg: '#fff' };
  if (s.isDayOff) return { text: 'Выходной', bg: 'rgba(255,255,255,0.18)', fg: '#fff' };
  if (s.lateStatus === 'late_major') return { text: `Опоздал +${s.lateMinutes}'`, bg: 'rgba(248,113,113,0.34)', fg: '#fff' };
  if (s.lateStatus === 'late_minor') return { text: `Опоздал +${s.lateMinutes}'`, bg: 'rgba(251,191,36,0.34)', fg: '#fff' };
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
  const { user: viewer } = useAuth();
  const palette = useColors();
  const tabBarHeight = useTabBarHeight();

  const isSelf = !!viewer && viewer.id === id;
  const isOwnerLike =
    viewer?.role === 'director' || viewer?.role === 'superadmin' || viewer?.role === 'admin';

  // ── Full profile from the new endpoint ───────────────────────────────
  const {
    data: full,
    isLoading,
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

  // ── Owner notes — saved on blur ──────────────────────────────────────
  const [notesDraft, setNotesDraft] = useState<string>('');
  React.useEffect(() => {
    setNotesDraft(full?.profile.ownerNotes ?? '');
  }, [full?.profile.ownerNotes]);
  const saveNotes = useMutation({
    mutationFn: () =>
      employeesApi.update(id, { ownerNotes: notesDraft }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employee-full-profile', id] });
      haptic('success');
    },
  });

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

  // ── Period switch for FINANCES section ───────────────────────────────
  const [period, setPeriod] = useState<'week' | 'month' | 'year'>('month');

  const onRefresh = async () => {
    await Promise.all([refetch(), queryClient.invalidateQueries({ queryKey: ['schedule-today'] })]);
  };

  if (isLoading || !full) {
    if (isLoading) return <LoadingSpinner />;
    return (
      <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
        <IosScreenHeader title="Сотрудник" onBack={() => navigation.goBack()} />
        <EmptyState title="Сотрудник не найден" description="Возможно учётка удалена или у вас нет к ней доступа." />
      </View>
    );
  }

  const { profile, stats, streaks, lifetime, yearHeatmap, teamRank, serviceMastery, careerTimeline, achievements } = full;

  // ── Rank derivation ──────────────────────────────────────────────────
  const rankInfo = rankFromLifetime(lifetime.totalRevenue, lifetime.totalChecks);
  const rankProgress = progressToNextRank(rankInfo, lifetime.totalRevenue);

  const className =
    profile.customTitle?.trim() ||
    profile.positionTitle?.trim() ||
    roleLabels[profile.role] ||
    profile.role;
  const initials = getInitials(profile.fullName);
  const status = statusBadge(today);

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
    streakDays: streaks.disciplineStreak,
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
  const goSchedule = () => {
    haptic('tap');
    navigation.navigate('Main', { screen: 'MoreTab', params: { screen: 'Schedule' } });
  };
  const goSalary = () => {
    haptic('tap');
    navigation.navigate('Main', { screen: 'MoreTab', params: { screen: 'Salary' } });
  };

  // ── Period totals (computed locally from year heatmap) ───────────────
  // We use the real `salaryPercent` from the User record when available
  // — falling back to 30% (typical autoservice baseline) only when the
  // viewer can't see that field. Better an honest "computed share" than
  // a hand-waved number.
  const sharePct = (userRecord?.salaryPercent ?? 30) / 100;
  const periodTotals = computePeriodTotals(yearHeatmap, period, sharePct);

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

        {/* ── STATS RADAR ─────────────────────────────────────────────── */}
        <Card palette={palette}>
          <CardHeader icon="pulse-outline" title="Характеристики" palette={palette} />
          <StatsRadar
            values={[
              { value: stats.efficiency, label: 'Эффективность' },
              { value: stats.discipline, label: 'Дисциплина' },
              { value: stats.activity, label: 'Активность' },
              { value: stats.rating, label: 'Рейтинг' },
              { value: stats.quality, label: 'Качество' },
            ]}
            accent={rankInfo.accent}
            textColor={palette.text.secondary}
          />
        </Card>

        {/* ── STREAKS ─────────────────────────────────────────────────── */}
        {(streaks.disciplineStreak > 0 || streaks.fiveStarStreak > 0 || streaks.checksStreak > 0) && (
          <View style={styles.streaksRow}>
            {streaks.disciplineStreak > 0 && (
              <StreakChip icon="🔥" value={streaks.disciplineStreak} label="дней без опозданий" palette={palette} />
            )}
            {streaks.fiveStarStreak > 0 && (
              <StreakChip icon="🎯" value={streaks.fiveStarStreak} label="чеков с 5★" palette={palette} />
            )}
            {streaks.checksStreak > 0 && (
              <StreakChip icon="💎" value={streaks.checksStreak} label="активных дней" palette={palette} />
            )}
          </View>
        )}

        {/* ── TROPHY CASE ─────────────────────────────────────────────── */}
        <Card palette={palette}>
          <CardHeader icon="trophy-outline" title="Достижения" palette={palette} />
          <TrophyCase
            achievements={achievements}
            isOwnerLike={isOwnerLike}
            onAdd={() => setAwardOpen(true)}
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
        </Card>

        {/* ── СЕГОДНЯ ──────────────────────────────────────────────────── */}
        <Card palette={palette}>
          <CardHeader icon="time-outline" title="Сегодня" palette={palette} />
          <TodayBlock today={today} palette={palette} />
        </Card>

        {/* ── ФИНАНСЫ (period switcher) ──────────────────────────────── */}
        {isOwnerLike || isSelf ? (
          <Card palette={palette}>
            <CardHeader icon="wallet-outline" title="Финансы" palette={palette} />
            <PeriodSwitcher value={period} onChange={setPeriod} palette={palette} />
            <View style={[styles.tilesGrid, { marginTop: spacing[3] }]}>
              <MetricTile label="Заработано" value={formatMoneyShort(periodTotals.earnings)} highlight palette={palette} />
              <MetricTile label="Выручка" value={formatMoneyShort(periodTotals.revenue)} highlight palette={palette} />
              <MetricTile label="К выплате" value={formatMoneyShort(periodTotals.toPay)} palette={palette} />
              <MetricTile label="Чеков" value={String(periodTotals.checks)} palette={palette} />
            </View>
            <Sparkline values={periodTotals.spark} accent={rankInfo.accent} palette={palette} />
          </Card>
        ) : null}

        {/* ── SERVICE MASTERY ─────────────────────────────────────────── */}
        {serviceMastery.length > 0 && (
          <Card palette={palette}>
            <CardHeader icon="construct-outline" title="Мастерство" palette={palette} />
            <View style={{ gap: spacing[2] }}>
              {serviceMastery.slice(0, 5).map((s) => {
                const tier = SERVICE_TIER_COLOR[s.tier];
                return (
                  <View
                    key={s.serviceId}
                    style={[styles.masteryRow, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
                  >
                    <View style={[styles.masteryIcon, { backgroundColor: tier.bg }]}>
                      <Ionicons name="hammer" size={16} color={tier.fg} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[styles.masteryName, { color: palette.text.primary }]} numberOfLines={1}>
                        {s.name}
                      </Text>
                      <Text style={[styles.masterySub, { color: palette.text.tertiary }]}>{s.count} выполнено</Text>
                    </View>
                    <View style={[styles.tierBadge, { backgroundColor: tier.bg }]}>
                      <Text style={[styles.tierBadgeText, { color: tier.fg }]}>{s.tier.toUpperCase()}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          </Card>
        )}

        {/* ── LIFETIME ────────────────────────────────────────────────── */}
        <Card palette={palette}>
          <CardHeader icon="infinite-outline" title="За всё время" palette={palette} />
          <View style={styles.lifetimeGrid}>
            <LifeStat label="Чеков" value={String(lifetime.totalChecks)} palette={palette} />
            <LifeStat label="Выручка" value={formatMoneyShort(lifetime.totalRevenue)} palette={palette} />
            <LifeStat label="Клиентов" value={String(lifetime.clientsServed)} palette={palette} />
          </View>
          {lifetime.bestDay && (
            <Text style={[styles.lifeNote, { color: palette.text.secondary }]}>
              Лучший день:{' '}
              <Text style={{ color: palette.text.primary, fontWeight: '600' }}>
                {formatDate(lifetime.bestDay.date)}
              </Text>{' '}
              · <Text style={{ color: palette.text.primary, fontWeight: '600' }}>{formatMoney(lifetime.bestDay.value)}</Text>
            </Text>
          )}
          {lifetime.bestMonth && (
            <Text style={[styles.lifeNote, { color: palette.text.secondary }]}>
              Лучший месяц:{' '}
              <Text style={{ color: palette.text.primary, fontWeight: '600' }}>{lifetime.bestMonth.ym}</Text> ·{' '}
              <Text style={{ color: palette.text.primary, fontWeight: '600' }}>{formatMoney(lifetime.bestMonth.value)}</Text>
            </Text>
          )}
          {lifetime.topCarBrands.length > 0 && (
            <View style={[styles.brandsRow, { marginTop: spacing[3] }]}>
              {lifetime.topCarBrands.slice(0, 3).map((b) => (
                <View
                  key={b.brand}
                  style={[styles.brandChip, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
                >
                  <Ionicons name="car-sport-outline" size={12} color={palette.text.tertiary} />
                  <Text style={[styles.brandText, { color: palette.text.primary }]}>{b.brand}</Text>
                  <Text style={[styles.brandCount, { color: palette.text.tertiary }]}>{b.count}</Text>
                </View>
              ))}
            </View>
          )}
        </Card>

        {/* ── YEAR HEATMAP ────────────────────────────────────────────── */}
        {yearHeatmap.length > 0 && (
          <Card palette={palette}>
            <CardHeader icon="grid-outline" title="Год активности" palette={palette} />
            <YearHeatmap data={yearHeatmap} accent={rankInfo.accent} />
          </Card>
        )}

        {/* ── TEAM RANK ──────────────────────────────────────────────── */}
        {teamRank.total > 0 && <TeamRank teamRank={teamRank} palette={palette} />}

        {/* ── CAREER TIMELINE ────────────────────────────────────────── */}
        {careerTimeline.length > 0 && (
          <Card palette={palette}>
            <CardHeader icon="footsteps-outline" title="Карьера" palette={palette} />
            <View style={{ gap: spacing[3] }}>
              {careerTimeline.map((e, idx) => (
                <TimelineRow key={idx} event={e} palette={palette} />
              ))}
            </View>
          </Card>
        )}

        {/* ── OWNER-ONLY: documents ─────────────────────────────────── */}
        {isOwnerLike && (
          <Card palette={palette}>
            <CardHeader icon="document-attach-outline" title="Документы" palette={palette} />
            <Documents employeeId={id} palette={palette} />
          </Card>
        )}

        {/* ── OWNER-ONLY: notes ─────────────────────────────────────── */}
        {isOwnerLike && (
          <Card palette={palette}>
            <CardHeader icon="lock-closed-outline" title="Только для владельца" palette={palette} />
            <Text style={[styles.fieldLabel, { color: palette.text.tertiary, marginTop: 0 }]}>Заметки</Text>
            <TextInput
              value={notesDraft}
              onChangeText={setNotesDraft}
              onBlur={() => {
                if ((profile.ownerNotes ?? '') !== notesDraft) saveNotes.mutate();
              }}
              multiline
              numberOfLines={4}
              placeholder="Личные заметки о сотруднике…"
              placeholderTextColor={palette.text.tertiary}
              style={[
                styles.notesInput,
                {
                  borderColor: palette.border.subtle,
                  backgroundColor: palette.bg.muted,
                  color: palette.text.primary,
                },
              ]}
            />
            <Text style={[styles.notesHint, { color: palette.text.tertiary }]}>
              Сохраняется автоматически после редактирования. Видно только владельцу/директору.
            </Text>
          </Card>
        )}
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
        <ActionBtn icon="logo-whatsapp" label="WhatsApp" onPress={goWhatsapp} palette={palette} accent={colors.green[600]} />
        <ActionBtn icon="calendar" label="График" onPress={goSchedule} palette={palette} />
        {isOwnerLike && <ActionBtn icon="wallet" label="Зарплата" onPress={goSalary} palette={palette} />}
      </View>

      <ShareCardModal visible={shareOpen} onClose={() => setShareOpen(false)} data={shareData} />
      <EditProfileModal visible={editOpen} onClose={() => setEditOpen(false)} profile={profile} />
      <AwardAchievementModal visible={awardOpen} onClose={() => setAwardOpen(false)} employeeId={id} />
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

function StreakChip({
  icon,
  value,
  label,
  palette,
}: {
  icon: string;
  value: number;
  label: string;
  palette: Palette;
}) {
  return (
    <View style={[styles.streakChip, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
      <Text style={styles.streakIcon}>{icon}</Text>
      <Text style={[styles.streakVal, { color: palette.text.primary }]}>{value}</Text>
      <Text style={[styles.streakLabel, { color: palette.text.secondary }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function TrophyCase({
  achievements,
  isOwnerLike,
  onAdd,
  onLongPress,
  palette,
}: {
  achievements: EmployeeAchievement[];
  isOwnerLike: boolean;
  onAdd: () => void;
  onLongPress: (a: EmployeeAchievement) => void;
  palette: Palette;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingVertical: spacing[1], paddingRight: spacing[2], gap: spacing[2] }}
    >
      {achievements.map((a) => (
        <TouchableOpacity
          key={a.id}
          activeOpacity={0.85}
          onLongPress={() => onLongPress(a)}
          delayLongPress={400}
          style={[
            styles.trophyBadge,
            a.type === 'custom'
              ? { borderColor: a.color || colors.amber[600], shadowColor: a.color || colors.amber[600] }
              : { borderColor: palette.border.subtle, backgroundColor: palette.bg.muted },
            a.type === 'custom' && styles.trophyBadgeCustom,
          ]}
        >
          <Text style={styles.trophyIcon}>{a.icon || '🏆'}</Text>
          <Text
            style={[
              styles.trophyName,
              { color: a.type === 'custom' ? colors.gray[900] : palette.text.primary },
            ]}
            numberOfLines={2}
          >
            {a.name}
          </Text>
        </TouchableOpacity>
      ))}
      {isOwnerLike && (
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={onAdd}
          style={[styles.trophyAdd, { borderColor: palette.border.subtle }]}
        >
          <Ionicons name="add" size={22} color={palette.text.tertiary} />
          <Text style={[styles.trophyAddText, { color: palette.text.tertiary }]}>Выдать</Text>
        </TouchableOpacity>
      )}
      {achievements.length === 0 && !isOwnerLike && (
        <View style={[styles.emptyTrophy, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}>
          <Text style={[styles.emptyTrophyText, { color: palette.text.tertiary }]}>Достижений пока нет</Text>
        </View>
      )}
    </ScrollView>
  );
}

function TodayBlock({ today, palette }: { today?: TodayEmployeeStatus; palette: Palette }) {
  // ── Shift + arrival ──────────────────────────────────────────────────
  // Bug fix: shiftStart/shiftEnd from backend are "HH:mm" strings (TEXT
  // column), so we route them through formatHM() instead of
  // `new Date(...).toLocaleTimeString(...)`.
  const startStr = formatHM(today?.shiftStart);
  const endStr = formatHM(today?.shiftEnd);
  const arrival = today?.actualArrival ? formatHM(today.actualArrival) : '—';

  // ── Shift progress (timer) ───────────────────────────────────────────
  const progress = computeShiftProgress(today);

  return (
    <View>
      {progress ? (
        <View style={[styles.shiftCard, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.shiftCardLabel, { color: palette.text.tertiary }]}>Идёт смена</Text>
            <Text style={[styles.shiftCardTimer, { color: palette.text.primary }]}>
              {formatHmDuration(progress.elapsedMs)}
            </Text>
            <Text style={[styles.shiftCardSub, { color: palette.text.secondary }]}>{`${startStr} – ${endStr}`}</Text>
          </View>
          <ShiftProgressRing progress={progress.ratio} />
        </View>
      ) : null}

      <View style={styles.tilesRow}>
        <MetricTile
          label="Смена"
          value={today?.shiftStart && today?.shiftEnd ? `${startStr} – ${endStr}` : today?.isDayOff ? 'Выходной' : '—'}
          palette={palette}
        />
        <MetricTile label="Пришёл" value={arrival} palette={palette} />
        <MetricTile
          label="Опоздание"
          value={today && today.lateMinutes > 0 ? `${today.lateMinutes} мин` : '—'}
          palette={palette}
        />
      </View>
      {today?.note ? (
        <View style={styles.todayNote}>
          <Text style={styles.todayNoteText}>{today.note}</Text>
        </View>
      ) : null}
    </View>
  );
}

function ShiftProgressRing({ progress }: { progress: number }) {
  // Reuse a CSS-style outer ring with a coloured arc using two simple Views
  // — keep it lightweight (no SVG/animation) since this is a small badge.
  const pct = Math.max(0, Math.min(1, progress));
  const rotation = pct * 360;
  return (
    <View style={styles.ringWrap}>
      <View style={styles.ringTrack} />
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
      <Text style={[styles.tileValue, { color: highlight ? colors.blue[700] : palette.text.primary }]} numberOfLines={1}>
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

function TeamRank({
  teamRank,
  palette,
}: {
  teamRank: EmployeeFullProfile['teamRank'];
  palette: Palette;
}) {
  const [expanded, setExpanded] = useState(false);
  const medal = (place: number) => (place === 1 ? '🥇' : place === 2 ? '🥈' : place === 3 ? '🥉' : '🏅');
  return (
    <Card palette={palette}>
      <CardHeader icon="medal-outline" title="Рейтинг в команде" palette={palette} />
      <Pressable onPress={() => setExpanded((v) => !v)}>
        <View style={styles.teamRow}>
          <TeamCell icon={medal(teamRank.revenueRank)} place={teamRank.revenueRank} total={teamRank.total} label="по выручке" palette={palette} />
          <TeamCell icon={medal(teamRank.disciplineRank)} place={teamRank.disciplineRank} total={teamRank.total} label="по дисциплине" palette={palette} />
          <TeamCell icon={medal(teamRank.ratingRank)} place={teamRank.ratingRank} total={teamRank.total} label="по рейтингу" palette={palette} />
        </View>
        {expanded && (
          <View style={[styles.teamExpanded, { borderColor: palette.border.subtle }]}>
            <Text style={[styles.teamExpandedText, { color: palette.text.secondary }]}>
              Команда из {teamRank.total} сотрудников. Места считаются по совокупности активности за период (выручка, чеки,
              явка). Чем меньше число — тем выше позиция.
            </Text>
          </View>
        )}
      </Pressable>
    </Card>
  );
}

function TeamCell({
  icon,
  place,
  total,
  label,
  palette,
}: {
  icon: string;
  place: number;
  total: number;
  label: string;
  palette: Palette;
}) {
  return (
    <View style={styles.teamCell}>
      <Text style={styles.teamIcon}>{icon}</Text>
      <Text style={[styles.teamPlace, { color: palette.text.primary }]}>{`#${place}`}</Text>
      <Text style={[styles.teamTotal, { color: palette.text.tertiary }]}>{`из ${total}`}</Text>
      <Text style={[styles.teamLabel, { color: palette.text.secondary }]}>{label}</Text>
    </View>
  );
}

function TimelineRow({
  event,
  palette,
}: {
  event: EmployeeFullProfile['careerTimeline'][number];
  palette: Palette;
}) {
  const iconFor = (k: string) =>
    k === 'hire' ? 'briefcase-outline' : k === 'promotion' ? 'arrow-up-circle-outline' : k === 'top_month' ? 'trophy-outline' : 'star-outline';
  return (
    <View style={styles.timelineRow}>
      <View style={[styles.timelineDot, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}>
        <Ionicons name={iconFor(event.kind) as any} size={14} color={colors.primary[600]} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.timelineTitle, { color: palette.text.primary }]} numberOfLines={1}>
          {event.title}
        </Text>
        {event.description ? (
          <Text style={[styles.timelineDesc, { color: palette.text.secondary }]} numberOfLines={2}>
            {event.description}
          </Text>
        ) : null}
        <Text style={[styles.timelineDate, { color: palette.text.tertiary }]}>{formatDate(event.date)}</Text>
      </View>
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
  // Tiny scale-on-press feel — Animated.spring keeps it on the native driver.
  const scale = useRef(new Animated.Value(1)).current;
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      onPressIn={() => Animated.spring(scale, { toValue: 0.94, useNativeDriver: true, speed: 30 }).start()}
      onPressOut={() =>
        Animated.timing(scale, { toValue: 1, duration: 140, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start()
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
}: {
  icon: any;
  label: string;
  onPress: () => void;
  palette: Palette;
}) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.6} style={styles.menuItem}>
      <Ionicons name={icon} size={18} color={palette.text.primary} />
      <Text style={[styles.menuItemText, { color: palette.text.primary }]}>{label}</Text>
    </TouchableOpacity>
  );
}

// Documents — list + upload trigger. Document uploads pick from the
// image picker (treat passports / contracts as scanned images). Tap a
// row → open the file URL externally. Long-press → delete with confirm.
function Documents({ employeeId, palette }: { employeeId: string; palette: Palette }) {
  const queryClient = useQueryClient();
  const { data: docs } = useQuery({
    queryKey: ['employee-documents', employeeId],
    queryFn: async () => (await employeesApi.documents(employeeId)).data,
    staleTime: 30_000,
  });

  const uploadMutation = useMutation({
    mutationFn: async () => {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (perm.status !== 'granted') throw new Error('Нет доступа к фото');
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.8,
      });
      if (res.canceled || !res.assets[0]) return null;
      const uri = res.assets[0].uri;
      const form = new FormData();
      const ext = uri.split('.').pop()?.toLowerCase() || 'jpg';
      form.append('file', {
        uri,
        name: `doc.${ext}`,
        type: ext === 'png' ? 'image/png' : 'image/jpeg',
      } as any);
      return employeesApi.uploadDocument(employeeId, form);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employee-documents', employeeId] });
      haptic('success');
    },
    onError: (e: any) => {
      Alert.alert('Ошибка', e?.message || 'Не удалось загрузить документ');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (docId: string) => employeesApi.deleteDocument(employeeId, docId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employee-documents', employeeId] });
      haptic('warning');
    },
    onError: (e: any) => {
      Alert.alert('Ошибка', e?.message || 'Не удалось удалить документ');
    },
  });

  return (
    <View style={{ gap: spacing[2] }}>
      {(docs ?? []).length === 0 ? (
        <Text style={[styles.notesHint, { color: palette.text.tertiary }]}>
          Документы не загружены. Сюда можно прикрепить паспорт, договор, сертификаты.
        </Text>
      ) : (
        (docs ?? []).map((d) => (
          <TouchableOpacity
            key={d.id}
            onPress={() => {
              if (d.fileUrl) Linking.openURL(d.fileUrl);
            }}
            onLongPress={() => {
              Alert.alert('Удалить документ?', d.name || d.type, [
                { text: 'Отмена', style: 'cancel' },
                {
                  text: 'Удалить',
                  style: 'destructive',
                  onPress: () => deleteMutation.mutate(d.id),
                },
              ]);
            }}
            activeOpacity={0.75}
            style={[styles.docRow, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
          >
            <View style={styles.docIconBox}>
              <Ionicons name="document-text-outline" size={18} color={colors.primary[600]} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.docName, { color: palette.text.primary }]} numberOfLines={1}>
                {d.name || d.type}
              </Text>
              <Text style={[styles.docMeta, { color: palette.text.tertiary }]} numberOfLines={1}>
                {new Date(d.uploadedAt).toLocaleDateString('ru-RU')}
                {d.expiresAt ? ` · до ${new Date(d.expiresAt).toLocaleDateString('ru-RU')}` : ''}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={14} color={palette.text.tertiary} />
          </TouchableOpacity>
        ))
      )}
      <TouchableOpacity
        onPress={() => uploadMutation.mutate()}
        activeOpacity={0.7}
        style={[styles.docUpload, { borderColor: palette.border.subtle }]}
      >
        <Ionicons name="cloud-upload-outline" size={18} color={colors.primary[600]} />
        <Text style={[styles.docUploadText, { color: colors.primary[700] }]}>
          {uploadMutation.isPending ? 'Загружаем…' : 'Добавить документ'}
        </Text>
      </TouchableOpacity>
    </View>
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

function formatHmDuration(ms: number): string {
  const totalMin = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}ч ${m}м`;
  return `${m}м`;
}

// ──────────────────────────────────────────────────────────────────────────
//  Styles
// ──────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.gray[50] },
  scroll: { padding: spacing[4], gap: spacing[3] },

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
  rankProgressLabel: { color: 'rgba(255,255,255,0.85)', fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] },

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
  cardTitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },

  // ── Streaks ─────────────────────────────────────────────────────────
  streaksRow: { flexDirection: 'row', gap: spacing[2], flexWrap: 'wrap' },
  streakChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing[3],
    paddingVertical: 10,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    flex: 1,
    minWidth: 140,
  },
  streakIcon: { fontSize: 16 },
  streakVal: { fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] },
  streakLabel: { fontSize: 11, flexShrink: 1 },

  // ── Trophy case ────────────────────────────────────────────────────
  trophyBadge: {
    width: 96,
    minHeight: 110,
    borderRadius: borderRadius['2xl'],
    paddingVertical: spacing[2.5],
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
  trophyIcon: { fontSize: 32 },
  trophyName: { fontSize: 11, fontWeight: '700', textAlign: 'center', lineHeight: 14 },
  trophyAdd: {
    width: 96,
    minHeight: 110,
    borderRadius: borderRadius['2xl'],
    paddingVertical: spacing[2.5],
    paddingHorizontal: spacing[2],
    borderWidth: 1.5,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  trophyAddText: { fontSize: 11, fontWeight: '600' },
  emptyTrophy: {
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
    borderRadius: borderRadius.xl,
    borderWidth: 1,
  },
  emptyTrophyText: { fontSize: 12 },

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

  todayNote: {
    marginTop: spacing[3],
    backgroundColor: colors.amber[50],
    borderWidth: 1,
    borderColor: colors.amber[100],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.lg,
  },
  todayNoteText: { fontSize: 12, color: colors.amber[800] },

  shiftCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[3],
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    marginBottom: spacing[2],
  },
  shiftCardLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  shiftCardTimer: { fontSize: 20, fontWeight: '800', marginTop: 2, fontVariant: ['tabular-nums'] },
  shiftCardSub: { fontSize: 12, marginTop: 1 },

  ringWrap: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  ringTrack: { position: 'absolute', width: 44, height: 44, borderRadius: 22, borderWidth: 3, borderColor: 'rgba(15,23,42,0.08)' },
  ringFill: { position: 'absolute', width: 44, height: 44, borderRadius: 22, borderWidth: 3, borderColor: 'transparent' },
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

  // ── Service mastery ────────────────────────────────────────────────
  masteryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[2.5],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
  },
  masteryIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  masteryName: { fontSize: 13, fontWeight: '700' },
  masterySub: { fontSize: 11, marginTop: 1 },
  tierBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  tierBadgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.6 },

  // ── Lifetime ───────────────────────────────────────────────────────
  lifetimeGrid: { flexDirection: 'row', gap: spacing[3], paddingVertical: spacing[1] },
  lifeStat: { flex: 1, alignItems: 'flex-start' },
  lifeStatLabel: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  lifeStatValue: { fontSize: 20, fontWeight: '800', letterSpacing: -0.6 },
  lifeNote: { fontSize: 12, marginTop: spacing[2] },

  brandsRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  brandChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  brandText: { fontSize: 12, fontWeight: '600' },
  brandCount: { fontSize: 11, fontWeight: '700' },

  // ── Team rank ──────────────────────────────────────────────────────
  teamRow: { flexDirection: 'row', gap: spacing[2] },
  teamCell: { flex: 1, alignItems: 'center', paddingVertical: spacing[2] },
  teamIcon: { fontSize: 22 },
  teamPlace: { fontSize: 18, fontWeight: '800', marginTop: 2, fontVariant: ['tabular-nums'] },
  teamTotal: { fontSize: 10, fontWeight: '600' },
  teamLabel: { fontSize: 11, marginTop: 4, textAlign: 'center' },
  teamExpanded: {
    marginTop: spacing[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing[2.5],
  },
  teamExpandedText: { fontSize: 12, lineHeight: 16 },

  // ── Timeline ───────────────────────────────────────────────────────
  timelineRow: { flexDirection: 'row', gap: spacing[3], alignItems: 'flex-start' },
  timelineDot: {
    width: 36,
    height: 36,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timelineTitle: { fontSize: 13, fontWeight: '700' },
  timelineDesc: { fontSize: 12, marginTop: 2 },
  timelineDate: { fontSize: 11, marginTop: 4, fontWeight: '600' },

  // ── Owner-only ─────────────────────────────────────────────────────
  fieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing[1.5],
  },
  notesInput: {
    fontSize: fontSize.sm,
    paddingHorizontal: spacing[3],
    paddingVertical: 10,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  notesHint: { fontSize: 11, marginTop: spacing[1.5] },

  // ── Documents ──────────────────────────────────────────────────────
  docRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: 10,
    paddingHorizontal: spacing[3],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
  },
  docIconBox: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: colors.primary[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  docName: { fontSize: 13, fontWeight: '700' },
  docMeta: { fontSize: 11, marginTop: 1 },
  docUpload: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: spacing[3],
    paddingVertical: 12,
    borderRadius: borderRadius.lg,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    justifyContent: 'center',
  },
  docUploadText: { fontSize: 13, fontWeight: '700' },

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
});
