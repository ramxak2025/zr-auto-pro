/**
 * MarketingReportsScreen — «Маркетинговые отчёты».
 *
 * Одна из четырёх «Маркетинг»-веток (hub → этот экран). Полный
 * period-based консолидированный отчёт по маркетингу — зеркалит web-волну
 * для паритета. Читает ОДИН endpoint:
 *
 *   reportsApi.getMarketingReport({ from, to }) → MarketingReport
 *
 * Разделы (сверху вниз):
 *   • Период         — пресеты (Сегодня / Неделя / Месяц / Квартал / Год)
 *                      + произвольный диапазон.
 *   • Привлечение    — новые vs повторные (кол-во + выручка) + разбивка
 *                      «По источникам» (с «Без источника»).
 *   • Удержание      — доля возвратов %, средний LTV, дней между визитами.
 *   • Звонки         — всего/входящие/исходящие/пропущено/не перезвонили,
 *                      отвечаемость %, воронка (уник.→доехали→оформлено),
 *                      конверсия %, повторные, выручка.
 *   • Отзывы         — всего, средний рейтинг, позитив/негатив, отклик %,
 *                      конверсия %, отправлено/ответили.
 *
 * Графики нарисованы Views (пропорциональные бары) — без новых зависимостей.
 * Loading spinner + дружелюбный empty state + pull-to-refresh.
 *
 * Все *Rate-поля приходят с бэка уже в 0–100 (см. reports.service.ts),
 * деньги — целые рубли, avgRating — 0–5.
 */
