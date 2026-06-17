/**
 * Pure helpers for the persistent query cache.
 *
 * Everything here is platform-agnostic: NO `react-native`, NO AsyncStorage,
 * NO QueryClient side-effects. That keeps the parsing / classification /
 * whitelist logic unit-testable under the default (node) jest environment —
 * `persistentCache.ts` (which DOES import `react-native` + AsyncStorage)
 * re-exports and composes these.
 *
 * Keys are matched by their FIRST element (always a string in our codebase —
 * e.g. ['products', { search, limit }]), so we don't enumerate every variant
 * of nested params.
 */
import type { QueryKey } from '@tanstack/react-query';

export const STORAGE_PREFIX = 'rqcache:v1:';

/**
 * Query keys whose results we persist.
 * Add a new entry only if the data is:
 *   - relatively static (changes < hourly)
 *   - useful to show stale to the user on cold start
 *   - not user-input-volatile (e.g. don't persist `['clients-plate', search]`)
 *
 * Each entry matches the FIRST element of a useQuery key (e.g.
 * ['suppliers', { search: '' }] matches 'suppliers'). Update this list
 * whenever a new screen needs instant cold-start.
 */
export const PERSISTED_KEYS = [
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

export type PersistedKey = (typeof PERSISTED_KEYS)[number];

export interface StoredEntry {
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
export const MAX_STALE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Per-first-key cap on the number of persisted VARIANTS (different
 * sub-params → different storage slots). Without a cap, per-day calls,
 * per-month schedule/salary, per-range cashflow and per-id detail slots
 * accumulate in AsyncStorage forever, slowing `hydrateCache` (and the
 * getAllKeys/multiGet it runs) on EVERY cold start. During hydration we
 * keep the N most-recent variants per first key and GC the rest.
 * First keys not listed here are uncapped (their param space is small).
 */
export const VARIANT_CAPS: Partial<Record<PersistedKey, number>> = {
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
export const MAX_PERSISTED_PAGES = 2;

export function isInfiniteData(data: unknown): data is { pages: unknown[]; pageParams: unknown[] } {
  return (
    !!data &&
    typeof data === 'object' &&
    Array.isArray((data as { pages?: unknown }).pages) &&
    Array.isArray((data as { pageParams?: unknown }).pageParams)
  );
}

/** Bound an infinite-query payload to the first MAX_PERSISTED_PAGES pages
 *  (pages + pageParams stay aligned). Non-infinite data passes through. */
export function capInfinitePages(data: unknown): unknown {
  if (!isInfiniteData(data) || data.pages.length <= MAX_PERSISTED_PAGES) return data;
  return {
    ...data,
    pages: data.pages.slice(0, MAX_PERSISTED_PAGES),
    pageParams: data.pageParams.slice(0, MAX_PERSISTED_PAGES),
  };
}

export function firstKey(qk: QueryKey): string | null {
  if (!Array.isArray(qk) || qk.length === 0) return null;
  const f = qk[0];
  return typeof f === 'string' ? f : null;
}

export function isPersisted(key: string | null): key is PersistedKey {
  return !!key && (PERSISTED_KEYS as readonly string[]).includes(key);
}

export function storageKey(qk: QueryKey): string {
  // Stringify the full query key so different params (e.g. month in
  // ['schedule', '2026-05-01', '2026-05-31']) get separate slots.
  return STORAGE_PREFIX + JSON.stringify(qk);
}

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
export function isSearchVolatile(qk: QueryKey): boolean {
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
 * Is `data` an EMPTY collection that we must NOT use as a cold-start
 * snapshot?
 *
 * Root cause this guards against: a list response captured during a 502 /
 * empty-window (e.g. «0 товаров», «нет мастеров») gets persisted, then on
 * the next cold start it masks the real "there IS data now" state — a
 * stuck-empty screen. We therefore treat an empty collection as a SKIP
 * both on write (don't persist it) and on restore (don't resurrect it),
 * so the screen falls through to a real fetch instead of showing a stale
 * emptiness.
 *
 * "Empty collection" means:
 *   - an empty array (`[]`), or
 *   - an infinite-query aggregate (`{ pages, pageParams }`) whose every
 *     page is itself an empty collection (empty array, or an object with
 *     an empty `items` / `data` / `results` array — the shapes our
 *     paginated endpoints return).
 *
 * NON-collections (plain objects like a single `['client', id]` card, or
 * scalars) are NEVER empty-collections — they pass through and persist as
 * before, preserving instant cold-open for detail screens.
 */
export function isEmptyCollection(data: unknown): boolean {
  if (Array.isArray(data)) return data.length === 0;
  if (isInfiniteData(data)) {
    // No pages at all → empty. Otherwise empty only if EVERY page is empty.
    return data.pages.every((page) => isEmptyPage(page));
  }
  return false;
}

/** A single infinite-query page is empty if it's an empty array or an
 *  object whose list field (items/data/results) is an empty array. A page
 *  with no recognisable list field is treated as non-empty (we can't prove
 *  it's empty, so we don't drop it). */
function isEmptyPage(page: unknown): boolean {
  if (Array.isArray(page)) return page.length === 0;
  if (page && typeof page === 'object') {
    const obj = page as Record<string, unknown>;
    for (const field of ['items', 'data', 'results'] as const) {
      const v = obj[field];
      if (Array.isArray(v)) return v.length === 0;
    }
  }
  return false;
}

/**
 * Classification of one stored pair after parsing:
 *   - 'ok'      — valid, fresh, whitelisted, non-empty → caller writes it
 *                 into the QueryClient (carrying queryKey + data + storedAt);
 *   - 'skip'    — valid + whitelisted but an EMPTY collection → do NOT
 *                 resurrect it (would mask real data), and do NOT GC the
 *                 slot (a future non-empty write may legitimately replace it);
 *   - 'stale'   — too old / de-whitelisted / search-volatile → safe to GC;
 *   - 'corrupt' — unparseable or missing fields → safe to GC.
 * 'ok' carries the first key + storedAt so the variant-cap prune in
 * `hydrateCache` doesn't have to re-parse the payload.
 */
export type StoredPairResult =
  | { status: 'ok'; first: PersistedKey; storedAt: number; queryKey: QueryKey; data: unknown }
  | { status: 'skip' }
  | { status: 'stale' }
  | { status: 'corrupt' };

/**
 * PURE parse + classify of one stored pair. No side-effects, no QueryClient,
 * no AsyncStorage — fully unit-testable. The validation rules (max-age,
 * whitelist, search-volatile guard, empty-collection guard, shape) live here
 * so both the priority and background hydration passes share one source of
 * truth and never drift.
 */
export function classifyStoredPair(raw: string | null, now: number): StoredPairResult {
  if (!raw) return { status: 'corrupt' };
  let parsed: StoredEntry;
  try {
    parsed = JSON.parse(raw) as StoredEntry;
  } catch {
    return { status: 'corrupt' };
  }
  if (!parsed?.queryKey || parsed.data === undefined) return { status: 'corrupt' };
  const storedAt = parsed.storedAt ?? 0;
  if (now - storedAt > MAX_STALE_MS) return { status: 'stale' };
  const f = firstKey(parsed.queryKey);
  if (!isPersisted(f)) return { status: 'stale' };
  // Search-volatile variants written by older builds (before the
  // positional-search guard existed) must not be resurrected — classify
  // as stale so the hydration GC drops the slot.
  if (isSearchVolatile(parsed.queryKey)) return { status: 'stale' };
  // Empty-collection guard (root-cause fix): an empty list snapshot must
  // never mask "there IS data now" on cold start. Skip — but DON'T GC, so
  // a later non-empty write can take its place.
  if (isEmptyCollection(parsed.data)) return { status: 'skip' };
  return { status: 'ok', first: f, storedAt, queryKey: parsed.queryKey, data: parsed.data };
}
