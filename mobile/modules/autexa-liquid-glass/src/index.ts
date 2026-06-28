export { AutexaLiquidGlassView } from './AutexaLiquidGlassView';
export type { AutexaLiquidGlassViewProps, GlassVariant } from './AutexaLiquidGlassView.types';

export { AutexaLiquidGlassTabBar } from './AutexaLiquidGlassTabBar';
export type { AutexaLiquidGlassTabBarProps } from './AutexaLiquidGlassTabBar';

export { AutexaGlassHeader } from './AutexaGlassHeader';
export type { AutexaGlassHeaderProps } from './AutexaGlassHeader';

export { AutexaKassaButton } from './AutexaKassaButton';

/**
 * Write today's dashboard snapshot into the shared App Group UserDefaults so
 * the AuTexaWidget WidgetKit extension can display it on the Home Screen.
 * Immediately triggers a widget timeline reload (WidgetCenter.reloadAllTimelines).
 *
 * `json` must be a JSON string matching the role-aware WidgetPayload
 * (see ios-extensions/AuTexaWidget/AuTexaWidget.swift):
 *   master → { role: 'master', earningsToday, earningsMonth, shiftOpen?, updatedAt }
 *   owner  → { role: 'owner', revenue, profitToday, checksCount, updatedAt }
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

/**
 * Read-and-clear the action queued by a Siri / App Intent
 * («Создать заказ-наряд» / «Открыть кассу»). Returns the raw JSON string
 * (`{"action":"create_order","at":"…"}`) or null. Bridges to the native
 * AutexaLiquidGlass.consumePendingAppIntent(). No-op (null) off iOS.
 */
export function consumePendingAppIntent(): string | null {
  if (typeof globalThis !== 'undefined' && (globalThis as any).expo) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { requireNativeModule } = require('expo-modules-core');
      const mod = requireNativeModule('AutexaLiquidGlass');
      return mod.consumePendingAppIntent() ?? null;
    } catch {
      // Module / function missing — no pending action.
    }
  }
  return null;
}

// ── Live Activity (ActivityKit) low-level bridge ─────────────────────
// Thin wrappers over the AutexaLiveActivity Expo module. The typed,
// app-facing API lives in src/utils/liveActivity.ts. All calls funnel
// through a single native-module lookup and no-op safely off iOS.

function liveActivityModule(): any | null {
  if (typeof globalThis !== 'undefined' && (globalThis as any).expo) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { requireNativeModule } = require('expo-modules-core');
      return requireNativeModule('AutexaLiveActivity');
    } catch {
      return null;
    }
  }
  return null;
}

/** Are Live Activities supported AND enabled by the user? */
export function liveActivitiesSupported(): boolean {
  try {
    return liveActivityModule()?.isSupported() === true;
  } catch {
    return false;
  }
}

/** Start an activity; resolves to its id (use for update/end) or null. */
export async function startLiveActivity(attributesJson: string, contentJson: string): Promise<string | null> {
  const mod = liveActivityModule();
  if (!mod) return null;
  try {
    return (await mod.start(attributesJson, contentJson)) ?? null;
  } catch {
    return null;
  }
}

/** Update a running activity by id. */
export async function updateLiveActivity(id: string, contentJson: string): Promise<void> {
  const mod = liveActivityModule();
  if (!mod) return;
  try {
    await mod.update(id, contentJson);
  } catch {
    // non-critical
  }
}

/** End a running activity by id, optionally with a final content state. */
export async function endLiveActivity(
  id: string,
  contentJson?: string | null,
  dismissImmediately = false,
): Promise<void> {
  const mod = liveActivityModule();
  if (!mod) return;
  try {
    await mod.end(id, contentJson ?? null, dismissImmediately);
  } catch {
    // non-critical
  }
}

/** End every running Autexa activity (e.g. on logout). */
export async function endAllLiveActivities(): Promise<void> {
  const mod = liveActivityModule();
  if (!mod) return;
  try {
    await mod.endAll();
  } catch {
    // non-critical
  }
}
