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
import { InteractionManager } from 'react-native';
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
  // ClientsScreen people-list — useInfiniteQuery keyed
  // ['clients-infinite', { search, filter, source }]. The base variant
  // (search: '', filter: 'all', source: null) is what cold start needs;
  // typed-search variants are filtered by `isSearchVolatile` and the
  // persisted page count is bounded by MAX_PERSISTED_PAGES. The legacy
  // ['clients', ...] useQuery key has no readers anymore (the login
  // prefetch warms 'clients-infinite' directly), so it isn't persisted.
  'clients-infinite',
  'cars',
  // Client source list (откуда узнал о нас) — static reference data,
  // invalidated only on edit. Persisted so the source picker is instant
  // on cold start instead of flashing empty.
  'client-sources',
  // Equipment (uses 'eq-*' keys)
  'eq-summary',
  'eq-storage-list',
  'eq-user',
  // Schedule + today
  'schedule',
  'schedule-today',
  // Dashboard cards
  'dashboard-chart',
  'dashboard-v2',
  'employee-ranking',
  'marketing-dashboard',
  'shifts',
  'salary',
  // Owner dashboard widgets (iter#14, 2026-05-22) — owner sees them every
  // time the app cold-starts; persisting eliminates the 100-400ms flash
  // between Hero/KPI render and the first network response.
  // owner-alerts was replaced by WarehouseAnalyticsWidget (summary +
  // reorder forecast) — same persistence rationale, single shared prefix.
  'warehouse-analytics',
  'clients-new-returning',
  'retention',
  'best-day-week',
  'recent-reviews',
  'call-funnel',
  // Calls + services list
  'calls-summary',
  // Dashboard widgets (TodayQuickStats / LowStockWidget) — small payloads,
  // cold-start instant.
  'checks-dashboard',
  'low-stock',
  'services-list',
  'service-categories',
  // ── Knowledge base / Учебный центр ─────────────────────────────
  // List/content keys (NOT per-user progress) so База знаний и Учебный
  // центр render instantly from cache on cold start like every other
  // section, and survive a transient first-fetch failure on a flaky
  // network instead of showing «Не удалось загрузить». Per-user-volatile
  // keys (article acks, regulations-pending) are intentionally excluded.
  'knowledge-courses',
  'knowledge-articles',
  'knowledge-categories',
  'knowledge-troubleshooting',
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
  // Warehouse-document tab inside ChecksScreen. Replaces the older
  // 'stock-movements' / 'supplier-deliveries' pair — the journal feed
  // is now a single unified endpoint. Key shape: ['journal-warehouse-docs', kind].
  'journal-warehouse-docs',
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
  // ── HYBRID-cache expansion (2026-05-23) ────────────────────────
  // Owner picked HYBRID: critical screens fetch fresh, everything
  // else renders persistent cache then shows the FreshnessBadge.
  // First-segment matching means each entry below covers EVERY
  // sub-variant (date params, filters, etc.). Search-volatile
  // variants are filtered by `isSearchVolatile`.
  //
  // 'clients-infinite', 'suppliers', 'cars', 'schedule', 'equipment'
  // (via 'eq-*'), 'marketing-dashboard', 'expenses' — already covered
  // above. Entries below close the remaining gaps.
  //
  // CallsScreen reads ['calls', dateStr] — small per-day payload.
  'calls',
  // ReportsScreen reads ['defect-writeoff-report', from, to] +
  // 'financial-report' (already above). Owner returns to the same
  // default month often.
  'defect-writeoff-report',
  // MarketingScreen — reviews / integrations / platform links /
  // settings / reminder-settings. All small reference payloads.
  'marketing-reviews',
  'marketing-integrations',
  'marketing-platform-links',
  'marketing-settings',
  'reminder-settings',
  // EquipmentScreen — trash and categories under 'eq-' family.
  'eq-trash',
  'eq-cats',
  'eq-storage',
  // WarehouseAnalyticsScreen — owner-only deep dive into stock value,
  // dead stock, ABC, velocity, reorder forecast. Heavy aggregations
  // on the backend; we render the previous period instantly on cold
  // start while SWR refetches.
  'warehouse-analytics-summary',
  'warehouse-analytics-velocity',
  'warehouse-analytics-reorder',
  'warehouse-analytics-category-margin',
  'warehouse-analytics-top-moving',
  'warehouse-analytics-top-margin',
  // ── Detail cards — instant cold-open (2026-06-03) ──────────────
  // ClientDetailScreen reads ['client', id] (header card) + ['client-checks',
  // id] (history list) + ['client-checks-by-car', id]. EmployeeDetailScreen
  // reads ['employee-full-profile', id] (the whole profile aggregate) +
  // ['user', id]. All are keyed ONLY by a stable id (no search param → not
  // search-volatile), so persisting their first segments lets a tapped card
  // render from cache on cold start instead of a blocking spinner. A separate
  // agent adds the pressIn prefetch of 'client-checks' for the list.
  'client',
  'client-checks',
  'client-checks-by-car',
  'employee-full-profile',
  'user',
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

