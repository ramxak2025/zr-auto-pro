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

  /** Memoize an async function for ttlMs. Skips caching on rejection. */
  async wrap<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
    const hit = this.get<T>(key);
    if (hit !== undefined) return hit;
    const value = await fn();
    this.set(key, value, ttlMs);
    return value;
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
