// ═══════════════════════════════════════════════════════════════════════════════
//  Autexa PWA Service Worker v2
//  - Static assets: Cache-first (immutable after build)
//  - API GET responses: Stale-while-revalidate (instant response + background refresh)
//  - API mutations (POST/PATCH/DELETE): Network-only (never cache writes)
//  - Offline fallback: Serve cached shell
// ═══════════════════════════════════════════════════════════════════════════════

const STATIC_CACHE = 'autexa-static-v2';
const API_CACHE = 'autexa-api-v1';

// Maximum age for cached API responses (5 minutes).
// After this, we still serve the stale response but prioritize the network version.
const API_MAX_AGE_MS = 5 * 60 * 1000;

// Static shell assets to precache on install
const PRECACHE_ASSETS = [
  '/',
  '/logo-icon.png',
  '/logo.png',
];

// API paths that should NOT be cached (auth, mutations, uploads, real-time)
const API_NOCACHE_PATHS = [
  '/api/auth/login',
  '/api/auth/register',
  '/api/uploads',
];

// API paths that benefit from caching (read-heavy, rarely change)
// Everything under /api that is a GET and not in NOCACHE will be cached
// with stale-while-revalidate.

// ─── Install ─────────────────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE_ASSETS))
  );
  self.skipWaiting();
});

// ─── Activate ────────────────────────────────────────────────────────────────

self.addEventListener('activate', (event) => {
  // Clean up old cache versions
  const keepCaches = [STATIC_CACHE, API_CACHE];
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => !keepCaches.includes(k))
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

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // ── API requests ──
  if (url.pathname.startsWith('/api')) {
    // Never cache non-GET requests (mutations)
    if (request.method !== 'GET') return;

    // Don't cache auth and upload endpoints
    if (API_NOCACHE_PATHS.some((p) => url.pathname.startsWith(p))) return;

    // Stale-while-revalidate for API GET requests
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // ── Static assets (JS, CSS, images, fonts) — Cache first ──
  if (isStaticAsset(url.pathname)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // ── Navigation / HTML — Network first with offline fallback ──
  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Cache the latest HTML shell
          const clone = response.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put('/', clone));
          return response;
        })
        .catch(() => caches.match('/'))
    );
    return;
  }

  // ── Everything else — Cache first with network fallback ──
  event.respondWith(cacheFirst(request, STATIC_CACHE));
});

// ─── Strategies ──────────────────────────────────────────────────────────────

/**
 * Stale-while-revalidate:
 * 1. Return cached response immediately (if available)
 * 2. Fetch fresh response in background
 * 3. Update cache with fresh response
 *
 * If no cache exists, wait for network response.
 */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(API_CACHE);
  const cachedResponse = await cache.match(request);

  // Start network fetch regardless
  const fetchPromise = fetch(request)
    .then((networkResponse) => {
      if (networkResponse.ok) {
        // Store response with timestamp
        const cloned = networkResponse.clone();
        const headers = new Headers(cloned.headers);
        headers.set('x-sw-cached-at', Date.now().toString());

        // We need to create a new response with the timestamp header
        cloned.blob().then((body) => {
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
      // Network failed — if we have cache, that was already returned
      // If no cache, propagate the error
      if (!cachedResponse) throw err;
      return null;
    });

  // If we have cached response, return it immediately
  if (cachedResponse) {
    // Check if cache is stale (> API_MAX_AGE_MS)
    const cachedAt = parseInt(cachedResponse.headers.get('x-sw-cached-at') || '0', 10);
    const isStale = Date.now() - cachedAt > API_MAX_AGE_MS;

    if (isStale) {
      // Still return stale data, but wait a bit for network if it's fast
      const raceResult = await Promise.race([
        fetchPromise,
        new Promise((resolve) => setTimeout(() => resolve(null), 800)),
      ]);
      return raceResult || cachedResponse;
    }

    // Fresh cache — return immediately, network updates in background
    return cachedResponse;
  }

  // No cache — wait for network
  return fetchPromise;
}

/**
 * Cache-first: Return cached response, fallback to network.
 * Cache the network response for future use.
 */
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok && networkResponse.type === 'basic') {
      const cache = await caches.open(cacheName);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    // Last resort: return the offline shell for navigation
    return caches.match('/');
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isStaticAsset(pathname) {
  return /\.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?|ttf|eot|webp|avif)(\?.*)?$/.test(pathname);
}

// ─── Periodic cache cleanup ──────────────────────────────────────────────────
// Clean expired API cache entries every 10 minutes

setInterval(async () => {
  try {
    const cache = await caches.open(API_CACHE);
    const keys = await cache.keys();
    const now = Date.now();

    for (const request of keys) {
      const response = await cache.match(request);
      if (!response) continue;
      const cachedAt = parseInt(response.headers.get('x-sw-cached-at') || '0', 10);
      // Remove entries older than 30 minutes
      if (now - cachedAt > 30 * 60 * 1000) {
        await cache.delete(request);
      }
    }
  } catch {
    // Silently fail — cache cleanup is best-effort
  }
}, 10 * 60 * 1000);