/**
 * Per-first-key cap on the number of persisted VARIANTS (different
 * sub-params → different storage slots). Without a cap, per-day calls,
 * per-month schedule/salary, per-range cashflow and per-id detail slots
 * accumulate in AsyncStorage forever, slowing `hydrateCache` (and the
 * getAllKeys/multiGet it runs) on EVERY cold start. During hydration we
 * keep the N most-recent variants per first key and GC the rest.
 * First keys not listed here are uncapped (their param space is small).
 */
const VARIANT_CAPS: Partial<Record<PersistedKey, number>> = {
  // Period-keyed screens — users flip between a few recent periods.
  calls: 3,
  schedule: 3,
  salary: 3,
  cashflow: 3,
  expenses: 3,
  // Id-keyed detail cards — keep the 10 most recently opened.
  client: 10,
  'client-checks': 10,
  'client-checks-by-car': 10,
  'employee-full-profile': 10,
  user: 10,
  // Journal infinite feed — base slot + one filtered variant.
  'checks-infinite': 2,
};

/**
 * Infinite queries persist their full `{ pages, pageParams }` aggregate.
 * A long scroll session can accumulate dozens of pages — persisting all
 * of them bloats the AsyncStorage slot and slows cold-start hydration
 * for data the user only needs after scrolling anyway. We cap the
 * persisted snapshot to the first pages; `getNextPageParam` re-derives
 * the next cursor from the restored pages, so pagination resumes cleanly.
 */
const MAX_PERSISTED_PAGES = 2;

function isInfiniteData(data: unknown): data is { pages: unknown[]; pageParams: unknown[] } {
  return (
    !!data &&
    typeof data === 'object' &&
    Array.isArray((data as { pages?: unknown }).pages) &&
    Array.isArray((data as { pageParams?: unknown }).pageParams)
  );
}

/** Bound an infinite-query payload to the first MAX_PERSISTED_PAGES pages
 *  (pages + pageParams stay aligned). Non-infinite data passes through. */
function capInfinitePages(data: unknown): unknown {
  if (!isInfiniteData(data) || data.pages.length <= MAX_PERSISTED_PAGES) return data;
  return {
    ...data,
    pages: data.pages.slice(0, MAX_PERSISTED_PAGES),
    pageParams: data.pageParams.slice(0, MAX_PERSISTED_PAGES),
  };
}

function firstKey(qk: QueryKey): string | null {
  if (!Array.isArray(qk) || qk.length === 0) return null;
  const f = qk[0];
  return typeof f === 'string' ? f : null;
}

function isPersisted(key: string | null): key is PersistedKey {
  return !!key && (PERSISTED_KEYS as readonly string[]).includes(key);
}

/**
 * Priority first-screen keys — hydrated SYNCHRONOUSLY (awaited, bounded)
 * before the first paint so the screens a user reaches fastest after the
 * splash dismisses (Dashboard, then a one-tap away Журнал / Склад) never
 * flash empty. Everything else hydrates in the background via `hydrateCache`.
 *
 * Audit #8.7: `hydrateCache` does NOT block first render (~200-500ms for the
 * full ~60-key whitelist), so a fast user reaching Журнал/Склад before
 * hydration completes saw an empty flash. Synchronously hydrating just this
 * tiny subset closes that gap while keeping boot fast — only a handful of
 * `multiGet` reads + `JSON.parse` calls, bounded by `PRIORITY_HYDRATE_BUDGET_MS`.
 *
 * Keep this list SHORT — every entry adds to the pre-paint budget.
 */
