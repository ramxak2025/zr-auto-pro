import React, { useEffect, useRef, useState } from 'react';
import { Alert, StatusBar } from 'react-native';
import { CommonActions, NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import NetInfo from '@react-native-community/netinfo';
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
import OfflineBanner from './src/components/OfflineBanner';
import { colors } from './src/theme';
import { haptic } from './src/platform/haptics';
import { hydrateCache, hydratePriorityCache, attachPersistence } from './src/utils/persistentCache';
import { attachForegroundRevalidation } from './src/utils/foregroundRevalidation';

// Wire TanStack Query's onlineManager to the real device connectivity
// (NetInfo). Without this RN has no `online`/`offline` browser events, so
// React Query would consider the app permanently online: offline queries
// would burn their retry and error out instead of pausing, and the
// OfflineBanner below would have no source of truth.
onlineManager.setEventListener((setOnline) =>
  NetInfo.addEventListener((state) => {
    setOnline(!!state.isConnected);
  }),
);

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
      // Retry policy: NEVER retry 4xx — they are deterministic (403 master
      // hitting an owner-only endpoint, 404 deleted entity); retrying only
      // doubles the spinner for an answer that cannot change. For TRANSIENT
      // failures — network errors (no err.response), timeouts, 5xx — retry up
      // to TWICE. The owner reported sections showing «Не удалось загрузить»
      // on first open that then worked on a manual «Повторить»: a single
      // flaky-DNS / cold-connection blip slipped past one retry and surfaced
      // as an error card. Two quick retries (500ms, 1000ms) absorb the blip
      // silently so the first open just works; cache + placeholderData keep
      // paint instant meanwhile.
      retry: (failureCount: number, error: Error) => {
        const status = (error as { response?: { status?: number } }).response?.status;
        if (status !== undefined && status >= 400 && status < 500) return false;
        return failureCount < 2;
      },
      retryDelay: (attempt: number) => Math.min(500 * 2 ** attempt, 2_000),
      refetchOnWindowFocus: false,
      // Global stale-while-revalidate: when a queryKey changes (eg. paging,
      // search, filters), keep showing the previous data until the new one
      // arrives instead of dropping back to a loading state. This is the
      // single biggest perceptible-perf win — search/pager swaps feel native.
      placeholderData: (prev: unknown) => prev,
    },
    mutations: {
      // Mutations must FAIL FAST when offline instead of pausing forever:
      // with the default networkMode 'online' an offline mutate() never
      // settles, so every button gated on `isPending` would hang until the
      // network returns. 'always' lets axios fail immediately → onError.
      networkMode: 'always',
      // Global fallback for the many mutations without a local onError —
      // a write that silently dies (offline, 500, validation) is the worst
      // failure mode for учёт. A mutation that defines its own onError
      // OVERRIDES this default, so there are never double alerts.
      onError: (err: unknown) => {
        haptic('error');
        const e = err as { response?: { data?: { message?: string | string[] } }; message?: string };
        const raw = e?.response?.data?.message;
        const serverMsg = Array.isArray(raw) ? raw.join('\n') : raw;
        Alert.alert('Ошибка', serverMsg || e?.message || 'Не удалось выполнить действие');
      },
    },
  },
});

// ── HOT query keys: 30s staleTime ────────────────────────────────────────────
// The global 2min staleTime is right for reference data (services, categories,
// users), but the screens users actually WATCH change — journal, склад,
// dashboard, schedule, suppliers — felt stale: renavigating within 2 minutes
// showed old numbers with no revalidation. Per-prefix defaults below drop
// staleTime to 30s for those keys only: persistent cache + global
// `placeholderData: prev => prev` still paint instantly from the previous
// data, and a background refetch fires whenever the screen (re)mounts after
// 30s. setQueryDefaults merges OVER defaultOptions and UNDER per-query
// options, so placeholderData / retry / gcTime are untouched, and any screen
// that sets its own staleTime keeps it.
//
// Interplay with foregroundRevalidation (attachForegroundRevalidation below):
// no double-refetch storm. Foreground transitions INVALIDATE their own key
// whitelist (one coalesced wave per 1s window) — invalidation refetches
// active queries regardless of staleTime, and a freshly refetched query has
// dataUpdatedAt ≈ now, so a navigation right after foregrounding is within
// the 30s window and does NOT trigger a second fetch. The two mechanisms
// cover disjoint triggers: AppState→active vs. screen remount.
const HOT_QUERY_PREFIXES: readonly string[][] = [
  ['checks-infinite'],
  ['products'],
  ['all-products-check'],
  ['clients-infinite'],
  ['dashboard-v2'],
  ['dashboard-chart'],
  ['schedule'],
  ['schedule-today'],
  ['warehouse-analytics'],
  ['suppliers'],
];
for (const prefix of HOT_QUERY_PREFIXES) {
  queryClient.setQueryDefaults(prefix, { staleTime: 30_000 });
}

// ── Push-tap navigation ──────────────────────────────────────────────────────
// Root navigation ref lets the notification-response listener (which lives
// OUTSIDE the navigator tree) deep-link into the app. `CheckDetail` is NOT
// registered on the root stack — it lives inside the Checks tab's nested
// stack (ChecksStack), so we navigate Main → Checks → CheckDetail; the tab
// bar stays visible, exactly like opening a check from Журнал by hand.
const navigationRef = createNavigationContainerRef();

// Cold-start queue: a tap on a push can arrive before the navigator has
// mounted (auth still resolving). Park the checkId and flush it in onReady.
let pendingCheckId: string | null = null;

// Dedupe guard — the same response can surface both via the live listener
// and via getLastNotificationResponseAsync() on cold start.
let lastHandledNotificationId: string | null = null;

function openCheckFromPush(checkId: string): void {
  if (!navigationRef.isReady()) {
    pendingCheckId = checkId;
    return;
  }
  navigationRef.dispatch(
    CommonActions.navigate('Main', {
      screen: 'Checks',
      params: { screen: 'CheckDetail', params: { id: checkId } },
    }),
  );
}

function handleNotificationResponse(response: Notifications.NotificationResponse): void {
  const id = response.notification.request.identifier;
  if (id && id === lastHandledNotificationId) return;
  lastHandledNotificationId = id;
  const data = response.notification.request.content.data as Record<string, unknown>;
  // When the notification carries a checkId, navigate to that check.
  if (data?.checkId) {
    openCheckFromPush(String(data.checkId));
  }
  // Tapped superadmin broadcast while backgrounded: no navigation needed —
  // the BroadcastNotificationProvider re-fetches unseen broadcasts whenever
  // the app returns to the foreground (AppState → 'active'). Bringing the
  // app forward via the tap therefore surfaces the modal on its own.
}

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
  // The actual navigation lives in handleNotificationResponse above (root
  // navigationRef + cold-start queue). getLastNotificationResponseAsync
  // covers the killed-app case, where the live listener can miss the tap
  // that launched the process; the identifier dedupe inside the handler
  // makes the two paths safe to run together.
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(handleNotificationResponse);
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (response) handleNotificationResponse(response);
      })
      .catch(() => {});
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
                ref={navigationRef}
                onReady={() => {
                  // Flush a push-tap that arrived before the navigator
                  // mounted (cold start from a notification).
                  if (pendingCheckId) {
                    const id = pendingCheckId;
                    pendingCheckId = null;
                    openCheckFromPush(id);
                  }
                }}
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
                {/* Offline strip mounts BEFORE the splash so the splash
                    still covers it during boot. Renders null while online. */}
                <OfflineBanner />
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
