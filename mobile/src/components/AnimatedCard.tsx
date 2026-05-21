import React, { useEffect, useRef, ReactNode } from 'react';
import { AccessibilityInfo, Animated, TouchableOpacity, ViewStyle } from 'react-native';

interface AnimatedCardProps {
  children: ReactNode;
  style?: ViewStyle | ViewStyle[];
  index?: number;
  onPress?: () => void;
  /**
   * Optional long-press handler. Forwarded to the underlying
   * TouchableOpacity in both skip-animation and animated branches.
   */
  onLongPress?: () => void;
  activeOpacity?: number;
  /**
   * Force-disable the entrance animation regardless of index. Use this
   * for list rows where the stagger isn't visually meaningful (the
   * user scrolls fast enough that the animation just adds work without
   * adding polish).
   */
  disableEntrance?: boolean;
}

// Cap how many rows participate in the entrance stagger. Anything past
// this index renders as a plain View — usually those rows mount only
// because the user scrolled to them, and animating each as it scrolls
// into view adds bridge work without adding polish (it actually causes
// a small visual hiccup during scroll on iPhone). Keep enough to cover
// "above the fold" on a 6.7" iPhone screen.
const STAGGER_LIMIT = 8;

// Lazily-resolved reduce-motion state. Read once at module load; if it
// flips during the session the next AnimatedCard mount picks it up.
// We can't `await` in a non-async path so we cache the latest known
// value and update on each AccessibilityInfo subscription tick.
let reduceMotionEnabled = false;
AccessibilityInfo.isReduceMotionEnabled?.()
  .then((v) => {
    reduceMotionEnabled = v;
  })
  .catch(() => {});
AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v) => {
  reduceMotionEnabled = v;
});

export default function AnimatedCard({
  children,
  style,
  index = 0,
  onPress,
  onLongPress,
  activeOpacity = 0.7,
  disableEntrance = false,
}: AnimatedCardProps) {
  // Decide ONCE per mount whether this instance animates. If we skip
  // the animation, we render as a plain View — no Animated wrappers,
  // no per-frame UI-thread updates, no native animation handles.
  const skipAnimation = disableEntrance || reduceMotionEnabled || index >= STAGGER_LIMIT;

  const fadeAnim = useRef(new Animated.Value(skipAnimation ? 1 : 0)).current;
  const slideAnim = useRef(new Animated.Value(skipAnimation ? 0 : 20)).current;
  const scaleAnim = useRef(new Animated.Value(skipAnimation ? 1 : 0.96)).current;

  useEffect(() => {
    if (skipAnimation) return;
    const delay = Math.min(index * 60, 300);
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 350,
        delay,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 350,
        delay,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 8,
        tension: 40,
        delay,
        useNativeDriver: true,
      }),
    ]).start();
    // Anim values are stable refs; we intentionally only depend on
    // `skipAnimation` and `index` so we don't re-fire on parent re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skipAnimation, index]);

  if (skipAnimation) {
    if (onPress) {
      return (
        <TouchableOpacity
          style={style}
          onPress={onPress}
          onLongPress={onLongPress}
          activeOpacity={activeOpacity}
        >
          {children}
        </TouchableOpacity>
      );
    }
    return <Animated.View style={style}>{children}</Animated.View>;
  }

  const animatedStyle = {
    opacity: fadeAnim,
    transform: [{ translateY: slideAnim }, { scale: scaleAnim }],
  };

  if (onPress) {
    return (
      <Animated.View style={animatedStyle}>
        <TouchableOpacity
          style={style}
          onPress={onPress}
          onLongPress={onLongPress}
          activeOpacity={activeOpacity}
        >
          {children}
        </TouchableOpacity>
      </Animated.View>
    );
  }

  return <Animated.View style={[animatedStyle, style]}>{children}</Animated.View>;
}
