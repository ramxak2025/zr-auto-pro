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
 *   - we only persist a whitelist, full-cache persistence would be wasteful
 *   - no extra dependency
 *
 * Pure parsing / classification / whitelist logic lives in
 * `persistentCache.helpers.ts` (no react-native / AsyncStorage imports) so
 * it can be unit-tested under the default jest (node) environment.
 */
import { InteractionManager } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { AUTH_SESSION_ENVELOPE_KEY, LEGACY_TOKEN_KEY, parseAuthSessionEnvelope } from '../contexts/authSessionStorage';
import {
  STORAGE_PREFIX,
  PERSISTED_KEYS,
  VARIANT_CAPS,
  capInfinitePages,
  classifyStoredPair,
  firstKey,
  isEmptyCollection,
  isPersisted,
  isSearchVolatile,
  storageKey,
  type PersistedKey,
  type StoredEntry,
  type StoredPairResult,
} from './persistentCache.helpers';

/**
 * Apply one parsed stored pair to the QueryClient if it classifies as 'ok'.
 *
 * ROOT-CAUSE FIX: we pass the real `{ updatedAt: storedAt }` so React Query
 * sets `dataUpdatedAt` to when the data was actually fetched — NOT `Date.now()`.
 * Without it, hydrated data looked freshly-fetched, so within `staleTime`
 * (1–5 min) the screen would NOT refetch on mount and a stale/empty snapshot
 * (e.g. captured in a 502 window) stayed visible, masking reality. With the
 * real age, an entry older than `staleTime` is `isStale()` immediately and
 * React Query refetches on mount, overwriting stale with fresh.
 * (`SetDataOptions.updatedAt` is supported in @tanstack/react-query v5.)
 *
 * Returns the same classification so the hydration GC can act on it.
 */
function applyStoredPair(qc: QueryClient, raw: string | null, now: number): StoredPairResult {
  const result = classifyStoredPair(raw, now);
  if (result.status === 'ok') {
    qc.setQueryData(result.queryKey, result.data, { updatedAt: result.storedAt });
  }
  return result;
}

// Re-export the classification type so any import site referencing it from
// this module keeps resolving (single source of truth: the helpers module).
export type { StoredPairResult };

/**
 * Priority first-screen keys — hydrated SYNCHRONOUSLY (awaited, bounded)
 * before the first paint so the screens a user reaches fastest after the
 * splash dismisses (Dashboard, then a one-tap away Журнал / Склад) never
 * flash empty. Everything else hydrates in the background via `hydrateCache`.
 *
 * Audit #8.7: `hydrateCache` does NOT block first render (~200-500ms for the
 * full whitelist), so a fast user reaching Журнал/Склад before hydration
 * completes saw an empty flash. Synchronously hydrating just this tiny subset
 * closes that gap while keeping boot fast — only a handful of `multiGet` reads
 * + `JSON.parse` calls, bounded by `PRIORITY_HYDRATE_BUDGET_MS`.
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
 * Session boundary for cache mutations.
 *
 * AsyncStorage calls cross the native bridge and cannot be cancelled once
 * started. A logout/login clear must therefore be ordered AFTER an in-flight
 * write from the previous tenant, while delayed/debounced writes that have not
 * started yet must be discarded. The generation provides the latter; the
 * shared promise tail provides the former (and also keeps new-session writes
 * behind the clear).
 */
let persistenceGeneration = 0;
let persistenceBoundaryReady = true;
let storageMutationTail: Promise<void> = Promise.resolve();

function enqueueStorageMutation(mutation: () => Promise<void>): Promise<void> {
  const queued = storageMutationTail.then(mutation);
  // A failed mutation must not poison the queue for later clears or writes.
  // Callers still receive `queued`, so clear failures can gate auth commits.
  storageMutationTail = queued.catch(() => {});
  return queued;
}

function isCurrentGeneration(generation: number): boolean {
  return generation === persistenceGeneration;
}

function isWritableGeneration(generation: number): boolean {
  return isCurrentGeneration(generation) && persistenceBoundaryReady;
}

interface HydrationAuthSession {
  token: string | null;
  identity: string;
  /** Which durable source decided the session (envelope wins over legacy). */
  source: 'v1' | 'legacy';
  /**
   * true — durable-сессию не удалось ПРОЧИТАТЬ (reject нативного getItem).
   * Это НЕ сигнал «разлогинен»: гидрацию пропускаем, но rqcache-слоты на
   * диске не трогаем — иначе транзиентный сбой моста/storage стирал бы весь
   * instant-boot кэш живого пользователя.
   */
  unreadable?: boolean;
}

