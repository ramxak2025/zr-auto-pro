import { QueryClient } from '@tanstack/react-query';
const A = { userId: 'a', tenantId: 'ta', pointId: 'pa' };
const B = { userId: 'b', tenantId: 'tb', pointId: 'pb' };
const prefix = (owner: typeof A) =>
  'rqcache:v2:' + encodeURIComponent(JSON.stringify([owner.tenantId, owner.userId, owner.pointId])) + ':';
const AKEY = prefix(A) + '["products"]';
const BKEY = prefix(B) + '["products"]';
const mockInteractions: Array<() => void> = [];
const mockStorage = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  getAllKeys: jest.fn(),
  multiGet: jest.fn(),
  multiRemove: jest.fn(),
};
const registry = (owner: typeof A, generation = 1, revision = 1) => ({
  v: 1,
  revision,
  generation,
  activeId: owner.userId,
  accounts: [
    {
      id: owner.userId,
      session: {
        token: 'token-' + owner.userId,
        user: { id: owner.userId, tenantId: owner.tenantId, currentPointId: owner.pointId },
        impersonating: false,
      },
    },
  ],
});
let mockRegistry: ReturnType<typeof registry> | null = null;
const mockRead = jest.fn(async () => mockRegistry);
jest.mock('../../contexts/authAccountStorage', () => ({ authAccounts: { read: () => mockRead() } }));
jest.mock('react-native', () => ({
  InteractionManager: {
    runAfterInteractions: (cb: () => void) => {
      mockInteractions.push(cb);
      return { cancel: jest.fn() };
    },
  },
}));
jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: mockStorage }));
const pair = (key: string, owner: string, queryKey: unknown[] = ['products'], storedAt = Date.now()) =>
  [key, JSON.stringify({ queryKey, data: [{ owner }], storedAt })] as const;
