export { AutexaLiquidGlassView } from './AutexaLiquidGlassView';
export type { AutexaLiquidGlassViewProps, GlassVariant } from './AutexaLiquidGlassView.types';

export { AutexaLiquidGlassTabBar } from './AutexaLiquidGlassTabBar';
export type { AutexaLiquidGlassTabBarProps } from './AutexaLiquidGlassTabBar';

export { AutexaKassaButton } from './AutexaKassaButton';

/**
 * Write today's dashboard snapshot into the shared App Group UserDefaults so
 * the AuTexaWidget WidgetKit extension can display it on the Home Screen.
 * Immediately triggers a widget timeline reload (WidgetCenter.reloadAllTimelines).
 *
 * `json` must be a JSON string matching:
 *   { revenue: number, checksCount: number, profitToday: number,
 *     shiftOpen: boolean, updatedAt: string }
 *
 * Safe to call on Android — falls through to a no-op silently.
 */
export function setWidgetData(json: string): void {
  if (typeof globalThis !== 'undefined' && (globalThis as any).expo) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { requireNativeModule } = require('expo-modules-core');
      const mod = requireNativeModule('AutexaLiquidGlass');
      mod.setWidgetData(json);
    } catch {
      // Module missing (Android / unit tests) — silently no-op.
    }
  }
}

/**
 * Force the iOS app's interface style at runtime.
 *
 * Bridges to UIWindow.overrideUserInterfaceStyle so the system glass
 * material (UIVisualEffectView with `systemThinMaterial` etc.) renders
 * in the right tone, and SF-Symbol vibrancy adapts correctly.
 *
 * On Android the function is a no-op — Android dark mode is handled
 * entirely on the JS side via the BlurView's `tint` prop.
 *
 * Pass:
 *   • 'dark' → forces dark trait
 *   • 'light' → forces light trait
 *   • 'system' → release back to the system default (clears the override)
 */
export function setIosAppearance(mode: 'dark' | 'light' | 'system'): void {
  if (typeof globalThis !== 'undefined' && (globalThis as any).expo) {
    try {
      // Late-import so non-iOS bundles don't fail to load the module.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { requireNativeModule } = require('expo-modules-core');
      const mod = requireNativeModule('AutexaLiquidGlass');
      mod.setAppearance(mode);
    } catch {
      // Module missing (Android / unit tests) — silently no-op.
    }
  }
}
