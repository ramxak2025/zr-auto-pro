import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
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
      `${data.generatedAt}:${JSON.stringify(model.points.map((point) => [point.id, point.revenue, point.netProfit]))}`,
    [data.generatedAt, model.points],
  );
  const live = useRef({ active, signature, scope });
  live.current = { active, signature, scope };
  const innerWidth = Math.max(100, cardWidth - 28);
  const axisWidth = Math.max(45, 43 * fontScale);
  const plotWidth = Math.max(60, innerWidth - axisWidth - 8);
  const axisLayout = useMemo(() => ownerTimelineAxisLayout(model, plotWidth, fontScale), [model, plotWidth, fontScale]);
  const axisHeight = axisLayout.height;
  const chartHeight = Math.max(155, Math.max(120, 80 * fontScale) + axisHeight + 8);
  const plotHeight = chartHeight - axisHeight - 8;
  const geometry = useMemo(() => ownerPlotGeometry(model, plotWidth, plotHeight), [model, plotWidth, plotHeight]);
  const axisUnit = ownerAxisUnit(geometry.min, geometry.max);
  const selected =
    inspection?.identity === signature && inspection.index >= 0 && inspection.index < model.points.length
      ? model.points[inspection.index]
      : null;
  const stackMetrics =
    fontScale > 1.2 ||
    Math.max(ownerMoney(data.totals.revenue).length, ownerMoney(data.totals.netProfit).length) > 13 ||
    windowWidth < 370;
  const footer = data.footer,
    percentage = ownerPercentLabel(footer.comparison.mtdDelta, footer.comparison.mtd.netProfit);
  const changeColor = footer.comparison.mtdDelta.amount < 0 ? '#ffd0d2' : '#a5f0cc';

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
  const lastRevenue = geometry.revenue[geometry.revenue.length - 1],
    lastProfit = geometry.profit[geometry.profit.length - 1];
  const area =
    model.end > model.start && model.points.length > 1
      ? `${geometry.revenuePath.d} L${lastRevenue.x},${geometry.zeroY} L${geometry.revenue[0].x},${geometry.zeroY} Z`
      : '';

  return (
    <LinearGradient
      colors={p.mode === 'dark' ? ['#203f86', '#172e68'] : ['#1d50c7', '#173ca0']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.panel}
      onLayout={(event) => setCardWidth(event.nativeEvent.layout.width)}
    >
      <View style={styles.dateRow}>
        <Text style={[styles.caption, { flexShrink: 1 }]}>
          {ownerRangeLabel(data.range.from, data.range.through, data.todayDate.slice(0, 4))}
        </Text>
        <Text style={styles.caption}>
          {model.intervalLabel} · {axisUnit.label}
        </Text>
      </View>
      <Animated.View style={[styles.metrics, stackMetrics && styles.metricsStacked, contentStyle]}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={`Чистая прибыль за выбранный период ${ownerMoney(data.totals.netProfit)}. Расчёт`}
          style={stackMetrics ? styles.metricStacked : styles.metric}
          onPress={onRangeDetails}
        >
          <View style={styles.metricLabel}>
            <View style={[styles.dot, { backgroundColor: '#a5f0cc' }]} />
            <Text style={styles.caption}>Чистая прибыль</Text>
          </View>
          <Text style={styles.profitValue}>{ownerMoney(data.totals.netProfit)}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={`Оборот за выбранный период ${ownerMoney(data.totals.revenue)}. Расчёт`}
          style={stackMetrics ? styles.metricStacked : styles.metric}
          onPress={onRangeDetails}
        >
          <View style={styles.metricLabel}>
            <View style={[styles.dot, { backgroundColor: '#e9f1ff' }]} />
            <Text style={styles.caption}>Оборот</Text>
          </View>
          <Text style={styles.revenueValue}>{ownerMoney(data.totals.revenue)}</Text>
        </TouchableOpacity>
      </Animated.View>
      <GestureDetector gesture={gesture}>
        <View
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={`График оборота и чистой прибыли ${model.intervalLabel.toLowerCase()}`}
          accessibilityValue={{
            text: selected
              ? `${selected.label}. Оборот ${ownerMoney(selected.revenue)}. Прибыль ${ownerMoney(selected.netProfit)}`
              : `За период: оборот ${ownerMoney(data.totals.revenue)}, прибыль ${ownerMoney(data.totals.netProfit)}`,
          }}
          accessibilityActions={[
            { name: 'increment', label: 'Следующий интервал' },
            { name: 'decrement', label: 'Предыдущий интервал' },
          ]}
          onAccessibilityAction={(event) => accessibilityInspect(event.nativeEvent.actionName === 'increment' ? 1 : -1)}
          style={{ height: chartHeight, marginTop: 13 }}
        >
          <Svg width={innerWidth} height={chartHeight}>
            <Defs>
              <SvgGradient id="owner-timeline-fill" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#e9f1ff" stopOpacity={0.12} />
                <Stop offset="1" stopColor="#e9f1ff" stopOpacity={0} />
              </SvgGradient>
            </Defs>
            <G transform="translate(4,4)">
              {geometry.ticks.map((tick) => (
                <Line
                  key={tick.value}
                  x1={0}
                  x2={plotWidth}
                  y1={tick.y}
                  y2={tick.y}
                  stroke={tick.value === 0 ? 'rgba(255,255,255,.28)' : 'rgba(255,255,255,.14)'}
                  strokeWidth={1}
                  strokeDasharray="3 5"
                />
              ))}
              {area ? <AnimatedPath d={area} fill="url(#owner-timeline-fill)" animatedProps={areaProps} /> : null}
              <AnimatedPath
                d={geometry.revenuePath.d}
                fill="none"
                stroke="#e9f1ff"
                strokeWidth={2.6}
                strokeLinecap="round"
                strokeDasharray={[geometry.revenuePath.length || 1, geometry.revenuePath.length || 1]}
                animatedProps={revenueStroke}
              />
              <AnimatedPath
                d={geometry.profitPath.d}
                fill="none"
                stroke="#a5f0cc"
                strokeWidth={2.8}
                strokeLinecap="round"
                strokeDasharray={[geometry.profitPath.length || 1, geometry.profitPath.length || 1]}
                animatedProps={profitStroke}
              />
              <Line
                x1={lastRevenue.x}
                x2={lastRevenue.x}
                y1={0}
                y2={plotHeight}
                stroke="rgba(255,255,255,.23)"
                strokeWidth={1}
                strokeDasharray="3 5"
              />
              <AnimatedCircle
                cx={lastRevenue.x}
                cy={lastRevenue.y}
                r={4}
                fill={p.mode === 'dark' ? '#203f86' : '#2254d5'}
                stroke="#e9f1ff"
                strokeWidth={2.5}
                animatedProps={endpoint}
              />
              <AnimatedCircle cx={lastProfit.x} cy={lastProfit.y} r={4} fill="#a5f0cc" animatedProps={endpoint} />
              <AnimatedLine
                y1={0}
                y2={plotHeight}
                stroke="rgba(255,255,255,.65)"
                strokeWidth={1}
                animatedProps={lineProps}
              />
              <AnimatedCircle fill="#e9f1ff" animatedProps={revenueHalo} />
              <AnimatedCircle fill="#a5f0cc" animatedProps={profitHalo} />
              <AnimatedCircle r={4.5} fill="#1b44ad" stroke="#e9f1ff" strokeWidth={2} animatedProps={revenueDot} />
              <AnimatedCircle r={4.5} fill="#a5f0cc" animatedProps={profitDot} />
            </G>
          </Svg>
          {geometry.ticks.map((tick) => (
            <Text
              key={tick.value}
              style={[
                styles.axis,
                { right: 0, top: Math.max(0, tick.y + 4 - 8 * fontScale), width: axisWidth - 2, textAlign: 'right' },
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
          {selected && (
            <View pointerEvents="none" style={styles.tooltip}>
              <Text style={styles.tooltipDate}>{selected.label}</Text>
              <Text style={styles.tooltipMoney}>Оборот {ownerMoney(selected.revenue)}</Text>
              <Text style={[styles.tooltipMoney, { color: '#a5f0cc' }]}>Прибыль {ownerMoney(selected.netProfit)}</Text>
            </View>
          )}
        </View>
      </GestureDetector>
      <View style={styles.footer}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={`Прибыль с начала месяца ${ownerMoney(footer.current.mtd.netProfit)}. ${ownerRangeLabel(footer.current.period.from, footer.current.period.through)}. Открыть месячный расчёт`}
          onPress={onMonthDetails}
          style={[styles.footerContent, fontScale > 1.2 && styles.footerStacked]}
        >
          <View style={fontScale > 1.2 ? { alignSelf: 'stretch', minWidth: 0 } : { flex: 1, minWidth: 0 }}>
            <Text style={styles.caption}>Прибыль с начала месяца</Text>
            <Text style={styles.footerValue}>{ownerMoney(footer.current.mtd.netProfit)}</Text>
            <Text style={styles.caption}>Пересчёт · текущий план</Text>
          </View>
          <View style={[styles.footerComparison, fontScale > 1.2 && { maxWidth: '100%', alignItems: 'flex-start' }]}>
            <View style={styles.change}>
              <Ionicons
                name={
                  footer.comparison.mtdDelta.amount < 0
                    ? 'trending-down-outline'
                    : footer.comparison.mtdDelta.amount > 0
                      ? 'trending-up-outline'
                      : 'remove-outline'
                }
                size={13}
                color={changeColor}
              />
              <Text style={[styles.changeText, { color: changeColor }]}>
                {percentage ??
                  `${footer.comparison.mtdDelta.amount > 0 ? '+' : ''}${ownerMoney(footer.comparison.mtdDelta.amount)}`}
              </Text>
            </View>
            <Text style={[styles.caption, { textAlign: 'right' }]}>
              к{' '}
              {ownerRangeLabel(
                footer.comparison.period.from,
                footer.comparison.period.through,
                footer.todayDate.slice(0, 4),
              )}
            </Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Как построен график и рассчитана прибыль"
          onPress={onInfo}
          style={styles.info}
        >
          <Ionicons name="information-circle-outline" size={20} color="#d8e6ff" />
        </TouchableOpacity>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  panel: { borderRadius: 21, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 2 },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 10,
    flexWrap: 'wrap',
  },
  caption: { fontSize: 12, lineHeight: 16, color: '#d8e6ff' },
  metrics: { flexDirection: 'row', gap: 12 },
  metricsStacked: { flexDirection: 'column' },
  metric: { flex: 1, minWidth: 0, minHeight: touchSize, paddingVertical: 2 },
  metricStacked: { minWidth: 0, minHeight: touchSize, paddingVertical: 2 },
  metricLabel: { flexDirection: 'row', gap: 5, alignItems: 'center' },
  dot: { width: 6, height: 6, borderRadius: 3 },
  profitValue: {
    fontSize: 26,
    lineHeight: 33,
    fontWeight: '600',
    color: '#fff',
    letterSpacing: -0.4,
    fontVariant: ['tabular-nums'],
    marginTop: 4,
  },
  revenueValue: {
    fontSize: 24,
    lineHeight: 33,
    fontWeight: '600',
    color: '#fff',
    letterSpacing: -0.4,
    fontVariant: ['tabular-nums'],
    marginTop: 4,
  },
  axis: { position: 'absolute', fontSize: 12, lineHeight: 16, color: '#c9daff', fontVariant: ['tabular-nums'] },
  tooltip: {
    position: 'absolute',
    left: 4,
    right: 4,
    top: 0,
    zIndex: 3,
    backgroundColor: '#102b6d',
    borderRadius: 10,
    padding: 10,
  },
  tooltipDate: { color: '#d8e6ff', fontSize: 12, lineHeight: 17, marginBottom: 3 },
  tooltipMoney: { color: '#fff', fontSize: 13, lineHeight: 19, fontWeight: '500', fontVariant: ['tabular-nums'] },
  footer: {
    minHeight: 78,
    paddingTop: 9,
    paddingBottom: 9,
    marginTop: 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,.15)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  footerContent: { flex: 1, minWidth: 0, minHeight: touchSize, flexDirection: 'row', alignItems: 'center', gap: 8 },
  footerStacked: { flexDirection: 'column', alignItems: 'stretch', gap: 7 },
  footerValue: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '600',
    color: '#fff',
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.3,
    marginVertical: 3,
  },
  footerComparison: { maxWidth: '45%', alignItems: 'flex-end', gap: 3 },
  change: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 3,
    backgroundColor: 'rgba(0,0,0,.12)',
    borderRadius: 7,
  },
  changeText: { fontSize: 12, lineHeight: 17, fontWeight: '600' },
  info: { width: touchSize, height: touchSize, alignItems: 'center', justifyContent: 'center' },
});
