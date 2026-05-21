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
// Whitelist of query keys we cache to AsyncStorage. Each entry matches the
// FIRST element of a useQuery key (e.g. ['suppliers', { search: '' }] matches
// 'suppliers'). Update this list whenever a new screen needs instant cold-start.
const PERSISTED_KEYS = [
  // Warehouse + product picker
  'products',
  'all-products-check',
  'warehouse-categories',
  // Warehouses (main / defect / used) — 3-row reference list, almost
  // never changes. Persisted so the warehouse switcher renders the
  // tabs instantly on cold start instead of flashing the spinner.
  'warehouses',
  // Reference data
  'all-services',
  'all-users',
  'users',
  // Suppliers / clients / cars / equipment
  'suppliers',
  'clients',
  'cars',
  // Equipment (uses 'eq-*' keys)
  'eq-summary',
  'eq-storage-list',
  'eq-user',
  // Schedule + today
  'schedule',
  'schedule-today',
  // Dashboard cards
  'dashboard-chart',
  'employee-ranking',
  'marketing-dashboard',
  'shifts',
  'salary',
  // Calls + services list
  'calls-summary',
  // Dashboard widgets (TodayQuickStats / LowStockWidget) — small payloads,
  // cold-start instant.
  'checks-dashboard',
  'low-stock',
  'services-list',
  'service-categories',
  // ── Journal (Чеки) ─────────────────────────────────────────────
  // 'checks' is a paginated history; the first-page default-filter
  // snapshot is the slowest to render, so we cache the whole first
  // segment. SWR replaces it within ~150 ms after mount.
  'checks',
  // useInfiniteQuery key for the Journal — cold-start instant: we
  // render the previously seen pages immediately, then SWR refetches
  // page 1 in the background. Older pages stay cached too, so coming
  // back from a CheckDetail doesn't drop scroll position.
  'checks-infinite',
  // Filter helpers used by ChecksScreen — small list, mostly static.
  'users-for-filter',
  // Warehouse-document tabs inside ChecksScreen.
  'stock-movements',
  'supplier-deliveries',
  // ── Other heavy lists (cold-start instant) ─────────────────────
  // Services screen uses ['services', { search, page, limit }].
  'services',
  // EmployeesScreen uses ['users-all'].
  'users-all',
  // CashFlowScreen uses ['masters'] for its filter dropdown.
  'masters',
  // CashFlowScreen + ReportsScreen finance reads.
  'cashflow',
  'financial-report',
  // ExpensesScreen — list + categories. Categories are user-defined but
  // change rarely (hours to days), so caching them eliminates the
  // expense-modal flash where the picker was empty for a moment after
  // tapping "+ Новый". `expenses` itself is keyed by (dateFrom, dateTo)
  // and most users land on the same default period, so caching the
  // "month" snapshot keeps the screen instant on cold start.
  'expenses',
  'expense-categories',
] as const;

type PersistedKey = (typeof PERSISTED_KEYS)[number];

interface StoredEntry {
  queryKey: QueryKey;
  data: unknown;
  storedAt: number;
}

/**
 * Max age of a persisted entry — older than this is ignored.
 *
 * 7 days: most autosalon data (suppliers, clients, products) doesn't churn
 * faster than that; users opening the app after a weekend should still see
 * something instead of a blank screen. Stale data is replaced by a fresh
 * fetch in the background via TanStack Query's stale-while-revalidate.
 */
const MAX_STALE_MS = 7 * 24 * 60 * 60 * 1000;

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
 * Is this query key search-volatile — i.e. its sub-params contain a
 * non-empty `search` string the user typed?
 *
 * We don't want to mirror every keystroke variant to AsyncStorage. That
 * would (a) blow up disk usage on long sessions and (b) cause main-thread
 * stalls because AsyncStorage writes serialise through a single bridge
 * call. We still persist the BASE variant (`search === ''`) because
 * that's the snapshot we want on cold start.
 */
function isSearchVolatile(qk: QueryKey): boolean {
  if (!Array.isArray(qk)) return false;
  for (let i = 1; i < qk.length; i++) {
    const part = qk[i];
    if (part && typeof part === 'object' && 'search' in (part as Record<string, unknown>)) {
      const s = (part as { search?: unknown }).search;
      if (typeof s === 'string' && s.length > 0) return true;
    }
  }
  return false;
}

/**
 * Hydrate the QueryClient from AsyncStorage.
 *
 * Call once on app start, BEFORE the first render that uses `useQuery`.
 * Failures are silent — the worst case is a cold-start without cache.
 *
 * SaaS-isolation safeguard: if no auth token is present, we DO NOT hydrate
 * cached data — that data belongs to a previous logged-in user. We also
 * proactively delete all our-prefixed keys in that case so a half-completed
 * logout (process killed mid-clear) can't leak data to the next user that
 * logs in on the same device.
 */
export async function hydrateCache(qc: QueryClient): Promise<void> {
  try {
    // Tenant isolation gate. Read the auth token first; if it's missing,
    // the previous session is over and no persisted entries should be
    // resurrected into the QueryClient. We also flush any orphan entries
    // so the next login starts clean.
    const token = await AsyncStorage.getItem('token');
    if (!token) {
      const orphanKeys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(STORAGE_PREFIX));
      if (orphanKeys.length > 0) {
        await AsyncStorage.multiRemove(orphanKeys).catch(() => {});
      }
      return;
    }
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
 *
 * Performance contract:
 *   - SKIP search-volatile variants (`search: '<non-empty>'`). The base
 *     `search: ''` slot is still persisted. This prevents per-keystroke
 *     bridge writes that blocked the JS-thread on slower devices.
 *   - COALESCE rapid updates per storage key via a 350 ms tail-debounce.
 *     TanStack fires the `updated` event multiple times per refetch
 *     (status transitions, dataUpdatedAt bumps); we only need to write
 *     once after the last change settles.
 *   - JSON.stringify + AsyncStorage.setItem still run, but only once
 *     per query-key per quiet period.
 */
export function attachPersistence(qc: QueryClient): () => void {
  // One pending-write timer per storage key — overwriting the timer for
  // a given key collapses N "updated" events into a single late write.
  const pendingWrites = new Map<string, ReturnType<typeof setTimeout>>();
  const WRITE_DEBOUNCE_MS = 350;

  const flush = (skey: string, payload: string) => {
    pendingWrites.delete(skey);
    AsyncStorage.setItem(skey, payload).catch(() => {});
  };

  const unsubscribe = qc.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated') return;
    const query = event.query;
    if (query.state.status !== 'success') return;
    const f = firstKey(query.queryKey);
    if (!isPersisted(f)) return;
    if (query.state.data === undefined) return;
    // Search-debounced lists (e.g. ['products', { search: 'мас' }])
    // are NOT persisted — they're transient user input variants.
    // The empty-search variant under the same first-segment IS persisted.
    if (isSearchVolatile(query.queryKey)) return;

    const entry: StoredEntry = {
      queryKey: query.queryKey,
      data: query.state.data,
      storedAt: Date.now(),
    };
    const skey = storageKey(query.queryKey);
    const payload = JSON.stringify(entry);

    const existing = pendingWrites.get(skey);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => flush(skey, payload), WRITE_DEBOUNCE_MS);
    pendingWrites.set(skey, timer);
  });

  return () => {
    unsubscribe();
    // Cancel any debounced writes — App is unmounting (HMR / logout etc.)
    for (const t of pendingWrites.values()) clearTimeout(t);
    pendingWrites.clear();
  };
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