/**
 * Resolve the authoritative cold-start auth owner. A valid v1 envelope wins
 * over every legacy mirror, including a logged-out tombstone over a stale A
 * token. Legacy is used only as the migration fallback for a missing/corrupt
 * envelope.
 *
 * The identity deliberately EXCLUDES `envelope.generation`: authSessionStorage
 * bumps it on every write, including the bootstrap `/auth/me` revalidation
 * that re-commits the SAME token+user. Folding it in made a successful `/me`
 * mid-hydration look like a session change and silently aborted the rest of
 * background hydration (+ its GC pass) for the very same user. A user switch
 * always changes the token, and every in-process transition (login / logout /
 * 401 / impersonation) synchronously bumps `persistenceGeneration` via
 * `clearPersistentCache` — so the token alone is the durable identity.
 */
function resolveHydrationAuthSession(rawEnvelope: string | null, legacyToken: string | null): HydrationAuthSession {
  const envelope = parseAuthSessionEnvelope(rawEnvelope);
  if (envelope) {
    return {
      token: envelope.token,
      identity: JSON.stringify(['v1', envelope.token]),
      source: 'v1',
    };
  }
  return { token: legacyToken, identity: JSON.stringify(['legacy', legacyToken]), source: 'legacy' };
}

async function readHydrationAuthSession(): Promise<HydrationAuthSession> {
  let readFailed = false;
  const guardedGet = (key: string) =>
    AsyncStorage.getItem(key).catch(() => {
      readFailed = true;
      return null;
    });
  const [rawEnvelope, legacyToken] = await Promise.all([
    guardedGet(AUTH_SESSION_ENVELOPE_KEY),
    guardedGet(LEGACY_TOKEN_KEY),
  ]);
  const session = resolveHydrationAuthSession(rawEnvelope, legacyToken);
  // Валидный конверт авторитетен — сбой чтения одного лишь legacy-зеркала не
  // важен. Во всех остальных случаях reject любого из чтений означает
  // «состояние сессии неизвестно», а НЕ «разлогинен»: вызывающие обязаны
  // пропустить гидрацию и не трогать диск.
  if (session.source !== 'v1' && readFailed) {
    return { ...session, identity: JSON.stringify(['unreadable']), unreadable: true };
  }
  return session;
}

/** Re-check the authoritative durable session after a hydration await/yield. */
async function isCurrentHydrationSession(generation: number, session: HydrationAuthSession): Promise<boolean> {
  if (!isCurrentGeneration(generation)) return false;
  const currentSession = await readHydrationAuthSession();
  return isCurrentGeneration(generation) && currentSession.identity === session.identity;
}

/**
 * Tenant-isolation gate shared by both hydration passes. Returns the durable
 * auth identity, or `null` if the previous session is over — in which case it
 * also flushes orphaned `rqcache:v1:*` entries so a half-completed logout
 * (process killed mid-clear) can't leak A's data into B's next login.
 */
