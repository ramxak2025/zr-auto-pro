import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  RefreshControl,
  Dimensions,
  Platform,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useAnimatedProps,
  useSharedValue,
  withTiming,
  Easing,
  runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import CachedImage from '../components/CachedImage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path, Defs, LinearGradient as SvgGrad, Stop, Line, Circle, RadialGradient } from 'react-native-svg';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';
import {
  checksApi,
  salaryApi,
  shiftsApi,
  scheduleApi,
  marketingApi,
  callsApi,
  usersApi,
  reportsApi,
  warehouseAnalyticsApi,
  productsApi,
  myCompanyApi,
  installmentsApi,
} from '../api/services';
import { formatInstallmentMoney, dueLabel } from '../components/installments/installmentUi';
import { getImageUrl } from '../api/axios';
import { colors, fontSize, fontWeight, borderRadius, spacing, softTint } from '../theme';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { useThemeMode, useColors } from '../contexts/ThemeContext';
import type { SemanticPalette } from '../theme/palette';
import { ThemeToggle } from '../components/ThemeToggle';
import AnimatedCard from '../components/AnimatedCard';
import { Skeleton } from '../components/Skeleton';
import FreshnessBadge from '../components/FreshnessBadge';
import QueryErrorState from '../components/QueryErrorState';
import type {
  SalarySummary,
  TodayEmployeeStatus,
  Shift,
  ScheduleEntry,
  User,
  RecentReview,
  WarehouseSummary,
  ReorderItem,
  Product,
  Tenant,
  InstallmentWidget,
} from '../../../shared/types';
import { UserRole } from '../../../shared/types';
import { usePreference, prefKey } from '../hooks/usePreference';
import {
  DASHBOARD_WIDGETS_PREF,
  isWidgetVisible,
  type DashboardWidgetDef,
  type WidgetVisibility,
} from './dashboard/dashboardWidgets';
import DashboardWidgetsModal from './dashboard/DashboardWidgetsModal';
import { calculateAttendanceStats, attendanceScore, emptyBreakdown } from '../../../shared/utils/attendance';
import { updateWidgetData } from '../utils/widgetBridge';
import { haptic } from '../platform/haptics';
import { toLocalISODate } from '../utils/dates';

const SCREEN_WIDTH = Dimensions.get('window').width;

// Scrub line + dots графика — анимируются через useAnimatedProps на UI-потоке
// (RNPERF-11). Те же animated-SVG обёртки, что и в StatsRadar (Polygon).
const AnimatedSvgLine = Animated.createAnimatedComponent(Line);
const AnimatedSvgCircle = Animated.createAnimatedComponent(Circle);

// Width of each x-axis label box. Each label is absolutely positioned
// at `pointX - X_AXIS_LABEL_W / 2` so its centre aligns with the point.
// 28pt fits all label variants we display ("Пн", "Дек", "31") at 10pt
// while keeping 12 monthly labels spaced ≥25pt apart on a ~300pt-wide
// chart — no visible overlap, no clipping.
const X_AXIS_LABEL_W = 28;

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

const WEEKDAYS_RU = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
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
//  OWNER DASHBOARD — owner-grade analytics (iter#14, 2026-05-22)
// ════════════════════════════════════════════════════════════════════════════
//
// 2026-grade owner dashboard. Hero показывает чистую прибыль (не оборот),
// далее KPI за текущий месяц, далее график, и стек владельческих
// виджетов: касса по типам, маржинальность, отложенные, алерты, new vs
// returning клиенты, воронка звонков, retention, лучший день недели,
// последние отзывы, личный рекорд и прогноз на конец месяца. Quick
// Actions и Топ Мастеров — намеренно убраны.
//
// Все данные через `reportsApi.dashboardV2` + сопутствующие endpoint'ы.

