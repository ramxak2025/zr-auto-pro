/**
 * EmployeeDetailScreen — full profile of a single staff member, mirrors the
 * web EmployeeDetailPage. Sections: hero / today / earnings / ranking /
 * quick links / contact.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect, useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { usersApi, scheduleApi, salaryApi, checksApi } from '../api/services';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';
import IosScreenHeader from '../components/IosScreenHeader';
import { useAuth } from '../contexts/AuthContext';
import { useColors } from '../contexts/ThemeContext';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import type {
  User,
  TodayEmployeeStatus,
  MasterSalary,
  EmployeeRanking,
  Check,
  PaginatedResponse,
} from '../../../shared/types';
import { roleLabels } from '../../../shared/utils/formatters';
import { TouchableOpacity } from 'react-native';

// Стабильная палитра аватаров — синхронизирована с EmployeesScreen.
// Используем хеш от имени, чтобы у одного человека всегда был один и тот же
// градиент. Это создаёт чувство «индивидуальности» карточки и ловится глазом
// при переходе между списком и деталью.
const HERO_AVATAR_PAIRS: Array<[string, string, string]> = [
  ['#3a3aff', '#1d3fff', '#0f172a'],
  ['#16a34a', '#0f6b3a', '#0f172a'],
  ['#ea580c', '#9a3412', '#0f172a'],
  ['#7c3aed', '#4338ca', '#0f172a'],
  ['#0891b2', '#155e75', '#0f172a'],
  ['#e11d48', '#9f1239', '#0f172a'],
  ['#d97706', '#92400e', '#0f172a'],
  ['#0284c7', '#075985', '#0f172a'],
];
function getHeroGradient(name?: string): [string, string, string] {
  if (!name) return HERO_AVATAR_PAIRS[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return HERO_AVATAR_PAIRS[Math.abs(hash) % HERO_AVATAR_PAIRS.length];
}

type RouteParams = { EmployeeDetail: { id: string } };

const ROLE_BADGE: Record<string, { bg: string; text: string }> = {
  superadmin: { bg: colors.red[50], text: colors.red[700] },
  director: { bg: colors.purple[50], text: colors.purple[700] },
  admin: { bg: colors.blue[50], text: colors.blue[700] },
  master: { bg: colors.green[50], text: colors.green[700] },
};

const formatMoney = (v: number): string =>
  Math.round(v)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽';

const formatTime = (iso?: string | null): string => {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
};

function statusBadge(s?: TodayEmployeeStatus): { text: string; bg: string; fg: string } {
  if (!s) return { text: 'Нет данных', bg: colors.gray[100], fg: colors.gray[600] };
  const note = (s.note || '').toLowerCase();
  if (note.includes('больнич')) return { text: 'Больничный', bg: colors.rose[50], fg: colors.rose[700] };
  if (s.isDayOff) return { text: 'Выходной', bg: colors.gray[100], fg: colors.gray[600] };
  if (s.lateStatus === 'late_major')
    return { text: `Опозд. >1 ч (${s.lateMinutes} мин)`, bg: colors.orange[50], fg: colors.orange[700] };
  if (s.lateStatus === 'late_minor')
    return { text: `Опозд. ${s.lateMinutes} мин`, bg: colors.yellow[50], fg: colors.yellow[800] };
  if (s.isWorking || s.actualArrival || s.lateStatus === 'on_time')
    return { text: 'На смене', bg: colors.green[50], fg: colors.green[700] };
  if (note.includes('прогул')) return { text: 'Прогул', bg: colors.red[50], fg: colors.red[700] };
  if (s.hasSchedule) return { text: 'Не пришёл', bg: colors.red[50], fg: colors.red[700] };
  return { text: '—', bg: colors.gray[100], fg: colors.gray[600] };
}

export default function EmployeeDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<RouteParams, 'EmployeeDetail'>>();
  const id = route.params?.id;
  const queryClient = useQueryClient();
  const { user: viewer, hasPermission } = useAuth();
  const palette = useColors();
  const [refreshing, setRefreshing] = React.useState(false);

  // ── Permission rules ────────────────────────────────────────────────
  // Финансовая инфа (зарплата, авансы, остаток к выплате, рейтинг по
  // выручке, выручка коллеги в недавних чеках, salaryPercent / productPercent)
  // показывается только:
  //   • владельцу / директору / админу;
  //   • либо сотруднику, который смотрит СВОЮ карточку (поэтому он видит
  //     свою зарплату и условия — это не утечка чужих данных).
  // Иначе — graceful empty / просто скрыто.
  const isSelf = !!viewer && viewer.id === id;
  const isOwnerLike = viewer?.role === 'director' || viewer?.role === 'superadmin' || viewer?.role === 'admin';
  const showFinancials = isOwnerLike || isSelf || hasPermission('profit_view');
  const showWorkConditions = isOwnerLike || isSelf;

  const { data: user, isLoading } = useQuery<User>({
    queryKey: ['user', id],
    queryFn: async () => {
      const res = await usersApi.getById(id);
      return res.data;
    },
    enabled: !!id,
    staleTime: 60_000,
  });

  // Pause poll when screen unfocused — see EmployeesScreen rationale.
  const [pollEnabled, setPollEnabled] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setPollEnabled(true);
      return () => setPollEnabled(false);
    }, []),
  );

  const { data: todayList } = useQuery<TodayEmployeeStatus[]>({
    queryKey: ['schedule-today'],
    queryFn: async () => {
      const res = await scheduleApi.getToday();
      return res.data;
    },
    staleTime: 30_000,
    refetchInterval: pollEnabled ? 60_000 : false,
  });
  const today = (todayList ?? []).find((t) => t.userId === id);

  const { data: salaryRows } = useQuery<MasterSalary[]>({
    queryKey: ['salary-all'],
    queryFn: async () => {
      const res = await salaryApi.getAll();
      return res.data;
    },
    // Не дёргаем эндпоинт зарплат, если у viewer-а нет прав на финансы —
    // сетевой запрос не должен светить чужой `MasterSalary[]` в Sentry/логах.
    enabled: !!user && user.role === 'master' && showFinancials,
    staleTime: 60_000,
  });
  const salary = salaryRows?.find((m) => m.masterId === id);

  const { data: ranking } = useQuery<EmployeeRanking>({
    queryKey: ['employee-ranking'],
    queryFn: async () => {
      const res = await checksApi.getRanking();
      return res.data;
    },
    enabled: showFinancials,
    staleTime: 60_000,
  });

  // Recent checks worked by this master — owner asked for «недавние чеки»
  // прямо в карточке сотрудника. Лимит 5 — компактный список без скролла.
  // Сервер возвращает по `masterId`, существующий API не меняем.
  const { data: recentChecksRaw } = useQuery<PaginatedResponse<Check>>({
    queryKey: ['employee-recent-checks', id],
    queryFn: async () => {
      const res = await checksApi.getAll({ masterId: id, page: 1, limit: 5 } as any);
      return res.data;
    },
    // Список чужих чеков с суммами — финансовая информация. Показываем
    // только владельцу/директору/админу, либо самому себе.
    enabled: !!id && !!user && user.role === 'master' && showFinancials,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
  const recentChecks = recentChecksRaw?.data ?? [];

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

  // ── Auto-derived performance insights ──────────────────────────────
  // Реальные «сильные стороны / зоны роста» считаются ТОЛЬКО из метрик,
  // которые уже приходят от API (today status + ranking + salary). Если
  // данных нет — соответствующий пункт просто не рисуется. Никаких
  // выдуманных показателей.
  const insights = useMemo(() => {
    if (!user || user.role !== 'master' || !showFinancials) return { strengths: [], growth: [] };
    const strengths: string[] = [];
    const growth: string[] = [];

    // Ranking-based
    if (rank?.monthPlace && rank.monthTotal >= 2) {
      const top3 = rank.monthPlace <= 3;
      const last20 = rank.monthPlace > Math.ceil(rank.monthTotal * 0.8);
      if (top3) strengths.push(`Топ-${rank.monthPlace} по выручке за месяц`);
      else if (last20) growth.push('Выручка за месяц ниже среднего по команде');
    }
    if (rank?.todayPlace === 1) strengths.push('Лидер по выручке сегодня');

    // Discipline (today status)
    if (today) {
      if (today.lateStatus === 'on_time' || today.actualArrival) {
        strengths.push('Сегодня пришёл вовремя');
      } else if (today.lateStatus === 'late_major') {
        growth.push(`Опоздание сегодня: ${today.lateMinutes} мин`);
      } else if (today.lateStatus === 'late_minor') {
        growth.push(`Опоздание сегодня: ${today.lateMinutes} мин`);
      } else if (today.hasSchedule && !today.isDayOff && !today.isWorking && !today.actualArrival) {
        growth.push('Сегодня по графику, ещё не пришёл');
      }
    }

    // Salary-based (only present when we have real numbers)
    if (salary && (salary.checkCount ?? 0) > 0) {
      const avg = (salary.totalRevenue ?? 0) / Math.max(salary.checkCount ?? 1, 1);
      if (avg > 0 && rank?.monthChecks && rank.monthChecks > 0) {
        // Высокий средний чек относительно собственного объёма — индикатор
        // дорогих заказов. Это не сравнение с другими, а внутренний показатель.
        if (avg >= 5000) strengths.push('Высокий средний чек');
      }
    }

    return { strengths, growth };
  }, [user, rank, today, salary, showFinancials]);

  // ── Performance Tier Scores ────────────────────────────────────────
  // Три нормализованных индекса 0–100 для верха карточки: «iOS Health»
  // / «sport game card» эстетика. Все формулы — ТОЛЬКО из реальных
  // метрик, которые уже отдаёт API. Никаких рандомов.
  //
  // ▸ Эффективность (effectiveness)
  //   Считаем средний чек = totalRevenue / checkCount за период (берём
  //   из MasterSalary). Нормализуем относительно базового порога 5000 ₽
  //   (типичный «нормальный» средний чек для рядовой автосервисной
  //   услуги в РФ — баксалайн, не сравнение с командой). Score = 100,
  //   если avg ≥ 10 000 ₽; 0, если 0 ₽; линейно между.
  //
  //   Перенос: формула чистая, легко переносится на Android (тот же
  //   `salary` объект) и на web (фронтенд уже знает MasterSalary).
  //
  // ▸ Дисциплина (discipline)
  //   Из `TodayEmployeeStatus` берём состояние сегодня:
  //     on_time / actualArrival → 100
  //     late_minor → 75
  //     late_major → 45
  //     no-show by-schedule → 0
  //     isDayOff → null (скрываем индекс — у выходного нет дисциплины)
  //   Это ОДНА точка данных. Идеально было бы агрегировать N последних
  //   дней через `/schedule?dateFrom=&dateTo=` + filter by userId, но
  //   список вернёт всю команду — это потенциально много данных, и
  //   API не имеет узкого `/schedule/employee/:id/stats` (есть только
  //   `/schedule/my-stats`, привязанный к JWT). Это документированный
  //   следующий шаг — см. SAAS audit.
  //
  // ▸ Активность (activity)
  //   По месячному рангу: позиция в `ranking.month` относительно
  //   количества всех мастеров. Score = (1 - (place-1)/(total-1)) * 100.
  //   Если мастер не появился в ranking — 0.
  //
  // Каждый score окрашивается по диапазону:
  //   ≥80 — зелёный (сильно)
  //   60–79 — синий (хорошо)
  //   40–59 — янтарный (средне)
  //   <40 — красный (слабо)
  const tierScores = useMemo(() => {
    if (!user || user.role !== 'master' || !showFinancials) return null;

    // Effectiveness
    let effectiveness: number | null = null;
    if (salary && (salary.checkCount ?? 0) > 0) {
      const avg = (salary.totalRevenue ?? 0) / Math.max(salary.checkCount ?? 1, 1);
      const baseline = 10000;
      effectiveness = Math.max(0, Math.min(100, Math.round((avg / baseline) * 100)));
    }

    // Discipline (today only — see comment above)
    let discipline: number | null = null;
    if (today && !today.isDayOff) {
      if (today.lateStatus === 'on_time' || today.actualArrival) discipline = 100;
      else if (today.lateStatus === 'late_minor') discipline = 75;
      else if (today.lateStatus === 'late_major') discipline = 45;
      else if (today.hasSchedule) discipline = 0;
    }

    // Activity (monthly rank percentile)
    let activity: number | null = null;
    if (rank?.monthPlace && rank.monthTotal >= 2) {
      activity = Math.max(0, Math.min(100, Math.round((1 - (rank.monthPlace - 1) / (rank.monthTotal - 1)) * 100)));
    }

    return { effectiveness, discipline, activity };
  }, [user, salary, today, rank, showFinancials]);

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

  const tabBarHeight = useTabBarHeight();

  if (isLoading) return <LoadingSpinner />;
  if (!user) {
    return (
      <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
        <IosScreenHeader title="Сотрудник" onBack={() => navigation.goBack()} />
        <EmptyState title="Сотрудник не найден" description="Возможно учётка удалена или у вас нет к ней доступа." />
      </View>
    );
  }

  const initials = user.fullName
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const role = ROLE_BADGE[user.role] || ROLE_BADGE.master;
  const sb = statusBadge(today);
  const medal = (place: number) => (place === 1 ? '🥇' : place === 2 ? '🥈' : place === 3 ? '🥉' : '');
  const heroColors = getHeroGradient(user.fullName);

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title="Сотрудник" onBack={() => navigation.goBack()} />

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: tabBarHeight + spacing[6] }]}
        contentInset={{ bottom: tabBarHeight }}
        scrollIndicatorInsets={{ bottom: tabBarHeight }}
        automaticallyAdjustContentInsets={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />
        }
      >
        {/* Hero — индивидуальный градиент по имени */}
        <LinearGradient colors={heroColors} style={styles.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
          <View style={styles.heroRow}>
            <View style={styles.heroAvatar}>
              <Text style={styles.heroInitials}>{initials}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.heroName} numberOfLines={1}>
                {user.fullName}
              </Text>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing[1.5],
                  marginTop: 8,
                  flexWrap: 'wrap',
                }}
              >
                <View style={[styles.heroBadge, { backgroundColor: role.bg }]}>
                  <Text style={[styles.heroBadgeText, { color: role.text }]}>{roleLabels[user.role] || user.role}</Text>
                </View>
                <View style={[styles.heroBadge, { backgroundColor: sb.bg }]}>
                  <Text style={[styles.heroBadgeText, { color: sb.fg }]}>{sb.text}</Text>
                </View>
              </View>
            </View>
          </View>
        </LinearGradient>

        {/* Performance Tier — три нормализованных индекса 0–100 для
            быстрой оценки сотрудника на одном взгляде. Видны только
            мастерам с правами на финансовые данные (формулы используют
            salary + ranking — не показываем коллегам без `profit_view`). */}
        {tierScores && (
          <View style={[styles.tierCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
            <View style={styles.tierRow}>
              <TierScore label="Эффективность" score={tierScores.effectiveness} hint="Средний чек" palette={palette} />
              <View style={[styles.tierDivider, { backgroundColor: palette.border.subtle }]} />
              <TierScore label="Дисциплина" score={tierScores.discipline} hint="Сегодня" palette={palette} />
              <View style={[styles.tierDivider, { backgroundColor: palette.border.subtle }]} />
              <TierScore label="Активность" score={tierScores.activity} hint="Месяц" palette={palette} />
            </View>
            <Text style={[styles.tierFootnote, { color: palette.text.tertiary }]}>
              Считается из реальных метрик: средний чек, статус сегодня, ранг в команде. Прочерк — данных недостаточно.
            </Text>
          </View>
        )}

        {/* Today */}
        <Section icon="time-outline" title="Сегодня" palette={palette}>
          <View style={styles.tilesRow}>
            <Tile
              label="Смена"
              value={
                today?.shiftStart && today?.shiftEnd
                  ? `${formatTime(today.shiftStart)} – ${formatTime(today.shiftEnd)}`
                  : today?.isDayOff
                    ? 'Выходной'
                    : '—'
              }
              palette={palette}
            />
            <Tile label="Пришёл" value={today?.actualArrival ? formatTime(today.actualArrival) : '—'} palette={palette} />
            <Tile label="Опоздание" value={today && today.lateMinutes > 0 ? `${today.lateMinutes} мин` : '—'} palette={palette} />
          </View>
          {today?.note ? (
            <View style={styles.note}>
              <Text style={styles.noteText}>{today.note}</Text>
            </View>
          ) : null}
        </Section>

        {/* Salary — только для viewer'ов с финансовыми правами либо для самого сотрудника */}
        {user.role === 'master' && salary && showFinancials && (
          <Section icon="wallet-outline" title="Заработок (период)" palette={palette}>
            <View style={styles.tilesGrid}>
              <Tile label="Заработано" value={formatMoney(salary.totalEarnings ?? 0)} highlight palette={palette} />
              <Tile label="Выручка" value={formatMoney(salary.totalRevenue ?? 0)} highlight palette={palette} />
              <Tile label="Чеков" value={String(salary.checkCount ?? 0)} palette={palette} />
              <Tile label="К выплате" value={formatMoney(salary.remainingAmount ?? 0)} palette={palette} />
            </View>
            {(salary.serviceEarnings != null || salary.productEarnings != null) && (
              <View style={[styles.tilesGrid, { marginTop: spacing[2] }]}>
                {salary.serviceEarnings != null && <Tile label="С услуг" value={formatMoney(salary.serviceEarnings)} palette={palette} />}
                {salary.productEarnings != null && (
                  <Tile label="С товаров" value={formatMoney(salary.productEarnings)} palette={palette} />
                )}
              </View>
            )}
          </Section>
        )}

        {/* Ranking — финансовая инфа, тоже под gate */}
        {user.role === 'master' && showFinancials && rank && (rank.monthPlace || rank.todayPlace) && (
          <Section icon="trophy-outline" title="Рейтинг" palette={palette}>
            <View style={styles.tilesGrid}>
              {rank.todayPlace ? (
                <Tile label="Сегодня" value={`${rank.todayPlace} / ${rank.todayTotal}`} hint={medal(rank.todayPlace)} palette={palette} />
              ) : (
                <View style={{ flex: 1 }} />
              )}
              {rank.monthPlace ? (
                <Tile label="Месяц" value={`${rank.monthPlace} / ${rank.monthTotal}`} hint={medal(rank.monthPlace)} palette={palette} />
              ) : (
                <View style={{ flex: 1 }} />
              )}
            </View>
            {rank.monthPlace ? (
              <Text style={[styles.rankSub, { color: palette.text.secondary }]}>
                Выручка за месяц: <Text style={[styles.rankNum, { color: palette.text.primary }]}>{formatMoney(rank.monthRevenue)}</Text>
                {'   ·   '}
                Чеков: <Text style={[styles.rankNum, { color: palette.text.primary }]}>{rank.monthChecks}</Text>
              </Text>
            ) : null}
          </Section>
        )}

        {/* Auto-derived performance insights — только реальные метрики.
            Если ни сильных, ни зон роста не насчитали — секция вообще не
            рисуется, чтобы не было пустого «—». */}
        {user.role === 'master' && showFinancials && (insights.strengths.length > 0 || insights.growth.length > 0) && (
          <Section icon="sparkles-outline" title="Performance" palette={palette}>
            {insights.strengths.length > 0 && (
              <View style={{ marginBottom: insights.growth.length > 0 ? spacing[3] : 0 }}>
                <Text style={[styles.insightHeader, { color: palette.text.tertiary }]}>Сильные стороны</Text>
                <View style={styles.insightList}>
                  {insights.strengths.map((s, i) => (
                    <View key={`s-${i}`} style={styles.insightRow}>
                      <Ionicons name="checkmark-circle" size={14} color={colors.green[500]} />
                      <Text style={[styles.insightText, { color: palette.text.primary }]}>{s}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}
            {insights.growth.length > 0 && (
              <View>
                <Text style={[styles.insightHeader, { color: palette.text.tertiary }]}>Зоны роста</Text>
                <View style={styles.insightList}>
                  {insights.growth.map((g, i) => (
                    <View key={`g-${i}`} style={styles.insightRow}>
                      <Ionicons name="trending-up" size={14} color={colors.amber[600]} />
                      <Text style={[styles.insightText, { color: palette.text.primary }]}>{g}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}
            <Text style={[styles.insightFootnote, { color: palette.text.tertiary }]}>
              Автоматически из ваших данных: ранг, дисциплина, средний чек. Ручные заметки владельца здесь пока не
              отображаются — потребуется отдельный endpoint для tenant-специфичных заметок.
            </Text>
          </Section>
        )}

        {/* Recent checks — последние 5 заказ-нарядов мастера. Тап на
            строку открывает CheckDetail. Если данных нет (не мастер /
            ничего не сделано) — секция не рисуется, чтобы не плодить
            пустых блоков. */}
        {user.role === 'master' && showFinancials && recentChecks.length > 0 && (
          <Section icon="receipt-outline" title="Недавние чеки" palette={palette}>
            <View style={styles.recentList}>
              {recentChecks.map((c) => (
                <TouchableOpacity
                  key={c.id}
                  style={[styles.recentRow, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
                  activeOpacity={0.7}
                  onPress={() => {
                    queryClient.setQueryData(['check', c.id], (existing: Check | undefined) => existing ?? c);
                    navigation.navigate('Main', {
                      screen: 'Checks',
                      params: { screen: 'CheckDetail', params: { id: c.id } },
                    });
                  }}
                >
                  <View style={styles.recentIconBox}>
                    <Ionicons name="receipt" size={14} color={colors.primary[600]} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[styles.recentTitle, { color: palette.text.primary }]} numberOfLines={1}>
                      {`#${c.number}`}
                      {c.client?.fullName ? ` · ${c.client.fullName}` : ''}
                    </Text>
                    <Text style={[styles.recentSub, { color: palette.text.secondary }]} numberOfLines={1}>
                      {new Date(c.date).toLocaleDateString('ru-RU', {
                        day: '2-digit',
                        month: '2-digit',
                        year: '2-digit',
                      })}
                      {c.car?.makeModel ? ` · ${c.car.makeModel}` : ''}
                    </Text>
                  </View>
                  <Text style={[styles.recentAmount, { color: palette.text.primary }]}>{formatMoney(c.totalRevenue)}</Text>
                  <Ionicons name="chevron-forward" size={14} color={palette.text.tertiary} />
                </TouchableOpacity>
              ))}
            </View>
          </Section>
        )}

        {/* Contact + work conditions.
            Условия работы (доли с услуг/товаров) — приватная информация.
            Показываем только владельцу/директору/админу либо самому
            сотруднику. Обычный коллега-мастер видит только базовый контакт. */}
        <Section icon="call-outline" title={showWorkConditions ? 'Контакт и условия' : 'Контакт'} palette={palette}>
          <View style={[styles.contactCard, { borderColor: palette.border.subtle }]}>
            <ContactRow icon="call-outline" label="Телефон" value={user.phone || '—'} palette={palette} />
            {!!user.username && <ContactRow icon="at-outline" label="Логин" value={user.username} palette={palette} />}
            {showWorkConditions && (
              <>
                <ContactRow icon="shield-outline" label="Доля с услуг" value={`${user.salaryPercent || 0}%`} palette={palette} />
                {typeof user.productSalaryPercent === 'number' && (
                  <ContactRow icon="shield-outline" label="Доля с товаров" value={`${user.productSalaryPercent}%`} palette={palette} />
                )}
                {user.daysOff && user.daysOff.length > 0 && (
                  <ContactRow
                    icon="calendar-outline"
                    label="Выходные"
                    value={user.daysOff.map((d) => ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'][d] || '?').join(', ')}
                    palette={palette}
                  />
                )}
              </>
            )}
          </View>
        </Section>
      </ScrollView>
    </View>
  );
}

// ── Section primitives ─────────────────────────────────────────────────────

type Palette = ReturnType<typeof useColors>;

function Section({
  icon,
  title,
  children,
  palette,
}: {
  icon: any;
  title: string;
  children: React.ReactNode;
  palette: Palette;
}) {
  return (
    <View style={[styles.section, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
      <View style={styles.sectionHeader}>
        <Ionicons name={icon} size={14} color={palette.text.tertiary} />
        <Text style={[styles.sectionTitle, { color: palette.text.tertiary }]}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

function Tile({
  label,
  value,
  highlight,
  hint,
  palette,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  hint?: string;
  palette: Palette;
}) {
  return (
    <View
      style={[
        styles.tile,
        highlight
          ? styles.tileHighlight
          : [styles.tileBase, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }],
      ]}
    >
      <Text style={[styles.tileLabel, { color: palette.text.tertiary }]}>{label}</Text>
      <Text
        style={[
          styles.tileValue,
          { color: palette.text.primary },
          highlight ? styles.tileValueHighlight : null,
        ]}
        numberOfLines={1}
      >
        {value}
        {hint ? `  ${hint}` : ''}
      </Text>
    </View>
  );
}

function ContactRow({ icon, label, value, palette }: { icon: any; label: string; value: string; palette: Palette }) {
  return (
    <View style={[styles.contactRow, { borderTopColor: palette.border.subtle }]}>
      <Ionicons name={icon} size={16} color={palette.text.tertiary} />
      <Text style={[styles.contactLabel, { color: palette.text.secondary }]}>{label}</Text>
      <Text style={[styles.contactValue, { color: palette.text.primary }]}>{value}</Text>
    </View>
  );
}

// TierScore — визуальный круг с числом 0–100. Цвет берётся из диапазона:
//   ≥80 зелёный, 60–79 синий, 40–59 янтарь, <40 красный, null — серый («—»).
// Это компактный «iOS Health»-style индикатор. Нечего делать — просто
// чистая цифра, без анимации. Кружок с тонкой рамкой и тонкой заливкой
// фона того же тона.
function TierScore({
  label,
  score,
  hint,
  palette,
}: {
  label: string;
  score: number | null;
  hint?: string;
  palette: Palette;
}) {
  let tone: { bg: string; ring: string; fg: string };
  if (score === null) tone = { bg: palette.bg.muted, ring: palette.border.subtle, fg: palette.text.tertiary };
  else if (score >= 80) tone = { bg: colors.green[50], ring: colors.green[200], fg: colors.green[700] };
  else if (score >= 60) tone = { bg: colors.blue[50], ring: colors.blue[200], fg: colors.blue[700] };
  else if (score >= 40) tone = { bg: colors.amber[50], ring: colors.amber[200], fg: colors.amber[700] };
  else tone = { bg: colors.red[50], ring: colors.red[200], fg: colors.red[700] };

  return (
    <View style={styles.tierItem}>
      <View style={[styles.tierCircle, { backgroundColor: tone.bg, borderColor: tone.ring }]}>
        <Text style={[styles.tierScoreText, { color: tone.fg }]}>{score === null ? '—' : score}</Text>
      </View>
      <Text style={[styles.tierLabel, { color: palette.text.secondary }]}>{label}</Text>
      {hint && <Text style={[styles.tierHint, { color: palette.text.tertiary }]}>{hint}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.gray[50] },
  scroll: { padding: spacing[4], paddingBottom: spacing[8], gap: spacing[3] },

  hero: {
    borderRadius: borderRadius['3xl'],
    padding: spacing[5],
    overflow: 'hidden',
  },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  heroAvatar: {
    width: 72,
    height: 72,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.20)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroInitials: { color: colors.white, fontSize: fontSize.xl, fontWeight: fontWeight.bold },
  heroName: { color: colors.white, fontSize: fontSize.xl, fontWeight: fontWeight.bold },
  heroBadge: {
    paddingHorizontal: spacing[2.5],
    paddingVertical: 3,
    borderRadius: borderRadius.full,
  },
  heroBadgeText: { fontSize: 11, fontWeight: fontWeight.semibold },

  section: {
    backgroundColor: colors.white,
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    borderColor: colors.gray[100],
    padding: spacing[4],
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
    marginBottom: spacing[3],
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: fontWeight.bold,
    color: colors.gray[400],
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },

  tilesRow: { flexDirection: 'row', gap: spacing[2] },
  tilesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  tile: {
    flexBasis: '48%',
    flexGrow: 1,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.xl,
    borderWidth: 1,
  },
  tileBase: { backgroundColor: colors.gray[50], borderColor: colors.gray[100] },
  tileHighlight: { backgroundColor: '#EFF6FF', borderColor: '#DBEAFE' },
  tileLabel: {
    fontSize: 10,
    color: colors.gray[400],
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  tileValue: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  tileValueHighlight: { color: colors.blue[700] },

  note: {
    marginTop: spacing[3],
    backgroundColor: colors.amber[50],
    borderWidth: 1,
    borderColor: colors.amber[100],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.lg,
  },
  noteText: { fontSize: 12, color: colors.amber[800] },

  rankSub: { marginTop: spacing[2], fontSize: 12, color: colors.gray[500] },
  rankNum: { fontWeight: fontWeight.semibold, color: colors.gray[900] },

  contactCard: {
    borderWidth: 1,
    borderColor: colors.gray[100],
    borderRadius: borderRadius.xl,
    overflow: 'hidden',
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colors.gray[100],
  },
  contactLabel: { fontSize: 12, color: colors.gray[500], flex: 1 },
  contactValue: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[900] },

  // Recent checks list — компактные строки, чтобы не дублировать журнал.
  recentList: { gap: spacing[2] },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[2.5],
    paddingHorizontal: spacing[3],
    borderRadius: borderRadius.lg,
    backgroundColor: colors.gray[50],
    borderWidth: 1,
    borderColor: colors.gray[100],
  },
  recentIconBox: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary[50],
  },
  recentTitle: { fontSize: 13, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  recentSub: { fontSize: 11, color: colors.gray[500], marginTop: 1 },
  recentAmount: { fontSize: 13, fontWeight: fontWeight.semibold, color: colors.gray[900] },

  // Performance insights — короткие маркированные пункты, без чисел.
  // Числа рядом не нужны: они показывают «что» хорошо/плохо, конкретика
  // живёт в Salary / Ranking секциях выше.
  insightHeader: {
    fontSize: 10,
    fontWeight: fontWeight.bold,
    color: colors.gray[400],
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: spacing[2],
  },
  insightList: { gap: spacing[1.5] },
  insightRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  insightText: { fontSize: 13, color: colors.gray[800], flex: 1, lineHeight: 18 },
  insightFootnote: {
    marginTop: spacing[3],
    fontSize: 11,
    color: colors.gray[400],
    lineHeight: 15,
  },

  // ── Performance Tier (iter#12) ─────────────────────────────────────
  // «Игровая» tier-карточка с тремя индексами на верх профиля. Та же
  // эстетика, что premium-блок на главной владельца — белая карточка с
  // hairline-сепараторами вместо мелких box-ов вокруг каждого числа.
  tierCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.06)',
    paddingVertical: spacing[4],
    paddingHorizontal: spacing[3],
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.04,
    shadowRadius: 16,
    elevation: 2,
  },
  tierRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  tierDivider: {
    width: StyleSheet.hairlineWidth,
    height: 56,
    backgroundColor: 'rgba(15, 23, 42, 0.08)',
    marginHorizontal: 4,
  },
  tierItem: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tierCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tierScoreText: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.4,
    fontVariant: ['tabular-nums'],
  },
  tierLabel: {
    fontSize: 11,
    fontWeight: fontWeight.semibold,
    color: colors.gray[700],
    marginTop: spacing[2],
    letterSpacing: -0.1,
  },
  tierHint: {
    fontSize: 10,
    color: colors.gray[400],
    marginTop: 1,
    letterSpacing: 0.1,
  },
  tierFootnote: {
    marginTop: spacing[3],
    fontSize: 11,
    color: colors.gray[400],
    textAlign: 'center',
    lineHeight: 15,
  },
});
