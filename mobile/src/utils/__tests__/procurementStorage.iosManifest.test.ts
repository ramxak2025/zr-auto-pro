import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { IosAsyncStorageModel } from './fixtures/ios-async-storage';
import { createDurableProcurement } from '../../../../shared/utils/durableProcurement';
import { storageWriteFailureKind } from '../../../../shared/utils/storageFailure';

let mockSdk: IosAsyncStorageModel;
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: (key: string) => mockSdk.getItem(key),
    getAllKeys: () => mockSdk.getAllKeys(),
    setItem: (key: string, value: string) => mockSdk.setItem(key, value),
    multiSet: (pairs: readonly (readonly [string, string])[]) => mockSdk.multiSet(pairs),
    removeItem: (key: string) => mockSdk.removeItem(key),
  },
}));
const { procurementStorage } = jest.requireActual('../procurementStorage') as typeof import('../procurementStorage');

const owner = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  pointId: null,
};
const target = { operation: 'po-receive' as const, sourceId: '33333333-3333-4333-8333-333333333333' };
const requestId = '44444444-4444-4444-8444-444444444444';
const key = `autexa:procurement:v1:${owner.tenantId}/${owner.userId}/none/po-receive/${target.sourceId}`;
const payload = {
  paymentMode: 'debt',
  receivedAt: '2026-10-13',
  items: Array.from({ length: 16 }, (_, index) => ({
    itemId: `55555555-5555-4555-8555-${String(index + 1).padStart(12, '0')}`,
    receivedQuantity: 2,
    purchasePrice: 900,
  })),
};
const confirmed = { status: 200, data: { id: target.sourceId, status: 'received', items: [] } };
let directory: string;
beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), 'autexa-ios-manifest-'));
  mockSdk = new IosAsyncStorageModel(directory);
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

test('SDK model reproduces RAM-only manifest entry and fixes visibility only after an inline manifest write', async () => {
  const value = 'x'.repeat(2048);
  mockSdk.manifestFailures = 1;
  await expect(mockSdk.setItem('large', value)).rejects.toThrow('Failed to write manifest file.');
  expect(await mockSdk.getItem('large')).toBe(value);
  await mockSdk.setItem('large', value);
  expect(mockSdk.manifestAttempts).toBe(1);
  expect(mockSdk.diskValue('large')).toBeNull();
  await mockSdk.setItem('inline', '1');
  expect(mockSdk.manifestAttempts).toBe(2);
  mockSdk.restart();
  expect(await mockSdk.getItem('large')).toBe(value);
});

test('failed first manifest + explicit resume: HTTP requires a restart-readable exact financial intent', async () => {
  const createId = jest.fn(() => requestId);
  const store = createDurableProcurement(procurementStorage, createId);
  mockSdk.manifestFailures = 1;
  const sent: string[] = [];
  const ledger = new Set<string>();
  const send = jest.fn(async (_url: string, body: string) => {
    sent.push(body);
    // Independent disk-manifest read at the network boundary, not getItem's RAM cache.
    const persisted = mockSdk.diskValue(key);
    expect(persisted).not.toBeNull();
    expect(JSON.parse(persisted!)).toMatchObject({ requestId, body, submitted: true });
    ledger.add(JSON.parse(body).requestId);
    if (sent.length === 1) throw new Error('lost response after commit');
    return confirmed;
  });
  await expect(store.execute({ owner, target, payload, isCurrent: () => true, send })).rejects.toMatchObject({
    code: 'STORAGE_UNAVAILABLE',
  });
  expect(send).not.toHaveBeenCalled();
  const [prepared] = await store.list(owner, () => true);
  expect(prepared.body.length).toBeGreaterThan(1024);
  expect(mockSdk.diskValue(key)).toBeNull();
  await expect(store.execute({ owner, target, isCurrent: () => true, send })).rejects.toThrow(
    'lost response after commit',
  );
  mockSdk.restart();
  const restarted = createDurableProcurement(procurementStorage, createId);
  expect((await restarted.list(owner, () => true))[0].body).toBe(prepared.body);
  await expect(restarted.execute({ owner, target, isCurrent: () => true, send })).resolves.toEqual(confirmed);
  expect(createId).toHaveBeenCalledTimes(1);
  expect(sent).toEqual([prepared.body, prepared.body]);
  expect(ledger.size).toBe(1);
});

