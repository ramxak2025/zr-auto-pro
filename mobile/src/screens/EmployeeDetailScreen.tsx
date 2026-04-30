/**
 * EmployeeDetailScreen — full profile of a single staff member, mirrors the
 * web EmployeeDetailPage. Sections: hero / today / earnings / ranking /
 * quick links / contact.
 */
import React, { useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { usersApi, scheduleApi, salaryApi, checksApi } from '../api/services';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import type {
  User, TodayEmployeeStatus, MasterSalary, EmployeeRanking,
} from '../../../shared/types';
import { roleLabels } from '../../../shared/utils/formatters';

type RouteParams = { EmployeeDetail: { id: string } };

const ROLE_BADGE: Record<string, { bg: string; text: string }> = {
  superadmin: { bg: colors.red[50], text: colors.red[700] },
  director: { bg: colors.purple[50], text: colors.purple[700] },
  admin: { bg: colors.blue[50], text: colors.blue[700] },
  master: { bg: colors.green[50], text: colors.green[700] },
};

const formatMoney = (v: number): string =>
  Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽';

const formatTime = (iso?: string | null): string => {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
};

function statusBadge(s?: TodayEmployeeStatus): { text: string; bg: string; fg: string } {
  if (!s) return { text: 'Нет данных', bg: colors.gray[100], fg: colors.gray[600] };
  const note = (s.note || '').toLowerCase();
  if (note.includes('больнич')) return { text: 'Больничный', bg: colors.rose[50], fg: colors.rose[700] };
  if (s.isDayOff) return { text: 'Выходной', bg: colors.gray[100], fg: colors.gray[600] };
  if (s.lateStatus === 'late_major') return { text: `Опозд. >1 ч (${s.lateMinutes} мин)`, bg: colors.orange[50], fg: colors.orange[700] };
  if (s.lateStatus === 'late_minor') return { text: `Опозд. ${s.lateMinutes} мин`, bg: colors.yellow[50], fg: colors.yellow[800] };
  if (s.isWorking || s.actualArrival || s.lateStatus === 'on_time') return { text: 'На смене', bg: colors.green[50], fg: colors.green[700] };
  if (note.includes('прогул')) return { text: 'Прогул', bg: colors.red[50], fg: colors.red[700] };
  if (s.hasSchedule) return { text: 'Не пришёл', bg: colors.red[50], fg: colors.red[700] };
  return { text: '—', bg: colors.gray[100], fg: colors.gray[600] };
}

export default function EmployeeDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<RouteParams, 'EmployeeDetail'>>();
  const id = route.params?.id;
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = React.useState(false);

  const { data: user, isLoading } = useQuery<User>({
    queryKey: ['user', id],
    queryFn: async () => { const res = await usersApi.getById(id); return res.data; },
    enabled: !!id,
    staleTime: 60_000,
  });

  const { data: todayList } = useQuery<TodayEmployeeStatus[]>({
    queryKey: ['schedule-today'],
    queryFn: async () => { const res = await scheduleApi.getToday(); return res.data; },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const today = (todayList ?? []).find((t) => t.userId === id);

  const { data: salaryRows } = useQuery<MasterSalary[]>({
    queryKey: ['salary-all'],
    queryFn: async () => { const res = await salaryApi.getAll(); return res.data; },
    enabled: !!user && user.role === 'master',
    staleTime: 60_000,
  });
  const salary = salaryRows?.find((m) => m.masterId === id);

  const { data: ranking } = useQuery<EmployeeRanking>({
    queryKey: ['employee-ranking'],
    queryFn: async () => { const res = await checksApi.getRanking(); return res.data; },
    staleTime: 60_000,
  });

  const rank = useMemo(() => {
    if (!ranking || !user || user.role !== 'master') return null;
    const monthSorted = [...(ranking.month ?? [])].sort((a, b) => b.revenue - a.revenue);
    const todaySorted = [...(ranking.today ?? [])].sort((a, b) => b.revenue - a.revenue);
    const monthIdx = monthSorted.findIndex((r) => r.masterId === id);
    const todayIdx = todaySorted.findIndex((r) => r.masterId === id);
    return {
      monthPlace: monthIdx >= 0 ? monthIdx + 1 : null,
      monthTotal: monthSorted.length,
      monthRevenue: monthIdx >= 0 ? monthSorted[monthIdx].revenue : 0,
      monthChecks: monthIdx >= 0 ? monthSorted[monthIdx].checkCount : 0,
      todayPlace: todayIdx >= 0 ? todayIdx + 1 : null,
      todayTotal: todaySorted.length,
    };
  }, [ranking, user, id]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['user', id] }),
      queryClient.invalidateQueries({ queryKey: ['schedule-today'] }),
      queryClient.invalidateQueries({ queryKey: ['salary-all'] }),
      queryClient.invalidateQueries({ queryKey: ['employee-ranking'] }),
    ]);
    setRefreshing(false);
  };

  if (isLoading) return <LoadingSpinner />;
  if (!user) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <EmptyState title="Сотрудник не найден" description="Возможно учётка удалена или у вас нет к ней доступа." />
      </SafeAreaView>
    );
  }

  const initials = user.fullName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const role = ROLE_BADGE[user.role] || ROLE_BADGE.master;
  const sb = statusBadge(today);
  const medal = (place: number) => place === 1 ? '🥇' : place === 2 ? '🥈' : place === 3 ? '🥉' : '';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={20} color={colors.primary[600]} />
        </TouchableOpacity>
        <Text style={styles.topTitle}>Сотрудник</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />}
      >
        {/* Hero */}
        <LinearGradient
          colors={['#0f172a', '#1e3a8a', '#0f172a'] as [string, string, string]}
          style={styles.hero}
        >
          <View style={styles.heroRow}>
            <View style={styles.heroAvatar}>
              <Text style={styles.heroInitials}>{initials}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.heroName} numberOfLines={1}>{user.fullName}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[1.5], marginTop: 8, flexWrap: 'wrap' }}>
                <View style={[styles.heroBadge, { backgroundColor: role.bg }]}>
                  <Text style={[styles.heroBadgeText, { color: role.text }]}>
                    {roleLabels[user.role] || user.role}
                  </Text>
                </View>
                <View style={[styles.heroBadge, { backgroundColor: sb.bg }]}>
                  <Text style={[styles.heroBadgeText, { color: sb.fg }]}>{sb.text}</Text>
                </View>
              </View>
            </View>
          </View>
        </LinearGradient>

        {/* Today */}
        <Section icon="time-outline" title="Сегодня">
          <View style={styles.tilesRow}>
            <Tile
              label="Смена"
              value={today?.shiftStart && today?.shiftEnd
                ? `${formatTime(today.shiftStart)} – ${formatTime(today.shiftEnd)}`
                : today?.isDayOff ? 'Выходной' : '—'}
            />
            <Tile label="Пришёл" value={today?.actualArrival ? formatTime(today.actualArrival) : '—'} />
            <Tile
              label="Опоздание"
              value={today && today.lateMinutes > 0 ? `${today.lateMinutes} мин` : '—'}
            />
          </View>
          {today?.note ? (
            <View style={styles.note}>
              <Text style={styles.noteText}>{today.note}</Text>
            </View>
          ) : null}
        </Section>

        {/* Salary */}
        {user.role === 'master' && salary && (
          <Section icon="wallet-outline" title="Заработок (период)">
            <View style={styles.tilesGrid}>
              <Tile label="Заработано" value={formatMoney(salary.totalEarnings ?? 0)} highlight />
              <Tile label="Выручка" value={formatMoney(salary.totalRevenue ?? 0)} highlight />
              <Tile label="Чеков" value={String(salary.checkCount ?? 0)} />
              <Tile label="К выплате" value={formatMoney(salary.remainingAmount ?? 0)} />
            </View>
            {(salary.serviceEarnings != null || salary.productEarnings != null) && (
              <View style={[styles.tilesGrid, { marginTop: spacing[2] }]}>
                {salary.serviceEarnings != null && (
                  <Tile label="С услуг" value={formatMoney(salary.serviceEarnings)} />
                )}
                {salary.productEarnings != null && (
                  <Tile label="С товаров" value={formatMoney(salary.productEarnings)} />
                )}
              </View>
            )}
          </Section>
        )}

        {/* Ranking */}
        {user.role === 'master' && rank && (rank.monthPlace || rank.todayPlace) && (
          <Section icon="trophy-outline" title="Рейтинг">
            <View style={styles.tilesGrid}>
              {rank.todayPlace ? (
                <Tile
                  label="Сегодня"
                  value={`${rank.todayPlace} / ${rank.todayTotal}`}
                  hint={medal(rank.todayPlace)}
                />
              ) : <View style={{ flex: 1 }} />}
              {rank.monthPlace ? (
                <Tile
                  label="Месяц"
                  value={`${rank.monthPlace} / ${rank.monthTotal}`}
                  hint={medal(rank.monthPlace)}
                />
              ) : <View style={{ flex: 1 }} />}
            </View>
            {rank.monthPlace ? (
              <Text style={styles.rankSub}>
                Выручка за месяц: <Text style={styles.rankNum}>{formatMoney(rank.monthRevenue)}</Text>
                {'   ·   '}
                Чеков: <Text style={styles.rankNum}>{rank.monthChecks}</Text>
              </Text>
            ) : null}
          </Section>
        )}

        {/* Contact */}
        <Section icon="call-outline" title="Контакт и условия">
          <View style={styles.contactCard}>
            <ContactRow icon="call-outline" label="Телефон" value={user.phone || '—'} />
            {!!user.username && <ContactRow icon="at-outline" label="Логин" value={user.username} />}
            <ContactRow icon="shield-outline" label="Доля с услуг" value={`${user.salaryPercent || 0}%`} />
            {typeof user.productSalaryPercent === 'number' && (
              <ContactRow icon="shield-outline" label="Доля с товаров" value={`${user.productSalaryPercent}%`} />
            )}
            {user.daysOff && user.daysOff.length > 0 && (
              <ContactRow
                icon="calendar-outline"
                label="Выходные"
                value={user.daysOff.map((d) => ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'][d] || '?').join(', ')}
              />
            )}
          </View>
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Section primitives ─────────────────────────────────────────────────────

function Section({ icon, title, children }: { icon: any; title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Ionicons name={icon} size={14} color={colors.gray[400]} />
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

function Tile({
  label, value, highlight, hint,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  hint?: string;
}) {
  return (
    <View style={[styles.tile, highlight ? styles.tileHighlight : styles.tileBase]}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={[styles.tileValue, highlight ? styles.tileValueHighlight : null]} numberOfLines={1}>
        {value}{hint ? `  ${hint}` : ''}
      </Text>
    </View>
  );
}

function ContactRow({ icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <View style={styles.contactRow}>
      <Ionicons name={icon} size={16} color={colors.gray[400]} />
      <Text style={styles.contactLabel}>{label}</Text>
      <Text style={styles.contactValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.gray[50] },
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing[4], paddingVertical: spacing[3],
    borderBottomWidth: 1, borderBottomColor: colors.gray[100], backgroundColor: colors.white,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary[50],
    alignItems: 'center', justifyContent: 'center',
  },
  topTitle: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.gray[900] },
  scroll: { padding: spacing[4], paddingBottom: spacing[8], gap: spacing[3] },

  hero: {
    borderRadius: borderRadius['3xl'], padding: spacing[5], overflow: 'hidden',
  },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  heroAvatar: {
    width: 72, height: 72, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.20)',
    alignItems: 'center', justifyContent: 'center',
  },
  heroInitials: { color: colors.white, fontSize: fontSize.xl, fontWeight: fontWeight.bold },
  heroName: { color: colors.white, fontSize: fontSize.xl, fontWeight: fontWeight.bold },
  heroBadge: {
    paddingHorizontal: spacing[2.5], paddingVertical: 3,
    borderRadius: borderRadius.full,
  },
  heroBadgeText: { fontSize: 11, fontWeight: fontWeight.semibold },

  section: {
    backgroundColor: colors.white, borderRadius: borderRadius['2xl'],
    borderWidth: 1, borderColor: colors.gray[100],
    padding: spacing[4],
  },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: spacing[1.5],
    marginBottom: spacing[3],
  },
  sectionTitle: {
    fontSize: 11, fontWeight: fontWeight.bold, color: colors.gray[400],
    textTransform: 'uppercase', letterSpacing: 0.8,
  },

  tilesRow: { flexDirection: 'row', gap: spacing[2] },
  tilesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  tile: {
    flexBasis: '48%', flexGrow: 1,
    paddingHorizontal: spacing[3], paddingVertical: spacing[2.5],
    borderRadius: borderRadius.xl, borderWidth: 1,
  },
  tileBase: { backgroundColor: colors.gray[50], borderColor: colors.gray[100] },
  tileHighlight: { backgroundColor: '#EFF6FF', borderColor: '#DBEAFE' },
  tileLabel: {
    fontSize: 10, color: colors.gray[400],
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2,
  },
  tileValue: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  tileValueHighlight: { color: colors.blue[700] },

  note: {
    marginTop: spacing[3],
    backgroundColor: colors.amber[50], borderWidth: 1, borderColor: colors.amber[100],
    paddingHorizontal: spacing[3], paddingVertical: spacing[2], borderRadius: borderRadius.lg,
  },
  noteText: { fontSize: 12, color: colors.amber[800] },

  rankSub: { marginTop: spacing[2], fontSize: 12, color: colors.gray[500] },
  rankNum: { fontWeight: fontWeight.semibold, color: colors.gray[900] },

  contactCard: {
    borderWidth: 1, borderColor: colors.gray[100], borderRadius: borderRadius.xl,
    overflow: 'hidden',
  },
  contactRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing[3],
    paddingHorizontal: spacing[4], paddingVertical: spacing[3],
    borderTopWidth: 1, borderTopColor: colors.gray[100],
  },
  contactLabel: { fontSize: 12, color: colors.gray[500], flex: 1 },
  contactValue: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[900] },
});
