import axios, { AxiosError } from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

// API URL: hardcoded production server, fallback to dev server
function getApiBaseUrl(): string {
  const configUrl = Constants.expoConfig?.extra?.apiUrl;
  if (configUrl) return configUrl;

  const debuggerHost = Constants.expoConfig?.hostUri || (Constants as any).debuggerHost;
  if (debuggerHost) {
    const host = debuggerHost.split(':')[0];
    return `http://${host}:3000/api`;
  }
  return 'http://localhost:3000/api';
}

const API_BASE_URL = getApiBaseUrl();

// Exposed so screens can show what URL they're hitting in error dialogs.
export const API_URL = API_BASE_URL;

// Derive server origin for image URLs (strip /api suffix)
export const SERVER_URL = API_BASE_URL.replace(/\/api\/?$/, '');

/** Resolve a relative image path (/uploads/xxx) to full URL */
export function getImageUrl(path?: string | null): string | undefined {
  if (!path) return undefined;
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  return `${SERVER_URL}${path.startsWith('/') ? '' : '/'}${path}`;
}

const api = axios.create({
  baseURL: API_BASE_URL,
  // 10s (was 30s): on a flaky VDS round-trip a hung request should fail fast
  // and let React Query retry / fall back to cache rather than blocking the
  // UI for half a minute. The polls / refetches that dominate traffic are
  // sub-second once ETag/304 kicks in.
  timeout: 10000,
  // Treat 304 as a SUCCESS so the response interceptor can substitute the
  // last cached body. Everything else keeps axios' default (status < 400 ok).
  validateStatus: (status) => (status >= 200 && status < 300) || status === 304,
});

// ── In-memory auth token cache ──────────────────────────────────────────
// The request interceptor used to `await AsyncStorage.getItem('token')` on
// EVERY request. When ~10-15 dashboard queries fan out at once, those reads
// serialise through the single AsyncStorage native bridge and add latency to
// the whole wave. We keep the token in a module variable instead: read once,
// then update it on login / logout / 401 via `setAuthToken`. `undefined`
// means "not yet read from disk"; `null` means "known to be logged out".
let cachedAuthToken: string | null | undefined = undefined;

/**
 * Update the in-memory auth token. Called by AuthContext on login
 * (`setAuthToken(token)`), logout and the 401 handler (`setAuthToken(null)`).
 * Passing `null` both clears the bearer for subsequent requests AND wipes the
 * ETag cache so a 304 can't revive another tenant's body after a session swap.
 */
export function setAuthToken(token: string | null): void {
  cachedAuthToken = token;
  if (token === null) {
    resetHttpEtagCache();
  }
}

// ── Client-side ETag / 304 cache ─────────────────────────────────────────
// The backend (`etag.interceptor.ts`) emits an `ETag` on every GET and replies
// 304 (empty body) when the client sends a matching `If-None-Match`. Without a
// client cache that 304 is useless — and we never sent the header at all, so
// every poll/refetch downloaded the full body over the VDS round-trip. We now:
//   1. store `{ etag, data }` per GET request signature on a 2xx,
//   2. send `If-None-Match` on the next identical GET,
//   3. on a 304, transparently resolve with the stored `data`.
interface EtagEntry {
  etag: string;
  data: unknown;
}
const etagCache = new Map<string, EtagEntry>();

// Hard cap on cached signatures. Every unique GET signature pins a full
// response body in memory; without a bound, long sessions (per-period
// reports, per-id detail opens) grow the map indefinitely. A Map iterates
// in insertion order, so deleting `keys().next()` evicts the
// least-recently-used entry as long as we re-insert on every hit.
const ETAG_CACHE_MAX = 100;

/** Store an entry, evicting the least-recently-used one when full. */
function etagCacheSet(key: string, entry: EtagEntry): void {
  if (etagCache.has(key)) {
    etagCache.delete(key); // refresh insertion order → most-recently-used
  } else if (etagCache.size >= ETAG_CACHE_MAX) {
    const oldest = etagCache.keys().next().value;
    if (oldest !== undefined) etagCache.delete(oldest);
  }
  etagCache.set(key, entry);
}

/**
 * Search requests (`params.search` non-empty) are per-keystroke variants —
 * each one is a unique signature that would occupy an LRU slot and pin a
 * full page body for a response the user usually never revisits. Skip the
 * ETag dance for them entirely; the empty-search base signature still
 * caches normally.
 */
function hasNonEmptySearch(params: unknown): boolean {
  if (!params || typeof params !== 'object') return false;
  const s = (params as { search?: unknown }).search;
  return typeof s === 'string' && s.length > 0;
}

/**
 * Build the cache key for a request. Method + URL + serialised params makes a
 * stable signature so `['products', {warehouseId}]`-style refetches each get
 * their own ETag slot.
 */
function etagCacheKey(config: { method?: string; url?: string; params?: unknown }): string {
  const method = (config.method || 'get').toUpperCase();
  const url = config.url || '';
  let paramsPart = '{}';
  try {
    paramsPart = JSON.stringify(config.params ?? {});
  } catch {
    // Non-serialisable params (rare) — fall back to empty so we simply
    // skip the cache for this request instead of throwing.
    paramsPart = '{}';
  }
  return `${method} ${url} ${paramsPart}`;
}

