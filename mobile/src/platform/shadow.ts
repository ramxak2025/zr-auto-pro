/**
 * Platform-adaptive shadow.
 *
 * iOS uses shadow* props (SHADOW WITH COLOR), Android uses `elevation`
 * which draws a material shadow from the view's z-level. Pass a single
 * `level` and get the right style for the current platform.
 */
import { Platform, ViewStyle } from 'react-native';

export type ShadowLevel = 'none' | 'xs' | 'sm' | 'md' | 'lg' | 'xl';

/**
 * @param level Depth level (iOS-maps to blur radius, Android to elevation)
 * @param color iOS shadow color. Keep opacity modest (0.08–0.15) for premium feel.
 *              On Android this is ignored unless API 28+; for tinted shadows use
 *              a dedicated wrapper.
 */
export function shadow(level: ShadowLevel = 'md', color = '#0f172a'): ViewStyle {
  if (level === 'none') return {};

  if (Platform.OS === 'ios') {
    const map: Record<Exclude<ShadowLevel, 'none'>, ViewStyle> = {
      xs: { shadowColor: color, shadowOpacity: 0.05, shadowRadius: 2, shadowOffset: { width: 0, height: 1 } },
      sm: { shadowColor: color, shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
      md: { shadowColor: color, shadowOpacity: 0.1, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
      lg: { shadowColor: color, shadowOpacity: 0.14, shadowRadius: 16, shadowOffset: { width: 0, height: 6 } },
      xl: { shadowColor: color, shadowOpacity: 0.2, shadowRadius: 28, shadowOffset: { width: 0, height: 12 } },
    };
    return map[level];
  }

  // Android — elevation only. No shadowColor (it's API-gated and flaky).
  const elevation: Record<Exclude<ShadowLevel, 'none'>, number> = {
    xs: 1,
    sm: 2,
    md: 4,
    lg: 8,
    xl: 16,
  };
  return { elevation: elevation[level] };
}
