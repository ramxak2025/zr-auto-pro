import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Animated,
  Dimensions,
} from 'react-native';
import CachedImage from '../components/CachedImage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path, Defs, LinearGradient as SvgGrad, Stop, Line } from 'react-native-svg';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';
import {
  checksApi,
  salaryApi,
  shiftsApi,
  scheduleApi,
  reportsApi,
  marketingApi,
  usersApi,
  productsApi,
  callsApi,
} from '../api/services';
import { getImageUrl } from '../api/axios';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import AnimatedCard from '../components/AnimatedCard';
import type {
  SalarySummary,
  EmployeeRanking,
  TodayEmployeeStatus,
  Shift,
  ScheduleEntry,
  User,
  DashboardStats,
  Product,
} from '../../../shared/types';
import { UserRole } from '../../../shared/types';
import { calculateAttendanceStats, attendanceScore, emptyBreakdown } from '../../../shared/utils/attendance';

const SCREEN_WIDTH = Dimensions.get('window').width;

function formatMoney(value: number): string {
  const rounded = Math.round(value);
  return rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' \u20BD';
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'Доброе утро';
  if (hour >= 12 && hour < 17) return 'Добрый день';
  if (hour >= 17 && hour < 22) return 'Добрый вечер';
  return 'Доброй ночи';
}

// ── Period helpers ──
type ChartPeriod = 'today' | 'week' | 'month' | 'year';
const periodLabels: Record<ChartPeriod, string> = {
  today: 'День',
  week: 'Неделя',
  month: 'Месяц',
  year: 'Год',
};

function getOffsetLabel(period: ChartPeriod, offset: number): string {
  const now = new Date();
  const months = [
    'января',
    'февраля',
    'марта',
    'апреля',
    'мая',
    'июня',
    'июля',
    'августа',
    'сентября',
    'октября',
    'ноября',
    'декабря',
  ];
  const monthsFull = [
    'Январь',
    'Февраль',
    'Март',
    'Апрель',
    'Май',
    'Июнь',
    'Июль',
    'Август',
    'Сентябрь',
    'Октябрь',
    'Ноябрь',
    'Декабрь',
  ];

  switch (period) {
    case 'today': {
      const d = new Date(now);
      d.setDate(d.getDate() + offset);
      return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
    }
    case 'week': {
      const curr = new Date(now);
      const dayOfWeek = curr.getDay() || 7;
      const monday = new Date(curr);
      monday.setDate(curr.getDate() - dayOfWeek + 1 + offset * 7);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      return `${monday.getDate()} ${months[monday.getMonth()].slice(0, 3)} — ${sunday.getDate()} ${months[sunday.getMonth()].slice(0, 3)}`;
    }
    case 'month': {
      const m = new Date(now.getFullYear(), now.getMonth() + offset, 1);
      return `${monthsFull[m.getMonth()]} ${m.getFullYear()}`;
    }
    case 'year': {
      return `${now.getFullYear() + offset}`;
    }
    default:
      return '';
  }
}

// ── Revenue Chart ──
function RevenueChart() {
  const [period, setPeriod] = useState<ChartPeriod>('week');
  const [offset, setOffset] = useState(0);
  const animWidth = useRef(new Animated.Value(0)).current;

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-chart', period, offset],
    queryFn: async () => {
      const res = await checksApi.getDashboardChart(period, offset);
      return res.data;
    },
    staleTime: 30_000,
  });

  useEffect(() => {
    Animated.timing(animWidth, { toValue: 1, duration: 800, useNativeDriver: false }).start();
  }, [data]);

  const handlePeriodChange = (p: ChartPeriod) => {
    setPeriod(p);
    setOffset(0);
  };

  const points = data?.points || [];
  const totalRevenue = data?.totalRevenue ?? 0;
  const totalProfit = data?.totalProfit ?? 0;
  const totalChecks = data?.totalChecks ?? 0;
  const maxValue = useMemo(() => {
    if (!points.length) return 1;
    return Math.max(...points.map((p: any) => p.revenue), 1);
  }, [points]);
  const chartWidth = SCREEN_WIDTH - spacing[4] * 2 - spacing[5] * 2;
  const barWidth = points.length > 0 ? Math.max(chartWidth / points.length - 4, 6) : 10;

  const formatLabel = (dateStr: string, idx: number, total: number): string => {
    if (period === 'today') return '';
    if (period === 'year') {
      const monthsShort = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
      const parts = dateStr.split('-');
      return monthsShort[parseInt(parts[1]) - 1] || '';
    }
    const d = new Date(dateStr);
    if (period === 'week') {
      const days = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
      return days[d.getDay()];
    }
    if (period === 'month') {
      return `${d.getDate()}`;
    }
    return `${d.getDate()}`;
  };

  /** Build smooth bezier curve path */
  const buildWavePath = (vals: number[], w: number, h: number, maxV: number): string => {
    if (vals.length < 2) return '';
    const pts = vals.map((v, i) => ({
      x: (i / (vals.length - 1)) * w,
      y: h - (v / maxV) * (h * 0.85) - 4,
    }));
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1];
      const curr = pts[i];
      const cpx = (prev.x + curr.x) / 2;
      d += ` C ${cpx} ${prev.y}, ${cpx} ${curr.y}, ${curr.x} ${curr.y}`;
    }
    return d;
  };

  const buildAreaPath = (vals: number[], w: number, h: number, maxV: number): string => {
    const line = buildWavePath(vals, w, h, maxV);
    if (!line) return '';
    return `${line} L ${w} ${h} L 0 ${h} Z`;
  };

  const svgW = chartWidth;
  const svgH = 120;
  const revVals = points.map((p: any) => p.revenue || 0);
  const profVals = points.map((p: any) => p.profit || 0);
  const maxProfit = Math.max(...profVals, 1);

  // labels for month: show 1,2,3... in order
  const labelStep = period === 'month' ? (points.length > 15 ? 5 : 3) : 1;

  return (
    <AnimatedCard index={0} style={styles.chartCard}>
      <LinearGradient colors={['#0f172a', '#1e293b']} style={styles.chartGradient}>
        <Text style={styles.chartSubLabel}>АНАЛИТИКА</Text>

        {/* Period tabs */}
        <View style={styles.periodTabs}>
          {(Object.keys(periodLabels) as ChartPeriod[]).map((p) => (
            <TouchableOpacity
              key={p}
              style={[styles.periodTab, period === p && styles.periodTabActive]}
              onPress={() => handlePeriodChange(p)}
            >
              <Text style={[styles.periodTabText, period === p && styles.periodTabTextActive]}>{periodLabels[p]}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Period navigation */}
        <View style={styles.navRow}>
          <TouchableOpacity style={styles.navBtn} onPress={() => setOffset((o) => o - 1)}>
            <Ionicons name="chevron-back" size={16} color={colors.slate[400]} />
          </TouchableOpacity>
          <Text style={styles.navLabel}>{getOffsetLabel(period, offset)}</Text>
          <TouchableOpacity
            style={[styles.navBtn, offset >= 0 && styles.navBtnDisabled]}
            onPress={() => setOffset((o) => (o < 0 ? o + 1 : 0))}
            disabled={offset >= 0}
          >
            <Ionicons
              name="chevron-forward"
              size={16}
              color={offset >= 0 ? 'rgba(148,163,184,0.2)' : colors.slate[400]}
            />
          </TouchableOpacity>
        </View>

        {isLoading ? (
          <ActivityIndicator color={colors.primary[400]} style={{ paddingVertical: spacing[8] }} />
        ) : points.length > 1 ? (
          <View style={styles.chartBody}>
            {/* SVG Wave Chart */}
            <View style={{ height: svgH, width: svgW }}>
              <Svg width={svgW} height={svgH} viewBox={`0 0 ${svgW} ${svgH}`}>
                <Defs>
                  <SvgGrad id="revGrad" x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0%" stopColor="rgb(37,99,235)" stopOpacity="0.4" />
                    <Stop offset="100%" stopColor="rgb(37,99,235)" stopOpacity="0" />
                  </SvgGrad>
                  <SvgGrad id="profGrad" x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0%" stopColor="rgb(6,182,212)" stopOpacity="0.3" />
                    <Stop offset="100%" stopColor="rgb(6,182,212)" stopOpacity="0" />
                  </SvgGrad>
                </Defs>
                {/* Grid lines */}
                {[0.25, 0.5, 0.75].map((pct) => (
                  <Line
                    key={pct}
                    x1={0}
                    y1={svgH * (1 - pct)}
                    x2={svgW}
                    y2={svgH * (1 - pct)}
                    stroke="rgba(255,255,255,0.05)"
                    strokeWidth={1}
                  />
                ))}
                {/* Revenue area + line */}
                <Path d={buildAreaPath(revVals, svgW, svgH, maxValue)} fill="url(#revGrad)" />
                <Path
                  d={buildWavePath(revVals, svgW, svgH, maxValue)}
                  stroke="rgb(59,130,246)"
                  strokeWidth={2.5}
                  fill="none"
                />
                {/* Profit area + line */}
                <Path
                  d={buildAreaPath(profVals, svgW, svgH, maxProfit > maxValue ? maxProfit : maxValue)}
                  fill="url(#profGrad)"
                />
                <Path
                  d={buildWavePath(profVals, svgW, svgH, maxProfit > maxValue ? maxProfit : maxValue)}
                  stroke="rgb(6,182,212)"
                  strokeWidth={1.5}
                  fill="none"
                  strokeDasharray="4,4"
                />
              </Svg>
            </View>

            {/* X-axis labels */}
            {period !== 'today' && (
              <View style={styles.xAxisLabels}>
                {points.map((point: any, idx: number) => {
                  const label = formatLabel(point.date, idx, points.length);
                  const show =
                    period === 'week' || period === 'year' || idx % labelStep === 0 || idx === points.length - 1;
                  return (
                    <Text key={idx} style={styles.xAxisLabel}>
                      {show ? label : ''}
                    </Text>
                  );
                })}
              </View>
            )}
          </View>
        ) : points.length === 1 ? (
          <View style={styles.todayStat}>
            <Text style={styles.todayStatValue}>{formatMoney(totalRevenue)}</Text>
            <Text style={styles.todayStatSub}>Выручка за период</Text>
          </View>
        ) : (
          <Text style={styles.chartEmpty}>Нет данных за период</Text>
        )}

        {/* Bottom stats */}
        {data && (
          <View style={styles.chartStats}>
            <View style={styles.chartStatItem}>
              <Text style={styles.chartStatLabel}>Оборот</Text>
              <Text style={styles.chartStatValue}>{formatMoney(totalRevenue)}</Text>
            </View>
            <View style={[styles.chartStatItem, styles.chartStatBorder]}>
              <Text style={styles.chartStatLabel}>Прибыль</Text>
              <Text style={[styles.chartStatValue, { color: colors.cyan[400] }]}>{formatMoney(totalProfit)}</Text>
            </View>
            <View style={[styles.chartStatItem, styles.chartStatBorder]}>
              <Text style={styles.chartStatLabel}>Чеков</Text>
              <Text style={styles.chartStatValue}>{totalChecks || '—'}</Text>
            </View>
          </View>
        )}

        {/* Scrollable day details */}
        {points.length > 1 && period !== 'today' && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chartDetailsScroll}>
            {points.map((point: any, idx: number) => (
              <View key={idx} style={styles.chartDetailCard}>
                <Text style={styles.chartDetailDate}>{formatLabel(point.date, idx, points.length)}</Text>
                <Text style={styles.chartDetailRevenue}>{formatMoney(point.revenue)}</Text>
                <Text style={styles.chartDetailProfit}>{formatMoney(point.profit)}</Text>
              </View>
            ))}
          </ScrollView>
        )}
      </LinearGradient>
    </AnimatedCard>
  );
}

