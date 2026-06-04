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
import { BroadcastNotificationProvider } from './src/contexts/BroadcastNotificationContext';
import AppNavigator from './src/navigation/AppNavigator';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import SplashOverlay from './src/components/SplashOverlay';
import { colors } from './src/theme';
import { hydrateCache, hydratePriorityCache, attachPersistence } from './src/utils/persistentCache';
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
      // 1 retry (was 2): with a 10s axios timeout, 2 retries meant a failing
      // query could hang the UI for ~30s before surfacing. One retry covers
      // the transient blip; persistent cache + placeholderData keep the
      // screen populated meanwhile.
      retry: 1,
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
  const [priorityHydrated, setPriorityHydrated] = useState(false);
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
    // Audit #8.7 — cold-start hydrate race. Step 1: synchronously hydrate
    // ONLY the priority first-screen keys (Dashboard / Журнал / Склад),
    // bounded to ~80ms. The splash stays up until this resolves so a fast
    // user reaching those screens never sees an empty flash. This is cheap:
    // a filtered multiGet over a handful of keys, with an internal watchdog
    // that guarantees boot is never blocked past the budget.
    hydratePriorityCache(queryClient).finally(() => {
      if (!cancelled) setPriorityHydrated(true);
      // Step 2: the FULL whitelist (~60 keys) hydrates in the background —
      // we do NOT gate first render on it. The AsyncStorage multiGet +
      // JSON.parse loop costs ~200-500ms; while it runs the UI is already
      // interactive, and once a cached entry lands, `setQueryData` flips any
      // active `useQuery` to that data instantly (no flicker — global
      // `placeholderData` covers the transition). Re-hydrating the priority
      // keys here is idempotent.
      hydrateCache(queryClient).finally(() => {
        if (!cancelled) setCacheReady(true);
      });
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
      // Tapped superadmin broadcast while backgrounded: there's no nav ref
      // here to push a screen, but the BroadcastNotificationProvider re-fetches
      // unseen broadcasts whenever the app returns to the foreground (AppState
      // → 'active'). Bringing the app forward via the tap therefore surfaces
      // the modal on its own — no extra handling needed at this level.
      if (data?.type === 'superadmin_broadcast') {
        console.log('[Push] Broadcast tapped — provider will surface it on foreground');
      }
    });
    return () => sub.remove();
  }, []);

  // Live-cash push listener — the backend sends a DATA-ONLY Expo push
  // `{ data: { type: 'cash-changed', tenantId } }` to OTHER tenant users
  // after a check / payment / expense. When received in the foreground we
  // invalidate the money query keys so the open screen updates live across
  // devices — a faster path that pairs with the existing 30s focus-poll.
  // Rapid pushes are coalesced (ignore if we invalidated < 2s ago) so a
  // burst of writes on another device triggers a single refetch wave here.
  useEffect(() => {
    let lastInvalidatedAt = 0;
    const COALESCE_MS = 2000;
    const sub = Notifications.addNotificationReceivedListener((notification) => {
      const data = notification.request.content.data as Record<string, unknown>;
      if (data?.type !== 'cash-changed') return;
      const now = Date.now();
      if (now - lastInvalidatedAt < COALESCE_MS) return;
      lastInvalidatedAt = now;
      // Money keys mirrored from the write-side invalidations in
      // CheckCreate / CheckDetail / Checks / Salary / CashFlow screens.
      queryClient.invalidateQueries({ queryKey: ['dashboard-v2'] });
      queryClient.invalidateQueries({ queryKey: ['cashflow'] });
      queryClient.invalidateQueries({ queryKey: ['checks-infinite'] });
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
    });
    return () => sub.remove();
  }, []);

  // Splash is gated on auth resolution + font load + the bounded priority
  // hydration. The FULL persistent-cache hydration stays decoupled — it runs
  // in the background and updates queries as it progresses. Gating on
  // `priorityHydrated` (capped at ~80ms) closes the audit #8.7 empty-flash on
  // the first screens without measurably slowing boot. See the effect above.
  const showSplash = !authResolved || !fontsReady || !priorityHydrated;

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
          {/* BroadcastNotificationProvider mounts the global superadmin
              broadcast modal — a center-screen blur-behind card that pops
              when «поддержка» sends an announcement. Lives alongside the
              salary modal provider (same AuthProvider + QueryClient scope). */}
          <SalaryNotificationProvider>
            <BroadcastNotificationProvider>
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
            </BroadcastNotificationProvider>
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
