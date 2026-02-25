// ═══════════════════════════════════════════════════════════════════════════════
//  Autexa PWA Service Worker v4
//  - Navigation (HTML): ALWAYS network-first (prevents stale chunk references)
//  - Static assets: Cache-first with network fallback on 404
//  - API GET responses: Stale-while-revalidate with ETag support
//  - API mutations (POST/PATCH/DELETE): Network-only with offline queue
//  - Background Sync: Replay failed mutations when back online
//  - Offline fallback: Serve cached shell
// ═══════════════════════════════════════════════════════════════════════════════

const STATIC_CACHE = 'autexa-static-v5';
const API_CACHE = 'autexa-api-v4';
const OFFLINE_QUEUE = 'autexa-offline-queue';

// Maximum age for cached API responses (3 minutes for faster perceived updates)
const API_MAX_AGE_MS = 3 * 60 * 1000;

// Static shell assets to precache on install
const PRECACHE_ASSETS = [
  '/',
  '/logo-icon.png',
  '/logo.png',
];

// API paths that should NOT be cached
const API_NOCACHE_PATHS = [
  '/api/auth/login',
  '/api/auth/register',
  '/api/uploads',
];

// ─── Install ─────────────────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE_ASSETS))
  );
  // Activate immediately — don't wait for existing tabs to close
  self.skipWaiting();
});

// ─── Activate ────────────────────────────────────────────────────────────────

self.addEventListener('activate', (event) => {
  const keepCaches = new Set([STATIC_CACHE, API_CACHE]);
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => !keepCaches.has(k))
          .map((k) => caches.delete(k))
      )
    )
  );
  // Take control of all clients immediately (important for updates)
  self.clients.claim();
});

// ─── Fetch ───────────────────────────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // ── API requests ──
  if (url.pathname.startsWith('/api')) {
    // Mutation requests (POST/PATCH/DELETE) — try network, queue if offline
    if (request.method !== 'GET') {
      event.respondWith(networkWithOfflineQueue(request));
      return;
    }

    // Don't cache auth and upload endpoints
    if (API_NOCACHE_PATHS.some((p) => url.pathname.startsWith(p))) return;

    // Stale-while-revalidate for API GET requests
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // ── Navigation / HTML — ALWAYS network-first ──
  // CRITICAL: After deployment, index.html references new chunk filenames.
  // Serving a stale cached index.html would reference non-existent JS chunks,
  // causing a white screen. Always fetch fresh HTML from the server.
  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put('/', clone));
          }
          return response;
        })
        .catch(() => caches.match('/'))
    );
    return;
  }

  // ── Static assets (JS, CSS, images, fonts) — Cache first with 404 fallback ──
  if (isStaticAsset(url.pathname)) {
    event.respondWith(cacheFirstWithFallback(request, STATIC_CACHE));
    return;
  }

  // ── Everything else — Cache first ──
  event.respondWith(cacheFirstWithFallback(request, STATIC_CACHE));
});

// ─── Strategies ──────────────────────────────────────────────────────────────

/**
 * Stale-while-revalidate with ETag support
 */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(API_CACHE);
  const cachedResponse = await cache.match(request);

  // Build fetch request with ETag If-None-Match if we have a cached version
  let fetchRequest = request;
  if (cachedResponse) {
    const etag = cachedResponse.headers.get('etag');
    if (etag) {
      const headers = new Headers(request.headers);
      headers.set('If-None-Match', etag);
      fetchRequest = new Request(request, { headers });
    }
  }

  // Start network fetch
  const fetchPromise = fetch(fetchRequest)
    .then((networkResponse) => {
      // 304 Not Modified — data hasn't changed, reuse cache
      if (networkResponse.status === 304 && cachedResponse) {
        // Update the timestamp on the cached response
        return cachedResponse.blob().then((body) => {
          const headers = new Headers(cachedResponse.headers);
          headers.set('x-sw-cached-at', Date.now().toString());
          const refreshed = new Response(body, {
            status: cachedResponse.status,
            statusText: cachedResponse.statusText,
            headers,
          });
          cache.put(request, refreshed);
          return cachedResponse;
        });
      }

      if (networkResponse.ok) {
        const cloned = networkResponse.clone();
        cloned.blob().then((body) => {
          const headers = new Headers(cloned.headers);
          headers.set('x-sw-cached-at', Date.now().toString());
          const timedResponse = new Response(body, {
            status: cloned.status,
            statusText: cloned.statusText,
            headers,
          });
          cache.put(request, timedResponse);
        });
      }
      return networkResponse;
    })
    .catch((err) => {
      if (!cachedResponse) throw err;
      return null;
    });

  // If we have cached response, return it immediately
  if (cachedResponse) {
    const cachedAt = parseInt(cachedResponse.headers.get('x-sw-cached-at') || '0', 10);
    const isStale = Date.now() - cachedAt > API_MAX_AGE_MS;

    if (isStale) {
      const raceResult = await Promise.race([
        fetchPromise,
        new Promise((resolve) => setTimeout(() => resolve(null), 400)),
      ]);
      return raceResult || cachedResponse;
    }

    return cachedResponse;
  }

  return fetchPromise;
}

/**
 * Cache-first with network fallback.
 * If the cached response is a 404 or error, try the network instead.
 * This handles the case where old cache entries reference stale assets.
 */
