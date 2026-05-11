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
import { StyleSheet, ViewStyle, Platform } from 'react-native';
import { colors, borderRadius, spacing } from '../theme';

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