test('repeated manifest failures block every POST even when SDK RAM getItem matches after large-file writes', async () => {
  mockSdk.manifestFailures = Infinity;
  const store = createDurableProcurement(procurementStorage, () => requestId);
  const send = jest.fn(async () => confirmed);
  await expect(store.execute({ owner, target, payload, isCurrent: () => true, send })).rejects.toMatchObject({
    code: 'STORAGE_UNAVAILABLE',
  });
  const before = (await store.list(owner, () => true))[0];
  await expect(store.execute({ owner, target, isCurrent: () => true, send })).rejects.toMatchObject({
    diagnostic: { reason: 'NATIVE_WRITE_FAILURE' },
  });
  expect(send).not.toHaveBeenCalled();
  expect((await store.list(owner, () => true))[0].body).toBe(before.body);
  expect(mockSdk.diskValue(key)).toBeNull();
  mockSdk.manifestFailures = 0;
  await store.execute({ owner, target, isCurrent: () => true, send });
  expect(send).toHaveBeenCalledTimes(1);
});

test('missing-file cache cleanup cannot accidentally stand in for a successful financial manifest flush', async () => {
  const cacheKey = 'rqcache:v1:["products"]';
  await mockSdk.setItem(cacheKey, JSON.stringify({ queryKey: ['products'], data: ['x'.repeat(2048)], storedAt: 0 }));
  mockSdk.removeBackingFile(cacheKey);
  mockSdk.manifestFailures = 1;
  const store = createDurableProcurement(procurementStorage, () => requestId);
  const send = jest.fn(async (_url: string, body: string) => {
    expect(JSON.parse(mockSdk.diskValue(key)!)).toMatchObject({ body, requestId, submitted: true });
    throw new Error('lost after durable dispatch');
  });
  await expect(store.execute({ owner, target, payload, isCurrent: () => true, send })).rejects.toThrow(
    'lost after durable dispatch',
  );
  mockSdk.restart();
  expect((await store.list(owner, () => true))[0].requestId).toBe(requestId);
  expect(mockSdk.removed).toEqual([cacheKey]);
});

test('mixed SDK multiSet failures never turn unknown I/O into cache-eviction permission', async () => {
  const cacheKey = 'rqcache:v1:["products"]';
  const cache = JSON.stringify({ queryKey: ['products'], data: ['fixture'], storedAt: 0 });
  await mockSdk.setItem(cacheKey, cache);
  mockSdk.fileFailures = 1;
  mockSdk.manifestFailures = 1;
  mockSdk.manifestError = 'Unknown native I/O: PRIVATE_DETAILS';
  const store = createDurableProcurement(procurementStorage, () => requestId);
  const send = jest.fn(async () => confirmed);
  const failure = await store
    .execute({ owner, target, payload, isCurrent: () => true, send })
    .catch((error: unknown) => error);
  expect(failure).toMatchObject({ code: 'STORAGE_UNAVAILABLE', diagnostic: { reason: 'UNAVAILABLE' } });
  expect(String(failure)).not.toContain('PRIVATE_DETAILS');
  expect(mockSdk.removed).toEqual([]);
  expect(mockSdk.diskValue(cacheKey)).toBe(cache);
  expect(send).not.toHaveBeenCalled();
});

test('SDK batch error classification uses the most conservative recovery bound', () => {
  const capacity = new Error('database or disk is full');
  const native = new Error('Failed to write manifest file.');
  const unknown = new Error('unknown I/O');
  expect(storageWriteFailureKind([capacity, capacity])).toBe('capacity');
  expect(storageWriteFailureKind([native])).toBe('native_write');
  expect(storageWriteFailureKind([capacity, native])).toBe('native_write');
  expect(storageWriteFailureKind([native, unknown])).toBe('other');
  expect(storageWriteFailureKind([capacity, unknown])).toBe('other');
  expect(storageWriteFailureKind([])).toBe('other');
});