async function cacheFirstWithFallback(request, cacheName) {
  const cached = await caches.match(request);
  if (cached && cached.ok) return cached;

  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok && networkResponse.type === 'basic') {
      const cache = await caches.open(cacheName);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    // If network also fails and we have any cached version, return it
    if (cached) return cached;
    // Last resort: return the offline shell
    return caches.match('/');
  }
}

// ─── Background Sync: Offline Mutation Queue ─────────────────────────────────

/**
 * For mutations (POST/PATCH/DELETE): try network, queue to IndexedDB if offline.
 * When back online, replay queued requests.
 */
async function networkWithOfflineQueue(request) {
  try {
    const response = await fetch(request.clone());
    return response;
  } catch (err) {
    // Network is down — queue the mutation for later replay
    if (request.method !== 'GET') {
      try {
        await queueMutation(request);
        // Notify client that the mutation was queued
        notifyClients({
          type: 'MUTATION_QUEUED',
          url: request.url,
          method: request.method,
        });
        // Return a synthetic "queued" response
        return new Response(
          JSON.stringify({ message: 'Сохранено. Будет отправлено при восстановлении сети.', queued: true }),
          {
            status: 202,
            statusText: 'Accepted (Queued)',
            headers: { 'Content-Type': 'application/json' },
          }
        );
      } catch {
        // If queueing fails too, propagate the original error
        throw err;
      }
    }
    throw err;
  }
}

/**
 * Store a mutation request in IndexedDB for later replay
 */
async function queueMutation(request) {
  const body = await request.clone().text();
  const mutation = {
    url: request.url,
    method: request.method,
    headers: Object.fromEntries(request.headers.entries()),
    body,
    timestamp: Date.now(),
  };

  const db = await openDB();
  const tx = db.transaction(OFFLINE_QUEUE, 'readwrite');
  const store = tx.objectStore(OFFLINE_QUEUE);
  store.add(mutation);

  // Register for sync event if available
  if (self.registration && self.registration.sync) {
    try {
      await self.registration.sync.register('replay-mutations');
    } catch {
      // Sync API not available — we'll replay on 'online' event
    }
  }
}

/**
 * Replay all queued mutations
 */
async function replayMutations() {
  const db = await openDB();
  const tx = db.transaction(OFFLINE_QUEUE, 'readwrite');
  const store = tx.objectStore(OFFLINE_QUEUE);
  const allKeys = await idbGetAllKeys(store);

  let replayed = 0;
  let failed = 0;

  for (const key of allKeys) {
    const getTx = db.transaction(OFFLINE_QUEUE, 'readonly');
    const getStore = getTx.objectStore(OFFLINE_QUEUE);
    const mutation = await idbGet(getStore, key);
    if (!mutation) continue;

    try {
      const response = await fetch(mutation.url, {
        method: mutation.method,
        headers: mutation.headers,
        body: mutation.body || undefined,
      });

      if (response.ok || response.status < 500) {
        // Success or client error (4xx) — remove from queue
        const delTx = db.transaction(OFFLINE_QUEUE, 'readwrite');
        delTx.objectStore(OFFLINE_QUEUE).delete(key);
        replayed++;
      } else {
        failed++;
      }
    } catch {
      // Still offline — stop replaying
      failed++;
      break;
    }
  }

  if (replayed > 0) {
    notifyClients({
      type: 'MUTATIONS_REPLAYED',
      count: replayed,
      failed,
    });
  }
}

// ─── Background Sync Event ───────────────────────────────────────────────────

self.addEventListener('sync', (event) => {
  if (event.tag === 'replay-mutations') {
    event.waitUntil(replayMutations());
  }
});

// Fallback: listen for online event and replay
self.addEventListener('message', (event) => {
  if (event.data?.type === 'ONLINE') {
    replayMutations();
  }
  // Pull-to-refresh: clear API cache so React Query gets fresh data
  if (event.data?.type === 'CLEAR_API_CACHE') {
    caches.delete(API_CACHE);
  }
});

// ─── IndexedDB Helpers ───────────────────────────────────────────────────────

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('autexa-sw', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(OFFLINE_QUEUE)) {
        db.createObjectStore(OFFLINE_QUEUE, { autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGetAllKeys(store) {
  return new Promise((resolve, reject) => {
    const req = store.getAllKeys();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet(store, key) {
  return new Promise((resolve, reject) => {
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ─── Notify Clients ──────────────────────────────────────────────────────────

async function notifyClients(message) {
  const clients = await self.clients.matchAll({ type: 'window' });
  for (const client of clients) {
    client.postMessage(message);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isStaticAsset(pathname) {
  return /\.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?|ttf|eot|webp|avif)(\?.*)?$/.test(pathname);
}

// ─── Periodic cache cleanup (every 10 minutes) ──────────────────────────────

setInterval(async () => {
  try {
    const cache = await caches.open(API_CACHE);
    const keys = await cache.keys();
    const now = Date.now();

    for (const request of keys) {
      const response = await cache.match(request);
      if (!response) continue;
      const cachedAt = parseInt(response.headers.get('x-sw-cached-at') || '0', 10);
      if (now - cachedAt > 30 * 60 * 1000) {
        await cache.delete(request);
      }
    }
  } catch {
    // Best-effort cleanup
  }
}, 10 * 60 * 1000);
