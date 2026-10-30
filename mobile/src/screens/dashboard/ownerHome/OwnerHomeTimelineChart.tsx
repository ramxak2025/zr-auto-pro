import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, Defs, G, Line, LinearGradient as SvgGradient, Path, Stop } from 'react-native-svg';
import Animated, {
  cancelAnimation,
  Easing,
  ReduceMotion,
  runOnJS,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Ionicons from '../../../components/icons/IoniconsShim';
import { useColors } from '../../../contexts/ThemeContext';
import type { OwnerHomeTimeline } from '../../../../../shared/types/ownerHome';
import { ownerMoney, ownerPercentLabel, ownerRangeLabel, type OwnerHomeScope } from './ownerHomeState';
import {
  nearestOwnerPoint,
  ownerAxisLabel,
  ownerAxisUnit,
  ownerTimelineAxisLayout,
  ownerPlotGeometry,
  type OwnerTimelineModel,
} from './ownerHomeTimelineModel';
import { startOwnerHomeSequence } from './ownerHomeSequence';
import { useOwnerTimelineClients } from './ownerHomeTimelineClients';
import { ownerTimelineReadoutLabel } from './ownerHomeTimelineReadout';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedLine = Animated.createAnimatedComponent(Line);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const touchSize = Platform.OS === 'android' ? 48 : 44;

export default function OwnerHomeTimelineChart({
  data,
  model,
  scope,
  active,
  reducedMotion,
  onRangeDetails,
  onMonthDetails,
  onInfo,
}: {
  data: OwnerHomeTimeline;
  model: OwnerTimelineModel;
  scope: OwnerHomeScope;
  active: boolean;
  reducedMotion: boolean;
  onRangeDetails: () => void;
  onMonthDetails: () => void;
  onInfo: () => void;
}) {
  const p = useColors(),
    { width: windowWidth, fontScale } = useWindowDimensions();
  const revenueColor = p.accent.primary,
    profitColor = p.mode === 'dark' ? '#64d5ad' : '#0d9472';
  const [cardWidth, setCardWidth] = useState(Math.max(260, windowWidth - 34));
  const [inspection, setInspection] = useState<{ identity: string; index: number } | null>(null);
  const content = useSharedValue(reducedMotion ? 1 : 0),
    draw = useSharedValue(reducedMotion ? 1 : 0),
    fill = useSharedValue(reducedMotion ? 1 : 0),
    focus = useSharedValue(1);
  const selectedIndex = useSharedValue(-1),
    selectedIdentity = useSharedValue('');
  const revealed = useRef(false);
  const signature = useMemo(
    () =>
      `${JSON.stringify(scope.key)}:${model.identity}:${data.generatedAt}:${JSON.stringify(model.points.map((point) => [point.id, point.revenue, point.netProfit]))}`,
    [scope.key, model.identity, data.generatedAt, model.points],
  );
  const live = useRef({ active, signature, scope });
  live.current = { active, signature, scope };
  const innerWidth = Math.max(100, cardWidth - 28);
  const axisWidth = Math.max(45, 43 * fontScale);
  const plotWidth = Math.max(60, innerWidth - axisWidth - 8);
  const axisLayout = useMemo(() => ownerTimelineAxisLayout(model, plotWidth, fontScale), [model, plotWidth, fontScale]);
  const axisHeight = axisLayout.height;
  const plotHeight = Math.max(180, 80 * fontScale);
  const chartHeight = plotHeight + axisHeight + 8;
  const geometry = useMemo(() => ownerPlotGeometry(model, plotWidth, plotHeight), [model, plotWidth, plotHeight]);
  const axisUnit = ownerAxisUnit(geometry.min, geometry.max);
  const selected =
    active &&
    scope.isCurrent() &&
    inspection?.identity === signature &&
    inspection.index >= 0 &&
    inspection.index < model.points.length
      ? model.points[inspection.index]
      : null;
  const clients = useOwnerTimelineClients(data, selected, scope, active);
  const revenue = selected?.revenue ?? data.totals.revenue,
    netProfit = selected?.netProfit ?? data.totals.netProfit;
  // Use the whole series when choosing the layout so scrubbing never moves the readout.
  const longestMoney = Math.max(
    ...[data.totals, ...model.points].flatMap((point) => [
      ownerMoney(point.revenue).length,
      ownerMoney(point.netProfit).length,
    ]),
  );
  const stackMetrics = fontScale > 1.2 || longestMoney > 14 || innerWidth < 310;
  const footer = data.footer,
    percentage = ownerPercentLabel(footer.comparison.mtdDelta, footer.comparison.mtd.netProfit);
  const changeColor = footer.comparison.mtdDelta.amount < 0 ? (p.mode === 'dark' ? '#f1a8ae' : '#b83d49') : profitColor;
  const changeLabel =
    percentage ?? `${footer.comparison.mtdDelta.amount > 0 ? '+' : ''}${ownerMoney(footer.comparison.mtdDelta.amount)}`;
  const comparisonLabel = ownerRangeLabel(
    footer.comparison.period.from,
    footer.comparison.period.through,
    footer.todayDate.slice(0, 4),
  );

  useEffect(() => {
    setInspection(null);
    selectedIndex.value = -1;
    selectedIdentity.value = '';
  }, [active, signature, selectedIndex, selectedIdentity]);

  useEffect(() => {
    cancelAnimation(content);
    cancelAnimation(draw);
    cancelAnimation(fill);
    if (!active || reducedMotion || revealed.current) {
      content.value = 1;
      draw.value = 1;
      fill.value = 1;
      return;
    }
    revealed.current = true;
    const stop = startOwnerHomeSequence({
      reducedMotion,
      isCurrent: () => live.current.active && live.current.scope.isCurrent(),
      reveal: () => {
        content.value = withTiming(1, {
          duration: 220,
          easing: Easing.out(Easing.cubic),
          reduceMotion: ReduceMotion.System,
        });
      },
      draw: () => {
        draw.value = withTiming(1, {
          duration: 720,
          easing: Easing.out(Easing.cubic),
          reduceMotion: ReduceMotion.System,
        });
      },
      settle: () => {
        fill.value = withTiming(1, {
          duration: 320,
          easing: Easing.out(Easing.cubic),
          reduceMotion: ReduceMotion.System,
        });
      },
    });
    return () => {
      stop();
      cancelAnimation(content);
      cancelAnimation(draw);
      cancelAnimation(fill);
      cancelAnimation(focus);
    };
  }, [active, reducedMotion, model.identity, content, draw, fill, focus]);
  const contentStyle = useAnimatedStyle(() => ({
    opacity: content.value,
    transform: [{ translateY: (1 - content.value) * 6 }],
  }));
  const revenueStroke = useAnimatedProps(() => ({ strokeDashoffset: geometry.revenuePath.length * (1 - draw.value) }));
  const profitStroke = useAnimatedProps(() => ({ strokeDashoffset: geometry.profitPath.length * (1 - draw.value) }));
  const endpoint = useAnimatedProps(() => ({ opacity: Math.max(0, (draw.value - 0.75) * 4) }));
  const areaProps = useAnimatedProps(() => ({ opacity: fill.value }));
  const lineProps = useAnimatedProps(() => {
    const i = selectedIndex.value,
      valid = active && selectedIdentity.value === signature && i >= 0 && i < geometry.xs.length;
    const x = valid ? geometry.xs[i] : 0;
    return { x1: x, x2: x, opacity: valid ? 1 : 0 };
  });
  const revenueDot = useAnimatedProps(() => {
    const i = selectedIndex.value,
      valid = active && selectedIdentity.value === signature && i >= 0 && i < geometry.revenue.length;
    return { cx: valid ? geometry.revenue[i].x : 0, cy: valid ? geometry.revenue[i].y : 0, opacity: valid ? 1 : 0 };
  });
  const profitDot = useAnimatedProps(() => {
    const i = selectedIndex.value,
      valid = active && selectedIdentity.value === signature && i >= 0 && i < geometry.profit.length;
    return { cx: valid ? geometry.profit[i].x : 0, cy: valid ? geometry.profit[i].y : 0, opacity: valid ? 1 : 0 };
  });
  const revenueHalo = useAnimatedProps(() => {
    const i = selectedIndex.value,
      valid = active && selectedIdentity.value === signature && i >= 0 && i < geometry.revenue.length;
    return {
      cx: valid ? geometry.revenue[i].x : 0,
      cy: valid ? geometry.revenue[i].y : 0,
      r: 5 + focus.value * 6,
      opacity: valid ? 0.17 * focus.value : 0,
    };
  });
  const profitHalo = useAnimatedProps(() => {
    const i = selectedIndex.value,
      valid = active && selectedIdentity.value === signature && i >= 0 && i < geometry.profit.length;
    return {
      cx: valid ? geometry.profit[i].x : 0,
      cy: valid ? geometry.profit[i].y : 0,
      r: 5 + focus.value * 6,
      opacity: valid ? 0.2 * focus.value : 0,
    };
  });
  const inspect = useCallback((index: number, identity: string) => {
    if (live.current.active && live.current.scope.isCurrent() && identity === live.current.signature)
      setInspection(index < 0 ? null : { identity, index });
  }, []);
  const gesture = useMemo(() => {
    const move = (x: number, toggle = false) => {
      'worklet';
      const next = nearestOwnerPoint(geometry.xs, Math.max(0, Math.min(plotWidth, x - 4)));
      const index = toggle && selectedIdentity.value === signature && selectedIndex.value === next ? -1 : next;
      const identityChanged = selectedIdentity.value !== signature;
      selectedIdentity.value = signature;
      if (index !== selectedIndex.value || identityChanged) {
        selectedIndex.value = index;
        cancelAnimation(focus);
        focus.value = reducedMotion ? 1 : 0;
        if (!reducedMotion)
          focus.value = withTiming(1, {
            duration: 220,
            easing: Easing.out(Easing.cubic),
            reduceMotion: ReduceMotion.System,
          });
        runOnJS(inspect)(index, signature);
      }
    };
    const pan = Gesture.Pan()
      .maxPointers(1)
      .activeOffsetX([-7, 7])
      .failOffsetY([-12, 12])
      .enabled(active && model.points.length > 0)
      .onStart((event) => move(event.x))
      .onUpdate((event) => move(event.x))
      .onEnd((event) => move(event.x));
    const tap = Gesture.Tap()
      .enabled(active && model.points.length > 0)
      .onEnd((event, success) => {
        if (success) move(event.x, true);
      });
    return Gesture.Exclusive(pan, tap);
  }, [
    active,
    model.points.length,
    geometry.xs,
    plotWidth,
    signature,
    selectedIndex,
    selectedIdentity,
    inspect,
    focus,
    reducedMotion,
  ]);
  const accessibilityInspect = (direction: number) => {
    const current = inspection?.identity === signature ? inspection.index : -1;
    const index = Math.max(0, Math.min(model.points.length - 1, current + direction));
    selectedIdentity.value = signature;
    selectedIndex.value = index;
    inspect(index, signature);
  };
  const clearInspection = () => {
    if (!live.current.active || !live.current.scope.isCurrent() || live.current.signature !== signature) return;
    selectedIndex.value = -1;
    selectedIdentity.value = signature;
    setInspection(null);
  };
  const lastRevenue = geometry.revenue[geometry.revenue.length - 1],
    lastProfit = geometry.profit[geometry.profit.length - 1];
  const revenueArea =
    model.end > model.start && model.points.length > 1
      ? `${geometry.revenuePath.d} L${lastRevenue.x},${geometry.zeroY} L${geometry.revenue[0].x},${geometry.zeroY} Z`
      : '';
  const profitArea =
    model.end > model.start && model.points.length > 1
      ? `${geometry.profitPath.d} L${lastProfit.x},${geometry.zeroY} L${geometry.profit[0].x},${geometry.zeroY} Z`
      : '';
  // Both signed areas fade toward the true zero line, including below-zero intervals.
  const fillStops = [
    ...(geometry.zeroY > 0 ? [{ offset: 0, opacity: 0.3 }] : []),
    { offset: geometry.zeroY / plotHeight, opacity: 0.015 },
    ...(geometry.zeroY < plotHeight ? [{ offset: 1, opacity: 0.27 }] : []),
  ];
  const periodLabel = ownerRangeLabel(data.range.from, data.range.through, data.todayDate.slice(0, 4));
  const readoutLabel = selected ? ownerTimelineReadoutLabel(data, model, selected) : periodLabel;

  return (
    <View
      style={[styles.panel, { backgroundColor: p.bg.card, borderColor: p.border.subtle }]}
      onLayout={(event) => setCardWidth(event.nativeEvent.layout.width)}
    >
      <View style={styles.chartHeading}>
        <Text style={[styles.caption, { color: p.text.secondary }]}>{model.intervalLabel}</Text>
        <Text style={[styles.caption, { color: p.text.secondary }]}>{axisUnit.label}</Text>
      </View>
      <GestureDetector gesture={gesture}>
        <View
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={`График оборота и чистой прибыли ${model.intervalLabel.toLowerCase()}`}
          accessibilityHint="Выберите интервал. Значения появятся под графиком. Повторное нажатие сбрасывает выбор."
          accessibilityValue={{
            text: selected
              ? `${selected.label}. Оборот ${ownerMoney(selected.revenue)}. Чистая прибыль ${ownerMoney(selected.netProfit)}`
              : `За период: оборот ${ownerMoney(data.totals.revenue)}, чистая прибыль ${ownerMoney(data.totals.netProfit)}`,
          }}
          accessibilityActions={[
            { name: 'increment', label: 'Следующий интервал' },
            { name: 'decrement', label: 'Предыдущий интервал' },
            { name: 'activate', label: 'Сбросить выбранный интервал' },
          ]}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === 'activate') clearInspection();
            else accessibilityInspect(event.nativeEvent.actionName === 'increment' ? 1 : -1);
          }}
          style={{ height: chartHeight, marginTop: 8 }}
        >
          <Svg width={innerWidth} height={chartHeight}>
            <Defs>
              {[
                { id: 'owner-turnover-area', color: revenueColor },
                { id: 'owner-profit-area', color: profitColor },
              ].map(({ id, color }) => (
                <SvgGradient id={id} key={id} gradientUnits="userSpaceOnUse" x1={0} y1={0} x2={0} y2={plotHeight}>
                  {fillStops.map((stop) => (
                    <Stop key={stop.offset} offset={stop.offset} stopColor={color} stopOpacity={stop.opacity} />
                  ))}
                </SvgGradient>
              ))}
            </Defs>
            <G transform="translate(4,4)">
              {geometry.ticks.map((tick) => (
                <Line
                  key={tick.value}
                  x1={0}
                  x2={plotWidth}
                  y1={tick.y}
                  y2={tick.y}
                  stroke={tick.value === 0 ? p.border.strong : p.border.subtle}
                  strokeWidth={1}
                  strokeDasharray={tick.value === 0 ? undefined : '3 5'}
                />
              ))}
              {revenueArea ? (
                <AnimatedPath d={revenueArea} fill="url(#owner-turnover-area)" animatedProps={areaProps} />
              ) : null}
              {profitArea ? (
                <AnimatedPath d={profitArea} fill="url(#owner-profit-area)" animatedProps={areaProps} />
              ) : null}
              <AnimatedPath
                d={geometry.revenuePath.d}
                fill="none"
                stroke={revenueColor}
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeDasharray={[geometry.revenuePath.length || 1, geometry.revenuePath.length || 1]}
                animatedProps={revenueStroke}
              />
              <AnimatedPath
                d={geometry.profitPath.d}
                fill="none"
                stroke={profitColor}
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeDasharray={[geometry.profitPath.length || 1, geometry.profitPath.length || 1]}
                animatedProps={profitStroke}
              />
              <AnimatedCircle
                cx={lastRevenue.x}
                cy={lastRevenue.y}
                r={3}
                fill={p.bg.card}
                stroke={revenueColor}
                strokeWidth={2}
                animatedProps={endpoint}
              />
              <AnimatedCircle cx={lastProfit.x} cy={lastProfit.y} r={3} fill={profitColor} animatedProps={endpoint} />
              <AnimatedLine
                y1={0}
                y2={plotHeight}
                stroke={p.text.secondary}
                strokeWidth={1}
                animatedProps={lineProps}
              />
              <AnimatedCircle fill={revenueColor} animatedProps={revenueHalo} />
              <AnimatedCircle fill={profitColor} animatedProps={profitHalo} />
              <AnimatedCircle
                r={4.5}
                fill={p.bg.card}
                stroke={revenueColor}
                strokeWidth={2}
                animatedProps={revenueDot}
              />
              <AnimatedCircle r={4.5} fill={profitColor} animatedProps={profitDot} />
            </G>
          </Svg>
          {geometry.ticks.map((tick) => (
            <Text
              key={tick.value}
              style={[
                styles.axis,
                {
                  color: p.text.secondary,
                  right: 0,
                  top: Math.max(0, tick.y + 4 - 8 * fontScale),
                  width: axisWidth - 2,
                  textAlign: 'right',
                },
              ]}
            >
              {ownerAxisLabel(tick.value, axisUnit.scale)}
            </Text>
          ))}
          {axisLayout.labels.map((tick) => (
            <Text
              key={tick.id}
              style={[
                styles.axis,
                {
                  color: p.text.secondary,
                  fontSize: axisLayout.fontSize,
                  top: plotHeight + 12 + tick.top,
                  width: tick.width,
                  left: 4 + tick.left,
                  textAlign: 'center',
                },
              ]}
            >
              {tick.label}
            </Text>
          ))}
        </View>
      </GestureDetector>
      <Animated.View testID="owner-timeline-readout" style={[styles.readout, contentStyle]}>
        <View style={[styles.readoutHeading, { minHeight: Math.max(touchSize, 34 * fontScale) }]}>
          <Text
            accessibilityLabel={selected?.label ?? periodLabel}
            style={[styles.readoutDate, { color: p.text.secondary }]}
          >
            {readoutLabel}
          </Text>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={selected ? 'Сбросить выбранный интервал' : `Расчёт за период ${periodLabel}`}
            disabled={!active || !scope.isCurrent()}
            onPress={() => {
              if (!live.current.active || !live.current.scope.isCurrent() || live.current.signature !== signature)
                return;
              if (selected) clearInspection();
              else onRangeDetails();
            }}
            style={styles.readoutAction}
          >
            <Ionicons
              name={selected ? 'close-circle-outline' : 'chevron-forward'}
              size={selected ? 21 : 16}
              color={p.accent.primaryText}
            />
          </TouchableOpacity>
        </View>
        <View style={[styles.metrics, stackMetrics && styles.metricsStacked]}>
          {[
            { label: 'Оборот', value: revenue, color: revenueColor },
            { label: 'Чистая прибыль', value: netProfit, color: profitColor },
          ].map((metric) => (
            <View key={metric.label} style={stackMetrics ? styles.metricStacked : styles.metric}>
              <View style={styles.metricLabel}>
                <View style={[styles.dot, { backgroundColor: metric.color }]} />
                <Text style={[styles.caption, { color: p.text.secondary }]}>{metric.label}</Text>
              </View>
              <Text style={[styles.money, { color: p.text.primary }]}>{ownerMoney(metric.value)}</Text>
            </View>
          ))}
        </View>
        <View style={[styles.clientsRow, { minHeight: Math.max(touchSize, 36 * fontScale) }]}>
          <Text style={[styles.clientLabel, { color: p.text.secondary, flexShrink: 1 }]}>{clients.label}</Text>
          {clients.status === 'error' ? (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Клиенты не загрузились. Повторить"
              onPress={clients.retry}
              style={styles.retry}
            >
              <Text style={[styles.clientValue, { color: p.text.secondary }]}>—</Text>
              <Ionicons name="refresh-outline" size={17} color={p.accent.primaryText} />
            </TouchableOpacity>
          ) : (
            <Text
              accessibilityRole={clients.status === 'loading' ? 'progressbar' : 'text'}
              accessibilityLabel={
                clients.count === null ? 'Число клиентов пока недоступно' : `${clients.label}: ${clients.count}`
              }
              style={[styles.clientValue, { color: p.text.primary }]}
            >
              {clients.count ?? (clients.status === 'loading' ? '…' : '—')}
            </Text>
          )}
        </View>
      </Animated.View>
      <View style={[styles.footer, { borderTopColor: p.border.subtle }]}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={`Прибыль с начала месяца ${ownerMoney(footer.current.mtd.netProfit)}. ${changeLabel} к ${comparisonLabel}. ${data.basisLabel}. Открыть месячный расчёт`}
          onPress={() => {
            if (live.current.active && live.current.scope.isCurrent() && live.current.signature === signature)
              onMonthDetails();
          }}
          style={[styles.footerContent, fontScale > 1.2 && styles.footerStacked]}
        >
          <View style={styles.footerText}>
            {model.period !== 'month' && (
              <Text style={[styles.footerContext, { color: p.text.primary }]}>
                <Text style={[styles.caption, { color: p.text.secondary }]}>Прибыль за месяц </Text>
                {ownerMoney(footer.current.mtd.netProfit)}
              </Text>
            )}
            <Text style={[styles.caption, { color: p.text.secondary }]}>
              {model.period === 'month' ? 'Прибыль к ' : 'К '}
              {comparisonLabel}
            </Text>
          </View>
          <Text style={[styles.changeText, { color: changeColor }]}>{changeLabel}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={`Как построен график и рассчитана прибыль. ${data.basisLabel}`}
          onPress={() => {
            if (live.current.active && live.current.scope.isCurrent() && live.current.signature === signature) onInfo();
          }}
          style={styles.info}
        >
          <Ionicons name="information-circle-outline" size={21} color={p.text.secondary} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    borderRadius: 21,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 2,
  },
  chartHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  caption: { fontSize: 12, lineHeight: 17 },
  axis: { position: 'absolute', fontSize: 12, lineHeight: 16, fontVariant: ['tabular-nums'] },
  readout: { marginTop: 4 },
  readoutHeading: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  readoutDate: { flex: 1, minWidth: 0, fontSize: 12, lineHeight: 17 },
  readoutAction: { width: touchSize, height: touchSize, alignItems: 'center', justifyContent: 'center' },
  metrics: { flexDirection: 'row', gap: 14 },
  metricsStacked: { flexDirection: 'column', gap: 10 },
  metric: { flex: 1, minWidth: 0 },
  metricStacked: { minWidth: 0 },
  metricLabel: { flexDirection: 'row', gap: 5, alignItems: 'center' },
  dot: { width: 6, height: 6, borderRadius: 3 },
  money: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '500',
    letterSpacing: -0.35,
    fontVariant: ['tabular-nums'],
    marginTop: 3,
  },
  clientsRow: { minHeight: touchSize, flexDirection: 'row', alignItems: 'center', columnGap: 7 },
  clientLabel: { fontSize: 13, lineHeight: 18 },
  clientValue: { fontSize: 14, lineHeight: 19, fontWeight: '500', fontVariant: ['tabular-nums'] },
  retry: { minHeight: touchSize, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 },
  footer: {
    minHeight: 57,
    paddingVertical: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  footerContent: { flex: 1, minWidth: 0, minHeight: touchSize, flexDirection: 'row', alignItems: 'center', gap: 8 },
  footerStacked: { flexDirection: 'column', alignItems: 'stretch', gap: 4 },
  footerText: { flex: 1, minWidth: 0, gap: 2 },
  footerContext: { fontSize: 13, lineHeight: 18, fontWeight: '500', fontVariant: ['tabular-nums'] },
  changeText: { flexShrink: 1, fontSize: 13, lineHeight: 18, fontWeight: '600', fontVariant: ['tabular-nums'] },
  info: { width: touchSize, height: touchSize, alignItems: 'center', justifyContent: 'center' },
});
