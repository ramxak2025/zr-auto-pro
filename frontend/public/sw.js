// ═══════════════════════════════════════════════════════════════════════════════
//  Autexa PWA Service Worker v8
//  - /api/auth/* — bypassed entirely (always go straight to network)
//  - GET /api/*  — network-first, cache as offline-only fallback
//  - Static assets — cache-first for speed
//  - Navigation — network-first, offline fallback to cached shell
//  - Offline mutations — queued in IndexedDB and replayed when back online
// ═══════════════════════════════════════════════════════════════════════════════

const STATIC_CACHE = 'autexa-static-v10';
const API_CACHE = 'autexa-api-v4';
const OFFLINE_QUEUE = 'autexa-offline-queue';

const PRECACHE_ASSETS = [
  '/',
  '/logo-icon.png',
  '/logo.png',
];

// ─── Install ─────────────────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE_ASSETS))
  );
  self.skipWaiting();
});

// ─── Activate: clean old caches ──────────────────────────────────────────────

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== STATIC_CACHE && k !== API_CACHE)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ─── Fetch ───────────────────────────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;

  // API requests
  if (url.pathname.startsWith('/api')) {
    // Auth endpoints — NEVER touched by the SW. Sessions must always go
    // straight to the network so a transient SW offline response cannot
    // accidentally log the user out (Auth uses 401/403 to mean "log out",
    // any non-200 from the SW would be misinterpreted).
    if (url.pathname.startsWith('/api/auth')) return;

    if (request.method !== 'GET') {
      event.respondWith(networkWithOfflineQueue(request));
      return;
    }
    // GET /api — stale-while-revalidate for instant loads.
    // Cached data served immediately; fresh data fetched in background.
    // React Query's staleTime (60s) prevents excessive re-requests.
    event.respondWith(apiStaleWhileRevalidate(request));
    return;
  }

  // Navigation / HTML — network-first, offline fallback
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

  // Static assets (JS, CSS, images, fonts) — cache-first
  if (isStaticAsset(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }
});

// ─── Strategies ──────────────────────────────────────────────────────────────

/**
 * Stale-while-revalidate for API GET requests.
 *
 * 1) If cache exists — return it IMMEDIATELY (0ms user wait)
 * 2) Fetch from network in background → update cache for next time
 * 3) If no cache — wait for network (normal latency)
 * 4) If network fails and no cache — 503
 *
 * This gives instant page loads for repeat visits while ensuring data
 * freshness within one request cycle. React Query's staleTime (60s)
 * prevents re-fetching too aggressively on top of this.
 */
async function apiStaleWhileRevalidate(request) {
  const cache = await caches.open(API_CACHE);
  const cached = await cache.match(request);

  // Background revalidation — always try to update cache
  const networkPromise = fetch(request)
    .then((response) => {
      if (response.ok) {
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    })
    .catch(() => null);

  // If we have a cached response, return it immediately
  if (cached) {
    // Fire background update, don't wait for it
    networkPromise.catch(() => {});
    return cached;
  }

  // No cache — must wait for network
  const networkResponse = await networkPromise;
  if (networkResponse) return networkResponse;

  return new Response(
    JSON.stringify({ message: 'Нет соединения с сервером', offline: true }),
    { status: 503, headers: { 'Content-Type': 'application/json', 'X-Offline': 'true' } },
  );
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached && cached.ok) return cached;

  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    if (cached) return cached;
    return caches.match('/');
  }
}

async function networkWithOfflineQueue(request) {
  try {
    return await fetch(request.clone());
  } catch (err) {
    if (request.method !== 'GET') {
      try {
        await queueMutation(request);
        notifyClients({ type: 'MUTATION_QUEUED', url: request.url, method: request.method });
        return new Response(
          JSON.stringify({ message: 'Сохранено. Будет отправлено при восстановлении сети.', queued: true }),
          { status: 202, headers: { 'Content-Type': 'application/json' } }
        );
      } catch { throw err; }
    }
    throw err;
  }
}

// ─── Offline Mutation Queue ──────────────────────────────────────────────────

async function queueMutation(request) {
  const body = await request.clone().text();
  const db = await openDB();
  const tx = db.transaction(OFFLINE_QUEUE, 'readwrite');
  tx.objectStore(OFFLINE_QUEUE).add({
    url: request.url,
    method: request.method,
    headers: Object.fromEntries(request.headers.entries()),
    body,
    timestamp: Date.now(),
  });
  if (self.registration?.sync) {
    try { await self.registration.sync.register('replay-mutations'); } catch {}
  }
}

async function replayMutations() {
  const db = await openDB();
  const keys = await idbGetAllKeys(db.transaction(OFFLINE_QUEUE, 'readonly').objectStore(OFFLINE_QUEUE));
  let replayed = 0;

  for (const key of keys) {
    const mutation = await idbGet(db.transaction(OFFLINE_QUEUE, 'readonly').objectStore(OFFLINE_QUEUE), key);
    if (!mutation) continue;
    try {
      const res = await fetch(mutation.url, { method: mutation.method, headers: mutation.headers, body: mutation.body || undefined });
      if (res.ok || res.status < 500) {
        db.transaction(OFFLINE_QUEUE, 'readwrite').objectStore(OFFLINE_QUEUE).delete(key);
        replayed++;
      }
    } catch { break; }
  }

  if (replayed > 0) notifyClients({ type: 'MUTATIONS_REPLAYED', count: replayed });
}

// ─── Events ──────────────────────────────────────────────────────────────────

self.addEventListener('sync', (event) => {
  if (event.tag === 'replay-mutations') event.waitUntil(replayMutations());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'ONLINE') replayMutations();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isStaticAsset(p) {
  return /\.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?|ttf|eot|webp|avif)(\?.*)?$/.test(p);
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('autexa-sw', 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(OFFLINE_QUEUE))
        req.result.createObjectStore(OFFLINE_QUEUE, { autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGetAllKeys(store) {
  return new Promise((r, e) => { const q = store.getAllKeys(); q.onsuccess = () => r(q.result); q.onerror = () => e(q.error); });
}

function idbGet(store, key) {
  return new Promise((r, e) => { const q = store.get(key); q.onsuccess = () => r(q.result); q.onerror = () => e(q.error); });
}

async function notifyClients(msg) {
  const clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach((c) => c.postMessage(msg));
}
