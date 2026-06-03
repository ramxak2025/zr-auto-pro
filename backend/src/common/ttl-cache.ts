// Minimal in-memory TTL cache used for short-lived report aggregates.
// REDIS_URL is read but no redis client is wired up in this build —
// we fall back to a per-process Map. Single-instance deployment, so
// this is fine.
//
// Use sparingly: only for endpoints where the data is expensive to compute
// AND tolerable to be a few seconds stale (dashboard tiles, alert lists).
// Anything user-mutating must NEVER go through here.

interface Entry<T> {
  value: T;
  expiresAt: number;
}

export class TtlCache {
  private store = new Map<string, Entry<unknown>>();
  // In-flight promises keyed by cache key. Concurrent cold-key callers share
  // ONE computation instead of stampeding the DB (the dashboard fires ~15
  // widget queries at once on a cold cache). Entries are deleted as soon as
  // the promise settles, so this never holds memory beyond a single compute.
  private inflight = new Map<string, Promise<unknown>>();

  /** Read a value if it hasn't expired; otherwise return undefined. */
  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  /** Cache a value for ttlMs milliseconds. */
  set<T>(key: string, value: T, ttlMs: number) {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  /**
   * Memoize an async function for ttlMs. Skips caching on rejection.
   *
   * In-flight de-duplication: if another caller is already computing this
   * exact key, we await their promise instead of launching a second `fn()`.
   * This collapses a cold-cache stampede (e.g. dashboard load) down to one
   * DB round-trip per key. A rejection is shared by all waiters and the
   * in-flight slot is cleared so the next call retries cleanly.
   */
  async wrap<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
    const hit = this.get<T>(key);
    if (hit !== undefined) return hit;

    const existing = this.inflight.get(key) as Promise<T> | undefined;
    if (existing) return existing;

    const promise = (async () => {
      const value = await fn();
      this.set(key, value, ttlMs);
      return value;
    })();

    this.inflight.set(key, promise);
    try {
      return await promise;
    } finally {
      // Always clear the in-flight slot once settled — on success the value
      // is now in `store`; on failure the next caller should re-attempt.
      this.inflight.delete(key);
    }
  }

  /** Drop a specific key (e.g. when underlying data is mutated). */
  invalidate(key: string) {
    this.store.delete(key);
  }

  /** Drop every key starting with a given prefix. */
  invalidatePrefix(prefix: string) {
    for (const k of this.store.keys()) {
      if (k.startsWith(prefix)) this.store.delete(k);
    }
  }
}

// Singleton — every module that imports this gets the same instance.
export const ttlCache = new TtlCache();
