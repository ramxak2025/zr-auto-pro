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

/** Send a message to the controlling SW; resolves on ACK or timeout. */
function askServiceWorker(type: string): Promise<void> {
  return new Promise((resolve) => {
    const controller =
      typeof navigator !== 'undefined' && 'serviceWorker' in navigator ? navigator.serviceWorker.controller : null;

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
      controller.postMessage({ type }, [channel.port2]);
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
    await Promise.all(keys.filter((k) => k.startsWith('autexa-api')).map((k) => caches.delete(k)));
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
  await Promise.all([askServiceWorker('CLEAR_API_CACHE'), deleteApiCachesDirectly()]);
}

// ─── Offline mutation queue purge (logout / session change) ──────────────────
//
// The SW keeps unsent POST/PATCH/DELETE mutations in IndexedDB `autexa-sw`
// (stores: pending queue + failed archive). On replay the SW attaches the
// CURRENT session's token (records don't carry Authorization since SW v14),
// so a queue left over from user A would be replayed under user B's token —
// a write into the wrong tenant. Both stores must therefore die with the
// session, same two-pronged strategy as the API cache above.

const SW_IDB_NAME = 'autexa-sw';
const SW_IDB_STORES = ['autexa-offline-queue', 'autexa-offline-failed'];

/** Clear the SW queue stores directly from the page (works with no SW too). */
async function clearOfflineStoresDirectly(): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  try {
    // Open WITHOUT a version: never upgrade/alter the SW-owned schema from the
    // page. (If the DB doesn't exist yet this creates an empty shell — the SW
    // upgrades it to its own schema on next use; harmless.)
    const db = await new Promise<IDBDatabase | null>((resolve) => {
      const req = indexedDB.open(SW_IDB_NAME);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    });
    if (!db) return;

    const stores = SW_IDB_STORES.filter((s) => db.objectStoreNames.contains(s));
    if (stores.length > 0) {
      await new Promise<void>((resolve) => {
        const tx = db.transaction(stores, 'readwrite');
        stores.forEach((s) => tx.objectStore(s).clear());
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      });
    }
    db.close();
  } catch {
    // best-effort
  }
}

/**
 * Purge the SW offline-mutation queue AND the failed-mutation archive.
 * Call on every session teardown (logout, hard 401 redirect) and defensively
 * before a new login. Best-effort, resolves once both paths complete.
 */
export async function purgeOfflineQueues(): Promise<void> {
  await Promise.all([askServiceWorker('CLEAR_OFFLINE_QUEUE'), clearOfflineStoresDirectly()]);
}
