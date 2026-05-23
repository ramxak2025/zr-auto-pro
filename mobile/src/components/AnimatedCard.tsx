import React, { useEffect, useRef, ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, TouchableOpacity, ViewStyle } from 'react-native';

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
  /**
   * Optional `onPressIn` — fired on FINGER-DOWN, BEFORE `onPress`.
   * Used to kick off detail-prefetches the moment the user starts a
   * tap, so by the time the navigation push completes the next
   * screen's data is already in cache. Forwarded to TouchableOpacity.
   */
  onPressIn?: () => void;
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
  onPressIn,
  activeOpacity = 0.7,
  disableEntrance = false,
}: AnimatedCardProps) {
  // Decide ONCE per mount whether this instance animates. If we skip
  // the animation, we render as a plain View — no Animated wrappers,
  // no per-frame UI-thread updates, no native animation handles.
  const skipAnimation = disableEntrance || reduceMotionEnabled || index >= STAGGER_LIMIT;

  // Premium entry = calm opacity fade-in. No scale-up, no Y-translation
  // bounce — those read as "springy" / "bouncy" and clash with the iOS-
  // native materials this app uses. The stagger is kept so cards still
  // appear sequentially, just calmly.
  const fadeAnim = useRef(new Animated.Value(skipAnimation ? 1 : 0)).current;

  useEffect(() => {
    if (skipAnimation) return;
    const delay = Math.min(index * 40, 240);
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 180,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
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
          onPressIn={onPressIn}
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
  };

  if (onPress) {
    return (
      <Animated.View style={animatedStyle}>
        <TouchableOpacity
          style={style}
          onPress={onPress}
          onPressIn={onPressIn}
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
