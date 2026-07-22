/**
 * Deterministic tests for the AsyncStorage session boundary in
 * `persistentCache.ts`. Timers, InteractionManager and the native-storage
 * bridge are all controlled explicitly so the two logout/login races cannot
 * pass merely because native promises happened to settle quickly.
 */
import { QueryClient } from '@tanstack/react-query';
import { AUTH_SESSION_ENVELOPE_KEY, LEGACY_TOKEN_KEY } from '../../contexts/authSessionStorage';

const mockInteractionCallbacks: Array<() => void> = [];

const mockAsyncStorage = {
  getItem: jest.fn<Promise<string | null>, [string]>(),
  setItem: jest.fn<Promise<void>, [string, string]>(),
  getAllKeys: jest.fn<Promise<readonly string[]>, []>(),
  multiGet: jest.fn<Promise<readonly (readonly [string, string | null])[]>, [readonly string[]]>(),
  multiRemove: jest.fn<Promise<void>, [readonly string[]]>(),
};

jest.mock('react-native', () => ({
  InteractionManager: {
    runAfterInteractions: jest.fn((callback: () => void) => {
      mockInteractionCallbacks.push(callback);
      return { cancel: jest.fn() };
    }),
  },
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: mockAsyncStorage,
}));

type PersistentCacheModule = typeof import('../persistentCache');

