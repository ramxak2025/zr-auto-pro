jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: {} }));
import { createOwnedStorage, OWNED_DATA_PREFIX } from '../ownedStorage';
import { captureDataSession, setDataSession, dataOwnerKey, userDataOwner } from '../dataSession';
const A = { tenantId: 'a', userId: 'a', pointId: 'p' },
  B = { tenantId: 'b', userId: 'b', pointId: 'q' };
it('delayed A write cannot overwrite B or newer A after A→B→A; new A waits for the native tail', async () => {
  const map = new Map<string, string>();
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  let entered = false;
  const native = {
    getItem: async (k: string) => map.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      if (v === 'old') {
        entered = true;
        await gate;
      }
      map.set(k, v);
    },
    removeItem: async (k: string) => {
      map.delete(k);
    },
  };
  const store = createOwnedStorage(native);
  setDataSession(A);
  const old = captureDataSession();
  const write = store.set('draft', 'old', old);
  while (!entered) await Promise.resolve();
  setDataSession(B);
  const b = captureDataSession();
  const writeB = store.set('draft', 'B', b);
  setDataSession(A);
  const current = captureDataSession();
  let readDone = false;
  const read = store.get('draft', current).then((v) => {
    readDone = true;
    return v;
  });
  const writeA = store.set('draft', 'new', current);
  expect(readDone).toBe(false);
  release();
  await Promise.all([write, writeB, writeA]);
  expect(await read).toBe('old');
  expect(map.get(`${OWNED_DATA_PREFIX}${dataOwnerKey(A)}:draft`)).toBe('new');
  expect(map.has(`${OWNED_DATA_PREFIX}${dataOwnerKey(B)}:draft`)).toBe(false);
  await store.set('draft', 'late-old', old);
  expect(map.get(`${OWNED_DATA_PREFIX}${dataOwnerKey(A)}:draft`)).toBe('new');
});
it('missing legacy point does not become a proven null point or storage owner', () => {
  expect(userDataOwner({ id: 'a', tenantId: 't' })).toBe(null);
  expect(userDataOwner({ id: 'a', tenantId: 't', currentPointId: null })).toEqual({
    userId: 'a',
    tenantId: 't',
    pointId: null,
  });
});