const PRIORITY_KEYS: readonly PersistedKey[] = [
  // Dashboard (initial route) — owner Hero/KPI cards.
  'dashboard-v2',
  'dashboard-chart',
  // Журнал (Чеки) — first list a tap away, owner-reported empty-flash.
  'checks-infinite',
  // Склад — warehouse switcher rows + first product page + categories.
  'warehouses',
  'warehouse-categories',
  'products',
];

const PRIORITY_KEY_SET = new Set<string>(PRIORITY_KEYS);

/** Budget for the synchronous priority hydration. We never block boot longer
 *  than this — if AsyncStorage is slow we bail and let the background pass
 *  (`hydrateCache`) finish the rest. ~80ms keeps cold start snappy. */
const PRIORITY_HYDRATE_BUDGET_MS = 80;

/**
 * Tenant-isolation gate shared by both hydration passes. Returns the auth
 * token, or `null` if the previous session is over — in which case it also
 * flushes orphaned `rqcache:v1:*` entries so a half-completed logout (process
 * killed mid-clear) can't leak tenant A's data into tenant B's next login.
 */
async function readTokenOrFlush(): Promise<string | null> {
  const token = await AsyncStorage.getItem('token');
  if (!token) {
    const orphanKeys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(STORAGE_PREFIX));
    if (orphanKeys.length > 0) {
      await AsyncStorage.multiRemove(orphanKeys).catch(() => {});
    }
    return null;
  }
  return token;
}

/**
 * Classification of one stored pair after a hydration attempt:
 *   - 'ok'      — valid, fresh, whitelisted → written into the QueryClient;
 *   - 'stale'   — too old / de-whitelisted / search-volatile → safe to GC;
 *   - 'corrupt' — unparseable or missing fields → safe to GC.
 * 'ok' carries the first key + storedAt so the variant-cap prune in
 * `hydrateCache` doesn't have to re-parse the payload.
 */
type StoredPairResult =
  | { status: 'ok'; first: PersistedKey; storedAt: number }
  | { status: 'stale' }
  | { status: 'corrupt' };

/**
 * Parse one stored pair and write it into the QueryClient if valid + fresh +
 * whitelisted. Shared by both the priority and background passes so the
 * validation rules (max-age, whitelist, shape) never drift. The returned
 * classification feeds the hydration GC (dead slots get multiRemove'd).
 */
