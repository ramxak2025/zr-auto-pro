import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
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
  PanResponder,
  Platform,
  Pressable,
} from 'react-native';
import CachedImage from '../components/CachedImage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, {
  Path,
  Defs,
  LinearGradient as SvgGrad,
  Stop,
  Line,
  Circle,
  RadialGradient,
} from 'react-native-svg';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';
import {
  checksApi,
  salaryApi,
  shiftsApi,
  scheduleApi,
  marketingApi,
  callsApi,
  usersApi,
} from '../api/services';
import { getImageUrl } from '../api/axios';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import AnimatedCard from '../components/AnimatedCard';
import { Skeleton } from '../components/Skeleton';
import type {
  SalarySummary,
  EmployeeRanking,
  TodayEmployeeStatus,
  Shift,
  ScheduleEntry,
  User,
} from '../../../shared/types';
import { UserRole } from '../../../shared/types';
import { calculateAttendanceStats, attendanceScore, emptyBreakdown } from '../../../shared/utils/attendance';

const SCREEN_WIDTH = Dimensions.get('window').width;

function formatMoney(value: number): string {
  const rounded = Math.round(value);
  return rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽';
}

/** Compact money for KPI tiles — "124k" / "1.2m" instead of "124 360 ₽". */
function formatMoneyCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace('.0', '')}M ₽`;
  if (abs >= 100_000) return `${Math.round(value / 1000)}k ₽`;
  if (abs >= 10_000) return `${(value / 1000).toFixed(1).replace('.0', '')}k ₽`;
  return `${Math.round(value)} ₽`;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'Доброе утро';
  if (hour >= 12 && hour < 17) return 'Добрый день';
  if (hour >= 17 && hour < 22) return 'Добрый вечер';
  return 'Доброй ночи';
}

const WEEKDAYS_RU = [
  'воскресенье',
  'понедельник',
  'вторник',
  'среда',
  'четверг',
  'пятница',
  'суббота',
];
const MONTHS_RU_GEN = [
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

function getTodayLongRu(): string {
  const d = new Date();
  return `${WEEKDAYS_RU[d.getDay()]}, ${d.getDate()} ${MONTHS_RU_GEN[d.getMonth()]}`;
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
  const months = MONTHS_RU_GEN;
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

function formatDeltaPct(curr: number, prev: number): { text: string; tone: 'up' | 'down' | 'flat' } {
  if (!isFinite(curr) || !isFinite(prev)) return { text: '—', tone: 'flat' };
  if (prev === 0 && curr === 0) return { text: '—', tone: 'flat' };
  if (prev === 0) return { text: curr > 0 ? '+∞' : '—', tone: curr > 0 ? 'up' : 'flat' };
  const diff = curr - prev;
  const pct = (diff / Math.max(Math.abs(prev), 1)) * 100;
  const rounded = Math.round(pct);
  if (rounded === 0) return { text: '0%', tone: 'flat' };
  return { text: `${rounded > 0 ? '+' : ''}${rounded}%`, tone: rounded > 0 ? 'up' : 'down' };
}

// ════════════════════════════════════════════════════════════════════════════
//  OWNER DASHBOARD — kardинально новый layout (iter#13, 2026-05-19)
// ════════════════════════════════════════════════════════════════════════════
//
// Премиальный 2026-SaaS owner dashboard. Стек hero-блоков сверху вниз:
//   1. Hero card (deep gradient + персональное приветствие + сегодня
//      заработано + дельта vs вчера).
//   2. KPI strip — 4 горизонтально-скроллируемых тайла со sparkline.
//   3. Аналитика — большая интерактивная диаграмма (scrub + segmented).
//   4. Сегодня — 2 horizontal-card snapshot row (На смене / Звонки).
//   5. Quick actions — 2×2 grid.
//   6. Топ-мастера месяца — last block.
//
// Все данные через существующие API-эндпоинты, без правок shared/.

// ── 1. HERO ─────────────────────────────────────────────────────────────────
// Глубокий primary 700→900 градиент с radial-glow в правом верхнем углу.
// Большое имя владельца, контекст-дата, hero-число выручки за сегодня и
// дельта vs вчерашнего значения.
//
// Данные:
//   • dashboard-chart('today', 0) — totalRevenue за сегодня.
//   • dashboard-chart('today', -1) — totalRevenue за вчера для дельты.
// Кеш-ключи совпадают с теми, что использует график ниже — переключение
// «сегодня» в графике сразу горячий.
function OwnerHero({ name }: { name: string }) {
  const today = useQuery({
    queryKey: ['dashboard-chart', 'today', 0],
    queryFn: async () => (await checksApi.getDashboardChart('today', 0)).data,
    staleTime: 30_000,
  });
  const yday = useQuery({
    queryKey: ['dashboard-chart', 'today', -1],
    queryFn: async () => (await checksApi.getDashboardChart('today', -1)).data,
    staleTime: 60_000,
  });

  const todayRevenue = today.data?.totalRevenue ?? 0;
  const ydayRevenue = yday.data?.totalRevenue ?? 0;
  const delta = useMemo(() => formatDeltaPct(todayRevenue, ydayRevenue), [todayRevenue, ydayRevenue]);
  const isLoading = today.data === undefined && today.isLoading;

  return (
    <AnimatedCard index={0} style={styles.heroCard}>
      <LinearGradient
        colors={[colors.primary[700], colors.primary[800], colors.primary[900]]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.heroGradient}
      >
        {/* Decorative radial sparkle — SVG so we get true radial gradient
            (RN can't do radial backgrounds). Very faint, doesn't compete
            with the typography. */}
        <Svg width={220} height={220} style={styles.heroSparkle} pointerEvents="none">
          <Defs>
            <RadialGradient id="heroGlow" cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor="#ffffff" stopOpacity={0.18} />
              <Stop offset="60%" stopColor="#ffffff" stopOpacity={0.04} />
              <Stop offset="100%" stopColor="#ffffff" stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={110} cy={110} r={110} fill="url(#heroGlow)" />
        </Svg>

        <View style={styles.heroTopRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroGreeting}>
              {getGreeting()}, {name || 'Владелец'}
            </Text>
            <Text style={styles.heroDate}>{getTodayLongRu()}</Text>
          </View>
          <View style={styles.heroAvatarDot} />
        </View>

        <View style={styles.heroValueBlock}>
          <Text style={styles.heroValueLabel}>Сегодня заработано</Text>
          {isLoading ? (
            <Skeleton
              width={220}
              height={36}
              radius={10}
              style={{ backgroundColor: 'rgba(255,255,255,0.10)' }}
            />
          ) : (
            <Text style={styles.heroValue} numberOfLines={1} adjustsFontSizeToFit>
              {formatMoney(todayRevenue)}
            </Text>
          )}
          <View style={styles.heroDeltaRow}>
            <View
              style={[
                styles.heroDeltaPill,
                delta.tone === 'up' && { backgroundColor: 'rgba(74,222,128,0.18)' },
                delta.tone === 'down' && { backgroundColor: 'rgba(248,113,113,0.20)' },
              ]}
            >
              <Ionicons
                name={delta.tone === 'up' ? 'arrow-up' : delta.tone === 'down' ? 'arrow-down' : 'remove'}
                size={11}
                color={
                  delta.tone === 'up' ? '#bbf7d0' : delta.tone === 'down' ? '#fecaca' : 'rgba(255,255,255,0.7)'
                }
              />
              <Text
                style={[
                  styles.heroDeltaText,
                  delta.tone === 'up' && { color: '#bbf7d0' },
                  delta.tone === 'down' && { color: '#fecaca' },
                ]}
              >
                {delta.text}
              </Text>
            </View>
            <Text style={styles.heroDeltaCaption}>vs вчера</Text>
          </View>
        </View>
      </LinearGradient>
    </AnimatedCard>
  );
}

// ── 2. KPI STRIP ────────────────────────────────────────────────────────────
// 4 горизонтально-скроллируемых квадратных тайла 144×144pt:
//   tiny title (Оборот / Прибыль / Чеков / Средний чек)
//   hero number 22pt 800
//   mini sparkline 7 точек (SVG)
//   delta chip ↑/↓ %
// Все 4 кликабельны → переход в соответствующий экран.
//
// Данные: shared query `dashboard-chart('week', 0)` (тот же ключ что и в
// диаграмме ниже — один сетевой вызов). + `('week', -1)` для дельты.

interface KpiTileSpec {
  key: 'revenue' | 'profit' | 'checks' | 'avg';
  title: string;
  format: 'money' | 'count';
  pickValue: (p: { revenue: number; profit: number; checkCount: number }) => number;
  total: (
    data: { totalRevenue: number; totalProfit: number; totalChecks: number },
    avgValue: number,
  ) => number;
  navTo: () => { stack: string; screen?: string } | null;
}

function KpiStrip() {
  const navigation = useNavigation<any>();
  const week = useQuery({
    queryKey: ['dashboard-chart', 'week', 0],
    queryFn: async () => (await checksApi.getDashboardChart('week', 0)).data,
    staleTime: 60_000,
  });
  const prevWeek = useQuery({
    queryKey: ['dashboard-chart', 'week', -1],
    queryFn: async () => (await checksApi.getDashboardChart('week', -1)).data,
    staleTime: 60_000,
  });

  const c = week.data;
  const p = prevWeek.data;
  const avg = c && c.totalChecks > 0 ? c.totalRevenue / c.totalChecks : 0;
  const prevAvg = p && p.totalChecks > 0 ? p.totalRevenue / p.totalChecks : 0;
  const isLoading = c === undefined && week.isLoading;

  const tiles: KpiTileSpec[] = useMemo(
    () => [
      {
        key: 'revenue',
        title: 'Оборот',
        format: 'money',
        pickValue: (pt) => pt.revenue || 0,
        total: (d) => d.totalRevenue,
        navTo: () => ({ stack: 'MoreTab', screen: 'Reports' }),
      },
      {
        key: 'profit',
        title: 'Прибыль',
        format: 'money',
        pickValue: (pt) => pt.profit || 0,
        total: (d) => d.totalProfit,
        navTo: () => ({ stack: 'MoreTab', screen: 'CashFlow' }),
      },
      {
        key: 'checks',
        title: 'Чеков',
        format: 'count',
        pickValue: (pt) => pt.checkCount || 0,
        total: (d) => d.totalChecks,
        navTo: () => ({ stack: 'Checks' }),
      },
      {
        key: 'avg',
        title: 'Средний чек',
        format: 'money',
        pickValue: (pt) => (pt.checkCount > 0 ? pt.revenue / pt.checkCount : 0),
        total: (_d, avgValue) => avgValue,
        navTo: () => ({ stack: 'MoreTab', screen: 'Reports' }),
      },
    ],
    [],
  );

  const points = c?.points ?? [];

  return (
    <View>
      <Text style={styles.sectionLabel}>ЗА 7 ДНЕЙ</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.kpiScrollContent}
        decelerationRate="fast"
        snapToInterval={144 + spacing[3]}
        snapToAlignment="start"
      >
        {tiles.map((spec, idx) => {
          const totalCurr = c ? spec.total(c, avg) : 0;
          const totalPrev = p ? spec.total(p, prevAvg) : 0;
          const delta = formatDeltaPct(totalCurr, totalPrev);
          const series = points.map(spec.pickValue);

          const handlePress = () => {
            const target = spec.navTo();
            if (!target) return;
            if (target.stack === 'Checks') {
              navigation.navigate('Main', { screen: 'Checks' });
            } else if (target.screen) {
              navigation.navigate('Main', {
                screen: target.stack,
                params: { screen: target.screen },
              });
            }
          };

          return (
            <KpiTile
              key={spec.key}
              index={idx}
              title={spec.title}
              value={
                isLoading
                  ? '…'
                  : spec.format === 'money'
                    ? formatMoneyCompact(totalCurr)
                    : String(Math.round(totalCurr))
              }
              series={series}
              delta={delta}
              onPress={handlePress}
              tone={
                spec.key === 'profit'
                  ? 'emerald'
                  : spec.key === 'checks'
                    ? 'sky'
                    : spec.key === 'avg'
                      ? 'violet'
                      : 'primary'
              }
            />
          );
        })}
      </ScrollView>
    </View>
  );
}

interface KpiTileProps {
  index: number;
  title: string;
  value: string;
  series: number[];
  delta: { text: string; tone: 'up' | 'down' | 'flat' };
  onPress: () => void;
  tone: 'primary' | 'emerald' | 'sky' | 'violet';
}

const KpiTile = React.memo(function KpiTile({
  index,
  title,
  value,
  series,
  delta,
  onPress,
  tone,
}: KpiTileProps) {
  const palette = {
    primary: { line: colors.primary[600], glow: colors.primary[200] },
    emerald: { line: colors.green[600], glow: colors.green[200] },
    sky: { line: colors.cyan[600], glow: colors.cyan[400] },
    violet: { line: colors.purple[600], glow: colors.purple[200] },
  }[tone];

  const W = 144 - spacing[3] * 2;
  const H = 28;
  const path = useMemo(() => buildSparkPath(series, W, H), [series, W, H]);
  const areaPath = useMemo(() => buildSparkAreaPath(series, W, H), [series, W, H]);

  return (
    <AnimatedCard index={index} style={styles.kpiTile} onPress={onPress}>
      <Text style={styles.kpiTileTitle}>{title}</Text>
      <Text style={styles.kpiTileValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <View style={styles.kpiTileSparkWrap}>
        {series.length > 1 ? (
          <Svg width={W} height={H}>
            <Defs>
              <SvgGrad id={`sparkGrad-${tone}`} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0%" stopColor={palette.glow} stopOpacity={0.55} />
                <Stop offset="100%" stopColor={palette.glow} stopOpacity={0} />
              </SvgGrad>
            </Defs>
            <Path d={areaPath} fill={`url(#sparkGrad-${tone})`} />
            <Path d={path} stroke={palette.line} strokeWidth={1.8} fill="none" strokeLinecap="round" />
          </Svg>
        ) : (
          <View style={{ width: W, height: H }} />
        )}
      </View>
      <View
        style={[
          styles.kpiDeltaPill,
          delta.tone === 'up' && { backgroundColor: colors.green[50] },
          delta.tone === 'down' && { backgroundColor: colors.red[50] },
        ]}
      >
        <Ionicons
          name={delta.tone === 'up' ? 'arrow-up' : delta.tone === 'down' ? 'arrow-down' : 'remove'}
          size={10}
          color={
            delta.tone === 'up'
              ? colors.green[700]
              : delta.tone === 'down'
                ? colors.red[700]
                : colors.gray[500]
          }
        />
        <Text
          style={[
            styles.kpiDeltaText,
            {
              color:
                delta.tone === 'up'
                  ? colors.green[700]
                  : delta.tone === 'down'
                    ? colors.red[700]
                    : colors.gray[500],
            },
          ]}
        >
          {delta.text}
        </Text>
      </View>
    </AnimatedCard>
  );
});

