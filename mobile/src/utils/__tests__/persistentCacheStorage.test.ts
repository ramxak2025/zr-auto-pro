const mockDisk = new Map<string, string>();
jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));
const mockNative = {
  getItem: jest.fn(async (key: string) => mockDisk.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    mockDisk.set(key, value);
  }),
  removeItem: jest.fn(async (key: string) => {
    mockDisk.delete(key);
  }),
  getAllKeys: jest.fn(async () => [...mockDisk.keys()]),
};
jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: mockNative }));
import { createDurableProcurement } from '../../../../shared/utils/durableProcurement';
const { procurementStorage } = jest.requireActual('../procurementStorage') as typeof import('../procurementStorage');
const { enqueueStorageMutation } = jest.requireActual(
  '../persistentCacheStorage',
) as typeof import('../persistentCacheStorage');
import { withFrozenIntentOwners } from '../../contexts/intentWriteBarrier';

const owner = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  pointId: null,
};
const target = { operation: 'delivery-create' as const, sourceId: '33333333-3333-4333-8333-333333333333' };
const requestId = '44444444-4444-4444-8444-444444444444';
const key = `autexa:procurement:v1:${owner.tenantId}/${owner.userId}/none/delivery-create/${target.sourceId}`;
const result = { status: 201, data: { id: target.sourceId } };
const oldCache = 'rqcache:["products"]';
const newerCache = 'rqcache:v1:["all-services"]';
const currentCache =
  'rqcache:v2:' + encodeURIComponent(JSON.stringify([owner.tenantId, owner.userId, null])) + ':["products"]';
const cacheValue = (storedAt: number) =>
  JSON.stringify({ queryKey: ['products'], data: [{ id: 'fixture' }], storedAt });
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
beforeEach(() => {
  mockDisk.clear();
  jest.clearAllMocks();
  mockNative.getItem.mockImplementation(async (key) => mockDisk.get(key) ?? null);
  mockNative.setItem.mockImplementation(async (key, value) => {
    mockDisk.set(key, value);
  });
  mockNative.removeItem.mockImplementation(async (key) => {
    mockDisk.delete(key);
  });
  mockDisk.set(oldCache, cacheValue(1));
  mockDisk.set(newerCache, cacheValue(2));
  mockDisk.set(currentCache, cacheValue(3));
});

test.each(['Failed to write value.', 'Failed to write manifest file.'])(
  'iOS SDK "%s": at most one old cache slot is reclaimed, uncertainty remains',
  async (message) => {
    const store = createDurableProcurement(procurementStorage, () => requestId);
    await store
      .execute({
        owner,
        target,
        payload: { fixture: true },
        isCurrent: () => true,
        send: async () => {
          throw new Error('lost');
        },
      })
      .catch(() => undefined);
    const prior = mockDisk.get(key);
    mockNative.setItem.mockClear();
    mockNative.setItem.mockRejectedValue(new Error(message));
    const send = jest.fn(async () => result);
    await expect(store.execute({ owner, target, isCurrent: () => true, send })).rejects.toMatchObject({
      code: 'STORAGE_UNAVAILABLE',
      diagnostic: { reason: 'NATIVE_WRITE_FAILURE', delivery: 'uncertain' },
    });
    expect(mockNative.setItem).toHaveBeenCalledTimes(2);
    expect(mockNative.removeItem.mock.calls).toEqual([[oldCache]]);
    expect(mockDisk.has(newerCache)).toBe(true);
    expect(mockDisk.has(currentCache)).toBe(true);
    expect(mockDisk.get(key)).toBe(prior);
    expect(send).not.toHaveBeenCalled();
  },
);

test('unknown I/O, readback mismatch and corrupt intents never clear the cache or send', async () => {
  const store = createDurableProcurement(procurementStorage, () => requestId);
  const send = jest.fn(async () => result);
  mockNative.setItem.mockRejectedValueOnce(new Error('unclassified I/O'));
  await expect(store.execute({ owner, target, payload: {}, isCurrent: () => true, send })).rejects.toMatchObject({
    diagnostic: { reason: 'UNAVAILABLE' },
  });
  mockNative.setItem.mockImplementationOnce(async () => {});
  await expect(store.execute({ owner, target, payload: {}, isCurrent: () => true, send })).rejects.toMatchObject({
    diagnostic: { reason: 'READBACK_MISMATCH', delivery: 'not_sent' },
  });
  mockDisk.set(key, 'unreadable intent');
  await expect(store.execute({ owner, target, isCurrent: () => true, send })).rejects.toMatchObject({
    diagnostic: { reason: 'CORRUPT_RECORD' },
  });
  expect(mockNative.removeItem).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
  expect(mockDisk.get(key)).toBe('unreadable intent');
});

