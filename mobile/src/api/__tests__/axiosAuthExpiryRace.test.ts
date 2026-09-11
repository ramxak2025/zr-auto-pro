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

// ── ОКНО ПЕРЕВЫПУСКА СЕССИИ (мгновенная смена филиала, 167) ────────────────
// Перевыпуск гасит старый токен на сервере РАНЬШЕ, чем новый доедет до
// телефона. Всё, что улетело с прежним bearer'ом, приходит в эту щель с 401
// «Токен отозван». Если бы такой 401 гасил сессию, руководителя выкидывало бы
// на экран входа ровно в тот момент, когда он просто переключал филиал.
describe('axios — 401 в окне перевыпуска сессии', () => {
  beforeEach(() => {
    jest.resetModules();
    mockStorageRemoveItem.mockClear();
  });

  it('чужой 401 внутри окна НЕ гасит сессию, но остаётся ошибкой запроса', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('../axios') as typeof import('../axios');
    mod.setAuthToken('token-A');
    const expired = jest.fn();
    const unsubscribe = mod.onAuthExpired(expired);
    mod.default.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
      throw http401(config);
    };

    const close = mod.beginSessionReissueWindow();
    await expect(mod.default.get('/points/summary')).rejects.toMatchObject({ response: { status: 401 } });
    expect(expired).not.toHaveBeenCalled();

    // Окно закрыто — обычный разбор 401 вернулся, мёртвый токен снова заметен.
    close();
    await expect(mod.default.get('/points/summary')).rejects.toMatchObject({ response: { status: 401 } });
    expect(expired).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('401 самого перевыпуска гасит сессию даже внутри окна — это «войдите заново»', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('../axios') as typeof import('../axios');
    mod.setAuthToken('token-A');
    const expired = jest.fn();
    const unsubscribe = mod.onAuthExpired(expired);
    mod.default.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
      throw http401(config);
    };

    const close = mod.beginSessionReissueWindow();
    await expect(mod.default.post('/auth/switch-point', { pointId: 'p1' })).rejects.toMatchObject({
      response: { status: 401 },
    });
    expect(expired).toHaveBeenCalledTimes(1);
    close();
    unsubscribe();
  });

  it('повторное закрытие окна идемпотентно — счётчик не уходит в минус', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('../axios') as typeof import('../axios');
    mod.setAuthToken('token-A');
    const expired = jest.fn();
    const unsubscribe = mod.onAuthExpired(expired);
    mod.default.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
      throw http401(config);
    };

    const closeOuter = mod.beginSessionReissueWindow();
    const closeInner = mod.beginSessionReissueWindow();
    closeInner();
    closeInner();
    // Внешнее окно ещё открыто: повторные закрытия внутреннего не должны были
    // его «досрочно» снять.
    await expect(mod.default.get('/auth/me')).rejects.toMatchObject({ response: { status: 401 } });
    expect(expired).not.toHaveBeenCalled();

    closeOuter();
    await expect(mod.default.get('/auth/me')).rejects.toMatchObject({ response: { status: 401 } });
    expect(expired).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