function buildSparkPath(values: number[], w: number, h: number): string {
  if (values.length < 2) return '';
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = Math.max(max - min, 1);
  const pts = values.map((v, i) => ({
    x: (i / (values.length - 1)) * w,
    y: h - 3 - ((v - min) / range) * (h - 6),
  }));
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];
    const cpx = (prev.x + curr.x) / 2;
    d += ` C ${cpx} ${prev.y}, ${cpx} ${curr.y}, ${curr.x} ${curr.y}`;
  }
  return d;
}

function buildSparkAreaPath(values: number[], w: number, h: number): string {
  const line = buildSparkPath(values, w, h);
  if (!line) return '';
  return `${line} L ${w} ${h} L 0 ${h} Z`;
}

// ── 3. OWNER ANALYTICS CHART ────────────────────────────────────────────────
// Бывший RevenueChart — СОХРАНЯЕМ scrub/tooltip/period-bar логику
// (commit f4017f4) и только визуально прокачиваем: больше высота (200pt),
// насыщенный blue→cyan blend на revenue, deeper shadow, iOS-segmented pills.
function OwnerAnalyticsChart() {
  const [period, setPeriod] = useState<ChartPeriod>('week');
  const [offset, setOffset] = useState(0);
  const animWidth = useRef(new Animated.Value(0)).current;
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-chart', period, offset],
    queryFn: async () => (await checksApi.getDashboardChart(period, offset)).data,
    staleTime: 30_000,
  });

  // Entrance tween — keyed on points-LENGTH not data, per hardening in
  // commit 2c6e4da. `data` is a fresh reference on every SWR refetch even
  // when values are identical, so depending on it would re-fire the
  // Animated.timing on every poll (wasted work + a known source of jank
  // and update-depth crashes).
  const pointsLen = data?.points?.length ?? 0;
  useEffect(() => {
    Animated.timing(animWidth, { toValue: 1, duration: 800, useNativeDriver: false }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointsLen]);

  useEffect(() => {
    setSelectedIdx((prev) => (prev === null ? prev : null));
  }, [period, offset, pointsLen]);

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

  const formatLabel = (dateStr: string): string => {
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
    return `${d.getDate()}`;
  };

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
  // iter#13: 200pt height (was 160) — chart reads as a primary surface,
  // not a thumbnail.
  const svgH = 200;
  const revVals = points.map((p: any) => p.revenue || 0);
  const profVals = points.map((p: any) => p.profit || 0);
  const maxProfit = Math.max(...profVals, 1);
  const overallMax = Math.max(maxValue, maxProfit, 1);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => points.length > 1,
        onMoveShouldSetPanResponder: () => points.length > 1,
        onPanResponderGrant: (e) => {
          const x = e.nativeEvent.locationX;
          const clamped = Math.max(0, Math.min(svgW, x));
          const idx = Math.round((clamped / svgW) * (points.length - 1));
          setSelectedIdx(idx);
        },
        onPanResponderMove: (e) => {
          const x = e.nativeEvent.locationX;
          const clamped = Math.max(0, Math.min(svgW, x));
          const idx = Math.round((clamped / svgW) * (points.length - 1));
          setSelectedIdx(idx);
        },
      }),
    [points.length, svgW],
  );

  const selPoint = selectedIdx !== null ? points[selectedIdx] : null;
  const selX = selectedIdx !== null && points.length > 1 ? (selectedIdx / (points.length - 1)) * svgW : 0;
  const selRevY = selPoint !== null ? svgH - ((selPoint.revenue || 0) / overallMax) * (svgH * 0.85) - 4 : 0;
  const selProfY = selPoint !== null ? svgH - ((selPoint.profit || 0) / overallMax) * (svgH * 0.85) - 4 : 0;

  const displayRevenue = selPoint ? selPoint.revenue || 0 : totalRevenue;
  const displayProfit = selPoint ? selPoint.profit || 0 : totalProfit;
  const displayChecks = selPoint ? selPoint.checkCount || 0 : totalChecks;
  const displayAvg = selPoint && selPoint.checkCount > 0 ? selPoint.revenue / selPoint.checkCount : null;

  const labelStep = period === 'month' ? (points.length > 15 ? 5 : 3) : 1;

  const TOOLTIP_W = 132;
  const tooltipLeft = Math.max(0, Math.min(svgW - TOOLTIP_W, selX - TOOLTIP_W / 2));

  const formatPointDate = (iso: string): string => {
    if (period === 'year') {
      const [y, m] = iso.split('-');
      const months = [
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
      return `${months[parseInt(m) - 1] ?? ''} ${y}`;
    }
    const d = new Date(iso);
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  };

  return (
    <AnimatedCard index={2} style={styles.chartCardLight}>
      <View style={styles.chartHeaderRow}>
        <View>
          <Text style={styles.chartHeaderTitle}>Аналитика</Text>
          <Text style={styles.chartHeaderSub}>{getOffsetLabel(period, offset)}</Text>
        </View>
        <View style={styles.chartNavRow}>
          <TouchableOpacity style={styles.chartNavBtn} onPress={() => setOffset((o) => o - 1)} hitSlop={6}>
            <Ionicons name="chevron-back" size={16} color={colors.gray[600]} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.chartNavBtn, offset >= 0 && styles.chartNavBtnDisabled]}
            onPress={() => setOffset((o) => (o < 0 ? o + 1 : 0))}
            disabled={offset >= 0}
            hitSlop={6}
          >
            <Ionicons name="chevron-forward" size={16} color={offset >= 0 ? colors.gray[300] : colors.gray[600]} />
          </TouchableOpacity>
        </View>
      </View>

      {/* iOS-segmented pill control */}
      <View style={styles.segCtl}>
        {(Object.keys(periodLabels) as ChartPeriod[]).map((p) => {
          const active = period === p;
          return (
            <TouchableOpacity
              key={p}
              style={[styles.segCtlBtn, active && styles.segCtlBtnActive]}
              onPress={() => handlePeriodChange(p)}
              activeOpacity={0.7}
            >
              <Text style={[styles.segCtlText, active && styles.segCtlTextActive]}>{periodLabels[p]}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {isLoading ? (
        <View style={{ height: svgH, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.primary[500]} />
        </View>
      ) : points.length > 1 ? (
        <View style={styles.chartBody}>
          <View style={{ height: svgH, width: svgW, position: 'relative' }} {...panResponder.panHandlers}>
            <Svg width={svgW} height={svgH} viewBox={`0 0 ${svgW} ${svgH}`}>
              <Defs>
                <SvgGrad id="revGradLight" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0%" stopColor={colors.primary[500]} stopOpacity={0.34} />
                  <Stop offset="100%" stopColor={colors.primary[500]} stopOpacity={0} />
                </SvgGrad>
                <SvgGrad id="profGradLight" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0%" stopColor={colors.cyan[400]} stopOpacity={0.2} />
                  <Stop offset="100%" stopColor={colors.cyan[400]} stopOpacity={0} />
                </SvgGrad>
              </Defs>
              {[0.25, 0.5, 0.75].map((pct) => (
                <Line
                  key={pct}
                  x1={0}
                  y1={svgH * (1 - pct)}
                  x2={svgW}
                  y2={svgH * (1 - pct)}
                  stroke={colors.gray[100]}
                  strokeWidth={1}
                />
              ))}
              <Path d={buildAreaPath(revVals, svgW, svgH, overallMax)} fill="url(#revGradLight)" />
              <Path
                d={buildWavePath(revVals, svgW, svgH, overallMax)}
                stroke={colors.primary[600]}
                strokeWidth={3}
                strokeLinecap="round"
                fill="none"
              />
              <Path d={buildAreaPath(profVals, svgW, svgH, overallMax)} fill="url(#profGradLight)" />
              <Path
                d={buildWavePath(profVals, svgW, svgH, overallMax)}
                stroke={colors.cyan[600]}
                strokeWidth={2}
                strokeLinecap="round"
                fill="none"
                strokeDasharray="4,4"
              />
              {selPoint !== null && (
                <>
                  <Line
                    x1={selX}
                    y1={0}
                    x2={selX}
                    y2={svgH}
                    stroke={colors.primary[400]}
                    strokeWidth={1}
                    strokeDasharray="3,3"
                  />
                  <Circle cx={selX} cy={selRevY} r={5.5} fill={colors.primary[600]} stroke="white" strokeWidth={2} />
                  <Circle cx={selX} cy={selProfY} r={4} fill={colors.cyan[600]} stroke="white" strokeWidth={1.5} />
                </>
              )}
            </Svg>

            {selPoint !== null && (
              <View
                style={[styles.scrubTooltipLight, { left: tooltipLeft, width: TOOLTIP_W }]}
                pointerEvents="none"
              >
                <Text style={styles.scrubTooltipDateLight}>{formatPointDate(selPoint.date)}</Text>
                <View style={styles.scrubTooltipRow}>
                  <View style={[styles.scrubDot, { backgroundColor: colors.primary[600] }]} />
                  <Text style={styles.scrubTooltipValueLight}>{formatMoney(selPoint.revenue || 0)}</Text>
                </View>
                <View style={styles.scrubTooltipRow}>
                  <View style={[styles.scrubDot, { backgroundColor: colors.cyan[600] }]} />
                  <Text style={styles.scrubTooltipValueLightSm}>{formatMoney(selPoint.profit || 0)}</Text>
                </View>
              </View>
            )}
          </View>

          {period !== 'today' && (
            <View style={styles.xAxisLabels}>
              {points.map((point: any, idx: number) => {
                const label = formatLabel(point.date);
                const show =
                  period === 'week' || period === 'year' || idx % labelStep === 0 || idx === points.length - 1;
                return (
                  <Text key={idx} style={styles.xAxisLabelLight}>
                    {show ? label : ''}
                  </Text>
                );
              })}
            </View>
          )}

          {selPoint === null && <Text style={styles.scrubHintLight}>Проведите по графику для деталей</Text>}
        </View>
      ) : points.length === 1 ? (
        <View style={styles.todayStatLight}>
          <Text style={styles.todayStatValueLight}>{formatMoney(totalRevenue)}</Text>
          <Text style={styles.todayStatSubLight}>Выручка за период</Text>
        </View>
      ) : (
        <Text style={styles.chartEmptyLight}>Нет данных за период</Text>
      )}

      {data && (
        <>
          <View style={styles.scopeBarLight}>
            <Text style={styles.scopeBarLabelLight}>
              {selPoint ? formatPointDate(selPoint.date).toUpperCase() : 'ИТОГО ЗА ПЕРИОД'}
            </Text>
            {selPoint !== null && (
              <TouchableOpacity onPress={() => setSelectedIdx(null)} hitSlop={8}>
                <Text style={styles.scopeBarClearLight}>сбросить</Text>
              </TouchableOpacity>
            )}
          </View>
          <View style={styles.chartStatsLight}>
            <View style={styles.chartStatItemLight}>
              <Text style={styles.chartStatLabelLight}>Оборот</Text>
              <Text style={styles.chartStatValueLight}>{formatMoney(displayRevenue)}</Text>
            </View>
            <View style={[styles.chartStatItemLight, styles.chartStatBorderLight]}>
              <Text style={styles.chartStatLabelLight}>Прибыль</Text>
              <Text style={[styles.chartStatValueLight, { color: colors.cyan[600] }]}>
                {formatMoney(displayProfit)}
              </Text>
            </View>
            <View style={[styles.chartStatItemLight, styles.chartStatBorderLight]}>
              <Text style={styles.chartStatLabelLight}>Чеков</Text>
              <Text style={styles.chartStatValueLight}>{displayChecks || '—'}</Text>
            </View>
          </View>
          {selPoint !== null && displayAvg !== null && (
            <View style={styles.chartStatsExtraLight}>
              <View style={styles.chartStatExtraItemLight}>
                <Text style={styles.chartStatLabelLight}>Средний чек</Text>
                <Text style={styles.chartStatValueLightSm}>{formatMoney(displayAvg)}</Text>
              </View>
            </View>
          )}
        </>
      )}
    </AnimatedCard>
  );
}

// ── 4. TODAY'S SNAPSHOT ROW ─────────────────────────────────────────────────
// 2 равных карточки в одной строке:
//   • Сейчас на смене — count + первые 5 mini-аватарок + (+N more)
//   • Звонки сегодня — incoming/missed + тонкий sparkline
// Тапы → Schedule / Calls.
function TodaySnapshotRow() {
  return (
    <View style={styles.snapshotRow}>
      <OnShiftSnapshot />
      <CallsSnapshot />
    </View>
  );
}

function OnShiftSnapshot() {
  const navigation = useNavigation<any>();
  const { data: todayData, isLoading } = useQuery<TodayEmployeeStatus[]>({
    queryKey: ['schedule-today'],
    queryFn: async () => (await scheduleApi.getToday()).data,
    staleTime: 30_000,
  });

  const statuses = todayData ?? [];
  const isSick = (s: TodayEmployeeStatus) => (s.note || '').toLowerCase().includes('больнич');
  const isAbsent = (s: TodayEmployeeStatus) => (s.note || '').toLowerCase().includes('прогул');
  const isOnShift = (s: TodayEmployeeStatus) => s.isWorking || !!s.actualArrival || s.lateStatus === 'on_time';

  const onShift = statuses.filter(
    (s) =>
      (isOnShift(s) || s.lateStatus === 'late_minor' || s.lateStatus === 'late_major') &&
      !s.isDayOff &&
      !isSick(s) &&
      !isAbsent(s),
  );

  const visible = onShift.slice(0, 5);
  const more = Math.max(onShift.length - 5, 0);

  return (
    <AnimatedCard
      index={3}
      style={[styles.snapshotCard]}
      onPress={() => navigation.navigate('Main', { screen: 'MoreTab', params: { screen: 'Schedule' } })}
    >
      <View style={styles.snapshotHeaderRow}>
        <View style={[styles.snapshotIconBox, { backgroundColor: colors.green[50] }]}>
          <Ionicons name="people-outline" size={14} color={colors.green[600]} />
        </View>
        <Text style={styles.snapshotLabel}>На смене</Text>
      </View>
      {isLoading ? (
        <Skeleton width={36} height={28} radius={6} />
      ) : (
        <Text style={styles.snapshotValue}>{onShift.length}</Text>
      )}
      <View style={styles.avatarsRow}>
        {visible.map((s, idx) => (
          <View
            key={s.userId}
            style={[
              styles.miniAvatar,
              { backgroundColor: colors.primary[100], marginLeft: idx === 0 ? 0 : -6, zIndex: 10 - idx },
            ]}
          >
            <Text style={styles.miniAvatarText}>
              {s.fullName
                .split(' ')
                .map((w) => w[0])
                .join('')
                .slice(0, 2)
                .toUpperCase()}
            </Text>
          </View>
        ))}
        {more > 0 && (
          <View
            style={[
              styles.miniAvatar,
              styles.miniAvatarMore,
              { marginLeft: visible.length === 0 ? 0 : -6 },
            ]}
          >
            <Text style={styles.miniAvatarMoreText}>+{more}</Text>
          </View>
        )}
        {visible.length === 0 && !isLoading && <Text style={styles.snapshotEmpty}>—</Text>}
      </View>
    </AnimatedCard>
  );
}

function CallsSnapshot() {
  const navigation = useNavigation<any>();
  const today = new Date().toISOString().slice(0, 10);
  const { data, isLoading } = useQuery({
    queryKey: ['calls-summary', today],
    queryFn: async () => (await callsApi.getCalls({ date: today })).data.summary,
    staleTime: 60_000,
  });

  const incoming = data?.incoming ?? 0;
  const missed = data?.missed ?? 0;
  const total = data?.total ?? 0;

  const W = 70;
  const H = 28;
  const ratioIn = total > 0 ? incoming / total : 0;
  const ratioMissed = total > 0 ? missed / total : 0;

  return (
    <AnimatedCard
      index={4}
      style={[styles.snapshotCard]}
      onPress={() => navigation.navigate('Main', { screen: 'MoreTab', params: { screen: 'Calls' } })}
    >
      <View style={styles.snapshotHeaderRow}>
        <View style={[styles.snapshotIconBox, { backgroundColor: colors.purple[50] }]}>
          <Ionicons name="call-outline" size={14} color={colors.purple[600]} />
        </View>
        <Text style={styles.snapshotLabel}>Звонки сегодня</Text>
      </View>
      {isLoading ? (
        <Skeleton width={36} height={28} radius={6} />
      ) : (
        <Text style={styles.snapshotValue}>{total}</Text>
      )}
      <View style={styles.callsMiniRow}>
        <Svg width={W} height={H}>
          {ratioIn > 0 && (
            <Path
              d={`M 0 ${H - 4} L ${W * ratioIn} ${H - 4}`}
              stroke={colors.green[500]}
              strokeWidth={4}
              strokeLinecap="round"
            />
          )}
          {ratioMissed > 0 && (
            <Path
              d={`M 0 ${H - 14} L ${W * ratioMissed} ${H - 14}`}
              stroke={colors.red[500]}
              strokeWidth={4}
              strokeLinecap="round"
            />
          )}
        </Svg>
        <View style={{ marginLeft: spacing[2] }}>
          <Text style={styles.callsMiniText}>
            <Text style={{ color: colors.green[600], fontWeight: '700' }}>{incoming}</Text> входящих
          </Text>
          <Text style={styles.callsMiniText}>
            <Text style={{ color: colors.red[600], fontWeight: '700' }}>{missed}</Text> пропущ.
          </Text>
        </View>
      </View>
    </AnimatedCard>
  );
}

// ── 5. QUICK ACTIONS 2×2 ────────────────────────────────────────────────────
interface QuickAction {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
  tintBg: string;
  perm?: string;
  navigate: (navigation: any) => void;
}

function OwnerQuickActions() {
  const navigation = useNavigation<any>();
  const { hasPermission } = useAuth();

  const actions: QuickAction[] = useMemo(
    () => [
      {
        key: 'new-check',
        label: 'Новый заказ-наряд',
        icon: 'receipt-outline',
        tint: colors.primary[600],
        tintBg: colors.primary[50],
        perm: 'checks_create',
        navigate: (nav) => nav.navigate('CheckCreate'),
      },
      {
        key: 'find-client',
        label: 'Найти клиента',
        icon: 'search-outline',
        tint: colors.blue[600],
        tintBg: colors.blue[50],
        perm: 'clients_view',
        navigate: (nav) => nav.navigate('Main', { screen: 'MoreTab', params: { screen: 'Clients' } }),
      },
      {
        key: 'journal',
        label: 'Журнал',
        icon: 'clipboard-outline',
        tint: colors.teal[600],
        tintBg: colors.teal[50],
        perm: 'checks_view',
        navigate: (nav) => nav.navigate('Main', { screen: 'Checks' }),
      },
      {
        key: 'reports',
        label: 'Отчёты',
        icon: 'bar-chart-outline',
        tint: colors.purple[700],
        tintBg: colors.purple[50],
        perm: 'financial_reports',
        navigate: (nav) => nav.navigate('Main', { screen: 'MoreTab', params: { screen: 'Reports' } }),
      },
    ],
    [],
  );

  const allowed = actions.filter((a) => !a.perm || hasPermission(a.perm as any));
  if (allowed.length === 0) return null;

  return (
    <View>
      <Text style={styles.sectionLabel}>БЫСТРЫЕ ДЕЙСТВИЯ</Text>
      <View style={styles.quickGrid2x2}>
        {allowed.map((a, idx) => (
          <QuickActionTile key={a.key} action={a} index={idx} onPress={() => a.navigate(navigation)} />
        ))}
      </View>
    </View>
  );
}

const QuickActionTile = React.memo(function QuickActionTile({
  action,
  index,
  onPress,
}: {
  action: QuickAction;
  index: number;
  onPress: () => void;
}) {
  return (
    <AnimatedCard index={index} style={styles.quickActionTile} onPress={onPress}>
      <View style={[styles.quickActionIconBox, { backgroundColor: action.tintBg }]}>
        <Ionicons name={action.icon} size={22} color={action.tint} />
      </View>
      <Text style={styles.quickActionLabel} numberOfLines={2}>
        {action.label}
      </Text>
    </AnimatedCard>
  );
});

// ── 6. TOP PERFORMERS ───────────────────────────────────────────────────────
// Top 3 masters by month revenue. Skeleton while loading. Tap → EmployeeDetail.
function TopPerformers() {
  const navigation = useNavigation<any>();
  const { data: ranking, isLoading } = useQuery<EmployeeRanking>({
    queryKey: ['employee-ranking'],
    queryFn: async () => (await checksApi.getRanking()).data,
    staleTime: 60_000,
  });

  const top3 = useMemo(() => (ranking?.month ?? []).slice(0, 3), [ranking?.month]);

  const handleOpenEmployee = useCallback(
    (id: string) => {
      navigation.navigate('Main', {
        screen: 'MoreTab',
        params: { screen: 'EmployeeDetail', params: { id } },
      });
    },
    [navigation],
  );

  return (
    <View>
      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionLabel}>ТОП МАСТЕРОВ МЕСЯЦА</Text>
      </View>
      <View style={styles.topPerformersCard}>
        {isLoading && !ranking ? (
          <View style={{ gap: spacing[3] }}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={styles.topPerfRowSkeleton}>
                <Skeleton width={40} height={40} radius={20} />
                <View style={{ flex: 1, gap: 6, marginLeft: spacing[3] }}>
                  <Skeleton width={'60%'} height={14} radius={4} />
                  <Skeleton width={'30%'} height={11} radius={4} />
                </View>
                <Skeleton width={80} height={14} radius={4} />
              </View>
            ))}
          </View>
        ) : top3.length === 0 ? (
          <View style={styles.topPerfEmpty}>
            <Ionicons name="trophy-outline" size={28} color={colors.gray[300]} />
            <Text style={styles.topPerfEmptyText}>Пока нет данных за месяц</Text>
          </View>
        ) : (
          top3.map((emp, idx) => (
            <TopPerformerRow
              key={emp.masterId}
              rank={idx + 1}
              name={emp.masterName}
              revenue={emp.revenue}
              checkCount={emp.checkCount}
              onPress={() => handleOpenEmployee(emp.masterId)}
              showDivider={idx < top3.length - 1}
            />
          ))
        )}
      </View>
    </View>
  );
}

