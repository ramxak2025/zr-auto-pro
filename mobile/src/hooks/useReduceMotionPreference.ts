import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/** Start conservatively: never run a burst while the OS preference is loading. */
export function useReduceMotionPreference(): boolean {
  const [reduced, setReduced] = useState(true);
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
