/** Executes the real provider callbacks with a deterministic hook/native
 * bridge harness and the installed axios transport, not a replacement auth
 * coordinator. Native mounting/navigation is a separate device check. */
import type { User } from '../../../../shared/types';
import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios';
const mockSlots: unknown[] = [];
let mockCursor = 0;
const mockEffects: Array<() => void> = [];
const mockCleanups: Array<() => void> = [];
const mockDeps = (a?: unknown[], b?: unknown[]) => !!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]);
function mockMemo<T>(fn: () => T, deps?: unknown[]): T {
  const i = mockCursor++;
  const old = mockSlots[i] as { deps?: unknown[]; value: T } | undefined;
  if (!old || !mockDeps(old.deps, deps)) mockSlots[i] = { deps, value: fn() };
  return (mockSlots[i] as { value: T }).value;
}
jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useState: (initial: unknown) => {
    const i = mockCursor++;
    if (!(i in mockSlots)) mockSlots[i] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    return [
      mockSlots[i],
      (next: unknown) => {
        mockSlots[i] = typeof next === 'function' ? (next as (mockValue: unknown) => unknown)(mockSlots[i]) : next;
      },
    ];
  },
  useRef: (initial: unknown) => mockMemo(() => ({ current: initial }), []),
  useMemo: mockMemo,
  useCallback: (fn: () => unknown, deps: unknown[]) => mockMemo(() => fn, deps),
  useEffect: (effect: () => void | (() => void), deps?: unknown[]) => {
    mockMemo(() => {
      mockEffects.push(() => {
        const cleanup = effect();
        if (cleanup) mockCleanups.push(cleanup);
      });
    }, deps);
  },
}));
const mockLegacyMap = new Map<string, string>();
const mockSecureMap = new Map<string, string>();
const mockStore = (map: Map<string, string>) => ({
  getItem: jest.fn(async (k: string) => map.get(k) ?? null),
  setItem: jest.fn(async (k: string, v: string) => {
    map.set(k, v);
  }),
  removeItem: jest.fn(async (k: string) => {
    map.delete(k);
  }),
  getAllKeys: jest.fn(async () => [...map.keys()]),
  multiGet: jest.fn(async (keys: readonly string[]) =>
    keys.map((key) => [key, map.get(key) ?? null] as [string, string | null]),
  ),
  multiRemove: jest.fn(async (keys: readonly string[]) => {
    keys.forEach((key) => map.delete(key));
  }),
});
const mockLegacy = mockStore(mockLegacyMap);
const mockSecure = mockStore(mockSecureMap);
let mockRegistry: ReturnType<typeof import('../accountRegistry').createAccountRegistry<User>>;
jest.mock('../authAccountStorage', () => ({
  secureAccountStorage: mockSecure,
  authAccounts: {
    read: (...args: []) => mockRegistry.read(...args),
    snapshot: () => mockRegistry.snapshot(),
    subscribe: (fn: () => void) => mockRegistry.subscribe(fn),
    install: (...a: Parameters<typeof mockRegistry.install>) => mockRegistry.install(...a),
    activate: (...a: Parameters<typeof mockRegistry.activate>) => mockRegistry.activate(...a),
    update: (...a: Parameters<typeof mockRegistry.update>) => mockRegistry.update(...a),
    deactivate: (...a: Parameters<typeof mockRegistry.deactivate>) => mockRegistry.deactivate(...a),
    remove: (...a: Parameters<typeof mockRegistry.remove>) => mockRegistry.remove(...a),
  },
  readStoredAccountSession: async () => {
    const r = await mockRegistry.read();
    return r.accounts.find((a) => a.id === r.activeId)?.session ?? { token: null, user: null, impersonating: false };
  },
}));
jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: mockLegacy }));
jest.mock('react-native', () => ({
  Platform: { OS: 'android' },
  AppState: { addEventListener: () => ({ remove: () => {} }) },
  InteractionManager: {
    runAfterInteractions: (work: () => void) => {
      work();
      return { cancel: () => {} };
    },
  },
}));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { apiUrl: 'https://primary.test/api', apiFallbackUrls: [] } } },
}));
jest.mock('expo-notifications', () => ({
  setNotificationChannelAsync: async () => {},
  AndroidImportance: { MAX: 4 },
  getPermissionsAsync: async () => ({ status: 'denied' }),
  requestPermissionsAsync: async () => ({ status: 'denied' }),
}));
jest.mock('expo-image', () => ({ Image: { clearDiskCache: async () => {}, clearMemoryCache: async () => {} } }));
jest.mock('../../sentry', () => ({
  addSentryBreadcrumb: jest.fn(),
  captureException: jest.fn(),
  isTransientPushError: () => false,
}));
jest.mock('../../utils/widgetBridge', () => ({ clearWidgetData: jest.fn() }));
jest.mock('../../utils/liveActivityStore', () => ({ resetLiveActivitySession: async () => {} }));
jest.mock('../../utils/persistentCache', () => jest.requireActual('../../utils/persistentCache'));
jest.mock('../../utils/offlineCheckQueue', () => ({
  ...jest.requireActual('../../utils/offlineCheckQueue'),
  adoptOfflineCheckQueue: async () => {},
  endOfflineCheckQueueSession: async () => {},
  setOfflineCheckQueuePointId: () => {},
  stampOfflineCheckQueuePoint: async () => {},
}));
jest.mock('expo-crypto', () => ({
  randomUUID: () => '55555555-5555-4555-8555-555555555555',
  digestStringAsync: async () => 'a'.repeat(64),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
}));
const user = (id: string, tenantId = 'tenant-' + id): User =>
  ({ id, tenantId, fullName: id, role: 'master', currentPointId: 'point-' + id }) as User;
