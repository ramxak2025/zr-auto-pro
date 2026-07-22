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
 *   device is online, it asks the shared API-host selector to re-probe the
 *   WHOLE failover ring on a capped backoff (2s → 4s → 8s). The first
 *   healthy host is adopted before active errored queries are refetched. This
 *   matters after Wi-Fi/LTE/VPN changes: probing only the old/static primary
 *   can report an outage even while another ring member is reachable. It
 *   polls ONLY while something is errored, stops on the first success,
 *   honours connectivity, and applies a short cooldown after a recovery
 *   refetch so the in-flight refetch can't spin the loop.
 *
 * DESIGN: the controller (`createRecoveryController`) is fully
 * dependency-injected and has NO runtime dependencies of its own, so it is
 * deterministically unit-testable. `attachBackendRecovery` wires it to the
 * real QueryClient, `onlineManager`, shared host selector and timers.
 */
import { onlineManager } from '@tanstack/react-query';
import type { Query, QueryClient } from '@tanstack/react-query';
import { reselectApiHost } from '../api/axios';
import { isDeterministicClientError } from './queryRetry';

/** Capped backoff between health probes while a query is errored. */
export const PROBE_BACKOFF_MS: readonly number[] = [2_000, 4_000, 8_000];

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
  /** Probe ring reachability — true after a /health `{status:"ok"}` winner
   *  has been selected and adopted. */
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
 * Route-relevant subset of NetInfo. `isInternetReachable` and radio metrics
 * are deliberately absent: Android/iOS can update reachability, Wi-Fi signal
 * strength and link speed frequently without changing the actual route. A
 * selector run for every such telemetry tick would waste radio and battery.
 */
export interface NetworkRouteStateLike {
  isConnected: boolean | null;
  type: string;
  details: object | null;
}

const ROUTE_DETAIL_KEYS: readonly string[] = [
  'isConnectionExpensive',
  'ssid',
  'bssid',
  'ipAddress',
  'subnet',
  'carrier',
  'cellularGeneration',
];

/**
 * Stable fingerprint for changes that can select a different API route:
 * offline/online, Wi-Fi/cellular/VPN type, Wi-Fi identity/address and carrier
 * details. Used by App.tsx to avoid re-running the ring for noisy NetInfo
 * updates that do not represent a route change.
 */
export function getNetworkRouteSignature(state: NetworkRouteStateLike): string {
  const details = (state.details ?? {}) as Record<string, unknown>;
  return JSON.stringify([state.isConnected, state.type, ...ROUTE_DETAIL_KEYS.map((key) => details[key] ?? null)]);
}

export interface ApiRouteRecoveryController {
  /** Feed NetInfo snapshots; the first snapshot establishes a baseline. */
  onNetworkState: (state: NetworkRouteStateLike) => void;
  /** Feed React Native AppState changes. */
  onAppState: (nextState: string) => void;
  /** Feed a final axios network-class failure. */
  onNetworkFailure: () => void;
}

interface ApiRouteRecoveryDeps {
  initialAppState: string;
  reselect: (forceFreshRoute?: boolean) => Promise<string | null>;
}

/**
 * Small state machine behind App.tsx's native listeners. Keeping transition
 * judgment here makes reconnect/VPN/foreground behaviour deterministic and
 * unit-testable without mounting React Native.
 *
 * `reselect(true)` — сигнал «маршрут реально сменился»: селектор (axios.ts)
 * синхронно чистит circuit'ы кольца и серию гистерезиса primary-return, метит
 * прежнюю активную базу подозрительной (укороченный бюджет мутаций, C-4) и
 * гонит пробы ПОЛНЫМ кольцом primary-first (C-3). Сбойный сигнал
 * (`reselect(false)`) ничего из этого не делает — гистерезис против маятника
 * при операторском троттлинге сохраняется.
 *
 * FOREGROUND (C-фикс волны C.1): сам по себе вход в приложение НЕ доказывает
 * смену маршрута. Форсить reselect(true) на каждом foreground — значит под
 * операторским троттлингом каждый вход дёргает сессию на полуживой primary
 * (тот самый маятник, который убирал гистерезис). Поэтому при уходе в фон
 * запоминается текущая network-signature (последний NetInfo-снапшот —
 * подписка живёт весь lifetime приложения, см. App.tsx), а на foreground она
 * сравнивается с актуальной: изменилась → reselect(true); нет → мягкий
 * reselect(false). Смена сети, чей NetInfo-снапшот доезжает уже ПОСЛЕ
 * активации, форсится самим onNetworkState — этот путь не менялся.
 */
