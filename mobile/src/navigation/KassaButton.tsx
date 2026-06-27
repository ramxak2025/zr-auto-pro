/**
 * KassaButton — centre CTA inside the floating tab bar.
 *
 * Visual spec mirrors the native iOS AutexaKassaButtonView (see
 * `mobile/modules/autexa-liquid-glass/ios/AutexaKassaButtonView.swift`):
 *
 *   • Squircle, NOT a circle — continuous-corner rounded rectangle,
 *     radius 18 on a 52×52 surface. The pill-circle the previous build
 *     used read as a foreign UFO blob; the squircle visually carves
 *     out of the bar's own pill geometry.
 *   • Solid brand gradient (primary-500 → primary-700) at 92 % opacity.
 *     No animated "blob" overlay — the previous one looked busy and
 *     unprofessional on Android. Just a calm diagonal gradient.
 *   • White hairline rim (0.65 alpha) — the same edge highlight the
 *     native iOS variant draws.
 *   • Soft primary-tinted shadow underneath — premium glow without
 *     going neon.
 *   • White Lucide `ShoppingBag` icon, semibold stroke, matches the
 *     iOS `bag.fill` SF Symbol intent.
 *   • Sits INSIDE the bar pill (no -28pt lift). The previous huge
 *     lift made the CTA look detached and gave the bar's bottom edge
 *     a "weird semicircle" cutout per owner. Now it stays inside the
 *     island geometry, like iOS.
 */
import { LinearGradient } from 'expo-linear-gradient';
import { ShoppingBag, LayoutGrid } from 'lucide-react-native';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors } from '../theme';

const KASSA_SIZE = 48;
const RADIUS = 16;

/**
 * `board` (092, default false) — cash-shift-mode swap. When the tenant runs
 * shift-mode AND the caller is a master без права «Приём оплаты», the central
 * CTA opens «Доска» instead of «Касса». Only the glyph changes (ShoppingBag →
 * LayoutGrid); the premium squircle surface stays identical. board=false →
 * byte-for-byte the legacy Касса button.
 */
export function KassaButton({ board = false }: { board?: boolean }) {
  return (
    <View style={s.outer}>
      <View style={s.body}>
        <LinearGradient
          colors={[colors.primary[500], colors.primary[600], colors.primary[700]]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        {/* Hairline rim — same edge highlight the iOS native button
            draws (0.65 alpha white). */}
        <View style={s.rim} pointerEvents="none" />
        {board ? (
          <LayoutGrid size={22} color={colors.white} strokeWidth={2.2} />
        ) : (
          <ShoppingBag size={22} color={colors.white} strokeWidth={2.2} />
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  outer: {
    alignItems: 'center',
    justifyContent: 'center',
    width: KASSA_SIZE + 4,
    height: KASSA_SIZE + 4,
  },
  body: {
    width: KASSA_SIZE,
    height: KASSA_SIZE,
    borderRadius: RADIUS,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    // Soft, primary-tinted shadow — premium glow without neon.
    elevation: 8,
    shadowColor: colors.primary[800],
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28,
    shadowRadius: 10,
  },
  rim: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: RADIUS,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.55)',
  },
});
