/**
 * iOS 26 / Liquid Glass-inspired visual primitives.
 *
 * Single source of truth for the surface treatments that should look the
 * same across screens (касса, расписание, склад, ещё). Kept as plain
 * style objects — consume directly via `style={[iosCard, ...]}` — so we
 * don't introduce a styling abstraction the rest of the codebase has to
 * learn.
 *
 * The design intent (per docs/ios-redesign/IOS26_LIQUID_GLASS_VISUAL_SYSTEM.md):
 *   • squircle corners with continuous curve (large radius, soft corners)
 *   • crisp white surface with hairline neutral border (1pt or 0.5pt)
 *   • subtle elevation — shadow exists but is barely perceptible
 *   • compact internal spacing, generous external spacing
 *
 * Glass surfaces (UIVisualEffectView material) are NOT exported from
 * here — for those use `<AutexaLiquidGlassView />` from the local Expo
 * Module, which renders the native material on iOS 26+ and falls back
 * to expo-blur on older OS / Android.
 */
import React from 'react';
import { StyleSheet, ViewStyle, Platform } from 'react-native';
import { colors, borderRadius, spacing } from '../theme';
import type { SemanticPalette } from '../theme/palette';
import { useColors } from '../contexts/ThemeContext';

const HAIRLINE = StyleSheet.hairlineWidth;

/** Standard card on a screen — hosts a logical block of content. */
export const iosCard: ViewStyle = {
  backgroundColor: colors.white,
  borderRadius: borderRadius.xl,
  borderWidth: HAIRLINE,
  borderColor: colors.gray[200],
  paddingHorizontal: spacing[4],
  paddingVertical: spacing[3.5],
  shadowColor: '#000',
  shadowOpacity: 0.04,
  shadowRadius: 6,
  shadowOffset: { width: 0, height: 1 },
  // Android: a hairline elevation reads as "card" without the heavy
  // material design shadow that doesn't fit the brand.
  ...(Platform.OS === 'android' ? { elevation: 1 } : null),
};

/** The accent variant — primary-tinted border + subtle tinted bg. */
export const iosCardAccent: ViewStyle = {
  ...iosCard,
  borderColor: colors.primary[200],
  shadowColor: colors.primary[800],
  shadowOpacity: 0.05,
};

/** Tighter card used inside lists / pickers (no own elevation). */
export const iosCardCompact: ViewStyle = {
  backgroundColor: colors.white,
  borderRadius: borderRadius.lg,
  borderWidth: HAIRLINE,
  borderColor: colors.gray[200],
  paddingHorizontal: spacing[3],
  paddingVertical: spacing[2.5],
};

/** Pill / chip — small interactive surface for status + counters. */
export const iosPill: ViewStyle = {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 4,
  backgroundColor: colors.gray[100],
  borderRadius: 999,
  paddingHorizontal: spacing[2.5],
  paddingVertical: 4,
};

/** Section header — light grey uppercase label, used above a group. */
export const iosSectionLabel: import('react-native').TextStyle = {
  fontSize: 11,
  fontWeight: '700',
  color: colors.gray[500],
  letterSpacing: 1,
  textTransform: 'uppercase',
  marginBottom: spacing[1.5],
};

/** Standard squircle radius for buttons / icons (16pt = native iOS feel). */
export const SQUIRCLE_RADIUS = 16;

/** Full-pill radius (height/2). Use for bars and tabs. */
export const PILL_RADIUS = 999;

// ── Theme-aware variants ──────────────────────────────────────────────
// Imported screens can opt in to dark-mode-responsive surfaces by
// reading these via `useIosSurface()`. The legacy static exports above
// stay frozen at the light values so older screens keep working
// untouched while dark-mode rollout is iterative.

/**
 * Theme-aware drop shadow.
 *
 * Single source of truth for the ~25 hardcoded `shadowColor: '#000'`
 * blocks scattered across screens. The screen-sweep pass should replace
 * those inline shadow props with a spread of `buildShadow(palette)` (or
 * `useShadow()` inside a component body), so dark mode gets a deeper,
 * pure-black shadow while light mode keeps its whisper-soft slate shadow.
 *
 *   const shadow = useShadow();              // resting card depth
 *   const float = useShadow('elevated');     // floating / popover depth
 *   <View style={[styles.card, shadow]} />
 *
 * Android draws shadows from `elevation`; `shadowColor` is API-gated and
 * flaky there, so we only emit `elevation` on Android.
 */