function applyStoredPair(qc: QueryClient, raw: string | null, now: number): StoredPairResult {
  if (!raw) return { status: 'corrupt' };
  try {
    const parsed: StoredEntry = JSON.parse(raw);
    if (!parsed?.queryKey || parsed.data === undefined) return { status: 'corrupt' };
    const storedAt = parsed.storedAt ?? 0;
    if (now - storedAt > MAX_STALE_MS) return { status: 'stale' };
    const f = firstKey(parsed.queryKey);
    if (!isPersisted(f)) return { status: 'stale' };
    // Search-volatile variants written by older builds (before the
    // positional-search guard below existed) must not be resurrected —
    // classify as stale so the hydration GC drops the slot.
    if (isSearchVolatile(parsed.queryKey)) return { status: 'stale' };
    qc.setQueryData(parsed.queryKey, parsed.data);
    return { status: 'ok', first: f, storedAt };
  } catch {
    return { status: 'corrupt' };
  }
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
/**
 * Some keys carry the user-typed search as a POSITIONAL string instead of
 * a `{ search }` object part — e.g. ['suppliers', 'мас'] and
 * ['checks-infinite', 'мас', from, to, masterId]. The object-shape loop
 * below can't see those, so without this index every Журнал / Поставщики
 * keystroke persisted a full page payload. Maps first key → index of the
 * search string inside the query key. The empty-search base slot
 * (`qk[idx] === ''`) still persists.
 */
const POSITIONAL_SEARCH_IDX: Record<string, number> = {
  'checks-infinite': 1,
  suppliers: 1,
};

function isSearchVolatile(qk: QueryKey): boolean {
  if (!Array.isArray(qk)) return false;
  const f = firstKey(qk);
  const idx = f ? POSITIONAL_SEARCH_IDX[f] : undefined;
  if (idx !== undefined) {
    const v = qk[idx];
    if (typeof v === 'string' && v.length > 0) return true;
  }
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
    const token = await readTokenOrFlush();
    if (!token) return;

    const allKeys = await AsyncStorage.getAllKeys();
    const ourKeys = allKeys.filter((k) => k.startsWith(STORAGE_PREFIX));
    if (ourKeys.length === 0) return;
    const pairs = await AsyncStorage.multiGet(ourKeys);
    const now = Date.now();
    // GC bookkeeping (RNPERF: no-eviction fix). Stale / corrupt /
    // de-whitelisted / search-volatile slots found while hydrating are
    // batch-removed afterwards so they stop slowing every future cold
    // start. 'ok' entries keep their storage key + first key + storedAt
    // for the variant-cap prune below — no payload re-parse needed.
    const deadKeys: string[] = [];
    const alive: Array<{ storageKey: string; first: PersistedKey; storedAt: number }> = [];
    // Chunk JSON.parse + setQueryData so we don't hog the JS thread on a
    // cold start. 25+ entries × ~5 KB each can otherwise block UI for ~100ms,
    // dropping the first paint frame. setTimeout(0) yields to the event
    // loop between chunks so RN can draw + handle input meanwhile.
    const CHUNK = 5;
    for (let i = 0; i < pairs.length; i += CHUNK) {
      const slice = pairs.slice(i, i + CHUNK);
      for (const [skey, raw] of slice) {
        const result = applyStoredPair(qc, raw, now);
        if (result.status === 'ok') {
          alive.push({ storageKey: skey, first: result.first, storedAt: result.storedAt });
        } else {
          deadKeys.push(skey);
        }
      }
      if (i + CHUNK < pairs.length) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }

    // Variant-cap prune: per capped first key keep only the N most-recent
    // variants on disk (per-day calls, per-month schedule/salary, per-id
    // detail cards, …). Already-hydrated in-memory copies are untouched —
    // TanStack's gcTime handles those; this only bounds AsyncStorage growth
    // so the NEXT cold start reads a bounded key set.
    const grouped = new Map<PersistedKey, { cap: number; entries: typeof alive }>();
    for (const entry of alive) {
      const cap = VARIANT_CAPS[entry.first];
      if (cap === undefined) continue;
      const group = grouped.get(entry.first);
      if (group) group.entries.push(entry);
      else grouped.set(entry.first, { cap, entries: [entry] });
    }
    for (const { cap, entries } of grouped.values()) {
      if (entries.length <= cap) continue;
      entries.sort((a, b) => b.storedAt - a.storedAt);
      for (let i = cap; i < entries.length; i++) {
        deadKeys.push(entries[i].storageKey);
      }
    }

    if (deadKeys.length > 0) {
      await AsyncStorage.multiRemove(deadKeys).catch(() => {});
    }
  } catch {
    // AsyncStorage unavailable — proceed without hydration
  }
}

/**
 * Synchronously hydrate ONLY the priority first-screen keys, bounded by
 * `PRIORITY_HYDRATE_BUDGET_MS`. Awaited before first paint (see App.tsx) so
 * Dashboard / Журнал / Склад render from cache with no empty flash, while the
 * full whitelist hydrates in the background via `hydrateCache`.
 *
 * Resolves quickly: it only reads the handful of storage entries whose first
 * key is in `PRIORITY_KEYS` (via `getAllKeys` + a filtered `multiGet`), and a
 * watchdog guarantees we never block boot past the budget even on a slow
 * AsyncStorage bridge. Re-hydrating the same keys later in `hydrateCache` is
 * idempotent (`setQueryData` with equal data is a no-op for observers).
 *
 * Tenant-safe: shares the same token gate as `hydrateCache`, so a logged-out
 * device hydrates nothing and orphans are flushed.
 */
