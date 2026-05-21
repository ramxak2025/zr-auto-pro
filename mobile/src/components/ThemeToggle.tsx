/**
 * ThemeToggle — animated sun ↔ moon switch.
 *
 * Compact pill that lives on the Dashboard hero. Tapping it flips the
 * app's theme mode and triggers a coordinated animation:
 *
 *   • Sun and moon icons cross-fade with a 180° rotation around their
 *     own centre. Apple-style "rolling celestial bodies" transition.
 *   • Background indicator (a small rounded pill behind the icon)
 *     springs between two horizontal positions.
 *   • Light-mode icon = sun (yellow tint), dark-mode icon = moon
 *     (cool slate tint). The icon currently visible is the one for
 *     the OPPOSITE mode — i.e. it shows where the tap will take you,
 *     not the current state. That's the iOS Control Center / macOS
 *     menu-bar convention.
 *   • Haptic on tap.
 *
 * Visual size: 56pt-wide pill, 28pt tall. Reads as a status chip but
 * is touchable across the full surface.
 */
import { Moon, Sun } from 'lucide-react-native';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { haptic } from '../platform/haptics';
import { useThemeMode } from '../contexts/ThemeContext';

const TRACK_W = 56;
const TRACK_H = 28;
const KNOB_SIZE = 24;
const KNOB_INSET = (TRACK_H - KNOB_SIZE) / 2;

export function ThemeToggle({ onColor }: { onColor?: string }) {
  const { mode, toggle } = useThemeMode();
  // `progress` goes from 0 (light) → 1 (dark). Drives knob translation
  // AND the two-icon cross-fade in lockstep.
  const progress = useSharedValue(mode === 'dark' ? 1 : 0);

  React.useEffect(() => {
    progress.value = withSpring(mode === 'dark' ? 1 : 0, {
      damping: 14,
      stiffness: 140,
    });
  }, [mode, progress]);

  const knobStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX: interpolate(
          progress.value,
          [0, 1],
          [KNOB_INSET, TRACK_W - KNOB_SIZE - KNOB_INSET],
          Extrapolation.CLAMP,
        ),
      },
    ],
  }));

  const trackStyle = useAnimatedStyle(() => ({
    // Track tint shifts from a soft warm cream (sun side) to a deep
    // cold blue (moon side) — same visual language as iOS Control
    // Center's appearance toggle.
    backgroundColor: progress.value > 0.5
      ? 'rgba(15, 23, 42, 0.55)'
      : 'rgba(255, 255, 255, 0.22)',
  }));

  const sunStyle = useAnimatedStyle(() => ({
    opacity: 1 - progress.value,
    transform: [
      { rotate: `${progress.value * -90}deg` },
      { scale: 1 - progress.value * 0.2 },
    ],
  }));

  const moonStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [
      { rotate: `${(1 - progress.value) * 90}deg` },
      { scale: 0.8 + progress.value * 0.2 },
    ],
  }));

  const handle = React.useCallback(() => {
    haptic('select');
    // Drive a fast colour-fade in parallel with the spring — the
    // perceived "click" needs to be instant even though the spring
    // takes ~300ms to settle.
    progress.value = withTiming(mode === 'dark' ? 0 : 1, { duration: 220 });
    toggle();
  }, [mode, toggle, progress]);

  const accent = onColor ?? '#0f172a';

  return (
    <Pressable onPress={handle} hitSlop={8} accessibilityRole="switch" accessibilityLabel="Тема">
      <Animated.View style={[styles.track, trackStyle]}>
        <Animated.View style={[styles.knob, knobStyle]}>
          {/* Two icons stacked — opacity-crossfade between them. */}
          <Animated.View style={[styles.iconLayer, sunStyle]}>
            <Sun size={14} color={accent} strokeWidth={2.4} fill={accent} fillOpacity={0.15 as never} />
          </Animated.View>
          <Animated.View style={[styles.iconLayer, moonStyle]}>
            <Moon size={14} color={accent} strokeWidth={2.4} fill={accent} fillOpacity={0.4 as never} />
          </Animated.View>
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: {
    width: TRACK_W,
    height: TRACK_H,
    borderRadius: TRACK_H / 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.35)',
    overflow: 'hidden',
    justifyContent: 'center',
  },
  knob: {
    position: 'absolute',
    width: KNOB_SIZE,
    height: KNOB_SIZE,
    borderRadius: KNOB_SIZE / 2,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  iconLayer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
