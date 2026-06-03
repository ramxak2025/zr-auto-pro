/**
 * Persistent cache for TanStack Query on web.
 *
 * Stores selected query results to IndexedDB so a reload / next session sees
 * the previous successful response instantly while a fresh fetch runs in the
 * background. This is the same SWR + persistence pattern the mobile app uses
 * via `persistentCache.ts` (AsyncStorage there → IndexedDB here).
 *
 * Why IndexedDB and not localStorage:
 *   - much bigger quota (50+ MB vs 5 MB)
 *   - async API doesn't block the main thread
 *   - works fine with our query payloads (lists of clients/cars/products)
 *
 * Whitelisted query keys mirror `mobile/src/utils/persistentCache.ts`
 * PERSISTED_KEYS so iOS / Android / web all behave the same way.
 */
import { get, set, del, createStore } from 'idb-keyval';
import { QueryClient, Query } from '@tanstack/react-query';
import {
  PersistedClient,
  Persister,
  persistQueryClient,
} from '@tanstack/react-query-persist-client';

const STORE_NAME = 'autexa-rq-cache';
const KEY = 'react-query-v1';
const BUSTER = 'v1.2.0'; // bump on incompatible cache shape changes

const idbStore = createStore(STORE_NAME, 'cache');

/**
 * Query keys whose results we persist. Each entry matches the FIRST element
 * of a useQuery key (e.g. ['products', { search: '' }] matches 'products').
 * Add a key only if the data is:
 *   - relatively static (changes < hourly)
 *   - useful to show stale on cold start
 *   - NOT user-volatile (e.g. don't persist `clients-plate` typed search)
 */
const PERSISTED_KEYS = new Set<string>([
  // Warehouse + product picker
  'products',
  'warehouse-categories',
  // Reference data
  'services',
  'all-services',
  'users',
  'all-users',
  // Suppliers / clients / cars
  'suppliers',
  'clients',
  'cars',
  // Schedule + dashboard
  'schedule',
  'schedule-today',
  'dashboard-chart',
  'employee-ranking',
  'marketing-dashboard',
  'shifts',
  'salary',
  // Journal (paginated history) — first page snapshot
  'checks',
  'checks-dashboard',
  'low-stock',
  'service-categories',
  // Subscription / company settings — very static
  'subscription',
  'my-company',
]);

function shouldPersistQuery(query: Query): boolean {
  const first = query.queryKey[0];
  if (typeof first !== 'string') return false;
  return PERSISTED_KEYS.has(first);
}

/** Wrap idb-keyval calls into a TanStack Persister interface. */
function createIdbPersister(): Persister {
  return {
    persistClient: async (client: PersistedClient) => {
      await set(KEY, client, idbStore);
    },
    restoreClient: async () => {
      const stored = (await get<PersistedClient>(KEY, idbStore)) || undefined;
      return stored;
    },
    removeClient: async () => {
      await del(KEY, idbStore);
    },
  };
}

/**
 * Wipe the persisted React Query cache from IndexedDB.
 *
 * Called on logout / before a different user logs in so the dehydrated
 * snapshot of tenant A's lists (products, clients, checks…) can never be
 * rehydrated into tenant B's session on a shared browser. Mirrors mobile's
 * `clearPersistentCache()` (which clears the AsyncStorage `rqcache:` keys).
 *
 * Best-effort: a failure here must not block the logout flow.
 */
export async function clearPersistentCache(): Promise<void> {
  try {
    await del(KEY, idbStore);
  } catch {
    // best-effort — IndexedDB may be unavailable (private mode / quota)
  }
}

/**
 * Wire up persistence. Side-effect only — the helper returns an unsubscribe
 * function from `persistQueryClient`, but we keep persistence for the entire
 * page lifetime, so we don't expose it.
 */
export function setupPersistence(client: QueryClient): void {
  const persister = createIdbPersister();

  persistQueryClient({
    queryClient: client,
    persister,
    // 24h — older snapshots are ignored on restore; the cache still gets a
    // fresh fetch via SWR. Keep this in sync with mobile's AsyncStorage TTL.
    maxAge: 24 * 60 * 60 * 1000,
    buster: BUSTER,
    dehydrateOptions: {
      shouldDehydrateQuery: shouldPersistQuery,
    },
  });
}