export type ShadowElevation = 'card' | 'elevated';

export function buildShadow(palette: SemanticPalette, level: ShadowElevation = 'card'): ViewStyle {
  const elevated = level === 'elevated';
  if (Platform.OS === 'android') {
    return { elevation: elevated ? 6 : 1 };
  }
  return {
    shadowColor: palette.shadow.color,
    shadowOpacity: elevated ? palette.shadow.elevatedOpacity : palette.shadow.opacity,
    shadowRadius: elevated ? 16 : 6,
    shadowOffset: { width: 0, height: elevated ? 6 : 1 },
  };
}

export interface IosSurface {
  card: ViewStyle;
  cardAccent: ViewStyle;
  cardCompact: ViewStyle;
  pill: ViewStyle;
  sectionLabel: import('react-native').TextStyle;
  /** Ready-to-spread resting-card shadow for the current mode. */
  shadow: ViewStyle;
  /** Ready-to-spread elevated/floating shadow for the current mode. */
  shadowElevated: ViewStyle;
  canvas: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  borderSubtle: string;
  borderStrong: string;
  accent: string;
  accentSoft: string;
}

export function buildIosSurface(palette: SemanticPalette): IosSurface {
  const cardShadow = buildShadow(palette, 'card');
  const cardBase: ViewStyle = {
    backgroundColor: palette.bg.card,
    borderRadius: borderRadius.xl,
    borderWidth: HAIRLINE,
    borderColor: palette.border.subtle,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3.5],
    ...cardShadow,
  };
  return {
    card: cardBase,
    cardAccent: {
      ...cardBase,
      borderColor: palette.accent.primary,
      // Accent-tinted shadow on iOS; Android keeps neutral elevation.
      ...(Platform.OS === 'ios'
        ? {
            shadowColor: palette.accent.primary,
            shadowOpacity: palette.mode === 'dark' ? 0.25 : 0.05,
          }
        : null),
    },
    cardCompact: {
      backgroundColor: palette.bg.card,
      borderRadius: borderRadius.lg,
      borderWidth: HAIRLINE,
      borderColor: palette.border.subtle,
      paddingHorizontal: spacing[3],
      paddingVertical: spacing[2.5],
    },
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: palette.bg.muted,
      borderRadius: 999,
      paddingHorizontal: spacing[2.5],
      paddingVertical: 4,
    },
    sectionLabel: {
      fontSize: 11,
      fontWeight: '700',
      color: palette.text.tertiary,
      letterSpacing: 1,
      textTransform: 'uppercase',
      marginBottom: spacing[1.5],
    },
    shadow: cardShadow,
    shadowElevated: buildShadow(palette, 'elevated'),
    canvas: palette.bg.canvas,
    textPrimary: palette.text.primary,
    textSecondary: palette.text.secondary,
    textTertiary: palette.text.tertiary,
    borderSubtle: palette.border.subtle,
    borderStrong: palette.border.strong,
    accent: palette.accent.primary,
    accentSoft: palette.accent.primarySoft,
  };
}

/**
 * Hook returning theme-aware ios surface styles. Re-evaluates on
 * every mode change. Use in any screen that wants to flip cleanly
 * between light and dark — typically inside the component body, then
 * spread into the existing StyleSheet.create() entries via `style={[..., surface.card]}`.
 */
export function useIosSurface(): IosSurface {
  const palette = useColors();
  return React.useMemo(() => buildIosSurface(palette), [palette]);
}

/**
 * Hook returning a single theme-aware drop-shadow style for the current
 * mode. The thin entry point for the screen-sweep pass that just needs a
 * shadow without the whole surface bundle:
 *
 *   const shadow = useShadow();             // resting card
 *   const float = useShadow('elevated');    // floating element
 *   <View style={[styles.card, shadow]} />
 */
export function useShadow(level: ShadowElevation = 'card'): ViewStyle {
  const palette = useColors();
  return React.useMemo(() => buildShadow(palette, level), [palette, level]);
}
