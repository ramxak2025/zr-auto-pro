/**
 * backendRecovery — automatically recover errored queries when the backend
 * comes back, WITHOUT a manual «Повторить» tap.
 *
 * WHY THIS EXISTS (2026-06-18 root-cause work):
 *   A 502 from a backend redeploy is NOT an "offline" event — the device's
 *   socket stays up, so NetInfo never flips, `onlineManager` never changes,
 *   and `refetchOnReconnect` / `queryCache.onOnline()` NEVER fire. An errored
 *   query therefore stays terminally errored until the user retries by hand;
 *   and a manual retry fired inside the still-open 502 window fails again
 *   ("повторить не помогает"). The widened transient-retry policy
 *   (utils/queryRetry.ts) rides through a typical window, but for a longer or
 *   migration-heavy deploy we still need a self-heal once the backend returns.
 *
 * WHAT IT DOES:
 *   Whenever an ACTIVE (mounted) query is observed in `error` state and the
 *   device is online, it polls GET {apiUrl}/health on a capped backoff
 *   (2s → 4s → 8s). The first 200 means the backend is back, so it refetches
 *   every active errored query at once. It polls ONLY while something is
 *   errored, stops on the first success, honours connectivity, and applies a
 *   short cooldown after a recovery refetch so the in-flight refetch (whose
 *   status is still 'error' until it resolves) can't spin the loop. So it is
 *   neither a request storm nor a battery drain.
 *
 * DESIGN: the controller (`createRecoveryController`) is fully
 * dependency-injected and has NO runtime imports, so it is deterministically
 * unit-testable. `attachBackendRecovery` wires it to the real QueryClient,
 * `onlineManager`, `fetch` and timers.
 */
import { onlineManager } from '@tanstack/react-query';
import type { Query, QueryClient } from '@tanstack/react-query';
import { isDeterministicClientError } from './queryRetry';

/** Capped backoff between health probes while a query is errored. */
export const PROBE_BACKOFF_MS: readonly number[] = [2_000, 4_000, 8_000];

/** Abort a health probe that hangs past this (a dead backend may not RST). */
const PROBE_TIMEOUT_MS = 6_000;

/**
 * After a recovery refetch we stop the loop and wait this long before a new
 * error event may re-arm it. The refetch keeps `status === 'error'` until it
 * resolves, so without this cooldown the very next 'updated' event would
 * immediately restart probing against a backend we just confirmed healthy.
 */
const RESTART_COOLDOWN_MS = 4_000;

export interface RecoveryDeps {
  /** Is at least one ACTIVE (mounted) query currently in error state? */
  hasErroredQueries: () => boolean;
  /** Refetch every active errored query. */
  refetchErrored: () => void;
  /** Probe backend reachability — resolves true on a 2xx /health. */
  probeHealth: () => Promise<boolean>;
  /** Device connectivity (onlineManager.isOnline()). */
  isOnline: () => boolean;
  /** Monotonic-ish clock (Date.now). Injected for tests. */
  now: () => number;
  scheduleTimeout: (fn: () => void, ms: number) => unknown;
  clearScheduled: (handle: unknown) => void;
}

export interface RecoveryController {
  /** Arm the probe loop — call when a query is observed in error state. */
  trigger: () => void;
  /** Cancel any pending probe (cleanup / unmount). */
  stop: () => void;
}

/**
 * A query worth auto-recovering. It must be:
 *   • settled in `error` (not pending/success),
 *   • ACTIVE (mounted with an enabled observer) — a disabled query (e.g.
 *     CashFlow `enabled: canViewCashFlow`, the pollEnabled gates) is neither
 *     refetchable via `type:'active'` nor a real outage signal, and
 *   • a TRANSIENT failure (network / timeout / 5xx) — NOT a deterministic 4xx.
 *
 * Excluding 4xx is the key guard: a mounted 403 (master on an owner-only
 * endpoint) or 404 (deleted entity) would otherwise keep the loop armed and
 * fire pointless /health probes + a refetch the retry policy then refuses,
 * draining battery/network against a perfectly HEALTHY backend. /health is a
 * liveness-only probe, so a 200 must only translate into refetching the
 * failures it can actually fix.
 *
 * Pure (no runtime imports beyond the shared 4xx classifier) so it is unit-
 * testable; `attachBackendRecovery` calls it with `q.state.status`,
 * `q.isActive()` and `q.state.error`.
 */
