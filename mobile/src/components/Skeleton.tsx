/**
 * Skeleton — shimmering placeholder.
 *
 * Shimmer is a gradient sweeping horizontally across a muted base. Runs on
 * Reanimated 4 worklets so it stays at 60 fps even with dozens of
 * placeholders visible (product lists, client lists).
 *
 * Use via `<Skeleton width={..} height={..} radius={..} />`. If you render
 * many in a row, prefer a parent `<SkeletonGroup />` so all shimmers share a
 * single shared value.
 */
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

interface SkeletonProps {
  width?: number | `${number}%`;
  height?: number;
  radius?: number;
  style?: object;
}

export function Skeleton({ width = '100%', height = 16, radius = 6, style }: SkeletonProps) {
  const progress = useSharedValue(-1);

  // Kick off once, run forever
  React.useEffect(() => {
    progress.value = withRepeat(
      withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
      -1,
      false,
    );
  }, [progress]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.value * 200 }],
  }));

  return (
    <View
      style={[
        {
          width: width as number,
          height,
          borderRadius: radius,
          overflow: 'hidden',
          backgroundColor: '#EEF0F3',
        },
        style,
      ]}
    >
      <Animated.View style={[StyleSheet.absoluteFill, animatedStyle]}>
        <LinearGradient
          colors={['transparent', 'rgba(255,255,255,0.85)', 'transparent']}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
    </View>
  );
}

/** Convenience — a list-row skeleton matching the 56-pt list rows in the app. */
export function SkeletonRow() {
  return (
    <View style={styles.row}>
      <Skeleton width={44} height={44} radius={22} />
      <View style={{ marginLeft: 12, flex: 1, gap: 8 }}>
        <Skeleton width={'70%'} height={13} radius={4} />
        <Skeleton width={'45%'} height={11} radius={4} />
      </View>
      <Skeleton width={60} height={12} radius={4} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#fff',
    borderRadius: 16,
    marginHorizontal: 16,
    marginBottom: 8,
  },
});
