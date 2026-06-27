/**
 * ThemeContext — user-controlled light/dark mode with AsyncStorage
 * persistence.
 *
 * Why a manual context (not just `Appearance.getColorScheme()`):
 *   The owner explicitly asked for a toggle on the Dashboard hero
 *   that switches the theme. That switch needs to:
 *     • persist across launches (`AsyncStorage`)
 *     • initialise from the system preference on first run, so the
 *       phone's setting still wins until the user explicitly chooses
 *     • update React subtree on toggle (context re-render)
 *
 * Consumers:
 *   • `useThemeMode()` — `{ mode, setMode, toggle }` for the toggle UI.
 *   • `useColors()` — returns the semantic palette for the current
 *     mode. Surfaces that opt-in to dark mode read from this.
 *
 * Anything that still imports the flat `colors` map directly is
 * effectively locked to light mode — that's fine, dark-mode rollout
 * across the rest of the app is incremental.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import { Appearance, Platform } from 'react-native';
import { setIosAppearance } from 'autexa-liquid-glass';
import { getPalette, type SemanticPalette, type ThemeMode } from '../theme/palette';
import { getBadgeColors, type BadgeColor } from '../theme';

interface ThemeContextValue {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
  palette: SemanticPalette;
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = '@autexa:theme-mode';

function resolveInitialMode(): ThemeMode {
  const sys = Appearance.getColorScheme();
  return sys === 'dark' ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = React.useState<ThemeMode>(resolveInitialMode);

  // Hydrate persisted user choice on first mount. If the user has
  // never set the toggle themselves we keep the OS-resolved default.
  React.useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (raw === 'light' || raw === 'dark') {
          setModeState(raw);
        }
      })
      .catch(() => {
        // Ignore — falls back to system default.
      });
  }, []);

  // Push the mode into the iOS native glass module so
  // UIVisualEffectView (used inside the tab bar, Kassa CTA, schedule
  // grid header etc.) re-tints to dark / light. No-op on Android.
  const applyNativeAppearance = React.useCallback((next: ThemeMode) => {
    if (Platform.OS === 'ios') {
      setIosAppearance(next);
    }
  }, []);

  const setMode = React.useCallback(
    (next: ThemeMode) => {
      setModeState(next);
      AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
      applyNativeAppearance(next);
    },
    [applyNativeAppearance],
  );

  const toggle = React.useCallback(() => {
    setModeState((prev) => {
      const next: ThemeMode = prev === 'dark' ? 'light' : 'dark';
      AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
      applyNativeAppearance(next);
      return next;
    });
  }, [applyNativeAppearance]);

  // Apply the initial appearance once the mode is hydrated. Two-step:
  // first useEffect hydrates from AsyncStorage; this one mirrors the
  // resolved value into the native module.
  React.useEffect(() => {
    applyNativeAppearance(mode);
  }, [mode, applyNativeAppearance]);

  const palette = React.useMemo(() => getPalette(mode), [mode]);

  const value = React.useMemo<ThemeContextValue>(
    () => ({ mode, setMode, toggle, palette }),
    [mode, setMode, toggle, palette],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useThemeMode(): ThemeContextValue {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useThemeMode must be used inside <ThemeProvider>');
  }
  return ctx;
}

export function useColors(): SemanticPalette {
  return useThemeMode().palette;
}

/**
 * Non-throwing palette accessor. Returns the light palette when used
 * outside a `<ThemeProvider>` instead of crashing — for low-level shared
 * primitives (e.g. `<Icon>`) that may render in contexts not yet wrapped
 * by the provider (storybook-style previews, isolated tests, the splash
 * tree before the app mounts). Inside the app it behaves like
 * `useColors()`. The light fallback keeps legacy callers byte-identical.
 */
export function useOptionalColors(): SemanticPalette {
  const ctx = React.useContext(ThemeContext);
  return ctx ? ctx.palette : getPalette('light');
}

/**
 * Theme-aware badge palette map for the current mode. Use in components
 * that render status/payment chips and don't already hold a `palette`.
 * Rows that already receive a `palette` prop can call
 * `getBadgeColors(palette.mode)` directly instead of this hook.
 */
export function useBadgeColors(): Record<string, BadgeColor> {
  return getBadgeColors(useThemeMode().mode);
}
