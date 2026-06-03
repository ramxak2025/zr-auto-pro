/**
 * Service Worker API-cache purge — cross-tenant isolation.
 *
 * The PWA service worker (`public/sw.js`) caches GET `/api` responses keyed by
 * URL ONLY, deliberately ignoring the Authorization header so that the SWR
 * cache entry is shared across requests. The trade-off: on a shared
 * browser/kiosk a leftover `/api` response from tenant A could be served to
 * tenant B for up to the cache TTL (~30s) after a logout/login.
 *
 * On logout (and defensively on a 401 hard-redirect) we therefore drop the
 * entire `autexa-api-*` Cache Storage so the next login starts clean.
 *
 * Two strategies, used together for robustness:
 *   1. Message the active SW (`CLEAR_API_CACHE`) — it owns the cache, knows the
 *      versioned name, and can also abort any in-flight `cache.put`. We await
 *      its ACK via a MessageChannel so logout can block on completion.
 *   2. Directly delete any `autexa-api*` cache from the page via the Cache
 *      Storage API — covers the case where no SW controls the page yet
 *      (first load, hard refresh, SW updating).
 */

const SW_ACK_TIMEOUT_MS = 1500;

/** Ask the controlling SW to clear its API cache; resolves on ACK or timeout. */
function askServiceWorkerToClear(): Promise<void> {
  return new Promise((resolve) => {
    const controller =
      typeof navigator !== 'undefined' && 'serviceWorker' in navigator
        ? navigator.serviceWorker.controller
        : null;

    if (!controller) {
      resolve();
      return;
    }

    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    try {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => done();
      controller.postMessage({ type: 'CLEAR_API_CACHE' }, [channel.port2]);
      // Don't hang logout forever if the SW never ACKs.
      setTimeout(done, SW_ACK_TIMEOUT_MS);
    } catch {
      done();
    }
  });
}

/** Delete every Autexa API cache directly via the Cache Storage API. */
async function deleteApiCachesDirectly(): Promise<void> {
  if (typeof caches === 'undefined') return;
  try {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => k.startsWith('autexa-api'))
        .map((k) => caches.delete(k))
    );
  } catch {
    // best-effort
  }
}

/**
 * Purge all cached `/api` responses from the service worker. Best-effort and
 * safe to call when no SW / Cache Storage exists. Resolves once both the SW
 * ACK (or timeout) and the direct deletion have completed.
 */
export async function purgeApiCache(): Promise<void> {
  await Promise.all([askServiceWorkerToClear(), deleteApiCachesDirectly()]);
}
