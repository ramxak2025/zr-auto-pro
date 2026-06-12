import * as React from 'react';
import { Platform, View } from 'react-native';
import { requireNativeViewManager } from 'expo-modules-core';
import { BlurView } from 'expo-blur';
import type { AutexaLiquidGlassViewProps, GlassVariant } from './AutexaLiquidGlassView.types';

/**
 * AutexaLiquidGlassView
 *
 * iOS: native UIVisualEffectView (UIBlurEffect.systemThinMaterial by default)
 *      with a CAGradientLayer highlight and a 1px top rim. Forward-compatible
 *      with iOS 26 UIGlassEffect via runtime lookup (see Swift source).
 *
 * Android / web: falls back to a translucent solid surface (no native blur).
 *
 * If the native module is unavailable for any reason (e.g. unrelated build
 * failure, dev playground) we silently fall back to expo-blur, which is also
 * UIVisualEffectView under the hood.
 */
let NativeView: React.ComponentType<AutexaLiquidGlassViewProps> | null = null;
try {
  NativeView = requireNativeViewManager('AutexaLiquidGlass');
} catch {
  NativeView = null;
}

export function AutexaLiquidGlassView(props: AutexaLiquidGlassViewProps) {
  const { variant = 'thinMaterial', topRim, style, children, ...rest } = props;

  if (Platform.OS !== 'ios') {
    return (
      <View {...rest} style={[{ backgroundColor: 'rgba(255, 255, 255, 0.92)' }, style]}>
        {children}
      </View>
    );
  }

  if (NativeView) {
    return (
      <NativeView {...rest} variant={variant} topRim={topRim ?? true} style={style}>
        {children}
      </NativeView>
    );
  }

  // Fallback — also native UIVisualEffectView via expo-blur, just less
  // configurable. Maps our variant onto expo-blur's tint.
  const tint = mapVariantToBlurTint(variant);
  return (
    <BlurView tint={tint as any} intensity={96} style={style}>
      {children}
    </BlurView>
  );
}

function mapVariantToBlurTint(v: GlassVariant): string {
  switch (v) {
    case 'ultraThinMaterial':
      return 'systemUltraThinMaterialLight';
    case 'thickMaterial':
      return 'systemThickMaterialLight';
    case 'material':
      return 'systemMaterialLight';
    case 'chromeMaterial':
      return 'systemChromeMaterialLight';
    case 'thinMaterial':
    default:
      return 'systemThinMaterialLight';
  }
}
