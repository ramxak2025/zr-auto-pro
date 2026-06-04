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

export function BroadcastNotificationProvider({ children }: ProviderProps) {
  const { user } = useAuth();

  // `current` is the broadcast on screen; `queue` holds the rest (newest is
  // surfaced first because the endpoint returns newest-first).
  const [current, setCurrent] = React.useState<Broadcast | null>(null);
  const [queue, setQueue] = React.useState<Broadcast[]>([]);
  // Ids we've already shown/seen this session — guards against a re-fetch
  // re-queuing a broadcast that's currently on screen or just dismissed.
  const handledIds = React.useRef<Set<string>>(new Set());

  const enqueue = React.useCallback((items: Broadcast[]) => {
    setCurrent((cur) => {
      // Drop anything already on screen, queued, or handled this session.
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
    if (!user) return;
    try {
      const res = await notificationsApi.listUnseenBroadcasts();
      if (Array.isArray(res.data) && res.data.length > 0) {
        enqueue(res.data);
      }
    } catch {
      // Silent — push or the next foreground change re-triggers us.
    }
  }, [user, enqueue]);

  // Initial check on login / cold-start with an active session. Reset all
  // state on logout so a stale broadcast never shows on the login screen.
  React.useEffect(() => {
    if (!user) {
      setCurrent(null);
      setQueue([]);
      handledIds.current.clear();
      return;
    }
    checkOnce();
  }, [user, checkOnce]);

  // Foreground events — a superadmin often sends the broadcast while the
  // user's app is backgrounded. On return to 'active' we re-check so the
  // modal pops immediately.
  React.useEffect(() => {
    const onChange = (s: AppStateStatus) => {
      if (s === 'active') checkOnce();
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [checkOnce]);

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

  const onDismiss = React.useCallback(async () => {
    const dismissed = current;
    // Advance to the next queued broadcast (or clear) immediately for snappy
    // feedback, then persist the "seen" state in the background.
    setQueue((q) => {
      const [next, ...rest] = q;
      setCurrent(next ?? null);
      return rest;
    });
    if (dismissed) {
      try {
        await notificationsApi.markBroadcastSeen(dismissed.id);
      } catch {
        // Non-fatal — the id stays in `handledIds` so it won't re-pop this
        // session; the next foreground fetch reconciles with the server.
      }
    }
  }, [current]);

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
