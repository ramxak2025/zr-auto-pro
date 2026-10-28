import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

export function useJournalReducedMotion() {
  const initial = useReducedMotion();
  const [reduced, setReduced] = useState(initial);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (active) setReduced(value);
    });
    const listener = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      active = false;
      listener.remove();
    };
  }, []);
  return reduced;
}

export function useJournalReducedTransparency() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceTransparencyEnabled().then((value) => {
      if (active) setReduced(value);
    });
    const listener = AccessibilityInfo.addEventListener('reduceTransparencyChanged', setReduced);
    return () => {
      active = false;
      listener.remove();
    };
  }, []);
  return reduced;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** One restrained tactile response for the journal's local controls. */
export function JournalPressable({
  style,
  onPressIn,
  onPressOut,
  ...props
}: Omit<PressableProps, 'style'> & { style?: StyleProp<ViewStyle> }) {
  const reduced = useJournalReducedMotion();
  const press = useSharedValue(0);
  const motion = useAnimatedStyle(() => ({
    opacity: 1 - press.value * 0.14,
    transform: [{ scale: reduced ? 1 : 1 - press.value * 0.03 }],
  }));
  return (
    <AnimatedPressable
      {...props}
      style={[style, motion]}
      onPressIn={(event) => {
        press.value = withTiming(1, { duration: reduced ? 0 : 90 });
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        press.value = withTiming(0, { duration: reduced ? 0 : 140 });
        onPressOut?.(event);
      }}
    />
  );
}