// ── Shift Control ──
function ShiftControl() {
  const queryClient = useQueryClient();
  const { data: myShifts } = useQuery<Shift[]>({
    queryKey: ['shifts', 'my'],
    queryFn: async () => {
      const res = await shiftsApi.getMy();
      return res.data;
    },
    staleTime: 10_000,
  });

  const openShift = useMutation({
    mutationFn: () => shiftsApi.open(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      queryClient.invalidateQueries({ queryKey: ['schedule-today'] });
    },
  });

  const closeShift = useMutation({
    mutationFn: (id: string) => shiftsApi.close(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      queryClient.invalidateQueries({ queryKey: ['schedule-today'] });
    },
  });

  const currentShift = myShifts?.find((s) => !s.closedAt);
  const isLoading = openShift.isPending || closeShift.isPending;

  return (
    <AnimatedCard index={1} style={styles.card}>
      <View style={styles.shiftRow}>
        <View style={styles.shiftLeft}>
          <View style={[styles.shiftIcon, currentShift ? styles.shiftIconOpen : styles.shiftIconClosed]}>
            <Ionicons
              name={currentShift ? 'time' : 'time-outline'}
              size={20}
              color={currentShift ? colors.green[600] : colors.gray[400]}
            />
          </View>
          <View>
            <Text style={styles.shiftTitle}>{currentShift ? 'Смена открыта' : 'Смена закрыта'}</Text>
            {currentShift && (
              <Text style={styles.shiftSince}>
                с {new Date(currentShift.openedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
              </Text>
            )}
          </View>
        </View>
        {currentShift ? (
          <TouchableOpacity
            style={styles.shiftCloseBtn}
            onPress={() => closeShift.mutate(currentShift.id)}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator size="small" color={colors.red[600]} />
            ) : (
              <Text style={styles.shiftCloseBtnText}>Закрыть</Text>
            )}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.shiftOpenBtn} onPress={() => openShift.mutate()} disabled={isLoading}>
            {isLoading ? (
              <ActivityIndicator size="small" color={colors.green[600]} />
            ) : (
              <Text style={styles.shiftOpenBtnText}>Открыть смену</Text>
            )}
          </TouchableOpacity>
        )}
      </View>
    </AnimatedCard>
  );
}

// ── Staff Status ──
function StaffStatus() {
  const { data: todayData } = useQuery<TodayEmployeeStatus[]>({
    queryKey: ['schedule-today'],
    queryFn: async () => {
      const res = await scheduleApi.getToday();
      return res.data;
    },
    staleTime: 30_000,
  });

  const statuses = todayData ?? [];
  if (statuses.length === 0) return null;

  const isSick = (s: TodayEmployeeStatus) => (s.note || '').toLowerCase().includes('больнич');
  const isAbsent = (s: TodayEmployeeStatus) => (s.note || '').toLowerCase().includes('прогул');
  // Manual "Shift" or actualArrival counts as on shift
  const isOnShift = (s: TodayEmployeeStatus) => s.isWorking || !!s.actualArrival || s.lateStatus === 'on_time';

  const getColor = (s: TodayEmployeeStatus) => {
    if (isSick(s)) return colors.rose[400];
    if (s.isDayOff) return colors.gray[400];
    if (s.lateStatus === 'late_major') return colors.orange[500];
    if (s.lateStatus === 'late_minor') return colors.yellow[300];
    if (isOnShift(s)) return colors.green[500];
    if (isAbsent(s)) return colors.red[500];
    return colors.gray[300];
  };

  // Groups: on-shift sorted by lateness (on-time first), not arrived, absent, sick, dayOff
  const sortByLate = (a: TodayEmployeeStatus, b: TodayEmployeeStatus) => {
    const rank = (s: TodayEmployeeStatus) =>
      s.lateStatus === 'late_major' ? 3 : s.lateStatus === 'late_minor' ? 2 : 1;
    return rank(a) - rank(b);
  };
  const onShiftAll = statuses
    .filter(
      (s) =>
        (isOnShift(s) || s.lateStatus === 'late_minor' || s.lateStatus === 'late_major') &&
        !s.isDayOff &&
        !isSick(s) &&
        !isAbsent(s),
    )
    .sort(sortByLate);
  const notArrivedGroup = statuses.filter(
    (s) => !isOnShift(s) && !s.isDayOff && s.hasSchedule && !isSick(s) && !isAbsent(s) && !s.lateStatus,
  );
  const absentGroup = statuses.filter((s) => isAbsent(s));
  const dayOffGroup = statuses.filter((s) => s.isDayOff && !isSick(s));
  const sickGroup = statuses.filter((s) => isSick(s));

  const renderGroup = (title: string, items: TodayEmployeeStatus[]) => {
    if (items.length === 0) return null;
    return (
      <View style={{ marginBottom: spacing[3] }}>
        <Text
          style={{
            fontSize: 10,
            fontWeight: '700',
            color: colors.gray[400],
            marginBottom: 6,
            letterSpacing: 0.5,
            textTransform: 'uppercase' as const,
          }}
        >
          {title} · {items.length}
        </Text>
        <View style={styles.staffGrid}>
          {items.map((s) => (
            <View key={s.userId} style={styles.staffItem}>
              <View style={[styles.staffCircle, { backgroundColor: getColor(s) }]}>
                <Text style={styles.staffInitials}>
                  {s.fullName
                    .split(' ')
                    .map((w) => w[0])
                    .join('')
                    .slice(0, 2)}
                </Text>
              </View>
              <Text style={styles.staffName} numberOfLines={1}>
                {s.fullName.split(' ')[0]}
              </Text>
            </View>
          ))}
        </View>
      </View>
    );
  };

  return (
    <AnimatedCard index={2} style={styles.card}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginBottom: spacing[3] }}>
        <Ionicons name="people-outline" size={16} color={colors.gray[900]} />
        <Text style={styles.sectionTitle}>Сотрудники сегодня</Text>
      </View>
      {renderGroup('На смене', onShiftAll)}
      {renderGroup('Ещё не пришёл', notArrivedGroup)}
      {renderGroup('Прогул', absentGroup)}
      {renderGroup('Выходной', dayOffGroup)}
      {renderGroup('Больничный', sickGroup)}
    </AnimatedCard>
  );
}

