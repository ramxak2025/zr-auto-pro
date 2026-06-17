/**
 * Tests for the PURE persistent-cache helpers.
 *
 * These guard the SYSTEM-ROOT fix for the "нет мастеров / 0 товаров / залипшая
 * пустота" class of bugs:
 *
 *   FIX 1 — hydrated data must carry its REAL age. `classifyStoredPair`
 *           returns `storedAt` for every 'ok' pair; the (RN-side) wrapper
 *           forwards it as `setQueryData(key, data, { updatedAt: storedAt })`
 *           so React Query ages the snapshot correctly and refetches stale
 *           data on mount instead of trusting a stale/empty 502-window value.
 *
 *   FIX 2 — empty collections must never be persisted or resurrected. An empty
 *           list captured in a 502 / empty window would otherwise mask the
 *           "there IS data now" state on the next cold start. `isEmptyCollection`
 *           classifies them; `classifyStoredPair` returns 'skip' for them.
 *
 * Imports ONLY the pure helpers module (no react-native / AsyncStorage) so it
 * runs under the default node jest environment, like the other util tests.
 */
import { isEmptyCollection, classifyStoredPair, MAX_STALE_MS, type StoredEntry } from '../persistentCache.helpers';

const NOW = 1_700_000_000_000; // fixed deterministic "now"

/** Serialise a StoredEntry exactly as `attachPersistence` would on disk. */
function serialise(entry: StoredEntry): string {
  return JSON.stringify(entry);
}

describe('isEmptyCollection', () => {
  it('treats an empty array as empty', () => {
    expect(isEmptyCollection([])).toBe(true);
  });

  it('treats a non-empty array as NOT empty', () => {
    expect(isEmptyCollection([{ id: 1 }])).toBe(false);
  });

  it('treats a plain object (detail card) as NOT empty', () => {
    // ['client', id] etc. — single object, never a collection.
    expect(isEmptyCollection({ id: 7, name: 'Иван' })).toBe(false);
  });

  it('treats an empty object as NOT empty (not a collection)', () => {
    expect(isEmptyCollection({})).toBe(false);
  });

  it('treats scalars / null / undefined as NOT empty', () => {
    expect(isEmptyCollection(null)).toBe(false);
    expect(isEmptyCollection(undefined)).toBe(false);
    expect(isEmptyCollection(0)).toBe(false);
    expect(isEmptyCollection('')).toBe(false);
    expect(isEmptyCollection(false)).toBe(false);
  });

  describe('infinite-query aggregates', () => {
    it('is empty when there are no pages at all', () => {
      expect(isEmptyCollection({ pages: [], pageParams: [] })).toBe(true);
    });

    it('is empty when every page is an empty array', () => {
      expect(isEmptyCollection({ pages: [[], []], pageParams: [0, 1] })).toBe(true);
    });

    it('is empty when every page has an empty items/data/results array', () => {
      expect(isEmptyCollection({ pages: [{ items: [] }], pageParams: [0] })).toBe(true);
      expect(isEmptyCollection({ pages: [{ data: [] }], pageParams: [0] })).toBe(true);
      expect(isEmptyCollection({ pages: [{ results: [] }], pageParams: [0] })).toBe(true);
    });

    it('is NOT empty when any page has rows', () => {
      expect(isEmptyCollection({ pages: [{ items: [] }, { items: [{ id: 1 }] }], pageParams: [0, 1] })).toBe(false);
      expect(isEmptyCollection({ pages: [[{ id: 1 }]], pageParams: [0] })).toBe(false);
    });

    it('is NOT empty when a page has no recognisable list field (cannot prove empty)', () => {
      // We must not drop data we can't classify — better to keep it cached.
      expect(isEmptyCollection({ pages: [{ total: 5 }], pageParams: [0] })).toBe(false);
    });
  });
});