// ── 1. HERO ─────────────────────────────────────────────────────────────────
// Глубокий primary градиент с radial-glow. Hero-число — netProfitToday
// (чистая прибыль за сегодня), под ним оборот за сегодня и за месяц.
// Дельта vs вчера. Данные — dashboardV2 + dashboard-chart для дельты.
function OwnerHero({ name }: { name: string }) {
  // Канонический источник числа дня — dashboardV2 (netProfitToday + revenueToday).
  const v2 = useQuery({
    queryKey: ['dashboard-v2', 'today'],
    queryFn: async () => (await reportsApi.dashboardV2({ period: 'today' })).data,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
  // Вчерашняя выручка/прибыль — для дельты. Используем существующий
  // dashboard-chart, чтобы не плодить новые endpoint'ы (он уже горячий
  // в кеше, потому что графика).
  const yday = useQuery({
    queryKey: ['dashboard-chart', 'today', -1],
    queryFn: async () => (await checksApi.getDashboardChart('today', -1)).data,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });

  const profitToday = v2.data?.netProfitToday ?? 0;
  const revenueToday = v2.data?.revenueToday ?? 0;
  const profitMonth = v2.data?.netProfitMonth ?? 0;
  const checksToday = v2.data?.checksToday ?? 0;
  // Открытые заказ-наряды = открытые (отложенные) чеки. dashboardV2.deferredSum
  // считает is_deferred=true (reports.service.ts) — это незакрытые заказ-наряды,
  // тот же показатель, что владелец видит в карточке «Отложенные». Источник уже
  // загружен ЭТИМ же v2-запросом → никакого нового сетевого запроса ради виджета.
  const openOrders = v2.data?.deferredSum?.count ?? 0;
  const ydayProfit = yday.data?.totalProfit ?? 0;
  const delta = useMemo(() => formatDeltaPct(profitToday, ydayProfit), [profitToday, ydayProfit]);
  const isLoading = v2.data === undefined && v2.isLoading;

  // Sync widget data whenever today's profit/revenue changes.
  // Deps are the numeric primitives that matter — NOT `v2.data`, because
  // TanStack returns a fresh data reference on every successful refetch (even
  // with `placeholderData: prev => prev`), which would otherwise fire
  // `updateWidgetData` on every 60 s background poll.
  //
  // Premium medium/large-widget KPIs: we pass `openOrders` (already in
  // dashboardV2). `cashOpen` (live cash-shift state) and `nextBooking` are
  // intentionally OMITTED — the owner dashboard fetches neither a cash-shift nor
  // a bookings query, and adding one solely to feed the widget is disallowed.
  // The widget renders fine with these fields absent.
  const hasV2 = v2.data !== undefined;
  useEffect(() => {
    if (!hasV2) return;
    updateWidgetData({
      role: 'owner',
      revenue: revenueToday,
      profitToday,
      checksCount: checksToday,
      openOrders,
    });
  }, [hasV2, revenueToday, checksToday, profitToday, openOrders]);

  // Theme-aware hero gradient. Light mode keeps the brand-blue look
  // already shipped; dark mode swaps in a deep indigo→near-black ramp
  // tuned in `theme/palette.ts`.
  const { palette } = useThemeMode();
  const heroColors = palette.heroGradient;

  // M7: запрос упал и кэша нет (true cold-start failure) — честный
  // error-state вместо нулевой «прибыли». Пока есть прошлые данные,
  // глобальный stale-while-revalidate продолжает их показывать.
  if (v2.isError && v2.data === undefined) {
    return (
      <AnimatedCard index={0} style={[styles.heroCard, { backgroundColor: palette.bg.card }]}>
        <QueryErrorState
          description="Показатели за сегодня недоступны. Проверьте соединение."
          onRetry={() => v2.refetch()}
        />
      </AnimatedCard>
    );
  }

  return (
    <AnimatedCard index={0} style={styles.heroCard}>
      <LinearGradient
        colors={heroColors as unknown as readonly [string, string, ...string[]]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.heroGradient}
      >
        {/* Decorative radial sparkle — SVG so we get true radial gradient. */}
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
          <ThemeToggle />
        </View>

        <View style={styles.heroValueBlock}>
          <Text style={styles.heroValueLabel}>Чистая прибыль сегодня</Text>
          {isLoading ? (
            <Skeleton width={220} height={36} radius={10} style={{ backgroundColor: 'rgba(255,255,255,0.10)' }} />
          ) : (
            <Text style={styles.heroValue} numberOfLines={1} adjustsFontSizeToFit>
              {formatMoney(profitToday)}
            </Text>
          )}
          {!isLoading && (
            <Text style={styles.heroSecondary}>
              Оборот: <Text style={styles.heroSecondaryBold}>{formatMoney(revenueToday)}</Text>
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
                color={delta.tone === 'up' ? '#bbf7d0' : delta.tone === 'down' ? '#fecaca' : 'rgba(255,255,255,0.7)'}
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
          {!isLoading && profitMonth > 0 && (
            <View style={styles.heroMonthRow}>
              <Ionicons name="trending-up-outline" size={12} color="rgba(255,255,255,0.78)" />
              <Text style={styles.heroMonthText}>
                Прибыль за месяц: <Text style={styles.heroMonthBold}>{formatMoney(profitMonth)}</Text>
              </Text>
            </View>
          )}
        </View>
      </LinearGradient>
    </AnimatedCard>
  );
}

// ── 2. KPI STRIP ────────────────────────────────────────────────────────────
// 4 горизонтально-скроллируемых квадратных тайла 144×144pt:
//   tiny title (Оборот / Прибыль / Чеков / Средний чек)
//   hero number 22pt 800
//   mini sparkline (SVG)
//   delta chip ↑/↓ %
// Все 4 кликабельны → переход в соответствующий экран.
//
// Период — **текущий месяц** (month-to-date). Данные:
//   • `dashboard-chart('month', 0)` — оборот, прибыль, чеки за этот месяц.
//   • `dashboard-chart('month', -1)` — те же показатели за прошлый месяц,
//     для дельты-чипа на каждом тайле.

interface KpiTileSpec {
  key: 'revenue' | 'profit' | 'checks' | 'avg';
  title: string;
  format: 'money' | 'count';
  pickValue: (p: { revenue: number; profit: number; checkCount: number }) => number;
  total: (data: { totalRevenue: number; totalProfit: number; totalChecks: number }, avgValue: number) => number;
  navTo: () => { stack: string; screen?: string } | null;
}

function KpiStrip() {
  const navigation = useNavigation<any>();
  const palette = useColors();
  const month = useQuery({
    queryKey: ['dashboard-chart', 'month', 0],
    queryFn: async () => (await checksApi.getDashboardChart('month', 0)).data,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
  const prevMonth = useQuery({
    queryKey: ['dashboard-chart', 'month', -1],
    queryFn: async () => (await checksApi.getDashboardChart('month', -1)).data,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });

  const c = month.data;
  const p = prevMonth.data;
  const avg = c && c.totalChecks > 0 ? c.totalRevenue / c.totalChecks : 0;
  const prevAvg = p && p.totalChecks > 0 ? p.totalRevenue / p.totalChecks : 0;
  const isLoading = c === undefined && month.isLoading;

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

  const points = Array.isArray(c?.points) ? c.points : [];

  // Динамический заголовок секции — название текущего месяца.
  const monthHeader = useMemo(() => {
    const months = [
      'ЯНВАРЬ',
      'ФЕВРАЛЬ',
      'МАРТ',
      'АПРЕЛЬ',
      'МАЙ',
      'ИЮНЬ',
      'ИЮЛЬ',
      'АВГУСТ',
      'СЕНТЯБРЬ',
      'ОКТЯБРЬ',
      'НОЯБРЬ',
      'ДЕКАБРЬ',
    ];
    const now = new Date();
    return `${months[now.getMonth()]} ${now.getFullYear()}`;
  }, []);

  // M7: без кэша и с упавшим запросом KPI-тайлы рисовали нули — владелец
  // принимал бы «0 ₽ оборота» за правду. Показываем error-state с retry.
  if (month.isError && c === undefined) {
    return (
      <View>
        <Text style={[styles.sectionLabel, { color: palette.text.secondary }]}>{monthHeader}</Text>
        <QueryErrorState description="Показатели месяца недоступны" onRetry={() => month.refetch()} />
      </View>
    );
  }

  return (
    <View>
      <Text style={[styles.sectionLabel, { color: palette.text.secondary }]}>{monthHeader}</Text>
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
                // initial: false — меню «Ещё» остаётся под разделом (см. AppNavigator).
                params: { screen: target.screen, initial: false },
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
              palette={palette}
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
  palette: SemanticPalette;
}

const KpiTile = React.memo(function KpiTile({
  index,
  title,
  value,
  series,
  delta,
  onPress,
  tone,
  palette,
}: KpiTileProps) {
  const tonePalette = {
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
    <AnimatedCard
      index={index}
      style={[styles.kpiTile, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
      onPress={onPress}
    >
      <Text style={[styles.kpiTileTitle, { color: palette.text.secondary }]}>{title}</Text>
      <Text style={[styles.kpiTileValue, { color: palette.text.primary }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <View style={styles.kpiTileSparkWrap}>
        {series.length > 1 ? (
          <Svg width={W} height={H}>
            <Defs>
              <SvgGrad id={`sparkGrad-${tone}`} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0%" stopColor={tonePalette.glow} stopOpacity={0.55} />
                <Stop offset="100%" stopColor={tonePalette.glow} stopOpacity={0} />
              </SvgGrad>
            </Defs>
            <Path d={areaPath} fill={`url(#sparkGrad-${tone})`} />
            <Path d={path} stroke={tonePalette.line} strokeWidth={1.8} fill="none" strokeLinecap="round" />
          </Svg>
        ) : (
          <View style={{ width: W, height: H }} />
        )}
      </View>
      <View
        style={[
          styles.kpiDeltaPill,
          { backgroundColor: palette.bg.muted },
          delta.tone === 'up' && {
            backgroundColor: palette.mode === 'dark' ? softTint(colors.green[600], 'dark') : colors.green[50],
          },
          delta.tone === 'down' && {
            backgroundColor: palette.mode === 'dark' ? softTint(colors.red[600], 'dark') : colors.red[50],
          },
        ]}
      >
        <Ionicons
          name={delta.tone === 'up' ? 'arrow-up' : delta.tone === 'down' ? 'arrow-down' : 'remove'}
          size={10}
          color={
            delta.tone === 'up' ? colors.green[700] : delta.tone === 'down' ? colors.red[700] : palette.text.tertiary
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
                    : palette.text.tertiary,
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
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const palette = useColors();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['dashboard-chart', period, offset],
    queryFn: async () => (await checksApi.getDashboardChart(period, offset)).data,
    staleTime: 30_000,
  });

  // Note: a previous iteration carried an `animWidth` Animated.Value that
  // tweened 0→1 with `useNativeDriver: false` whenever `pointsLen` changed,
  // but the value was never read anywhere in the JSX. It was effectively a
  // dead 800 ms JS-driven animation that ran on every chart refresh,
  // burning JS-thread cycles for no visible effect. Removed.
  const pointsLen = data?.points?.length ?? 0;

  // RNPERF-11: позиция скраба живёт в shared value и двигается целиком на
  // UI-потоке (Gesture.Pan + useAnimatedProps). -1 = скраб скрыт. JS-state
  // `selectedIdx` обновляется через runOnJS ТОЛЬКО при смене индекса — он
  // нужен лишь текстовым значениям под графиком, не линии/точкам.
  const scrubIdx = useSharedValue(-1);

  useEffect(() => {
    scrubIdx.value = -1;
    setSelectedIdx((prev) => (prev === null ? prev : null));
  }, [period, offset, pointsLen, scrubIdx]);

  const handlePeriodChange = (p: ChartPeriod) => {
    setPeriod(p);
    setOffset(0);
  };

  const points = Array.isArray(data?.points) ? data.points : [];
  const totalRevenue = data?.totalRevenue ?? 0;
  const totalProfit = data?.totalProfit ?? 0;
  const totalChecks = data?.totalChecks ?? 0;
  const maxValue = useMemo(() => {
    if (!points.length) return 1;
    return Math.max(...points.map((p: any) => p.revenue), 1);
  }, [points]);
  const chartWidth = SCREEN_WIDTH - spacing[4] * 2 - spacing[5] * 2;

  // Returns the visible label for a given point's x-axis tick, OR '' to
  // hide that tick. Density rules (per period) are intentional — labels
  // are rendered absolutely-positioned so each is centered on its own
  // data point (see x-axis rendering below). The density just decides
  // which subset of points carry a label.
  //
  // Important: for `month`, the date string from the API is `YYYY-MM-DD`
  // (UTC midnight). Passing that to `new Date()` and calling `.getDate()`
  // would silently shift by one day in any time zone behind UTC. We parse
  // the calendar parts directly so the displayed day-of-month always
  // matches what the API meant.
  const formatLabel = (dateStr: string, idx: number, total: number): string => {
    if (period === 'today') {
      // 24 hourly points → show every 4 hours: 0, 4, 8, 12, 16, 20.
      const h = new Date(dateStr).getHours();
      return h % 4 === 0 ? `${h}` : '';
    }
    if (period === 'year') {
      // 12 monthly points → all months, short labels.
      const monthsShort = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
      const parts = dateStr.split('-');
      return monthsShort[parseInt(parts[1]) - 1] || '';
    }
    if (period === 'week') {
      // 7 daily points → all days. Parse the ISO date as a calendar date
      // (no timezone math) so Sunday isn't accidentally drawn as Saturday.
      const [y, m, d] = dateStr.split('-').map((n) => parseInt(n, 10));
      const dt = new Date(y, (m || 1) - 1, d || 1);
      const days = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
      return days[dt.getDay()] ?? '';
    }
    // month: 28-31 daily points → show day-of-month, thinned so labels
    // fit without overlapping. Always include the first and last day so
    // the axis has clear endpoints.
    const day = parseInt(dateStr.slice(8, 10), 10) || 0;
    const isFirst = idx === 0;
    const isLast = idx === total - 1;
    if (isFirst || isLast) return `${day}`;
    // Show every 5th day (5, 10, 15, 20, 25). Skip days within 2 of the
    // endpoints so we don't draw "31" right next to "30".
    if (day % 5 !== 0) return '';
    if (idx < 2 || idx > total - 3) return '';
    return `${day}`;
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
  // Memoise the derived per-point series. Without this, `points.map(...)`
  // ran twice on every render (revenue + profit), and every scrub move
  // re-walked the points array. With the memo the two series are stable
  // across scrub state, so the SVG path-strings below also stay stable
  // (Path d="..." reconciles by string identity, no re-rasterisation).
  const revVals = useMemo(() => points.map((p: any) => p.revenue || 0), [points]);
  const profVals = useMemo(() => points.map((p: any) => p.profit || 0), [points]);
  const maxProfit = useMemo(() => Math.max(...profVals, 1), [profVals]);
  const overallMax = useMemo(() => Math.max(maxValue, maxProfit, 1), [maxValue, maxProfit]);

  // Precompute the four path strings so they don't get rebuilt on every
  // scrub move (which fires `setSelectedIdx` → render → JS work).
  const revAreaPath = useMemo(() => buildAreaPath(revVals, svgW, svgH, overallMax), [revVals, svgW, svgH, overallMax]);
  const revLinePath = useMemo(() => buildWavePath(revVals, svgW, svgH, overallMax), [revVals, svgW, svgH, overallMax]);
  const profAreaPath = useMemo(
    () => buildAreaPath(profVals, svgW, svgH, overallMax),
    [profVals, svgW, svgH, overallMax],
  );
  const profLinePath = useMemo(
    () => buildWavePath(profVals, svgW, svgH, overallMax),
    [profVals, svgW, svgH, overallMax],
  );

  // RNPERF-11: бывший PanResponder гонял каждое move-событие через JS-мост и
  // дёргал setState на каждый пиксель — при занятом JS-потоке скраб ронял
  // кадры. Теперь Gesture.Pan() — worklet: индекс считается на UI-потоке,
  // линия/точки двигаются через useAnimatedProps без участия JS. runOnJS
  // зовётся ТОЛЬКО когда индекс реально сменился (для текстовых значений).
  const pointsCount = points.length;

  // Прекомпьют координат точек — worklet'ы читают готовые массивы (копия
  // уезжает на UI-поток при пересоздании worklet'а, т.е. при смене данных).
  const xs = useMemo(
    () => points.map((_: unknown, i: number) => (pointsCount > 1 ? (i / (pointsCount - 1)) * svgW : 0)),
    [points, pointsCount, svgW],
  );
  const revYs = useMemo(
    () => revVals.map((v: number) => svgH - (v / overallMax) * (svgH * 0.85) - 4),
    [revVals, svgH, overallMax],
  );
  const profYs = useMemo(
    () => profVals.map((v: number) => svgH - (v / overallMax) * (svgH * 0.85) - 4),
    [profVals, svgH, overallMax],
  );

  const scrubGesture = useMemo(() => {
    const moveTo = (x: number) => {
      'worklet';
      if (pointsCount < 2) return;
      const clamped = Math.max(0, Math.min(svgW, x));
      const idx = Math.round((clamped / svgW) * (pointsCount - 1));
      if (idx !== scrubIdx.value) {
        scrubIdx.value = idx;
        runOnJS(setSelectedIdx)(idx);
      }
    };
    return (
      Gesture.Pan()
        // minDistance(0) — скраб появляется сразу на touch-down (как раньше
        // onPanResponderGrant) и перехватывает жест у родительского ScrollView,
        // идентично прежнему onStartShouldSetPanResponder: true.
        .minDistance(0)
        .maxPointers(1)
        .shouldCancelWhenOutside(false)
        .enabled(pointsCount > 1)
        .onBegin((e) => {
          moveTo(e.x);
        })
        .onUpdate((e) => {
          moveTo(e.x);
        })
    );
    // setSelectedIdx стабилен (useState), scrubIdx — shared value.
  }, [pointsCount, svgW, scrubIdx]);

  // Скраб-линия и точки всегда смонтированы; видимость и позиция управляются
  // с UI-потока. opacity 0 при scrubIdx < 0 — поведение идентично прежнему
  // условному рендеру `selPoint !== null && <Line/>`.
  const scrubLineProps = useAnimatedProps(() => {
    const i = scrubIdx.value;
    const valid = i >= 0 && i < xs.length;
    const x = valid ? xs[i] : 0;
    return { x1: x, x2: x, opacity: valid ? 1 : 0 };
  });
  const scrubRevDotProps = useAnimatedProps(() => {
    const i = scrubIdx.value;
    const valid = i >= 0 && i < revYs.length;
    return { cx: valid ? xs[i] : 0, cy: valid ? revYs[i] : 0, opacity: valid ? 1 : 0 };
  });
  const scrubProfDotProps = useAnimatedProps(() => {
    const i = scrubIdx.value;
    const valid = i >= 0 && i < profYs.length;
    return { cx: valid ? xs[i] : 0, cy: valid ? profYs[i] : 0, opacity: valid ? 1 : 0 };
  });

  // ─────────────────────────────────────────────────────────────────────
  // Race-safe scrub state.
  //
  // After the user changes period (week→year→today), `points.length` can
  // SHRINK before the post-render effect resets `selectedIdx` to null.
  // The intermediate render thus reads `points[selectedIdx]` with a
  // stale, now-out-of-range index — returning `undefined`. The previous
  // code only null-checked, so `selPoint.revenue` crashed.
  //
  // We coalesce undefined to null here so every downstream read is safe.
  // (Геометрия скраб-линии/точек больше не считается здесь — она живёт в
  // useAnimatedProps выше и сама клампится к актуальной длине массивов.)
  const safeSelectedIdx = selectedIdx !== null && selectedIdx >= 0 && selectedIdx < points.length ? selectedIdx : null;
  const selPoint = safeSelectedIdx !== null ? points[safeSelectedIdx] : null;

  const displayRevenue = selPoint ? selPoint.revenue || 0 : totalRevenue;
  const displayProfit = selPoint ? selPoint.profit || 0 : totalProfit;
  const displayChecks = selPoint ? selPoint.checkCount || 0 : totalChecks;
  const displayAvg = selPoint && selPoint.checkCount > 0 ? selPoint.revenue / selPoint.checkCount : null;

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
    <AnimatedCard
      index={2}
      style={[styles.chartCardLight, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
    >
      <View style={styles.chartHeaderRow}>
        <View>
          <Text style={[styles.chartHeaderTitle, { color: palette.text.primary }]}>Аналитика</Text>
          <Text style={[styles.chartHeaderSub, { color: palette.text.secondary }]}>
            {getOffsetLabel(period, offset)}
          </Text>
        </View>
        <View style={styles.chartNavRow}>
          <TouchableOpacity
            style={[styles.chartNavBtn, { backgroundColor: palette.bg.muted }]}
            onPress={() => setOffset((o) => o - 1)}
            hitSlop={6}
          >
            <Ionicons name="chevron-back" size={16} color={palette.text.secondary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.chartNavBtn,
              { backgroundColor: palette.bg.muted },
              offset >= 0 && styles.chartNavBtnDisabled,
            ]}
            onPress={() => setOffset((o) => (o < 0 ? o + 1 : 0))}
            disabled={offset >= 0}
            hitSlop={6}
          >
            <Ionicons
              name="chevron-forward"
              size={16}
              color={offset >= 0 ? palette.text.tertiary : palette.text.secondary}
            />
          </TouchableOpacity>
        </View>
      </View>

      {/* iOS-segmented pill control */}
      <View style={[styles.segCtl, { backgroundColor: palette.bg.muted }]}>
        {(Object.keys(periodLabels) as ChartPeriod[]).map((p) => {
          const active = period === p;
          return (
            <TouchableOpacity
              key={p}
              style={[styles.segCtlBtn, active && [styles.segCtlBtnActive, { backgroundColor: palette.bg.card }]]}
              onPress={() => handlePeriodChange(p)}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.segCtlText,
                  { color: palette.text.secondary },
                  active && [styles.segCtlTextActive, { color: palette.text.primary }],
                ]}
              >
                {periodLabels[p]}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {isError && data === undefined ? (
        // M7: график упал без кэша — не рисуем пустую «нулевую» кривую.
        <QueryErrorState description="График недоступен. Проверьте соединение." onRetry={() => refetch()} />
      ) : isLoading ? (
        <View style={{ height: svgH, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.primary[500]} />
        </View>
      ) : points.length > 1 ? (
        <View style={styles.chartBody}>
          {/* Локальный GestureHandlerRootView — в App.tsx нет корневого
              (тот же приём, что BottomSheet внутри Modal). Для вложенного
              использования это обычный View, оркестрирующий RNGH-жесты
              своего поддерева. */}
          <GestureHandlerRootView>
            <GestureDetector gesture={scrubGesture}>
              <View style={{ height: svgH, width: svgW, position: 'relative' }}>
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
                      stroke={palette.border.subtle}
                      strokeWidth={1}
                    />
                  ))}
                  <Path d={revAreaPath} fill="url(#revGradLight)" />
                  <Path
                    d={revLinePath}
                    stroke={colors.primary[600]}
                    strokeWidth={3}
                    strokeLinecap="round"
                    fill="none"
                  />
                  <Path d={profAreaPath} fill="url(#profGradLight)" />
                  <Path
                    d={profLinePath}
                    stroke={colors.cyan[600]}
                    strokeWidth={2}
                    strokeLinecap="round"
                    fill="none"
                    strokeDasharray="4,4"
                  />
                  {/* Скраб-линия + точки: всегда смонтированы, позиция и
                      видимость управляются worklet'ами на UI-потоке —
                      ни одного JS-вызова на move-событие. */}
                  <AnimatedSvgLine
                    animatedProps={scrubLineProps}
                    y1={0}
                    y2={svgH}
                    stroke={colors.primary[400]}
                    strokeWidth={1}
                    strokeDasharray="3,3"
                  />
                  <AnimatedSvgCircle
                    animatedProps={scrubRevDotProps}
                    r={5.5}
                    fill={colors.primary[600]}
                    stroke="white"
                    strokeWidth={2}
                  />
                  <AnimatedSvgCircle
                    animatedProps={scrubProfDotProps}
                    r={4}
                    fill={colors.cyan[600]}
                    stroke="white"
                    strokeWidth={1.5}
                  />
                </Svg>

                {/* The floating tooltip that previously overlaid the scrubbed
                    point (date + revenue + profit) was removed per owner —
                    the exact same numbers are already displayed in the stats
                    row just below the chart, so the overlay was duplicating
                    information and obscuring the curve. The scrub line +
                    circles remain to indicate which point is selected. */}
              </View>
            </GestureDetector>
          </GestureHandlerRootView>

          {/* X-axis ticks. Each label is positioned absolutely so its
              center sits exactly on the data point's x-coordinate —
              the same `(i / (N-1)) * svgW` formula used for the curve
              and the scrub circle. Previously the labels lived in a
              `flex: 1` row, which spaced them as `(2i+1)/(2N) * svgW`,
              i.e. shifted ~half-a-slot right of each point. Tapping
              "Вт" would then highlight the Tuesday point but draw it
              visually between the Monday and Tuesday labels. */}
          <View style={[styles.xAxisLabels, { width: svgW }]}>
            {points.map((point: any, idx: number) => {
              const label = formatLabel(point.date, idx, points.length);
              if (!label) return null;
              const x = points.length > 1 ? (idx / (points.length - 1)) * svgW : svgW / 2;
              return (
                <Text
                  key={idx}
                  style={[styles.xAxisLabelLight, { color: palette.text.tertiary, left: x - X_AXIS_LABEL_W / 2 }]}
                  numberOfLines={1}
                >
                  {label}
                </Text>
              );
            })}
          </View>

          {selPoint === null && (
            <Text style={[styles.scrubHintLight, { color: palette.text.tertiary }]}>
              Проведите по графику для деталей
            </Text>
          )}
        </View>
      ) : points.length === 1 ? (
        <View style={styles.todayStatLight}>
          <Text style={[styles.todayStatValueLight, { color: palette.text.primary }]}>{formatMoney(totalRevenue)}</Text>
          <Text style={[styles.todayStatSubLight, { color: palette.text.tertiary }]}>Выручка за период</Text>
        </View>
      ) : (
        <Text style={[styles.chartEmptyLight, { color: palette.text.tertiary }]}>Нет данных за период</Text>
      )}

      {data && (
        <>
          <View style={styles.scopeBarLight}>
            <Text style={[styles.scopeBarLabelLight, { color: palette.text.secondary }]}>
              {selPoint ? formatPointDate(selPoint.date).toUpperCase() : 'ИТОГО ЗА ПЕРИОД'}
            </Text>
            {selPoint !== null && (
              <TouchableOpacity
                onPress={() => {
                  scrubIdx.value = -1;
                  setSelectedIdx(null);
                }}
                hitSlop={8}
              >
                <Text style={styles.scopeBarClearLight}>сбросить</Text>
              </TouchableOpacity>
            )}
          </View>
          <View style={[styles.chartStatsLight, { backgroundColor: palette.bg.muted }]}>
            <View style={styles.chartStatItemLight}>
              <Text style={[styles.chartStatLabelLight, { color: palette.text.secondary }]}>Оборот</Text>
              <Text style={[styles.chartStatValueLight, { color: palette.text.primary }]}>
                {formatMoney(displayRevenue)}
              </Text>
            </View>
            <View
              style={[
                styles.chartStatItemLight,
                styles.chartStatBorderLight,
                { borderLeftColor: palette.border.subtle },
              ]}
            >
              <Text style={[styles.chartStatLabelLight, { color: palette.text.secondary }]}>Прибыль</Text>
              <Text style={[styles.chartStatValueLight, { color: colors.cyan[600] }]}>
                {formatMoney(displayProfit)}
              </Text>
            </View>
            <View
              style={[
                styles.chartStatItemLight,
                styles.chartStatBorderLight,
                { borderLeftColor: palette.border.subtle },
              ]}
            >
              <Text style={[styles.chartStatLabelLight, { color: palette.text.secondary }]}>Чеков</Text>
              <Text style={[styles.chartStatValueLight, { color: palette.text.primary }]}>{displayChecks || '—'}</Text>
            </View>
          </View>
          {selPoint !== null && displayAvg !== null && (
            <View style={[styles.chartStatsExtraLight, { backgroundColor: palette.bg.muted }]}>
              <View style={styles.chartStatExtraItemLight}>
                <Text style={[styles.chartStatLabelLight, { color: palette.text.secondary }]}>Средний чек</Text>
                <Text style={[styles.chartStatValueLightSm, { color: palette.text.primary }]}>
                  {formatMoney(displayAvg)}
                </Text>
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
  const palette = useColors();
  const { data: todayData, isLoading } = useQuery<TodayEmployeeStatus[]>({
    queryKey: ['schedule-today'],
    queryFn: async () => (await scheduleApi.getToday()).data,
    staleTime: 30_000,
  });

  const statuses = Array.isArray(todayData) ? todayData : [];
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
      style={[styles.snapshotCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
      onPress={() => navigation.navigate('Main', { screen: 'MoreTab', params: { screen: 'Schedule', initial: false } })}
    >
      <View style={styles.snapshotHeaderRow}>
        <View
          style={[
            styles.snapshotIconBox,
            { backgroundColor: palette.mode === 'dark' ? softTint(colors.green[600], 'dark') : colors.green[50] },
          ]}
        >
          <Ionicons name="people-outline" size={14} color={colors.green[600]} />
        </View>
        <Text style={[styles.snapshotLabel, { color: palette.text.secondary }]}>На смене</Text>
      </View>
      {isLoading ? (
        <Skeleton width={36} height={28} radius={6} />
      ) : (
        <Text style={[styles.snapshotValue, { color: palette.text.primary }]}>{onShift.length}</Text>
      )}
      <View style={styles.avatarsRow}>
        {visible.map((s, idx) => (
          <View
            key={s.userId}
            style={[
              styles.miniAvatar,
              {
                backgroundColor: palette.mode === 'dark' ? softTint(colors.primary[600], 'dark') : colors.primary[100],
                borderColor: palette.bg.card,
                marginLeft: idx === 0 ? 0 : -6,
                zIndex: 10 - idx,
              },
            ]}
          >
            <Text style={styles.miniAvatarText}>
              {/* `fullName` is typed as required `string`, but the API
                  has been seen returning null for legacy records. Guard
                  with `|| ''` so a single bad row doesn't crash the
                  whole hero card with a TypeError on .split. */}
              {(s.fullName || '')
                .split(' ')
                .map((w) => w[0] || '')
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
              {
                backgroundColor: palette.bg.muted,
                borderColor: palette.bg.card,
                marginLeft: visible.length === 0 ? 0 : -6,
              },
            ]}
          >
            <Text style={[styles.miniAvatarMoreText, { color: palette.text.secondary }]}>+{more}</Text>
          </View>
        )}
        {visible.length === 0 && !isLoading && (
          <Text style={[styles.snapshotEmpty, { color: palette.text.tertiary }]}>—</Text>
        )}
      </View>
    </AnimatedCard>
  );
}

function CallsSnapshot() {
  const navigation = useNavigation<any>();
  const palette = useColors();
  // LOCAL date — `toISOString()` is UTC: after local midnight (and before
  // UTC midnight) the widget showed YESTERDAY's calls in RU timezones.
  // Must stay in sync with the ['calls-summary', today] login prefetch.
  const today = toLocalISODate();
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
      style={[styles.snapshotCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
      onPress={() => navigation.navigate('Main', { screen: 'MoreTab', params: { screen: 'Calls', initial: false } })}
    >
      <View style={styles.snapshotHeaderRow}>
        <View
          style={[
            styles.snapshotIconBox,
            { backgroundColor: palette.mode === 'dark' ? softTint(colors.purple[600], 'dark') : colors.purple[50] },
          ]}
        >
          <Ionicons name="call-outline" size={14} color={colors.purple[600]} />
        </View>
        <Text style={[styles.snapshotLabel, { color: palette.text.secondary }]}>Звонки сегодня</Text>
      </View>
      {isLoading ? (
        <Skeleton width={36} height={28} radius={6} />
      ) : (
        <Text style={[styles.snapshotValue, { color: palette.text.primary }]}>{total}</Text>
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
          <Text style={[styles.callsMiniText, { color: palette.text.secondary }]}>
            <Text style={{ color: colors.green[600], fontWeight: '700' }}>{incoming}</Text> входящих
          </Text>
          <Text style={[styles.callsMiniText, { color: palette.text.secondary }]}>
            <Text style={{ color: colors.red[600], fontWeight: '700' }}>{missed}</Text> пропущ.
          </Text>
        </View>
      </View>
    </AnimatedCard>
  );
}

// ── REMOVED: OwnerQuickActions + TopPerformers — заменены на стек
// владельческих виджетов ниже (CashPositionCard, MarginCard, …,
// MonthForecastCard). См. секцию "OWNER WIDGETS" ниже.

// ════════════════════════════════════════════════════════════════════════════
//  ADMIN / OWNER DASHBOARD orchestrator
// ════════════════════════════════════════════════════════════════════════════
//
// Combines the 6 hero blocks. Не показывает ShiftControl — это фича мастера.
// ── Call Funnel Widget ────────────────────────────────────────────────────────
function CallFunnelWidget() {
  const palette = useColors();

  const now = new Date();
  const dateFrom = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const dateTo = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const monthLabel = now.toLocaleDateString('ru-RU', { month: 'long' });

  const { data: funnel } = useQuery({
    queryKey: ['call-funnel', dateFrom, dateTo],
    queryFn: async () => {
      const res = await reportsApi.callFunnel({ dateFrom, dateTo });
      return res.data;
    },
    staleTime: 5 * 60_000,
    placeholderData: (prev) => prev,
  });

  if (!funnel) return null;

  const tiles = [
    { label: 'Звонков', value: String(funnel.totalCalls), icon: 'call-outline' as const, color: colors.primary[600] },
    { label: 'Приехало', value: String(funnel.arrivedClients), icon: 'car-outline' as const, color: colors.teal[600] },
    {
      label: 'Чеков создано',
      value: String(funnel.createdChecks),
      icon: 'receipt-outline' as const,
      color: colors.orange[600],
    },
    {
      label: 'Конверсия',
      value: `${funnel.conversionRate.toFixed(0)}%`,
      icon: 'trending-up-outline' as const,
      color: colors.green[600],
    },
  ];

  return (
    <AnimatedCard
      index={8}
      style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: spacing[3],
        }}
      >
        <Text style={[styles.sectionLabel, { color: palette.text.tertiary, fontSize: 11, letterSpacing: 0.5 }]}>
          ВОРОНКА ЗВОНКОВ
        </Text>
        <Text style={[{ fontSize: 11, color: palette.text.tertiary }]}>{monthLabel}</Text>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] }}>
        {tiles.map((tile) => (
          <View
            key={tile.label}
            style={[styles.funnelTile, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
          >
            <Ionicons name={tile.icon} size={15} color={tile.color} />
            <Text style={[styles.funnelTileValue, { color: palette.text.primary }]}>{tile.value}</Text>
            <Text style={[styles.funnelTileLabel, { color: palette.text.tertiary }]}>{tile.label}</Text>
          </View>
        ))}
      </View>
    </AnimatedCard>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  OWNER WIDGETS (iter#14, 2026-05-22)
// ════════════════════════════════════════════════════════════════════════════
//
// Стек владельческих виджетов, размещаемых после Hero + KPI + Chart +
// Today Snapshot. Каждый виджет — самостоятельный компонент со своим
// query'ом, своим period-state'ом (где применимо), своим placeholderData
// и своим переходом по тапу. Все query staleTime 60 сек; первая выдача
// — из persistent cache (`reports-*` префиксы в persistentCache.ts).

// ── helpers (date ranges + period chips) ────────────────────────────────────
type SimplePeriod = 'week' | 'month' | 'year';

function isoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function rangeForSimplePeriod(period: SimplePeriod): { from: string; to: string } {
  const now = new Date();
  const to = isoDay(now);
  if (period === 'year') {
    const yStart = new Date(now.getFullYear(), 0, 1);
    return { from: isoDay(yStart), to };
  }
  if (period === 'month') {
    const mStart = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: isoDay(mStart), to };
  }
  // week — Mon → today
  const dow = now.getDay() || 7;
  const wStart = new Date(now);
  wStart.setDate(now.getDate() - dow + 1);
  return { from: isoDay(wStart), to };
}

interface PeriodChipsProps {
  value: SimplePeriod;
  onChange: (p: SimplePeriod) => void;
  palette: SemanticPalette;
}

const PeriodChips = React.memo(function PeriodChips({ value, onChange, palette }: PeriodChipsProps) {
  const items: { key: SimplePeriod; label: string }[] = [
    { key: 'week', label: 'Неделя' },
    { key: 'month', label: 'Месяц' },
    { key: 'year', label: 'Год' },
  ];
  return (
    <View style={[styles.periodChipsRow, { backgroundColor: palette.bg.muted }]}>
      {items.map((it) => {
        const active = value === it.key;
        return (
          <TouchableOpacity
            key={it.key}
            style={[styles.periodChip, active && [styles.periodChipActive, { backgroundColor: palette.bg.card }]]}
            onPress={() => {
              haptic('select');
              onChange(it.key);
            }}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.periodChipText,
                { color: palette.text.secondary },
                active && { color: palette.text.primary, fontWeight: '700' },
              ]}
            >
              {it.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
});

// ── 1. Cash Position ────────────────────────────────────────────────────────
// 3-row breakdown (Наличные / Карта / Гарантия) + big total. Тап → CashFlow.
// CRITICAL widget — the cash position is the number the owner trusts to plan
// payouts. Showing yesterday's value silently is worse than a 300 ms spinner.
// HYBRID-perf plan, part 3: refetch on every mount, no placeholder fall-back.
// Other widgets on the dashboard keep `placeholderData` for instant feel.
function CashPositionCard() {
  const palette = useColors();
  const navigation = useNavigation<any>();
  // Near-live cash position: poll every 30s but only while the Dashboard is
  // focused (no background battery drain when the user is on another tab).
  // (The client-side If-None-Match/304 layer was removed — see api/axios.ts —
  // so each poll is a normal full GET.) Pattern mirrors CallsScreen's
  // focus-gated poll.
  const [pollEnabled, setPollEnabled] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setPollEnabled(true);
      return () => setPollEnabled(false);
    }, []),
  );
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-v2', 'today'],
    queryFn: async () => (await reportsApi.dashboardV2({ period: 'today' })).data,
    staleTime: 60_000,
    placeholderData: undefined,
    refetchOnMount: 'always',
    refetchOnReconnect: true,
    refetchInterval: pollEnabled ? 30_000 : false,
  });

  const cash = data?.cashPosition?.cash ?? 0;
  const card = data?.cashPosition?.card ?? 0;
  const warranty = data?.cashPosition?.warranty ?? 0;
  const total = data?.cashPosition?.total ?? 0;
  // Рассрочка: долг по сегодняшним чекам и погашения за сегодня (по дате
  // платежа). Поля опциональные — старый бэк их не шлёт, строки прячем.
  // «Всего на руках» их НЕ включает: долг — ещё не деньги, погашения — деньги
  // за прошлые продажи.
  const installmentDebt = data?.cashPosition?.installmentDebt;
  const installmentPaid = data?.cashPosition?.installmentPaid;
  // Разбивка погашений по способу оплаты (119) — подпись «в т.ч. наличными /
  // картой» показываем только когда бэк прислал поля и часть ненулевая.
  const installmentPaidParts: string[] = [];
  if (typeof data?.cashPosition?.installmentPaidCash === 'number' && data.cashPosition.installmentPaidCash > 0) {
    installmentPaidParts.push(`наличными ${formatMoney(data.cashPosition.installmentPaidCash)}`);
  }
  if (typeof data?.cashPosition?.installmentPaidCard === 'number' && data.cashPosition.installmentPaidCard > 0) {
    installmentPaidParts.push(`картой ${formatMoney(data.cashPosition.installmentPaidCard)}`);
  }

  const rows: {
    key: 'cash' | 'card' | 'warranty' | 'installmentDebt';
    label: string;
    value: number;
    icon: keyof typeof Ionicons.glyphMap;
    color: string;
    bg: string;
  }[] = [
    {
      key: 'cash',
      label: 'Наличные',
      value: cash,
      icon: 'cash-outline',
      color: colors.green[600],
      bg: palette.mode === 'dark' ? softTint(colors.green[600], 'dark') : colors.green[50],
    },
    {
      key: 'card',
      label: 'На карте',
      value: card,
      icon: 'card-outline',
      color: colors.blue[600],
      bg: palette.mode === 'dark' ? softTint(colors.blue[600], 'dark') : colors.blue[50],
    },
    {
      key: 'warranty',
      label: 'Гарантия',
      value: warranty,
      icon: 'shield-checkmark-outline',
      color: colors.amber[600],
      bg: palette.mode === 'dark' ? softTint(colors.amber[600], 'dark') : colors.amber[50],
    },
  ];
  if (typeof installmentDebt === 'number' && installmentDebt > 0) {
    rows.push({
      key: 'installmentDebt',
      label: 'Рассрочка (долг)',
      value: installmentDebt,
      icon: 'time-outline',
      color: colors.purple[600],
      bg: palette.mode === 'dark' ? softTint(colors.purple[600], 'dark') : colors.purple[50],
    });
  }

  return (
    <AnimatedCard
      index={5}
      style={[styles.ownerCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
      onPress={() => {
        haptic('tap');
        navigation.navigate('Main', { screen: 'MoreTab', params: { screen: 'CashFlow', initial: false } });
      }}
    >
      <View style={styles.ownerCardHeader}>
        <View
          style={[
            styles.ownerCardIcon,
            { backgroundColor: palette.mode === 'dark' ? softTint(colors.primary[600], 'dark') : colors.primary[50] },
          ]}
        >
          <Ionicons name="wallet-outline" size={16} color={colors.primary[600]} />
        </View>
        <Text style={[styles.ownerCardLabel, { color: palette.text.secondary }]}>КАССА СЕГОДНЯ</Text>
        <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} style={{ marginLeft: 'auto' }} />
      </View>
      <View style={[styles.cashTotalBox, { borderBottomColor: palette.border.subtle }]}>
        <Text style={[styles.cashTotalLabel, { color: palette.text.tertiary }]}>Всего на руках</Text>
        {isLoading ? (
          <Skeleton width={180} height={32} radius={8} />
        ) : (
          <Text style={[styles.cashTotalValue, { color: colors.primary[600] }]} numberOfLines={1} adjustsFontSizeToFit>
            {formatMoney(total)}
          </Text>
        )}
      </View>
      <View style={{ gap: spacing[2] }}>
        {rows.map((r) => (
          <View key={r.key} style={styles.cashRowItem}>
            <View style={[styles.cashRowIcon, { backgroundColor: r.bg }]}>
              <Ionicons name={r.icon} size={14} color={r.color} />
            </View>
            <Text style={[styles.cashRowLabel, { color: palette.text.primary }]}>{r.label}</Text>
            <Text style={[styles.cashRowValue, { color: palette.text.primary }]}>{formatMoney(r.value)}</Text>
          </View>
        ))}
        {typeof installmentPaid === 'number' && installmentPaid > 0 && (
          <View style={styles.cashRowItem}>
            <View
              style={[
                styles.cashRowIcon,
                { backgroundColor: palette.mode === 'dark' ? softTint(colors.teal[600], 'dark') : colors.teal[50] },
              ]}
            >
              <Ionicons name="checkmark-done-outline" size={14} color={colors.teal[600]} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.cashRowLabel, { flex: undefined, color: palette.text.primary }]}>
                Погашения рассрочки
              </Text>
              <Text style={[styles.cashRowNote, { color: palette.text.tertiary }]}>
                За прошлые продажи — в оборот не входят
              </Text>
              {installmentPaidParts.length > 0 && (
                <Text style={[styles.cashRowNote, { color: palette.text.tertiary }]}>
                  в т.ч. {installmentPaidParts.join(' · ')}
                </Text>
              )}
            </View>
            <Text style={[styles.cashRowValue, { color: colors.teal[600] }]}>+{formatMoney(installmentPaid)}</Text>
          </View>
        )}
      </View>
    </AnimatedCard>
  );
}

// ── 2. Margin % ─────────────────────────────────────────────────────────────
// Большая цифра + delta chip + sparkline 30 точек.
function MarginCard() {
  const palette = useColors();
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-v2', 'today'],
    queryFn: async () => (await reportsApi.dashboardV2({ period: 'today' })).data,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });

  const margin = data?.marginPct ?? 0;
  const change = data?.marginPctChange ?? 0;
  const spark = Array.isArray(data?.marginSpark) ? data.marginSpark : [];
  const W = SCREEN_WIDTH - spacing[4] * 2 - spacing[5] * 2;
  const H = 60;
  const path = useMemo(() => buildSparkPath(spark, W, H), [spark, W, H]);
  const area = useMemo(() => buildSparkAreaPath(spark, W, H), [spark, W, H]);

  const tone: 'up' | 'down' | 'flat' = change > 0.5 ? 'up' : change < -0.5 ? 'down' : 'flat';
  const chipColor = tone === 'up' ? colors.green[600] : tone === 'down' ? colors.red[600] : palette.text.tertiary;
  const chipBg =
    tone === 'up'
      ? palette.mode === 'dark'
        ? softTint(colors.green[600], 'dark')
        : colors.green[50]
      : tone === 'down'
        ? palette.mode === 'dark'
          ? softTint(colors.red[600], 'dark')
          : colors.red[50]
        : palette.bg.muted;

  return (
    <AnimatedCard
      index={6}
      style={[styles.ownerCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
    >
      <View style={styles.ownerCardHeader}>
        <View
          style={[
            styles.ownerCardIcon,
            { backgroundColor: palette.mode === 'dark' ? softTint(colors.green[600], 'dark') : colors.green[50] },
          ]}
        >
          <Ionicons name="stats-chart-outline" size={16} color={colors.green[600]} />
        </View>
        <Text style={[styles.ownerCardLabel, { color: palette.text.secondary }]}>МАРЖИНАЛЬНОСТЬ</Text>
      </View>
      <View style={styles.marginRow}>
        <View style={{ flex: 1 }}>
          {isLoading ? (
            <Skeleton width={120} height={36} radius={8} />
          ) : (
            <Text style={[styles.marginValue, { color: palette.text.primary }]} numberOfLines={1}>
              {margin.toFixed(1)}%
            </Text>
          )}
          <Text style={[styles.marginCaption, { color: palette.text.tertiary }]}>Чистая прибыль / Оборот</Text>
        </View>
        {!isLoading && (
          <View style={[styles.marginChip, { backgroundColor: chipBg }]}>
            <Ionicons
              name={tone === 'up' ? 'arrow-up' : tone === 'down' ? 'arrow-down' : 'remove'}
              size={12}
              color={chipColor}
            />
            <Text style={[styles.marginChipText, { color: chipColor }]}>{Math.abs(change).toFixed(0)}%</Text>
          </View>
        )}
      </View>
      {spark.length > 1 && (
        <View style={{ marginTop: spacing[3] }}>
          <Svg width={W} height={H}>
            <Defs>
              <SvgGrad id="marginGrad" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0%" stopColor={colors.green[400]} stopOpacity={0.4} />
                <Stop offset="100%" stopColor={colors.green[400]} stopOpacity={0} />
              </SvgGrad>
            </Defs>
            <Path d={area} fill="url(#marginGrad)" />
            <Path d={path} stroke={colors.green[600]} strokeWidth={2} fill="none" strokeLinecap="round" />
          </Svg>
        </View>
      )}
    </AnimatedCard>
  );
}

// ── 3. Deferred (зависшие отложенные) ───────────────────────────────────────
function DeferredCard() {
  const palette = useColors();
  const navigation = useNavigation<any>();
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-v2', 'today'],
    queryFn: async () => (await reportsApi.dashboardV2({ period: 'today' })).data,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });

  const count = data?.deferredSum?.count ?? 0;
  const sum = data?.deferredSum?.sum ?? 0;
  if (!data) {
    if (isLoading)
      return (
        <AnimatedCard
          index={7}
          style={[styles.ownerCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
        >
          <Skeleton width={'70%'} height={20} radius={6} />
        </AnimatedCard>
      );
    return null;
  }
  if (count === 0) {
    // Hide card entirely when no deferred — owner sees a tighter stack.
    return null;
  }

  const isWarning = sum > 50000;
  const accentColor = isWarning ? colors.amber[600] : colors.primary[600];
  const accentBg = isWarning
    ? palette.mode === 'dark'
      ? softTint(colors.amber[600], 'dark')
      : colors.amber[50]
    : palette.mode === 'dark'
      ? softTint(colors.primary[600], 'dark')
      : colors.primary[50];

  return (
    <AnimatedCard
      index={7}
      style={
        [
          styles.ownerCard,
          { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
          ...(isWarning ? [{ borderLeftWidth: 3, borderLeftColor: colors.amber[600] }] : []),
        ] as any
      }
      onPress={() => {
        haptic('tap');
        navigation.navigate('Main', { screen: 'Checks', params: { screen: 'ChecksHome', params: { deferred: true } } });
      }}
    >
      <View style={styles.ownerCardHeader}>
        <View style={[styles.ownerCardIcon, { backgroundColor: accentBg }]}>
          <Ionicons name="hourglass-outline" size={16} color={accentColor} />
        </View>
        <Text style={[styles.ownerCardLabel, { color: palette.text.secondary }]}>ЗАВИСШИЕ ОТЛОЖЕННЫЕ</Text>
        <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} style={{ marginLeft: 'auto' }} />
      </View>
      <Text style={[styles.deferredMain, { color: palette.text.primary }]}>
        <Text style={[styles.deferredAccent, { color: accentColor }]}>{count}</Text>{' '}
        {count === 1 ? 'чек' : count < 5 ? 'чека' : 'чеков'} на{' '}
        <Text style={[styles.deferredAccent, { color: accentColor }]}>{formatMoney(sum)}</Text>
      </Text>
      <Text style={[styles.deferredCaption, { color: palette.text.tertiary }]}>ждут оплаты</Text>
    </AnimatedCard>
  );
}

// ── 4. Warehouse analytics — складская аналитика ────────────────────────────
// Combines stock-value summary (current + delta vs start of month, items count,
// dead-stock 90d) with reorder forecast top-3 urgent items. Tap → MoreTab →
// WarehouseAnalytics (screen registered lazily; widget tolerates missing route).
function WarehouseAnalyticsWidget() {
  const palette = useColors();
  const navigation = useNavigation<any>();

  const summaryQuery = useQuery<WarehouseSummary>({
    queryKey: ['warehouse-analytics', 'summary', 'month'],
    queryFn: async () => (await warehouseAnalyticsApi.summary({ period: 'month' })).data,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
  const forecastQuery = useQuery<ReorderItem[]>({
    queryKey: ['warehouse-analytics', 'reorder-forecast'],
    queryFn: async () => (await warehouseAnalyticsApi.reorderForecast()).data,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });

  const summary = summaryQuery.data;
  const isLoading = summaryQuery.isLoading && !summary;

  // Top-3 urgent reorder picks. We keep `urgency in (critical, now, soon)`
  // — `overstocked` is the opposite signal and would just clutter the
  // "Рекомендуем заказать" list.
  const URGENCY_RANK: Record<ReorderItem['urgency'], number> = {
    critical: 0,
    now: 1,
    soon: 2,
    overstocked: 99,
  };
  const reorderTop = useMemo(() => {
    const items = Array.isArray(forecastQuery.data) ? forecastQuery.data : [];
    return items
      .filter((r) => r.urgency === 'critical' || r.urgency === 'now' || r.urgency === 'soon')
      .sort((a, b) => {
        const ra = URGENCY_RANK[a.urgency];
        const rb = URGENCY_RANK[b.urgency];
        if (ra !== rb) return ra - rb;
        // Same urgency tier → fewer days of stock first.
        return a.daysOfStock - b.daysOfStock;
      })
      .slice(0, 3);
    // URGENCY_RANK is module-local constant, no need in deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forecastQuery.data]);

  const deltaValue = summary?.stockValueDelta ?? 0;
  const deltaPct = summary?.deltaPct ?? 0;
  const tone: 'up' | 'down' | 'flat' = deltaValue > 0 ? 'up' : deltaValue < 0 ? 'down' : 'flat';
  // Growing stock value = green (capital rising); shrinking = red (capital
  // leaving the warehouse, usually because nothing is being replenished).
  // Owner's POV: «Капитал в товаре» — рост ≠ всегда хорошо, но визуально
  // green/red остаётся читаемым.
  const deltaColor = tone === 'up' ? colors.green[600] : tone === 'down' ? colors.red[600] : palette.text.tertiary;
  const deltaBg =
    tone === 'up'
      ? palette.mode === 'dark'
        ? softTint(colors.green[600], 'dark')
        : colors.green[50]
      : tone === 'down'
        ? palette.mode === 'dark'
          ? softTint(colors.red[600], 'dark')
          : colors.red[50]
        : palette.bg.muted;

  // Dead-stock 90d красный, если он съедает >5% капитала склада. Иначе —
  // нейтральный текст, чтобы виджет не «кричал» без повода.
  const totalValue = summary?.stockValueCurrent ?? 0;
  const deadValue = summary?.deadStock90?.value ?? 0;
  const deadCount = summary?.deadStock90?.count ?? 0;
  const deadPct = totalValue > 0 ? deadValue / totalValue : 0;
  const deadIsHot = deadPct > 0.05;
  const deadColor = deadIsHot ? colors.red[600] : palette.text.primary;

  const openAnalytics = () => {
    haptic('tap');
    // Screen is registered separately. If it doesn't exist yet, react-
    // navigation logs a warning and noop's — we don't crash the dashboard.
    navigation.navigate('Main', {
      screen: 'MoreTab',
      params: { screen: 'WarehouseAnalytics', initial: false },
    });
  };

  return (
    <AnimatedCard
      index={8}
      style={[styles.ownerCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
      onPress={openAnalytics}
      activeOpacity={0.85}
    >
      <View style={styles.ownerCardHeader}>
        <View
          style={[
            styles.ownerCardIcon,
            { backgroundColor: palette.mode === 'dark' ? softTint(colors.amber[600], 'dark') : colors.amber[50] },
          ]}
        >
          <Text style={styles.warehouseHeaderEmoji}>📦</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.ownerCardLabel, { color: palette.text.secondary }]}>СКЛАД</Text>
          <Text style={[styles.warehouseSubtitle, { color: palette.text.tertiary }]}>За месяц</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} />
      </View>

      {/* Hero: stock value + delta chip */}
      {isLoading ? (
        <Skeleton width={'70%'} height={36} radius={8} />
      ) : (
        <View style={styles.warehouseHeroRow}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.warehouseHeroValue, { color: palette.text.primary }]} numberOfLines={1}>
              {formatMoney(totalValue)}
            </Text>
            <Text style={[styles.warehouseHeroCaption, { color: palette.text.tertiary }]}>Капитал в товаре</Text>
          </View>
          {summary && (
            <View style={[styles.warehouseDeltaChip, { backgroundColor: deltaBg }]}>
              <Ionicons
                name={tone === 'up' ? 'arrow-up' : tone === 'down' ? 'arrow-down' : 'remove'}
                size={12}
                color={deltaColor}
              />
              <Text style={[styles.warehouseDeltaText, { color: deltaColor }]}>
                {`${Math.abs(deltaPct).toFixed(0)}% / ${formatMoney(Math.abs(deltaValue))}`}
              </Text>
            </View>
          )}
        </View>
      )}

      {/* Divider */}
      <View style={[styles.warehouseDivider, { backgroundColor: palette.border.subtle }]} />

      {/* Mini stats: items count + dead stock 90d */}
      <View style={styles.warehouseStatsRow}>
        <View style={styles.warehouseStatCell}>
          <Text style={[styles.warehouseStatLabel, { color: palette.text.tertiary }]}>Товаров</Text>
          {isLoading ? (
            <Skeleton width={60} height={18} radius={6} />
          ) : (
            <Text style={[styles.warehouseStatValue, { color: palette.text.primary }]}>{summary?.itemsCount ?? 0}</Text>
          )}
        </View>
        <View style={[styles.warehouseStatCell, styles.warehouseStatCellRight]}>
          <Text style={[styles.warehouseStatLabel, { color: palette.text.tertiary }]}>Мёртвый сток</Text>
          {isLoading ? (
            <Skeleton width={80} height={18} radius={6} />
          ) : (
            <Text style={[styles.warehouseStatValue, { color: deadColor }]} numberOfLines={1}>
              {`${formatMoney(deadValue)} (${deadCount})`}
            </Text>
          )}
        </View>
      </View>

      {/* Divider */}
      <View style={[styles.warehouseDivider, { backgroundColor: palette.border.subtle }]} />

      {/* Reorder forecast */}
      <View style={styles.warehouseReorderHeader}>
        <Text style={styles.warehouseReorderEmoji}>🤖</Text>
        <Text style={[styles.warehouseReorderTitle, { color: palette.text.secondary }]}>Рекомендуем заказать</Text>
      </View>
      {forecastQuery.isLoading && reorderTop.length === 0 ? (
        <View style={{ gap: spacing[1.5] }}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} width={'100%'} height={36} radius={8} />
          ))}
        </View>
      ) : reorderTop.length === 0 ? (
        <View style={styles.warehouseReorderEmpty}>
          <Ionicons name="checkmark-circle" size={18} color={colors.green[500]} />
          <Text style={[styles.warehouseReorderEmptyText, { color: palette.text.tertiary }]}>Запасы в норме</Text>
        </View>
      ) : (
        <View style={{ gap: spacing[1.5] }}>
          {reorderTop.map((item) => {
            const urgencyBar =
              item.urgency === 'critical'
                ? colors.red[500]
                : item.urgency === 'now'
                  ? colors.amber[600]
                  : colors.blue[400];
            return (
              <View
                key={item.productId}
                style={[styles.warehouseReorderRow, { backgroundColor: palette.bg.muted, borderLeftColor: urgencyBar }]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.warehouseReorderName, { color: palette.text.primary }]} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={[styles.warehouseReorderMeta, { color: palette.text.tertiary }]}>
                    {`Хватит на ${Math.max(0, Math.round(item.daysOfStock))} дн.`}
                  </Text>
                </View>
                <Text style={[styles.warehouseReorderQty, { color: palette.text.primary }]}>
                  {`~${Math.max(1, Math.round(item.recommendedOrderQty))} шт`}
                </Text>
              </View>
            );
          })}
        </View>
      )}
    </AnimatedCard>
  );
}

// ── 4b. Заканчиваются товары ────────────────────────────────────────────────
// M10: ['low-stock'] греется в prefetchAfterLogin, зеркалится в persistent
// cache и ревалидируется на foreground — но до сих пор ни один экран его не
// читал. Компактная карточка: до 3 названий + бейдж «ещё N». Пустой список
// или недоступный запрос → null (нулевая стоимость в layout'е). Тап → таб
// «Склад». Рендерится только в AdminDashboard — там же, где остальная
// складская аналитика (мастеру управление запасами не показываем).
function LowStockCard() {
  const palette = useColors();
  const navigation = useNavigation<any>();
  // Ключ/фабрика 1-в-1 как в AuthContext.prefetchAfterLogin — иначе кэш мимо.
  const { data } = useQuery<Product[]>({
    queryKey: ['low-stock'],
    queryFn: async () => (await productsApi.getLowStock()).data,
    staleTime: 60_000,
  });

  const items = Array.isArray(data) ? data : [];
  if (items.length === 0) return null;

  const top = items.slice(0, 3);
  const rest = items.length - top.length;

  return (
    <AnimatedCard
      index={9}
      style={[styles.ownerCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
      onPress={() => {
        haptic('tap');
        // Таб «Склад» — как KpiStrip ходит в таб «Журнал» ('Checks').
        navigation.navigate('Main', { screen: 'Products' });
      }}
    >
      <View style={styles.ownerCardHeader}>
        <View
          style={[
            styles.ownerCardIcon,
            { backgroundColor: palette.mode === 'dark' ? softTint(colors.red[500], 'dark') : colors.red[50] },
          ]}
        >
          <Ionicons name="alert-circle" size={16} color={colors.red[500]} />
        </View>
        <Text style={[styles.ownerCardLabel, { color: palette.text.secondary }]}>ЗАКАНЧИВАЮТСЯ ТОВАРЫ</Text>
        <View style={styles.lowStockHeaderRight}>
          {rest > 0 && (
            <View
              style={[
                styles.lowStockBadge,
                { backgroundColor: palette.mode === 'dark' ? softTint(colors.red[600], 'dark') : colors.red[50] },
              ]}
            >
              <Text style={styles.lowStockBadgeText}>ещё {rest}</Text>
            </View>
          )}
          <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} />
        </View>
      </View>
      <View style={{ gap: spacing[1.5] }}>
        {top.map((p) => (
          <View key={p.id} style={styles.lowStockRow}>
            <Text style={[styles.lowStockName, { color: palette.text.primary }]} numberOfLines={1}>
              {p.name}
            </Text>
            <Text style={styles.lowStockQty}>
              {p.stock} {p.unit || 'шт'}
            </Text>
          </View>
        ))}
      </View>
    </AnimatedCard>
  );
}

// ── Рассрочка (installments) ───────────────────────────────────────────────
// Owner/admin compact widget: предстоящие и просроченные платежи по рассрочке
// (GET /installments/widget). Hero — общий остаток к получению; ниже — счётчики
// «просрочено» / «скоро» и до трёх ближайших строк. Пустой ответ (нет планов в
// окне) → null. Рендерится только в AdminDashboard (owner+admin). Тап → раздел
// «Рассрочка».
function InstallmentsWidget() {
  const palette = useColors();
  const navigation = useNavigation<any>();
  const { data } = useQuery<InstallmentWidget>({
    queryKey: ['installments', 'widget'],
    queryFn: async () => (await installmentsApi.widget()).data,
    staleTime: 60_000,
  });

  const items = data?.items ?? [];
  // Hide when there's nothing upcoming or overdue.
  if (items.length === 0) return null;

  const overdueCount = data?.overdueCount ?? 0;
  const dueSoonCount = data?.dueSoonCount ?? 0;
  const totalRemaining = data?.totalRemaining ?? 0;
  const top = items.slice(0, 3);
  const accent = overdueCount > 0 ? colors.red[500] : colors.amber[600];

  return (
    <AnimatedCard
      index={10}
      style={[styles.ownerCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
      onPress={() => {
        haptic('tap');
        navigation.navigate('Main', { screen: 'MoreTab', params: { screen: 'Installments', initial: false } });
      }}
    >
      <View style={styles.ownerCardHeader}>
        <View style={[styles.ownerCardIcon, { backgroundColor: softTint(accent, palette.mode) }]}>
          <Ionicons name="card" size={15} color={accent} />
        </View>
        <Text style={[styles.ownerCardLabel, { color: palette.text.secondary }]}>РАССРОЧКА</Text>
        <View style={styles.installmentHeaderRight}>
          <Text style={[styles.installmentTotal, { color: palette.text.primary }]} numberOfLines={1}>
            {formatInstallmentMoney(totalRemaining)}
          </Text>
          <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} />
        </View>
      </View>

      {/* Counters */}
      <View style={styles.installmentCounters}>
        {overdueCount > 0 ? (
          <View style={[styles.installmentPill, { backgroundColor: softTint(colors.red[500], palette.mode) }]}>
            <Ionicons name="alert-circle" size={13} color={colors.red[500]} />
            <Text style={[styles.installmentPillText, { color: colors.red[500] }]}>Просрочено: {overdueCount}</Text>
          </View>
        ) : null}
        {dueSoonCount > 0 ? (
          <View style={[styles.installmentPill, { backgroundColor: softTint(colors.amber[600], palette.mode) }]}>
            <Ionicons name="time-outline" size={13} color={colors.amber[600]} />
            <Text style={[styles.installmentPillText, { color: colors.amber[600] }]}>Скоро: {dueSoonCount}</Text>
          </View>
        ) : null}
      </View>

      {/* Top-3 nearest rows */}
      <View style={{ gap: spacing[1.5], marginTop: spacing[2.5] }}>
        {top.map((it) => {
          const due = dueLabel({ status: 'open', nextPaymentDate: it.nextPaymentDate, dueInDays: it.dueInDays });
          return (
            <View key={it.planId} style={styles.installmentRow}>
              <Text style={[styles.installmentName, { color: palette.text.primary }]} numberOfLines={1}>
                {it.clientName || 'Клиент'}
              </Text>
              <View style={styles.installmentRowRight}>
                {due ? (
                  <Text
                    style={[styles.installmentDue, { color: it.overdue ? colors.red[500] : palette.text.tertiary }]}
                    numberOfLines={1}
                  >
                    {due}
                  </Text>
                ) : null}
                <Text style={[styles.installmentAmount, { color: it.overdue ? colors.red[500] : colors.amber[600] }]}>
                  {formatInstallmentMoney(it.remaining)}
                </Text>
              </View>
            </View>
          );
        })}
      </View>
    </AnimatedCard>
  );
}

// ── 5. Clients New vs Returning ─────────────────────────────────────────────
// Premium analytics-style widget: matches OwnerAnalyticsChart visual language
// — segmented period control, hero total with two-tone delta, animated split
// bar, and icon-decorated revenue legend. Tap → Clients screen.
function ClientsNewVsReturningCard() {
  const palette = useColors();
  const navigation = useNavigation<any>();
  // Локальный picker: today / yesterday / scrollable day window / week /
  // month / year. Базовое состояние — month (как видит владелец дашборд по
  // умолчанию). dayOffset нужен только при mode === 'day'.
  type Mode = 'day' | 'week' | 'month' | 'year';
  const [mode, setMode] = useState<Mode>('month');
  const [dayOffset, setDayOffset] = useState(0); // 0 = сегодня, -1 = вчера, ...

  const range = useMemo(() => {
    const now = new Date();
    if (mode === 'day') {
      const d = new Date(now);
      d.setDate(now.getDate() + dayOffset);
      const day = isoDay(d);
      return { from: day, to: day };
    }
    if (mode === 'week') return rangeForSimplePeriod('week');
    if (mode === 'year') return rangeForSimplePeriod('year');
    return rangeForSimplePeriod('month');
  }, [mode, dayOffset]);

  const { data, isLoading } = useQuery({
    queryKey: ['clients-new-returning', range.from, range.to],
    queryFn: async () => (await reportsApi.clientsNewVsReturning(range)).data,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });

  const newCount = data?.newCount ?? 0;
  const returningCount = data?.returningCount ?? 0;
  const newRevenue = data?.newRevenue ?? 0;
  const returningRevenue = data?.returningRevenue ?? 0;
  const total = newCount + returningCount;
  const ratioNew = total > 0 ? newCount / total : 0;

  // Smoothly tween the split-bar widths when the user switches period or new
  // data arrives. Shared values stay on the UI thread — no JS-thread bridge
  // traffic on each frame.
  const newFlex = useSharedValue(ratioNew);
  const returnFlex = useSharedValue(1 - ratioNew);
  useEffect(() => {
    newFlex.value = withTiming(ratioNew, { duration: 480, easing: Easing.out(Easing.cubic) });
    returnFlex.value = withTiming(1 - ratioNew, { duration: 480, easing: Easing.out(Easing.cubic) });
  }, [ratioNew, newFlex, returnFlex]);
  const newBarStyle = useAnimatedStyle(() => ({ flex: Math.max(newFlex.value, 0.0001) }));
  const returnBarStyle = useAnimatedStyle(() => ({ flex: Math.max(returnFlex.value, 0.0001) }));

  // Динамически собираем 7-day window (от -3 до +3 от текущего offset),
  // но clamp по [-30, 0] так, чтобы окно "ползло" и не уходило в будущее.
  const dayWindow = useMemo(() => {
    const window: number[] = [];
    const start = Math.max(-27, Math.min(0, dayOffset - 3));
    for (let i = start; i < start + 7; i++) {
      if (i > 0) break;
      window.push(i);
    }
    return window;
  }, [dayOffset]);

  const formatDayLabel = (offset: number): string => {
    if (offset === 0) return 'Сег';
    if (offset === -1) return 'Вчр';
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return `${d.getDate()}.${String(d.getMonth() + 1).padStart(2, '0')}`;
  };

  // Human-readable period subtitle ("За месяц", "Сегодня" etc.) — mirrors
  // OwnerAnalyticsChart's getOffsetLabel feel.
  const periodLabel = (): string => {
    if (mode === 'week') return 'За неделю';
    if (mode === 'year') return 'За год';
    if (mode === 'month') return 'За месяц';
    if (dayOffset === 0) return 'Сегодня';
    if (dayOffset === -1) return 'Вчера';
    return formatDayLabel(dayOffset);
  };

  const openClients = () => {
    haptic('tap');
    navigation.navigate('Main', { screen: 'MoreTab', params: { screen: 'Clients', initial: false } });
  };

  return (
    <AnimatedCard
      index={9}
      style={[styles.ownerCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
      onPress={openClients}
      activeOpacity={0.92}
    >
      {/* Hero header — same rhythm as OwnerAnalyticsChart */}
      <View style={styles.chartHeaderRow}>
        <View>
          <Text style={[styles.chartHeaderTitle, { color: palette.text.primary }]}>Клиенты</Text>
          <Text style={[styles.chartHeaderSub, { color: palette.text.secondary }]}>{periodLabel()}</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} />
      </View>

      {/* iOS-segmented period control — same shape as the analytics chart */}
      <View style={[styles.segCtl, { backgroundColor: palette.bg.muted }]}>
        {(
          [
            { key: 'today', label: 'Сегодня' },
            { key: 'yesterday', label: 'Вчера' },
            { key: 'week', label: 'Неделя' },
            { key: 'month', label: 'Месяц' },
            { key: 'year', label: 'Год' },
          ] as const
        ).map((p) => {
          const active =
            (p.key === 'today' && mode === 'day' && dayOffset === 0) ||
            (p.key === 'yesterday' && mode === 'day' && dayOffset === -1) ||
            (p.key === 'week' && mode === 'week') ||
            (p.key === 'month' && mode === 'month') ||
            (p.key === 'year' && mode === 'year');
          return (
            <TouchableOpacity
              key={p.key}
              style={[styles.segCtlBtn, active && [styles.segCtlBtnActive, { backgroundColor: palette.bg.card }]]}
              onPress={() => {
                haptic('select');
                if (p.key === 'today') {
                  setMode('day');
                  setDayOffset(0);
                } else if (p.key === 'yesterday') {
                  setMode('day');
                  setDayOffset(-1);
                } else {
                  setMode(p.key as Mode);
                }
              }}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.segCtlText,
                  { color: palette.text.secondary },
                  active && [styles.segCtlTextActive, { color: palette.text.primary }],
                ]}
              >
                {p.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Numbers + stacked bar */}
      {isLoading && !data ? (
        <View style={{ gap: spacing[2] }}>
          <Skeleton width={'60%'} height={44} radius={10} />
          <Skeleton width={'100%'} height={12} radius={6} />
          <Skeleton width={'80%'} height={16} radius={6} />
        </View>
      ) : (
        <>
          {/* Hero total — big number + sub-caption */}
          <View style={styles.clientsHeroRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.clientsHeroValue, { color: palette.text.primary }]}>{total}</Text>
              <Text style={[styles.clientsHeroCaption, { color: palette.text.tertiary }]}>
                {total === 1 ? 'клиент за период' : total < 5 && total > 0 ? 'клиента за период' : 'клиентов за период'}
              </Text>
            </View>
            {total > 0 && (
              <View
                style={[
                  styles.clientsRatioChip,
                  {
                    backgroundColor: palette.mode === 'dark' ? softTint(colors.purple[600], 'dark') : colors.purple[50],
                  },
                ]}
              >
                <Ionicons name="sparkles" size={11} color={colors.purple[600]} />
                <Text style={[styles.clientsRatioChipText, { color: colors.purple[700] }]}>
                  {`${Math.round(ratioNew * 100)}% новых`}
                </Text>
              </View>
            )}
          </View>

          {/* Animated split bar — flex tween via Reanimated UI-thread */}
          <View style={[styles.clientsSplitBar, { backgroundColor: palette.bg.muted }]}>
            {total > 0 ? (
              <>
                <Animated.View style={[{ backgroundColor: colors.purple[600] }, newBarStyle]} />
                <Animated.View style={[{ backgroundColor: colors.primary[500] }, returnBarStyle]} />
              </>
            ) : null}
          </View>

          {/* Legend with icon decoration — premium feel */}
          <View style={styles.clientsLegendRow}>
            <View style={styles.clientsLegendItem}>
              <View style={[styles.clientsLegendDot, { backgroundColor: colors.purple[600] }]}>
                <Ionicons name="bulb-outline" size={10} color={colors.white} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.clientsLegendLabel, { color: palette.text.secondary }]}>Новые</Text>
                <Text style={[styles.clientsLegendValue, { color: palette.text.primary }]} numberOfLines={1}>
                  {`${newCount} · ${formatMoney(newRevenue)}`}
                </Text>
              </View>
            </View>
            <View style={styles.clientsLegendItem}>
              <View style={[styles.clientsLegendDot, { backgroundColor: colors.primary[500] }]}>
                <Ionicons name="refresh" size={10} color={colors.white} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.clientsLegendLabel, { color: palette.text.secondary }]}>Постоянные</Text>
                <Text style={[styles.clientsLegendValue, { color: palette.text.primary }]} numberOfLines={1}>
                  {`${returningCount} · ${formatMoney(returningRevenue)}`}
                </Text>
              </View>
            </View>
          </View>

          {/* Day picker — surface only when user lands on a non-canonical day */}
          {mode === 'day' && dayOffset < -1 && (
            <View style={[styles.dayPickerRow, { marginTop: spacing[3] }]}>
              <TouchableOpacity
                style={[styles.dayArrow, { backgroundColor: palette.bg.muted }]}
                onPress={() => {
                  haptic('tap');
                  setDayOffset((o) => Math.max(o - 1, -30));
                }}
                hitSlop={6}
              >
                <Ionicons name="chevron-back" size={14} color={palette.text.secondary} />
              </TouchableOpacity>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: spacing[1.5], paddingHorizontal: spacing[2] }}
              >
                {dayWindow.map((off) => {
                  const active = off === dayOffset;
                  return (
                    <TouchableOpacity
                      key={off}
                      style={[styles.dayChip, { backgroundColor: active ? colors.primary[600] : palette.bg.muted }]}
                      onPress={() => {
                        haptic('tap');
                        setDayOffset(off);
                      }}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.dayChipText, { color: active ? colors.white : palette.text.secondary }]}>
                        {formatDayLabel(off)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
              <TouchableOpacity
                style={[styles.dayArrow, { backgroundColor: palette.bg.muted }, dayOffset >= 0 && { opacity: 0.4 }]}
                onPress={() => {
                  haptic('tap');
                  setDayOffset((o) => Math.min(o + 1, 0));
                }}
                disabled={dayOffset >= 0}
                hitSlop={6}
              >
                <Ionicons name="chevron-forward" size={14} color={palette.text.secondary} />
              </TouchableOpacity>
            </View>
          )}
        </>
      )}
    </AnimatedCard>
  );
}

// ── 7. Retention ────────────────────────────────────────────────────────────
function RetentionCard() {
  const palette = useColors();
  const [period, setPeriod] = useState<SimplePeriod>('month');
  const { data, isLoading } = useQuery({
    queryKey: ['retention', period],
    queryFn: async () => (await reportsApi.retention({ period })).data,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });

  const returningRate = data?.returningRate ?? 0;
  const avgLtv = data?.avgLtv ?? 0;
  const avgDaysBetween = data?.avgDaysBetweenVisits ?? 0;

  return (
    <AnimatedCard
      index={11}
      style={[styles.ownerCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
    >
      <View style={styles.ownerCardHeader}>
        <View
          style={[
            styles.ownerCardIcon,
            { backgroundColor: palette.mode === 'dark' ? softTint(colors.teal[600], 'dark') : colors.teal[50] },
          ]}
        >
          <Ionicons name="repeat-outline" size={16} color={colors.teal[600]} />
        </View>
        <Text style={[styles.ownerCardLabel, { color: palette.text.secondary }]}>RETENTION КЛИЕНТОВ</Text>
      </View>
      <PeriodChips value={period} onChange={setPeriod} palette={palette} />
      {isLoading && !data ? (
        <View style={{ gap: spacing[2], marginTop: spacing[3] }}>
          <Skeleton width={'100%'} height={32} radius={8} />
          <Skeleton width={'80%'} height={16} radius={4} />
          <Skeleton width={'60%'} height={16} radius={4} />
        </View>
      ) : (
        <View style={{ marginTop: spacing[3], gap: spacing[2] }}>
          <View style={styles.retentionRow}>
            <Text style={[styles.retentionLabel, { color: palette.text.secondary }]}>Возвращаются</Text>
            <Text style={[styles.retentionValue, { color: colors.teal[600] }]}>{Math.round(returningRate)}%</Text>
          </View>
          <View style={styles.retentionRow}>
            <Text style={[styles.retentionLabel, { color: palette.text.secondary }]}>Средний LTV</Text>
            <Text style={[styles.retentionValue, { color: palette.text.primary }]}>{formatMoney(avgLtv)}</Text>
          </View>
          <View style={styles.retentionRow}>
            <Text style={[styles.retentionLabel, { color: palette.text.secondary }]}>Возвращаются через</Text>
            <Text style={[styles.retentionValue, { color: palette.text.primary }]}>
              {avgDaysBetween > 0 ? `${Math.round(avgDaysBetween)} дн.` : '—'}
            </Text>
          </View>
        </View>
      )}
    </AnimatedCard>
  );
}

// ── 8. Best / worst day of week ─────────────────────────────────────────────
function BestDayOfWeekCard() {
  const palette = useColors();
  const [period, setPeriod] = useState<SimplePeriod>('month');
  const range = useMemo(() => rangeForSimplePeriod(period), [period]);
  const { data, isLoading } = useQuery({
    queryKey: ['best-day-week', range.from, range.to],
    queryFn: async () => (await reportsApi.bestDayOfWeek(range)).data,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });

  const days = Array.isArray(data?.days) ? data.days : [];
  const best = data?.best ?? -1;
  const worst = data?.worst ?? -1;
  const maxRev = Math.max(...days.map((d) => d.revenue), 1);
  const WEEKDAY_SHORT = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
  // Бар-chart рендерим в порядке Пн → Вс (хронологический), не воскр → суббота.
  const ORDERED = [1, 2, 3, 4, 5, 6, 0];
  const byWeekday = useMemo(() => {
    const m = new Map<number, { weekday: number; revenue: number; count: number }>();
    for (const d of days) m.set(d.weekday, d);
    return m;
  }, [days]);

  const bestDay = byWeekday.get(best);
  const worstDay = byWeekday.get(worst);

  const W = SCREEN_WIDTH - spacing[4] * 2 - spacing[5] * 2;
  const barGap = 8;
  const barW = (W - barGap * 6) / 7;
  const H = 90;

  return (
    <AnimatedCard
      index={12}
      style={[styles.ownerCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
    >
      <View style={styles.ownerCardHeader}>
        <View
          style={[
            styles.ownerCardIcon,
            { backgroundColor: palette.mode === 'dark' ? softTint(colors.indigo[600], 'dark') : colors.indigo[50] },
          ]}
        >
          <Ionicons name="calendar-outline" size={16} color={colors.indigo[600]} />
        </View>
        <Text style={[styles.ownerCardLabel, { color: palette.text.secondary }]}>ЛУЧШИЙ ДЕНЬ НЕДЕЛИ</Text>
      </View>
      <PeriodChips value={period} onChange={setPeriod} palette={palette} />
      {isLoading && !data ? (
        <View style={{ marginTop: spacing[3], height: H + 30 }}>
          <Skeleton width={'100%'} height={H} radius={8} />
        </View>
      ) : days.length === 0 ? (
        <Text style={[styles.emptyText, { color: palette.text.tertiary, marginTop: spacing[3] }]}>
          Нет данных за период
        </Text>
      ) : (
        <>
          <View style={[styles.bestDayBars, { marginTop: spacing[3], width: W, height: H }]}>
            {ORDERED.map((wd, idx) => {
              const d = byWeekday.get(wd);
              const rev = d?.revenue ?? 0;
              const h = maxRev > 0 ? Math.max((rev / maxRev) * (H - 18), 2) : 2;
              const isBest = wd === best;
              const isWorst = wd === worst;
              const fill = isBest ? colors.green[500] : isWorst ? colors.orange[500] : colors.primary[300];
              return (
                <View
                  key={wd}
                  style={{
                    width: barW,
                    height: H,
                    marginLeft: idx === 0 ? 0 : barGap,
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                  }}
                >
                  <View
                    style={{
                      width: barW,
                      height: h,
                      borderRadius: 6,
                      backgroundColor: fill,
                    }}
                  />
                  <Text style={[styles.weekdayLabel, { color: palette.text.tertiary }]}>{WEEKDAY_SHORT[wd]}</Text>
                </View>
              );
            })}
          </View>
          <View style={{ marginTop: spacing[2], gap: spacing[1] }}>
            {bestDay && (
              <Text style={[styles.bestDayCaption, { color: palette.text.secondary }]}>
                Лучший:{' '}
                <Text style={{ color: colors.green[700], fontWeight: '700' }}>
                  {WEEKDAY_SHORT[best]} · {formatMoney(bestDay.revenue)}
                </Text>
              </Text>
            )}
            {worstDay && (
              <Text style={[styles.bestDayCaption, { color: palette.text.secondary }]}>
                Худший:{' '}
                <Text style={{ color: colors.orange[600], fontWeight: '700' }}>
                  {WEEKDAY_SHORT[worst]} · {formatMoney(worstDay.revenue)}
                </Text>
              </Text>
            )}
          </View>
        </>
      )}
    </AnimatedCard>
  );
}

// ── 9. Recent reviews ───────────────────────────────────────────────────────
function RecentReviewsCard() {
  const palette = useColors();
  const navigation = useNavigation<any>();
  const { data, isLoading } = useQuery({
    queryKey: ['recent-reviews', 5],
    queryFn: async () => (await reportsApi.recentReviews(5)).data,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });

  const reviews = Array.isArray(data) ? data : [];

  return (
    <AnimatedCard
      index={13}
      style={[styles.ownerCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
      onPress={() => {
        haptic('tap');
        navigation.navigate('Main', { screen: 'MoreTab', params: { screen: 'Marketing', initial: false } });
      }}
    >
      <View style={styles.ownerCardHeader}>
        <View
          style={[
            styles.ownerCardIcon,
            { backgroundColor: palette.mode === 'dark' ? softTint(colors.amber[600], 'dark') : colors.amber[50] },
          ]}
        >
          <Ionicons name="star-outline" size={16} color={colors.amber[600]} />
        </View>
        <Text style={[styles.ownerCardLabel, { color: palette.text.secondary }]}>ПОСЛЕДНИЕ ОТЗЫВЫ</Text>
        <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} style={{ marginLeft: 'auto' }} />
      </View>
      {isLoading && reviews.length === 0 ? (
        <View style={{ gap: spacing[2] }}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} width={'100%'} height={52} radius={10} />
          ))}
        </View>
      ) : reviews.length === 0 ? (
        <Text style={[styles.emptyText, { color: palette.text.tertiary }]}>Пока нет отзывов</Text>
      ) : (
        <View style={{ gap: spacing[2] }}>
          {reviews.map((r) => (
            <ReviewRow key={r.id} review={r} palette={palette} />
          ))}
        </View>
      )}
    </AnimatedCard>
  );
}

const ReviewRow = React.memo(function ReviewRow({
  review,
  palette,
}: {
  review: RecentReview;
  palette: SemanticPalette;
}) {
  const isLow = review.rating <= 3;
  const firstLetter = (review.clientName || '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <View
      style={[
        styles.reviewRow,
        { backgroundColor: palette.bg.muted },
        isLow && { borderLeftWidth: 3, borderLeftColor: colors.red[500] },
      ]}
    >
      <View
        style={[
          styles.reviewAvatar,
          {
            backgroundColor: isLow
              ? palette.mode === 'dark'
                ? softTint(colors.red[600], 'dark')
                : colors.red[100]
              : palette.mode === 'dark'
                ? softTint(colors.primary[600], 'dark')
                : colors.primary[100],
          },
        ]}
      >
        <Text style={[styles.reviewAvatarText, { color: isLow ? colors.red[700] : colors.primary[700] }]}>
          {firstLetter}
        </Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={styles.reviewStarsRow}>
          {[1, 2, 3, 4, 5].map((i) => (
            <Ionicons
              key={i}
              name={i <= review.rating ? 'star' : 'star-outline'}
              size={11}
              color={i <= review.rating ? colors.yellow[500] : palette.border.subtle}
            />
          ))}
          {review.employeeName && (
            <Text style={[styles.reviewEmployee, { color: palette.text.tertiary }]} numberOfLines={1}>
              · {review.employeeName}
            </Text>
          )}
        </View>
        {review.comment ? (
          <Text style={[styles.reviewComment, { color: palette.text.primary }]} numberOfLines={2}>
            {review.comment}
          </Text>
        ) : (
          <Text style={[styles.reviewComment, { color: palette.text.tertiary, fontStyle: 'italic' }]} numberOfLines={1}>
            Без комментария
          </Text>
        )}
      </View>
    </View>
  );
});

// ── 10. Personal record ─────────────────────────────────────────────────────
function PersonalRecordCard() {
  const palette = useColors();
  const { data } = useQuery({
    queryKey: ['dashboard-v2', 'today'],
    queryFn: async () => (await reportsApi.dashboardV2({ period: 'today' })).data,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });

  const bestDay = data?.personalRecord?.bestDay;
  const bestMonth = data?.personalRecord?.bestMonth;
  if (!bestDay && !bestMonth) return null;

  const todayRevenue = data?.revenueToday ?? 0;
  const distance = bestDay ? bestDay.value - todayRevenue : 0;
  const ratio = bestDay && bestDay.value > 0 ? todayRevenue / bestDay.value : 0;
  const closeToRecord = ratio >= 0.8 && distance > 0;

  const formatDay = (iso: string): string => {
    const parts = iso.split('-');
    if (parts.length !== 3) return iso;
    const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    return `${d.getDate()} ${MONTHS_RU_GEN[d.getMonth()]} ${d.getFullYear()}`;
  };
  const formatMonthYm = (ym: string): string => {
    const [y, m] = ym.split('-');
    const months = [
      'январь',
      'февраль',
      'март',
      'апрель',
      'май',
      'июнь',
      'июль',
      'август',
      'сентябрь',
      'октябрь',
      'ноябрь',
      'декабрь',
    ];
    return `${months[Number(m) - 1] ?? ''} ${y}`;
  };

  return (
    <AnimatedCard
      index={14}
      style={
        [
          styles.ownerCard,
          { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
          // Light: warm cream highlight (unchanged). Dark: a translucent amber
          // tint over the dark card + amber border, so the light card text
          // (text.primary) stays readable instead of vanishing on cream.
          ...(closeToRecord
            ? [
                palette.mode === 'dark'
                  ? { backgroundColor: 'rgba(245, 158, 11, 0.12)', borderColor: colors.amber[600] }
                  : styles.recordHighlight,
              ]
            : []),
        ] as any
      }
    >
      <View style={styles.ownerCardHeader}>
        <View
          style={[
            styles.ownerCardIcon,
            { backgroundColor: palette.mode === 'dark' ? softTint(colors.amber[600], 'dark') : colors.amber[50] },
          ]}
        >
          <Ionicons name="trophy-outline" size={16} color={colors.amber[600]} />
        </View>
        <Text style={[styles.ownerCardLabel, { color: palette.text.secondary }]}>ЛИЧНЫЙ РЕКОРД</Text>
      </View>
      {bestDay && (
        <View style={styles.recordRow}>
          <Ionicons name="today-outline" size={14} color={palette.text.tertiary} />
          <Text style={[styles.recordLabel, { color: palette.text.secondary }]}>Лучший день: </Text>
          <Text style={[styles.recordValue, { color: palette.text.primary }]} numberOfLines={1}>
            {formatDay(bestDay.date)} · <Text style={{ color: colors.amber[700] }}>{formatMoney(bestDay.value)}</Text>
          </Text>
        </View>
      )}
      {bestMonth && (
        <View style={styles.recordRow}>
          <Ionicons name="calendar-outline" size={14} color={palette.text.tertiary} />
          <Text style={[styles.recordLabel, { color: palette.text.secondary }]}>Лучший месяц: </Text>
          <Text style={[styles.recordValue, { color: palette.text.primary }]} numberOfLines={1}>
            {formatMonthYm(bestMonth.ym)} ·{' '}
            <Text style={{ color: colors.amber[700] }}>{formatMoney(bestMonth.value)}</Text>
          </Text>
        </View>
      )}
      {closeToRecord && (
        <View
          style={[
            styles.recordCloseBox,
            { backgroundColor: palette.mode === 'dark' ? softTint(colors.amber[600], 'dark') : colors.amber[50] },
          ]}
        >
          <Ionicons name="flame" size={14} color={colors.amber[700]} />
          <Text style={[styles.recordCloseText, { color: colors.amber[800] }]}>
            До рекорда осталось {formatMoney(distance)}
          </Text>
        </View>
      )}
    </AnimatedCard>
  );
}

// ── 11. Month forecast ──────────────────────────────────────────────────────
function MonthForecastCard() {
  const palette = useColors();
  const { data: v2 } = useQuery({
    queryKey: ['dashboard-v2', 'today'],
    queryFn: async () => (await reportsApi.dashboardV2({ period: 'today' })).data,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
  // Сравнение с прошлым месяцем — берём revenue из dashboard-chart('month', -1).
  const { data: prev } = useQuery({
    queryKey: ['dashboard-chart', 'month', -1],
    queryFn: async () => (await checksApi.getDashboardChart('month', -1)).data,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });

  const forecast = v2?.monthForecast ?? 0;
  const prevTotal = prev?.totalRevenue ?? 0;
  if (forecast <= 0) return null;

  const delta = formatDeltaPct(forecast, prevTotal);

  return (
    <AnimatedCard
      index={15}
      style={[styles.ownerCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
    >
      <View style={styles.ownerCardHeader}>
        <View
          style={[
            styles.ownerCardIcon,
            { backgroundColor: palette.mode === 'dark' ? softTint(colors.primary[600], 'dark') : colors.primary[50] },
          ]}
        >
          <Ionicons name="trending-up-outline" size={16} color={colors.primary[600]} />
        </View>
        <Text style={[styles.ownerCardLabel, { color: palette.text.secondary }]}>ПРОГНОЗ КОНЦА МЕСЯЦА</Text>
      </View>
      <Text style={[styles.forecastValue, { color: palette.text.primary }]} numberOfLines={1} adjustsFontSizeToFit>
        {formatMoney(forecast)}
      </Text>
      <View style={styles.forecastDeltaRow}>
        <View
          style={[
            styles.forecastChip,
            {
              backgroundColor:
                delta.tone === 'up'
                  ? palette.mode === 'dark'
                    ? softTint(colors.green[600], 'dark')
                    : colors.green[50]
                  : delta.tone === 'down'
                    ? palette.mode === 'dark'
                      ? softTint(colors.red[600], 'dark')
                      : colors.red[50]
                    : palette.bg.muted,
            },
          ]}
        >
          <Ionicons
            name={delta.tone === 'up' ? 'arrow-up' : delta.tone === 'down' ? 'arrow-down' : 'remove'}
            size={12}
            color={
              delta.tone === 'up' ? colors.green[700] : delta.tone === 'down' ? colors.red[700] : palette.text.tertiary
            }
          />
          <Text
            style={[
              styles.forecastChipText,
              {
                color:
                  delta.tone === 'up'
                    ? colors.green[700]
                    : delta.tone === 'down'
                      ? colors.red[700]
                      : palette.text.tertiary,
              },
            ]}
          >
            {delta.text}
          </Text>
        </View>
        <Text style={[styles.forecastCaption, { color: palette.text.tertiary }]}>к прошлому месяцу</Text>
      </View>
      <Text style={[styles.forecastSub, { color: palette.text.tertiary }]}>Расчёт по текущей динамике</Text>
    </AnimatedCard>
  );
}

/**
 * Owner-side freshness pill — consumes the dashboard-v2 query that the
 * hero / KPI / cash position cards all read from. Sits at the very top
 * of the dashboard, right-aligned, so the owner can see at a glance
 * whether the numbers are still revalidating in the background.
 *
 * HYBRID-perf plan: dashboard-v2 cash position is critical and forces
 * refetch-on-mount; this badge surfaces that revalidation state.
 */
function OwnerFreshnessBadge() {
  const { isFetching, isLoading, dataUpdatedAt } = useQuery({
    queryKey: ['dashboard-v2', 'today'],
    queryFn: async () => (await reportsApi.dashboardV2({ period: 'today' })).data,
    staleTime: 60_000,
    // Read-only consumer: don't re-trigger a separate fetch. The cash
    // position card already requests this data with refetchOnMount.
    enabled: false,
    notifyOnChangeProps: ['isFetching', 'isLoading', 'dataUpdatedAt'],
  });
  return (
    <View style={styles.ownerFreshnessRow}>
      <FreshnessBadge query={{ isFetching, isLoading, dataUpdatedAt }} />
    </View>
  );
}

// ── Configurable owner widgets ───────────────────────────────────────────────
// Реестр настраиваемых виджетов: id + русский лейбл + сам компонент. Порядок
// здесь = порядок на дашборде. Hero / KPI / график / снапшот-строка — НЕ тут,
// это фиксированный скелет (его не отключают). Видимость хранится локально
// per-user (AsyncStorage через usePreference). По умолчанию все включены.
const DASHBOARD_WIDGETS: DashboardWidgetDef[] = [
  { id: 'cash-position', label: 'Касса сегодня', Component: CashPositionCard },
  { id: 'margin', label: 'Маржинальность', Component: MarginCard },
  { id: 'installments', label: 'Рассрочка', Component: InstallmentsWidget },
  { id: 'deferred', label: 'Зависшие отложенные', Component: DeferredCard },
  { id: 'warehouse-analytics', label: 'Склад', Component: WarehouseAnalyticsWidget },
  { id: 'low-stock', label: 'Заканчиваются товары', Component: LowStockCard },
  { id: 'clients-new-returning', label: 'Новые и постоянные клиенты', Component: ClientsNewVsReturningCard },
  { id: 'call-funnel', label: 'Воронка звонков', Component: CallFunnelWidget },
  { id: 'retention', label: 'Retention клиентов', Component: RetentionCard },
  { id: 'best-day-week', label: 'Лучший день недели', Component: BestDayOfWeekCard },
  { id: 'recent-reviews', label: 'Последние отзывы', Component: RecentReviewsCard },
  { id: 'personal-record', label: 'Личный рекорд', Component: PersonalRecordCard },
  { id: 'month-forecast', label: 'Прогноз конца месяца', Component: MonthForecastCard },
];

function AdminDashboard({ name }: { name: string }) {
  const { user } = useAuth();
  const palette = useColors();
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Видимость виджетов — локально, per-user. Пустая сохранёнка / отсутствие
  // ключа = все включены (дефолт-фолбэк зашит в isWidgetVisible).
  const {
    value: visibility,
    setValue,
    reset,
  } = usePreference<WidgetVisibility>(prefKey(DASHBOARD_WIDGETS_PREF, user?.id), {});

  const handleToggle = useCallback(
    (id: string, next: boolean) => {
      setValue({ ...visibility, [id]: next });
    },
    [visibility, setValue],
  );

  const visibleWidgets = DASHBOARD_WIDGETS.filter((w) => isWidgetVisible(visibility, w.id));

  return (
    <View style={{ gap: spacing[5] }}>
      <View style={styles.adminTopRow}>
        <View style={{ flex: 1 }}>
          <OwnerFreshnessBadge />
        </View>
        <TouchableOpacity
          style={[styles.widgetsBtn, { backgroundColor: palette.bg.muted }]}
          onPress={() => {
            haptic('tap');
            setSettingsOpen(true);
          }}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Настроить виджеты"
        >
          <Ionicons name="options-outline" size={15} color={palette.text.secondary} />
          <Text style={[styles.widgetsBtnText, { color: palette.text.secondary }]}>Виджеты</Text>
        </TouchableOpacity>
      </View>
      <OwnerHero name={name} />
      <KpiStrip />
      <OwnerAnalyticsChart />
      <TodaySnapshotRow />
      {visibleWidgets.map((w) => (
        <w.Component key={w.id} />
      ))}

      <DashboardWidgetsModal
        visible={settingsOpen}
        widgets={DASHBOARD_WIDGETS}
        visibility={visibility}
        onToggle={handleToggle}
        onReset={reset}
        onClose={() => setSettingsOpen(false)}
      />
    </View>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  MASTER DASHBOARD — kept INTACT from previous iteration.
// ════════════════════════════════════════════════════════════════════════════

// ── Shift Control (master only) ──
function ShiftControl() {
  const palette = useColors();
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
    // Без onError мастер жал «Открыть смену», запрос молча умирал (offline /
    // 500), спиннер исчезал — и человек был уверен, что смена открыта.
    onError: (err: unknown) => {
      haptic('error');
      const e = err as { response?: { data?: { message?: string } }; message?: string };
      Alert.alert(
        'Ошибка',
        e?.response?.data?.message || e?.message || 'Не удалось открыть смену. Проверьте соединение.',
      );
    },
  });

  const closeShift = useMutation({
    mutationFn: (id: string) => shiftsApi.close(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      queryClient.invalidateQueries({ queryKey: ['schedule-today'] });
    },
    onError: (err: unknown) => {
      haptic('error');
      const e = err as { response?: { data?: { message?: string } }; message?: string };
      Alert.alert(
        'Ошибка',
        e?.response?.data?.message || e?.message || 'Не удалось закрыть смену. Проверьте соединение.',
      );
    },
  });

  const currentShift = myShifts?.find((s) => !s.closedAt);
  const isLoading = openShift.isPending || closeShift.isPending;

  return (
    <AnimatedCard
      index={1}
      style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
    >
      <View style={styles.shiftRow}>
        <View style={styles.shiftLeft}>
          <View
            style={[
              styles.shiftIcon,
              currentShift
                ? { backgroundColor: palette.mode === 'dark' ? softTint(colors.green[600], 'dark') : colors.green[100] }
                : { backgroundColor: palette.bg.muted },
            ]}
          >
            <Ionicons
              name={currentShift ? 'time' : 'time-outline'}
              size={20}
              color={currentShift ? colors.green[600] : palette.text.tertiary}
            />
          </View>
          <View>
            <Text style={[styles.shiftTitle, { color: palette.text.primary }]}>
              {currentShift ? 'Смена открыта' : 'Смена закрыта'}
            </Text>
            {currentShift && (
              <Text style={[styles.shiftSince, { color: palette.text.tertiary }]}>
                с {new Date(currentShift.openedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
              </Text>
            )}
          </View>
        </View>
        {currentShift ? (
          <TouchableOpacity
            style={[
              styles.shiftCloseBtn,
              { backgroundColor: palette.mode === 'dark' ? softTint(colors.red[600], 'dark') : colors.red[50] },
            ]}
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
          <TouchableOpacity
            style={[
              styles.shiftOpenBtn,
              { backgroundColor: palette.mode === 'dark' ? softTint(colors.green[600], 'dark') : colors.green[50] },
            ]}
            onPress={() => openShift.mutate()}
            disabled={isLoading}
          >
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
  const palette = useColors();
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

  // `.sort()` mutates in place — calling it on `data.employeeRatings`
  // directly would silently reorder the array held INSIDE the React Query
  // cache, affecting every other consumer of `['marketing-dashboard']`
  // until the next refetch produced a new reference. Copy first, then
  // sort the local clone.
  const rank =
    [...data.employeeRatings]
      .sort((a: any, b: any) => b.avgRating - a.avgRating)
      .findIndex((e: any) => e.employeeId === userId) + 1;

  const stars = Math.round(myRating.avgRating);

  return (
    <AnimatedCard
      index={5}
      style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[3] }}>
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor:
              rank <= 3
                ? palette.mode === 'dark'
                  ? softTint(colors.amber[600], 'dark')
                  : colors.amber[50]
                : palette.bg.muted,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons
            name={rank === 1 ? 'trophy' : rank <= 3 ? 'medal' : 'star'}
            size={22}
            color={rank === 1 ? colors.amber[600] : rank <= 3 ? palette.text.secondary : colors.primary[500]}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: palette.text.primary }}>
            Мой рейтинг
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[1], marginTop: 2 }}>
            {[1, 2, 3, 4, 5].map((i) => (
              <Ionicons
                key={i}
                name={i <= stars ? 'star' : 'star-outline'}
                size={14}
                color={i <= stars ? colors.yellow[400] : palette.border.subtle}
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
              color: rank <= 3 ? colors.amber[600] : palette.text.primary,
            }}
          >
            #{rank}
          </Text>
          <Text style={{ fontSize: 10, color: palette.text.tertiary }}>из {data.employeeRatings.length}</Text>
        </View>
      </View>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-around',
          marginTop: spacing[3],
          paddingTop: spacing[3],
          borderTopWidth: 1,
          borderTopColor: palette.border.subtle,
        }}
      >
        <View style={{ alignItems: 'center' }}>
          <Text style={{ fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: palette.text.primary }}>
            {myRating.reviewCount}
          </Text>
          <Text style={{ fontSize: 10, color: palette.text.tertiary }}>отзывов</Text>
        </View>
        <View style={{ alignItems: 'center' }}>
          <Text style={{ fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.green[600] }}>
            {Math.round(100 - myRating.negativeRate)}%
          </Text>
          <Text style={{ fontSize: 10, color: palette.text.tertiary }}>положит.</Text>
        </View>
      </View>
    </AnimatedCard>
  );
}

function MasterRecentChecks() {
  const palette = useColors();
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
    <AnimatedCard
      index={6}
      style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
    >
      <Text style={[styles.cashTitle, { color: palette.text.secondary }]}>ПОСЛЕДНИЕ ЧЕКИ</Text>
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
              borderBottomColor: palette.border.subtle,
            }}
            onPress={() =>
              navigation.navigate('Main', {
                screen: 'Checks',
                params: { screen: 'CheckDetail', initial: false, params: { id: check.id } },
              })
            }
          >
            <View
              style={{
                width: 32,
                height: 32,
                borderRadius: 16,
                backgroundColor: check.isDeferred
                  ? palette.mode === 'dark'
                    ? softTint(colors.amber[600], 'dark')
                    : colors.amber[50]
                  : palette.mode === 'dark'
                    ? softTint(colors.green[600], 'dark')
                    : colors.green[50],
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
                style={{ fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: palette.text.primary }}
                numberOfLines={1}
              >
                {check.client?.fullName || 'Розничный'}
              </Text>
              <Text style={{ fontSize: 11, color: palette.text.tertiary }}>
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
  const palette = useColors();
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

  const masters = useMemo(
    () => (Array.isArray(usersData) ? usersData : []).filter((u) => u.isActive && u.role === 'master'),
    [usersData],
  );

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
        onPress={() =>
          navigation.navigate('Main', { screen: 'MoreTab', params: { screen: 'Schedule', initial: false } })
        }
        activeOpacity={0.8}
        style={{
          backgroundColor: palette.bg.card,
          borderRadius: borderRadius['2xl'],
          padding: spacing[4],
          borderWidth: 1,
          borderColor: palette.border.subtle,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[3] }}>
          <View
            style={{
              width: 56,
              height: 56,
              borderRadius: 28,
              backgroundColor: myRank <= 3 ? colors.amber[50] : palette.bg.muted,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 2,
              borderColor: myRank <= 3 ? colors.amber[200] : palette.border.subtle,
            }}
          >
            <Text style={{ fontSize: 26 }}>{medal || `#${myRank}`}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text
              style={{
                fontSize: 11,
                fontWeight: '700',
                color: palette.text.tertiary,
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
                color: palette.text.primary,
                marginTop: 2,
                textTransform: 'capitalize' as const,
              }}
            >
              {monthName}
            </Text>
            <Text style={{ fontSize: fontSize.xs, color: palette.text.secondary, marginTop: 2 }}>
              <Text style={{ color: scoreColor, fontWeight: '700' }}>{me.score}%</Text> посещаемость · {me.full}/
              {me.total} смен
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={palette.text.tertiary} />
        </View>
      </TouchableOpacity>
    </AnimatedCard>
  );
}

function MasterDashboard() {
  const palette = useColors();
  const { user } = useAuth();
  const { data, isLoading, isError, refetch } = useQuery<SalarySummary>({
    queryKey: ['salary', 'my-summary'],
    queryFn: async () => {
      const res = await salaryApi.getMy();
      return res.data;
    },
    staleTime: 30_000,
  });

  // Mirror of ShiftControl's query — identical key + staleTime, so
  // TanStack dedupes this observer into the single fetch ShiftControl
  // already makes (both mount in the same render pass). No extra
  // network request — only used for the widget's shift indicator.
  const { data: myShifts } = useQuery<Shift[]>({
    queryKey: ['shifts', 'my'],
    queryFn: async () => {
      const res = await shiftsApi.getMy();
      return res.data;
    },
    staleTime: 10_000,
  });
  const shiftOpen = (Array.isArray(myShifts) ? myShifts : []).some((s) => !s.closedAt);

  // Sync the iOS home-screen widget with the master's earnings.
  // Source: salaryApi.getMy() — the exact numbers the «Сегодня /
  // За месяц» cards below already render. Primitive deps only —
  // `data` gets a fresh reference on every successful refetch.
  const hasSalary = data !== undefined;
  const earningsToday = data?.today ?? 0;
  const earningsMonth = data?.month ?? 0;
  useEffect(() => {
    if (!hasSalary) return;
    updateWidgetData({
      role: 'master',
      earningsToday,
      earningsMonth,
      shiftOpen,
    });
  }, [hasSalary, earningsToday, earningsMonth, shiftOpen]);

  // Honest, retryable error state (prod incident 2026-06): the old static
  // «Не удалось загрузить данные» banner was a dead end — no retry button,
  // so a master whose /salary/my failed once (timeout / network blip) was
  // stuck until he killed the app. With cached data the global
  // stale-while-revalidate keeps rendering the previous numbers instead.
  if (isError && data === undefined) {
    return (
      <QueryErrorState description="Заработок за сегодня недоступен. Проверьте соединение." onRetry={() => refetch()} />
    );
  }
  if (isLoading || !data) return <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary[600]} />;

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
                Услуги {data.salaryPercent}%{data.productSalaryPercent ? ` · Товары ${data.productSalaryPercent}%` : ''}
              </Text>
            </View>
          </View>
        </LinearGradient>
      </AnimatedCard>

      <View style={styles.statsRow}>
        <AnimatedCard
          index={1}
          style={[styles.statCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
        >
          <Ionicons
            name="document-text-outline"
            size={18}
            color={colors.primary[600]}
            style={{ marginBottom: spacing[2] }}
          />
          <Text style={[styles.statLabel, { color: palette.text.tertiary }]}>Заказов сегодня</Text>
          <Text style={[styles.statValue, { color: palette.text.primary }]}>{data.todayChecks || '—'}</Text>
          <Text style={[styles.statSub, { color: palette.text.tertiary }]}>За месяц: {data.monthChecks ?? 0}</Text>
        </AnimatedCard>
        <AnimatedCard
          index={2}
          style={[styles.statCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
        >
          <Ionicons name="cash-outline" size={18} color={colors.green[600]} style={{ marginBottom: spacing[2] }} />
          <Text style={[styles.statLabel, { color: palette.text.tertiary }]}>Сегодня</Text>
          <Text style={[styles.statValue, { color: palette.text.primary }]}>
            {data.today ? formatMoney(data.today) : '—'}
          </Text>
          <Text style={[styles.statSub, { color: palette.text.tertiary }]}>За месяц: {formatMoney(data.month)}</Text>
        </AnimatedCard>
      </View>

      <AnimatedCard
        index={3}
        style={[styles.cashSection, { backgroundColor: palette.bg.elevated, borderColor: palette.border.subtle }]}
      >
        <Text style={[styles.cashTitle, { color: palette.text.secondary }]}>КАССА СЕГОДНЯ</Text>
        <View style={styles.cashGrid}>
          {[
            {
              icon: 'cash-outline' as const,
              color: colors.green[600],
              bg: palette.mode === 'dark' ? softTint(colors.green[600], 'dark') : colors.green[50],
              amount: data.todayCash ?? 0,
              type: 'Наличные',
            },
            {
              icon: 'card-outline' as const,
              color: colors.blue[600],
              bg: palette.mode === 'dark' ? softTint(colors.blue[600], 'dark') : colors.blue[50],
              amount: data.todayCard ?? 0,
              type: 'Карта',
            },
            {
              icon: 'shield-checkmark-outline' as const,
              color: colors.amber[600],
              bg: palette.mode === 'dark' ? softTint(colors.amber[600], 'dark') : colors.amber[50],
              amount: data.todayWarranty ?? 0,
              type: 'Гарантия',
            },
          ].map((item) => (
            <View key={item.type} style={[styles.cashItem, { backgroundColor: palette.bg.card }]}>
              <View style={[styles.cashIconBox, { backgroundColor: item.bg }]}>
                <Ionicons name={item.icon} size={16} color={item.color} />
              </View>
              <Text style={[styles.cashAmount, { color: palette.text.primary }]}>{formatMoney(item.amount)}</Text>
              <Text style={[styles.cashType, { color: palette.text.tertiary }]}>{item.type}</Text>
            </View>
          ))}
        </View>
      </AnimatedCard>

      {data.todayService || data.todayProduct ? (
        <AnimatedCard
          index={4}
          style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
        >
          <Text style={[styles.cashTitle, { color: palette.text.secondary }]}>СТРУКТУРА ЗАРАБОТКА СЕГОДНЯ</Text>
          <View style={styles.earningsRow}>
            <View
              style={[
                styles.earningBox,
                { backgroundColor: palette.mode === 'dark' ? softTint(colors.blue[600], 'dark') : colors.blue[50] },
              ]}
            >
              <Ionicons name="build-outline" size={16} color={colors.blue[600]} />
              <Text style={[styles.earningLabel, { color: colors.blue[600] }]}>С услуг</Text>
              <Text style={[styles.earningValue, { color: palette.text.primary }]}>
                {formatMoney(data.todayService ?? 0)}
              </Text>
            </View>
            <View
              style={[
                styles.earningBox,
                { backgroundColor: palette.mode === 'dark' ? softTint(colors.green[600], 'dark') : colors.green[50] },
              ]}
            >
              <Ionicons name="cube-outline" size={16} color={colors.green[600]} />
              <Text style={[styles.earningLabel, { color: colors.green[600] }]}>С товаров</Text>
              <Text style={[styles.earningValue, { color: palette.text.primary }]}>
                {formatMoney(data.todayProduct ?? 0)}
              </Text>
            </View>
          </View>
        </AnimatedCard>
      ) : null}

      <MasterRatingCard userId={user?.id} />
      <MasterRecentChecks />

      {data.productPromotions &&
        data.productPromotions.length > 0 &&
        data.productPromotions.some((p) => p.percent > 0) && (
          <AnimatedCard
            index={5}
            style={[
              styles.promoCard,
              { backgroundColor: palette.mode === 'dark' ? softTint(colors.green[600], 'dark') : colors.emerald[50] },
            ]}
          >
            <View style={styles.promoHeader}>
              <View
                style={[
                  styles.promoIconBox,
                  {
                    backgroundColor: palette.mode === 'dark' ? softTint(colors.green[600], 'dark') : colors.green[100],
                  },
                ]}
              >
                <Ionicons name="gift-outline" size={22} color={colors.green[600]} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.promoTitle, { color: palette.text.primary }]}>Бонус с товаров</Text>
                <Text style={[styles.promoSub, { color: palette.text.secondary }]}>
                  Продавай эти товары и получай % с прибыли
                </Text>
              </View>
            </View>
            <View style={{ paddingHorizontal: spacing[3], paddingBottom: spacing[3], gap: spacing[2] }}>
              {data.productPromotions
                .filter((p) => p.percent > 0)
                .map((promo) => {
                  const photoUrl = promo.photo ? getImageUrl(promo.photo) : null;
                  return (
                    <View key={promo.productId} style={[styles.promoItem, { backgroundColor: palette.bg.card }]}>
                      {photoUrl ? (
                        <CachedImage source={{ uri: photoUrl }} style={styles.promoPhoto} />
                      ) : (
                        <View
                          style={[
                            styles.promoPhoto,
                            styles.promoPhotoPlaceholder,
                            { backgroundColor: palette.bg.muted },
                          ]}
                        >
                          <Ionicons name="cube-outline" size={18} color={palette.text.tertiary} />
                        </View>
                      )}
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={[styles.promoName, { color: palette.text.primary }]} numberOfLines={1}>
                          {promo.productName}
                        </Text>
                        <Text style={[styles.promoPrice, { color: palette.text.tertiary }]}>
                          Цена: {formatMoney(promo.sellPrice)}
                        </Text>
                      </View>
                      <View style={{ alignItems: 'flex-end', flexShrink: 0 }}>
                        <Text style={styles.promoBonus}>+{formatMoney(promo.estimatedBonus)}</Text>
                        <Text style={[styles.promoPercent, { color: palette.text.tertiary }]}>
                          {promo.percent}% с прибыли
                        </Text>
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
  const { palette } = useThemeMode();
  const queryClient = useQueryClient();
  const tabBarHeight = useTabBarHeight();
  const insetsTop = useSafeAreaInsets().top;
  const isMaster = user?.role === UserRole.MASTER;
  const isOwner = user?.role === UserRole.DIRECTOR || user?.role === UserRole.SUPERADMIN;
  const [refreshing, setRefreshing] = useState(false);

  // #7 — ShiftControl (карточка «Открыть/закрыть смену») показывается мастеру
  // ТОЛЬКО если у тенанта включена фича «Смены» (shiftsEnabled). Источник —
  // тот же `my-company` query, что использует экран настроек компании; здесь
  // он лёгкий read-only потребитель (мастеру эндпоинт доступен). Отсутствие
  // поля на легаси-пейлоаде ⇒ false (смены выключены).
  const { data: myCompany } = useQuery<Tenant>({
    queryKey: ['my-company'],
    queryFn: async () => (await myCompanyApi.get()).data,
    staleTime: 5 * 60 * 1000,
    enabled: isMaster,
  });
  const shiftsEnabled = myCompany?.shiftsEnabled === true;

  const onRefresh = async () => {
    setRefreshing(true);
    // Invalidate only the queries THIS role's dashboard actually reads. The
    // previous single list mixed owner and master keys: a master's
    // pull-to-refresh would mark owner-only queries (dashboard-v2,
    // warehouse-analytics, …) stale — and `/reports/*` +
    // `/warehouse-analytics/*` are 403 for masters (controller-level
    // @Roles('director','admin','superadmin')), so any accidentally-active
    // observer turned the gesture into a wave of forbidden requests + error
    // states. Splitting by role guarantees the master experience fires ZERO
    // requests it isn't allowed to make. (And never `invalidateQueries()`
    // with no filter — that refetched EVERY key in the app.)
    const ownerKeys: (string | (string | number)[])[][] = [
      ['dashboard-chart'],
      ['dashboard-v2'],
      ['schedule-today'],
      ['calls-summary'],
      ['installments', 'widget'],
      // owner-alerts → replaced by WarehouseAnalyticsWidget; pull-to-refresh
      // invalidates both warehouse-analytics sub-queries.
      ['warehouse-analytics'],
      ['low-stock'],
      ['clients-new-returning'],
      ['retention'],
      ['best-day-week'],
      ['recent-reviews'],
      ['call-funnel'],
    ];
    const masterKeys: (string | (string | number)[])[][] = [
      ['shifts'],
      ['salary'],
      // MasterRecentChecks reads ['checks', 'recent-master']; restrict
      // the invalidation to that exact suffix so we don't accidentally
      // refetch the entire Journal infinite-scroll cache.
      ['checks', 'recent-master'],
      // MasterRatingCard reads the marketing dashboard (open to all roles).
      ['marketing-dashboard'],
      // MyAttendanceRankWidget reads ['schedule', monthStart, monthEnd]
      // and ['users']. ['schedule'] alone matches every month-window
      // ever cached; restrict to the explicit prefix so we don't tear
      // down the schedule grid on a different month.
      ['users'],
    ];
    const dashboardKeys = isMaster ? masterKeys : ownerKeys;
    await Promise.all(dashboardKeys.map((key) => queryClient.invalidateQueries({ queryKey: key })));
    setRefreshing(false);
  };

  const displayName = user?.fullName?.split(' ')[0] || '';
  const greeting = getGreeting();

  return (
    /* Edge-to-edge wrapper — gray-50 canvas flows under the glass tab bar.
       No SafeAreaView frame; insetsTop is applied inline to scroll content. */
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
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
        // Offscreen culling — owner Dashboard renders 15 stacked widget
        // cards (Hero / KPI strip / Chart / TodaySnapshot / Cash / Margin
        // / Deferred / WarehouseAnalytics / ClientsNvR / CallFunnel /
        // Retention / BestDayWeek / RecentReviews / PersonalRecord /
        // MonthForecast). Without removeClippedSubviews every offscreen
        // card kept its SVG paths + Animated values mounted, contributing
        // to UI-thread cost on every scroll frame. With it on, iOS
        // detaches the offscreen cards' native views from the window so
        // only the visible viewport composites per frame. Net: scroll
        // fps stabilises to display refresh on a 6.7" iPhone.
        removeClippedSubviews
        // 16 ms throttle = 60fps event budget. Default `0` fires onScroll
        // on every JS-tick which is wasteful for a screen that doesn't
        // currently subscribe to scroll position — but RN still benefits
        // from throttled native dispatch (less bridge work).
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />
        }
      >
        {/* Owner = new 6-block layout. Master = unchanged previous experience. */}
        {isMaster ? (
          <>
            <View style={styles.headerSection}>
              <Text style={[styles.headerTitle, { color: palette.text.primary }]}>
                {greeting}, {displayName}!
              </Text>
              <Text style={[styles.headerSub, { color: palette.text.tertiary }]}>Обзор показателей автосервиса</Text>
            </View>
            {shiftsEnabled && <ShiftControl />}
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
  // OwnerFreshnessBadge slot — sits above the hero card, right-aligned.
  ownerFreshnessRow: { alignItems: 'flex-end', minHeight: 14, marginBottom: -spacing[2] },

  // Admin top row — freshness badge (left, flex) + «Виджеты» button (right).
  adminTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 28,
    marginBottom: -spacing[2],
  },
  widgetsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1.5],
    borderRadius: borderRadius.full,
  },
  widgetsBtnText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, letterSpacing: -0.1 },

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
  // Call funnel 2×2 grid tiles
  funnelTile: {
    flex: 1,
    minWidth: '45%',
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing[3],
    alignItems: 'flex-start',
    gap: spacing[1],
  },
  funnelTileValue: { fontSize: 20, fontWeight: '700', letterSpacing: -0.5 },
  funnelTileLabel: { fontSize: 11, fontWeight: '500' },
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
  // Container is positioned relative; each label is absolutely placed
  // so its centre coincides with the data point above it. Height is set
  // explicitly because absolutely-positioned children don't contribute
  // to layout height.
  xAxisLabels: { position: 'relative', height: 14, marginTop: spacing[1] },
  xAxisLabelLight: {
    position: 'absolute',
    top: 0,
    width: X_AXIS_LABEL_W,
    fontSize: 10,
    color: colors.gray[400],
    textAlign: 'center',
  },
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

  // ── OWNER WIDGETS (iter#14, 2026-05-22) ──────────────────────────────────
  // Generic card surface used by all owner widgets below.
  ownerCard: {
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing[4],
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  ownerCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginBottom: spacing[3],
  },
  ownerCardIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ownerCardLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },

  // ── Рассрочка widget ──────────────────────────────────────────────────────
  installmentHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginLeft: 'auto' },
  installmentTotal: { fontSize: 15, fontWeight: fontWeight.bold, letterSpacing: -0.3 },
  installmentCounters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  installmentPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing[2],
    paddingVertical: 3,
    borderRadius: borderRadius.full,
  },
  installmentPillText: { fontSize: 11.5, fontWeight: fontWeight.bold },
  installmentRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing[2] },
  installmentRowRight: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], flexShrink: 1 },
  installmentName: { flex: 1, fontSize: 13.5, fontWeight: fontWeight.medium, letterSpacing: -0.1 },
  installmentDue: { fontSize: 12, fontWeight: fontWeight.medium, flexShrink: 1 },
  installmentAmount: { fontSize: 13.5, fontWeight: fontWeight.bold, letterSpacing: -0.2 },

  // ── Заканчиваются товары (M10) ────────────────────────────────────────────
  lowStockHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginLeft: 'auto',
  },
  lowStockBadge: {
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: borderRadius.full,
  },
  lowStockBadgeText: {
    fontSize: 11,
    fontWeight: fontWeight.bold,
    color: colors.red[600],
  },
  lowStockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[2],
  },
  lowStockName: {
    flex: 1,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  lowStockQty: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.red[600],
    fontVariant: ['tabular-nums'],
  },

  // Hero — additional rows
  heroSecondary: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.78)',
    marginTop: 4,
  },
  heroSecondaryBold: {
    color: colors.white,
    fontWeight: '700',
  },
  heroMonthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: spacing[2.5],
    paddingTop: spacing[2.5],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.12)',
  },
  heroMonthText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.72)',
  },
  heroMonthBold: { color: colors.white, fontWeight: '700' },

  // Cash position
  cashTotalBox: {
    marginBottom: spacing[3],
    paddingBottom: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.06)',
  },
  cashTotalLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  cashTotalValue: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.8,
    fontVariant: ['tabular-nums'],
  },
  cashRowItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2.5],
  },
  cashRowIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cashRowLabel: { flex: 1, fontSize: 14, fontWeight: '500' },
  cashRowNote: { fontSize: 11, fontWeight: '400', marginTop: 1 },
  cashRowValue: { fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },

  // Margin
  marginRow: { flexDirection: 'row', alignItems: 'center' },
  marginValue: {
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -0.8,
    fontVariant: ['tabular-nums'],
  },
  marginCaption: { fontSize: 11, marginTop: 2 },
  marginChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing[2],
    paddingVertical: 4,
    borderRadius: borderRadius.full,
  },
  marginChipText: { fontSize: 12, fontWeight: '700', letterSpacing: -0.1 },

  // Deferred
  deferredMain: { fontSize: 15, lineHeight: 22 },
  deferredAccent: { fontWeight: '800', letterSpacing: -0.3 },
  deferredCaption: { fontSize: 12, marginTop: 4 },

  // Warehouse analytics widget
  warehouseHeaderEmoji: { fontSize: 14, lineHeight: 16 },
  warehouseSubtitle: { fontSize: 10, fontWeight: '500', marginTop: 1, letterSpacing: 0.2 },
  warehouseHeroRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2.5] },
  warehouseHeroValue: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.8,
    fontVariant: ['tabular-nums'],
  },
  warehouseHeroCaption: { fontSize: 11, marginTop: 2 },
  warehouseDeltaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing[2],
    paddingVertical: 4,
    borderRadius: borderRadius.full,
  },
  warehouseDeltaText: { fontSize: 12, fontWeight: '700', letterSpacing: -0.1 },
  warehouseDivider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: spacing[3],
  },
  warehouseStatsRow: { flexDirection: 'row' },
  warehouseStatCell: { flex: 1, gap: 4 },
  warehouseStatCellRight: { alignItems: 'flex-end' },
  warehouseStatLabel: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  warehouseStatValue: {
    fontSize: 14,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  warehouseReorderHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
    marginBottom: spacing[2],
  },
  warehouseReorderEmoji: { fontSize: 14 },
  warehouseReorderTitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  warehouseReorderEmpty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingVertical: spacing[2],
  },
  warehouseReorderEmptyText: { fontSize: 13, fontWeight: '500' },
  warehouseReorderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
    borderRadius: borderRadius.lg,
    borderLeftWidth: 3,
    gap: spacing[2],
  },
  warehouseReorderName: { fontSize: 13, fontWeight: '600' },
  warehouseReorderMeta: { fontSize: 11, marginTop: 2 },
  warehouseReorderQty: { fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },

  // Clients new vs returning — premium analytics-style
  clientsModeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: spacing[2.5],
  },
  modeChip: {
    paddingHorizontal: spacing[2.5],
    paddingVertical: 5,
    borderRadius: borderRadius.full,
    backgroundColor: 'rgba(0,0,0,0.04)',
  },
  modeChipActive: { backgroundColor: colors.primary[600] },
  modeChipText: { fontSize: 11, fontWeight: '600' },
  modeChipTextActive: { color: colors.white, fontWeight: '700' },
  dayPickerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing[2.5] },
  dayArrow: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayChip: {
    paddingHorizontal: spacing[2.5],
    paddingVertical: 5,
    borderRadius: borderRadius.full,
    minWidth: 44,
    alignItems: 'center',
  },
  dayChipText: { fontSize: 11, fontWeight: '700' },
  // Legacy keys retained for any external reference; new layout uses the
  // *Hero*, *SplitBar*, *Legend* keys below.
  clientsCountsRow: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: spacing[2.5] },
  clientsCount: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.6,
    fontVariant: ['tabular-nums'],
  },
  clientsCountLabel: { fontSize: 11, marginTop: 2 },
  stackedBar: {
    flexDirection: 'row',
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: spacing[2.5],
  },
  clientsRevenueRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[3],
  },
  clientsRevenueText: { fontSize: 12 },
  // Premium layout
  clientsHeroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing[3],
    gap: spacing[2],
  },
  clientsHeroValue: {
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: -0.8,
    fontVariant: ['tabular-nums'],
    lineHeight: 38,
  },
  clientsHeroCaption: {
    fontSize: 12,
    marginTop: 2,
  },
  clientsRatioChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing[2],
    paddingVertical: 5,
    borderRadius: borderRadius.full,
  },
  clientsRatioChipText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: -0.1,
  },
  clientsSplitBar: {
    flexDirection: 'row',
    height: 10,
    borderRadius: 5,
    overflow: 'hidden',
    marginBottom: spacing[3],
  },
  clientsLegendRow: {
    flexDirection: 'row',
    gap: spacing[2],
  },
  clientsLegendItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  clientsLegendDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clientsLegendLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: -0.1,
  },
  clientsLegendValue: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
    marginTop: 1,
  },

  // Period chips (used by Retention + BestDayOfWeek)
  periodChipsRow: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: borderRadius.full,
  },
  periodChip: {
    flex: 1,
    paddingVertical: 6,
    alignItems: 'center',
    borderRadius: borderRadius.full,
  },
  periodChipActive: {
    shadowColor: '#0F172A',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  periodChipText: { fontSize: 12, letterSpacing: -0.1 },

  // Retention
  retentionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  retentionLabel: { fontSize: 13 },
  retentionValue: { fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },

  // Best day of week
  bestDayBars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  weekdayLabel: { fontSize: 10, marginTop: 4, fontWeight: '600' },
  bestDayCaption: { fontSize: 12 },

  // Reviews
  reviewRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2.5],
    padding: spacing[2.5],
    borderRadius: borderRadius.lg,
  },
  reviewAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reviewAvatarText: { fontSize: 13, fontWeight: '800' },
  reviewStarsRow: { flexDirection: 'row', alignItems: 'center', gap: 1 },
  reviewEmployee: { fontSize: 11, marginLeft: 4 },
  reviewComment: { fontSize: 13, marginTop: 4, lineHeight: 17 },

  // Personal record
  recordHighlight: {
    borderColor: colors.amber[200],
    backgroundColor: colors.amber[50],
  },
  recordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
    paddingVertical: 4,
  },
  recordLabel: { fontSize: 13 },
  recordValue: { flex: 1, fontSize: 13, fontWeight: '600' },
  recordCloseBox: {
    marginTop: spacing[2.5],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
  },
  recordCloseText: { fontSize: 12, fontWeight: '700' },

  // Forecast
  forecastValue: {
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -1,
    fontVariant: ['tabular-nums'],
  },
  forecastDeltaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginTop: spacing[1.5],
  },
  forecastChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing[2],
    paddingVertical: 3,
    borderRadius: borderRadius.full,
  },
  forecastChipText: { fontSize: 12, fontWeight: '700' },
  forecastCaption: { fontSize: 12 },
  forecastSub: { fontSize: 11, marginTop: 6 },

  // Shared
  emptyText: { fontSize: 13, textAlign: 'center', paddingVertical: spacing[3] },

  // ── LEGACY (master path) ─────────────────────────────────────────────────
  // (errorBanner removed — MasterDashboard now uses the shared
  // QueryErrorState component with a working «Повторить» button.)
  shiftRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  shiftLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  shiftIcon: { width: 40, height: 40, borderRadius: borderRadius.xl, alignItems: 'center', justifyContent: 'center' },
  shiftIconClosed: { backgroundColor: colors.gray[100] },
  shiftTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  shiftSince: { fontSize: fontSize.xs, color: colors.gray[400] },
  shiftCloseBtn: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.xl,
  },
  shiftCloseBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.red[600] },
  shiftOpenBtn: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2.5],
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
