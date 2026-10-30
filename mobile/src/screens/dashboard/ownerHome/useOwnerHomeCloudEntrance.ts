import { useLayoutEffect, useRef } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import {
  cancelAnimation,
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

type OwnerHomeCloudEntranceOptions = {
  enabled: boolean;
  reducedMotion: boolean;
  /** Increment only after a real background-to-foreground app activation. */
  activation: number;
};

/** Keep this above the keyed summary and share its style with the loading state. */
export function useOwnerHomeCloudEntrance({
  enabled,
  reducedMotion,
  activation,
}: OwnerHomeCloudEntranceOptions): StyleProp<ViewStyle> {
  const enteredActivation = useRef<number | null>(null);
  // Prepare only the decoration before its first native frame; all content is static.
  const progress = useSharedValue(enabled && !reducedMotion ? 0 : 1);

  useLayoutEffect(() => {
    cancelAnimation(progress);
    if (!enabled) {
      progress.value = 1;
    } else {
      const shouldEnter = enteredActivation.current !== activation;
      // Reduced Motion consumes this activation too. Changing the preference or
      // navigating back must never replay an already presented entrance.
      enteredActivation.current = activation;
      if (reducedMotion || !shouldEnter) {
        progress.value = 1;
      } else {
        progress.value = 0;
        progress.value = withTiming(1, {
          duration: 760,
          easing: Easing.out(Easing.cubic),
          reduceMotion: ReduceMotion.System,
        });
      }
    }
    return () => cancelAnimation(progress);
  }, [enabled, reducedMotion, activation, progress]);

  return useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateX: (1 - progress.value) * 180 }],
  }));
}
