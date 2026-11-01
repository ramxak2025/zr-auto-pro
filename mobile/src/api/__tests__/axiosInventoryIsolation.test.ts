import type { InternalAxiosRequestConfig } from 'axios';
const mockDisk = new Map<string, string>();
let mockInternal = true;
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return {
        extra: {
          inventoryInternal: mockInternal ? 'ios-v1' : undefined,
          apiUrl: 'https://autexa.pw/api',
          apiFallbackUrls: ['https://autexa-cloud.ru/api', 'https://production-gateway.test/api'],
        },
      };
    },
  },
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (key: string) => mockDisk.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      mockDisk.set(key, value);
    },
    removeItem: async (key: string) => {
      mockDisk.delete(key);
    },
    getAllKeys: async () => [...mockDisk.keys()],
    multiGet: async (keys: string[]) => keys.map((key) => [key, mockDisk.get(key) ?? null]),
    multiSet: async () => undefined,
    multiRemove: async () => undefined,
  },
}));
const realFetch = global.fetch;
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  global.fetch = realFetch;
});
beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
  jest.resetModules();
  mockInternal = true;
  mockDisk.clear();
});
function load() {
  return jest.requireActual('../axios') as typeof import('../axios');
}
const ok = (config: InternalAxiosRequestConfig) => ({
  status: 200,
  statusText: 'OK',
  data: { ok: true },
  headers: {},
  config,
});

it('ignores production ring/config and persisted production host, then fails over only across isolated aliases', async () => {
  mockDisk.set('active_api_base_v1', 'https://autexa-cloud.ru/api');
  mockDisk.set('autexa_inventory_internal_v1.active_api_base_v1', 'https://autexa.pw/api');
  const health: string[] = [];
  global.fetch = jest.fn(async (url) => {
    health.push(String(url));
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ ok: true }),
    } as unknown as Response;
  });
  const mod = load();
  mod.setAuthToken('stage-token');
  const sent: InternalAxiosRequestConfig[] = [];
  mod.default.defaults.adapter = async (config) => {
    sent.push(config);
    if (config.baseURL === 'https://autexa.pw:8443/api')
      throw Object.assign(new Error('route'), { code: 'ERR_NETWORK', config, isAxiosError: true });
    return ok(config);
  };
  await mod.default.get('/products');
  expect(mod.API_URL).toBe('https://autexa.pw:8443/api');
  expect(sent.map((c) => c.baseURL)).toEqual(['https://autexa.pw:8443/api', 'https://autexa-cloud.ru:8443/api']);
  expect(sent.every((c) => c.headers.Authorization === 'Bearer stage-token')).toBe(true);
  expect(health.every((url) => /^https:\/\/(autexa\.pw|autexa-cloud\.ru):8443\/api\//.test(url))).toBe(true);
  expect(mockDisk.get('active_api_base_v1')).toBe('https://autexa-cloud.ru/api');
  mod.setAuthToken(null);
});

it('rejects absolute production URLs and forged failover bases before any bearer or payload can dispatch', async () => {
  const mod = load();
  mod.setAuthToken('stage-token');
  const adapter = jest.fn(async (config: InternalAxiosRequestConfig) => ok(config));
  mod.default.defaults.adapter = adapter;
  for (const url of [
    'https://autexa.pw/api/checks',
    '//autexa.pw/api/checks',
    'https://autexa-cloud.ru/api/checks',
    'http://localhost:3000/api/checks',
    '\\\\autexa.pw\\api',
  ]) {
    await expect(mod.default.post(url, { secret: 'stage-data' })).rejects.toMatchObject({ code: 'ERR_CANCELED' });
  }
  await expect(
    mod.default.post('/checks', {}, { _failoverBaseUrl: 'https://autexa.pw/api' } as never),
  ).rejects.toMatchObject({ code: 'ERR_CANCELED' });
  expect(adapter).not.toHaveBeenCalled();
  mod.setAuthToken(null);
});

it('stale captured session cannot send an old offline mutation after the current session changes', async () => {
  const mod = load();
  mod.setAuthToken('stage-A');
  const old = mod.createSessionBoundClient('stage-A');
  mod.setAuthToken('stage-B');
  const adapter = jest.fn(async (config: InternalAxiosRequestConfig) => ok(config));
  mod.default.defaults.adapter = adapter;
  await expect(old.post('/checks', { amount: 100 })).rejects.toMatchObject({ code: 'ERR_CANCELED' });
  expect(adapter).not.toHaveBeenCalled();
  mod.setAuthToken(null);
});

it('runtime extra changes and per-request base overrides cannot move a live internal process back to production', async () => {
  global.fetch = jest.fn(async () => ({
    ok: true,
    text: async () => '{"status":"ok"}',
    headers: { get: () => 'application/json' },
  })) as unknown as typeof fetch;
  const mod = load();
  mod.setAuthToken('stage-token');
  mockInternal = false;
  const adapter = jest.fn(async (config: InternalAxiosRequestConfig) => ok(config));
  mod.default.defaults.adapter = adapter;
  await mod.default.post('/checks', { clientRequestId: 'stage-payload' }, { baseURL: 'https://autexa.pw/api' });
  expect(adapter.mock.calls[0][0].baseURL).toBe('https://autexa.pw:8443/api');
  await expect(mod.default.post('https://autexa.pw/api/checks', {})).rejects.toMatchObject({ code: 'ERR_CANCELED' });
  expect(adapter).toHaveBeenCalledTimes(1);
  mod.setAuthToken(null);
});
