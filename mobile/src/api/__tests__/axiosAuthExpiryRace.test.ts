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

  it('recipient acknowledgement cannot inherit login B before async interceptors start', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = jest.requireActual('../axios') as typeof import('../axios');
    mod.setAuthToken('token-A');
    const bound = mod.createSessionBoundClient('token-A');
    const adapter = jest.fn(async (config: InternalAxiosRequestConfig) => ok(config));
    mod.default.defaults.adapter = adapter;
    const ack = bound.post('/salary/penalties/fine-A/viewed');
    // Deliberately switch synchronously, before axios runs its promise chain.
    mod.setAuthToken('token-B');
    await expect(ack).rejects.toMatchObject({ code: 'ERR_CANCELED' });
    expect(adapter).not.toHaveBeenCalled();
    await expect(bound.post('/salary/penalties/fine-A/viewed')).rejects.toMatchObject({ code: 'ERR_CANCELED' });
    expect(adapter).not.toHaveBeenCalled();
  });

  it('recipient acknowledgement uses its own bearer while the session is current', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = jest.requireActual('../axios') as typeof import('../axios');
    mod.setAuthToken('token-A');
    const bound = mod.createSessionBoundClient('token-A');
    const adapter = jest.fn(async (config: InternalAxiosRequestConfig) => ok(config));
    mod.default.defaults.adapter = adapter;
    await bound.post('/salary/penalties/fine-A/viewed');
    expect(adapter.mock.calls[0][0].headers.Authorization).toBe('Bearer token-A');
    mod.setAuthToken(null);
    expect(mod.isCurrentAuthToken('token-A')).toBe(false);
  });

  it('current 401 notifies synchronously and never owns persistent token cleanup', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = jest.requireActual('../axios') as typeof import('../axios');
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
    const mod = jest.requireActual('../axios') as typeof import('../axios');
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
    const mod = jest.requireActual('../axios') as typeof import('../axios');
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
    const mod = jest.requireActual('../axios') as typeof import('../axios');
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

// ── 401, который НЕ должен гасить сессию ───────────────────────────────────
// Sentry: auth_expired_forced_logout, 229 событий у 15 человек. Разбор показал
// две дыры, каждая из которых выкидывает человека из ЖИВОЙ сессии.
function http401Html(config: InternalAxiosRequestConfig): Error {
  return Object.assign(new Error('401'), {
    isAxiosError: true,
    code: 'ERR_BAD_REQUEST',
    config,
    response: {
      status: 401,
      statusText: 'Unauthorized',
      data: '<!doctype html><html><body>Portal</body></html>',
      headers: { 'content-type': 'text/html; charset=utf-8' },
      config,
    },
  });
}

describe('axios — 401, который не означает конец сессии', () => {
  beforeEach(() => {
    jest.resetModules();
    mockStorageRemoveItem.mockClear();
  });

  it('401 с HTML в теле НЕ гасит сессию — это подмена от узла оператора, а не наш сервер', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = jest.requireActual('../axios') as typeof import('../axios');
    mod.setAuthToken('token-A');
    const expired = jest.fn();
    const unsubscribe = mod.onAuthExpired(expired);
    mod.default.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
      throw http401Html(config);
    };

    await expect(mod.default.get('/checks/deferred-reminders')).rejects.toMatchObject({
      response: { status: 401 },
    });
    expect(expired).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('401 самого /auth/refresh НЕ гасит сессию — решение за вызывающим', async () => {
    // Сервер продлевает «сначала погасить, потом выдать», поэтому 401 на
    // обмене — штатная гонка. Раньше он шёл в общий убийца сессии, и одна
    // потерянная ротация выкидывала человека окончательно.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = jest.requireActual('../axios') as typeof import('../axios');
    mod.setAuthToken('token-A');
    const expired = jest.fn();
    const unsubscribe = mod.onAuthExpired(expired);
    mod.default.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
      throw http401(config);
    };

    await expect(mod.default.post('/auth/refresh')).rejects.toMatchObject({ response: { status: 401 } });
    expect(expired).not.toHaveBeenCalled();

    // Контроль: обычный запрос с тем же мёртвым токеном сессию гасит — иначе
    // мы бы починили симптом ценой залипшей навсегда сессии.
    await expect(mod.default.get('/auth/me')).rejects.toMatchObject({ response: { status: 401 } });
    expect(expired).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('разлогин несёт диагностику: причина, хост, статус и путь без id', async () => {
    // Без этого три с половиной месяца событий не могли назвать причину.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = jest.requireActual('../axios') as typeof import('../axios');
    mod.setAuthToken('token-A');
    const seen: { reason?: string; details?: Record<string, unknown> }[] = [];
    const unsubscribe = mod.onAuthExpired((reason, details) => {
      seen.push({ reason, details: details as unknown as Record<string, unknown> });
    });
    mod.default.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
      throw Object.assign(new Error('401'), {
        isAxiosError: true,
        code: 'ERR_BAD_REQUEST',
        config,
        response: {
          status: 401,
          statusText: 'Unauthorized',
          data: { message: 'Токен отозван' },
          headers: {},
          config,
        },
      });
    };

    await expect(mod.default.get('/schedule/7a1d3f2e-0000-4000-a000-0000000000aa')).rejects.toMatchObject({
      response: { status: 401 },
    });
    expect(seen).toHaveLength(1);
    expect(seen[0].details).toMatchObject({ status: 401, serverMessage: 'Токен отозван' });
    // uuid в пути схлопнут — иначе тег в Sentry уникален на каждое событие.
    expect(seen[0].details?.path).toBe('/schedule/:id');
    expect(typeof seen[0].details?.host).toBe('string');
    unsubscribe();
  });
});

describe('saved account epochs and anonymous second-stage Add', () => {
  beforeEach(() => jest.resetModules());
  it('same JWT A→B→A never revives a deferred dispatch or response lease', async () => {
    const mod = jest.requireActual('../axios') as typeof import('../axios');
    mod.setAuthToken('same-A', true);
    const lease = mod.captureAuthSession();
    const bound = mod.createSessionBoundClient('same-A');
    const adapter = jest.fn(async (cfg: InternalAxiosRequestConfig) => ok(cfg));
    mod.default.defaults.adapter = adapter;
    const pending = bound.post('/supplier-test');
    mod.setAuthToken('B', true);
    mod.setAuthToken('same-A', true);
    await expect(pending).rejects.toMatchObject({ code: 'ERR_CANCELED' });
    expect(adapter).not.toHaveBeenCalled();
    expect(lease.isCurrent()).toBe(false);
  });
  it('failed anonymous select-point Add 401 cannot expire A or carry A bearer', async () => {
    const mod = jest.requireActual('../axios') as typeof import('../axios');
    mod.setAuthToken('A', true);
    const expired = jest.fn();
    const off = mod.onAuthExpired(expired);
    const lease = mod.captureAuthSession();
    const adapter = jest.fn(async (cfg: InternalAxiosRequestConfig) => {
      throw http401(cfg);
    });
    mod.default.defaults.adapter = adapter;
    await expect(
      mod.default.post('/auth/select-point', { selectToken: 'one-use-B', pointId: 'B-point' }),
    ).rejects.toMatchObject({ response: { status: 401 } });
    expect(adapter.mock.calls[0][0].headers.Authorization).toBeUndefined();
    expect(expired).not.toHaveBeenCalled();
    expect(lease.isCurrent()).toBe(true);
    expect(mod.captureAuthSession().token).toBe('A');
    off();
  });
  it('captured A cleanup finishes after B without expiry or network-success side effects', async () => {
    const mod = jest.requireActual('../axios') as typeof import('../axios');
    mod.setAuthToken('A', true);
    const cleanup = mod.createCapturedAuthRequester('A');
    mod.setAuthToken('B', true);
    const success = jest.fn();
    const expired = jest.fn();
    const off = mod.onRequestSucceeded(success);
    const offExpired = mod.onAuthExpired(expired);
    const adapter = jest.fn(async (cfg: InternalAxiosRequestConfig) => ok(cfg));
    mod.default.defaults.adapter = adapter;
    await expect(cleanup({ method: 'delete', url: '/push/token', data: { token: 'device' } })).resolves.toMatchObject({
      status: 200,
    });
    expect(adapter.mock.calls[0][0].headers.Authorization).toBe('Bearer A');
    expect(success).not.toHaveBeenCalled();
    expect(expired).not.toHaveBeenCalled();
    expect(mod.captureAuthSession().token).toBe('B');
    off();
    offExpired();
  });
});