// ── Employee Ranking ──
function EmployeeRankingSection() {
  const [tab, setTab] = useState<'today' | 'month'>('today');
  const { data: ranking } = useQuery<EmployeeRanking>({
    queryKey: ['employee-ranking'],
    queryFn: async () => {
      const res = await checksApi.getRanking();
      return res.data;
    },
    staleTime: 30_000,
  });

  if (!ranking) return null;
  const data = tab === 'today' ? ranking.today || [] : ranking.month || [];

  // Split into top 3 and the rest
  const top3 = data.slice(0, 3);
  const rest = data.slice(3);

  // Reorder top3 for podium: [2nd, 1st, 3rd]
  const podiumOrder = top3.length >= 3 ? [top3[1], top3[0], top3[2]] : top3.length === 2 ? [top3[1], top3[0]] : top3;
  const podiumPositions = top3.length >= 3 ? [2, 1, 3] : top3.length === 2 ? [2, 1] : [1];

  const podiumColors: Record<number, string> = { 1: '#FFD700', 2: '#E8E8E8', 3: '#F4A460' };

  return (
    <AnimatedCard index={3} style={styles.card}>
      {/* Card header */}
      <View style={styles.rankingHeader}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
          <Ionicons name="flame-outline" size={18} color={colors.amber[600]} />
          <Text style={styles.sectionTitle}>Рейтинг мастеров</Text>
        </View>
        <View style={styles.tabRow}>
          <TouchableOpacity
            style={[styles.tabBtn, tab === 'today' && styles.tabBtnActive]}
            onPress={() => setTab('today')}
          >
            <Text style={[styles.tabBtnText, tab === 'today' && styles.tabBtnTextActive]}>Сегодня</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabBtn, tab === 'month' && styles.tabBtnActive]}
            onPress={() => setTab('month')}
          >
            <Text style={[styles.tabBtnText, tab === 'month' && styles.tabBtnTextActive]}>За месяц</Text>
          </TouchableOpacity>
        </View>
      </View>

      {data.length === 0 ? (
        <View style={styles.rankingEmpty}>
          <Ionicons name="bar-chart-outline" size={32} color={colors.gray[300]} />
          <Text style={styles.rankingEmptyText}>Нет данных</Text>
        </View>
      ) : (
        <>
          {/* Top 3 podium */}
          <View style={styles.podiumContainer}>
            {podiumOrder.map((emp, idx) => {
              const pos = podiumPositions[idx];
              const isFirst = pos === 1;
              const bgColor = podiumColors[pos] || colors.gray[200];
              return (
                <View key={emp.masterId} style={[styles.podiumItem, isFirst && styles.podiumItemFirst]}>
                  <View
                    style={[styles.podiumCircle, isFirst && styles.podiumCircleFirst, { backgroundColor: bgColor }]}
                  >
                    <Text style={[styles.podiumPosition, isFirst && styles.podiumPositionFirst]}>{pos}</Text>
                  </View>
                  <Text style={[styles.podiumName, isFirst && styles.podiumNameFirst]} numberOfLines={1}>
                    {emp.masterName.split(' ')[0]}
                  </Text>
                  <Text style={[styles.podiumRevenue, isFirst && styles.podiumRevenueFirst]}>
                    {formatMoney(emp.revenue)}
                  </Text>
                </View>
              );
            })}
          </View>

          {/* Remaining employees */}
          {rest.length > 0 && (
            <View style={styles.rankingList}>
              {rest.map((emp, idx) => (
                <View
                  key={emp.masterId}
                  style={[styles.rankingListRow, idx < rest.length - 1 && styles.rankingListRowBorder]}
                >
                  <View style={styles.rankingListNum}>
                    <Text style={styles.rankingListNumText}>{idx + 4}</Text>
                  </View>
                  <View style={styles.rankInfo}>
                    <Text style={styles.rankName} numberOfLines={1}>
                      {emp.masterName}
                    </Text>
                    <Text style={styles.rankSub}>{emp.checkCount} заказов</Text>
                  </View>
                  <Text style={styles.rankRevenue}>{formatMoney(emp.revenue)}</Text>
                </View>
              ))}
            </View>
          )}
        </>
      )}
    </AnimatedCard>
  );
}

// ── Master Dashboard ──
function MasterRatingCard({ userId }: { userId?: string }) {
  const { data } = useQuery({
    queryKey: ['marketing-dashboard'],
    queryFn: async () => {
      const res = await marketingApi.getDashboard();
      return res.data;
    },
    staleTime: 5 * 60_000,
  });

  if (!data?.employeeRatings?.length || !userId) return null;

  const myRating = data.employeeRatings.find((e: any) => e.employeeId === userId);
  if (!myRating) return null;

  const rank =
    data.employeeRatings
      .sort((a: any, b: any) => b.avgRating - a.avgRating)
      .findIndex((e: any) => e.employeeId === userId) + 1;

  const stars = Math.round(myRating.avgRating);

  return (
    <AnimatedCard index={5} style={styles.card}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[3] }}>
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: rank <= 3 ? colors.amber[50] : colors.gray[50],
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons
            name={rank === 1 ? 'trophy' : rank <= 3 ? 'medal' : 'star'}
            size={22}
            color={rank === 1 ? colors.amber[600] : rank <= 3 ? colors.gray[500] : colors.primary[500]}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900] }}>
            Мой рейтинг
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[1], marginTop: 2 }}>
            {[1, 2, 3, 4, 5].map((i) => (
              <Ionicons
                key={i}
                name={i <= stars ? 'star' : 'star-outline'}
                size={14}
                color={i <= stars ? colors.yellow[400] : colors.gray[200]}
              />
            ))}
            <Text
              style={{
                fontSize: fontSize.xs,
                fontWeight: fontWeight.bold,
                color: myRating.avgRating >= 4 ? colors.green[600] : colors.orange[500],
                marginLeft: spacing[1],
              }}
            >
              {myRating.avgRating.toFixed(1)}
            </Text>
          </View>
        </View>
        <View style={{ alignItems: 'center' }}>
          <Text
            style={{
              fontSize: fontSize['2xl'],
              fontWeight: fontWeight.bold,
              color: rank <= 3 ? colors.amber[600] : colors.gray[700],
            }}
          >
            #{rank}
          </Text>
          <Text style={{ fontSize: 10, color: colors.gray[400] }}>из {data.employeeRatings.length}</Text>
        </View>
      </View>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-around',
          marginTop: spacing[3],
          paddingTop: spacing[3],
          borderTopWidth: 1,
          borderTopColor: colors.gray[100],
        }}
      >
        <View style={{ alignItems: 'center' }}>
          <Text style={{ fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.gray[900] }}>
            {myRating.reviewCount}
          </Text>
          <Text style={{ fontSize: 10, color: colors.gray[400] }}>отзывов</Text>
        </View>
        <View style={{ alignItems: 'center' }}>
          <Text style={{ fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.green[600] }}>
            {Math.round(100 - myRating.negativeRate)}%
          </Text>
          <Text style={{ fontSize: 10, color: colors.gray[400] }}>положит.</Text>
        </View>
      </View>
    </AnimatedCard>
  );
}

function MasterRecentChecks() {
  const navigation = useNavigation<any>();
  const { data: checks } = useQuery({
    queryKey: ['checks', 'recent-master'],
    queryFn: async () => {
      const res = await checksApi.getAll({ limit: 5 });
      return res.data;
    },
    staleTime: 30_000,
  });

  const items = (checks as any)?.data || checks || [];
  if (!Array.isArray(items) || items.length === 0) return null;

  return (
    <AnimatedCard index={6} style={styles.card}>
      <Text style={styles.cashTitle}>ПОСЛЕДНИЕ ЧЕКИ</Text>
      <View style={{ gap: spacing[1.5] }}>
        {items.slice(0, 5).map((check: any) => (
          <TouchableOpacity
            key={check.id}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingVertical: spacing[2],
              paddingHorizontal: spacing[1],
              borderBottomWidth: 1,
              borderBottomColor: colors.gray[50],
            }}
            onPress={() =>
              navigation.navigate('Main', {
                screen: 'Checks',
                params: { screen: 'CheckDetail', params: { id: check.id } },
              })
            }
          >
            <View
              style={{
                width: 32,
                height: 32,
                borderRadius: 16,
                backgroundColor: check.isDeferred ? colors.amber[50] : colors.green[50],
                alignItems: 'center',
                justifyContent: 'center',
                marginRight: spacing[3],
              }}
            >
              <Ionicons
                name={check.isDeferred ? 'time-outline' : 'receipt-outline'}
                size={14}
                color={check.isDeferred ? colors.amber[600] : colors.green[600]}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={{ fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[900] }}
                numberOfLines={1}
              >
                {check.client?.fullName || 'Розничный'}
              </Text>
              <Text style={{ fontSize: 11, color: colors.gray[400] }}>
                {new Date(check.date).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })}
                {check.car?.makeModel ? ` · ${check.car.makeModel}` : ''}
              </Text>
            </View>
            <Text style={{ fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.primary[600] }}>
              {formatMoney(check.totalRevenue || 0)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </AnimatedCard>
  );
}

