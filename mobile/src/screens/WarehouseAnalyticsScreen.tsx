/**
 * WarehouseAnalyticsScreen — premium financial analytics for warehouse.
 *
 * Owner-facing deep dive into the money frozen in stock. Reads from the
 * `/warehouse-analytics/*` endpoints (045 stock-value-snapshots + computed):
 *
 *   • summary           — stock value start/current + delta, dead-stock
 *                         buckets, ABC tiers, average margin + GMROI.
 *   • velocity          — per-product avg daily sales + days-of-stock.
 *   • reorder-forecast  — what to order now / soon / overstocked.
 *   • category-margin   — gross margin breakdown by category.
 *   • top-moving        — top-N by sold quantity.
 *   • top-margin        — top-N by profit.
 *
 * The screen is read-only — no mutations, no detail navigation (yet). It
 * exists so the owner can answer "where is my money sitting?" in one
 * scroll. Period switcher (Month / Quarter / Year) and warehouse switcher
 * sit under the iOS header.
 *
 * Performance contract:
 *   • All queries are persisted via persistentCache.ts under their first
 *     query-key segment — first paint is instant on cold start.
 *   • `placeholderData: prev => prev` keeps the previous period's data
 *     visible while switching periods, so the user never sees a flash.
 *   • Heavy sections (velocity, top-moving, top-margin) are sliced to
 *     top 10 client-side — backend already filters, this is defensive.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import Svg, { Defs, LinearGradient as SvgGrad, Path, Stop } from 'react-native-svg';

import IosScreenHeader from '../components/IosScreenHeader';
import AnimatedCard from '../components/AnimatedCard';
import EmptyState from '../components/EmptyState';
import FreshnessBadge from '../components/FreshnessBadge';
import { Text } from '../platform/Typography';
import { iosCard, iosSectionLabel } from '../platform/iosSurface';
import { haptic } from '../platform/haptics';
import { useColors } from '../contexts/ThemeContext';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { borderRadius, colors, fontSize, spacing } from '../theme';
import { warehouseAnalyticsApi, warehousesApi } from '../api/services';
import { formatMoney } from '../../../shared/utils/formatters';
import type {
  CategoryMargin,
  ReorderItem,
  TopProduct,
  VelocityRow,
  Warehouse,
  WarehouseSummary,
} from '../../../shared/types';

// ────────────────────────────────────────────────────────────────────────
// Period switcher chip group
// ────────────────────────────────────────────────────────────────────────

type Period = 'month' | 'quarter' | 'year';

const PERIODS: Array<{ key: Period; label: string }> = [
  { key: 'month', label: 'Месяц' },
  { key: 'quarter', label: 'Квартал' },
  { key: 'year', label: 'Год' },
];

interface MonthPeriodSwitcherProps {
  value: Period;
  onChange: (next: Period) => void;
}

function MonthPeriodSwitcher({ value, onChange }: MonthPeriodSwitcherProps) {
  const palette = useColors();
  return (
    <View style={[styles.segWrap, { backgroundColor: palette.bg.muted }]}>
      {PERIODS.map((p) => {
        const active = value === p.key;
        return (
          <Pressable
            key={p.key}
            onPress={() => {
              if (!active) {
                haptic('select');
                onChange(p.key);
              }
            }}
            style={[
              styles.segItem,
              active && {
                backgroundColor: palette.bg.card,
                shadowColor: '#000',
                shadowOpacity: palette.mode === 'dark' ? 0.18 : 0.06,
                shadowRadius: 4,
                shadowOffset: { width: 0, height: 1 },
              },
            ]}
            hitSlop={6}
          >
            <Text
              variant="caption"
              style={[
                styles.segItemText,
                {
                  color: active ? palette.text.primary : palette.text.secondary,
                  fontWeight: active ? '700' : '500',
                },
              ]}
            >
              {p.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Warehouse chip row — Все / Основной / Брак / Б/У
// ────────────────────────────────────────────────────────────────────────

interface WarehouseChipRowProps {
  warehouses: Warehouse[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

const KIND_LABEL: Record<Warehouse['kind'], string> = {
  main: 'Основной',
  defect: 'Брак',
  used: 'Б/У',
};

function WarehouseChipRow({ warehouses, selectedId, onSelect }: WarehouseChipRowProps) {
  const palette = useColors();
  // "Все" first, then warehouses sorted by sortOrder.
  const sorted = useMemo(() => [...warehouses].sort((a, b) => a.sortOrder - b.sortOrder), [warehouses]);

  const renderChip = (id: string | null, label: string) => {
    const active = selectedId === id;
    return (
      <Pressable
        key={id ?? 'all'}
        onPress={() => {
          if (selectedId !== id) {
            haptic('select');
            onSelect(id);
          }
        }}
        style={[
          styles.whChip,
          {
            backgroundColor: active ? palette.accent.primarySoft : palette.bg.card,
            borderColor: active ? palette.accent.primary : palette.border.subtle,
          },
        ]}
        hitSlop={4}
      >
        <Text
          variant="caption"
          style={[
            styles.whChipText,
            {
              color: active ? palette.accent.primary : palette.text.secondary,
              fontWeight: active ? '700' : '500',
            },
          ]}
        >
          {label}
        </Text>
      </Pressable>
    );
  };

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.whChipsRow}
    >
      {renderChip(null, 'Все')}
      {sorted.map((wh) => renderChip(wh.id, wh.name || KIND_LABEL[wh.kind]))}
    </ScrollView>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Sparkline helpers (used in Hero card)
// ────────────────────────────────────────────────────────────────────────

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

// ────────────────────────────────────────────────────────────────────────
// Small UI helpers
// ────────────────────────────────────────────────────────────────────────

function DeltaPill({ deltaPct, palette }: { deltaPct: number; palette: ReturnType<typeof useColors> }) {
  const tone: 'up' | 'down' | 'flat' =
    deltaPct > 0.5 ? 'up' : deltaPct < -0.5 ? 'down' : 'flat';
  const colour =
    tone === 'up' ? colors.green[700] : tone === 'down' ? colors.red[700] : palette.text.tertiary;
  const bg = tone === 'up' ? colors.green[50] : tone === 'down' ? colors.red[50] : palette.bg.muted;
  const iconName = tone === 'up' ? 'arrow-up' : tone === 'down' ? 'arrow-down' : 'remove';
  return (
    <View style={[styles.deltaPill, { backgroundColor: bg }]}>
      <Ionicons name={iconName} size={11} color={colour} />
      <Text variant="caption" style={[styles.deltaPillText, { color: colour }]}>
        {tone === 'flat' ? '0%' : `${Math.abs(deltaPct).toFixed(1)}%`}
      </Text>
    </View>
  );
}

function UrgencyBadge({ urgency }: { urgency: ReorderItem['urgency'] }) {
  const map: Record<ReorderItem['urgency'], { label: string; bg: string; fg: string }> = {
    critical: { label: 'Срочно', bg: colors.red[50], fg: colors.red[700] },
    now: { label: 'Скоро', bg: colors.orange[50], fg: colors.orange[700] },
    soon: { label: 'Заметить', bg: colors.amber[50], fg: colors.amber[700] },
    overstocked: { label: 'Избыток', bg: colors.gray[100], fg: colors.gray[600] },
  };
  const { label, bg, fg } = map[urgency];
  return (
    <View style={[styles.urgencyBadge, { backgroundColor: bg }]}>
      <Text variant="caption" style={[styles.urgencyBadgeText, { color: fg }]}>
        {label}
      </Text>
    </View>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Main screen
// ────────────────────────────────────────────────────────────────────────

export default function WarehouseAnalyticsScreen() {
  const navigation = useNavigation<any>();
  const palette = useColors();
  const queryClient = useQueryClient();
  const tabBarHeight = useTabBarHeight();

  const [period, setPeriod] = useState<Period>('month');
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // ── Reference: warehouses list ────────────────────────────────────
  const { data: warehouses } = useQuery<Warehouse[]>({
    queryKey: ['warehouses'],
    queryFn: async () => (await warehousesApi.list()).data,
    staleTime: 10 * 60_000,
    placeholderData: (prev) => prev,
  });

  // ── Analytics: summary (the hero query) ───────────────────────────
  const summaryParams = useMemo(
    () => ({ period, warehouseId: selectedWarehouseId ?? undefined }),
    [period, selectedWarehouseId],
  );
  const summaryQuery = useQuery<WarehouseSummary>({
    queryKey: ['warehouse-analytics-summary', summaryParams],
    queryFn: async () => (await warehouseAnalyticsApi.summary(summaryParams)).data,
    placeholderData: (prev) => prev,
    staleTime: 60_000,
  });

  const velocityQuery = useQuery<VelocityRow[]>({
    queryKey: ['warehouse-analytics-velocity', summaryParams],
    queryFn: async () => (await warehouseAnalyticsApi.velocity(summaryParams)).data,
    placeholderData: (prev) => prev,
    staleTime: 60_000,
  });

  const reorderQuery = useQuery<ReorderItem[]>({
    queryKey: ['warehouse-analytics-reorder', { warehouseId: selectedWarehouseId ?? undefined }],
    queryFn: async () =>
      (await warehouseAnalyticsApi.reorderForecast({
        warehouseId: selectedWarehouseId ?? undefined,
      })).data,
    placeholderData: (prev) => prev,
    staleTime: 60_000,
  });

  const categoryMarginQuery = useQuery<CategoryMargin[]>({
    queryKey: ['warehouse-analytics-category-margin', { period }],
    queryFn: async () => (await warehouseAnalyticsApi.categoryMargin({ period })).data,
    placeholderData: (prev) => prev,
    staleTime: 60_000,
  });

  const topMovingQuery = useQuery<TopProduct[]>({
    queryKey: ['warehouse-analytics-top-moving', { period, limit: 10 }],
    queryFn: async () => (await warehouseAnalyticsApi.topMoving({ period, limit: 10 })).data,
    placeholderData: (prev) => prev,
    staleTime: 60_000,
  });

  const topMarginQuery = useQuery<TopProduct[]>({
    queryKey: ['warehouse-analytics-top-margin', { period, limit: 10 }],
    queryFn: async () => (await warehouseAnalyticsApi.topMargin({ period, limit: 10 })).data,
    placeholderData: (prev) => prev,
    staleTime: 60_000,
  });

  const summary = summaryQuery.data;
  const velocity = velocityQuery.data;
  const reorder = reorderQuery.data;
  const categoryMargin = categoryMarginQuery.data;
  const topMoving = topMovingQuery.data;
  const topMargin = topMarginQuery.data;

  // Derive reorder splits (urgent vs overstocked).
  const reorderUrgent = useMemo(
    () =>
      (reorder ?? [])
        .filter((r) => r.urgency !== 'overstocked')
        .sort((a, b) => {
          // critical first, then now, then soon
          const rank: Record<ReorderItem['urgency'], number> = {
            critical: 0,
            now: 1,
            soon: 2,
            overstocked: 3,
          };
          return rank[a.urgency] - rank[b.urgency];
        })
        .slice(0, 5),
    [reorder],
  );

  const reorderOverstocked = useMemo(
    () =>
      (reorder ?? [])
        .filter((r) => r.urgency === 'overstocked')
        .sort((a, b) => b.daysOfStock - a.daysOfStock)
        .slice(0, 5),
    [reorder],
  );

  // ── Refresh ───────────────────────────────────────────────────────
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    haptic('tap');
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['warehouse-analytics-summary'] }),
      queryClient.invalidateQueries({ queryKey: ['warehouse-analytics-velocity'] }),
      queryClient.invalidateQueries({ queryKey: ['warehouse-analytics-reorder'] }),
      queryClient.invalidateQueries({ queryKey: ['warehouse-analytics-category-margin'] }),
      queryClient.invalidateQueries({ queryKey: ['warehouse-analytics-top-moving'] }),
      queryClient.invalidateQueries({ queryKey: ['warehouse-analytics-top-margin'] }),
    ]);
    setRefreshing(false);
  }, [queryClient]);

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader
        title="Складская аналитика"
        onBack={() => navigation.goBack()}
        trailing={<MonthPeriodSwitcher value={period} onChange={setPeriod} />}
      />

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: Platform.OS === 'ios' ? spacing[6] : tabBarHeight + spacing[6] },
        ]}
        contentInset={{ bottom: tabBarHeight }}
        scrollIndicatorInsets={{ bottom: tabBarHeight }}
        automaticallyAdjustContentInsets={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={palette.accent.primary}
          />
        }
      >
        {/* Warehouse switcher chip row */}
        <WarehouseChipRow
          warehouses={warehouses ?? []}
          selectedId={selectedWarehouseId}
          onSelect={setSelectedWarehouseId}
        />

        {/* Freshness badge wired to summary query */}
        <View style={styles.freshnessRow}>
          <FreshnessBadge query={summaryQuery} />
        </View>

        {/* 1. Hero: Стоимость склада */}
        <HeroValueCard summary={summary} palette={palette} index={0} />

        {/* 2. Динамика: start vs current */}
        <DynamicsCard summary={summary} palette={palette} index={1} />

        {/* 3. Рекомендуем заказать */}
        <ReorderCard rows={reorderUrgent} palette={palette} index={2} />

        {/* 4. Затоварено */}
        <OverstockedCard rows={reorderOverstocked} palette={palette} index={3} />

        {/* 5. Топ ходовых */}
        <TopProductsCard
          title="🔥 Топ ходовых"
          subtitle="По количеству продаж"
          mode="moving"
          rows={topMoving}
          palette={palette}
          index={4}
        />

        {/* 6. Топ маржинальных */}
        <TopProductsCard
          title="💰 Топ маржинальных"
          subtitle="По прибыли"
          mode="margin"
          rows={topMargin}
          palette={palette}
          index={5}
        />

        {/* 7. ABC-анализ */}
        <AbcAnalysisCard summary={summary} palette={palette} index={6} />

        {/* 8. Мёртвый сток */}
        <DeadStockCard summary={summary} palette={palette} index={7} />

        {/* 9. Маржинальность по категориям */}
        <CategoryMarginCard rows={categoryMargin} palette={palette} index={8} />

        {/* 10. Скорость оборачиваемости */}
        <VelocityCard rows={velocity} palette={palette} index={9} />

        {/* 11. GMROI */}
        <GmroiCard summary={summary} palette={palette} index={10} />
      </ScrollView>
    </View>
  );
}