/**
 * Clear the client-side ETag cache. MUST run on logout / auth-expiry so a
 * cached 304 body from tenant A can never be served into tenant B's session.
 * Exported and wired into the AuthContext cleanup paths.
 */
export function resetHttpEtagCache(): void {
  etagCache.clear();
}

// Attach JWT token + If-None-Match. Reads the in-memory token first; only
// touches AsyncStorage once if the module variable hasn't been primed yet
// (e.g. a request fired before AuthContext mounted).
api.interceptors.request.use(async (config) => {
  if (cachedAuthToken === undefined) {
    cachedAuthToken = (await AsyncStorage.getItem('token').catch(() => null)) ?? null;
  }
  if (cachedAuthToken) {
    config.headers.Authorization = `Bearer ${cachedAuthToken}`;
  }

  // Only GETs participate in the ETag dance (the backend only ETags GETs).
  // Typed-search variants are excluded — they're never stored (see
  // `hasNonEmptySearch`), so sending If-None-Match for them is pointless.
  const method = (config.method || 'get').toUpperCase();
  if (method === 'GET' && !hasNonEmptySearch(config.params)) {
    const entry = etagCache.get(etagCacheKey(config));
    if (entry) {
      config.headers['If-None-Match'] = entry.etag;
    }
  }
  return config;
});

// Event emitter for auth state changes
type AuthListener = () => void;
const authListeners: AuthListener[] = [];

export function onAuthExpired(listener: AuthListener) {
  authListeners.push(listener);
  return () => {
    const idx = authListeners.indexOf(listener);
    if (idx >= 0) authListeners.splice(idx, 1);
  };
}

/**
 * Auth-expiry coalescer — a wave of parallel 401s (8+ dashboard queries
 * all hit the API at once with a stale token) would otherwise fire the
 * listeners 8 times, each one triggering `queryClient.clear()` /
 * `clearPersistentCache()` / state updates. We collapse them into a
 * single notification per 2 s window.
 */
let lastAuthExpiredAt = 0;
const AUTH_EXPIRED_COALESCE_MS = 2_000;

function fireAuthExpired() {
  const now = Date.now();
  if (now - lastAuthExpiredAt < AUTH_EXPIRED_COALESCE_MS) return;
  lastAuthExpiredAt = now;
  authListeners.forEach((fn) => {
    try {
      fn();
    } catch {
      // Listener errors must not block other listeners or the next
      // 401 from firing the chain.
    }
  });
}

api.interceptors.response.use(
  (res) => {
    const method = (res.config.method || 'get').toUpperCase();
    if (method === 'GET') {
      const key = etagCacheKey(res.config);
      if (res.status === 304) {
        // Backend confirmed nothing changed and sent an empty body. Serve the
        // last cached payload so React Query / callers get real data, never
        // an empty 304 body. Normalise the status to 200 so downstream
        // `res.status` checks behave like a fresh fetch.
        const entry = etagCache.get(key);
        if (entry) {
          // Re-insert so the LRU order reflects the actual hit.
          etagCacheSet(key, entry);
          res.data = entry.data;
          res.status = 200;
          res.statusText = 'OK (from ETag cache)';
        }
        // If we somehow have no cached entry for a 304 (cache was reset
        // between the request and its response), leave res.data as-is — the
        // body is empty but this is an extreme edge case; the next refetch
        // (no If-None-Match) repopulates the cache with a full body.
        return res;
      }
      // 2xx with a body + an ETag header → remember it for next time.
      // Per-keystroke search variants are skipped — each unique search
      // string would pin a full body in the LRU for nothing.
      const etag = (res.headers?.etag as string | undefined) || (res.headers?.ETag as string | undefined);
      if (
        etag &&
        res.status >= 200 &&
        res.status < 300 &&
        res.data !== undefined &&
        !hasNonEmptySearch(res.config.params)
      ) {
        etagCacheSet(key, { etag, data: res.data });
      }
    }
    return res;
  },
  async (error: AxiosError<{ message?: string }>) => {
    if (!error.response) {
      const baseURL = error.config?.baseURL || API_BASE_URL;
      const reason = error.code || error.message || 'unknown';
      const wrapped = new Error(`Нет соединения с сервером\nURL: ${baseURL}\nПричина: ${reason}`);
      (wrapped as any).code = error.code;
      (wrapped as any).baseURL = baseURL;
      return Promise.reject(wrapped);
    }

    const status = error.response.status;

    if (status === 401) {
      // Best-effort cleanup of the stale token; if another parallel 401
      // already removed it, this is a no-op. `setAuthToken(null)` also wipes
      // the in-memory token + ETag cache so a coalesced re-login can't reuse
      // the previous tenant's bearer or serve a 304 from their body.
      setAuthToken(null);
      await AsyncStorage.removeItem('token').catch(() => {});
      await AsyncStorage.removeItem('user').catch(() => {});
      fireAuthExpired();
    }

    return Promise.reject(error);
  },
);

export default api;