const jwt = (u: User) => `x.${btoa(JSON.stringify({ sub: u.id, tenantId: u.tenantId, pointId: u.currentPointId }))}.x`;
const flush = async () => {
  for (let i = 0; i < 80; i++) await Promise.resolve();
};
const response = (config: InternalAxiosRequestConfig, data: unknown): AxiosResponse => ({
  config,
  data,
  status: 200,
  statusText: 'OK',
  headers: {},
});
async function setup(withCache = false, initialUser = user('a')) {
  jest.resetModules();
  mockSlots.length = 0;
  mockEffects.length = 0;
  mockCleanups.length = 0;
  mockLegacyMap.clear();
  mockSecureMap.clear();
  jest.clearAllMocks();
  for (const [store, map] of [
    [mockLegacy, mockLegacyMap],
    [mockSecure, mockSecureMap],
  ] as const) {
    store.getItem.mockImplementation(async (key) => map.get(key) ?? null);
    store.setItem.mockImplementation(async (key, value) => {
      map.set(key, value);
    });
    store.removeItem.mockImplementation(async (key) => {
      map.delete(key);
    });
    store.getAllKeys.mockImplementation(async () => [...map.keys()]);
    store.multiGet.mockImplementation(async (keys) =>
      keys.map((key) => [key, map.get(key) ?? null] as [string, string | null]),
    );
    store.multiRemove.mockImplementation(async (keys) => {
      keys.forEach((key) => map.delete(key));
    });
  }
  const registryMod = jest.requireActual('../accountRegistry') as typeof import('../accountRegistry');
  mockRegistry = registryMod.createAccountRegistry<User>(
    mockSecure,
    mockLegacy,
    (v): v is User => !!v && typeof (v as User).id === 'string',
  );
  const state = await mockRegistry.read();
  const a = initialUser;
  await mockRegistry.install({ token: jwt(a), user: a, impersonating: false }, state.generation);
  const transport = jest.requireActual('../../api/axios') as typeof import('../../api/axios');
  transport.default.defaults.adapter = async (cfg) => response(cfg, a);
  const { AuthProvider } = jest.requireActual('../AuthContext') as typeof import('../AuthContext');
  const query = jest.requireActual('@tanstack/react-query') as typeof import('@tanstack/react-query');
  const queryClient = withCache
    ? new query.QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
    : undefined;
  if (queryClient) mockCleanups.push(() => queryClient.clear());
  type Api = ReturnType<typeof import('../AuthContext').useAuth>;
  const render = () => {
    mockCursor = 0;
    const element = AuthProvider({ children: null, queryClient });
    while (mockEffects.length) mockEffects.shift()?.();
    return element.props.value as Api;
  };
  render();
  await flush();
  let api = render();
  await flush();
  api = render();
  return { transport, render, api, a, registryMod, queryClient, query };
}
afterEach(() => {
  for (const cleanup of mockCleanups.splice(0)) cleanup();
});
it('failed second-stage Add uses anonymous exchange and preserves A registry, epoch, cache boundary and credentials', async () => {
  const f = await setup();
  const before = JSON.stringify(await mockRegistry.read());
  const lease = f.transport.captureAuthSession();
  const epoch = f.api.sessionGeneration;
  const sent: InternalAxiosRequestConfig[] = [];
  f.transport.default.defaults.adapter = async (cfg) => {
    sent.push(cfg);
    if (cfg.url?.includes('select-point'))
      throw Object.assign(new Error('expired-select'), {
        isAxiosError: true,
        config: cfg,
        response: { status: 401, data: { message: 'expired' }, headers: {}, config: cfg },
      });
    return response(cfg, {
      pointSelectionRequired: true,
      selectToken: 'B-attempt',
      expiresIn: 300,
      points: [],
      defaultPointId: 'b',
    });
  };
  const step = await f.api.addAccount('B', 'password');
  expect(step.status).toBe('point-required');
  if (step.status !== 'point-required') throw Error('expected point');
  await expect(f.api.completeAccountLogin(step.operation, 'B-point')).rejects.toMatchObject({
    response: { status: 401 },
  });
  await flush();
  const current = f.render();
  expect(current.token).toBe(jwt(f.a));
  expect(current.user?.id).toBe('a');
  expect(current.sessionGeneration).toBe(epoch);
  expect(JSON.stringify(await mockRegistry.read())).toBe(before);
  expect(lease.isCurrent()).toBe(true);
  expect(sent.every((c) => !c.headers.Authorization)).toBe(true);
});
it('three slots, A→B→A identical JWT creates new epoch and stale logout cannot clear A', async () => {
  const f = await setup();
  const oldLogout = f.api.logout;
  const aLease = f.transport.captureAuthSession();
  let selected = user('b');
  f.transport.default.defaults.adapter = async (cfg) => response(cfg, { token: jwt(selected), user: selected });
  await f.api.addAccount('B', 'pw');
  let current = f.render();
  selected = user('c');
  await current.addAccount('C', 'pw');
  current = f.render();
  const before = JSON.stringify(await mockRegistry.read());
  selected = user('d');
  await expect(current.addAccount('D', 'pw')).rejects.toMatchObject({ code: 'ACCOUNT_LIMIT' });
  expect(JSON.stringify(await mockRegistry.read())).toBe(before);
  const aId = current.savedAccounts.find((a) => a.identity.userId === 'a')!.id;
  await current.switchAccount(aId);
  current = f.render();
  expect(current.token).toBe(jwt(f.a));
  expect(aLease.isCurrent()).toBe(false);
  expect(current.savedAccounts).toHaveLength(3);
  await oldLogout();
  expect(f.render().token).toBe(jwt(f.a));
  expect((await mockRegistry.read()).activeId).toBe(aId);
});
it('canceled point attempt cannot dispatch after switch or be forged from copied handle', async () => {
  const f = await setup();
  const adapter = jest.fn(async (cfg: InternalAxiosRequestConfig) =>
    response(cfg, { pointSelectionRequired: true, selectToken: 'B', expiresIn: 300, points: [], defaultPointId: 'b' }),
  );
  f.transport.default.defaults.adapter = adapter;
  const step = await f.api.addAccount('B', 'pw');
  if (step.status !== 'point-required') throw Error('point');
  f.api.cancelAccountLogin(step.operation);
  await expect(f.api.completeAccountLogin(step.operation, 'b')).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
  await expect(f.api.completeAccountLogin({ ...step.operation }, 'b')).rejects.toMatchObject({
    code: 'SESSION_CHANGED',
  });
  expect(adapter).toHaveBeenCalledTimes(1);
  expect(f.render().user?.id).toBe('a');
});

