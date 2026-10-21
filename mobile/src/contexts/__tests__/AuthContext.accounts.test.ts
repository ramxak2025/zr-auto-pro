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
const realFetch = global.fetch;
const mockAppStateListeners = new Set<(value: string) => void>();
let mockRegistry: ReturnType<typeof import('../accountRegistry').createAccountRegistry<User>>;
let mockUseRealQueue = false;
jest.mock('../authAccountStorage', () => ({
  secureAccountStorage: mockSecure,
  authAccounts: {
    read: (...args: []) => mockRegistry.read(...args),
    snapshot: () => mockRegistry.snapshot(),
    subscribe: (fn: () => void) => mockRegistry.subscribe(fn),
    install: (...a: Parameters<typeof mockRegistry.install>) => mockRegistry.install(...a),
    activate: (...a: Parameters<typeof mockRegistry.activate>) => mockRegistry.activate(...a),
    update: (...a: Parameters<typeof mockRegistry.update>) => mockRegistry.update(...a),
    beginReissue: (...a: Parameters<typeof mockRegistry.beginReissue>) => mockRegistry.beginReissue(...a),
    completeReissue: (...a: Parameters<typeof mockRegistry.completeReissue>) => mockRegistry.completeReissue(...a),
    cancelReissue: (...a: Parameters<typeof mockRegistry.cancelReissue>) => mockRegistry.cancelReissue(...a),
    deactivate: (...a: Parameters<typeof mockRegistry.deactivate>) => mockRegistry.deactivate(...a),
    remove: (...a: Parameters<typeof mockRegistry.remove>) => mockRegistry.remove(...a),
  },
  readStoredAccountSession: async () => {
    const r = await mockRegistry.read();
    return r.accounts.find((a) => a.id === r.activeId)?.session ?? { token: null, user: null, impersonating: false };
  },
  hasPendingSessionReissue: (token: string | null) => {
    const saved = mockRegistry.snapshot();
    const session = saved?.accounts.find((a) => a.id === saved.activeId)?.session;
    return !!token && session?.token === token && !!session.pendingReissue;
  },
}));
jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: mockLegacy }));
jest.mock('react-native', () => ({
  Platform: { OS: 'android' },
  AppState: {
    addEventListener: (_event: string, listener: (value: string) => void) => {
      mockAppStateListeners.add(listener);
      return { remove: () => mockAppStateListeners.delete(listener) };
    },
  },
  InteractionManager: {
    runAfterInteractions: (work: () => void) => {
      work();
      return { cancel: () => {} };
    },
  },
}));
let mockFallbackUrls: string[] = [];
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { apiUrl: 'https://primary.test/api', apiFallbackUrls: mockFallbackUrls } } },
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
jest.mock('../../utils/offlineCheckQueue', () => {
  const actual = jest.requireActual('../../utils/offlineCheckQueue') as typeof import('../../utils/offlineCheckQueue');
  return {
    ...actual,
    adoptOfflineCheckQueue: (...args: Parameters<typeof actual.adoptOfflineCheckQueue>) =>
      mockUseRealQueue ? actual.adoptOfflineCheckQueue(...args) : Promise.resolve(),
    endOfflineCheckQueueSession: () => (mockUseRealQueue ? actual.endOfflineCheckQueueSession() : Promise.resolve()),
    stampOfflineCheckQueuePoint: (...args: Parameters<typeof actual.stampOfflineCheckQueuePoint>) =>
      mockUseRealQueue ? actual.stampOfflineCheckQueuePoint(...args) : Promise.resolve(0),
  };
});
jest.mock('expo-crypto', () => ({
  randomUUID: () => '55555555-5555-4555-8555-555555555555',
  digestStringAsync: async () => 'a'.repeat(64),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
}));
const user = (id: string, tenantId = 'tenant-' + id): User =>
  ({ id, tenantId, fullName: id, role: 'master', currentPointId: 'point-' + id }) as User;
