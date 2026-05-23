/**
 * foregroundRevalidation — bridge between `AppState` and the QueryClient so
 * the user returning to the app sees the freshest critical numbers without
 * pulling-to-refresh.
 *
 * Why this exists:
 *   • TanStack Query has no `refetchOnWindowFocus` equivalent on RN by default.
 *   • `staleTime: 2 min` (App.tsx) means a user who comes back to the
 *     dashboard 30 minutes later sees their cached data first, with the
 *     fresh data arriving only AFTER they manually pull-to-refresh.
 *   • Owner UX expectation: open the app after lunch → cash position /
 *     today's revenue / low-stock / pending alerts already refreshed by
 *     the time the dashboard mounts.
 *
 * What it does:
 *   • Listens to `AppState.change`. When transitioning to `active`
 *     (foregrounded), invalidates a whitelist of CRITICAL keys that drive
 *     the owner dashboard, cashflow, journal and stock widgets.
 *   • Coalesces rapid background/active flips (iOS fires `inactive` →
 *     `active` on every notification-center pull) via a 1 s leading-edge
 *     debounce — we only invalidate once per genuine return-to-foreground.
 *   • Skips when no token is present — the user is on the login screen
 *     and there's nothing to refresh.
 *
 * Performance contract:
 *   • Whitelisted keys ONLY — never `invalidateQueries()` with no filter.
 *     A full invalidation refetches every cached key (suppliers / clients /
 *     products lists with their per-search variants) which would peg the
 *     network and JS thread for several seconds.
 *   • All invalidations are PARALLEL and fire-and-forget — we don't await
 *     them so the AppState handler returns immediately and React can paint
 *     the foreground transition.
 *   • Per-key staleTime is unchanged — TanStack respects the screen's
 *     existing query options. We just BUST the staleness so the next
 *     useQuery render does a background refetch.
 */
import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { QueryClient } from '@tanstack/react-query';

/**
 * Query-key prefixes to refresh when the app comes back to foreground.
 *
 * MUST stay narrow — these are the screens the owner glances at on
 * re-open. Adding more keys here means more network roundtrips on every
 * foreground transition; broad lists (clients, suppliers, products) are
 * NOT in this list because their staleTime + persistent cache already
 * cover the perceived-freshness contract.
 */
const FOREGROUND_REVALIDATE_KEYS: readonly (readonly string[])[] = [
  // Owner dashboard core widgets — cash position, today revenue, deltas.
  ['dashboard-v2'],
  ['dashboard-chart'],
  // Journal first page (the user typically lands here right after the
  // dashboard). Both pagination shapes covered.
  ['checks-infinite'],
  ['checks-dashboard'],
  // Cashflow screen — money in / money out by day.
  ['cashflow'],
  // Warehouse analytics (summary + reorder forecast) — owner cares about
  // these every morning.
  ['warehouse-analytics'],
  // Today's schedule + low stock — small payloads, instant refresh.
  ['schedule-today'],
  ['low-stock'],
  // Calls funnel + summary — owner watches missed calls.
  ['calls-summary'],
  ['call-funnel'],
  // Marketing dashboard (reviews / NPS) — small, owner-relevant.
  ['marketing-dashboard'],
] as const;

/** Min interval between two foreground invalidations. */
const COALESCE_WINDOW_MS = 1_000;

/**
 * Attach the AppState listener. Returns an unsubscribe function — call
 * during cleanup (App.tsx unmount) so we don't leak the listener.
 */
export function attachForegroundRevalidation(qc: QueryClient): () => void {
  let lastFiredAt = 0;
  let prevState: AppStateStatus = AppState.currentState;

  const onChange = (next: AppStateStatus) => {
    // Only invalidate on a CLEAN transition into `active`. Specifically:
    // ignore `active` → `active` no-ops (which iOS sometimes emits) and
    // any `unknown` start-up state.
    const isComingToForeground = next === 'active' && prevState !== 'active';
    prevState = next;
    if (!isComingToForeground) return;

    const now = Date.now();
    if (now - lastFiredAt < COALESCE_WINDOW_MS) return;
    lastFiredAt = now;

    // Don't refetch when there's no session — the user is on the login
    // screen and any 401 we'd trigger would just feed the auth-expired
    // listener for no reason.
    AsyncStorage.getItem('token')
      .then((token) => {
        if (!token) return;
        // Fire-and-forget. Each invalidate triggers a refetch of
        // currently-mounted queries with the matching prefix; unmounted
        // queries stay cold until the screen opens.
        for (const key of FOREGROUND_REVALIDATE_KEYS) {
          qc.invalidateQueries({ queryKey: key as unknown as readonly unknown[] }).catch(() => {});
        }
      })
      .catch(() => {});
  };

  const sub: NativeEventSubscription = AppState.addEventListener('change', onChange);
  return () => {
    sub.remove();
  };
}