test('confirmed capacity failure only removes recognized query-cache slots, stopping immediately after the same bytes fit', async () => {
  const protectedValues = {
    'rqcache:auth_token': 'credential fixture',
    'rqcache:v2:invalid-owner:["products"]': 'unknown data',
    auth_registry_v1: 'registry fixture',
    'autexa:procurement:v1:another-owner': 'intent fixture',
  };
  Object.entries(protectedValues).forEach(([name, value]) => mockDisk.set(name, value));
  mockNative.setItem.mockImplementation(async (name, value) => {
    if (mockDisk.has(oldCache)) throw new Error('database or disk is full (code 13 SQLITE_FULL)');
    mockDisk.set(name, value);
  });
  await procurementStorage.setItem(key, 'immutable body and requestId');
  expect(mockNative.setItem.mock.calls).toEqual([
    [key, 'immutable body and requestId'],
    [key, 'immutable body and requestId'],
  ]);
  expect(mockNative.removeItem.mock.calls).toEqual([[oldCache]]);
  for (const [name, value] of Object.entries(protectedValues)) expect(mockDisk.get(name)).toBe(value);
  expect(mockDisk.has(newerCache)).toBe(true);
});

test('owner reservation covers waiting for cache writes, eviction and retry; removal drains it before inventory', async () => {
  const hold = deferred(),
    started = deferred();
  const events: string[] = [];
  const cacheWrite = enqueueStorageMutation(async () => {
    events.push('cache-start');
    started.resolve();
    await hold.promise;
    events.push('cache-end');
  });
  await started.promise;
  mockNative.setItem.mockImplementation(async (name, value) => {
    events.push('intent-write');
    if (mockDisk.has(oldCache)) throw new Error('database or disk is full');
    mockDisk.set(name, value);
  });
  mockNative.removeItem.mockImplementation(async (name) => {
    events.push('cache-evicted');
    mockDisk.delete(name);
  });
  const writing = procurementStorage.setItem(key, 'reserved-intent');
  let inventoried = false;
  const removing = withFrozenIntentOwners([owner], async () => {
    inventoried = true;
    // A real account removal must refuse to remove an account with this intent.
    expect(await procurementStorage.getItem(key)).toBe('reserved-intent');
  });
  // withIntentWrite reserves synchronously and starts its queued work in a
  // microtask. Let it join the storage queue before scheduling the later cache write.
  await flush();
  const lateCache = enqueueStorageMutation(async () => {
    events.push('late-cache');
  });
  await flush();
  expect(inventoried).toBe(false);
  await expect(procurementStorage.setItem(key + '/late', 'late')).rejects.toMatchObject({ code: 'UNRESOLVED_INTENTS' });
  hold.resolve();
  await Promise.all([cacheWrite, writing, removing, lateCache]);
  expect(events.indexOf('cache-end')).toBeLessThan(events.indexOf('intent-write'));
  expect(events.slice(events.indexOf('intent-write'), events.lastIndexOf('intent-write') + 1)).toEqual([
    'intent-write',
    'cache-evicted',
    'intent-write',
  ]);
  expect(events.indexOf('late-cache')).toBeGreaterThan(events.lastIndexOf('intent-write'));
  expect(mockDisk.get(key)).toBe('reserved-intent');
});

test('oversized recoverable cache can be reclaimed even when Android CursorWindow cannot read that slot', async () => {
  mockNative.getItem.mockImplementation(async (name) => {
    if (name === oldCache) throw new Error('Row too big to fit into CursorWindow');
    return mockDisk.get(name) ?? null;
  });
  mockNative.setItem.mockImplementation(async (name, value) => {
    if (mockDisk.has(oldCache)) throw new Error('database or disk is full');
    mockDisk.set(name, value);
  });
  await procurementStorage.setItem(key, 'exact intent');
  expect(mockDisk.get(key)).toBe('exact intent');
  expect(mockNative.removeItem.mock.calls).toEqual([[oldCache]]);
});

test('a full store containing only readable financial intents stays untouched when no cache can free space', async () => {
  mockDisk.clear();
  const store = createDurableProcurement(procurementStorage, () => requestId);
  await store
    .execute({
      owner,
      target,
      payload: {},
      isCurrent: () => true,
      send: async () => {
        throw new Error('lost');
      },
    })
    .catch(() => undefined);
  const prior = mockDisk.get(key);
  expect(await store.list(owner, () => true)).toHaveLength(1);
  mockNative.setItem.mockRejectedValue(new Error('database or disk is full'));
  const send = jest.fn(async () => result);
  await expect(store.execute({ owner, target, isCurrent: () => true, send })).rejects.toMatchObject({
    code: 'STORAGE_UNAVAILABLE',
    diagnostic: { reason: 'CAPACITY', delivery: 'uncertain' },
  });
  expect(mockNative.removeItem).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
  expect(mockDisk.get(key)).toBe(prior);
});
