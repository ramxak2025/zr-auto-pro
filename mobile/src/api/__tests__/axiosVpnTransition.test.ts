// Independent transport scenarios: route changes are deliberately invisible to
// NetInfo. Native VPN/DNS is not exercised; real Axios/controller logic is.
import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios';

const PRIMARY = 'https://primary.test/api';
const RESERVE = 'https://reserve.test/api';
const THIRD = 'https://third.test/api';
const BEARER = 'unchanged-account-A';
const realFetch = global.fetch;

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {
        apiUrl: 'https://primary.test/api',
        apiFallbackUrls: ['https://reserve.test/api', 'https://third.test/api'],
      },
    },
  },
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
    getAllKeys: jest.fn(async () => []),
    multiGet: jest.fn(async () => []),
    multiRemove: jest.fn(async () => undefined),
  },
}));
jest.mock('../../contexts/authAccountStorage', () => ({
  readStoredAccountSession: async () => ({ token: null, user: null, impersonating: false }),
  hasPendingSessionRefresh: () => false,
}));

type AxiosModule = typeof import('../axios');
type RecoveryModule = typeof import('../../utils/backendRecovery');
type Attempt = { host: string; method: string; authorization: unknown };
const wifi = {
  isConnected: true,
  type: 'wifi',
  details: { ssid: 'unchanged-wifi', ipAddress: '192.168.1.20', bssid: 'aa:bb:cc:dd:ee:ff' },
};

function response(config: InternalAxiosRequestConfig, data: unknown): AxiosResponse {
  return { status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, config, data };
}

function failed(config: InternalAxiosRequestConfig): Error {
  return Object.assign(new Error('connection lost after dispatch'), {
    isAxiosError: true,
    code: 'ECONNABORTED',
    config,
  });
}

async function microtasks() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

function setup() {
  jest.resetModules();
  const transport = jest.requireActual<AxiosModule>('../axios');
  const recovery = jest.requireActual<RecoveryModule>('../../utils/backendRecovery');
  const health = jest.fn(async () => ({
    ok: true,
    text: async () => '{"status":"ok"}',
    headers: { get: () => 'application/json' },
  }));
  // Tiny health probes remain successful even when the real API route fails.
  global.fetch = health as unknown as typeof fetch;
  const controller = recovery.createApiRouteRecoveryController({
    initialAppState: 'active',
    reselect: transport.reselectApiHost,
  });
  const expired = jest.fn();
  const offExpiry = transport.onAuthExpired(expired);
  const offFailure = transport.onNetworkClassFailure(controller.onNetworkFailure);
  controller.onNetworkState(wifi);
  transport.setAuthToken(BEARER, true);
  const lease = transport.captureAuthSession();
  return {
    transport,
    recovery,
    controller,
    health,
    expired,
    lease,
    dispose: () => {
      offExpiry();
      offFailure();
    },
  };
}

beforeEach(() => jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] }));
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  global.fetch = realFetch;
});

it('same-signature VPN on/country/off changes recover real GETs despite successful health probes and keep the bearer', async () => {
  const h = setup();
  let available = PRIMARY;
  const attempts: Attempt[] = [];
  h.transport.default.defaults.adapter = async (config) => {
    const host = String(config.baseURL);
    attempts.push({ host, method: String(config.method), authorization: config.headers.get('Authorization') });
    if (host === available) return response(config, { items: ['owned-A'], host });
    if (host === PRIMARY) {
      // Spoofed MIME must not let a portal become successful product data.
      return response(config, '<!-- country gateway --><?xml version="1.0"?><html>blocked</html>');
    }
    throw failed(config);
  };
  const signature = h.recovery.getNetworkRouteSignature(wifi);
  const foreground = async () => {
    h.controller.onNetworkState({ ...wifi, details: { ...wifi.details } });
    h.controller.onAppState('background');
    h.controller.onAppState('active');
    await jest.advanceTimersByTimeAsync(200);
    await microtasks();
  };
  const read = async (expected: string) => {
    const before = attempts.length;
    const result = await h.transport.default.get('/products');
    expect(result.data).toEqual({ items: ['owned-A'], host: expected });
    expect(attempts.length - before).toBeLessThanOrEqual(3);
    expect(h.transport.captureAuthSession().token).toBe(BEARER);
    expect(h.lease.isCurrent()).toBe(true);
    expect(h.expired).not.toHaveBeenCalled();
  };
  try {
    await read(PRIMARY);
    available = RESERVE; // VPN enabled; Wi-Fi/IP/NetInfo values stay identical.
    await foreground();
    const firstSwitch = attempts.length;
    await read(RESERVE);
    expect(attempts.slice(firstSwitch).map((attempt) => attempt.host)).toContain(PRIMARY);
    expect(h.health).toHaveBeenCalled();

    available = THIRD; // Country changes while the app remains active.
    h.controller.onNetworkState(wifi);
    await read(THIRD); // Real failure alone must find the next working path.

    available = PRIMARY; // VPN disabled, then app foregrounded.
    await foreground();
    await read(PRIMARY);
    expect(h.recovery.getNetworkRouteSignature(wifi)).toBe(signature);
    expect(attempts.every((attempt) => attempt.authorization === `Bearer ${BEARER}`)).toBe(true);
    expect(attempts.every((attempt) => attempt.method === 'get')).toBe(true);
  } finally {
    h.dispose();
  }
});

it('an ambiguous unkeyed POST is dispatched once during a same-signature route change; later reads recover', async () => {
  const h = setup();
  let available = PRIMARY;
  let rejectPost: (() => void) | undefined;
  let activePosts = 0;
  let maxActivePosts = 0;
  const attempts: Attempt[] = [];
  h.transport.default.defaults.adapter = async (config) => {
    const host = String(config.baseURL);
    attempts.push({ host, method: String(config.method), authorization: config.headers.get('Authorization') });
    if (config.method === 'post') {
      activePosts += 1;
      maxActivePosts = Math.max(maxActivePosts, activePosts);
      try {
        return await new Promise<AxiosResponse>((_resolve, reject) => {
          rejectPost = () => reject(failed(config));
        });
      } finally {
        activePosts -= 1;
      }
    }
    if (host === available) return response(config, { host });
    throw failed(config);
  };
  try {
    await h.transport.default.get('/products');
    const post = h.transport.default.post('/expenses', { amount: 100 }).catch((error: unknown) => error);
    await microtasks();
    expect(rejectPost).toBeDefined();
    available = RESERVE;
    h.controller.onNetworkState(wifi);
    h.controller.onAppState('background');
    h.controller.onAppState('active');
    await jest.advanceTimersByTimeAsync(200);
    if (!rejectPost) throw new Error('POST was not dispatched');
    rejectPost();
    expect(await post).toMatchObject({ code: 'ECONNABORTED' });
    await jest.advanceTimersByTimeAsync(200);
    const recovered = await h.transport.default.get('/products');
    expect(recovered.data).toEqual({ host: RESERVE });
    expect(attempts.filter((attempt) => attempt.method === 'post')).toHaveLength(1);
    expect(maxActivePosts).toBe(1);
    expect(activePosts).toBe(0);
    expect(h.lease.isCurrent()).toBe(true);
    expect(h.transport.captureAuthSession().token).toBe(BEARER);
    expect(h.expired).not.toHaveBeenCalled();
  } finally {
    h.dispose();
  }
});