async function readTokenOrFlush(generation: number): Promise<HydrationAuthSession | null> {
  const session = await readHydrationAuthSession();
  if (!isCurrentGeneration(generation)) return null;

  // Сбой ЧТЕНИЯ auth-ключей ≠ «разлогинен»: без достоверного знания о сессии
  // гидрацию пропускаем, но НИЧЕГО не удаляем — стирать rqcache-слоты можно
  // только по успешно прочитанному logged-out состоянию.
  if (session.unreadable) return null;

  if (!session.token) {
    const allKeys = await AsyncStorage.getAllKeys();
    if (!isCurrentGeneration(generation)) return null;

    const orphanKeys = allKeys.filter((k) => k.startsWith(STORAGE_PREFIX));
    if (orphanKeys.length > 0) {
      // Serialize this GC with normal writes/clear too. If a session boundary
      // wins before the queued removal starts, the stale cleanup is a no-op.
      await enqueueStorageMutation(async () => {
        if (!isWritableGeneration(generation)) return;
        await AsyncStorage.multiRemove(orphanKeys);
      }).catch(() => {});
    }
    return null;
  }
  return session;
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
  const hydrationGeneration = persistenceGeneration;

  try {
    // Tenant isolation gate. Read the auth token first; if it's missing,
    // the previous session is over and no persisted entries should be
    // resurrected into the QueryClient. We also flush any orphan entries
    // so the next login starts clean.
    const authSession = await readTokenOrFlush(hydrationGeneration);
    if (!authSession?.token || !isCurrentGeneration(hydrationGeneration)) return;

    const allKeys = await AsyncStorage.getAllKeys();
    if (!(await isCurrentHydrationSession(hydrationGeneration, authSession))) return;

    const ourKeys = allKeys.filter((k) => k.startsWith(STORAGE_PREFIX));
    if (ourKeys.length === 0) return;
    const pairs = await AsyncStorage.multiGet(ourKeys);
    if (!(await isCurrentHydrationSession(hydrationGeneration, authSession))) return;

    const now = Date.now();
    // GC bookkeeping (RNPERF: no-eviction fix). Stale / corrupt /
    // de-whitelisted / search-volatile slots found while hydrating are
    // batch-removed afterwards so they stop slowing every future cold
    // start. 'ok' entries keep their storage key + first key + storedAt
    // for the variant-cap prune below — no payload re-parse needed.
    // 'skip' entries (empty collections) are LEFT on disk untouched: a
    // later non-empty write may legitimately replace the slot, and GC'ing
    // it would just churn AsyncStorage.
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
        // No await occurs within a chunk, but checking every pair makes the
        // apply boundary explicit and protects against synchronous re-entry.
        if (!isCurrentGeneration(hydrationGeneration)) return;
        const result = applyStoredPair(qc, raw, now);
        if (result.status === 'ok') {
          alive.push({ storageKey: skey, first: result.first, storedAt: result.storedAt });
        } else if (result.status === 'stale' || result.status === 'corrupt') {
          deadKeys.push(skey);
        }
        // 'skip' → leave on disk, don't hydrate.
      }
      if (i + CHUNK < pairs.length) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        if (!(await isCurrentHydrationSession(hydrationGeneration, authSession))) return;
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
      await enqueueStorageMutation(async () => {
        if (!isWritableGeneration(hydrationGeneration)) return;
        await AsyncStorage.multiRemove(deadKeys);
      }).catch(() => {});
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
  const hydrationGeneration = persistenceGeneration;

  const work = (async () => {
    try {
      const authSession = await readTokenOrFlush(hydrationGeneration);
      if (!authSession?.token || !isCurrentGeneration(hydrationGeneration)) return;

      const allKeys = await AsyncStorage.getAllKeys();
      if (!(await isCurrentHydrationSession(hydrationGeneration, authSession))) return;

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
      if (!(await isCurrentHydrationSession(hydrationGeneration, authSession))) return;

      const now = Date.now();
      for (const [, raw] of pairs) {
        if (!isCurrentGeneration(hydrationGeneration)) return;
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
 *   - SKIP empty collections (root-cause fix): a list response captured in
 *     a 502 / empty window must NOT be persisted, otherwise it masks the
 *     "there IS data now" state on the next cold start.
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
    generation: number;
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
      // `clearPersistentCache` invalidates this generation synchronously.
      // Avoid even serialising a delayed old-tenant payload after that point.
      if (pending.generation !== persistenceGeneration) return;

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

      const write = enqueueStorageMutation(async () => {
        // The generation may have changed while this write was waiting behind
        // another AsyncStorage mutation. Such a queued-but-not-started write
        // belongs to the old tenant and must become a no-op.
        if (!isWritableGeneration(pending.generation)) return;
        await AsyncStorage.setItem(skey, payload);
      });
      // Persistence is best-effort; keep failures isolated from the app and
      // from the serialized queue's following mutations.
      void write.catch(() => {});
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
    // Empty-collection guard (root-cause fix): never persist an empty list
    // snapshot. A 502 / empty-window response would otherwise be cached and
    // mask real data on the next cold start (stuck «0 товаров» / «нет
    // мастеров»). Non-list objects (detail cards) and non-empty lists
    // persist as before.
    if (isEmptyCollection(query.state.data)) return;

    const skey = storageKey(query.queryKey);
    const existing = pendingWrites.get(skey);
    if (existing) clearTimeout(existing.timer);
    pendingWrites.set(skey, {
      queryKey: query.queryKey,
      data: query.state.data,
      storedAt: Date.now(),
      generation: persistenceGeneration,
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
export function clearPersistentCache(): Promise<void> {
  // This executes before the function returns, invalidating every old-session
  // debounce / InteractionManager callback immediately. The queued clear then
  // waits for any AsyncStorage.setItem that had already started.
  persistenceGeneration += 1;
  const clearGeneration = persistenceGeneration;
  persistenceBoundaryReady = false;

  return enqueueStorageMutation(async () => {
    const allKeys = await AsyncStorage.getAllKeys();
    const ourKeys = allKeys.filter((k) => k.startsWith(STORAGE_PREFIX));
    if (ourKeys.length > 0) await AsyncStorage.multiRemove(ourKeys);

    // Two clears may overlap. Only the newest successful boundary can admit
    // current-generation cache writes again.
    if (isCurrentGeneration(clearGeneration)) persistenceBoundaryReady = true;
  });
}

// Re-export the whitelist so callers / docs that referenced `PERSISTED_KEYS`
// from this module keep resolving (single source of truth now lives in the
// helpers module).
export { PERSISTED_KEYS };