export async function hydratePriorityCache(qc: QueryClient): Promise<void> {
  const work = (async () => {
    try {
      const token = await readTokenOrFlush();
      if (!token) return;

      const allKeys = await AsyncStorage.getAllKeys();
      // Keep only OUR slots whose first key is a priority key. The stored key
      // is `STORAGE_PREFIX + JSON.stringify(queryKey)`, so a priority entry
      // serialises as e.g. `rqcache:v1:["dashboard-v2",...]` — a cheap string
      // prefix test per priority key avoids parsing every slot.
      const priorityStorageKeys = allKeys.filter((k) => {
        if (!k.startsWith(STORAGE_PREFIX)) return false;
        for (const pk of PRIORITY_KEY_SET) {
          if (k.startsWith(`${STORAGE_PREFIX}["${pk}"`)) return true;
        }
        return false;
      });
      if (priorityStorageKeys.length === 0) return;
      const pairs = await AsyncStorage.multiGet(priorityStorageKeys);
      const now = Date.now();
      for (const [, raw] of pairs) {
        applyStoredPair(qc, raw, now);
      }
    } catch {
      // AsyncStorage unavailable — background pass will fill in later.
    }
  })();

  // Watchdog: never block boot beyond the budget. Whichever settles first wins;
  // any priority key not yet hydrated is still covered by `hydrateCache`.
  await Promise.race([work, new Promise<void>((resolve) => setTimeout(resolve, PRIORITY_HYDRATE_BUDGET_MS))]);
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
 *   - DEFER serialization: the `updated` handler only records a REF to
 *     the data (no JSON.stringify on the hot path). The single stringify
 *     per quiet period runs inside the debounced flush, behind
 *     `InteractionManager.runAfterInteractions`, so it never competes
 *     with an active gesture / navigation transition for the JS thread.
 *   - Infinite-query payloads are capped to MAX_PERSISTED_PAGES pages
 *     before serialization (see `capInfinitePages`).
 */
export function attachPersistence(qc: QueryClient): () => void {
  // One pending write per storage key — replacing the slot for a given
  // key collapses N "updated" events into a single late write. We keep a
  // reference to the data (cheap), not its serialized form.
  interface PendingWrite {
    queryKey: QueryKey;
    data: unknown;
    storedAt: number;
    timer: ReturnType<typeof setTimeout>;
  }
  const pendingWrites = new Map<string, PendingWrite>();
  const WRITE_DEBOUNCE_MS = 350;

  const flush = (skey: string) => {
    const pending = pendingWrites.get(skey);
    pendingWrites.delete(skey);
    if (!pending) return;
    // Serialize + write AFTER any running interaction (gesture, screen
    // transition) finishes — a multi-page journal payload can take a few
    // ms to stringify, enough to drop frames mid-swipe.
    InteractionManager.runAfterInteractions(() => {
      let payload: string;
      try {
        const entry: StoredEntry = {
          queryKey: pending.queryKey,
          data: capInfinitePages(pending.data),
          storedAt: pending.storedAt,
        };
        payload = JSON.stringify(entry);
      } catch {
        // Non-serialisable data (circular ref etc.) — skip the write.
        return;
      }
      AsyncStorage.setItem(skey, payload).catch(() => {});
    });
  };

  const unsubscribe = qc.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated') return;
    const query = event.query;
    if (query.state.status !== 'success') return;
    const f = firstKey(query.queryKey);
    if (!isPersisted(f)) return;
    if (query.state.data === undefined) return;
    // Search-debounced lists (e.g. ['products', { search: 'мас' }] or the
    // positional ['suppliers', 'мас'] / ['checks-infinite', 'мас', ...])
    // are NOT persisted — they're transient user input variants.
    // The empty-search variant under the same first-segment IS persisted.
    if (isSearchVolatile(query.queryKey)) return;

    const skey = storageKey(query.queryKey);
    const existing = pendingWrites.get(skey);
    if (existing) clearTimeout(existing.timer);
    pendingWrites.set(skey, {
      queryKey: query.queryKey,
      data: query.state.data,
      storedAt: Date.now(),
      timer: setTimeout(() => flush(skey), WRITE_DEBOUNCE_MS),
    });
  });

  return () => {
    unsubscribe();
    // Cancel any debounced writes — App is unmounting (HMR / logout etc.)
    for (const pending of pendingWrites.values()) clearTimeout(pending.timer);
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
