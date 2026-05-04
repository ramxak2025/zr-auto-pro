/**
 * Persistent cache for TanStack Query.
 *
 * Stores selected query keys to AsyncStorage so a cold-start app sees
 * the previous successful response instantly while a fresh fetch runs in
 * the background. Eliminates the "0 товаров" flash on screens that just
 * opened — `data` is already in `queryClient` before the screen mounts.
 *
 * Keys are matched by their FIRST element (which is always a string in our
 * codebase — e.g. ['products', { search, limit }]), so we don't have to
 * enumerate every variant of nested params.
 *
 * Why a custom helper instead of @tanstack/query-async-storage-persister?
 *   - smaller surface area, easier to debug
 *   - we only persist 5 keys, full-cache persistence would be wasteful
 *   - no extra dependency
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { QueryClient, QueryKey } from '@tanstack/react-query';

const STORAGE_PREFIX = 'rqcache:v1:';

/**
 * Query keys whose results we persist.
 * Add a new entry only if the data is:
 *   - relatively static (changes < hourly)
 *   - useful to show stale to the user on cold start
 *   - not user-input-volatile (e.g. don't persist `['clients-plate', search]`)
 */
const PERSISTED_KEYS = [
  'products',           // warehouse — main cache
  'all-services',       // services dictionary
  'all-products-check', // product picker in CheckCreate
  'all-users',          // masters/users dictionary
  'users',              // alt key in some screens
  'warehouse-categories', // category folders
  'schedule',           // schedule entries (per month)
] as const;

type PersistedKey = (typeof PERSISTED_KEYS)[number];

interface StoredEntry {
  queryKey: QueryKey;
  data: unknown;
  storedAt: number;
}

/** Max age of persisted entry — older than this is ignored (1 hour). */
const MAX_STALE_MS = 60 * 60 * 1000;

function firstKey(qk: QueryKey): string | null {
  if (!Array.isArray(qk) || qk.length === 0) return null;
  const f = qk[0];
  return typeof f === 'string' ? f : null;
}

function isPersisted(key: string | null): key is PersistedKey {
  return !!key && (PERSISTED_KEYS as readonly string[]).includes(key);
}

function storageKey(qk: QueryKey): string {
  // Stringify the full query key so different params (e.g. month in
  // ['schedule', '2026-05-01', '2026-05-31']) get separate slots.
  return STORAGE_PREFIX + JSON.stringify(qk);
}

/**
 * Hydrate the QueryClient from AsyncStorage.
 *
 * Call once on app start, BEFORE the first render that uses `useQuery`.
 * Failures are silent — the worst case is a cold-start without cache.
 */
export async function hydrateCache(qc: QueryClient): Promise<void> {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const ourKeys = allKeys.filter((k) => k.startsWith(STORAGE_PREFIX));
    if (ourKeys.length === 0) return;
    const pairs = await AsyncStorage.multiGet(ourKeys);
    const now = Date.now();
    for (const [, raw] of pairs) {
      if (!raw) continue;
      try {
        const parsed: StoredEntry = JSON.parse(raw);
        if (!parsed?.queryKey || parsed.data === undefined) continue;
        if (now - (parsed.storedAt ?? 0) > MAX_STALE_MS) continue;
        const f = firstKey(parsed.queryKey);
        if (!isPersisted(f)) continue;
        qc.setQueryData(parsed.queryKey, parsed.data);
      } catch {
        // skip corrupted entry
      }
    }
  } catch {
    // AsyncStorage unavailable — proceed without hydration
  }
}

/**
 * Subscribe to QueryClient cache updates and persist successful responses
 * for whitelisted keys.
 *
 * Returns an unsubscribe function — keep the reference alive for the
 * lifetime of the app.
 */
export function attachPersistence(qc: QueryClient): () => void {
  const unsubscribe = qc.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated') return;
    const query = event.query;
    if (query.state.status !== 'success') return;
    const f = firstKey(query.queryKey);
    if (!isPersisted(f)) return;
    if (query.state.data === undefined) return;

    const entry: StoredEntry = {
      queryKey: query.queryKey,
      data: query.state.data,
      storedAt: Date.now(),
    };
    AsyncStorage.setItem(storageKey(query.queryKey), JSON.stringify(entry)).catch(() => {});
  });
  return unsubscribe;
}

/** Clear all persisted cache — call from logout. */
export async function clearPersistentCache(): Promise<void> {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const ourKeys = allKeys.filter((k) => k.startsWith(STORAGE_PREFIX));
    if (ourKeys.length > 0) await AsyncStorage.multiRemove(ourKeys);
  } catch {
    // best-effort
  }
}