function loadPersistentCache(): PersistentCacheModule {
  // The generation and serialized mutation tail deliberately live at module
  // scope. Reload the module so every test starts at generation zero.
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('../persistentCache') as PersistentCacheModule;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

const PRODUCT_STORAGE_KEY = 'rqcache:v1:["products"]';

function productPair(tenant: string): readonly [string, string] {
  return [PRODUCT_STORAGE_KEY, JSON.stringify({ queryKey: ['products'], data: [{ tenant }], storedAt: Date.now() })];
}

function authEnvelope(token: string | null, generation = 1): string {
  return JSON.stringify({ v: 1, generation, token, user: null, impersonating: false });
}

describe('persistent-cache tenant session boundary', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockInteractionCallbacks.length = 0;
    mockAsyncStorage.getItem.mockResolvedValue(null);
    mockAsyncStorage.setItem.mockResolvedValue(undefined);
    mockAsyncStorage.getAllKeys.mockResolvedValue([PRODUCT_STORAGE_KEY, 'token']);
    mockAsyncStorage.multiGet.mockResolvedValue([]);
    mockAsyncStorage.multiRemove.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('drops an old-generation write whose scheduled callback runs after clear', async () => {
    const { attachPersistence, clearPersistentCache } = loadPersistentCache();
    const queryClient = new QueryClient();
    const detach = attachPersistence(queryClient);

    queryClient.setQueryData(['products'], [{ tenant: 'A' }]);

    // Invalidate A while its debounce is still pending. This increment happens
    // synchronously, before clearPersistentCache returns its promise.
    const clearPromise = clearPersistentCache();
    jest.advanceTimersByTime(350);
    expect(mockInteractionCallbacks).toHaveLength(1);

    // Model InteractionManager releasing the old callback only after clear.
    mockInteractionCallbacks.shift()?.();
    await clearPromise;
    await flushMicrotasks();

    expect(mockAsyncStorage.setItem).not.toHaveBeenCalled();
    expect(mockAsyncStorage.multiRemove).toHaveBeenCalledWith([PRODUCT_STORAGE_KEY]);

    detach();
    queryClient.clear();
  });

  it('waits for an in-flight A write, clears it, then starts the queued B write', async () => {
    const { attachPersistence, clearPersistentCache } = loadPersistentCache();
    const queryClient = new QueryClient();
    const detach = attachPersistence(queryClient);
    const writeA = deferred<void>();
    const order: string[] = [];

    mockAsyncStorage.setItem.mockImplementation(async (_key, raw) => {
      const tenant = (JSON.parse(raw) as { data: Array<{ tenant: string }> }).data[0].tenant;
      order.push(`set:${tenant}:start`);
      if (tenant === 'A') await writeA.promise;
      order.push(`set:${tenant}:end`);
    });
    mockAsyncStorage.getAllKeys.mockImplementation(async () => {
      order.push('clear:get-keys');
      return [PRODUCT_STORAGE_KEY, 'token'];
    });
    mockAsyncStorage.multiRemove.mockImplementation(async () => {
      order.push('clear:remove');
    });

    queryClient.setQueryData(['products'], [{ tenant: 'A' }]);
    jest.advanceTimersByTime(350);
    mockInteractionCallbacks.shift()?.();
    await flushMicrotasks();
    expect(order).toEqual(['set:A:start']);

    let clearSettled = false;
    const clearPromise = clearPersistentCache().then(() => {
      clearSettled = true;
    });

    // A post-clear event belongs to the new generation. Its disk write must
    // queue behind both the hung A bridge call and the clear.
    queryClient.setQueryData(['products'], [{ tenant: 'B' }]);
    jest.advanceTimersByTime(350);
    mockInteractionCallbacks.shift()?.();
    await flushMicrotasks();

    expect(clearSettled).toBe(false);
    expect(mockAsyncStorage.getAllKeys).not.toHaveBeenCalled();
    expect(order).toEqual(['set:A:start']);

    writeA.resolve(undefined);
    await clearPromise;
    await flushMicrotasks();

    expect(order).toEqual(['set:A:start', 'set:A:end', 'clear:get-keys', 'clear:remove', 'set:B:start', 'set:B:end']);

    detach();
    queryClient.clear();
  });

  it('does not apply delayed full-hydration pairs after a clear boundary', async () => {
    const { clearPersistentCache, hydrateCache } = loadPersistentCache();
    const queryClient = new QueryClient();
    const setQueryData = jest.spyOn(queryClient, 'setQueryData');
    const pairsA = deferred<readonly (readonly [string, string | null])[]>();

    mockAsyncStorage.getItem.mockImplementation(async (key) =>
      key === AUTH_SESSION_ENVELOPE_KEY ? authEnvelope('token-A') : 'token-A',
    );
    mockAsyncStorage.getAllKeys.mockResolvedValue([PRODUCT_STORAGE_KEY]);
    mockAsyncStorage.multiGet.mockReturnValueOnce(pairsA.promise);

    const hydrationA = hydrateCache(queryClient);
    await flushMicrotasks();
    expect(mockAsyncStorage.multiGet).toHaveBeenCalledWith([PRODUCT_STORAGE_KEY]);

    // Login/logout owns the in-memory clear; the utility's synchronous
    // generation increment must make the still-pending A hydration stale.
    const clear = clearPersistentCache();
    queryClient.clear();
    await clear;

    pairsA.resolve([productPair('A')]);
    await hydrationA;

    expect(setQueryData).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(['products'])).toBeUndefined();
  });

  it('does not let priority hydration resume after its watchdog and a clear', async () => {
    const { clearPersistentCache, hydratePriorityCache } = loadPersistentCache();
    const queryClient = new QueryClient();
    const setQueryData = jest.spyOn(queryClient, 'setQueryData');
    const pairsA = deferred<readonly (readonly [string, string | null])[]>();

    mockAsyncStorage.getItem.mockImplementation(async (key) =>
      key === AUTH_SESSION_ENVELOPE_KEY ? authEnvelope('token-A') : 'token-A',
    );
    mockAsyncStorage.getAllKeys.mockResolvedValue([PRODUCT_STORAGE_KEY]);
    mockAsyncStorage.multiGet.mockReturnValueOnce(pairsA.promise);

    const priorityHydrationA = hydratePriorityCache(queryClient);
    await flushMicrotasks();
    expect(mockAsyncStorage.multiGet).toHaveBeenCalledWith([PRODUCT_STORAGE_KEY]);

    // The public promise times out at 80 ms, but its private work remains
    // alive. Cross the boundary only after proving that timeout has fired.
    jest.advanceTimersByTime(80);
    await priorityHydrationA;
    const clear = clearPersistentCache();
    queryClient.clear();
    await clear;

    pairsA.resolve([productPair('A')]);
    await flushMicrotasks();

    expect(setQueryData).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(['products'])).toBeUndefined();
  });

  it('lets an authoritative logout tombstone beat a stale legacy token', async () => {
    const { hydrateCache } = loadPersistentCache();
    const queryClient = new QueryClient();

    mockAsyncStorage.getItem.mockImplementation(async (key) => {
      if (key === AUTH_SESSION_ENVELOPE_KEY) return authEnvelope(null, 7);
      if (key === LEGACY_TOKEN_KEY) return 'stale-token-A';
      return null;
    });
    mockAsyncStorage.getAllKeys.mockResolvedValue([PRODUCT_STORAGE_KEY, AUTH_SESSION_ENVELOPE_KEY, LEGACY_TOKEN_KEY]);

    await hydrateCache(queryClient);

    expect(mockAsyncStorage.multiGet).not.toHaveBeenCalled();
    expect(mockAsyncStorage.multiRemove).toHaveBeenCalledWith([PRODUCT_STORAGE_KEY]);
    expect(queryClient.getQueryData(['products'])).toBeUndefined();
  });

  it('hydrates the envelope owner even while its legacy token mirror is stale', async () => {
    const { hydrateCache } = loadPersistentCache();
    const queryClient = new QueryClient();

    mockAsyncStorage.getItem.mockImplementation(async (key) => {
      if (key === AUTH_SESSION_ENVELOPE_KEY) return authEnvelope('token-B', 8);
      if (key === LEGACY_TOKEN_KEY) return 'stale-token-A';
      return null;
    });
    mockAsyncStorage.getAllKeys.mockResolvedValue([PRODUCT_STORAGE_KEY]);
    mockAsyncStorage.multiGet.mockResolvedValue([productPair('B')]);

    await hydrateCache(queryClient);

    expect(queryClient.getQueryData(['products'])).toEqual([{ tenant: 'B' }]);
  });

  it('same-token envelope rewrite (bootstrap /me re-commit) mid-hydration does NOT abort hydration', async () => {
    const { hydrateCache } = loadPersistentCache();
    const queryClient = new QueryClient();
    const pairsA = deferred<readonly (readonly [string, string | null])[]>();

    // authSessionStorage.write() bumps the envelope generation on EVERY
    // commit, including the bootstrap /auth/me revalidation of the same
    // token+user. That must not look like a session change to hydration.
    let envelopeGeneration = 1;
    mockAsyncStorage.getItem.mockImplementation(async (key) => {
      if (key === AUTH_SESSION_ENVELOPE_KEY) return authEnvelope('token-A', envelopeGeneration);
      if (key === LEGACY_TOKEN_KEY) return 'token-A';
      return null;
    });
    mockAsyncStorage.getAllKeys.mockResolvedValue([PRODUCT_STORAGE_KEY]);
    mockAsyncStorage.multiGet.mockReturnValueOnce(pairsA.promise);

    const hydration = hydrateCache(queryClient);
    await flushMicrotasks();

    // /me succeeded while multiGet was still reading the disk.
    envelopeGeneration = 2;
    pairsA.resolve([productPair('A')]);
    await hydration;

    expect(queryClient.getQueryData(['products'])).toEqual([{ tenant: 'A' }]);
  });

  it('transient auth-key read failure skips hydration WITHOUT flushing the persisted cache', async () => {
    const { hydrateCache } = loadPersistentCache();
    const queryClient = new QueryClient();

    // Native bridge hiccup: both auth reads reject while the cache keys are
    // perfectly readable. This must not be treated as a logged-out state.
    mockAsyncStorage.getItem.mockImplementation(async (key) => {
      if (key === AUTH_SESSION_ENVELOPE_KEY || key === LEGACY_TOKEN_KEY) {
        throw new Error('native bridge hiccup');
      }
      return null;
    });
    mockAsyncStorage.getAllKeys.mockResolvedValue([PRODUCT_STORAGE_KEY]);

    await hydrateCache(queryClient);

    expect(mockAsyncStorage.multiRemove).not.toHaveBeenCalled();
    expect(mockAsyncStorage.multiGet).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(['products'])).toBeUndefined();
  });

  it('a failed legacy-mirror read does not block hydration when the envelope is valid', async () => {
    const { hydrateCache } = loadPersistentCache();
    const queryClient = new QueryClient();

    mockAsyncStorage.getItem.mockImplementation(async (key) => {
      if (key === AUTH_SESSION_ENVELOPE_KEY) return authEnvelope('token-A');
      if (key === LEGACY_TOKEN_KEY) throw new Error('native bridge hiccup');
      return null;
    });
    mockAsyncStorage.getAllKeys.mockResolvedValue([PRODUCT_STORAGE_KEY]);
    mockAsyncStorage.multiGet.mockResolvedValue([productPair('A')]);

    await hydrateCache(queryClient);

    expect(queryClient.getQueryData(['products'])).toEqual([{ tenant: 'A' }]);
  });

  it('rejects a failed clear and blocks writes until a later clear succeeds', async () => {
    const { attachPersistence, clearPersistentCache } = loadPersistentCache();
    const queryClient = new QueryClient();
    const detach = attachPersistence(queryClient);

    mockAsyncStorage.multiRemove.mockRejectedValueOnce(new Error('clear failed')).mockResolvedValue(undefined);

    await expect(clearPersistentCache()).rejects.toThrow('clear failed');

    queryClient.setQueryData(['products'], [{ tenant: 'B' }]);
    jest.advanceTimersByTime(350);
    mockInteractionCallbacks.shift()?.();
    await flushMicrotasks();
    expect(mockAsyncStorage.setItem).not.toHaveBeenCalled();

    // A fully successful later boundary admits only its newer generation.
    await clearPersistentCache();
    queryClient.setQueryData(['products'], [{ tenant: 'C' }]);
    jest.advanceTimersByTime(350);
    mockInteractionCallbacks.shift()?.();
    await flushMicrotasks();

    expect(mockAsyncStorage.setItem).toHaveBeenCalledTimes(1);
    expect(mockAsyncStorage.setItem.mock.calls[0][1]).toContain('"tenant":"C"');

    detach();
    queryClient.clear();
  });
});

