/**
 * BroadcastNotificationContext — surfaces superadmin → director broadcasts
 * («объявления от поддержки») as a global center-screen <BroadcastModal />.
 *
 * Mirrors SalaryNotificationContext: mounted once inside <App />, so a
 * broadcast can pop over any tab / detail screen without each screen wiring
 * it up.
 *
 * Detection strategy (uses the FROZEN contract — no new endpoint):
 *
 *   1. On mount (cold-start with an active session) and on every AppState
 *      change to 'active' (foreground), the provider calls
 *      `notificationsApi.listUnseenBroadcasts()` (newest first).
 *   2. The returned broadcasts are queued; the newest is shown first.
 *   3. After the user dismisses one, `markBroadcastSeen(id)` is fired and the
 *      next queued broadcast (if any) is shown.
 *   4. A foreground push listener watches for
 *      `data.type === 'superadmin_broadcast'` and re-fetches unseen so a
 *      freshly-sent broadcast appears immediately even while the app is open.
 *
 * Durability (the force-kill bug fix):
 *
 *   • Dismissed ids are PERSISTED per-user to AsyncStorage (`seenIds`). They
 *     seed the in-memory `handledIds` guard on next launch, so a broadcast the
 *     user already closed never re-pops after a force-kill — even if the
 *     network `markBroadcastSeen` never reached the server.
 *   • A dismissed id whose `markBroadcastSeen` failed is also kept in a
 *     persisted `pendingSeen` reconcile queue and retried with backoff and on
 *     every foreground until the server confirms — so a transient network
 *     failure never leaves a broadcast "unseen forever" on the server.
 *
 * Why re-fetch instead of trusting the push payload: the unseen endpoint is
 * the source of truth (persisted, de-duplicated, ordered) and survives a
 * missed/duplicated push. The push only acts as a "wake up and check" nudge.
 *
 * Tapping a broadcast push while backgrounded is handled by App.tsx's
 * response listener — see the comment there. Since App.tsx has no nav ref,
 * it relies on the app returning to foreground (which triggers our
 * listUnseenBroadcasts) to surface the modal.
 */
import React from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { notificationsApi } from '../api/services';
import { useAuth } from './AuthContext';
import BroadcastModal from '../components/BroadcastModal';
import type { Broadcast } from '../../../shared/types';

interface BroadcastNotificationContextValue {
  /** Re-fetches unseen broadcasts and queues any new ones. */
  refresh: () => void;
}

const BroadcastNotificationContext = React.createContext<BroadcastNotificationContextValue | null>(null);

interface ProviderProps {
  children: React.ReactNode;
}

// AsyncStorage keys are namespaced per-user: broadcast seen-state is per-user
// on the server (superadmin → every director), so device A's user must not
// inherit another account's local "seen" set after a logout/login or an
// impersonation swap.
const seenKey = (uid: string) => `@autexa/broadcasts/${uid}/seen`;
const pendingKey = (uid: string) => `@autexa/broadcasts/${uid}/pending`;
// Cap the persisted "seen" list — broadcasts are rare, but we never want this
// to grow unbounded. The newest ids matter (older ones are already `seen` on
// the server, which filters them out of `unseen` regardless).
const SEEN_CAP = 200;
// Reconcile backoff for a failed markBroadcastSeen: 3s → 9s → 27s → … 60s.
const BACKOFF_START = 3000;
const BACKOFF_MAX = 60000;

function parseIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function BroadcastNotificationProvider({ children }: ProviderProps) {
  const { user } = useAuth();

  // `current` is the broadcast on screen; `queue` holds the rest (newest is
  // surfaced first because the endpoint returns newest-first).
  const [current, setCurrent] = React.useState<Broadcast | null>(null);
  const [queue, setQueue] = React.useState<Broadcast[]>([]);
  // Ids we've already shown/queued/seen — guards against a re-fetch re-queuing
  // a broadcast that's on screen, queued, or already dismissed. Seeded from the
  // persisted `seenIds` on launch so a dismissed broadcast never re-pops.
  const handledIds = React.useRef<Set<string>>(new Set());
  // Persisted: ids the user has DISMISSED (block re-pop forever, locally).
  const seenIds = React.useRef<Set<string>>(new Set());
  // Persisted: dismissed ids whose markBroadcastSeen hasn't been confirmed by
  // the server yet — retried on backoff + every foreground until it sticks.
  const pendingSeen = React.useRef<Set<string>>(new Set());
  // True once persisted state for the current user is loaded — `checkOnce`
  // no-ops before this so a fetch can't re-pop a persisted-seen broadcast in
  // the hydration gap.
  const hydrated = React.useRef(false);
  // Reconcile guards.
  const flushing = React.useRef(false);
  const flushTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushDelay = React.useRef(BACKOFF_START);

  const clearFlushTimer = React.useCallback(() => {
    if (flushTimer.current) {
      clearTimeout(flushTimer.current);
      flushTimer.current = null;
    }
    flushDelay.current = BACKOFF_START;
  }, []);

  const persistSeen = React.useCallback(async (uid: string) => {
    try {
      // Keep only the newest SEEN_CAP ids (insertion order = oldest→newest).
      const capped = [...seenIds.current].slice(-SEEN_CAP);
      seenIds.current = new Set(capped);
      await AsyncStorage.setItem(seenKey(uid), JSON.stringify(capped));
    } catch {
      // best-effort — re-pop guard degrades to session-only on storage failure
    }
  }, []);

  const persistPending = React.useCallback(async (uid: string) => {
    try {
      await AsyncStorage.setItem(pendingKey(uid), JSON.stringify([...pendingSeen.current]));
    } catch {
      // best-effort
    }
  }, []);

  // Retry markBroadcastSeen for every queued-but-unconfirmed dismissal.
  const flushPendingSeen = React.useCallback(
    async (uid: string) => {
      if (flushing.current || pendingSeen.current.size === 0) return;
      flushing.current = true;
      try {
        let changed = false;
        for (const id of [...pendingSeen.current]) {
          try {
            await notificationsApi.markBroadcastSeen(id);
            pendingSeen.current.delete(id);
            changed = true;
          } catch {
            // leave it queued — retried on next foreground / backoff tick
          }
        }
        if (changed) await persistPending(uid);
      } finally {
        flushing.current = false;
      }
    },
    [persistPending],
  );

  // Self-rescheduling backoff: runs a flush; if anything is still pending,
  // re-arms with a growing delay (capped). Cleared once the queue empties.
  const scheduleFlush = React.useCallback(
    (uid: string) => {
      if (flushTimer.current) return; // a chain is already running
      const run = async () => {
        flushTimer.current = null;
        await flushPendingSeen(uid);
        if (pendingSeen.current.size > 0) {
          flushDelay.current = Math.min(flushDelay.current * 3, BACKOFF_MAX);
          flushTimer.current = setTimeout(run, flushDelay.current);
        } else {
          flushDelay.current = BACKOFF_START;
        }
      };
      flushTimer.current = setTimeout(run, flushDelay.current);
    },
    [flushPendingSeen],
  );

  const enqueue = React.useCallback((items: Broadcast[]) => {
    setCurrent((cur) => {
      // Drop anything already on screen, queued, or handled (incl. persisted).
      const fresh = items.filter((b) => !handledIds.current.has(b.id) && (!cur || cur.id !== b.id));
      if (fresh.length === 0) return cur;
      fresh.forEach((b) => handledIds.current.add(b.id));
      if (cur) {
        // Something's already showing — append the rest to the queue.
        setQueue((q) => [...q, ...fresh]);
        return cur;
      }
      // Nothing showing — surface the first, queue the remainder.
      const [first, ...rest] = fresh;
      if (rest.length > 0) setQueue((q) => [...q, ...rest]);
      return first;
    });
  }, []);

  const checkOnce = React.useCallback(async () => {
    if (!user || !hydrated.current) return;
    try {
      const res = await notificationsApi.listUnseenBroadcasts();
      if (Array.isArray(res.data) && res.data.length > 0) {
        enqueue(res.data);
      }
    } catch {
      // Silent — push or the next foreground change re-triggers us.
    }
  }, [user, enqueue]);

  // Per-user lifecycle: hydrate persisted state → reconcile pending → check.
  // Reset everything on logout so a stale broadcast never shows on the login
  // screen and the next user starts from their own persisted set.
  React.useEffect(() => {
    if (!user) {
      hydrated.current = false;
      setCurrent(null);
      setQueue([]);
      handledIds.current.clear();
      seenIds.current.clear();
      pendingSeen.current.clear();
      clearFlushTimer();
      return;
    }
    const uid = user.id;
    let cancelled = false;
    hydrated.current = false;
    (async () => {
      try {
        const [seenRaw, pendingRaw] = await Promise.all([
          AsyncStorage.getItem(seenKey(uid)),
          AsyncStorage.getItem(pendingKey(uid)),
        ]);
        if (cancelled) return;
        const seen = parseIds(seenRaw);
        const pending = parseIds(pendingRaw);
        seenIds.current = new Set(seen);
        pendingSeen.current = new Set(pending);
        // Seed the in-memory guard so a persisted-seen / still-pending broadcast
        // never re-pops, even immediately after a force-kill.
        seen.forEach((id) => handledIds.current.add(id));
        pending.forEach((id) => handledIds.current.add(id));
      } catch {
        // best-effort — fall back to session-only behaviour
      }
      if (cancelled) return;
      hydrated.current = true;
      // Reconcile any unconfirmed dismissals, then look for new broadcasts.
      flushPendingSeen(uid);
      checkOnce();
    })();
    return () => {
      cancelled = true;
    };
  }, [user, checkOnce, flushPendingSeen, clearFlushTimer]);

  // Foreground events — a superadmin often sends the broadcast while the
  // user's app is backgrounded. On return to 'active' we re-check AND retry any
  // pending "seen" reconcile so a transient failure self-heals.
  React.useEffect(() => {
    const onChange = (s: AppStateStatus) => {
      if (s !== 'active' || !user) return;
      flushPendingSeen(user.id);
      checkOnce();
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [user, checkOnce, flushPendingSeen]);

  // Foreground push listener — when a broadcast push arrives while the app is
  // open the OS doesn't surface a banner, so we re-fetch unseen and show it.
  React.useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener((notification) => {
      const data = notification.request.content.data as Record<string, unknown> | undefined;
      if (data?.type === 'superadmin_broadcast') {
        checkOnce();
      }
    });
    return () => sub.remove();
  }, [checkOnce]);

  // Clear any outstanding backoff timer on unmount.
  React.useEffect(() => () => clearFlushTimer(), [clearFlushTimer]);

  const onDismiss = React.useCallback(async () => {
    const dismissed = current;
    // Advance to the next queued broadcast (or clear) immediately for snappy
    // feedback, then persist the "seen" state in the background.
    setQueue((q) => {
      const [next, ...rest] = q;
      setCurrent(next ?? null);
      return rest;
    });
    if (!dismissed || !user) return;
    const uid = user.id;
    // Block re-pop locally FOREVER (survives force-kill), and queue a server
    // reconcile so the dismissal eventually sticks even offline.
    seenIds.current.add(dismissed.id);
    pendingSeen.current.add(dismissed.id);
    handledIds.current.add(dismissed.id);
    persistSeen(uid);
    persistPending(uid);
    try {
      await notificationsApi.markBroadcastSeen(dismissed.id);
      pendingSeen.current.delete(dismissed.id);
      persistPending(uid);
    } catch {
      // Network failed — keep it queued and retry with backoff. The id stays
      // in `seenIds`, so it won't re-pop in the meantime.
      scheduleFlush(uid);
    }
  }, [current, user, persistSeen, persistPending, scheduleFlush]);

  const ctx = React.useMemo<BroadcastNotificationContextValue>(() => ({ refresh: checkOnce }), [checkOnce]);

  return (
    <BroadcastNotificationContext.Provider value={ctx}>
      {children}
      <BroadcastModal broadcast={current} onDismiss={onDismiss} />
    </BroadcastNotificationContext.Provider>
  );
}

export function useBroadcastNotification(): BroadcastNotificationContextValue {
  const ctx = React.useContext(BroadcastNotificationContext);
  if (!ctx) {
    throw new Error('useBroadcastNotification must be used within <BroadcastNotificationProvider>');
  }
  return ctx;
}
