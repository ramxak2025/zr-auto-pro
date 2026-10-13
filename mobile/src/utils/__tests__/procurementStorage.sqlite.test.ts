import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { QueryClient } from '@tanstack/react-query';

let mockDatabase: string;
const mockFailures: string[] = [];
const mockRemoved: string[] = [];
function mockSqlite(operation: string, ...args: unknown[]) {
  const request = mockDatabase + '.request.json';
  writeFileSync(request, JSON.stringify({ operation, args }));
  const child = spawnSync(
    'python3',
    [path.join(__dirname, 'fixtures/async-storage-sqlite.py'), mockDatabase, request],
    {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  if (child.status !== 0) throw new Error('Disposable SQLite test bridge failed');
  const response = JSON.parse(child.stdout) as { result?: unknown; error?: { code: string; message: string } };
  if (response.error) {
    mockFailures.push(response.error.code);
    // SDK convertError drops the native code and retains only message + key.
    throw new Error(response.error.message);
  }
  if (operation === 'removeItem') mockRemoved.push(String(args[0]));
  if (operation === 'multiRemove') mockRemoved.push(...(args[0] as string[]));
  return response.result;
}
const mockStorage = {
  getItem: jest.fn(async (key: string) => mockSqlite('getItem', key) as string | null),
  setItem: jest.fn(async (key: string, value: string) => {
    mockSqlite('setItem', key, value);
  }),
  removeItem: jest.fn(async (key: string) => {
    mockSqlite('removeItem', key);
  }),
  getAllKeys: jest.fn(async () => mockSqlite('getAllKeys') as string[]),
  multiGet: jest.fn(async (keys: string[]) => mockSqlite('multiGet', keys)),
  multiRemove: jest.fn(async (keys: string[]) => {
    mockSqlite('multiRemove', keys);
  }),
};
jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: mockStorage }));
jest.mock('react-native', () => ({ InteractionManager: { runAfterInteractions: (run: () => void) => run() } }));
jest.mock('../../contexts/authAccountStorage', () => ({ authAccounts: { read: async () => null } }));

const owner = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  pointId: '33333333-3333-4333-8333-333333333333',
};
const target = { operation: 'po-receive' as const, sourceId: '44444444-4444-4444-8444-444444444444' };
const payload = {
  paymentMode: 'debt',
  receivedAt: '2026-10-13',
  items: [
    { itemId: '55555555-5555-4555-8555-555555555555', receivedQuantity: 2, purchasePrice: 900 },
    { itemId: '66666666-6666-4666-8666-666666666666', receivedQuantity: 2, purchasePrice: 900 },
  ],
};
const confirmed = { status: 200, data: { id: target.sourceId, status: 'received', items: [] } };
const flush = async () => {
  for (let step = 0; step < 40; step++) await Promise.resolve();
};

test('actual native procurement boundary recovers a readable 6 MiB SQLite store filled by persistent query cache', async () => {
  jest.useFakeTimers();
  const directory = mkdtempSync(path.join(tmpdir(), 'autexa-procurement-sqlite-'));
  mockDatabase = path.join(directory, 'RKStorage');
  mockFailures.length = 0;
  mockRemoved.length = 0;
  const persistence = jest.requireActual('../persistentCache') as typeof import('../persistentCache');
  const { durableProcurement } = jest.requireActual('../procurementStorage') as typeof import('../procurementStorage');
  const qc = new QueryClient();
  persistence.setPersistentCacheSession(owner);
  const detach = persistence.attachPersistence(qc);
  const existing = {
    version: 1,
    owner,
    target: { operation: 'delivery-return', sourceId: '77777777-7777-4777-8777-777777777777' },
    requestId: '88888888-8888-4888-8888-888888888888',
    body: JSON.stringify({
      requestId: '88888888-8888-4888-8888-888888888888',
      items: [{ productId: 'fixture', quantity: 1 }],
    }),
    createdAt: '2026-10-12T00:00:00.000Z',
    submitted: true,
    dispatches: 1,
  };
  const existingKey = `autexa:procurement:v1:${owner.tenantId}/${owner.userId}/${owner.pointId}/delivery-return/${existing.target.sourceId}`;
  const retained = {
    'autexa:accounts:v1': 'fixture account registry',
    auth_token: 'fixture token',
    'offline_check_queue_v2:other-owner': 'fixture unrelated financial queue',
    'autexa:procurement:v1:other-owner/uncertain': 'fixture unrelated uncertain intent',
    [existingKey]: JSON.stringify(existing),
  };
  try {
    for (const [key, value] of Object.entries(retained)) await mockStorage.setItem(key, value);
    let variant = 0;
    // Native SQLite, not a mocked map/set exception, decides when the store is
    // full. All filling writes travel through production attachPersistence.
    for (const size of [256 * 1024, 32 * 1024, 4 * 1024, 512]) {
      for (let attempt = 0; attempt < 40; attempt++) {
        const queryKey = ['products', { page: ++variant }];
        const key = persistence.cachePrefixFor(owner) + JSON.stringify(queryKey);
        qc.setQueryData(queryKey, [{ id: String(variant), name: 'Fixture product', description: 'x'.repeat(size) }]);
        jest.advanceTimersByTime(350);
        await flush();
        if ((await mockStorage.getItem(key)) === null) break;
      }
    }
    expect(mockFailures).toContain('SQLITE_FULL');
    expect(mockSqlite('stats')).toMatchObject({ max_page_count: 1536, page_size: 4096 });
    const before = new Set(await mockStorage.getAllKeys());
    const bodies: string[] = [];
    const ledger = new Set<string>();
    const send = jest.fn(async (_url: string, body: string) => {
      bodies.push(body);
      const dto = JSON.parse(body);
      ledger.add(dto.requestId);
      if (bodies.length === 1) throw new Error('Controlled response lost after commit');
      return confirmed;
    });
    await expect(durableProcurement.execute({ owner, target, payload, isCurrent: () => true, send })).rejects.toThrow(
      'Controlled response lost after commit',
    );
    expect(send).toHaveBeenCalledTimes(1);
    const pending = await durableProcurement.list(owner, () => true);
    expect(pending).toHaveLength(2);
    const received = pending.find((record) => record.target.sourceId === target.sourceId)!;
    expect(JSON.parse(received.body)).toEqual({ ...payload, requestId: received.requestId });
    expect(received.owner).toEqual(owner);
    expect(mockRemoved.length).toBeGreaterThan(0);
    expect(mockRemoved.every((key) => key.startsWith('rqcache:'))).toBe(true);
    expect(mockRemoved.length).toBeLessThan(before.size / 2);
    for (const [key, value] of Object.entries(retained)) expect(await mockStorage.getItem(key)).toBe(value);
    await expect(durableProcurement.execute({ owner, target, isCurrent: () => true, send })).resolves.toEqual(
      confirmed,
    );
    expect(bodies[1]).toBe(bodies[0]);
    expect(ledger.size).toBe(1);
    expect(await durableProcurement.list(owner, () => true)).toEqual([existing]);
  } finally {
    detach();
    qc.clear();
    persistence.setPersistentCacheSession(null);
    jest.useRealTimers();
    rmSync(directory, { recursive: true, force: true });
  }
}, 30000);