// ────────────────────────────────────────────────────────────────────────
// 1. Hero: Стоимость склада
// ────────────────────────────────────────────────────────────────────────

function HeroValueCard({
  summary,
  palette,
  index,
}: {
  summary?: WarehouseSummary;
  palette: ReturnType<typeof useColors>;
  index: number;
}) {
  const W = 260;
  const H = 56;
  // Synthetic series — we don't have a per-day history endpoint yet, so
  // we draw a soft "start → current" curve so the card feels alive.
  const series = useMemo(() => {
    if (!summary) return [0, 0];
    const a = summary.stockValueStart;
    const b = summary.stockValueCurrent;
    // 6-point smooth interpolation; biased so the line breathes rather
    // than being a perfectly straight slope.
    return Array.from({ length: 6 }, (_, i) => {
      const t = i / 5;
      const wobble = Math.sin(t * Math.PI) * 0.04 * (b - a);
      return a + (b - a) * t + wobble;
    });
  }, [summary]);

  if (!summary) {
    return (
      <AnimatedCard
        index={index}
        style={[
          styles.heroCard,
          { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
        ]}
      >
        <Text style={[iosSectionLabel, { color: palette.text.tertiary }]}>Стоимость склада</Text>
        <EmptyState title="Нет данных" description="Загрузка снимков…" icon="cube" />
      </AnimatedCard>
    );
  }

  const path = buildSparkPath(series, W, H);
  const areaPath = buildSparkAreaPath(series, W, H);
  const deltaPositive = summary.stockValueDelta >= 0;
  const lineColor = deltaPositive ? colors.green[600] : colors.red[600];
  const glowColor = deltaPositive ? colors.green[200] : colors.red[200];

  return (
    <AnimatedCard
      index={index}
      style={[
        styles.heroCard,
        { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
      ]}
    >
      <View style={styles.heroHeaderRow}>
        <Text style={[iosSectionLabel, { color: palette.text.tertiary, marginBottom: 0 }]}>
          Стоимость склада
        </Text>
        <DeltaPill deltaPct={summary.deltaPct} palette={palette} />
      </View>
      <Text style={[styles.heroValue, { color: palette.text.primary }]}>
        {formatMoney(summary.stockValueCurrent)}
      </Text>
      <Text style={[styles.heroCaption, { color: palette.text.secondary }]}>Денег в товаре</Text>
      <View style={styles.heroSpark}>
        {series.length > 1 && (
          <Svg width={W} height={H}>
            <Defs>
              <SvgGrad id="heroSparkGrad" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0%" stopColor={glowColor} stopOpacity={0.55} />
                <Stop offset="100%" stopColor={glowColor} stopOpacity={0} />
              </SvgGrad>
            </Defs>
            <Path d={areaPath} fill="url(#heroSparkGrad)" />
            <Path d={path} stroke={lineColor} strokeWidth={2} fill="none" strokeLinecap="round" />
          </Svg>
        )}
      </View>
      <Text style={[styles.heroExplain, { color: palette.text.tertiary }]}>
        На начало периода: {formatMoney(summary.stockValueStart)}
      </Text>
    </AnimatedCard>
  );
}

// ────────────────────────────────────────────────────────────────────────
// 2. Динамика — два больших числа со стрелкой между ними
// ────────────────────────────────────────────────────────────────────────

function DynamicsCard({
  summary,
  palette,
  index,
}: {
  summary?: WarehouseSummary;
  palette: ReturnType<typeof useColors>;
  index: number;
}) {
  if (!summary) return null;
  const deltaPositive = summary.stockValueDelta >= 0;
  const explanation = deltaPositive
    ? 'Товара больше — закупились, либо продажи замедлились'
    : 'Товара меньше — расходуем запас, спрос растёт';

  return (
    <AnimatedCard
      index={index}
      style={[
        styles.sectionCard,
        { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
      ]}
    >
      <Text style={[iosSectionLabel, { color: palette.text.tertiary }]}>Динамика</Text>
      <View style={styles.dynamicsRow}>
        <View style={styles.dynamicsCol}>
          <Text variant="caption" style={[styles.dynamicsLabel, { color: palette.text.tertiary }]}>
            Начало
          </Text>
          <Text style={[styles.dynamicsValue, { color: palette.text.secondary }]} numberOfLines={1}>
            {formatMoney(summary.stockValueStart)}
          </Text>
        </View>
        <View style={styles.dynamicsArrowCol}>
          <Ionicons
            name={deltaPositive ? 'arrow-forward' : 'arrow-forward'}
            size={20}
            color={deltaPositive ? colors.green[600] : colors.red[600]}
          />
          <Text
            variant="caption"
            style={[styles.dynamicsArrowLabel, { color: deltaPositive ? colors.green[700] : colors.red[700] }]}
          >
            {deltaPositive ? '+' : ''}
            {formatMoney(summary.stockValueDelta)}
          </Text>
        </View>
        <View style={[styles.dynamicsCol, { alignItems: 'flex-end' }]}>
          <Text variant="caption" style={[styles.dynamicsLabel, { color: palette.text.tertiary }]}>
            Сейчас
          </Text>
          <Text style={[styles.dynamicsValue, { color: palette.text.primary, fontWeight: '700' }]} numberOfLines={1}>
            {formatMoney(summary.stockValueCurrent)}
          </Text>
        </View>
      </View>
      <Text style={[styles.cardCaption, { color: palette.text.tertiary }]}>{explanation}</Text>
    </AnimatedCard>
  );
}

// ────────────────────────────────────────────────────────────────────────
// 3. Рекомендуем заказать (топ 5 не overstocked)
// ────────────────────────────────────────────────────────────────────────

function ReorderCard({
  rows,
  palette,
  index,
}: {
  rows: ReorderItem[];
  palette: ReturnType<typeof useColors>;
  index: number;
}) {
  return (
    <AnimatedCard
      index={index}
      style={[
        styles.sectionCard,
        { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
      ]}
    >
      <Text style={[iosSectionLabel, { color: palette.text.tertiary }]}>🤖 Рекомендуем заказать</Text>
      {rows.length === 0 ? (
        <EmptyState
          title="Запасы в порядке"
          description="Срочных заказов нет — все товары достаточно."
          icon="cube"
        />
      ) : (
        rows.map((r, i) => (
          <View
            key={r.productId}
            style={[
              styles.row,
              i < rows.length - 1 && {
                borderBottomWidth: StyleSheet.hairlineWidth,
                borderBottomColor: palette.border.subtle,
              },
            ]}
          >
            <View style={styles.rowMain}>
              <Text style={[styles.rowTitle, { color: palette.text.primary }]} numberOfLines={1}>
                {r.name}
              </Text>
              <View style={styles.rowMetaInline}>
                <UrgencyBadge urgency={r.urgency} />
                <Text variant="caption" style={[styles.rowMetaText, { color: palette.text.tertiary }]}>
                  Запаса на {r.daysOfStock} дн.
                </Text>
              </View>
            </View>
            <View style={styles.rowTrailing}>
              <Text style={[styles.rowAmount, { color: palette.text.primary }]}>~{r.recommendedOrderQty} шт</Text>
              <Text variant="caption" style={[styles.rowAmountCap, { color: palette.text.tertiary }]}>
                заказать
              </Text>
            </View>
          </View>
        ))
      )}
    </AnimatedCard>
  );
}

// ────────────────────────────────────────────────────────────────────────
// 4. Затоварено
// ────────────────────────────────────────────────────────────────────────

function OverstockedCard({
  rows,
  palette,
  index,
}: {
  rows: ReorderItem[];
  palette: ReturnType<typeof useColors>;
  index: number;
}) {
  return (
    <AnimatedCard
      index={index}
      style={[
        styles.sectionCard,
        { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
      ]}
    >
      <Text style={[iosSectionLabel, { color: palette.text.tertiary }]}>⚠️ Затоварено</Text>
      {rows.length === 0 ? (
        <EmptyState
          title="Нет избыточных запасов"
          description="Капитал не заморожен — товар движется."
          icon="check"
        />
      ) : (
        <>
          {rows.map((r, i) => (
            <View
              key={r.productId}
              style={[
                styles.row,
                i < rows.length - 1 && {
                  borderBottomWidth: StyleSheet.hairlineWidth,
                  borderBottomColor: palette.border.subtle,
                },
              ]}
            >
              <View style={styles.rowMain}>
                <Text style={[styles.rowTitle, { color: palette.text.primary }]} numberOfLines={1}>
                  {r.name}
                </Text>
                <Text variant="caption" style={[styles.rowMetaText, { color: palette.text.tertiary }]}>
                  Остаток {r.currentStock} шт
                </Text>
              </View>
              <View style={styles.rowTrailing}>
                <Text style={[styles.rowAmount, { color: colors.amber[700] }]}>
                  {r.daysOfStock} дн.
                </Text>
                <Text variant="caption" style={[styles.rowAmountCap, { color: palette.text.tertiary }]}>
                  запаса
                </Text>
              </View>
            </View>
          ))}
          <Text style={[styles.cardCaption, { color: palette.text.tertiary }]}>
            Капитал заморожен в товарах без движения
          </Text>
        </>
      )}
    </AnimatedCard>
  );
}

// ────────────────────────────────────────────────────────────────────────
// 5 & 6. Top products
// ────────────────────────────────────────────────────────────────────────

function TopProductsCard({
  title,
  subtitle,
  mode,
  rows,
  palette,
  index,
}: {
  title: string;
  subtitle: string;
  mode: 'moving' | 'margin';
  rows: TopProduct[] | undefined;
  palette: ReturnType<typeof useColors>;
  index: number;
}) {
  const list = useMemo(() => (rows ?? []).slice(0, 10), [rows]);
  return (
    <AnimatedCard
      index={index}
      style={[
        styles.sectionCard,
        { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
      ]}
    >
      <Text style={[iosSectionLabel, { color: palette.text.tertiary }]}>{title}</Text>
      <Text style={[styles.cardSubtitle, { color: palette.text.secondary }]}>{subtitle}</Text>
      {list.length === 0 ? (
        <EmptyState title="Нет данных" description="За выбранный период продаж не было." icon="cube" />
      ) : (
        list.map((row, i) => (
          <View
            key={row.productId}
            style={[
              styles.row,
              i < list.length - 1 && {
                borderBottomWidth: StyleSheet.hairlineWidth,
                borderBottomColor: palette.border.subtle,
              },
            ]}
          >
            <View style={styles.rankBubble}>
              <Text variant="caption" style={[styles.rankBubbleText, { color: palette.text.secondary }]}>
                {i + 1}
              </Text>
            </View>
            <View style={styles.rowMain}>
              <Text style={[styles.rowTitle, { color: palette.text.primary }]} numberOfLines={1}>
                {row.name}
              </Text>
              <Text variant="caption" style={[styles.rowMetaText, { color: palette.text.tertiary }]}>
                Продано {row.soldQty} шт
              </Text>
            </View>
            <View style={styles.rowTrailing}>
              <Text style={[styles.rowAmount, { color: palette.text.primary }]}>
                {formatMoney(mode === 'margin' ? row.profit : row.revenue)}
              </Text>
              <Text variant="caption" style={[styles.rowAmountCap, { color: palette.text.tertiary }]}>
                {mode === 'margin' ? 'прибыль' : 'выручка'}
              </Text>
            </View>
          </View>
        ))
      )}
    </AnimatedCard>
  );
}

// ────────────────────────────────────────────────────────────────────────
// 7. ABC analysis
// ────────────────────────────────────────────────────────────────────────

function AbcAnalysisCard({
  summary,
  palette,
  index,
}: {
  summary?: WarehouseSummary;
  palette: ReturnType<typeof useColors>;
  index: number;
}) {
  const abc = summary?.abcAnalysis ?? [];
  // Make sure A/B/C are in fixed order regardless of backend ordering.
  const sorted = useMemo(() => {
    const order: Array<'A' | 'B' | 'C'> = ['A', 'B', 'C'];
    return order.map((t) => abc.find((r) => r.tier === t) ?? { tier: t, count: 0, value: 0, pct: 0 });
  }, [abc]);

  const tierColor: Record<'A' | 'B' | 'C', string> = {
    A: colors.green[500],
    B: colors.amber[600],
    C: colors.gray[400],
  };

  const tierLabel: Record<'A' | 'B' | 'C', string> = {
    A: 'A — 80% выручки',
    B: 'B — 15% выручки',
    C: 'C — 5% выручки',
  };

  const aCount = sorted.find((r) => r.tier === 'A')?.count ?? 0;
  const totalCount = sorted.reduce((sum, r) => sum + (r.count || 0), 0);

  return (
    <AnimatedCard
      index={index}
      style={[
        styles.sectionCard,
        { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
      ]}
    >
      <Text style={[iosSectionLabel, { color: palette.text.tertiary }]}>📊 ABC-анализ</Text>
      {totalCount === 0 ? (
        <EmptyState
          title="Нет данных"
          description="Недостаточно продаж за период для классификации."
          icon="chart-bar"
        />
      ) : (
        <>
          {sorted.map((row) => {
            const widthPct = Math.max(2, Math.min(100, row.pct));
            return (
              <View key={row.tier} style={styles.abcRow}>
                <View style={styles.abcLabelCol}>
                  <Text style={[styles.abcLabel, { color: palette.text.primary }]}>{tierLabel[row.tier]}</Text>
                  <Text variant="caption" style={[styles.abcCount, { color: palette.text.tertiary }]}>
                    {row.count} товаров · {formatMoney(row.value)}
                  </Text>
                </View>
                <View style={[styles.abcBarTrack, { backgroundColor: palette.bg.muted }]}>
                  <View
                    style={[
                      styles.abcBarFill,
                      { width: `${widthPct}%`, backgroundColor: tierColor[row.tier] },
                    ]}
                  />
                </View>
              </View>
            );
          })}
          {aCount > 0 && (
            <Text style={[styles.cardCaption, { color: palette.text.tertiary }]}>
              {aCount} товар{plural(aCount, 'ов', 'а', 'ов')} приносят 80% выручки — фокусируйтесь на них
            </Text>
          )}
        </>
      )}
    </AnimatedCard>
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

// ────────────────────────────────────────────────────────────────────────
// 8. Dead stock
// ────────────────────────────────────────────────────────────────────────

function DeadStockCard({
  summary,
  palette,
  index,
}: {
  summary?: WarehouseSummary;
  palette: ReturnType<typeof useColors>;
  index: number;
}) {
  if (!summary) return null;
  const buckets: Array<{ label: string; count: number; value: number; tone: 'soft' | 'warn' | 'hot' }> = [
    { label: '> 30 дней', count: summary.deadStock30.count, value: summary.deadStock30.value, tone: 'soft' },
    { label: '> 60 дней', count: summary.deadStock60.count, value: summary.deadStock60.value, tone: 'warn' },
    { label: '> 90 дней', count: summary.deadStock90.count, value: summary.deadStock90.value, tone: 'hot' },
  ];
  const highlight90 = summary.deadStock90.value > summary.stockValueCurrent * 0.1;
  const allEmpty = buckets.every((b) => b.count === 0);

  const toneColor: Record<'soft' | 'warn' | 'hot', { bg: string; fg: string; border: string }> = {
    soft: { bg: colors.amber[50], fg: colors.amber[700], border: colors.amber[200] },
    warn: { bg: colors.orange[50], fg: colors.orange[700], border: colors.orange[400] },
    hot: { bg: colors.red[50], fg: colors.red[700], border: colors.red[300] },
  };

  return (
    <AnimatedCard
      index={index}
      style={[
        styles.sectionCard,
        { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
      ]}
    >
      <Text style={[iosSectionLabel, { color: palette.text.tertiary }]}>💀 Мёртвый сток</Text>
      {allEmpty ? (
        <EmptyState
          title="Мёртвого стока нет"
          description="Каждый товар двигался за последние 30 дней."
          icon="star"
        />
      ) : (
        <>
          <View style={styles.deadStockRow}>
            {buckets.map((b) => {
              const palettePair = toneColor[b.tone];
              const isHotHighlight = b.tone === 'hot' && highlight90;
              return (
                <View
                  key={b.label}
                  style={[
                    styles.deadStockChip,
                    {
                      backgroundColor: palettePair.bg,
                      borderColor: isHotHighlight ? palettePair.border : 'transparent',
                      borderWidth: isHotHighlight ? 1 : 0,
                    },
                  ]}
                >
                  <Text variant="caption" style={[styles.deadStockChipLabel, { color: palettePair.fg }]}>
                    {b.label}
                  </Text>
                  <Text style={[styles.deadStockChipCount, { color: palettePair.fg }]}>{b.count}</Text>
                  <Text variant="caption" style={[styles.deadStockChipValue, { color: palettePair.fg }]}>
                    {formatMoney(b.value)}
                  </Text>
                </View>
              );
            })}
          </View>
          <Text style={[styles.cardCaption, { color: palette.text.tertiary }]}>
            Капитал заморожен в товарах без движения
          </Text>
        </>
      )}
    </AnimatedCard>
  );
}

// ────────────────────────────────────────────────────────────────────────
// 9. Category margin
// ────────────────────────────────────────────────────────────────────────

function CategoryMarginCard({
  rows,
  palette,
  index,
}: {
  rows: CategoryMargin[] | undefined;
  palette: ReturnType<typeof useColors>;
  index: number;
}) {
  const sorted = useMemo(() => [...(rows ?? [])].sort((a, b) => b.marginPct - a.marginPct), [rows]);
  const maxPct = useMemo(() => Math.max(0.001, ...sorted.map((r) => Math.abs(r.marginPct))), [sorted]);

  return (
    <AnimatedCard
      index={index}
      style={[
        styles.sectionCard,
        { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
      ]}
    >
      <Text style={[iosSectionLabel, { color: palette.text.tertiary }]}>📈 Маржинальность по категориям</Text>
      {sorted.length === 0 ? (
        <EmptyState
          title="Нет данных"
          description="За выбранный период категорий с продажами нет."
          icon="chart-bar"
        />
      ) : (
        sorted.map((row, i) => {
          const widthPct = Math.max(2, Math.min(100, (Math.abs(row.marginPct) / maxPct) * 100));
          const barColor = row.marginPct >= 30 ? colors.green[500] : row.marginPct >= 15 ? colors.amber[600] : colors.red[400];
          return (
            <View
              key={row.category || `cat-${i}`}
              style={[
                styles.categoryRow,
                i < sorted.length - 1 && {
                  borderBottomWidth: StyleSheet.hairlineWidth,
                  borderBottomColor: palette.border.subtle,
                  paddingBottom: spacing[3],
                },
              ]}
            >
              <View style={styles.categoryHeader}>
                <Text style={[styles.categoryName, { color: palette.text.primary }]} numberOfLines={1}>
                  {row.category || 'Без категории'}
                </Text>
                <Text style={[styles.categoryPct, { color: palette.text.primary }]}>
                  {row.marginPct.toFixed(1)}%
                </Text>
              </View>
              <View style={[styles.categoryBarTrack, { backgroundColor: palette.bg.muted }]}>
                <View style={[styles.categoryBarFill, { width: `${widthPct}%`, backgroundColor: barColor }]} />
              </View>
              <Text variant="caption" style={[styles.categoryCaption, { color: palette.text.tertiary }]}>
                Выручка {formatMoney(row.revenue)} · Прибыль {formatMoney(row.margin)}
              </Text>
            </View>
          );
        })
      )}
    </AnimatedCard>
  );
}

// ────────────────────────────────────────────────────────────────────────
// 10. Velocity
// ────────────────────────────────────────────────────────────────────────

function VelocityCard({
  rows,
  palette,
  index,
}: {
  rows: VelocityRow[] | undefined;
  palette: ReturnType<typeof useColors>;
  index: number;
}) {
  const sorted = useMemo(
    () => [...(rows ?? [])].sort((a, b) => b.avgDailySales - a.avgDailySales).slice(0, 10),
    [rows],
  );
  return (
    <AnimatedCard
      index={index}
      style={[
        styles.sectionCard,
        { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
      ]}
    >
      <Text style={[iosSectionLabel, { color: palette.text.tertiary }]}>📦 Скорость оборачиваемости</Text>
      {sorted.length === 0 ? (
        <EmptyState
          title="Нет данных"
          description="Нет товаров с движением за период."
          icon="trend-up"
        />
      ) : (
        sorted.map((row, i) => (
          <View
            key={row.productId}
            style={[
              styles.row,
              i < sorted.length - 1 && {
                borderBottomWidth: StyleSheet.hairlineWidth,
                borderBottomColor: palette.border.subtle,
              },
            ]}
          >
            <View style={styles.rankBubble}>
              <Text variant="caption" style={[styles.rankBubbleText, { color: palette.text.secondary }]}>
                {i + 1}
              </Text>
            </View>
            <View style={styles.rowMain}>
              <Text style={[styles.rowTitle, { color: palette.text.primary }]} numberOfLines={1}>
                {row.name}
              </Text>
              <Text variant="caption" style={[styles.rowMetaText, { color: palette.text.tertiary }]}>
                {row.avgDailySales.toFixed(2)} шт/день · остаток {row.currentStock}
              </Text>
            </View>
            <View style={styles.rowTrailing}>
              <Text style={[styles.rowAmount, { color: palette.text.primary }]}>{row.daysOfStock} дн.</Text>
              <Text variant="caption" style={[styles.rowAmountCap, { color: palette.text.tertiary }]}>
                запаса
              </Text>
            </View>
          </View>
        ))
      )}
    </AnimatedCard>
  );
}

// ────────────────────────────────────────────────────────────────────────
// 11. GMROI
// ────────────────────────────────────────────────────────────────────────

function GmroiCard({
  summary,
  palette,
  index,
}: {
  summary?: WarehouseSummary;
  palette: ReturnType<typeof useColors>;
  index: number;
}) {
  if (!summary) return null;
  const g = summary.gmroi;
  const label = g > 3 ? 'Отличный результат' : g >= 1.5 ? 'Норма' : 'Низко';
  const fg = g > 3 ? colors.green[700] : g >= 1.5 ? colors.amber[700] : colors.red[700];
  const bg = g > 3 ? colors.green[50] : g >= 1.5 ? colors.amber[50] : colors.red[50];

  return (
    <AnimatedCard
      index={index}
      style={[
        styles.sectionCard,
        { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
      ]}
    >
      <Text style={[iosSectionLabel, { color: palette.text.tertiary }]}>💎 GMROI</Text>
      <View style={styles.gmroiRow}>
        <Text style={[styles.gmroiValue, { color: palette.text.primary }]}>{g.toFixed(2)}</Text>
        <View style={[styles.gmroiVerdict, { backgroundColor: bg }]}>
          <Text style={[styles.gmroiVerdictText, { color: fg }]}>{label}</Text>
        </View>
      </View>
      <Text style={[styles.cardCaption, { color: palette.text.tertiary }]}>
        Сколько прибыли приносит каждый рубль в товаре. Средняя маржа: {summary.avgMargin.toFixed(1)}%
      </Text>
    </AnimatedCard>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Styles
// ────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scrollContent: {
    padding: spacing[4],
    gap: spacing[3],
  },

  // Period segmented control (trailing in header)
  segWrap: {
    flexDirection: 'row',
    backgroundColor: colors.gray[100],
    borderRadius: 999,
    padding: 2,
    gap: 2,
  },
  segItem: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    minWidth: 56,
    alignItems: 'center',
  },
  segItemText: {
    fontSize: 12,
    letterSpacing: -0.1,
  },

  // Warehouse chips row
  whChipsRow: {
    flexDirection: 'row',
    gap: spacing[2],
    paddingVertical: spacing[1],
    paddingHorizontal: 2,
  },
  whChip: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1.5],
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: colors.white,
  },
  whChipText: {
    fontSize: 13,
  },

  // Freshness badge row
  freshnessRow: {
    alignItems: 'flex-end',
    marginTop: -spacing[1.5],
    marginBottom: -spacing[1],
  },

  // ── 1. Hero card ──
  heroCard: {
    ...iosCard,
    paddingVertical: spacing[4],
    paddingHorizontal: spacing[4],
  },
  heroHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing[2],
  },
  heroValue: {
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: -0.8,
  },
  heroCaption: {
    fontSize: fontSize.sm,
    marginTop: 2,
  },
  heroSpark: {
    marginTop: spacing[3],
    marginBottom: spacing[2],
    height: 56,
    overflow: 'hidden',
  },
  heroExplain: {
    fontSize: 12,
    marginTop: 2,
  },

  // Delta pill (Hero header trailing)
  deltaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  deltaPillText: {
    fontSize: 11,
    fontWeight: '700',
  },

  // ── 2. Dynamics card ──
  sectionCard: {
    ...iosCard,
    paddingVertical: spacing[4],
    paddingHorizontal: spacing[4],
  },
  dynamicsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[2],
    marginTop: spacing[1],
    marginBottom: spacing[2],
  },
  dynamicsCol: {
    flex: 1,
    minWidth: 0,
  },
  dynamicsLabel: {
    fontSize: 11,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  dynamicsValue: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    marginTop: 2,
  },
  dynamicsArrowCol: {
    alignItems: 'center',
    paddingHorizontal: spacing[2],
  },
  dynamicsArrowLabel: {
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },

  // Generic row inside a section card
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing[2.5],
    gap: spacing[3],
  },
  rowMain: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  rowMetaInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginTop: 4,
  },
  rowMetaText: {
    fontSize: 11,
  },
  rowTrailing: {
    alignItems: 'flex-end',
  },
  rowAmount: {
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  rowAmountCap: {
    fontSize: 10,
    marginTop: 1,
  },

  // Rank bubble for top-N rows
  rankBubble: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankBubbleText: {
    fontSize: 11,
    fontWeight: '700',
  },

  // Urgency badge for reorder list
  urgencyBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  urgencyBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.2,
  },

  // Card subtitle (small caption between title and rows)
  cardSubtitle: {
    fontSize: 12,
    marginTop: -spacing[1],
    marginBottom: spacing[1],
  },

  // Caption / explanation under a section
  cardCaption: {
    fontSize: 11,
    marginTop: spacing[2.5],
    lineHeight: 16,
  },

  // ABC bars
  abcRow: {
    marginTop: spacing[2.5],
  },
  abcLabelCol: {
    marginBottom: spacing[1.5],
  },
  abcLabel: {
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  abcCount: {
    fontSize: 11,
    marginTop: 1,
  },
  abcBarTrack: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  abcBarFill: {
    height: '100%',
    borderRadius: 4,
  },

  // Dead-stock chips
  deadStockRow: {
    flexDirection: 'row',
    gap: spacing[2],
    marginTop: spacing[2],
  },
  deadStockChip: {
    flex: 1,
    paddingVertical: spacing[2.5],
    paddingHorizontal: spacing[2],
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    gap: 2,
  },
  deadStockChipLabel: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  deadStockChipCount: {
    fontSize: fontSize.lg,
    fontWeight: '700',
  },
  deadStockChipValue: {
    fontSize: 11,
    fontWeight: '500',
  },

  // Category margin bars
  categoryRow: {
    marginTop: spacing[3],
  },
  categoryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing[1.5],
  },
  categoryName: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    flex: 1,
    marginRight: spacing[2],
  },
  categoryPct: {
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  categoryBarTrack: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  categoryBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  categoryCaption: {
    fontSize: 11,
    marginTop: spacing[1],
  },

  // GMROI
  gmroiRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    marginTop: spacing[1.5],
  },
  gmroiValue: {
    fontSize: 38,
    fontWeight: '800',
    letterSpacing: -1,
  },
  gmroiVerdict: {
    paddingHorizontal: spacing[2.5],
    paddingVertical: 4,
    borderRadius: 999,
  },
  gmroiVerdictText: {
    fontSize: 12,
    fontWeight: '700',
  },
});
