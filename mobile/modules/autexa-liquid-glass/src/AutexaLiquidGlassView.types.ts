import type { ViewProps } from 'react-native';
import type { ReactNode } from 'react';

/**
 * Material variants — map 1:1 onto UIBlurEffect.Style on iOS.
 *
 *  - 'ultraThinMaterial' — most translucent, lets background colour bleed through (Control Center top sheet)
 *  - 'thinMaterial'      — lightly frosted (Apple Music mini-player)
 *  - 'material'          — system default
 *  - 'thickMaterial'     — heavier frost (Notification Center)
 *  - 'chromeMaterial'    — chrome / privacy-focused obscure
 */
export type GlassVariant =
  | 'ultraThinMaterial'
  | 'thinMaterial'
  | 'material'
  | 'thickMaterial'
  | 'chromeMaterial';

export interface AutexaLiquidGlassViewProps extends ViewProps {
  variant?: GlassVariant;
  /** Alpha multiplier on the effect view (0..1). Default 1.0. */
  intensity?: number;
  /** 1px white hairline at the top edge for premium glass-dome feel. Default true. */
  topRim?: boolean;
  children?: ReactNode;
}
