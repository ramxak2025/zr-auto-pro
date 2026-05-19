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
          // Subtle primary[50] tint — reads as Autexa brand instead of
          // anonymous gray.
          backgroundColor: '#eaf1fb',
        },
        style,
      ]}
    >
      <Animated.View style={[StyleSheet.absoluteFill, animatedStyle]}>
        <LinearGradient
          // White core sweep tinted with the brand blue at the edges so
          // the moving highlight feels native to Autexa rather than a
          // generic content placeholder.
          colors={['rgba(37,99,235,0)', 'rgba(255,255,255,0.95)', 'rgba(37,99,235,0)']}
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

/** N rows of SkeletonRow — drop-in for ListEmptyComponent or pre-data state.
 *  Each row appears with a slight stagger so the loading itself feels alive. */
export function ListSkeleton({ count = 6 }: { count?: number }) {
  return (
    <View>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={{ opacity: 1 - i * 0.06 }}>
          <SkeletonRow />
        </View>
      ))}
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