const jwt = (u: User, claims: Record<string, unknown> = {}) =>
  `x.${btoa(JSON.stringify({ sub: u.id, tenantId: u.tenantId, pointId: u.currentPointId, ...claims }))}.x`;
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
async function setup(
  withCache = false,
  initialUser = user('a'),
  options: {
    hosts?: string[];
    noProfile?: boolean;
    adapter?: (cfg: InternalAxiosRequestConfig) => Promise<AxiosResponse>;
    token?: string;
    restore?: string;
    beforeMount?: () => void;
    realQueue?: boolean;
    restoreLegacy?: [string, string][];
  } = {},
) {
  mockFallbackUrls = options.hosts ?? [];
  mockUseRealQueue = !!options.realQueue;
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    text: async () => '{"status":"ok"}',
  })) as unknown as typeof fetch;
  jest.resetModules();
  mockSlots.length = 0;
  mockEffects.length = 0;
  mockCleanups.length = 0;
  mockLegacyMap.clear();
  mockSecureMap.clear();
  for (const [key, value] of options.restoreLegacy ?? []) mockLegacyMap.set(key, value);
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
  if (options.restore) mockSecureMap.set(registryMod.ACCOUNT_REGISTRY_KEY, options.restore);
  mockRegistry = registryMod.createAccountRegistry<User>(
    mockSecure,
    mockLegacy,
    (v): v is User => !!v && typeof (v as User).id === 'string',
  );
  const state = await mockRegistry.read();
  const a = initialUser;
  if (!options.restore)
    await mockRegistry.install({ token: options.token ?? jwt(a), user: a, impersonating: false }, state.generation);
  if (options.noProfile)
    await mockRegistry.update({ token: jwt(a), user: null, impersonating: false }, mockRegistry.snapshot()!.generation);
  const transport = jest.requireActual('../../api/axios') as typeof import('../../api/axios');
  transport.default.defaults.adapter = options.adapter ?? (async (cfg) => response(cfg, a));
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
  options.beforeMount?.();
  render();
  await flush();
  let api = render();
  await flush();
  api = render();
  return { transport, render, api, a, registryMod, queryClient, query };
}
afterEach(() => {
  for (const cleanup of mockCleanups.splice(0)) cleanup();
  global.fetch = realFetch;
});

describe('bootstrap auth classification through the real axios interceptor chain', () => {
  const fail = (cfg: InternalAxiosRequestConfig, html: boolean) =>
    Object.assign(new Error('401'), {
      isAxiosError: true,
      config: cfg,
      response: {
        status: 401,
        data: html ? '<!doctype html><html>VPN portal</html>' : { message: 'Токен отозван' },
        headers: { 'content-type': html ? 'text/html' : 'application/json' },
        config: cfg,
      },
    });
  it.each([false, true])('all hosts returning HTML401 preserve credentials (no profile=%s)', async (noProfile) => {
    const sent: string[] = [];
    const f = await setup(false, user('a'), {
      noProfile,
      hosts: ['https://reserve.test/api', 'https://third.test/api'],
      adapter: async (cfg) => {
        sent.push(cfg.baseURL!);
        throw fail(cfg, true);
      },
    });
    await flush();
    const current = f.render();
    expect(new Set(sent).size).toBe(3);
    expect(current.token).toBe(jwt(f.a));
    expect(current.user?.id ?? null).toBe(noProfile ? null : 'a');
    expect(current.recoveringSession).toBe(noProfile);
    expect((await mockRegistry.read()).accounts[0].needsReauth).toBe(false);
    expect(mockRegistry.snapshot()!.accounts[0].session?.token).toBe(jwt(f.a));
  });
  it('one configured host returning HTML401 preserves the saved account', async () => {
    const f = await setup(false, user('a'), {
      adapter: async (cfg) => {
        throw fail(cfg, true);
      },
    });
    await flush();
    expect(f.render().token).toBe(jwt(f.a));
    expect(mockRegistry.snapshot()!.accounts[0].needsReauth).toBe(false);
  });
  it.each([{}, [], 'proxy unauthorized', undefined, { proxy: 'unauthorized' }])(
    'unknown 401 payload preserves credentials through axios and provider: %p',
    async (data) => {
      const f = await setup(false, user('a'), {
        adapter: async (cfg) => {
          const error = fail(cfg, false);
          Object.assign(error.response, { data });
          throw error;
        },
      });
      await flush();
      expect(f.render().token).toBe(jwt(f.a));
      expect(mockRegistry.snapshot()!.accounts[0].needsReauth).toBe(false);
    },
  );
  it('actual API401 still expires the current account', async () => {
    const f = await setup(false, user('a'), {
      adapter: async (cfg) => {
        throw fail(cfg, false);
      },
    });
    await flush();
    expect(f.render().token).toBeNull();
    expect(mockRegistry.snapshot()!.accounts[0].session).toBeNull();
    expect(mockRegistry.snapshot()!.accounts[0].needsReauth).toBe(true);
  });
  it('late bootstrap API401 from A cannot expire a newly installed B', async () => {
    let rejectOld!: (reason: unknown) => void;
    let oldConfig!: InternalAxiosRequestConfig;
    const f = await setup(false, user('a'), {
      adapter: (cfg) =>
        new Promise((_resolve, reject) => {
          oldConfig = cfg;
          rejectOld = reject;
        }),
    });
    const b = user('b');
    f.transport.default.defaults.adapter = async (cfg) => response(cfg, { token: jwt(b), user: b });
    await f.render().addAccount('B', 'pw');
    rejectOld(fail(oldConfig, false));
    await flush();
    expect(f.render().token).toBe(jwt(b));
    expect(
      mockRegistry.snapshot()!.accounts.find((a) => a.id === mockRegistry.snapshot()!.activeId)?.session?.token,
    ).toBe(jwt(b));
  });
});

