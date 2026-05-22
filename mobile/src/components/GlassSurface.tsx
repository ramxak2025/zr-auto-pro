/**
 * GlassSurface — frosted backdrop on iOS, tonal elevation on Android.
 *
 *  iOS:  BlurView (`intensity` ≈ 60-80, `tint='systemMaterial'`) = the real
 *        iOS 16+ frosted look. Behaves correctly over any content.
 *  Android: translucent white surface with tonal shadow — no BlurView because
 *           RN Android blur is expensive and flaky on older devices. We trade
 *           the true frost for a predictable premium card.
 *
 * Use anywhere you need a floating / translucent panel: tab bars, bottom
 * sheets, overlay headers.
 */
import { BlurView } from 'expo-blur';
import React from 'react';
import { Platform, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { shadow, ShadowLevel } from '../platform/shadow';

export interface GlassSurfaceProps {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** iOS blur intensity (0-100). */
  intensity?: number;
  /** iOS tint. systemMaterial = adapts to dark/light, chromeMaterial = strong. */
  tint?: 'light' | 'dark' | 'default' | 'systemMaterial' | 'systemThinMaterial' | 'systemChromeMaterial';
  /** Android fallback tint. Default: very light white. */
  androidTint?: string;
  shadowLevel?: ShadowLevel;
  /** Corner radius (applied to both platforms). */
  radius?: number;
}

export function GlassSurface({
  children,
  style,
  intensity = 70,
  tint = 'systemMaterial',
  androidTint = 'rgba(255,255,255,0.86)',
  shadowLevel = 'lg',
  radius = 24,
}: GlassSurfaceProps) {
  if (Platform.OS === 'ios') {
    return (
      <View style={[{ borderRadius: radius }, shadow(shadowLevel), style, styles.overflowHidden]}>
        <BlurView
          intensity={intensity}
          tint={tint as never}
          style={[StyleSheet.absoluteFill, { borderRadius: radius }]}
        />
        {children}
      </View>
    );
  }
  return (
    <View style={[{ borderRadius: radius, backgroundColor: androidTint }, shadow(shadowLevel), style]}>{children}</View>
  );
}

const styles = StyleSheet.create({
  overflowHidden: { overflow: 'hidden' },
});
