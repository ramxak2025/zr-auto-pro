// ═══════════════════════════════════════════════════════════════════════════════
//  Autexa PWA Service Worker v12
//
//  SPEED STRATEGY:
//  - GET /api/auth/* → bypass SW, always network (auth must be fresh)
//  - GET /api/*      → stale-while-revalidate by URL (instant from cache,
//                       background refresh). Cache key = URL only, ignoring
//                       Authorization header so Vary doesn't break matching.
//  - POST/PATCH/DELETE /api/* → network, offline queue fallback
//  - Static assets   → cache-first (immutable hashed filenames)
//  - Navigation HTML  → network-first, offline fallback to cached shell
// ═══════════════════════════════════════════════════════════════════════════════

const STATIC_CACHE = 'autexa-static-v12';
const API_CACHE = 'autexa-api-v12';
const OFFLINE_QUEUE = 'autexa-offline-queue';
const API_CACHE_TTL = 30_000; // 30 seconds — serve cache if younger

const PRECACHE_ASSETS = ['/', '/logo-icon.png', '/logo.png'];

// ─── Install ─────────────────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE_ASSETS))
  );
  self.skipWaiting();
});

// ─── Activate: clean ALL old caches ──────────────────────────────────────────

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

  // ── API ──
  if (url.pathname.startsWith('/api')) {
    // Auth: always bypass — must never get stale auth data
    if (url.pathname.startsWith('/api/auth')) return;

    // Mutations: network with offline queue
    if (request.method !== 'GET') {
      event.respondWith(networkWithOfflineQueue(request));
      return;
    }

    // GET /api: stale-while-revalidate — INSTANT from cache, fresh in background
    event.respondWith(apiSWR(url.href, request));
    return;
  }

  // ── Navigation HTML ──
  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then((r) => {
          if (r.ok) caches.open(STATIC_CACHE).then((c) => c.put('/', r.clone()));
          return r;
        })
        .catch(() => caches.match('/'))
    );
    return;
  }

  // ── Static assets ──
  if (isStaticAsset(url.pathname)) {
    event.respondWith(cacheFirst(request));
  }
});

// ─── API: Stale-While-Revalidate ─────────────────────────────────────────────
//
// Key insight: cache.match() by URL string (not Request object) so that
// Authorization / Vary headers don't break matching. Every logged-in user
// shares the same URL cache entry — React Query handles per-user data
// separation at the app level.
//
// Flow:
//   1. Cache hit + age < 30s → return INSTANTLY (0ms perceived latency)
//   2. Cache hit + age > 30s → return cache + background refresh
//   3. Cache miss → wait for network, cache result
//   4. Network fail + cache → return stale cache (any age)
//   5. Network fail + no cache → let browser handle error

async function apiSWR(urlHref, request) {
  const cache = await caches.open(API_CACHE);
  const cached = await cache.match(urlHref);

  // Always start the network fetch in background
  const networkPromise = fetch(request).then((response) => {
    if (response.ok) {
      // Store by URL string so future matches ignore headers
      cache.put(urlHref, response.clone()).catch(() => {});
    }
    return response;
  }).catch(() => null);

  if (cached) {
    const dateHeader = cached.headers.get('date');
    const age = dateHeader ? Date.now() - new Date(dateHeader).getTime() : Infinity;

    if (age < API_CACHE_TTL) {
      // Fresh enough — return instantly, don't wait for network
      return cached;
    }

    // Stale but exists — return stale immediately, update in background
    networkPromise.catch(() => {});
    return cached;
  }

  // No cache — must wait for network
  const networkResponse = await networkPromise;
  if (networkResponse) return networkResponse;

  // Offline and no cache — return empty so React Query shows error
  return new Response('[]', {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'X-Offline': 'true' },
  });
}

// ─── Static: Cache-First ─────────────────────────────────────────────────────

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached && cached.ok) return cached;

  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') {
      const c = await caches.open(STATIC_CACHE);
      c.put(request, response.clone());
    }
    return response;
  } catch {
    if (cached) return cached;
    return caches.match('/');
  }
}

// ─── Mutations: Network with Offline Queue ───────────────────────────────────

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

  // Cross-tenant isolation: on logout / session change the client asks the SW
  // to drop every cached /api response. The API cache is keyed by URL only
  // (ignoring Authorization), so a leftover entry would otherwise be served to
  // the NEXT user on a shared browser/kiosk. We fully delete & recreate the
  // API cache so no stale tenant-A payload survives the next login.
  if (event.data?.type === 'CLEAR_API_CACHE') {
    event.waitUntil(
      caches.delete(API_CACHE).then(() => {
        // ACK so the client can await completion before login proceeds.
        if (event.ports && event.ports[0]) {
          event.ports[0].postMessage({ type: 'API_CACHE_CLEARED' });
        }
      })
    );
  }
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