export function createApiRouteRecoveryController(deps: ApiRouteRecoveryDeps): ApiRouteRecoveryController {
  let previousRoute: string | null = null;
  let previousAppState = deps.initialAppState;
  /** Network-signature на момент ухода в фон (null — фона ещё не было / нет baseline). */
  let backgroundRoute: string | null = null;

  const requestReselection = (forceFreshRoute = false) => {
    try {
      void deps.reselect(forceFreshRoute).catch(() => {});
    } catch {
      // A recovery signal must never escape into a native event emitter.
    }
  };

  const onNetworkState = (state: NetworkRouteStateLike) => {
    const nextRoute = getNetworkRouteSignature(state);
    const routeChanged = previousRoute !== null && previousRoute !== nextRoute;
    previousRoute = nextRoute;
    // Going offline records the new baseline but cannot produce a winner.
    // The subsequent offline→online snapshot differs and performs the race.
    if (routeChanged && state.isConnected !== false) requestReselection(true);
  };

  const onAppState = (nextState: string) => {
    const cameToForeground = nextState === 'active' && previousAppState !== 'active';
    const leftForeground = previousAppState === 'active' && nextState !== 'active';
    previousAppState = nextState;
    if (leftForeground) {
      // Снимок маршрута в момент ухода (active→inactive/background). Повторные
      // background-события без active между ними снимок не перетирают.
      backgroundRoute = previousRoute;
      return;
    }
    if (cameToForeground) {
      const routeChangedWhileBackgrounded =
        backgroundRoute !== null && previousRoute !== null && backgroundRoute !== previousRoute;
      requestReselection(routeChangedWhileBackgrounded);
    }
  };

  // A final HTTP failure is not evidence that the native route changed, so it
  // joins any in-flight selector instead of invalidating a useful health pass.
  return { onNetworkState, onAppState, onNetworkFailure: () => requestReselection(false) };
}

/**
 * Probe and adopt the first healthy member of the complete API ring. The
 * selector owns timeouts, validation, debounce/in-flight dedupe and stale
 * generation protection. Never throw into the recovery controller.
 */
export async function probeApiRing(): Promise<boolean> {
  try {
    return (await reselectApiHost()) !== null;
  } catch {
    return false;
  }
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

  /**
   * A refetch may fail so quickly that its cache `error` notification arrives
   * inside the cooldown. Dropping that notification used to leave recovery
   * stopped forever because there might be no later cache event to call
   * `trigger()` again. Keep one wake-up armed for the exact cooldown boundary;
   * it starts a normal backoff cycle only if the error is still recoverable.
   */
  function scheduleCooldownWake() {
    if (handle !== null) return;
    const remainingMs = Math.max(0, cooldownUntil - deps.now());
    handle = deps.scheduleTimeout(() => {
      handle = null;
      if (probing || !deps.hasErroredQueries() || !deps.isOnline()) return;
      probing = true;
      attempt = 0;
      schedule();
    }, remainingMs);
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
      cooldownUntil = deps.now() + RESTART_COOLDOWN_MS;
      // Stop BEFORE refetching: QueryClient may synchronously emit the new
      // state from `refetchQueries()`. That trigger must see the cooldown and
      // arm its expiry instead of being discarded as "already probing".
      stop();
      deps.refetchErrored();
      return;
    }

    attempt = attempt + 1 < PROBE_BACKOFF_MS.length ? attempt + 1 : PROBE_BACKOFF_MS.length - 1;
    schedule();
  }

  function trigger() {
    if (probing) return;
    if (!deps.hasErroredQueries() || !deps.isOnline()) return;
    if (deps.now() < cooldownUntil) {
      scheduleCooldownWake();
      return;
    }
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
export function attachBackendRecovery(qc: QueryClient): () => void {
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
    probeHealth: probeApiRing,
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