export function isRecoverableErrored(status: string, isActive: boolean, error: unknown): boolean {
  return status === 'error' && isActive && !isDeterministicClientError(error);
}

/**
 * Pure, injectable recovery loop. See module docs for the lifecycle.
 */
export function createRecoveryController(deps: RecoveryDeps): RecoveryController {
  let handle: unknown = null;
  let attempt = 0;
  let cooldownUntil = 0;
  let probing = false;

  function clearPending() {
    if (handle !== null) {
      deps.clearScheduled(handle);
      handle = null;
    }
  }

  function stop() {
    clearPending();
    probing = false;
    attempt = 0;
  }

  function schedule() {
    clearPending();
    const ms = PROBE_BACKOFF_MS[Math.min(attempt, PROBE_BACKOFF_MS.length - 1)];
    handle = deps.scheduleTimeout(tick, ms);
  }

  async function tick() {
    handle = null;
    if (!probing) return;
    if (!deps.hasErroredQueries() || !deps.isOnline()) {
      stop();
      return;
    }

    let healthy = false;
    try {
      healthy = await deps.probeHealth();
    } catch {
      healthy = false;
    }

    // The world may have changed during the await (screen unmounted, went
    // offline, or the 30s poll already healed everything).
    if (!probing) return;
    if (!deps.hasErroredQueries() || !deps.isOnline()) {
      stop();
      return;
    }

    if (healthy) {
      deps.refetchErrored();
      cooldownUntil = deps.now() + RESTART_COOLDOWN_MS;
      // Rely on `trigger` (via the cache subscription) to re-arm AFTER the
      // cooldown if the refetch itself errors again — no tight loop.
      stop();
      return;
    }

    attempt = attempt + 1 < PROBE_BACKOFF_MS.length ? attempt + 1 : PROBE_BACKOFF_MS.length - 1;
    schedule();
  }

  function trigger() {
    if (probing) return;
    if (!deps.hasErroredQueries() || !deps.isOnline()) return;
    if (deps.now() < cooldownUntil) return;
    probing = true;
    attempt = 0;
    schedule();
  }

  return { trigger, stop };
}

/**
 * Wire the recovery controller to the real app. Subscribes to the query
 * cache and arms the probe whenever a query enters/holds error state.
 * Returns an unsubscribe function — keep it for the app lifetime.
 */
export function attachBackendRecovery(qc: QueryClient, apiUrl: string): () => void {
  const recoverable = (q: Query) => isRecoverableErrored(q.state.status, q.isActive(), q.state.error);
  const controller = createRecoveryController({
    hasErroredQueries: () => qc.getQueryCache().getAll().some(recoverable),
    refetchErrored: () => {
      // Only ACTIVE, TRANSIENTLY-errored queries — never wake unmounted ones,
      // never touch a deterministic 4xx. `cancelRefetch: false` is critical:
      // it must NOT abort a query's own in-flight ~31s transient-retry chain
      // (the ride-through this whole module backs up) — recovery only kicks
      // queries that are SETTLED in error.
      qc.refetchQueries({ type: 'active', predicate: recoverable }, { cancelRefetch: false }).catch(() => {});
    },
    probeHealth: async () => {
      const abort = new AbortController();
      const t = setTimeout(() => abort.abort(), PROBE_TIMEOUT_MS);
      try {
        const res = await fetch(`${apiUrl}/health`, { method: 'GET', signal: abort.signal });
        return res.ok;
      } catch {
        return false;
      } finally {
        clearTimeout(t);
      }
    },
    isOnline: () => onlineManager.isOnline(),
    now: () => Date.now(),
    scheduleTimeout: (fn, ms) => setTimeout(fn, ms),
    clearScheduled: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  });

  const unsubscribe = qc.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated') return;
    if (event.query.state.status === 'error') controller.trigger();
  });

  return () => {
    unsubscribe();
    controller.stop();
  };
}