it('logout during secure Add native write stays logged out and retains B as inactive, not a resurrected session', async () => {
  const f = await setup();
  const b = user('b');
  f.transport.default.defaults.adapter = async (cfg) => response(cfg, { token: jwt(b), user: b });
  const original = mockSecure.setItem.getMockImplementation()!;
  let release!: () => void;
  let entered = false;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  mockSecure.setItem.mockImplementation(async (k, v) => {
    if (k === 'autexa.auth.accounts.v1' && v.includes('tenant-b')) {
      entered = true;
      await gate;
    }
    await original(k, v);
  });
  const add = f.api.addAccount('B', 'pw').catch((e) => e.code);
  for (let i = 0; i < 1000 && !entered; i++) await Promise.resolve();
  expect(entered).toBe(true);
  const logout = f.api.logout();
  release();
  expect(await add).toBe('SESSION_CHANGED');
  await logout;
  await flush();
  const current = f.render();
  expect(current.token).toBe(null);
  expect(current.user).toBe(null);
  const saved = await mockRegistry.read();
  expect(saved.activeId).toBe(null);
  expect(saved.accounts.find((a) => a.identity.userId === 'b')?.session?.token).toBe(jwt(b));
  expect(saved.accounts.find((a) => a.identity.userId === 'a')?.needsReauth).toBe(true);
  mockSecure.setItem.mockImplementation(original);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const intentUser: User = {
  ...user('a'),
  id: '11111111-1111-4111-8111-111111111111',
  tenantId: '22222222-2222-4222-8222-222222222222',
  currentPointId: '33333333-3333-4333-8333-333333333333',
};
it.each(['procurement', 'nfc', 'offline', 'photos'])(
  'actual removeAccount drains an already started %s adapter write and retains the slot',
  async (kind) => {
    const f = await setup(false, intentUser);
    const data = jest.requireActual('../dataSession') as typeof import('../dataSession');
    const owner = { tenantId: f.a.tenantId!, userId: f.a.id, pointId: f.a.currentPointId! };
    data.setDataSession(owner);
    const lease = data.captureDataSession();
    const gate = deferred<void>();
    let entered = false;
    const original = mockLegacy.setItem.getMockImplementation()!;
    mockLegacy.setItem.mockImplementation(async (key, value) => {
      if (
        key.startsWith('autexa:procurement:') ||
        key.startsWith('autexa:nfc:') ||
        key.startsWith('autexa:pending-check-photos:') ||
        (key.startsWith('offline_check_queue_v2:') && value.includes('clientRequestId'))
      ) {
        entered = true;
        await gate.promise;
      }
      await original(key, value);
    });
    const send = jest.fn(async () => {
      throw new Error('ambiguous offline');
    });
    let work: Promise<unknown>;
    if (kind === 'procurement') {
      const { durableProcurement } = jest.requireActual(
        '../../utils/procurementStorage',
      ) as typeof import('../../utils/procurementStorage');
      work = durableProcurement.execute({
        owner,
        target: { operation: 'delivery-return', sourceId: '44444444-4444-4444-8444-444444444444' },
        payload: {},
        isCurrent: lease.isCurrent,
        send,
      });
    } else if (kind === 'nfc') {
      const { nativePendingNfc } = jest.requireActual(
        '../../utils/nativePendingNfc',
      ) as typeof import('../../utils/nativePendingNfc');
      work = nativePendingNfc.scan({
        owner,
        token: 'a'.repeat(43),
        lease,
        isCurrent: lease.isCurrent,
        refreshCurrent: async () => {},
        send,
      });
    } else if (kind === 'photos') {
      const photos = jest.requireActual(
        '../../utils/pendingCheckPhotos',
      ) as typeof import('../../utils/pendingCheckPhotos');
      work = photos.updatePendingCheckPhotos('saved-check', lease, () => [
        { uri: 'file:unsent.jpg', state: 'pending' },
      ]);
    } else {
      const queue = jest.requireActual(
        '../../utils/offlineCheckQueue',
      ) as typeof import('../../utils/offlineCheckQueue');
      await queue.adoptOfflineCheckQueue(owner);
      work = queue.enqueueOfflineCheck({ clientRequestId: '55555555-5555-4555-8555-555555555555' });
    }
    const outcome = work.catch(() => undefined);
    for (let i = 0; i < 1000 && !entered; i++) await Promise.resolve();
    expect(entered).toBe(true);
    let removed = false;
    const removing = f.api.removeAccount(f.api.activeAccountId!).then(
      () => {
        removed = true;
        return 'removed';
      },
      (e) => e.code,
    );
    await flush();
    expect(removed).toBe(false);
    gate.resolve();
    expect(await removing).toBe('UNRESOLVED_INTENTS');
    await outcome;
    expect((await mockRegistry.read()).accounts).toHaveLength(1);
    expect(f.render().activeAccountId).toBe(f.api.activeAccountId);
    expect(
      [...mockLegacyMap.keys()].some((key) =>
        key.startsWith(
          kind === 'procurement'
            ? 'autexa:procurement:'
            : kind === 'nfc'
              ? 'autexa:nfc:'
              : kind === 'photos'
                ? 'autexa:pending-check-photos:'
                : 'offline_check_queue_v2:',
        ),
      ),
    ).toBe(true);
    mockLegacy.setItem.mockImplementation(original);
  },
);

it('actual removeAccount freezes new writes during a stale getAllKeys snapshot; foreign-owner writes remain allowed', async () => {
  const f = await setup(false, intentUser);
  const owner = { tenantId: f.a.tenantId!, userId: f.a.id, pointId: f.a.currentPointId! };
  const { procurementStorage, durableProcurement } = jest.requireActual(
    '../../utils/procurementStorage',
  ) as typeof import('../../utils/procurementStorage');
  const gate = deferred<void>();
  let entered = false;
  const original = mockLegacy.getAllKeys.getMockImplementation()!;
  mockLegacy.getAllKeys.mockImplementation(async () => {
    const keys = await original();
    entered = true;
    await gate.promise;
    return keys;
  });
  const removing = f.api.removeAccount(f.api.activeAccountId!);
  for (let i = 0; i < 1000 && !entered; i++) await Promise.resolve();
  expect(entered).toBe(true);
  const key = `autexa:procurement:v1:${owner.tenantId}/${owner.userId}/${owner.pointId}/delivery-return/delivery`;
  await expect(procurementStorage.setItem(key, 'pending')).rejects.toMatchObject({ code: 'UNRESOLVED_INTENTS' });
  await procurementStorage.setItem('autexa:procurement:v1:other/user/point/delivery-return/delivery', 'other-pending');
  const send = jest.fn(async () => ({ status: 200, data: {} }));
  await expect(
    durableProcurement.execute({
      owner,
      target: { operation: 'delivery-return', sourceId: '44444444-4444-4444-8444-444444444444' },
      payload: {},
      isCurrent: () => true,
      send,
    }),
  ).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
  expect(send).not.toHaveBeenCalled();
  gate.resolve();
  await removing;
  expect((await mockRegistry.read()).accounts).toHaveLength(0);
  expect(mockLegacyMap.has(key)).toBe(false);
  expect(mockLegacyMap.get('autexa:procurement:v1:other/user/point/delivery-return/delivery')).toBe('other-pending');
  mockLegacy.getAllKeys.mockImplementation(original);
});

it('actual AuthProvider restores only selected saved-account disk cache while switching offline', async () => {
  const f = await setup(true);
  const qc = f.queryClient!;
  const b = user('b');
  f.transport.default.defaults.adapter = async (cfg) => response(cfg, { token: jwt(b), user: b });
  await f.api.addAccount('B', 'pw');
  await flush();
  const current = f.render();
  for (const u of [f.a, b])
    for (const key of [['products'], ['suppliers']]) {
      const prefix = 'rqcache:v2:' + encodeURIComponent(JSON.stringify([u.tenantId, u.id, u.currentPointId])) + ':';
      mockLegacyMap.set(
        prefix + JSON.stringify(key),
        JSON.stringify({ queryKey: key, data: [{ owner: u.id }], storedAt: Date.now() }),
      );
    }
  f.query.onlineManager.setOnline(false);
  f.transport.default.defaults.adapter = async () => {
    throw new Error('offline');
  };
  try {
    await current.switchAccount(current.savedAccounts.find((a) => a.identity.userId === 'a')!.id);
    await flush();
    expect(qc.getQueryData(['products'])).toEqual([{ owner: 'a' }]);
    expect(qc.getQueryData(['suppliers'])).toEqual([{ owner: 'a' }]);
    const a = f.render();
    await a.switchAccount(a.savedAccounts.find((slot) => slot.identity.userId === 'b')!.id);
    await flush();
    expect(qc.getQueryData(['products'])).toEqual([{ owner: 'b' }]);
    expect(qc.getQueryData(['suppliers'])).toEqual([{ owner: 'b' }]);
  } finally {
    qc.clear();
    f.query.onlineManager.setOnline(true);
  }
});
