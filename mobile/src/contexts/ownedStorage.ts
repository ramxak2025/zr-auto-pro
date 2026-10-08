import AsyncStorage from '@react-native-async-storage/async-storage';
import type { captureDataSession } from './dataSession';
type Lease = ReturnType<typeof captureDataSession>;
interface Storage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<unknown>;
  removeItem(key: string): Promise<unknown>;
}
export const OWNED_DATA_PREFIX = 'autexa:data:v1:';
/** Non-credential preferences/acknowledgements. Late native writes stay ahead
 * of new reads of the same owner after A→B→A; no unknown legacy key is adopted. */
export function createOwnedStorage(storage: Storage) {
  let tail: Promise<unknown> = Promise.resolve();
  const run = <T>(work: () => Promise<T>) => {
    const result = tail.catch(() => {}).then(work);
    tail = result.catch(() => {});
    return result;
  };
  const key = (name: string, lease: Lease) => `${OWNED_DATA_PREFIX}${lease.key}:${name}`;
  return {
    get: (name: string, lease: Lease) =>
      run(async () => {
        if (!lease.key || !lease.isCurrent()) return null;
        const value = await storage.getItem(key(name, lease));
        return lease.isCurrent() ? value : null;
      }),
    set: (name: string, value: string, lease: Lease) =>
      run(async () => {
        if (lease.key && lease.isCurrent()) await storage.setItem(key(name, lease), value);
      }),
    remove: (name: string, lease: Lease) =>
      run(async () => {
        if (lease.key && lease.isCurrent()) await storage.removeItem(key(name, lease));
      }),
  };
}
export const ownedStorage = createOwnedStorage(AsyncStorage);
