// ═══════════════════════════════════════════════════════════════════════════════
//  Autexa PWA Service Worker v6
//  - NO API caching — all API requests go straight to network
//  - Static assets (JS/CSS/images): cache-first for speed
//  - Navigation: network-first, offline fallback to cached shell
//  - Offline mutations: queued and replayed when back online
// ═══════════════════════════════════════════════════════════════════════════════

const STATIC_CACHE = 'autexa-static-v6';
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
          .filter((k) => k !== STATIC_CACHE)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ─── Fetch ───────────────────────────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;

  // API requests — ALWAYS network, no cache
  if (url.pathname.startsWith('/api')) {
    if (request.method !== 'GET') {
      event.respondWith(networkWithOfflineQueue(request));
    }
    // GET /api — just let the browser fetch normally (no SW interception)
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