const deferred = <T>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}
function load() {
  jest.resetModules();
  const mod = jest.requireActual('../persistentCache') as typeof import('../persistentCache');
  mod.setPersistentCacheSession(A);
  return mod;
}
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockInteractions.length = 0;
  mockRegistry = registry(A);
  mockRead.mockImplementation(async () => mockRegistry);
  mockStorage.setItem.mockResolvedValue(undefined);
  mockStorage.getAllKeys.mockResolvedValue([AKEY, BKEY, 'rqcache:v1:["products"]']);
  mockStorage.multiGet.mockResolvedValue([]);
  mockStorage.multiRemove.mockResolvedValue(undefined);
});
afterEach(() => jest.useRealTimers());
it('drops scheduled A write after switch while retaining A namespace and writing B only to B', async () => {
  const m = load(),
    qc = new QueryClient(),
    detach = m.attachPersistence(qc);
  qc.setQueryData(['products'], [{ owner: 'a' }]);
  jest.advanceTimersByTime(350);
  m.setPersistentCacheSession(B);
  mockRegistry = registry(B, 2);
  qc.clear();
  mockInteractions.shift()?.();
  qc.setQueryData(['products'], [{ owner: 'b' }]);
  jest.advanceTimersByTime(350);
  mockInteractions.shift()?.();
  await flush();
  expect(mockStorage.setItem).toHaveBeenCalledTimes(1);
  expect(mockStorage.setItem.mock.calls[0][0]).toBe(BKEY);
  expect(mockStorage.multiRemove).not.toHaveBeenCalled();
  detach();
  qc.clear();
});
it('serializes an already executing A write, explicit A removal and B write without clearing B', async () => {
  const m = load(),
    qc = new QueryClient(),
    detach = m.attachPersistence(qc),
    gate = deferred<void>();
  const order: string[] = [];
  mockStorage.setItem.mockImplementation(async (key: string) => {
    order.push(key === AKEY ? 'A:start' : 'B:start');
    if (key === AKEY) await gate.promise;
    order.push(key === AKEY ? 'A:end' : 'B:end');
  });
  mockStorage.multiRemove.mockImplementation(async (keys: string[]) => {
    expect(keys).toEqual([AKEY]);
    order.push('removeA');
  });
  qc.setQueryData(['products'], [{ owner: 'a' }]);
  jest.advanceTimersByTime(350);
  mockInteractions.shift()?.();
  await flush();
  m.setPersistentCacheSession(B);
  const cleanup = m.clearAccountCaches([A], () => true);
  qc.clear();
  qc.setQueryData(['products'], [{ owner: 'b' }]);
  jest.advanceTimersByTime(350);
  mockInteractions.shift()?.();
  await flush();
  expect(order).toEqual(['A:start']);
  gate.resolve();
  await cleanup;
  await flush();
  expect(order).toEqual(['A:start', 'A:end', 'removeA', 'B:start', 'B:end']);
  detach();
  qc.clear();
});
it.each(['full', 'priority'])('drops delayed %s hydration after A→B→A, even identical bearer', async (kind) => {
  const m = load(),
    qc = new QueryClient(),
    gate = deferred<readonly (readonly [string, string])[]>();
  mockStorage.multiGet.mockReturnValueOnce(gate.promise);
  const work = kind === 'full' ? m.hydrateCache(qc) : m.hydratePriorityCache(qc);
  await flush();
  expect(mockStorage.multiGet).toHaveBeenCalledWith([AKEY]);
  if (kind === 'priority') {
    jest.advanceTimersByTime(80);
    await work;
  }
  m.setPersistentCacheSession(B);
  m.setPersistentCacheSession(A);
  mockRegistry = registry(A, 3);
  qc.clear();
  gate.resolve([pair(AKEY, 'a')]);
  await work;
  await flush();
  expect(qc.getQueryData(['products'])).toBeUndefined();
  qc.clear();
});
it('authoritative inactive session never hydrates unscoped/other-owner data or deletes saved caches', async () => {
  const m = load(),
    qc = new QueryClient();
  mockRegistry = null;
  mockStorage.getItem.mockResolvedValue('stale-legacy-token');
  await m.hydrateCache(qc);
  expect(mockStorage.multiGet).not.toHaveBeenCalled();
  expect(mockStorage.multiRemove).not.toHaveBeenCalled();
  expect(qc.getQueryData(['products'])).toBeUndefined();
  qc.clear();
});
it('hydrates only secure active B namespace; same-session profile revision does not abort hydration', async () => {
  const m = load(),
    qc = new QueryClient(),
    gate = deferred<readonly (readonly [string, string])[]>();
  mockRegistry = registry(B, 2);
  m.setPersistentCacheSession(B);
  mockStorage.multiGet.mockReturnValueOnce(gate.promise);
  const work = m.hydrateCache(qc);
  await flush();
  expect(mockStorage.multiGet).toHaveBeenCalledWith([BKEY]);
  mockRegistry = registry(B, 2, 99);
  gate.resolve([pair(BKEY, 'b')]);
  await work;
  expect(qc.getQueryData(['products'])).toEqual([{ owner: 'b' }]);
  qc.clear();
});
it('secure storage failure skips hydration without plaintext fallback, writes or cache destruction', async () => {
  const m = load(),
    qc = new QueryClient();
  mockRead.mockRejectedValueOnce(new Error('locked'));
  await m.hydrateCache(qc);
  expect(mockStorage.getItem).not.toHaveBeenCalled();
  expect(mockStorage.multiGet).not.toHaveBeenCalled();
  expect(mockStorage.multiRemove).not.toHaveBeenCalled();
  qc.clear();
});
it('failed current cache clear blocks writes until a successful clear, preserving other scopes', async () => {
  const m = load(),
    qc = new QueryClient(),
    detach = m.attachPersistence(qc);
  mockStorage.multiRemove.mockRejectedValueOnce(new Error('clear failed'));
  await expect(m.clearPersistentCache()).rejects.toThrow('clear failed');
  qc.setQueryData(['products'], [{ owner: 'a' }]);
  jest.advanceTimersByTime(350);
  mockInteractions.shift()?.();
  await flush();
  expect(mockStorage.setItem).not.toHaveBeenCalled();
  await m.clearPersistentCache();
  qc.setQueryData(['products'], [{ owner: 'a2' }]);
  jest.advanceTimersByTime(350);
  mockInteractions.shift()?.();
  await flush();
  expect(mockStorage.setItem).toHaveBeenCalledTimes(1);
  expect(mockStorage.multiRemove).toHaveBeenLastCalledWith([AKEY]);
  detach();
  qc.clear();
});
it('prunes only active namespace variants and retains inactive accounts', async () => {
  const m = load(),
    qc = new QueryClient();
  const base = Date.now() - 60000;
  const pairs = Array.from({ length: 12 }, (_, i) =>
    pair(prefix(A) + `["product","p${i}"]`, 'a', ['product', `p${i}`], base + i * 1000),
  );
  mockStorage.getAllKeys.mockResolvedValue([...pairs.map(([key]) => key), BKEY]);
  mockStorage.multiGet.mockResolvedValue(pairs);
  const work = m.hydrateCache(qc);
  await jest.advanceTimersByTimeAsync(20);
  await work;
  expect(mockStorage.multiRemove).toHaveBeenCalledWith(expect.arrayContaining([pairs[0][0], pairs[1][0]]));
  expect(qc.getQueryData(['product', 'p11'])).toEqual([{ owner: 'a' }]);
  qc.clear();
});

it('cannot hydrate durable B while native commit readback still leaves logical A active', async () => {
  const m = load(),
    qc = new QueryClient();
  mockRegistry = registry(B, 2);
  mockStorage.multiGet.mockResolvedValue([pair(BKEY, 'b')]);
  await m.hydrateCache(qc);
  expect(mockStorage.multiGet).not.toHaveBeenCalled();
  expect(qc.getQueryData(['products'])).toBeUndefined();
  m.setPersistentCacheSession(null);
  mockRegistry = registry(A, 1);
  await m.hydrateCache(qc);
  expect(mockStorage.multiGet).not.toHaveBeenCalled();
  qc.clear();
});
