/**
 * Platform-adaptive motion specs for Reanimated.
 *
 * iOS: springs — Apple-style physics (press → settle).
 * Android: Material emphasised easing — deterministic timings.
 *
 * Use via the factories so a component written once animates idiomatically
 * on both platforms.
 */
import { Platform } from 'react-native';
import { Easing, WithSpringConfig, WithTimingConfig } from 'react-native-reanimated';

// ── iOS spring presets (Apple HIG feel) ──────────────────────────────────
export const SPRING_TIGHT: WithSpringConfig = {
  mass: 0.9,
  stiffness: 220,
  damping: 24,
};

export const SPRING_SOFT: WithSpringConfig = {
  mass: 1.0,
  stiffness: 140,
  damping: 18,
};

// Press-settle spring — used by PressableScale on iOS
export const SPRING_PRESS: WithSpringConfig = {
  mass: 0.6,
  stiffness: 320,
  damping: 22,
};

// ── Android timing presets (Material 3 emphasised) ───────────────────────
// Standard = container / layout changes
export const TIMING_STANDARD: WithTimingConfig = {
  duration: 300,
  easing: Easing.bezier(0.2, 0, 0, 1),
};

// Emphasised = one-offs, dramatic transitions
export const TIMING_EMPHASISED: WithTimingConfig = {
  duration: 500,
  easing: Easing.bezier(0.2, 0, 0, 1),
};

// Fast = small toggles, buttons, chips
export const TIMING_FAST: WithTimingConfig = {
  duration: 200,
  easing: Easing.bezier(0.2, 0, 0, 1),
};

/**
 * True when the current runtime should prefer spring animations (iOS).
 * Android ≥ 12 technically supports the same APIs but the M3 guidelines
 * favor tween easing, so we route Android through timings.
 */
export const preferSpring = Platform.OS === 'ios';