const TopPerformerRow = React.memo(function TopPerformerRow({
  rank,
  name,
  revenue,
  checkCount,
  onPress,
  showDivider,
}: {
  rank: number;
  name: string;
  revenue: number;
  checkCount: number;
  onPress: () => void;
  showDivider: boolean;
}) {
  const medals: Record<number, { bg: string; fg: string; ring: string }> = {
    1: { bg: '#FEF3C7', fg: '#92400E', ring: '#FCD34D' },
    2: { bg: '#E5E7EB', fg: '#374151', ring: '#9CA3AF' },
    3: { bg: '#FED7AA', fg: '#9A3412', ring: '#FB923C' },
  };
  const m = medals[rank] || { bg: colors.gray[100], fg: colors.gray[500], ring: colors.gray[300] };
  const initials = name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <Pressable onPress={onPress} android_ripple={{ color: colors.gray[100] }}>
      {({ pressed }) => (
        <>
          <View style={[styles.topPerfRow, pressed && { opacity: 0.7 }]}>
            <View style={[styles.topPerfAvatar, { backgroundColor: m.bg, borderColor: m.ring }]}>
              <Text style={[styles.topPerfRank, { color: m.fg }]}>{rank}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0, marginLeft: spacing[3] }}>
              <Text style={styles.topPerfName} numberOfLines={1}>
                {name}
              </Text>
              <Text style={styles.topPerfSub}>
                {initials} · {checkCount} {checkCount === 1 ? 'заказ' : 'заказов'}
              </Text>
            </View>
            <Text style={styles.topPerfRevenue}>{formatMoney(revenue)}</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.gray[300]} style={{ marginLeft: spacing[2] }} />
          </View>
          {showDivider && <View style={styles.topPerfDivider} />}
        </>
      )}
    </Pressable>
  );
});