describe('classifyStoredPair', () => {
  it('returns corrupt for null / empty / unparseable raw', () => {
    expect(classifyStoredPair(null, NOW).status).toBe('corrupt');
    expect(classifyStoredPair('', NOW).status).toBe('corrupt');
    expect(classifyStoredPair('{not json', NOW).status).toBe('corrupt');
  });

  it('returns corrupt when required fields are missing', () => {
    expect(classifyStoredPair(JSON.stringify({ data: [], storedAt: NOW }), NOW).status).toBe('corrupt');
    expect(classifyStoredPair(JSON.stringify({ queryKey: ['products'], storedAt: NOW }), NOW).status).toBe('corrupt'); // data === undefined
  });

  it('returns stale for an entry older than MAX_STALE_MS', () => {
    const raw = serialise({ queryKey: ['products'], data: [{ id: 1 }], storedAt: NOW - MAX_STALE_MS - 1 });
    expect(classifyStoredPair(raw, NOW).status).toBe('stale');
  });

  it('returns stale for a de-whitelisted first key', () => {
    const raw = serialise({ queryKey: ['totally-not-persisted'], data: [{ id: 1 }], storedAt: NOW });
    expect(classifyStoredPair(raw, NOW).status).toBe('stale');
  });

  it('returns stale for a search-volatile object variant', () => {
    const raw = serialise({ queryKey: ['products', { search: 'мас' }], data: [{ id: 1 }], storedAt: NOW });
    expect(classifyStoredPair(raw, NOW).status).toBe('stale');
  });

  it('returns stale for a positional search-volatile variant', () => {
    const raw = serialise({ queryKey: ['suppliers', 'мас'], data: [{ id: 1 }], storedAt: NOW });
    expect(classifyStoredPair(raw, NOW).status).toBe('stale');
  });

  // ── FIX 2: empty collection → skip (NOT ok, NOT GC'd) ──────────────────
  it('returns skip for a whitelisted EMPTY array (must not mask real data)', () => {
    const raw = serialise({ queryKey: ['products'], data: [], storedAt: NOW });
    expect(classifyStoredPair(raw, NOW).status).toBe('skip');
  });

  it('returns skip for a whitelisted EMPTY infinite aggregate', () => {
    const raw = serialise({
      queryKey: ['checks-infinite', ''],
      data: { pages: [{ items: [] }], pageParams: [0] },
      storedAt: NOW,
    });
    expect(classifyStoredPair(raw, NOW).status).toBe('skip');
  });

  it('returns skip for masters/users empty list (the reported "нет мастеров")', () => {
    expect(classifyStoredPair(serialise({ queryKey: ['masters'], data: [], storedAt: NOW }), NOW).status).toBe('skip');
    expect(classifyStoredPair(serialise({ queryKey: ['users'], data: [], storedAt: NOW }), NOW).status).toBe('skip');
  });

  // ── FIX 1: non-empty → ok, carrying storedAt for updatedAt ─────────────
  it('returns ok for a fresh, whitelisted, NON-empty array with storedAt preserved', () => {
    const storedAt = NOW - 60_000; // 1 min ago
    const data = [{ id: 1 }, { id: 2 }];
    const raw = serialise({ queryKey: ['products'], data, storedAt });
    const res = classifyStoredPair(raw, NOW);
    expect(res.status).toBe('ok');
    if (res.status === 'ok') {
      // This storedAt is exactly what the wrapper forwards as
      // setQueryData(..., { updatedAt: storedAt }) — the root-cause fix.
      expect(res.storedAt).toBe(storedAt);
      expect(res.first).toBe('products');
      expect(res.queryKey).toEqual(['products']);
      expect(res.data).toEqual(data);
    }
  });

  it('returns ok for a whitelisted non-collection object (detail card)', () => {
    const storedAt = NOW - 5_000;
    const data = { id: 42, name: 'Клиент' };
    const raw = serialise({ queryKey: ['client', 42], data, storedAt });
    const res = classifyStoredPair(raw, NOW);
    expect(res.status).toBe('ok');
    if (res.status === 'ok') {
      expect(res.storedAt).toBe(storedAt);
      expect(res.first).toBe('client');
    }
  });

  it('returns ok for a non-empty infinite aggregate with storedAt preserved', () => {
    const storedAt = NOW - 120_000;
    const data = { pages: [{ items: [{ id: 1 }] }], pageParams: [0] };
    const raw = serialise({ queryKey: ['checks-infinite', ''], data, storedAt });
    const res = classifyStoredPair(raw, NOW);
    expect(res.status).toBe('ok');
    if (res.status === 'ok') expect(res.storedAt).toBe(storedAt);
  });

  it('defaults missing storedAt to 0 → classified stale (epoch is older than MAX_STALE_MS)', () => {
    const raw = JSON.stringify({ queryKey: ['products'], data: [{ id: 1 }] });
    expect(classifyStoredPair(raw, NOW).status).toBe('stale');
  });
});