function MyAttendanceRankWidget({ userId }: { userId?: string }) {
  const navigation = useNavigation<any>();
  const [selectedMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const monthStart = `${selectedMonth}-01`;
  const monthEnd = (() => {
    const [y, m] = selectedMonth.split('-').map(Number);
    return `${y}-${String(m).padStart(2, '0')}-${new Date(y, m, 0).getDate()}`;
  })();

  const { data: monthEntries = [] } = useQuery<ScheduleEntry[]>({
    queryKey: ['schedule', monthStart, monthEnd],
    queryFn: async () => (await scheduleApi.getAll({ dateFrom: monthStart, dateTo: monthEnd })).data,
    enabled: !!userId,
  });

  const { data: usersData } = useQuery<User[]>({
    queryKey: ['users'],
    queryFn: async () => (await usersApi.getAll()).data,
  });

  const masters = useMemo(() => (usersData || []).filter((u) => u.isActive && u.role === 'master'), [usersData]);

  // SHARED attendance utility — identical to schedule RatingTab
  const stats = useMemo(() => calculateAttendanceStats(monthEntries as any), [monthEntries]);
  const ranked = useMemo(
    () =>
      masters
        .map((u) => {
          const s = stats[u.id] || emptyBreakdown();
          return { id: u.id, score: attendanceScore(s), full: s.full, total: s.total };
        })
        .sort((a, b) => b.score - a.score || b.full - a.full),
    [masters, stats],
  );

  if (!userId || ranked.length === 0) return null;
  const myRank = ranked.findIndex((r) => r.id === userId) + 1;
  const me = ranked.find((r) => r.id === userId);
  if (!me) return null;

  const medal = myRank === 1 ? '🥇' : myRank === 2 ? '🥈' : myRank === 3 ? '🥉' : null;
  const scoreColor = me.score >= 90 ? colors.green[600] : me.score >= 70 ? colors.yellow[600] : colors.red[500];
  const monthName = new Date(
    parseInt(selectedMonth.split('-')[0]),
    parseInt(selectedMonth.split('-')[1]) - 1,
  ).toLocaleDateString('ru-RU', { month: 'long' });

  return (
    <AnimatedCard index={6}>
      <TouchableOpacity
        onPress={() => navigation.navigate('Schedule')}
        activeOpacity={0.8}
        style={{
          backgroundColor: colors.white,
          borderRadius: borderRadius['2xl'],
          padding: spacing[4],
          borderWidth: 1,
          borderColor: colors.gray[100],
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[3] }}>
          <View
            style={{
              width: 56,
              height: 56,
              borderRadius: 28,
              backgroundColor: myRank <= 3 ? colors.amber[50] : colors.gray[50],
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 2,
              borderColor: myRank <= 3 ? colors.amber[200] : colors.gray[200],
            }}
          >
            <Text style={{ fontSize: 26 }}>{medal || `#${myRank}`}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text
              style={{
                fontSize: 11,
                fontWeight: '700',
                color: colors.gray[400],
                textTransform: 'uppercase' as const,
                letterSpacing: 0.5,
              }}
            >
              Мой рейтинг
            </Text>
            <Text
              style={{
                fontSize: fontSize.base,
                fontWeight: fontWeight.bold,
                color: colors.gray[900],
                marginTop: 2,
                textTransform: 'capitalize' as const,
              }}
            >
              {monthName}
            </Text>
            <Text style={{ fontSize: fontSize.xs, color: colors.gray[500], marginTop: 2 }}>
              <Text style={{ color: scoreColor, fontWeight: '700' }}>{me.score}%</Text> посещаемость · {me.full}/
              {me.total} смен
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.gray[300]} />
        </View>
      </TouchableOpacity>
    </AnimatedCard>
  );
}

function MasterDashboard() {
  const { user } = useAuth();
  const { data, isLoading } = useQuery<SalarySummary>({
    queryKey: ['salary', 'my-summary'],
    queryFn: async () => {
      const res = await salaryApi.getMy();
      return res.data;
    },
    staleTime: 30_000,
  });

  if (isLoading) return <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary[600]} />;
  if (!data) return <Text style={styles.errorBanner}>Не удалось загрузить данные</Text>;

  const initials =
    user?.fullName
      ?.split(' ')
      .map((w) => w[0])
      .join('')
      .slice(0, 2) || 'М';

  return (
    <View style={{ gap: spacing[4] }}>
      {/* Profile card */}
      <AnimatedCard index={0}>
        <LinearGradient colors={[colors.primary[600], colors.primary[700]]} style={styles.profileCard}>
          <View style={styles.profileRow}>
            <View style={styles.profileAvatar}>
              <Text style={styles.profileInitials}>{initials}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.profileGreeting}>{getGreeting()}</Text>
              <Text style={styles.profileName} numberOfLines={1}>
                {user?.fullName || 'Мастер'}
              </Text>
              <Text style={styles.profilePercent}>
                Услуги {data.salaryPercent}%{data.productSalaryPercent ? ` · Товары ${data.productSalaryPercent}%` : ''}
              </Text>
            </View>
          </View>
        </LinearGradient>
      </AnimatedCard>

      {/* Today stats */}
      <View style={styles.statsRow}>
        <AnimatedCard index={1} style={styles.statCard}>
          <Ionicons
            name="document-text-outline"
            size={18}
            color={colors.primary[600]}
            style={{ marginBottom: spacing[2] }}
          />
          <Text style={styles.statLabel}>Заказов сегодня</Text>
          <Text style={styles.statValue}>{data.todayChecks || '—'}</Text>
          <Text style={styles.statSub}>За месяц: {data.monthChecks ?? 0}</Text>
        </AnimatedCard>
        <AnimatedCard index={2} style={styles.statCard}>
          <Ionicons name="cash-outline" size={18} color={colors.green[600]} style={{ marginBottom: spacing[2] }} />
          <Text style={styles.statLabel}>Сегодня</Text>
          <Text style={styles.statValue}>{data.today ? formatMoney(data.today) : '—'}</Text>
          <Text style={styles.statSub}>За месяц: {formatMoney(data.month)}</Text>
        </AnimatedCard>
      </View>

      {/* Cash register */}
      <AnimatedCard index={3} style={styles.cashSection}>
        <Text style={styles.cashTitle}>КАССА СЕГОДНЯ</Text>
        <View style={styles.cashGrid}>
          {[
            {
              icon: 'cash-outline' as const,
              color: colors.green[600],
              bg: colors.green[50],
              amount: data.todayCash ?? 0,
              type: 'Наличные',
            },
            {
              icon: 'card-outline' as const,
              color: colors.blue[600],
              bg: colors.blue[50],
              amount: data.todayCard ?? 0,
              type: 'Карта',
            },
            {
              icon: 'shield-checkmark-outline' as const,
              color: colors.amber[600],
              bg: colors.amber[50],
              amount: data.todayWarranty ?? 0,
              type: 'Гарантия',
            },
          ].map((item) => (
            <View key={item.type} style={styles.cashItem}>
              <View style={[styles.cashIconBox, { backgroundColor: item.bg }]}>
                <Ionicons name={item.icon} size={16} color={item.color} />
              </View>
              <Text style={styles.cashAmount}>{formatMoney(item.amount)}</Text>
              <Text style={styles.cashType}>{item.type}</Text>
            </View>
          ))}
        </View>
      </AnimatedCard>

      {/* Earning structure */}
      {data.todayService || data.todayProduct ? (
        <AnimatedCard index={4} style={styles.card}>
          <Text style={styles.cashTitle}>СТРУКТУРА ЗАРАБОТКА СЕГОДНЯ</Text>
          <View style={styles.earningsRow}>
            <View style={[styles.earningBox, { backgroundColor: colors.blue[50] }]}>
              <Ionicons name="build-outline" size={16} color={colors.blue[600]} />
              <Text style={[styles.earningLabel, { color: colors.blue[600] }]}>С услуг</Text>
              <Text style={styles.earningValue}>{formatMoney(data.todayService ?? 0)}</Text>
            </View>
            <View style={[styles.earningBox, { backgroundColor: colors.green[50] }]}>
              <Ionicons name="cube-outline" size={16} color={colors.green[600]} />
              <Text style={[styles.earningLabel, { color: colors.green[600] }]}>С товаров</Text>
              <Text style={styles.earningValue}>{formatMoney(data.todayProduct ?? 0)}</Text>
            </View>
          </View>
        </AnimatedCard>
      ) : null}

      {/* My rating from reviews */}
      <MasterRatingCard userId={user?.id} />

      {/* Recent checks */}
      <MasterRecentChecks />

      {/* Product promotions — enhanced with photos */}
      {data.productPromotions &&
        data.productPromotions.length > 0 &&
        data.productPromotions.some((p) => p.percent > 0) && (
          <AnimatedCard index={5} style={styles.promoCard}>
            <View style={styles.promoHeader}>
              <View style={styles.promoIconBox}>
                <Ionicons name="gift-outline" size={22} color={colors.green[600]} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.promoTitle}>Бонус с товаров</Text>
                <Text style={styles.promoSub}>Продавай эти товары и получай % с прибыли</Text>
              </View>
            </View>
            <View style={{ paddingHorizontal: spacing[3], paddingBottom: spacing[3], gap: spacing[2] }}>
              {data.productPromotions
                .filter((p) => p.percent > 0)
                .map((promo) => {
                  const photoUrl = promo.photo ? getImageUrl(promo.photo) : null;
                  return (
                    <View key={promo.productId} style={styles.promoItem}>
                      {photoUrl ? (
                        <CachedImage source={{ uri: photoUrl }} style={styles.promoPhoto} />
                      ) : (
                        <View style={[styles.promoPhoto, styles.promoPhotoPlaceholder]}>
                          <Ionicons name="cube-outline" size={18} color={colors.gray[300]} />
                        </View>
                      )}
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.promoName} numberOfLines={1}>
                          {promo.productName}
                        </Text>
                        <Text style={styles.promoPrice}>Цена: {formatMoney(promo.sellPrice)}</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end', flexShrink: 0 }}>
                        <Text style={styles.promoBonus}>+{formatMoney(promo.estimatedBonus)}</Text>
                        <Text style={styles.promoPercent}>{promo.percent}% с прибыли</Text>
                      </View>
                    </View>
                  );
                })}
            </View>
            {data.productSalaryPercent && data.productSalaryPercent > 0 && (
              <View style={styles.promoFooter}>
                <Text style={styles.promoFooterText}>
                  Также <Text style={{ fontWeight: fontWeight.bold }}>{data.productSalaryPercent}%</Text> со всех
                  остальных товаров
                </Text>
              </View>
            )}
          </AnimatedCard>
        )}

      <MyAttendanceRankWidget userId={user?.id} />
    </View>
  );
}

