/**
 * ModalBlurBackdrop — the single shared backdrop for every modal / bottom
 * sheet in the app. Replaces the old dark dim overlays (`rgba(0,0,0,0.x)`)
 * with a smooth premium frosted blur so the foreground card pops without a
 * heavy black scrim.
 *
 *  iOS:  expo-blur `BlurView` ONLY — tint adapts to the active light/dark
 *        theme, intensity ~42, and NO dark scrim on top (owner ask: pure blur,
 *        no dim when a sheet pops up). Honors reduce-transparency (falls back
 *        to a light neutral dim since blur is unavailable then).
 *  Android: BlurView is expensive / flaky on older devices, so — following
 *        the `GlassSurface.tsx` precedent — we use a light frosted translucent
 *        fill (not a dark slate) and never mount a BlurView.
 *
 * Static layer only: no worklets, no animation. Bottom sheets that animate
 * backdrop opacity with the drag gesture wrap this in their own
 * Animated.View and keep their own light dim layer on top.
 *
 * Tapping the backdrop itself (not its children) fires `onPress` — the
 * standard tap-outside-to-close affordance.
 */
import { BlurView } from 'expo-blur';
import React, { ReactNode } from 'react';
import {
  AccessibilityInfo,
  Platform,
  Pressable,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { useThemeMode } from '../contexts/ThemeContext';

export interface ModalBlurBackdropProps {
  /** Fires when the backdrop (not a child) is tapped — tap-outside-to-close. */
  onPress?: () => void;
  /** iOS blur intensity (0-100). Default 24 — frosted but readable, and a
   * modest GPU cost. The native Liquid Glass tab bar is already an
   * always-on UIVisualEffectView, so transient modal backdrops keep their
   * blur (owner ask) but at a lower intensity to limit compounded blur work. */
  intensity?: number;
  /** iOS tint. Defaults to the active theme (dark mode → 'dark'). */
  tint?: 'light' | 'dark' | 'default';
  /** Optional foreground content rendered above the backdrop. */
  children?: ReactNode;
  /** Extra style merged onto the absolute-fill container. */
  style?: ViewStyle;
}

// Owner ask (2026-05-30): NO dark backdrop when a sheet pops up — pure blur.
// So the iOS path is the frosted BlurView only, with NO black scrim on top.
const IOS_SCRIM = 'transparent';
// Theme-aware LIGHT frost for the two non-blur fallbacks (reduce-transparency
// on iOS, and Android where BlurView is too expensive — GlassSurface precedent,
// which uses 'rgba(255,255,255,0.86)'). Owner ask: pure light frost, NO dark dim.
//   light mode → a soft white frost so the card pops without a black scrim;
//   dark mode  → a faint slate frost so the surface still reads as "glass".
const LIGHT_FROST = 'rgba(255,255,255,0.55)';
const DARK_FROST = 'rgba(17,24,39,0.35)';

export default function ModalBlurBackdrop({
  onPress,
  intensity = 24,
  tint,
  children,
  style,
}: ModalBlurBackdropProps) {
  const { mode } = useThemeMode();
  const resolvedTint: 'light' | 'dark' | 'default' = tint ?? (mode === 'dark' ? 'dark' : 'light');
  // Theme-aware light frost for the non-blur fallbacks (Android + iOS
  // reduce-transparency). Never a heavy black scrim.
  const frostFill = mode === 'dark' ? DARK_FROST : LIGHT_FROST;

  // Honor reduce-transparency on iOS — when on, we skip the blur and fall
  // back to a stronger opaque scrim (still not pitch black).
  const [reduceTransparency, setReduceTransparency] = React.useState(false);
  React.useEffect(() => {
    if (Platform.OS !== 'ios') return;
    let mounted = true;
    AccessibilityInfo.isReduceTransparencyEnabled?.()
      .then((v) => {
        if (mounted) setReduceTransparency(!!v);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.('reduceTransparencyChanged', (v: boolean) =>
      setReduceTransparency(!!v),
    );
    return () => {
      mounted = false;
      sub?.remove?.();
    };
  }, []);

  return (
    <Pressable
      style={[StyleSheet.absoluteFill, style]}
      onPress={onPress}
      // Backdrop is decorative; the close affordance is announced by the
      // modal/sheet itself. Keep it out of the a11y tree as a button.
      accessible={false}
    >
      {Platform.OS === 'ios' ? (
        reduceTransparency ? (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: frostFill }]} />
        ) : (
          <BlurView
            intensity={intensity}
            tint={resolvedTint as never}
            style={[StyleSheet.absoluteFill, { backgroundColor: IOS_SCRIM }]}
          />
        )
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: frostFill }]} />
      )}
      {children}
    </Pressable>
  );
}