describe('durable refresh lifecycle in the real provider', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  const oldToken = (a: User) =>
    jwt(a, {
      jti: 'parent',
      iat: Math.floor(Date.now() / 1000) - 8 * 86400,
      exp: Math.floor(Date.now() / 1000) + 22 * 86400,
    });
  const childToken = (a: User) =>
    jwt(a, { jti: 'child', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 30 * 86400 });
  const offline = (config: InternalAxiosRequestConfig) =>
    Object.assign(new Error('connection reset after dispatch'), {
      isAxiosError: true,
      code: 'ECONNABORTED',
      config,
    });
  const denied = (config: InternalAxiosRequestConfig) =>
    Object.assign(new Error('revoked'), {
      isAxiosError: true,
      config,
      response: { status: 401, data: { message: 'Токен отозван' }, headers: {}, config },
    });

  it('lost replies, 20 minutes offline and process restart recover the same operation before /me', async () => {
    const a = user('a'),
      old = oldToken(a),
      child = childToken(a);
    const keys: unknown[] = [];
    const f = await setup(false, a, {
      token: old,
      adapter: async (cfg) => {
        expect(cfg.url).toBe('/auth/refresh');
        const saved = mockRegistry.snapshot()!;
        const key = saved.accounts[0].session?.pendingReissue?.refreshRequestId;
        expect(key).toBeTruthy();
        expect(mockSecureMap.get('autexa.auth.accounts.v1')).toContain(key!);
        keys.push(cfg.headers['x-refresh-request-id']);
        throw offline(cfg);
      },
    });
    await jest.advanceTimersByTimeAsync(551);
    await flush();
    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(1);
    expect(f.render().token).toBe(old);
    const stored = mockSecureMap.get('autexa.auth.accounts.v1')!;
    for (const cleanup of mockCleanups.splice(0)) cleanup();
    jest.advanceTimersByTime(20 * 60 * 1000);
    const order: string[] = [];
    const resumed = await setup(false, a, {
      restore: stored,
      adapter: async (cfg) => {
        order.push(cfg.url!);
        if (cfg.url === '/auth/refresh') {
          expect(cfg.headers['x-refresh-request-id']).toBe(keys[0]);
          expect(cfg.headers.Authorization).toBe(`Bearer ${old}`);
          return response(cfg, { token: child });
        }
        expect(cfg.headers.Authorization).toBe(`Bearer ${child}`);
        return response(cfg, a);
      },
    });
    await flush();
    expect(order.slice(0, 2)).toEqual(['/auth/refresh', '/auth/me']);
    expect(resumed.render().token).toBe(child);
    expect(mockRegistry.snapshot()!.accounts[0].session?.pendingReissue?.refreshRequestId).toBeUndefined();
    expect(mockSecureMap.get('autexa.auth.accounts.v1')).not.toContain(String(keys[0]));
  });

  it('secure write failure before dispatch sends zero refresh POSTs', async () => {
    const a = user('a'),
      old = oldToken(a);
    const adapter = jest.fn(async (cfg: InternalAxiosRequestConfig) => response(cfg, a));
    const f = await setup(false, a, {
      token: old,
      adapter,
      beforeMount: () => {
        mockSecure.setItem.mockRejectedValue(new Error('keychain locked'));
      },
    });
    await flush();
    expect(adapter).not.toHaveBeenCalled();
    expect(f.render().token).toBe(old);
    expect((await mockRegistry.read()).accounts[0].needsReauth).toBe(false);
  });

  it('failed successor persistence retains pending recovery and the original secure bearer', async () => {
    const a = user('a'),
      old = oldToken(a),
      child = childToken(a);
    const f = await setup(false, a, {
      token: old,
      adapter: async (cfg) => {
        const save = mockSecure.setItem.getMockImplementation()!;
        mockSecure.setItem.mockImplementation(async (key, value) => {
          if (value.includes(child)) throw new Error('keychain unavailable');
          return save(key, value);
        });
        return response(cfg, { token: child });
      },
    });
    await flush();
    expect(f.render().token).toBe(old);
    // The registry deliberately drops its volatile snapshot after a failed
    // native write. An ordinary parent401 must still preserve pending recovery.
    expect(mockRegistry.snapshot()).toBeNull();
    f.transport.default.defaults.adapter = async (cfg) => {
      if (cfg.url === '/products') throw denied(cfg);
      throw offline(cfg);
    };
    await expect(f.transport.default.get('/products')).rejects.toMatchObject({ code: 'ERR_SESSION_RECOVERING' });
    await jest.advanceTimersByTimeAsync(551);
    expect(f.render().token).toBe(old);
    expect((await mockRegistry.read()).accounts[0].session?.pendingReissue?.refreshRequestId).toBeTruthy();
    expect(mockSecureMap.get('autexa.auth.accounts.v1')).toContain(old);
    expect(mockSecureMap.get('autexa.auth.accounts.v1')).not.toContain(child);
  });

  it('successful child write with failed readback adopts that exact durable child on retry without another POST', async () => {
    const a = user('a'),
      old = oldToken(a),
      child = childToken(a);
    let readbackFailed = false,
      posts = 0;
    const f = await setup(false, a, {
      token: old,
      adapter: async (cfg) => {
        posts++;
        const read = mockSecure.getItem.getMockImplementation()!;
        mockSecure.getItem.mockImplementation(async (key) => {
          const value = await read(key);
          if (!readbackFailed && key === 'autexa.auth.accounts.v1' && value?.includes(child)) {
            readbackFailed = true;
            throw new Error('native readback acknowledgement lost');
          }
          return value;
        });
        return response(cfg, { token: child });
      },
    });
    expect(readbackFailed).toBe(true);
    expect(f.render().token).toBe(old);
    expect(mockSecureMap.get('autexa.auth.accounts.v1')).toContain(child);
    f.transport.default.defaults.adapter = async (cfg) => {
      expect(cfg.url).toBe('/auth/me');
      if (cfg.headers.Authorization !== `Bearer ${child}`) throw denied(cfg);
      return response(cfg, a);
    };
    await f.render().refreshUser();
    await flush();
    expect(f.render().token).toBe(child);
    expect(mockRegistry.snapshot()!.accounts[0].session?.pendingReissue).toBeUndefined();
    expect(posts).toBe(1);
  });

  it.each([false, true])('ordinary parent401 after grace wakes recovery; real revocation=%s', async (revoked) => {
    const a = user('a'),
      old = oldToken(a),
      child = childToken(a);
    const f = await setup(false, a, {
      token: old,
      adapter: async (cfg) => {
        throw offline(cfg);
      },
    });
    await jest.advanceTimersByTimeAsync(551);
    await flush();
    f.render();
    jest.advanceTimersByTime(121000);
    const calls: string[] = [];
    f.transport.default.defaults.adapter = async (cfg) => {
      calls.push(cfg.url!);
      if (cfg.url === '/auth/refresh') {
        if (revoked) throw denied(cfg);
        return response(cfg, { token: child });
      }
      if (cfg.url === '/products') throw denied(cfg);
      return response(cfg, a);
    };
    await expect(f.transport.default.get('/products')).rejects.toMatchObject({ code: 'ERR_SESSION_RECOVERING' });
    await flush();
    expect(calls).toContain('/auth/refresh');
    expect(f.render().token).toBe(revoked ? null : child);
    expect(mockRegistry.snapshot()!.accounts[0].needsReauth).toBe(revoked);
  });

  it('late refresh response cannot publish into B or revive removed A', async () => {
    const a = user('a'),
      old = oldToken(a),
      child = childToken(a);
    let resolveRefresh!: (value: AxiosResponse) => void;
    let refreshCfg!: InternalAxiosRequestConfig;
    const f = await setup(false, a, {
      token: old,
      adapter: (cfg) =>
        new Promise((resolve) => {
          resolveRefresh = resolve;
          refreshCfg = cfg;
        }),
    });
    const b = user('b');
    f.transport.default.defaults.adapter = async (cfg) => response(cfg, { token: jwt(b), user: b });
    await f.render().addAccount('B', 'pw');
    const aId = mockRegistry.snapshot()!.accounts.find((slot) => slot.identity.userId === 'a')!.id;
    await f.render().removeAccount(aId);
    resolveRefresh(response(refreshCfg, { token: child }));
    await flush();
    expect(f.render().token).toBe(jwt(b));
    expect(mockRegistry.snapshot()!.accounts.map((slot) => slot.identity.userId)).toEqual(['b']);
    expect(mockSecureMap.get('autexa.auth.accounts.v1')).not.toContain(child);
  });

  it('explicit logout wins an in-flight refresh and sends the captured recovery capability', async () => {
    const a = user('a'),
      old = oldToken(a),
      child = childToken(a);
    let resolveRefresh!: (value: AxiosResponse) => void;
    let refreshCfg!: InternalAxiosRequestConfig;
    const f = await setup(false, a, {
      token: old,
      adapter: (cfg) =>
        new Promise((resolve) => {
          resolveRefresh = resolve;
          refreshCfg = cfg;
        }),
    });
    const key = mockRegistry.snapshot()!.accounts[0].session!.pendingReissue!.refreshRequestId;
    const sent: InternalAxiosRequestConfig[] = [];
    f.transport.default.defaults.adapter = async (cfg) => {
      sent.push(cfg);
      return response(cfg, {});
    };
    await f.render().logout();
    resolveRefresh(response(refreshCfg, { token: child }));
    await flush();
    expect(f.render().token).toBeNull();
    expect(mockRegistry.snapshot()!.accounts[0].session).toBeNull();
    expect(sent.find((cfg) => cfg.url === '/auth/logout')?.headers['x-refresh-request-id']).toBe(key);
  });

  it('a long-running app renews on foreground before its profile read without a NetInfo change', async () => {
    const a = user('a'),
      young = jwt(a, {
        jti: 'young',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 30 * 86400,
      });
    const f = await setup(false, a, { token: young });
    jest.advanceTimersByTime(8 * 86400000);
    const child = childToken(a),
      order: string[] = [];
    f.transport.default.defaults.adapter = async (cfg) => {
      order.push(cfg.url!);
      return response(cfg, cfg.url === '/auth/refresh' ? { token: child } : a);
    };
    f.render();
    mockAppStateListeners.forEach((listener) => listener('background'));
    mockAppStateListeners.forEach((listener) => listener('active'));
    await flush();
    expect(order.slice(0, 2)).toEqual(['/auth/refresh', '/auth/me']);
    expect(order.filter((path) => path === '/auth/refresh')).toHaveLength(1);
    expect(f.render().token).toBe(child);
  });

  it('reactivating A after B recovers its saved operation before using A credentials', async () => {
    const a = user('a'),
      old = oldToken(a),
      child = childToken(a);
    const f = await setup(false, a, {
      token: old,
      adapter: async (cfg) => {
        throw offline(cfg);
      },
    });
    await jest.advanceTimersByTimeAsync(551);
    const aSlot = mockRegistry.snapshot()!.accounts[0],
      key = aSlot.session!.pendingReissue!.refreshRequestId;
    const b = user('b');
    f.transport.default.defaults.adapter = async (cfg) => response(cfg, { token: jwt(b), user: b });
    await f.render().addAccount('B', 'pw');
    expect(f.render().token).toBe(jwt(b));
    f.transport.default.defaults.adapter = async (cfg) => {
      expect(cfg.url).toBe('/auth/refresh');
      expect(cfg.headers.Authorization).toBe(`Bearer ${old}`);
      expect(cfg.headers['x-refresh-request-id']).toBe(key);
      return response(cfg, { token: child });
    };
    await f.render().switchAccount(aSlot.id);
    expect(f.render().token).toBe(child);
    expect(mockRegistry.snapshot()!.activeId).toBe(aSlot.id);
  });

  it('lost point-switch reply survives restart and old-point checks never flush with the recovered target bearer', async () => {
    const a = user('a'),
      branch = '99999999-9999-4999-8999-999999999999';
    const target = { ...a, currentPointId: branch },
      child = childToken(target);
    const f = await setup(false, a, { realQueue: true });
    const queue = jest.requireActual('../../utils/offlineCheckQueue') as typeof import('../../utils/offlineCheckQueue');
    const owner = { tenantId: a.tenantId!, userId: a.id, pointId: a.currentPointId! };
    await queue.enqueueOfflineCheck({
      clientRequestId: '11111111-1111-4111-8111-111111111111',
      services: [],
      products: [],
    });
    const calls: InternalAxiosRequestConfig[] = [];
    f.transport.default.defaults.adapter = async (cfg) => {
      calls.push(cfg);
      throw offline(cfg);
    };
    const pending = f
      .render()
      .switchSessionPoint(branch)
      .catch((e: unknown) => e);
    await jest.advanceTimersByTimeAsync(551);
    await pending;
    expect(calls).toHaveLength(3);
    expect(
      calls.every((cfg) => cfg.url === '/auth/switch-point' && JSON.parse(cfg.data as string).pointId === branch),
    ).toBe(true);
    const journal = mockRegistry.snapshot()!.accounts[0].session!.pendingReissue!;
    expect(journal).toMatchObject({ kind: 'switch-point', pointId: branch });
    expect(new Set(calls.map((cfg) => cfg.headers['x-refresh-request-id']))).toEqual(
      new Set([journal.refreshRequestId]),
    );
    const stored = mockSecureMap.get('autexa.auth.accounts.v1')!,
      legacy = [...mockLegacyMap.entries()];
    for (const cleanup of mockCleanups.splice(0)) cleanup();
    jest.advanceTimersByTime(20 * 60 * 1000);
    const sent: string[] = [];
    const resumed = await setup(false, a, {
      restore: stored,
      restoreLegacy: legacy,
      realQueue: true,
      adapter: async (cfg) => {
        sent.push(cfg.url!);
        expect(cfg.url).toBe('/auth/switch-point');
        expect(cfg.headers['x-refresh-request-id']).toBe(journal.refreshRequestId);
        return response(cfg, { token: child, user: target, currentPointId: branch, switched: true });
      },
    });
    await flush();
    expect(resumed.render().token).toBe(child);
    expect(resumed.render().user?.currentPointId).toBe(branch);
    const restoredQueue = jest.requireActual(
      '../../utils/offlineCheckQueue',
    ) as typeof import('../../utils/offlineCheckQueue');
    expect(await restoredQueue.pendingOfflineCheckCount()).toBe(0);
    await restoredQueue.flushOfflineCheckQueue();
    expect(sent).not.toContain('/checks');
    const retained = mockLegacyMap.get(restoredQueue.scopedQueueKey(owner));
    expect(retained).toContain('11111111-1111-4111-8111-111111111111');
    expect(retained).toContain(a.currentPointId!);
    expect(mockRegistry.snapshot()!.accounts[0].scopes.map((s) => s.pointId)).toEqual(
      expect.arrayContaining([a.currentPointId, branch]),
    );
  });

  it('late switch response cannot move newly installed B to A target point', async () => {
    const f = await setup(),
      branch = '99999999-9999-4999-8999-999999999999';
    let resolve!: (value: AxiosResponse) => void, config!: InternalAxiosRequestConfig;
    f.transport.default.defaults.adapter = (cfg) =>
      new Promise((done) => {
        resolve = done;
        config = cfg;
      });
    const operation = f.render().switchSessionPoint(branch);
    await flush();
    const b = user('b');
    f.transport.default.defaults.adapter = async (cfg) => response(cfg, { token: jwt(b), user: b });
    await f.render().addAccount('B', 'pw');
    const target = { ...f.a, currentPointId: branch };
    resolve(response(config, { token: childToken(target), user: target, currentPointId: branch }));
    await operation;
    expect(f.render().token).toBe(jwt(b));
    expect(f.render().user?.currentPointId).toBe(b.currentPointId);
  });
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
  ).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
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

