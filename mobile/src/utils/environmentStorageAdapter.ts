/** Logical storage keys stay unchanged for existing owner/account helpers.
 * Enumeration exposes only this environment; native keys never leave the seam.
 * No clear() operation is exposed, so callers cannot erase another environment.
 */
export interface EnvironmentKeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<unknown>;
  removeItem(key: string): Promise<unknown>;
}
export function createEnvironmentKeyValueStorage<T extends EnvironmentKeyValueStorage>(
  storage: T,
  prefix: string,
): EnvironmentKeyValueStorage {
  if (!prefix) return storage;
  return {
    getItem: (key) => storage.getItem(prefix + key),
    setItem: (key, value) => storage.setItem(prefix + key, value),
    removeItem: (key) => storage.removeItem(prefix + key),
  };
}
export interface EnvironmentStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  getAllKeys(): Promise<readonly string[]>;
  multiGet(keys: readonly string[]): Promise<readonly [string, string | null][]>;
  multiSet(values: readonly [string, string][]): Promise<void>;
  multiRemove(keys: readonly string[]): Promise<void>;
}
export function createEnvironmentStorage(storage: EnvironmentStorage, prefix: string): EnvironmentStorage {
  if (!prefix) return storage;
  const key = (name: string) => prefix + name;
  return {
    getItem: (name) => storage.getItem(key(name)),
    setItem: (name, value) => storage.setItem(key(name), value),
    removeItem: (name) => storage.removeItem(key(name)),
    getAllKeys: async () =>
      (await storage.getAllKeys()).filter((name) => name.startsWith(prefix)).map((name) => name.slice(prefix.length)),
    multiGet: async (names) =>
      (await storage.multiGet(names.map(key))).map(([name, value]) => [name.slice(prefix.length), value]),
    multiSet: (values) => storage.multiSet(values.map(([name, value]) => [key(name), value])),
    multiRemove: (names) => storage.multiRemove(names.map(key)),
  };
}
