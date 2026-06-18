import * as React from 'react';
import { Platform, View, ViewStyle, StyleProp } from 'react-native';
import { requireNativeViewManager } from 'expo-modules-core';
import type { GlassVariant } from './AutexaLiquidGlassView.types';

export interface AutexaGlassHeaderProps {
  /** Material variant — maps 1:1 onto UIBlurEffect.Style on iOS. */
  variant?: GlassVariant;
  /** 1pt hairline at the BOTTOM edge (separator over the scrolling list). Default false. */
  bottomRim?: boolean;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

/**
 * AutexaGlassHeader
 * --------------------------------------------------------------------------
 * JS bridge to the native Liquid-Glass HEADER material
 * (AutexaGlassHeaderView.swift). Used as the background of a top-of-screen
 * header / filter-chip strip — currently the Journal screen's warehouse-docs
 * kind-chip row in `mobile/src/screens/ChecksScreen.tsx`.
 *
 * GUARANTEED FALLBACK CONTRACT (this is the whole point of the component):
 *
 *   • iOS + native module present  → native UIVisualEffectView glass
 *     (systemThinMaterial, auto-upgraded to iOS 26 UIGlassEffect) behind the
 *     children.
 *   • iOS + module missing (unrelated build failure / dev playground)
 *     OR Android / web (Platform.OS !== 'ios')
 *                                    → a PLAIN, TRANSPARENT passthrough View.
 *
 * In EVERY path the `children` (the RN chips) render unchanged and stay fully
 * interactive, so the Journal filter behaves identically whether or not the
 * native glass lights up. The fallback is intentionally transparent (NOT a
 * blur, NOT a tinted surface) so the screen looks byte-for-byte like it did
 * before this enhancement when native glass is unavailable — no Android
 * regression, no surprise material on old iOS.
 *
 * Why no expo-blur fallback here (unlike AutexaLiquidGlassView): the chip row
 * sits inline in a vertical column over the normal screen canvas, not over
 * scrolling content. A blur with nothing meaningful behind it would just look
 * like a flat grey band and risk an extra always-mounted UIVisualEffectView
 * (jetsam pressure — see project memory on expo-blur restraint). A plain View
 * is the correct, lowest-risk "no glass available" state.
 */
let NativeHeader: React.ComponentType<{
  variant?: string;
  bottomRim?: boolean;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}> | null = null;
try {
  // Matches the View class registered in AutexaGlassHeaderModule
  // (AutexaLiquidGlassModule.swift) under Name("AutexaGlassHeader").
  NativeHeader = requireNativeViewManager('AutexaGlassHeader');
} catch {
  NativeHeader = null;
}

export function AutexaGlassHeader(props: AutexaGlassHeaderProps) {
  const { variant = 'thinMaterial', bottomRim = false, style, children } = props;

  if (Platform.OS === 'ios' && NativeHeader) {
    return (
      <NativeHeader variant={variant} bottomRim={bottomRim} style={style}>
        {children}
      </NativeHeader>
    );
  }

  // Fallback — plain transparent passthrough. The chips render exactly as
  // before; nothing about the screen changes on Android / module-missing.
  return <View style={style}>{children}</View>;
}