it.each(['procurement', 'nfc'])(
  'late %s preparation read after completed removal cannot create an orphan intent',
  async (kind) => {
    const f = await setup(false, intentUser);
    const data = jest.requireActual('../dataSession') as typeof import('../dataSession');
    const owner = { tenantId: f.a.tenantId!, userId: f.a.id, pointId: f.a.currentPointId! };
    const lease = data.captureDataSession();
    const prefix = kind === 'procurement' ? 'autexa:procurement:v1:' : 'autexa:nfc:v1:';
    const gate = deferred<void>();
    const originalRead = mockLegacy.getItem.getMockImplementation()!;
    let entered = false;
    mockLegacy.getItem.mockImplementation(async (key) => {
      const originalValue = await originalRead(key);
      if (!entered && key.startsWith(prefix)) {
        entered = true;
        await gate.promise;
      }
      return originalValue;
    });
    const send = jest.fn(async () => {
      throw new Error('Network must not run');
    });
    const work =
      kind === 'procurement'
        ? (
            jest.requireActual('../../utils/procurementStorage') as typeof import('../../utils/procurementStorage')
          ).durableProcurement.execute({
            owner,
            target: { operation: 'delivery-return', sourceId: '44444444-4444-4444-8444-444444444444' },
            payload: {},
            isCurrent: lease.isCurrent,
            send,
          })
        : (
            jest.requireActual('../../utils/nativePendingNfc') as typeof import('../../utils/nativePendingNfc')
          ).nativePendingNfc.scan({
            owner,
            lease,
            token: 'a'.repeat(43),
            isCurrent: lease.isCurrent,
            refreshCurrent: async () => {},
            send,
          });
    const outcome = work.catch((error: { code: string }) => error);
    try {
      for (let i = 0; i < 1000 && !entered; i++) await Promise.resolve();
      expect(entered).toBe(true);
      expect([...mockLegacyMap.keys()].some((key) => key.startsWith(prefix))).toBe(false);
      await f.api.removeAccount(f.api.activeAccountId!);
      expect((await mockRegistry.read()).accounts).toHaveLength(0);
      expect(lease.isCurrent()).toBe(false);
      // The freeze has finished and released. The delayed native read still
      // carries the original empty result and may not start its first write.
      gate.resolve();
      expect(await outcome).toMatchObject({ code: 'SESSION_CHANGED' });
      expect([...mockLegacyMap.keys()].some((key) => key.startsWith(prefix))).toBe(false);
      expect(send).not.toHaveBeenCalled();
    } finally {
      gate.resolve();
      await outcome;
      mockLegacy.getItem.mockImplementation(originalRead);
    }
  },
);
