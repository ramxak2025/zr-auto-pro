import React, { useEffect, useRef, useState } from 'react';
import { StatusBar } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Font from 'expo-font';
import * as Notifications from 'expo-notifications';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { AuthProvider } from './src/contexts/AuthContext';
import { ThemeProvider, useThemeMode } from './src/contexts/ThemeContext';
import { SalaryNotificationProvider } from './src/contexts/SalaryNotificationContext';
import AppNavigator from './src/navigation/AppNavigator';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import SplashOverlay from './src/components/SplashOverlay';
import { colors } from './src/theme';
import { hydrateCache, attachPersistence } from './src/utils/persistentCache';
import { attachForegroundRevalidation } from './src/utils/foregroundRevalidation';

// Configure how notifications are handled when the app is in the foreground.
// Must be set before any notification arrives — top-level call outside component.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Mobile: longer staleTime so revisiting a screen within 2 min doesn't
      // refetch — the user perceives the app as instant.
      staleTime: 2 * 60 * 1000,
      // Keep query data alive for 30 min after last unmount, so a tab swipe
      // back doesn't lose the cache.
      gcTime: 30 * 60 * 1000,
      retry: 2,
      refetchOnWindowFocus: false,
      // Global stale-while-revalidate: when a queryKey changes (eg. paging,
      // search, filters), keep showing the previous data until the new one
      // arrives instead of dropping back to a loading state. This is the
      // single biggest perceptible-perf win — search/pager swaps feel native.
      placeholderData: (prev: unknown) => prev,
    },
  },
});

export default function App() {
  const [cacheReady, setCacheReady] = useState(false);
  const [authResolved, setAuthResolved] = useState(false);
  const [fontsReady, setFontsReady] = useState(false);
  const persistenceCleanup = useRef<(() => void) | null>(null);
  const foregroundCleanup = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Subscribe to cache updates IMMEDIATELY so queries that fire while
    // hydration is still in progress get persisted on success. Previously
    // we waited for hydration to finish before subscribing, which meant
    // the first batch of post-login queries silently bypassed the cache.
    persistenceCleanup.current = attachPersistence(queryClient);
    // Foreground revalidation — invalidate critical dashboard/journal
    // queries whenever the app comes back to `active` state. So the user
    // who put the phone down at lunch and reopens at 14:00 sees the
    // freshest cash position immediately, instead of yesterday's snapshot
    // plus a manual pull-to-refresh.
    foregroundCleanup.current = attachForegroundRevalidation(queryClient);
    // Hydration runs in the background — we do NOT gate the first render
    // on it. With an expanded whitelist (~25 keys), the AsyncStorage
    // multiGet + JSON.parse loop costs ~200-500ms on a cold start. While
    // it runs, the UI is already interactive; once a cached entry is
    // hydrated, `setQueryData` flips any active `useQuery` to that data
    // instantly (no flicker, no loading state — global `placeholderData`
    // covers the transition).
    hydrateCache(queryClient).finally(() => {
      if (!cancelled) setCacheReady(true);
    });
    return () => {
      cancelled = true;
      persistenceCleanup.current?.();
      persistenceCleanup.current = null;
      foregroundCleanup.current?.();
      foregroundCleanup.current = null;
    };
  }, []);

  // Pre-load icon fonts even though icons render as SVG. This stays
  // as a no-op safety net for any legacy code path that still emits
  // a Text-based glyph — they won't render as empty boxes.
  useEffect(() => {
    let cancelled = false;
    Font.loadAsync({
      ...(Ionicons as any).font,
      ...(MaterialCommunityIcons as any).font,
    })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setFontsReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Notification response listener — handles taps on push notifications
  // while the app is backgrounded or cold-started from a notification.
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, unknown>;
      // When the notification carries a checkId, navigate to that check.
      // We use console.log here because the navigation ref is not yet
      // available at the App level; screens pick up deep links via the
      // URL scheme instead. Non-critical — no alert on failure.
      if (data?.checkId) {
        console.log('[Push] Notification tapped with checkId:', data.checkId);
      }
    });
    return () => sub.remove();
  }, []);

  // Splash is gated only on auth resolution + font load. Persistent cache
  // hydration is decoupled — it runs in the background and updates queries
  // as it progresses. See the effect above for rationale.
  const showSplash = !authResolved || !fontsReady;

  return (
    <ErrorBoundary>
      <ThemeProvider>
        <ThemedRoot
          cacheReady={cacheReady}
          fontsReady={fontsReady}
          showSplash={showSplash}
          onAuthResolve={() => setAuthResolved(true)}
        />
      </ThemeProvider>
    </ErrorBoundary>
  );
}

interface ThemedRootProps {
  cacheReady: boolean;
  fontsReady: boolean;
  showSplash: boolean;
  onAuthResolve: () => void;
}

/**
 * ThemedRoot — pulls the active palette out of ThemeContext so the
 * SafeAreaProvider background, NavigationContainer theme, and StatusBar
 * style all flip with the dark-mode toggle. Living one level inside
 * <ThemeProvider> is the cleanest way to subscribe.
 */
function ThemedRoot({ cacheReady, fontsReady, showSplash, onAuthResolve }: ThemedRootProps) {
  const { mode, palette } = useThemeMode();
  return (
    <SafeAreaProvider style={{ backgroundColor: palette.bg.canvas }}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider queryClient={queryClient} onAuthResolve={onAuthResolve}>
          {/* SalaryNotificationProvider mounts the global "Деньги пришли"
              modal that pops up over any tab/screen when the current user
              has an unconfirmed salary payment. Must live INSIDE
              AuthProvider so it can read `useAuth()`, and inside
              QueryClientProvider so it can use the shared queryClient. */}
          <SalaryNotificationProvider>
            <NavigationContainer
              theme={{
                dark: mode === 'dark',
                colors: {
                  primary: palette.accent.primary,
                  background: palette.bg.canvas,
                  card: 'transparent',
                  text: palette.text.primary,
                  border: palette.border.subtle,
                  notification: palette.accent.primary,
                },
                fonts: {
                  regular: { fontFamily: 'System', fontWeight: '400' },
                  medium: { fontFamily: 'System', fontWeight: '500' },
                  bold: { fontFamily: 'System', fontWeight: '700' },
                  heavy: { fontFamily: 'System', fontWeight: '900' },
                },
              }}
            >
              <StatusBar
                barStyle={mode === 'dark' ? 'light-content' : 'dark-content'}
                backgroundColor="transparent"
                translucent
              />
              {fontsReady && <AppNavigator />}
              {showSplash && <SplashOverlay />}
            </NavigationContainer>
          </SalaryNotificationProvider>
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

// Silence unused-warning for the legacy import path that App.tsx
// re-exports indirectly (kept here so tree-shaking of `colors` stays
// referenced for tooling that scans named exports).
void colors;
