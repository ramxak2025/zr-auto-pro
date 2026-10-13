import AsyncStorage from '@react-native-async-storage/async-storage';
import { storageWriteFailureKind } from '../../../shared/utils/storageFailure';
import { isPersisted, STORAGE_PREFIX } from './persistentCache.helpers';

export const SCOPED_CACHE_PREFIX = 'rqcache:v2:';
let storageMutationTail: Promise<void> = Promise.resolve();

/** Cache writes/clears and durable writes share one native mutation order. */
export function enqueueStorageMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const queued = storageMutationTail.then(mutation);
  storageMutationTail = queued.then(
    () => undefined,
    () => undefined,
  );
  return queued;
}

/** Only namespaces and query keys owned by the recoverable query cache. */
function isCacheKey(key: string): boolean {
  try {
    let encoded: string;
    if (key.startsWith(SCOPED_CACHE_PREFIX)) {
      const scoped = key.slice(SCOPED_CACHE_PREFIX.length);
      const boundary = scoped.indexOf(':');
      if (boundary < 0) return false;
      const owner: unknown = JSON.parse(decodeURIComponent(scoped.slice(0, boundary)));
      if (
        !Array.isArray(owner) ||
        owner.length !== 3 ||
        (owner[0] !== null && typeof owner[0] !== 'string') ||
        typeof owner[1] !== 'string' ||
        !owner[1] ||
        (owner[2] !== null && typeof owner[2] !== 'string')
      )
        return false;
      encoded = scoped.slice(boundary + 1);
    } else if (key.startsWith(STORAGE_PREFIX)) encoded = key.slice(STORAGE_PREFIX.length);
    else if (key.startsWith('rqcache:')) encoded = key.slice('rqcache:'.length);
    else return false;
    const query: unknown = JSON.parse(encoded);
    return Array.isArray(query) && typeof query[0] === 'string' && isPersisted(query[0]);
  } catch {
    return false;
  }
}

async function oldestCacheKeys(): Promise<string[]> {
  const keys = (await AsyncStorage.getAllKeys()).filter(isCacheKey);
  const entries: Array<{ key: string; storedAt: number }> = [];
  for (const key of keys) {
    let storedAt = 0;
    try {
      const raw = await AsyncStorage.getItem(key);
      const entry = raw === null ? null : (JSON.parse(raw) as { storedAt?: unknown });
      if (typeof entry?.storedAt === 'number' && Number.isFinite(entry.storedAt)) storedAt = entry.storedAt;
    } catch {
      // A corrupt/oversized cache entry is disposable too. Financial records
      // cannot reach this branch because their keys are outside the allowlist.
    }
    entries.push({ key, storedAt });
  }
  return entries.sort((a, b) => a.storedAt - b.storedAt || a.key.localeCompare(b.key)).map((entry) => entry.key);
}

/** The caller reserves its intent owner BEFORE entering this queue. Never nest
 * this inside enqueueStorageMutation: the complete retry is one mutation. */
export function setItemWithCacheRecovery(key: string, value: string): Promise<void> {
  return enqueueStorageMutation(async () => {
    let failure: unknown;
    try {
      await AsyncStorage.setItem(key, value);
      return;
    } catch (error) {
      failure = error;
    }
    const kind = storageWriteFailureKind(failure);
    if (kind === 'other') throw failure;
    let candidates: string[];
    try {
      candidates = await oldestCacheKeys();
    } catch {
      // Preserve the original write failure when even enumeration is unavailable.
      throw failure;
    }
    const attempts = kind === 'capacity' ? candidates : candidates.slice(0, 1);
    for (const candidate of attempts) {
      await AsyncStorage.removeItem(candidate);
      try {
        // Retry the SAME bytes and requestId; never bypass durable persistence.
        await AsyncStorage.setItem(key, value);
        return;
      } catch (error) {
        failure = error;
        if (storageWriteFailureKind(error) !== 'capacity') break;
      }
    }
    throw failure;
  });
}
