import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios';

const mockStorageRemoveItem = jest.fn(async (_key: string) => undefined);

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { apiUrl: 'https://primary.test/api', apiFallbackUrls: [] } } },
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: (key: string) => mockStorageRemoveItem(key),
    getAllKeys: async () => [],
    multiGet: async () => [],
    multiRemove: async () => undefined,
  },
}));

function http401(config: InternalAxiosRequestConfig): Error {
  return Object.assign(new Error('401'), {
    isAxiosError: true,
    code: 'ERR_BAD_REQUEST',
    config,
    response: { status: 401, statusText: 'Unauthorized', data: {}, headers: {}, config },
  });
}

function ok(config: InternalAxiosRequestConfig): AxiosResponse {
  return { status: 200, statusText: 'OK', data: { ok: true }, headers: {}, config };
}

describe('axios auth-expiry epoch', () => {
  beforeEach(() => {
    jest.resetModules();
    mockStorageRemoveItem.mockClear();
  });

  it('current 401 notifies synchronously and never owns persistent token cleanup', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('../axios') as typeof import('../axios');
    mod.setAuthToken('token-A');
    const expired = jest.fn(() => {
      // Model a new login committed synchronously by the auth listener.
      mod.setAuthToken('token-B');
    });
    const unsubscribe = mod.onAuthExpired(expired);
    let call = 0;
    const sent: InternalAxiosRequestConfig[] = [];
    mod.default.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
      sent.push(config);
      call += 1;
      if (call === 1) throw http401(config);
      return ok(config);
    };

    await expect(mod.default.get('/auth/me')).rejects.toMatchObject({ response: { status: 401 } });
    expect(expired).toHaveBeenCalledTimes(1);
    expect(mockStorageRemoveItem).not.toHaveBeenCalledWith('token');
    expect(mockStorageRemoveItem).not.toHaveBeenCalledWith('user');

    await expect(mod.default.get('/auth/me')).resolves.toMatchObject({ status: 200 });
    expect(sent[1].headers.Authorization).toBe('Bearer token-B');
    unsubscribe();
  });
});
