import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/** Default conservatively; a caller may supply the native synchronous preference. */
export function useReduceMotionPreference(initialReducedMotion = true): boolean {
  const [reduced, setReduced] = useState(initialReducedMotion);
  useEffect(() => {
    let active = true;
    let changed = false;
    const listener = AccessibilityInfo.addEventListener('reduceMotionChanged', (value) => {
      changed = true;
      if (active) setReduced(value);
    });
    void AccessibilityInfo.isReduceMotionEnabled().then(
      (value) => {
        if (active && !changed) setReduced(value);
      },
      () => {},
    );
    return () => {
      active = false;
      listener.remove();
    };
  }, []);
  return reduced;
}
