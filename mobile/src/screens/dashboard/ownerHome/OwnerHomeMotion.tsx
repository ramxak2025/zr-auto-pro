import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useColors } from '../../../contexts/ThemeContext';
import { ownerComparisonBars, ownerMoney } from './ownerHomeState';

/** Incoming-only: React removes the old instance immediately. There is deliberately no exiting/layout animation. */
export function OwnerHomeAmount({
  value,
  reducedMotion,
  compact = false,
}: {
  value: number;
  reducedMotion: boolean;
  compact?: boolean;
}) {
  const progress = useSharedValue(reducedMotion ? 1 : 0);
  useEffect(() => {
    cancelAnimation(progress);
    progress.value = reducedMotion
      ? 1
      : withTiming(1, { duration: 240, easing: Easing.out(Easing.cubic), reduceMotion: ReduceMotion.System });
    return () => cancelAnimation(progress);
  }, [progress, reducedMotion]);
  const incoming = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 8 }],
  }));
  return (
    <View style={styles.amountMask}>
      <Animated.Text style={[styles.amount, compact && styles.monthAmount, incoming]}>
        {ownerMoney(value)}
      </Animated.Text>
    </View>
  );
}

export function OwnerHomeComparisonBars({
  current,
  previous,
  reducedMotion,
}: {
  current: number;
  previous: number;
  reducedMotion: boolean;
}) {
  const ratios = ownerComparisonBars(current, previous);
  const currentWidth = useSharedValue(reducedMotion ? (ratios?.current ?? 0) : 0);
  const previousWidth = useSharedValue(reducedMotion ? (ratios?.previous ?? 0) : 0);
  const currentRatio = ratios?.current ?? 0;
  const previousRatio = ratios?.previous ?? 0;
  useEffect(() => {
    cancelAnimation(currentWidth);
    cancelAnimation(previousWidth);
    const config = { duration: 300, easing: Easing.out(Easing.cubic), reduceMotion: ReduceMotion.System };
    const instant = reducedMotion || currentRatio === 0 || previousRatio === 0;
    currentWidth.value = instant ? currentRatio : withTiming(currentRatio, config);
    previousWidth.value = instant ? previousRatio : withTiming(previousRatio, config);
    return () => {
      cancelAnimation(currentWidth);
      cancelAnimation(previousWidth);
    };
  }, [currentWidth, previousWidth, currentRatio, previousRatio, reducedMotion]);
  const currentStyle = useAnimatedStyle(() => ({ width: `${currentWidth.value * 100}%` as `${number}%` }));
  const previousStyle = useAnimatedStyle(() => ({ width: `${previousWidth.value * 100}%` as `${number}%` }));
  return (
    <View style={styles.bars} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {ratios && (
        <>
          <Animated.View style={[styles.bar, styles.currentBar, currentStyle]} />
          <Animated.View style={[styles.bar, styles.previousBar, previousStyle]} />
        </>
      )}
    </View>
  );
}

export function OwnerHomeScopeControl({
  value,
  onChange,
  reducedMotion,
}: {
  value: 'day' | 'month';
  onChange: (value: 'day' | 'month') => void;
  reducedMotion: boolean;
}) {
  const p = useColors();
  const { fontScale } = useWindowDimensions();
  const [width, setWidth] = useState(0);
  const offset = useSharedValue(0);
  const half = Math.max(0, (width - 6) / 2);
  useEffect(() => {
    cancelAnimation(offset);
    const next = value === 'month' ? half : 0;
    offset.value = reducedMotion
      ? next
      : withTiming(next, { duration: 200, easing: Easing.out(Easing.cubic), reduceMotion: ReduceMotion.System });
    return () => cancelAnimation(offset);
  }, [offset, half, value, reducedMotion]);
  const indicatorStyle = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value }] }));
  return (
    <View
      accessibilityRole="radiogroup"
      style={[styles.segment, { backgroundColor: p.bg.muted, width: 136 * Math.max(1, fontScale * 0.85) }]}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
    >
      <Animated.View
        pointerEvents="none"
        style={[styles.segmentIndicator, { backgroundColor: p.bg.card, width: half }, indicatorStyle]}
      />
      {(['day', 'month'] as const).map((period) => (
        <TouchableOpacity
          key={period}
          accessibilityRole="radio"
          accessibilityLabel={period === 'day' ? 'Клиенты за день' : 'Клиенты с начала месяца'}
          accessibilityState={{ checked: value === period }}
          onPress={() => onChange(period)}
          style={styles.segmentButton}
        >
          <Text
            style={{
              color: value === period ? p.text.primary : p.text.secondary,
              fontSize: 12,
              lineHeight: 18,
              fontWeight: value === period ? '600' : '400',
            }}
          >
            {period === 'day' ? 'За день' : 'Месяц'}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  amountMask: { overflow: 'hidden', flexShrink: 1 },
  amount: {
    fontSize: 26,
    lineHeight: 32,
    letterSpacing: -0.55,
    fontWeight: '600',
    color: '#fff',
    fontVariant: ['tabular-nums'],
  },
  monthAmount: { fontSize: 24, lineHeight: 30, letterSpacing: -0.4 },
  bars: { height: 12, gap: 4, marginTop: 6, marginBottom: 5 },
  bar: { height: 4, borderRadius: 3 },
  currentBar: { backgroundColor: '#fff' },
  previousBar: { backgroundColor: '#aac3ff' },
  segment: {
    flexDirection: 'row',
    position: 'relative',
    borderRadius: 12,
    minHeight: Platform.OS === 'android' ? 48 : 44,
    maxWidth: '100%',
  },
  segmentIndicator: { position: 'absolute', top: 3, bottom: 3, left: 3, borderRadius: 9 },
  segmentButton: {
    minHeight: Platform.OS === 'android' ? 48 : 44,
    flex: 1,
    paddingHorizontal: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
