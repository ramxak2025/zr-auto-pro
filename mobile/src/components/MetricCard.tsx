/**
 * MetricCard — Revolut / Monzo / Mercury-style hero metric.
 *
 *  ▸ Label (uppercase tracked)
 *  ▸ Big animated count-up value (tabular nums, no layout jitter)
 *  ▸ Optional trend delta pill (%), green / red / neutral
 *  ▸ Optional sub caption under the number
 *
 * Runs on Reanimated 4 — the count-up uses a SharedValue + useDerivedValue
 * and drives a Text via `AnimatedTextInput` (the textbook Reanimated-native
 * pattern because <Text> isn't driven by nativeAnimatedModule out of the box).
 */
import React from 'react';
import { StyleSheet, TextInput, View, ViewStyle } from 'react-native';
import Animated, {
  useAnimatedProps,
  useDerivedValue,
  useSharedValue,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { shadow } from '../platform/shadow';
import { Text } from '../platform/Typography';
import { colors } from '../theme';

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

export interface MetricCardProps {
  label: string;
  value: number;
  format?: (v: number) => string;
  /** Caption under the big number. */
  caption?: string;
  /** Positive / negative delta, in %. */
  deltaPercent?: number;
  style?: ViewStyle;
}

const defaultMoneyFormat = (v: number): string => {
  const rounded = Math.round(v);
  return `${rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} ₽`;
};

export function MetricCard({
  label,
  value,
  format = defaultMoneyFormat,
  caption,
  deltaPercent,
  style,
}: MetricCardProps) {
  // Count-up animation
  const progress = useSharedValue(0);
  const target = useSharedValue(value);

  React.useEffect(() => {
    target.value = value;
    progress.value = 0;
    progress.value = withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) });
  }, [value, progress, target]);

  const display = useDerivedValue(() => progress.value * target.value, [progress, target]);

  const textProps = useAnimatedProps(() => {
    return { text: format(display.value) } as unknown as { text: string };
  });

  const deltaColor =
    deltaPercent === undefined ? colors.gray[400] :
    deltaPercent > 0 ? colors.green[600] :
    deltaPercent < 0 ? colors.red[500] :
    colors.gray[500];

  const deltaBg =
    deltaPercent === undefined ? 'transparent' :
    deltaPercent > 0 ? colors.green[50] :
    deltaPercent < 0 ? colors.red[50] :
    colors.gray[100];

  return (
    <View style={[styles.card, shadow('md'), style]}>
      <View style={styles.row}>
        <Text variant="label" color={colors.gray[500]}>
          {label}
        </Text>
        {deltaPercent !== undefined && (
          <View style={[styles.deltaPill, { backgroundColor: deltaBg }]}>
            <Text variant="caption" color={deltaColor} style={styles.deltaText}>
              {deltaPercent > 0 ? '+' : ''}{deltaPercent.toFixed(1)}%
            </Text>
          </View>
        )}
      </View>

      <AnimatedTextInput
        editable={false}
        underlineColorAndroid="transparent"
        allowFontScaling
        style={styles.bigValue}
        // @ts-expect-error — Reanimated text-via-TextInput pattern
        animatedProps={textProps}
        value={format(value)}
      />

      {caption ? (
        <Text variant="footnote" color={colors.gray[500]} style={{ marginTop: 2 }}>
          {caption}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderRadius: 20,
    padding: 18,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  deltaPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  deltaText: {
    fontWeight: '600',
    letterSpacing: 0.2,
    textTransform: 'none',
  },
  bigValue: {
    marginTop: 10,
    fontSize: 28,
    fontWeight: '700',
    color: colors.gray[900],
    letterSpacing: -0.5,
    padding: 0,
    // tabular-nums prevents width jitter while animating
    fontVariant: ['tabular-nums'],
  },
});