// ── Today Quick Stats (owner) ──
// Three-stat ribbon: today revenue / profit / checks. Backed by
// checksApi.getDashboard which already aggregates server-side, so
// nothing here costs more than one HTTP call.
function TodayQuickStats() {
  const { data } = useQuery<DashboardStats>({
    queryKey: ['checks-dashboard'],
    queryFn: async () => {
      const res = await checksApi.getDashboard();
      return res.data;
    },
    staleTime: 30_000,
  });

  // While the (cache-first / SWR) data is undefined on cold start, render
  // a slim placeholder so the layout doesn't jump.
  const revenue = data?.todayRevenue ?? 0;
  const profit = data?.todayProfit ?? 0;
  const checks = data?.todayChecks ?? 0;

  return (
    <AnimatedCard index={0} style={styles.qsCard}>
      <View style={styles.qsHeaderRow}>
        <Ionicons name="sparkles-outline" size={14} color={colors.gray[500]} />
        <Text style={styles.qsHeaderText}>Сегодня</Text>
      </View>
      <View style={styles.qsStatsRow}>
        <View style={styles.qsStatItem}>
          <Text style={styles.qsStatLabel}>Выручка</Text>
          <Text style={styles.qsStatValue}>{formatMoney(revenue)}</Text>
        </View>
        <View style={styles.qsStatDivider} />
        <View style={styles.qsStatItem}>
          <Text style={styles.qsStatLabel}>Прибыль</Text>
          <Text style={[styles.qsStatValue, { color: colors.green[600] }]}>{formatMoney(profit)}</Text>
        </View>
        <View style={styles.qsStatDivider} />
        <View style={styles.qsStatItem}>
          <Text style={styles.qsStatLabel}>Чеков</Text>
          <Text style={[styles.qsStatValue, { color: colors.primary[600] }]}>{checks}</Text>
        </View>
      </View>
    </AnimatedCard>
  );
}

// ── Low Stock Widget (owner) ──
// Top 5 products at or below their minStock threshold. Tap → Warehouse tab.
// Hidden when nothing is low — empty state would be visual noise.
function LowStockWidget() {
  const navigation = useNavigation<any>();
  const { data } = useQuery<Product[]>({
    queryKey: ['low-stock'],
    queryFn: async () => {
      const res = await productsApi.getLowStock();
      return res.data;
    },
    staleTime: 60_000,
  });

  const items = (data ?? []).slice(0, 5);
  if (items.length === 0) return null;

  return (
    <AnimatedCard index={3} style={styles.card} onPress={() => navigation.navigate('Main', { screen: 'Products' })}>
      <View style={styles.widgetHeaderRow}>
        <View style={[styles.widgetIconBox, { backgroundColor: colors.amber[50] }]}>
          <Ionicons name="alert-circle-outline" size={16} color={colors.amber[600]} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.sectionTitle}>Низкий остаток</Text>
          <Text style={styles.widgetSubtitle}>
            {data && data.length > 5
              ? `Показано 5 из ${data.length}`
              : `${items.length} ${items.length === 1 ? 'товар' : 'товаров'}`}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={colors.gray[300]} />
      </View>
      <View style={{ marginTop: spacing[3], gap: spacing[2] }}>
        {items.map((p) => (
          <View key={p.id} style={styles.lowStockRow}>
            <Text style={styles.lowStockName} numberOfLines={1}>
              {p.name}
            </Text>
            <View style={styles.lowStockStockPill}>
              <Text style={styles.lowStockStockText}>
                {p.stock} / {p.minStock} шт
              </Text>
            </View>
          </View>
        ))}
      </View>
    </AnimatedCard>
  );
}

// ── Missed Calls Widget (owner) ──
// Today's missed + not-called-back. Hidden when both are zero.
function MissedCallsWidget() {
  const navigation = useNavigation<any>();
  const today = new Date().toISOString().slice(0, 10);
  const { data } = useQuery({
    queryKey: ['calls-summary', today],
    queryFn: async () => {
      const res = await callsApi.getCalls({ date: today });
      return res.data.summary;
    },
    staleTime: 60_000,
  });

  const missed = data?.missed ?? 0;
  const notCalledBack = data?.notCalledBack ?? 0;
  if (missed === 0 && notCalledBack === 0) return null;

  return (
    <AnimatedCard index={4} style={styles.card} onPress={() => navigation.navigate('MoreTab', { screen: 'Calls' })}>
      <View style={styles.widgetHeaderRow}>
        <View style={[styles.widgetIconBox, { backgroundColor: colors.red[50] }]}>
          <Ionicons name="call-outline" size={16} color={colors.red[600]} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.sectionTitle}>Звонки сегодня</Text>
          <Text style={styles.widgetSubtitle}>Требуют внимания</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={colors.gray[300]} />
      </View>
      <View style={styles.callsStatsRow}>
        <View style={styles.callsStatItem}>
          <Text style={[styles.callsStatValue, { color: colors.red[600] }]}>{missed}</Text>
          <Text style={styles.callsStatLabel}>Пропущено</Text>
        </View>
        <View style={styles.qsStatDivider} />
        <View style={styles.callsStatItem}>
          <Text style={[styles.callsStatValue, { color: colors.amber[600] }]}>{notCalledBack}</Text>
          <Text style={styles.callsStatLabel}>Не перезвонили</Text>
        </View>
      </View>
    </AnimatedCard>
  );
}

// ── Owner Command Center (iter#12 redesign) ─────────────────────────
//
// Премиальный single-card command center владельца. Один цельный блок,
// без россыпи мелких карточек, без слабой плашки «Бизнес сегодня» из
// предыдущей итерации.
//
// Архитектура:
//   • Один большой контейнер со светлым фоном и тонкой границей
//     (или Liquid Glass поверх gray-50 — на выбор стиля). На iOS hero
//     сидит на BlurView (`GlassSurface`) — это даёт настоящий iOS 16+
//     frosted look и автоматически апгрейдится до UIGlassEffect на
//     iOS 26 через runtime class lookup в нашем native module.
//   • Сегментированный pill-control «Сегодня / Вчера / 7 дней / 30 дней»
//     с плавным сдвигом thumb (Animated.timing на translateX).
//   • Hero-тайл: огромное число выручки (SF Rounded look — bold + tight
//     letter-spacing) + дельта vs прошлого периода в виде pill.
//   • Hairline divider под hero.
//   • Triplet вторичных метрик: Прибыль, Чеков, Средний чек — каждый со
//     своей дельтой. Тап по «Чеков» → Журнал.
//
// Данные:
//   • `checksApi.getDashboardChart(period, offset)` — уже агрегирует на
//     бэке (`{ totalRevenue, totalProfit, totalChecks }`).
//   • Параллельный запрос (period, offset-1) для дельт.
//   • Средний чек = revenue / checks (guard вокруг деления на 0).
//   • Никаких выдуманных метрик. Нули = показываем нули; «—» в дельте,
//     если сравнивать не с чем (предыдущий период тоже пуст).
//
// Перенос на Android/Web:
//   • Android — `GlassSurface` сам делает fallback на translucent panel
//     (без BlurView). Cегмент-control работает как есть.
//   • Web — frontend/ может зеркально использовать ту же визуальную
//     иерархию: pill-tabs, big hero number, triplet under hairline. Но
//     на web лучше использовать CSS `backdrop-filter: blur(20px)` для
//     hero, а не RN BlurView.
const PERIOD_TABS = [
  { key: 'today', label: 'Сегодня', period: 'today' as const, offset: 0 },
  { key: 'yday', label: 'Вчера', period: 'today' as const, offset: -1 },
  { key: 'w', label: '7 дней', period: 'week' as const, offset: 0 },
  { key: 'm', label: '30 дней', period: 'month' as const, offset: 0 },
] as const;

type PeriodTabKey = (typeof PERIOD_TABS)[number]['key'];

interface PeriodTotals {
  totalRevenue: number;
  totalProfit: number;
  totalChecks: number;
}

function usePeriodChart(period: 'today' | 'week' | 'month' | 'year', offset: number, enabled: boolean) {
  return useQuery<PeriodTotals>({
    queryKey: ['dashboard-chart', period, offset],
    queryFn: async () => {
      const res = await checksApi.getDashboardChart(period, offset);
      return {
        totalRevenue: res.data.totalRevenue || 0,
        totalProfit: res.data.totalProfit || 0,
        totalChecks: res.data.totalChecks || 0,
      };
    },
    staleTime: 60_000,
    enabled,
    placeholderData: (prev) => prev,
  });
}