// ════════════════════════════════════════════════════════════════════════════
//  ADMIN / OWNER DASHBOARD orchestrator
// ════════════════════════════════════════════════════════════════════════════
//
// Combines the 6 hero blocks. Не показывает ShiftControl — это фича мастера.
function AdminDashboard({ name }: { name: string }) {
  return (
    <View style={{ gap: spacing[5] }}>
      <OwnerHero name={name} />
      <KpiStrip />
      <OwnerAnalyticsChart />
      <TodaySnapshotRow />
      <OwnerQuickActions />
      <TopPerformers />
    </View>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  MASTER DASHBOARD — kept INTACT from previous iteration.
// ════════════════════════════════════════════════════════════════════════════

// ── Shift Control (master only) ──
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
                с{' '}
                {new Date(currentShift.openedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
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
                Услуги {data.salaryPercent}%
                {data.productSalaryPercent ? ` · Товары ${data.productSalaryPercent}%` : ''}
              </Text>
            </View>
          </View>
        </LinearGradient>
      </AnimatedCard>

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

      <MasterRatingCard userId={user?.id} />
      <MasterRecentChecks />

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

// ════════════════════════════════════════════════════════════════════════════
//  ROOT
// ════════════════════════════════════════════════════════════════════════════
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

  const displayName = user?.fullName?.split(' ')[0] || '';
  const greeting = getGreeting();

  return (
    /* Edge-to-edge wrapper — gray-50 canvas flows under the glass tab bar.
       No SafeAreaView frame; insetsTop is applied inline to scroll content. */
    <View style={styles.safe}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: insetsTop + spacing[2],
            // iOS reserves bottom space via contentInset (lifts scroll
            // indicator with content). Android ignores contentInset, so
            // we add explicit padding so the last block doesn't sit
            // under the M3 NavigationBar.
            paddingBottom: Platform.OS === 'ios' ? undefined : tabBarHeight,
          },
        ]}
        contentInset={{ bottom: tabBarHeight }}
        scrollIndicatorInsets={{ bottom: tabBarHeight }}
        automaticallyAdjustContentInsets={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />
        }
      >
        {/* Owner = new 6-block layout. Master = unchanged previous experience. */}
        {isMaster ? (
          <>
            <View style={styles.headerSection}>
              <Text style={styles.headerTitle}>
                {greeting}, {displayName}!
              </Text>
              <Text style={styles.headerSub}>Обзор показателей автосервиса</Text>
            </View>
            <ShiftControl />
            <MasterDashboard />
          </>
        ) : isOwner || user?.role === UserRole.ADMIN ? (
          <AdminDashboard name={displayName} />
        ) : null}
      </ScrollView>
    </View>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  STYLES
// ════════════════════════════════════════════════════════════════════════════
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.gray[50] },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing[4], gap: spacing[4] },

  // Master-only header
  headerSection: { marginBottom: spacing[1] },
  headerTitle: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.gray[900] },
  headerSub: { fontSize: fontSize.xs, color: colors.gray[400], marginTop: 2 },

  // Legacy card (master path)
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

  // ── 1. OWNER HERO ────────────────────────────────────────────────────────
  heroCard: {
    borderRadius: borderRadius['3xl'],
    overflow: 'hidden',
    shadowColor: colors.primary[900],
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.22,
    shadowRadius: 28,
    elevation: 8,
  },
  heroGradient: {
    paddingHorizontal: spacing[5],
    paddingTop: spacing[5],
    paddingBottom: spacing[6],
    borderRadius: borderRadius['3xl'],
    position: 'relative',
    overflow: 'hidden',
  },
  heroSparkle: {
    position: 'absolute',
    top: -40,
    right: -40,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  heroGreeting: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.white,
    letterSpacing: -0.4,
  },
  heroDate: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.72)',
    marginTop: 2,
    textTransform: 'capitalize',
  },
  heroAvatarDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#bbf7d0',
    shadowColor: '#86efac',
    shadowOpacity: 0.6,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  heroValueBlock: { marginTop: spacing[5] },
  heroValueLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.66)',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  heroValue: {
    fontSize: 36,
    fontWeight: '800',
    color: colors.white,
    letterSpacing: -1.4,
    fontVariant: ['tabular-nums'],
  },
  heroDeltaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginTop: spacing[2],
  },
  heroDeltaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing[2],
    paddingVertical: 3,
    borderRadius: borderRadius.full,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  heroDeltaText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.white,
    letterSpacing: -0.1,
  },
  heroDeltaCaption: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.55)',
  },

  // ── 2. KPI STRIP ─────────────────────────────────────────────────────────
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.gray[500],
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: spacing[2.5],
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  kpiScrollContent: {
    gap: spacing[3],
    paddingRight: spacing[4],
  },
  kpiTile: {
    width: 144,
    height: 144,
    backgroundColor: colors.white,
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.gray[200],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
    justifyContent: 'space-between',
  },
  kpiTileTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.gray[500],
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  kpiTileValue: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.gray[900],
    letterSpacing: -0.6,
    fontVariant: ['tabular-nums'],
    marginTop: 2,
  },
  kpiTileSparkWrap: { marginTop: 4 },
  kpiDeltaPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
    backgroundColor: colors.gray[100],
  },
  kpiDeltaText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: -0.1,
  },

  // ── 3. OWNER ANALYTICS CHART ─────────────────────────────────────────────
  chartCardLight: {
    backgroundColor: colors.white,
    borderRadius: borderRadius['3xl'],
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.gray[200],
    padding: spacing[5],
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.06,
    shadowRadius: 24,
    elevation: 3,
  },
  chartHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing[3],
  },
  chartHeaderTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.gray[900],
    letterSpacing: -0.3,
  },
  chartHeaderSub: {
    fontSize: 12,
    color: colors.gray[500],
    marginTop: 2,
    textTransform: 'capitalize',
  },
  chartNavRow: {
    flexDirection: 'row',
    gap: spacing[1.5],
  },
  chartNavBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  chartNavBtnDisabled: { opacity: 0.4 },

  segCtl: {
    flexDirection: 'row',
    backgroundColor: colors.gray[100],
    borderRadius: borderRadius.full,
    padding: 3,
    marginBottom: spacing[4],
  },
  segCtlBtn: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: borderRadius.full,
    alignItems: 'center',
  },
  segCtlBtnActive: {
    backgroundColor: colors.white,
    shadowColor: '#0F172A',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  segCtlText: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.gray[500],
    letterSpacing: -0.1,
  },
  segCtlTextActive: { color: colors.gray[900], fontWeight: '700' },

  chartBody: { gap: spacing[1] },
  xAxisLabels: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: spacing[1] },
  xAxisLabelLight: { fontSize: 10, color: colors.gray[400], textAlign: 'center', flex: 1 },
  todayStatLight: { alignItems: 'center', paddingVertical: spacing[6] },
  todayStatValueLight: { fontSize: fontSize['3xl'], fontWeight: '800', color: colors.gray[900], letterSpacing: -0.8 },
  todayStatSubLight: { fontSize: fontSize.xs, color: colors.gray[400], marginTop: 4 },
  chartEmptyLight: { fontSize: fontSize.sm, color: colors.gray[400], textAlign: 'center', paddingVertical: spacing[8] },

  chartStatsLight: {
    flexDirection: 'row',
    marginTop: spacing[4],
    backgroundColor: colors.gray[50],
    borderRadius: borderRadius.xl,
    overflow: 'hidden',
  },
  chartStatItemLight: { flex: 1, paddingVertical: spacing[3], alignItems: 'center' },
  chartStatBorderLight: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.gray[200] },
  chartStatLabelLight: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.gray[500],
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  chartStatValueLight: {
    fontSize: fontSize.base,
    fontWeight: '700',
    color: colors.gray[900],
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  chartStatValueLightSm: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.gray[900],
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  scopeBarLight: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing[3],
    paddingHorizontal: spacing[1],
  },
  scopeBarLabelLight: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.gray[500],
    letterSpacing: 1.2,
  },
  scopeBarClearLight: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.primary[600],
    letterSpacing: 0.2,
  },
  chartStatsExtraLight: {
    flexDirection: 'row',
    marginTop: spacing[2],
    backgroundColor: colors.gray[50],
    borderRadius: borderRadius.xl,
    overflow: 'hidden',
  },
  chartStatExtraItemLight: { flex: 1, paddingVertical: spacing[2.5], alignItems: 'center' },

  scrubTooltipLight: {
    position: 'absolute',
    top: -2,
    backgroundColor: colors.white,
    borderRadius: 10,
    paddingHorizontal: spacing[2.5],
    paddingVertical: spacing[1.5],
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.gray[200],
    shadowColor: '#0F172A',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  scrubTooltipDateLight: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.gray[500],
    letterSpacing: 0.2,
    textTransform: 'capitalize',
    marginBottom: 2,
  },
  scrubTooltipRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  scrubDot: { width: 7, height: 7, borderRadius: 4 },
  scrubTooltipValueLight: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.gray[900],
    fontVariant: ['tabular-nums'],
  },
  scrubTooltipValueLightSm: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.cyan[600],
    fontVariant: ['tabular-nums'],
  },
  scrubHintLight: {
    fontSize: 11,
    color: colors.gray[400],
    textAlign: 'center',
    marginTop: spacing[1.5],
    letterSpacing: 0.2,
  },

  // ── 4. TODAY SNAPSHOT ROW ────────────────────────────────────────────────
  snapshotRow: {
    flexDirection: 'row',
    gap: spacing[3],
  },
  snapshotCard: {
    flex: 1,
    backgroundColor: colors.white,
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.gray[200],
    padding: spacing[4],
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  snapshotHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginBottom: spacing[2.5],
  },
  snapshotIconBox: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  snapshotLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.gray[600],
    letterSpacing: -0.1,
  },
  snapshotValue: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.gray[900],
    letterSpacing: -0.8,
    fontVariant: ['tabular-nums'],
  },
  snapshotEmpty: {
    fontSize: 12,
    color: colors.gray[400],
  },
  avatarsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing[2],
    minHeight: 24,
  },
  miniAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.white,
  },
  miniAvatarText: {
    fontSize: 9,
    fontWeight: '700',
    color: colors.primary[700],
  },
  miniAvatarMore: {
    backgroundColor: colors.gray[100],
    borderColor: colors.white,
  },
  miniAvatarMoreText: {
    fontSize: 9,
    fontWeight: '700',
    color: colors.gray[600],
  },
  callsMiniRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing[2],
  },
  callsMiniText: {
    fontSize: 11,
    color: colors.gray[600],
    lineHeight: 14,
  },

  // ── 5. QUICK ACTIONS 2×2 ─────────────────────────────────────────────────
  quickGrid2x2: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[3],
  },
  quickActionTile: {
    width: (SCREEN_WIDTH - spacing[4] * 2 - spacing[3]) / 2,
    backgroundColor: colors.white,
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.gray[200],
    paddingVertical: spacing[4],
    paddingHorizontal: spacing[3.5],
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  quickActionIconBox: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickActionLabel: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: colors.gray[900],
    letterSpacing: -0.1,
    lineHeight: 16,
  },

  // ── 6. TOP PERFORMERS ────────────────────────────────────────────────────
  topPerformersCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.gray[200],
    padding: spacing[2],
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  topPerfRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[2],
  },
  topPerfRowSkeleton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[2],
  },
  topPerfAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  topPerfRank: {
    fontSize: fontSize.base,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  topPerfName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.gray[900],
    letterSpacing: -0.2,
  },
  topPerfSub: {
    fontSize: 12,
    color: colors.gray[500],
    marginTop: 1,
  },
  topPerfRevenue: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.gray[900],
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.2,
  },
  topPerfDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.gray[100],
    marginHorizontal: spacing[2],
  },
  topPerfEmpty: {
    alignItems: 'center',
    paddingVertical: spacing[6],
    gap: spacing[2],
  },
  topPerfEmptyText: {
    fontSize: 13,
    color: colors.gray[400],
  },

  // ── LEGACY (master path) ─────────────────────────────────────────────────
  errorBanner: {
    backgroundColor: colors.red[50],
    borderRadius: borderRadius.xl,
    padding: spacing[4],
    fontSize: fontSize.sm,
    color: colors.red[700],
    textAlign: 'center',
    margin: spacing[4],
  },
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
  earningsRow: { flexDirection: 'row', gap: spacing[3] },
  earningBox: { flex: 1, borderRadius: borderRadius.lg, padding: spacing[3], gap: spacing[1] },
  earningLabel: { fontSize: fontSize.xs, fontWeight: fontWeight.medium },
  earningValue: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.gray[900], marginTop: 4 },
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
});
