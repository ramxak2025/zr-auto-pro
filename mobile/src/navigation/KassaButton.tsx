/**
 * KassaButton — central CTA inside the floating tab bar.
 *
 * Visual brief (per owner feedback after seeing the previous JS-side
 * "liquid blob" version on Android):
 *   • Calm, premium gradient circle. NO animated blobs — the bar should
 *     read as a serious utility, not a neon UFO.
 *   • Soft inner highlight at the top-left for a subtle "glass" feel.
 *   • Crisp bag glyph inside, matching the iOS variant which uses the
 *     SF Symbol `bag.fill` for the same role.
 *   • Sits inside the floating tab bar slot — popped up 28pt so the
 *     button breaches the rim and reads as the primary action.
 *
 * iOS uses `AutexaKassaButton` (native Swift, AutexaLiquidGlass module)
 * for the FAB so this JS implementation is effectively Android-only,
 * but kept in a platform-neutral file because the legacy build flow
 * still imports it on both sides.
 */
import { LinearGradient } from 'expo-linear-gradient';
import { ShoppingBag } from 'lucide-react-native';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors } from '../theme';

const KASSA_SIZE = 56;

export function KassaButton() {
  return (
    <View style={s.outer}>
      <View style={s.body}>
        <LinearGradient
          colors={[colors.primary[400], colors.primary[600], colors.primary[800]]}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        {/* Soft inner highlight — sells the "glass" feel without the
            noisy blob animation. Pure CSS-style overlay. */}
        <View style={s.highlight} pointerEvents="none" />
        {/* Single hairline rim — the same one iOS Glass borders draw. */}
        <View style={s.rim} pointerEvents="none" />
        <ShoppingBag size={24} color={colors.white} strokeWidth={2.2} />
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
    // Pop UP 28pt out of the slim 60pt floating bar so the CTA breaches
    // the rim and reads as the primary action on both platforms.
    marginTop: -28,
  },
  body: {
    width: KASSA_SIZE,
    height: KASSA_SIZE,
    borderRadius: KASSA_SIZE / 2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 10,
    shadowColor: colors.primary[800],
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.32,
    shadowRadius: 10,
  },
  highlight: {
    position: 'absolute',
    top: 4,
    left: 4,
    right: 4,
    height: KASSA_SIZE * 0.45,
    borderRadius: KASSA_SIZE * 0.35,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
  },
  rim: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: KASSA_SIZE / 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.45)',
  },
});