function formatDelta(curr: number, prev: number): { text: string; tone: 'up' | 'down' | 'flat' } {
  if (!isFinite(curr) || !isFinite(prev)) return { text: '—', tone: 'flat' };
  if (prev === 0 && curr === 0) return { text: '—', tone: 'flat' };
  if (prev === 0) return { text: '∙', tone: curr > 0 ? 'up' : 'flat' };
  const diff = curr - prev;
  const pct = (diff / Math.max(Math.abs(prev), 1)) * 100;
  const rounded = Math.round(pct);
  if (rounded === 0) return { text: '0%', tone: 'flat' };
  return { text: `${rounded > 0 ? '+' : ''}${rounded}%`, tone: rounded > 0 ? 'up' : 'down' };
}

function OwnerCommandCenter() {
  const navigation = useNavigation<any>();
  const [tabKey, setTabKey] = useState<PeriodTabKey>('today');
  const tab = PERIOD_TABS.find((t) => t.key === tabKey) ?? PERIOD_TABS[0];
  const segWidth = useRef(new Animated.Value(0)).current;
  const [segContainerWidth, setSegContainerWidth] = useState(0);

  // Текущий и предыдущий периоды — параллельные запросы, оба с одним и
  // тем же queryFn-сигнатурой (period, offset). Стандартный SWR кеш
  // означает, что при переключении вкладок данные подгружаются один раз.
  const curr = usePeriodChart(tab.period, tab.offset, true);
  const prev = usePeriodChart(tab.period, tab.offset - 1, true);

  const c: PeriodTotals = curr.data ?? { totalRevenue: 0, totalProfit: 0, totalChecks: 0 };
  const p: PeriodTotals = prev.data ?? { totalRevenue: 0, totalProfit: 0, totalChecks: 0 };
  const avg = c.totalChecks > 0 ? c.totalRevenue / c.totalChecks : 0;
  const prevAvg = p.totalChecks > 0 ? p.totalRevenue / p.totalChecks : 0;

  const dRev = formatDelta(c.totalRevenue, p.totalRevenue);
  const dProf = formatDelta(c.totalProfit, p.totalProfit);
  const dChk = formatDelta(c.totalChecks, p.totalChecks);
  const dAvg = formatDelta(avg, prevAvg);

  const isLoadingFirst = curr.data === undefined && curr.isLoading;
  const activeIndex = PERIOD_TABS.findIndex((t) => t.key === tabKey);

  // Smooth thumb slide. Width делим на N равных сегментов.
  React.useEffect(() => {
    if (segContainerWidth <= 0) return;
    const target = (segContainerWidth / PERIOD_TABS.length) * activeIndex;
    Animated.timing(segWidth, {
      toValue: target,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [activeIndex, segContainerWidth, segWidth]);

  // Метка периода под hero — даёт контекст к большому числу выручки.
  const periodLabel: Record<PeriodTabKey, string> = {
    today: 'за сегодня',
    yday: 'за вчера',
    w: 'за 7 дней',
    m: 'за 30 дней',
  };

  return (
    <View style={styles.occShell}>
      <AnimatedCard index={0} style={styles.occCard}>
        {/* Сегментированный pill-control с анимированным thumb-ом.
            На iOS читается как iOS-native segmented с лёгким frost-feel
            благодаря тонкой границе и off-white фону. */}
        <View style={styles.occSegment} onLayout={(e) => setSegContainerWidth(e.nativeEvent.layout.width - 6)}>
          {segContainerWidth > 0 && (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.occSegmentThumb,
                {
                  width: segContainerWidth / PERIOD_TABS.length,
                  transform: [{ translateX: segWidth }],
                },
              ]}
            />
          )}
          {PERIOD_TABS.map((t) => {
            const active = t.key === tabKey;
            return (
              <TouchableOpacity
                key={t.key}
                activeOpacity={0.7}
                onPress={() => setTabKey(t.key)}
                style={styles.occSegmentBtn}
              >
                <Text style={[styles.occSegmentText, active && styles.occSegmentTextActive]}>{t.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* HERO: огромная выручка + delta-pill. Заголовок и контекст
            периода — на уровне eyebrow, чтобы не отвлекать от числа. */}
        <View style={styles.occHero}>
          <View style={styles.occHeroHeaderRow}>
            <Text style={styles.occHeroEyebrow}>Выручка {periodLabel[tabKey]}</Text>
            <DeltaPill delta={dRev} />
          </View>
          <Text style={styles.occHeroValue} numberOfLines={1}>
            {isLoadingFirst ? '…' : formatMoney(c.totalRevenue)}
          </Text>
        </View>

        {/* Hairline divider — чёткое визуальное отделение hero от триплета. */}
        <View style={styles.occDivider} />

        {/* Триплет вторичных метрик. Прибыль / Чеков / Средний чек.
            Каждый — со своей дельтой. Чеков — кликабельный shortcut в
            журнал, чтобы за один тап перейти к деталям. */}
        <View style={styles.occGrid}>
          <OccTile
            label="Прибыль"
            value={isLoadingFirst ? '…' : formatMoney(c.totalProfit)}
            delta={dProf}
            tone="green"
          />
          <View style={styles.occGridDivider} />
          <OccTile
            label="Чеков"
            value={isLoadingFirst ? '…' : String(c.totalChecks)}
            delta={dChk}
            tone="blue"
            onPress={() => navigation.navigate('Checks', { screen: 'ChecksHome' })}
          />
          <View style={styles.occGridDivider} />
          <OccTile label="Средний чек" value={isLoadingFirst ? '…' : formatMoney(avg)} delta={dAvg} tone="purple" />
        </View>
      </AnimatedCard>
    </View>
  );
}

interface OccTileProps {
  label: string;
  value: string;
  delta: { text: string; tone: 'up' | 'down' | 'flat' };
  tone: 'green' | 'blue' | 'purple';
  onPress?: () => void;
}
function OccTile({ label, value, delta, onPress }: OccTileProps) {
  const Wrap = onPress ? TouchableOpacity : View;
  return (
    <Wrap activeOpacity={0.7} onPress={onPress as any} style={styles.occTile}>
      <Text style={styles.occTileLabel}>{label}</Text>
      <Text style={styles.occTileValue} numberOfLines={1}>
        {value}
      </Text>
      <DeltaPill delta={delta} small />
    </Wrap>
  );
}

function DeltaPill({ delta, small }: { delta: { text: string; tone: 'up' | 'down' | 'flat' }; small?: boolean }) {
  const palette =
    delta.tone === 'up'
      ? { bg: colors.green[50], fg: colors.green[700], icon: 'arrow-up' as const }
      : delta.tone === 'down'
        ? { bg: colors.red[50], fg: colors.red[700], icon: 'arrow-down' as const }
        : { bg: colors.gray[100], fg: colors.gray[500], icon: 'remove' as const };

  return (
    <View style={[styles.deltaPill, { backgroundColor: palette.bg }, small && styles.deltaPillSmall]}>
      <Ionicons name={palette.icon} size={small ? 9 : 11} color={palette.fg} />
      <Text style={[styles.deltaPillText, { color: palette.fg, fontSize: small ? 10 : 11 }]}>{delta.text}</Text>
    </View>
  );
}

// ── Admin Dashboard ──
//
// Глубокая аналитика (тяжёлый chart Сегодня/Неделя/Месяц/Год) умышленно
// удалена с главной владельца — он не нужен на every-day экране и
// делает Dashboard визуально перегруженным "веб-style". Графики и
// исторические периоды живут в разделе «Отчёты» (ReportsScreen).
//
// Что остаётся на главной — только то, что владелец смотрит каждый день:
//   • OwnerCommandCenter — большой premium-виджет с периодами (Сегодня /
//     Вчера / 7 дней / 30 дней) и дельтой vs прошлого периода;
//   • StaffStatus — кто на смене;
//   • LowStockWidget — товары на исходе;
//   • MissedCallsWidget — пропущенные звонки.
//
// Что удалено по запросу владельца после iPhone-теста:
//   • TodayQuickStats — слабая трёхстатная плашка;
//   • EmployeeRankingSection — рейтинг сотрудников на главной не нужен,
//     эта аналитика живёт в карточке сотрудника / разделе «Сотрудники».
function AdminDashboard() {
  const { user } = useAuth();
  const isOwner = user?.role === UserRole.DIRECTOR || user?.role === UserRole.SUPERADMIN;

  return (
    <View style={{ gap: spacing[4] }}>
      {isOwner && <OwnerCommandCenter />}
      <StaffStatus />
      {isOwner && <LowStockWidget />}
      {isOwner && <MissedCallsWidget />}
    </View>
  );
}

// ── Quick Actions ──
function QuickActions() {
  const navigation = useNavigation<any>();
  const { hasPermission } = useAuth();

  const actions = [
    {
      label: 'Новый чек',
      screen: 'CheckCreate',
      perm: 'checks_create',
      icon: 'add-circle-outline' as const,
      color: colors.primary[600],
      bg: colors.primary[50],
    },
    {
      label: 'Клиенты',
      screen: 'Clients',
      perm: 'clients_view',
      icon: 'people-outline' as const,
      color: colors.blue[600],
      bg: colors.blue[50],
    },
    {
      label: 'Журнал',
      tab: 'Checks',
      perm: 'checks_view',
      icon: 'receipt-outline' as const,
      color: colors.teal[600],
      bg: colors.teal[50],
    },
    {
      label: 'Отчёты',
      screen: 'Reports',
      perm: 'financial_reports',
      icon: 'bar-chart-outline' as const,
      color: colors.purple[700],
      bg: colors.purple[50],
    },
  ].filter((a) => !a.perm || hasPermission(a.perm as any));

  if (actions.length === 0) return null;

  const btnWidth = (SCREEN_WIDTH - spacing[4] * 2 - spacing[3]) / 2;

  return (
    <View>
      <Text style={[styles.sectionTitle, { marginBottom: spacing[3] }]}>Быстрые действия</Text>
      <View style={styles.quickGrid}>
        {actions.map((action, idx) => (
          <AnimatedCard
            key={action.label}
            index={idx}
            style={[styles.quickItem, { width: btnWidth }]}
            onPress={() => {
              if (action.tab) {
                navigation.navigate('Main', { screen: action.tab });
              } else if (action.screen) {
                navigation.navigate(action.screen);
              }
            }}
          >
            <View style={[styles.quickIconBox, { backgroundColor: action.bg }]}>
              <Ionicons name={action.icon} size={22} color={action.color} />
            </View>
            <Text style={styles.quickLabel} numberOfLines={1}>
              {action.label}
            </Text>
          </AnimatedCard>
        ))}
      </View>
    </View>
  );
}

// ── Main Dashboard ──
export default function DashboardScreen() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const tabBarHeight = useTabBarHeight();
  const insetsTop = useSafeAreaInsets().top;
  const isMaster = user?.role === UserRole.MASTER;
  const isOwner = user?.role === UserRole.DIRECTOR || user?.role === UserRole.SUPERADMIN;
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries();
    setRefreshing(false);
  };

  const greeting = getGreeting();
  const displayName = user?.fullName?.split(' ')[0] || '';

  return (
    /* Edge-to-edge wrapper: plain View, no SafeAreaView. The screen
       background fills the WHOLE viewport including the status bar zone
       and the area behind the floating tab bar. Safe-area top is
       applied to the scroll content, NOT to an outer frame, so the
       app reads as one continuous canvas instead of "content in a
       window with a separate status-bar strip above it". */
    <View style={styles.safe}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent2, { paddingTop: insetsTop + spacing[2] }]}
        // iOS: contentInset.bottom lets scroll content flow UNDER the
        // floating glass tab bar instead of stopping above it. The
        // tab-bar-height-sized inset means the user can still scroll
        // the last item above the bar; in between the last item and
        // the inset edge nothing is drawn — but the visible region
        // BEHIND the glass is the scroll content itself, which is
        // exactly the "screen continues under the bar" feel iOS uses
        // in Mail / Settings / Music.
        contentInset={{ bottom: tabBarHeight }}
        scrollIndicatorInsets={{ bottom: tabBarHeight }}
        automaticallyAdjustContentInsets={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />
        }
      >
        {/* Header for non-masters */}
        {!isMaster && (
          <View style={styles.headerSection}>
            <Text style={styles.headerTitle}>
              {greeting}, {displayName}!
            </Text>
            <Text style={styles.headerSub}>Обзор показателей автосервиса</Text>
          </View>
        )}

        {/* Shift control (not for owner) */}
        {!isOwner && <ShiftControl />}

        {/* Dashboard content */}
        {isMaster ? <MasterDashboard /> : <AdminDashboard />}

        {/* Quick actions */}
        <QuickActions />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.gray[50] },
  scroll: { flex: 1 },
  // paddingBottom 120 reserves space for the floating iOS tab bar (60+8+34+18)
  // No paddingBottom here — contentInset on the ScrollView (iOS) handles
  // it natively so content flows visibly under the glass tab bar.
  scrollContent2: { padding: spacing[4], gap: spacing[4] },
  headerSection: { marginBottom: spacing[1] },
  headerTitle: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.gray[900] },
  headerSub: { fontSize: fontSize.xs, color: colors.gray[400], marginTop: 2 },
  card: {
    backgroundColor: colors.white,
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    borderColor: colors.gray[100],
    padding: spacing[4],
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  sectionTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900] },

  // Today Quick Stats — compact 3-stat ribbon at the top of the owner
  // dashboard. Prefixed `qs*` to avoid collision with the `todayStat*`
  // styles RevenueChart already uses for its empty-state.
  qsCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    borderColor: colors.gray[100],
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  qsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: spacing[2],
  },
  qsHeaderText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.gray[500],
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  qsStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  qsStatItem: {
    flex: 1,
    alignItems: 'flex-start',
  },
  qsStatLabel: {
    fontSize: 11,
    color: colors.gray[400],
    fontWeight: '500',
  },
  qsStatValue: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: colors.gray[900],
    marginTop: 2,
    letterSpacing: -0.3,
  },
  qsStatDivider: {
    width: StyleSheet.hairlineWidth,
    height: 28,
    backgroundColor: colors.gray[200],
    marginHorizontal: spacing[3],
  },

  // Widget header (icon + title + chevron)
  widgetHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  widgetIconBox: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  widgetSubtitle: {
    fontSize: 11,
    color: colors.gray[400],
    marginTop: 1,
  },

  // Low stock rows
  lowStockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  lowStockName: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.gray[900],
    fontWeight: '500',
  },
  lowStockStockPill: {
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: borderRadius.full,
    backgroundColor: colors.amber[50],
  },
  lowStockStockText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.amber[600],
  },

  // Calls widget
  callsStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing[3],
  },
  callsStatItem: {
    flex: 1,
    alignItems: 'flex-start',
  },
  callsStatValue: {
    fontSize: fontSize['2xl'],
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  callsStatLabel: {
    fontSize: 11,
    color: colors.gray[400],
    marginTop: 2,
    fontWeight: '500',
  },

  // Chart
  chartCard: {
    borderRadius: borderRadius['3xl'],
    overflow: 'hidden',
    shadowColor: colors.black,
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
  },
  chartGradient: { padding: spacing[5], borderRadius: borderRadius['3xl'] },
  chartSubLabel: {
    fontSize: 10,
    fontWeight: fontWeight.semibold,
    color: colors.slate[400],
    letterSpacing: 2,
    marginBottom: spacing[2],
  },
  periodTabs: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: borderRadius.xl,
    padding: 3,
    marginBottom: spacing[2],
  },
  periodTab: { flex: 1, paddingVertical: spacing[2], borderRadius: borderRadius.lg, alignItems: 'center' },
  periodTabActive: { backgroundColor: 'rgba(255,255,255,0.2)' },
  periodTabText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.slate[400] },
  periodTabTextActive: { color: colors.white },
  navRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing[3] },
  navBtn: { padding: spacing[1.5], borderRadius: borderRadius.lg, backgroundColor: 'rgba(255,255,255,0.05)' },
  navBtnDisabled: { opacity: 0.2 },
  navLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.slate[300] },
  chartBody: { gap: spacing[1] },
  xAxisLabels: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: spacing[1] },
  xAxisLabel: { fontSize: 9, color: colors.slate[500], textAlign: 'center', flex: 1 },
  todayStat: { alignItems: 'center', paddingVertical: spacing[6] },
  todayStatValue: { fontSize: fontSize['3xl'], fontWeight: fontWeight.bold, color: colors.white },
  todayStatSub: { fontSize: fontSize.xs, color: colors.slate[400], marginTop: 4 },
  chartEmpty: { fontSize: fontSize.sm, color: colors.slate[500], textAlign: 'center', paddingVertical: spacing[8] },
  chartStats: {
    flexDirection: 'row',
    marginTop: spacing[4],
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: borderRadius.xl,
    overflow: 'hidden',
  },
  chartStatItem: { flex: 1, paddingVertical: spacing[3], alignItems: 'center' },
  chartStatBorder: { borderLeftWidth: 1, borderLeftColor: 'rgba(255,255,255,0.05)' },
  chartStatLabel: {
    fontSize: 10,
    fontWeight: fontWeight.medium,
    color: colors.slate[500],
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  chartStatValue: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.white, marginTop: 2 },
  chartDetailsScroll: { marginTop: spacing[3] },
  chartDetailCard: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    marginRight: spacing[2],
    minWidth: 64,
    alignItems: 'center',
  },
  chartDetailDate: { fontSize: 9, color: colors.slate[500], fontWeight: fontWeight.medium },
  chartDetailRevenue: { fontSize: 11, fontWeight: fontWeight.bold, color: colors.blue[300] },
  chartDetailProfit: { fontSize: 9, color: colors.cyan[400] },
  // Shift
  shiftRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  shiftLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  shiftIcon: { width: 40, height: 40, borderRadius: borderRadius.xl, alignItems: 'center', justifyContent: 'center' },
  shiftIconOpen: { backgroundColor: colors.green[100] },
  shiftIconClosed: { backgroundColor: colors.gray[100] },
  shiftTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  shiftSince: { fontSize: fontSize.xs, color: colors.gray[400] },
  shiftCloseBtn: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2.5],
    backgroundColor: colors.red[50],
    borderRadius: borderRadius.xl,
  },
  shiftCloseBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.red[600] },
  shiftOpenBtn: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2.5],
    backgroundColor: colors.green[50],
    borderRadius: borderRadius.xl,
  },
  shiftOpenBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.green[600] },
  // Staff
  staffGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  staffItem: { width: '20%', alignItems: 'center', gap: spacing[1], marginBottom: spacing[3] },
  staffCircle: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  staffInitials: { fontSize: fontSize.xs, fontWeight: fontWeight.bold, color: colors.white },
  staffName: { fontSize: 10, color: colors.gray[500], maxWidth: 60, textAlign: 'center' },
  // Ranking
  rankingHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing[3],
  },
  tabRow: { flexDirection: 'row', backgroundColor: colors.gray[100], borderRadius: borderRadius.lg, padding: 2 },
  tabBtn: { paddingHorizontal: spacing[3], paddingVertical: spacing[1.5], borderRadius: borderRadius.md },
  tabBtnActive: {
    backgroundColor: colors.white,
    shadowColor: colors.black,
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  tabBtnText: { fontSize: fontSize.xs, fontWeight: fontWeight.medium, color: colors.gray[500] },
  tabBtnTextActive: { color: colors.gray[900] },
  rankingEmpty: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing[8], gap: spacing[2] },
  rankingEmptyText: { fontSize: fontSize.sm, color: colors.gray[400] },
  // Podium
  podiumContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'flex-end',
    gap: spacing[3],
    marginBottom: spacing[4],
    paddingTop: spacing[2],
  },
  podiumItem: { alignItems: 'center', flex: 1, maxWidth: 100 },
  podiumItemFirst: { marginBottom: spacing[2] },
  podiumCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[1.5],
    shadowColor: colors.black,
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  podiumCircleFirst: { width: 60, height: 60, borderRadius: 30 },
  podiumPosition: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.gray[700] },
  podiumPositionFirst: { fontSize: fontSize.xl },
  podiumName: { fontSize: 11, fontWeight: fontWeight.semibold, color: colors.gray[700], textAlign: 'center' },
  podiumNameFirst: { fontSize: fontSize.xs, color: colors.gray[900] },
  podiumRevenue: { fontSize: 10, fontWeight: fontWeight.bold, color: colors.gray[500], marginTop: 2 },
  podiumRevenueFirst: { fontSize: 11, color: colors.gray[900] },
  // Ranking list (below podium)
  rankingList: { borderTopWidth: 1, borderTopColor: colors.gray[100], paddingTop: spacing[2] },
  rankingListRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing[2.5] },
  rankingListRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.gray[50] },
  rankingListNum: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.gray[50],
    marginRight: spacing[3],
  },
  rankingListNumText: { fontSize: fontSize.xs, fontWeight: fontWeight.bold, color: colors.gray[400] },
  rankInfo: { flex: 1, minWidth: 0 },
  rankName: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  rankSub: { fontSize: 11, color: colors.gray[400] },
  rankRevenue: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900] },
  emptyText: { textAlign: 'center', padding: spacing[8], fontSize: fontSize.sm, color: colors.gray[400] },
  // Profile
  profileCard: { borderRadius: borderRadius['2xl'], padding: spacing[5] },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[4] },
  profileAvatar: {
    width: 64,
    height: 64,
    borderRadius: borderRadius['2xl'],
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileInitials: { fontSize: fontSize['2xl'], fontWeight: fontWeight.bold, color: colors.white },
  profileGreeting: { fontSize: fontSize.xs, color: 'rgba(255,255,255,0.6)' },
  profileName: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.white },
  profilePercent: { fontSize: fontSize.sm, color: 'rgba(255,255,255,0.7)' },
  // Stats
  statsRow: { flexDirection: 'row', gap: spacing[3] },
  statCard: {
    flex: 1,
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.gray[100],
    padding: spacing[4],
    shadowColor: colors.black,
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  statLabel: { fontSize: fontSize.xs, color: colors.gray[400], fontWeight: fontWeight.medium },
  statValue: { fontSize: fontSize['2xl'], fontWeight: fontWeight.bold, color: colors.gray[900], marginTop: spacing[1] },
  statSub: { fontSize: 11, color: colors.gray[400], marginTop: 2 },
  // Cash
  cashSection: {
    backgroundColor: colors.slate[50],
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    borderColor: colors.slate[200],
    padding: spacing[4],
  },
  cashTitle: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.slate[500],
    letterSpacing: 1,
    marginBottom: spacing[3],
  },
  cashGrid: { flexDirection: 'row', gap: spacing[2.5] },
  cashItem: {
    flex: 1,
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    padding: spacing[3],
    alignItems: 'center',
    shadowColor: colors.black,
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  cashIconBox: {
    width: 32,
    height: 32,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[1.5],
  },
  cashAmount: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900] },
  cashType: { fontSize: 10, color: colors.gray[400], marginTop: 2 },
  // Earnings
  earningsRow: { flexDirection: 'row', gap: spacing[3] },
  earningBox: { flex: 1, borderRadius: borderRadius.lg, padding: spacing[3], gap: spacing[1] },
  earningLabel: { fontSize: fontSize.xs, fontWeight: fontWeight.medium },
  earningValue: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.gray[900], marginTop: 4 },
  // Promo
  promoCard: {
    backgroundColor: colors.emerald[50],
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    borderColor: colors.green[200],
    overflow: 'hidden',
  },
  promoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2.5],
    padding: spacing[4],
    paddingBottom: spacing[2],
  },
  promoIconBox: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.xl,
    backgroundColor: colors.green[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  promoTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900] },
  promoSub: { fontSize: 11, color: colors.gray[500] },
  promoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2.5],
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    padding: spacing[3],
    shadowColor: colors.black,
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  promoPhoto: { width: 40, height: 40, borderRadius: borderRadius.lg },
  promoPhotoPlaceholder: { backgroundColor: colors.gray[100], alignItems: 'center', justifyContent: 'center' },
  promoName: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[900] },
  promoPrice: { fontSize: 11, color: colors.gray[400] },
  promoBonus: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.green[600] },
  promoPercent: { fontSize: 10, color: colors.gray[400] },
  promoFooter: {
    borderTopWidth: 1,
    borderTopColor: colors.green[200],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2.5],
    backgroundColor: 'rgba(236,253,245,0.5)',
  },
  promoFooterText: { fontSize: fontSize.xs, color: colors.green[700] },
  // Error
  errorBanner: {
    backgroundColor: colors.red[50],
    borderRadius: borderRadius.xl,
    padding: spacing[4],
    fontSize: fontSize.sm,
    color: colors.red[700],
    textAlign: 'center',
    margin: spacing[4],
  },
  // Quick actions
  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[3] },
  quickItem: {
    backgroundColor: colors.white,
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    borderColor: colors.gray[100],
    paddingVertical: spacing[4],
    paddingHorizontal: spacing[3],
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    shadowColor: colors.black,
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  quickIconBox: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[700], flexShrink: 1 },

  // ── Owner Command Center (iter#12) ─────────────────────────────────
  occShell: { paddingHorizontal: 0 },
  occCard: {
    backgroundColor: colors.white,
    borderRadius: 28,
    paddingHorizontal: spacing[5],
    paddingTop: spacing[4],
    paddingBottom: spacing[5],
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.06)',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.07,
    shadowRadius: 24,
    elevation: 3,
  },

  // Сегмент-control: «капсула» с тонкой границей и животным thumb-ом.
  // Thumb рисуется как absolute-белая плашка под текстом, plain text сверху.
  occSegment: {
    flexDirection: 'row',
    backgroundColor: 'rgba(15, 23, 42, 0.05)',
    borderRadius: borderRadius.full,
    padding: 3,
    height: 36,
    position: 'relative',
  },
  occSegmentThumb: {
    position: 'absolute',
    top: 3,
    left: 3,
    bottom: 3,
    backgroundColor: colors.white,
    borderRadius: borderRadius.full,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  occSegmentBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  occSegmentText: {
    fontSize: 13,
    fontWeight: fontWeight.medium,
    color: colors.gray[500],
    letterSpacing: -0.1,
  },
  occSegmentTextActive: { color: colors.gray[900], fontWeight: '700' },

  // Hero — eyebrow слева, delta справа на одной линии. Огромное число
  // выручки внизу. SF San Francisco system font + tight tracking + tabular
  // numerals дают «дорогой» iOS Wallet/Apple Card вид.
  occHero: {
    paddingTop: spacing[4],
    paddingBottom: spacing[4],
  },
  occHeroHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing[2],
  },
  occHeroEyebrow: {
    fontSize: 12,
    fontWeight: fontWeight.semibold,
    color: colors.gray[500],
    letterSpacing: -0.1,
  },
  occHeroValue: {
    fontSize: 40,
    fontWeight: '800',
    color: colors.gray[900],
    letterSpacing: -1.6,
    fontVariant: ['tabular-nums'],
  },

  occDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(15, 23, 42, 0.08)',
    marginHorizontal: -spacing[5],
  },

  // Триплет — три тайла на одной горизонтали, разделены вертикальными
  // hairline-чертами. Чисто iOS Stocks / Health-style "metric row".
  occGrid: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingTop: spacing[4],
  },
  occGridDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    backgroundColor: 'rgba(15, 23, 42, 0.08)',
    marginHorizontal: spacing[1],
  },
  occTile: {
    flex: 1,
    minWidth: 0,
  },
  occTileLabel: {
    fontSize: 11,
    fontWeight: fontWeight.semibold,
    color: colors.gray[500],
    letterSpacing: -0.1,
    marginBottom: 4,
  },
  occTileValue: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.gray[900],
    letterSpacing: -0.4,
    fontVariant: ['tabular-nums'],
  },

  deltaPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: borderRadius.full,
    marginTop: 6,
  },
  deltaPillSmall: { paddingHorizontal: 6, paddingVertical: 2, marginTop: 4 },
  deltaPillText: { fontWeight: fontWeight.semibold, letterSpacing: -0.1 },
});