// ── Волна C «Связь 2.0» — variant-cap prune на новых ключах (2026-07-21) ────
// `hydrateCache` обязан ограничивать id-keyed семейства (product,
// purchase-order, installments, …) N самыми свежими вариантами на диске,
// иначе AsyncStorage растёт бесконечно и замедляет каждый холодный старт.
// Прунится ТОЛЬКО диск — уже гидрированные in-memory копии не трогаются.
describe('persistent-cache variant-cap prune', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockInteractionCallbacks.length = 0;
    mockAsyncStorage.getItem.mockImplementation(async (key) =>
      key === AUTH_SESSION_ENVELOPE_KEY ? authEnvelope('token-A') : 'token-A',
    );
    mockAsyncStorage.setItem.mockResolvedValue(undefined);
    mockAsyncStorage.multiRemove.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function productDetailPair(id: string, storedAt: number): readonly [string, string] {
    const skey = `rqcache:v1:["product","${id}"]`;
    return [skey, JSON.stringify({ queryKey: ['product', id], data: { id, name: `Товар ${id}` }, storedAt })];
  }

  it("keeps the 10 most-recent ['product', id] slots on disk and GCs the rest", async () => {
    const { hydrateCache } = loadPersistentCache();
    const queryClient = new QueryClient();

    // 12 деталек товара; p0 и p1 — самые старые (cap для 'product' = 10).
    const base = Date.now() - 60_000;
    const pairs = Array.from({ length: 12 }, (_, i) => productDetailPair(`p${i}`, base + i * 1_000));
    mockAsyncStorage.getAllKeys.mockResolvedValue(pairs.map(([skey]) => skey));
    mockAsyncStorage.multiGet.mockResolvedValue(pairs);

    const hydration = hydrateCache(queryClient);
    // 12 пар → чанки по 5 → два setTimeout(0)-yield'а между чанками.
    await jest.advanceTimersByTimeAsync(10);
    await jest.advanceTimersByTimeAsync(10);
    await hydration;

    // Все 12 гидрированы в память — prune касается только диска.
    expect(queryClient.getQueryData(['product', 'p0'])).toEqual({ id: 'p0', name: 'Товар p0' });
    expect(queryClient.getQueryData(['product', 'p11'])).toEqual({ id: 'p11', name: 'Товар p11' });

    // С диска сняты ровно 2 самых старых варианта сверх cap=10.
    expect(mockAsyncStorage.multiRemove).toHaveBeenCalledTimes(1);
    const removed = mockAsyncStorage.multiRemove.mock.calls[0][0];
    expect(removed).toHaveLength(2);
    expect(removed).toEqual(expect.arrayContaining(['rqcache:v1:["product","p0"]', 'rqcache:v1:["product","p1"]']));

    queryClient.clear();
  });
});
