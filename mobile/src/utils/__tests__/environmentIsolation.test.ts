import {
  createEnvironmentStorage,
  createEnvironmentKeyValueStorage,
  type EnvironmentStorage,
} from '../environmentStorageAdapter';
import { createAccountRegistry, activeAccount, ACCOUNT_REGISTRY_KEY } from '../../contexts/accountRegistry';

const PREFIX = 'autexa_inventory_internal_v1.';
function disk() {
  const values = new Map<string, string>();
  const storage: EnvironmentStorage = {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
      values.set(key, value);
    },
    removeItem: async (key) => {
      values.delete(key);
    },
    getAllKeys: async () => [...values.keys()],
    multiGet: async (keys) => keys.map((key) => [key, values.get(key) ?? null]),
    multiSet: async (pairs) => {
      pairs.forEach(([key, value]) => values.set(key, value));
    },
    multiRemove: async (keys) => {
      keys.forEach((key) => values.delete(key));
    },
  };
  return { values, storage };
}
const user = {
  id: 'same-user',
  tenantId: 'same-tenant',
  currentPointId: 'same-point',
  fullName: 'Fixture',
  role: 'owner',
};
const session = (suffix: string) => ({
  token: 'header.' + btoa(JSON.stringify({ sub: user.id, tenantId: user.tenantId })) + '.' + suffix,
  user,
  impersonating: false,
});

it('ordinary storage is exactly the existing native object; internal single/batch keys and enumeration are isolated', async () => {
  const f = disk();
  expect(createEnvironmentStorage(f.storage, '')).toBe(f.storage);
  const stage = createEnvironmentStorage(f.storage, PREFIX);
  await f.storage.multiSet([
    ['token', 'production'],
    ['rqcache:v2:same', 'production-cache'],
    ['offline_checks_queue_v1', 'production-queue'],
  ]);
  await stage.multiSet([
    ['token', 'stage'],
    ['rqcache:v2:same', 'stage-cache'],
  ]);
  expect(await stage.getAllKeys()).toEqual(['token', 'rqcache:v2:same']);
  expect(await stage.multiGet(['token', 'offline_checks_queue_v1'])).toEqual([
    ['token', 'stage'],
    ['offline_checks_queue_v1', null],
  ]);
  await stage.multiRemove(await stage.getAllKeys());
  expect(Object.fromEntries(f.values)).toEqual({
    token: 'production',
    'rqcache:v2:same': 'production-cache',
    offline_checks_queue_v1: 'production-queue',
  });
});

it('same-ID account registries, legacy credentials and logout stay separate; returning to public restores its exact bytes', async () => {
  const secure = disk(),
    legacy = disk();
  const make = (prefix: string) =>
    createAccountRegistry<typeof user>(
      createEnvironmentKeyValueStorage(secure.storage, prefix),
      createEnvironmentStorage(legacy.storage, prefix),
      (value): value is typeof user => !!value && typeof value === 'object' && (value as typeof user).id === user.id,
    );
  const production = make('');
  await production.install(session('production'), 0);
  const prodBytes = secure.values.get(ACCOUNT_REGISTRY_KEY);
  await legacy.storage.setItem('token', session('legacy-production').token);
  await legacy.storage.setItem('user', JSON.stringify(user));
  const stage = make(PREFIX);
  expect((await stage.read()).accounts).toEqual([]);
  await stage.install(session('stage'), 0);
  expect(activeAccount(await stage.read())?.session?.token).toBe(session('stage').token);
  await stage.deactivate(stage.snapshot()!.activeId, () => true);
  expect(activeAccount(await stage.read())).toBeNull();
  expect(secure.values.get(ACCOUNT_REGISTRY_KEY)).toBe(prodBytes);
  expect(await legacy.storage.getItem('token')).toBe(session('legacy-production').token);
  expect(activeAccount(await make('').read())?.session?.token).toBe(session('production').token);
});

it('a delayed old-process write remains in its captured environment and cannot replace the other queue/cache', async () => {
  const f = disk();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const slow = {
    ...f.storage,
    setItem: async (key: string, value: string) => {
      await gate;
      await f.storage.setItem(key, value);
    },
  };
  const oldStage = createEnvironmentStorage(slow, PREFIX);
  const pending = oldStage.setItem('autexa:procurement:v1:same', 'stage-intent');
  const publicProcess = createEnvironmentStorage(f.storage, '');
  await publicProcess.setItem('autexa:procurement:v1:same', 'production-intent');
  release();
  await pending;
  expect(await publicProcess.getItem('autexa:procurement:v1:same')).toBe('production-intent');
  expect(await oldStage.getItem('autexa:procurement:v1:same')).toBe('stage-intent');
});