import React from 'react';
import { View, ScrollView, StyleSheet, RefreshControl, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { useColors } from '../contexts/ThemeContext';
import { reportsApi } from '../api/services';
import { colors, fontSize, fontWeight, borderRadius, spacing, softTint } from '../theme';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { useIosSurface } from '../platform/iosSurface';
import AnimatedCard from '../components/AnimatedCard';
import IosScreenHeader from '../components/IosScreenHeader';
import LoadingSpinner from '../components/LoadingSpinner';
import FreshnessBadge from '../components/FreshnessBadge';
import DateTimePickerModal from '../components/DateTimePickerModal';
import { Text } from '../platform/Typography';
import { haptic } from '../platform/haptics';
import { toLocalISODate } from '../utils/dates';
import type { MarketingReport } from '../../../shared/types';

// ─────────────────────────────────────────────────────────────────────────────
//  Формат — единый источник правды по числам/деньгам/процентам.
// ─────────────────────────────────────────────────────────────────────────────

function group(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function formatMoney(v: number): string {
  return `${group(v)} ₽`;
}

/** Компактная форма для крупных денег в тесных плитках: 1.2M / 234k ₽. */
function formatMoneyCompact(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace('.0', '')}M ₽`;
  if (abs >= 100_000) return `${Math.round(v / 1000)}k ₽`;
  if (abs >= 10_000) return `${(v / 1000).toFixed(1).replace('.0', '')}k ₽`;
  return `${group(v)} ₽`;
}

function formatInt(v: number): string {
  return group(v);
}

/** *Rate уже 0–100 с бэка. Округляем до целого для чистых плиток. */
function formatPct(v: number): string {
  return `${Math.round(v)}%`;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Период — 5 пресетов + произвольный диапазон.
// ─────────────────────────────────────────────────────────────────────────────

type PeriodKey = 'today' | 'week' | 'month' | 'quarter' | 'year' | 'custom';

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: 'today', label: 'Сегодня' },
  { key: 'week', label: 'Неделя' },
  { key: 'month', label: 'Месяц' },
  { key: 'quarter', label: 'Квартал' },
  { key: 'year', label: 'Год' },
  { key: 'custom', label: 'Произвольный' },
];

interface DateRange {
  from: string;
  to: string;
}

const RU_MONTHS = [
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
const RU_MONTHS_NOM = [
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

function parseDateStr(s: string): Date {
  const [y, m, day] = s.split('-').map(Number);
  return new Date(y, m - 1, day);
}

function getDateRange(period: PeriodKey, custom?: DateRange): DateRange {
  const now = new Date();
  const today = toLocalISODate(now);
  if (period === 'today') return { from: today, to: today };
  if (period === 'week') {
    // ISO-неделя, понедельник — начало.
    const day = now.getDay();
    const diff = day === 0 ? 6 : day - 1;
    const monday = new Date(now);
    monday.setDate(now.getDate() - diff);
    return { from: toLocalISODate(monday), to: today };
  }
  if (period === 'month') {
    return { from: toLocalISODate(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
  }
  if (period === 'quarter') {
    const qStartMonth = Math.floor(now.getMonth() / 3) * 3;
    return { from: toLocalISODate(new Date(now.getFullYear(), qStartMonth, 1)), to: today };
  }
  if (period === 'year') {
    return { from: toLocalISODate(new Date(now.getFullYear(), 0, 1)), to: today };
  }
  return custom ?? { from: today, to: today };
}

/** Человекочитаемый ярлык периода для подзаголовка («Май 2026», «1 — 7 июля»). */
function formatPeriodLabel(period: PeriodKey, range: DateRange): string {
  const from = parseDateStr(range.from);
  const to = parseDateStr(range.to);
  if (period === 'today') return `Сегодня · ${from.getDate()} ${RU_MONTHS[from.getMonth()]}`;
  if (period === 'month') return `${RU_MONTHS_NOM[to.getMonth()]} ${to.getFullYear()}`;
  if (period === 'year') return `${to.getFullYear()} год`;
  if (period === 'quarter') {
    const q = Math.floor(to.getMonth() / 3) + 1;
    return `${q} квартал ${to.getFullYear()}`;
  }
  const sameMonth = from.getMonth() === to.getMonth() && from.getFullYear() === to.getFullYear();
  if (sameMonth) return `${from.getDate()} — ${to.getDate()} ${RU_MONTHS[to.getMonth()]} ${to.getFullYear()}`;
  return `${from.getDate()} ${RU_MONTHS[from.getMonth()]} — ${to.getDate()} ${RU_MONTHS[to.getMonth()]} ${to.getFullYear()}`;
}

// Ротация цветов для баров «По источникам» (гарантированно существуют в палитре).
const SOURCE_COLORS = [
  colors.primary[600],
  colors.teal[600],
  colors.violet[600],
  colors.amber[600],
  colors.rose[600],
  colors.emerald[700],
  colors.orange[600],
  colors.cyan[600],
];

// ─────────────────────────────────────────────────────────────────────────────
//  Мелкие презентационные примитивы.
// ─────────────────────────────────────────────────────────────────────────────

type SectionAccent = { color: string; bgLight: string };

function SectionHeader({
  icon,
  title,
  accent,
  trailing,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  accent: SectionAccent;
  trailing?: React.ReactNode;
}) {
  const palette = useColors();
  return (
    <View style={styles.sectionHeader}>
      <View
        style={[
          styles.sectionIcon,
          { backgroundColor: palette.mode === 'dark' ? softTint(accent.color, 'dark') : accent.bgLight },
        ]}
      >
        <Ionicons name={icon} size={16} color={accent.color} />
      </View>
      <Text style={[styles.sectionTitle, { color: palette.text.primary }]}>{title}</Text>
      {trailing ? <View style={styles.sectionTrailing}>{trailing}</View> : null}
    </View>
  );
}

/** Компактная числовая плитка — value крупно (tabular-nums) + подпись. */
function StatTile({
  label,
  value,
  tone = 'neutral',
  icon,
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'warn' | 'good';
  icon?: React.ComponentProps<typeof Ionicons>['name'];
}) {
  const palette = useColors();
  const valueColor =
    tone === 'warn'
      ? colors.red[palette.mode === 'dark' ? 400 : 600]
      : tone === 'good'
        ? colors.green[600]
        : palette.text.primary;
  return (
    <View style={[styles.tile, { backgroundColor: palette.bg.muted }]}>
      <View style={styles.tileHead}>
        {icon ? <Ionicons name={icon} size={13} color={palette.text.tertiary} /> : null}
        <Text style={[styles.tileLabel, { color: palette.text.tertiary }]} numberOfLines={1}>
          {label}
        </Text>
      </View>
      <Text
        style={[styles.tileValue, { color: valueColor }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
      >
        {value}
      </Text>
    </View>
  );
}

/** Двухсегментный пропорциональный бар (например новые vs повторные). */
function SplitBar({ segments, bg }: { segments: { value: number; color: string }[]; bg: string }) {
  const total = segments.reduce((s, seg) => s + Math.max(0, seg.value), 0);
  if (total <= 0) {
    return <View style={[styles.splitBar, { backgroundColor: bg }]} />;
  }
  return (
    <View style={[styles.splitBar, { backgroundColor: bg }]}>
      {segments.map((seg, i) =>
        seg.value > 0 ? <View key={i} style={{ flex: seg.value, backgroundColor: seg.color }} /> : null,
      )}
    </View>
  );
}

/** Строка воронки / источника — подпись + значение + бар доли. */
function BarRow({
  label,
  value,
  max,
  color,
  suffix,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
  suffix?: string;
}) {
  const palette = useColors();
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const width = value > 0 ? Math.max(4, pct) : 0;
  return (
    <View style={styles.barRow}>
      <View style={styles.barRowHead}>
        <Text style={[styles.barLabel, { color: palette.text.secondary }]} numberOfLines={1}>
          {label}
        </Text>
        <Text style={[styles.barValue, { color: palette.text.primary }]}>
          {formatInt(value)}
          {suffix ?? ''}
        </Text>
      </View>
      <View style={[styles.barTrack, { backgroundColor: palette.bg.muted }]}>
        <View style={[styles.barFill, { width: `${width}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

function StarRating({ rating, size = 15 }: { rating: number; size?: number }) {
  const stars: React.ReactElement[] = [];
  for (let i = 1; i <= 5; i++) {
    stars.push(
      <Ionicons
        key={i}
        name={i <= Math.round(rating) ? 'star' : 'star-outline'}
        size={size}
        color={i <= Math.round(rating) ? colors.amber[600] : colors.gray[300]}
      />,
    );
  }
  return <View style={{ flexDirection: 'row', gap: 2 }}>{stars}</View>;
}

// Accent-палитры разделов (icon-плитки).
const ACC_ACQUIRE: SectionAccent = { color: colors.primary[600], bgLight: colors.primary[50] };
const ACC_RETAIN: SectionAccent = { color: colors.teal[600], bgLight: colors.teal[50] };
const ACC_CALLS: SectionAccent = { color: colors.indigo[600], bgLight: colors.indigo[50] };
const ACC_REVIEWS: SectionAccent = { color: colors.amber[600], bgLight: colors.amber[50] };

// ─────────────────────────────────────────────────────────────────────────────
//  Screen
// ─────────────────────────────────────────────────────────────────────────────

export default function MarketingReportsScreen() {
  const navigation = useNavigation<any>();
  const palette = useColors();
  const surface = useIosSurface();
  const tabBarHeight = useTabBarHeight();
  const queryClient = useQueryClient();

  const [refreshing, setRefreshing] = React.useState(false);
  const [period, setPeriod] = React.useState<PeriodKey>('month');
  const [customRange, setCustomRange] = React.useState<DateRange>(() => getDateRange('month'));
  const [showPicker, setShowPicker] = React.useState<null | 'from' | 'to'>(null);

  const range = React.useMemo<DateRange>(
    () => (period === 'custom' ? customRange : getDateRange(period)),
    [period, customRange],
  );

  const reportQuery = useQuery<MarketingReport>({
    queryKey: ['marketing-report', range.from, range.to],
    queryFn: async () => (await reportsApi.getMarketingReport({ from: range.from, to: range.to })).data,
    placeholderData: (prev) => prev,
    staleTime: 60_000,
  });

  const report = reportQuery.data;

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['marketing-report'] });
    setRefreshing(false);
  }, [queryClient]);

  const handlePeriodChange = React.useCallback((p: PeriodKey) => {
    haptic('select');
    setPeriod(p);
  }, []);

  const cardStyle = [
    styles.card,
    { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
    surface.shadow,
  ];

  // «Нет данных» — отчёт пришёл, но по всем разделам пусто.
  const isEmpty =
    report != null &&
    report.acquisition.newClients === 0 &&
    report.acquisition.returningClients === 0 &&
    report.acquisition.newRevenue === 0 &&
    report.acquisition.returningRevenue === 0 &&
    report.calls.total === 0 &&
    report.reviews.total === 0;

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader
        title="Маркетинговые отчёты"
        subtitle={formatPeriodLabel(period, range)}
        onBack={() => navigation.goBack()}
        trailing={<FreshnessBadge query={reportQuery} />}
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarHeight + spacing[6] }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.accent.primary} />
        }
        showsVerticalScrollIndicator={false}
        removeClippedSubviews
        scrollEventThrottle={16}
      >
        {/* ── ПЕРИОД ─────────────────────────────────────────────────────── */}
        <View style={styles.periodWrap}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.periodRow}>
            {PERIODS.map((p) => {
              const active = period === p.key;
              return (
                <TouchableOpacity
                  key={p.key}
                  style={[styles.periodChip, { backgroundColor: active ? palette.accent.primary : palette.bg.muted }]}
                  onPress={() => handlePeriodChange(p.key)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.periodText, { color: active ? colors.white : palette.text.secondary }]}>
                    {p.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {period === 'custom' && (
            <View style={styles.customRow}>
              <TouchableOpacity
                style={[styles.customDateBtn, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
                onPress={() => setShowPicker('from')}
                activeOpacity={0.7}
              >
                <Ionicons name="calendar-outline" size={14} color={palette.text.tertiary} />
                <Text style={[styles.customDateText, { color: palette.text.primary }]}>{customRange.from}</Text>
              </TouchableOpacity>
              <Text style={[styles.customDash, { color: palette.text.tertiary }]}>—</Text>
              <TouchableOpacity
                style={[styles.customDateBtn, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
                onPress={() => setShowPicker('to')}
                activeOpacity={0.7}
              >
                <Ionicons name="calendar-outline" size={14} color={palette.text.tertiary} />
                <Text style={[styles.customDateText, { color: palette.text.primary }]}>{customRange.to}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* ── СОДЕРЖИМОЕ ──────────────────────────────────────────────────── */}
        {report === undefined ? (
          <LoadingSpinner />
        ) : isEmpty ? (
          <View style={styles.emptyWrap}>
            <View style={[styles.emptyIcon, { backgroundColor: palette.bg.muted }]}>
              <Ionicons name="stats-chart-outline" size={30} color={palette.text.tertiary} />
            </View>
            <Text style={[styles.emptyTitle, { color: palette.text.primary }]}>За период данных нет</Text>
            <Text style={[styles.emptyDesc, { color: palette.text.secondary }]}>
              Выберите другой период или дождитесь новых чеков, звонков и отзывов
            </Text>
          </View>
        ) : (
          <View style={{ gap: spacing[4] }}>
            {/* ═══ ПРИВЛЕЧЕНИЕ ═══ */}
            <AnimatedCard index={0} style={cardStyle}>
              <SectionHeader icon="person-add-outline" title="Привлечение" accent={ACC_ACQUIRE} />

              {/* Пропорция новые vs повторные */}
              <SplitBar
                bg={palette.bg.muted}
                segments={[
                  { value: report.acquisition.newClients, color: colors.primary[600] },
                  { value: report.acquisition.returningClients, color: colors.teal[600] },
                ]}
              />
              <View style={styles.splitLegendRow}>
                <View style={styles.splitCol}>
                  <View style={styles.legendDotRow}>
                    <View style={[styles.legendDot, { backgroundColor: colors.primary[600] }]} />
                    <Text style={[styles.legendLabel, { color: palette.text.secondary }]}>Новые</Text>
                  </View>
                  <Text style={[styles.splitValue, { color: palette.text.primary }]}>
                    {formatInt(report.acquisition.newClients)}
                  </Text>
                  <Text style={[styles.splitSub, { color: palette.text.tertiary }]}>
                    {formatMoney(report.acquisition.newRevenue)}
                  </Text>
                </View>
                <View style={[styles.splitDivider, { backgroundColor: palette.border.subtle }]} />
                <View style={styles.splitCol}>
                  <View style={styles.legendDotRow}>
                    <View style={[styles.legendDot, { backgroundColor: colors.teal[600] }]} />
                    <Text style={[styles.legendLabel, { color: palette.text.secondary }]}>Повторные</Text>
                  </View>
                  <Text style={[styles.splitValue, { color: palette.text.primary }]}>
                    {formatInt(report.acquisition.returningClients)}
                  </Text>
                  <Text style={[styles.splitSub, { color: palette.text.tertiary }]}>
                    {formatMoney(report.acquisition.returningRevenue)}
                  </Text>
                </View>
              </View>

              {/* По источникам */}
              {report.acquisition.bySource.length > 0 && (
                <View style={[styles.subBlock, { borderTopColor: palette.border.subtle }]}>
                  <Text style={[styles.subLabel, { color: palette.text.tertiary }]}>ПО ИСТОЧНИКАМ</Text>
                  {report.acquisition.bySource.map((src, idx) => {
                    const maxCount = Math.max(...report.acquisition.bySource.map((s) => s.count), 1);
                    return (
                      <View key={`${src.source}-${idx}`} style={styles.sourceRow}>
                        <View style={styles.sourceHead}>
                          <Text style={[styles.sourceName, { color: palette.text.primary }]} numberOfLines={1}>
                            {src.source?.trim() ? src.source : 'Без источника'}
                          </Text>
                          <Text style={[styles.sourceRevenue, { color: palette.text.secondary }]}>
                            {formatMoneyCompact(src.revenue)}
                          </Text>
                        </View>
                        <View style={styles.sourceBarRow}>
                          <View style={[styles.barTrack, styles.sourceBarTrack, { backgroundColor: palette.bg.muted }]}>
                            <View
                              style={[
                                styles.barFill,
                                {
                                  width: `${Math.max(4, (src.count / maxCount) * 100)}%`,
                                  backgroundColor: SOURCE_COLORS[idx % SOURCE_COLORS.length],
                                },
                              ]}
                            />
                          </View>
                          <Text style={[styles.sourceCount, { color: palette.text.tertiary }]}>
                            {formatInt(src.count)}
                          </Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
            </AnimatedCard>

            {/* ═══ УДЕРЖАНИЕ ═══ */}
            <AnimatedCard index={1} style={cardStyle}>
              <SectionHeader icon="repeat-outline" title="Удержание" accent={ACC_RETAIN} />
              <View style={styles.tileRow}>
                <StatTile label="Возвраты" value={formatPct(report.retention.returningRate)} tone="good" />
                <StatTile label="Средний LTV" value={formatMoneyCompact(report.retention.avgLtv)} />
                <StatTile label="Между визитами" value={`${formatInt(report.retention.avgDaysBetweenVisits)} дн.`} />
              </View>
            </AnimatedCard>

            {/* ═══ ЗВОНКИ ═══ */}
            <AnimatedCard index={2} style={cardStyle}>
              <SectionHeader
                icon="call-outline"
                title="Звонки"
                accent={ACC_CALLS}
                trailing={
                  <View style={[styles.pill, { backgroundColor: palette.bg.muted }]}>
                    <Text style={[styles.pillText, { color: palette.text.secondary }]}>
                      Отвечаемость {formatPct(report.calls.answerRate)}
                    </Text>
                  </View>
                }
              />

              <View style={styles.tileRow}>
                <StatTile label="Всего" value={formatInt(report.calls.total)} />
                <StatTile label="Входящие" value={formatInt(report.calls.incoming)} icon="arrow-down-outline" />
                <StatTile label="Исходящие" value={formatInt(report.calls.outgoing)} icon="arrow-up-outline" />
              </View>
              <View style={styles.tileRow}>
                <StatTile
                  label="Пропущено"
                  value={formatInt(report.calls.missed)}
                  tone={report.calls.missed > 0 ? 'warn' : 'neutral'}
                />
                <StatTile
                  label="Не перезвонили"
                  value={formatInt(report.calls.notCalledBack)}
                  tone={report.calls.notCalledBack > 0 ? 'warn' : 'neutral'}
                />
                <View style={styles.tileSpacer} />
              </View>

              {/* Воронка звонков */}
              <View style={[styles.subBlock, { borderTopColor: palette.border.subtle }]}>
                <View style={styles.funnelHead}>
                  <Text style={[styles.subLabel, { color: palette.text.tertiary, marginBottom: 0 }]}>ВОРОНКА</Text>
                  <View
                    style={[
                      styles.pill,
                      { backgroundColor: softTintOr(palette.mode, colors.green[600], colors.green[50]) },
                    ]}
                  >
                    <Ionicons name="trending-up-outline" size={12} color={colors.green[600]} />
                    <Text style={[styles.pillText, { color: colors.green[600] }]}>
                      Конверсия {formatPct(report.calls.funnel.conversionRate)}
                    </Text>
                  </View>
                </View>
                <View style={{ gap: spacing[3], marginTop: spacing[3] }}>
                  <BarRow
                    label="Уникальные звонившие"
                    value={report.calls.funnel.uniqueCallers}
                    max={report.calls.funnel.uniqueCallers}
                    color={colors.indigo[600]}
                  />
                  <BarRow
                    label="Доехали"
                    value={report.calls.funnel.arrivedClients}
                    max={report.calls.funnel.uniqueCallers}
                    color={colors.primary[600]}
                  />
                  <BarRow
                    label="Оформили заказ-наряд"
                    value={report.calls.funnel.createdChecks}
                    max={report.calls.funnel.uniqueCallers}
                    color={colors.green[600]}
                  />
                </View>
                <View style={[styles.funnelFootRow, { borderTopColor: palette.border.subtle }]}>
                  <View style={styles.funnelFootItem}>
                    <Text style={[styles.footValue, { color: palette.text.primary }]}>
                      {formatInt(report.calls.funnel.repeatClients)}
                    </Text>
                    <Text style={[styles.footLabel, { color: palette.text.tertiary }]}>повторных</Text>
                  </View>
                  <View style={styles.funnelFootItem}>
                    <Text style={[styles.footValue, { color: palette.text.primary }]}>
                      {formatMoneyCompact(report.calls.funnel.revenue)}
                    </Text>
                    <Text style={[styles.footLabel, { color: palette.text.tertiary }]}>выручка</Text>
                  </View>
                </View>
              </View>
            </AnimatedCard>

            {/* ═══ ОТЗЫВЫ ═══ */}
            <AnimatedCard index={3} style={cardStyle}>
              <SectionHeader icon="star-outline" title="Отзывы" accent={ACC_REVIEWS} />

              {/* Рейтинг-герой */}
              <View style={styles.ratingHero}>
                <View>
                  <Text style={[styles.ratingBig, { color: palette.text.primary }]}>
                    {report.reviews.avgRating > 0 ? report.reviews.avgRating.toFixed(1) : '—'}
                  </Text>
                  <StarRating rating={report.reviews.avgRating} />
                </View>
                <View style={styles.ratingCount}>
                  <Text style={[styles.ratingCountValue, { color: palette.text.primary }]}>
                    {formatInt(report.reviews.total)}
                  </Text>
                  <Text style={[styles.ratingCountLabel, { color: palette.text.tertiary }]}>всего отзывов</Text>
                </View>
              </View>

              {/* Сентимент-бар позитив/негатив */}
              {report.reviews.total > 0 && (
                <>
                  <SplitBar
                    bg={palette.bg.muted}
                    segments={[
                      { value: report.reviews.positive, color: colors.green[600] },
                      { value: report.reviews.negative, color: colors.red[500] },
                    ]}
                  />
                  <View style={styles.sentimentLegend}>
                    <View style={styles.legendDotRow}>
                      <View style={[styles.legendDot, { backgroundColor: colors.green[600] }]} />
                      <Text style={[styles.legendLabel, { color: palette.text.secondary }]}>
                        Позитивные {formatInt(report.reviews.positive)}
                      </Text>
                    </View>
                    <View style={styles.legendDotRow}>
                      <View style={[styles.legendDot, { backgroundColor: colors.red[500] }]} />
                      <Text style={[styles.legendLabel, { color: palette.text.secondary }]}>
                        Негативные {formatInt(report.reviews.negative)}
                      </Text>
                    </View>
                  </View>
                </>
              )}

              <View style={[styles.tileRow, styles.reviewTiles]}>
                <StatTile label="Отклик" value={formatPct(report.reviews.responseRate)} />
                <StatTile label="Конверсия" value={formatPct(report.reviews.conversionRate)} />
              </View>
              <View style={styles.tileRow}>
                <StatTile label="Отправлено" value={formatInt(report.reviews.tokensSent)} icon="send-outline" />
                <StatTile
                  label="Ответили"
                  value={formatInt(report.reviews.tokensResponded)}
                  icon="checkmark-done-outline"
                />
              </View>
            </AnimatedCard>
          </View>
        )}
      </ScrollView>

      <DateTimePickerModal
        visible={showPicker !== null}
        mode="date"
        value={parseDateStr(showPicker === 'to' ? customRange.to : customRange.from)}
        onCancel={() => setShowPicker(null)}
        onConfirm={(date) => {
          const iso = toLocalISODate(date);
          setCustomRange((prev) => {
            const next = showPicker === 'to' ? { ...prev, to: iso } : { ...prev, from: iso };
            // Держим from ≤ to — если пользователь перевернул диапазон,
            // схлопываем оба края к выбранной дате.
            if (parseDateStr(next.from) > parseDateStr(next.to)) {
              return { from: iso, to: iso };
            }
            return next;
          });
          setPeriod('custom');
          setShowPicker(null);
        }}
      />
    </View>
  );
}

/** Icon-tile fill: translucent glow в тёмной теме, пастель — в светлой. */
function softTintOr(mode: 'light' | 'dark', accent: string, light: string): string {
  return mode === 'dark' ? softTint(accent, 'dark') : light;
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing[4], gap: spacing[4] },

  // Period
  periodWrap: { gap: spacing[3] },
  periodRow: { gap: spacing[2], paddingRight: spacing[2] },
  periodChip: {
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.full,
  },
  periodText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  customRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  customDateBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1.5],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  customDateText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  customDash: { fontSize: fontSize.base },

  // Card
  card: {
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing[4],
  },

  // Section header
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing[2.5], marginBottom: spacing[4] },
  sectionIcon: {
    width: 32,
    height: 32,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: { fontSize: fontSize.base, fontWeight: fontWeight.bold, letterSpacing: -0.3, flexShrink: 1 },
  sectionTrailing: { marginLeft: 'auto' },

  // Pill
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing[2.5],
    paddingVertical: 4,
    borderRadius: borderRadius.full,
  },
  pillText: { fontSize: 11, fontWeight: fontWeight.semibold },

  // Split bar (new vs returning / sentiment)
  splitBar: { flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden' },
  splitLegendRow: { flexDirection: 'row', alignItems: 'stretch', marginTop: spacing[3.5] },
  splitCol: { flex: 1, gap: 4 },
  splitDivider: { width: StyleSheet.hairlineWidth, marginHorizontal: spacing[4] },
  legendDotRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[1.5] },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendLabel: { fontSize: fontSize.xs, fontWeight: fontWeight.medium },
  splitValue: { fontSize: fontSize['2xl'], fontWeight: fontWeight.bold, fontVariant: ['tabular-nums'] },
  splitSub: { fontSize: fontSize.xs, fontVariant: ['tabular-nums'] },

  // Sub block (source / funnel)
  subBlock: { marginTop: spacing[4], paddingTop: spacing[4], borderTopWidth: StyleSheet.hairlineWidth },
  subLabel: { fontSize: 11, fontWeight: fontWeight.bold, letterSpacing: 0.8, marginBottom: spacing[3] },

  // Source rows
  sourceRow: { marginBottom: spacing[3] },
  sourceHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  sourceName: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, flexShrink: 1, marginRight: spacing[2] },
  sourceRevenue: { fontSize: fontSize.xs, fontWeight: fontWeight.medium, fontVariant: ['tabular-nums'] },
  sourceBarRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  sourceBarTrack: { flex: 1 },
  sourceCount: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    minWidth: 28,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },

  // Bars (funnel)
  barRow: {},
  barRowHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  barLabel: { fontSize: fontSize.sm, flexShrink: 1, marginRight: spacing[2] },
  barValue: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, fontVariant: ['tabular-nums'] },
  barTrack: { height: 8, borderRadius: 4, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4 },

  // Tiles
  tileRow: { flexDirection: 'row', gap: spacing[2.5], marginBottom: spacing[2.5] },
  tile: {
    flex: 1,
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    gap: 6,
  },
  tileHead: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  tileLabel: { fontSize: 11, fontWeight: fontWeight.medium, flexShrink: 1 },
  tileValue: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, fontVariant: ['tabular-nums'] },
  tileSpacer: { flex: 1 },

  // Funnel foot
  funnelHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  funnelFootRow: {
    flexDirection: 'row',
    marginTop: spacing[4],
    paddingTop: spacing[3],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  funnelFootItem: { flex: 1, alignItems: 'center', gap: 2 },
  footValue: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, fontVariant: ['tabular-nums'] },
  footLabel: { fontSize: fontSize.xs },

  // Reviews
  ratingHero: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing[4] },
  ratingBig: {
    fontSize: 40,
    fontWeight: fontWeight.bold,
    letterSpacing: -1,
    marginBottom: 4,
    fontVariant: ['tabular-nums'],
  },
  ratingCount: { alignItems: 'flex-end' },
  ratingCountValue: { fontSize: fontSize['2xl'], fontWeight: fontWeight.bold, fontVariant: ['tabular-nums'] },
  ratingCountLabel: { fontSize: fontSize.xs, marginTop: 2 },
  sentimentLegend: { flexDirection: 'row', gap: spacing[4], marginTop: spacing[3], marginBottom: spacing[1] },
  reviewTiles: { marginTop: spacing[4] },

  // Empty
  emptyWrap: { alignItems: 'center', paddingVertical: spacing[16], paddingHorizontal: spacing[6], gap: spacing[3] },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[1],
  },
  emptyTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.bold },
  emptyDesc: { fontSize: fontSize.sm, textAlign: 'center', maxWidth: 300, lineHeight: 20 },
});
