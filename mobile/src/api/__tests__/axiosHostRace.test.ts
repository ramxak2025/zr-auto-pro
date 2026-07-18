/**
 * Тесты happy-eyeballs (FIX B) — приложение подключается со скоростью САМОГО
 * БЫСТРОГО доступного хоста, а не «тормозим ~15 с на primary → потом failover».
 *
 * Два механизма:
 *   1) loginAcrossHosts — один POST /auth/login на выбранный здоровый хост;
 *      следующий пробуется только после route/proxy-сбоя. Ответы credentials,
 *      validation и rate-limit авторитетны и не размножаются;
 *   2) raceInitialActiveHost — preferred получает короткий head-start, затем
 *      резервы гоняются параллельно; принимается только НАШ backend.
 *
 * КРИТИЧНО (безопасность записи): дублируется ТОЛЬКО идемпотентное. Пины ниже
 * доказывают, что loginAcrossHosts ходит исключительно на /auth/login, а
 * обычная мутация НЕ задваивается (её ретрай-правило не тронуто). Гонка хостов
 * пробит только GET /health.
 *
 * Герметично: мокируем expo-constants + AsyncStorage (единственные runtime-
 * зависимости axios.ts), сеть логина — через adapter axios, /health — через
 * подменённый global.fetch. Модуль перезагружается на каждый тест (module
 * state: activeBaseUrl, кольцо хостов, initialization/reselect generation).
 */
import type { AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from 'axios';

const PRIMARY = 'https://primary.test/api';
const RESERVE = 'https://reserve.test/api';
const THIRD = 'https://third.test/api';
const realFetch = global.fetch;

let mockApiFallbackUrls: string[] = [];
let mockStoredBase: string | null = null;
let mockStorageGetItem: (key: string) => Promise<string | null> = async (key) =>
  key === 'active_api_base_v1' ? mockStoredBase : null;
const mockStorageSetItem = jest.fn(async (_key: string, _value: string) => undefined);
const mockStorageRemoveItem = jest.fn(async (_key: string) => undefined);

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return { extra: { apiUrl: 'https://primary.test/api', apiFallbackUrls: mockApiFallbackUrls } };
    },
  },
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: (key: string) => mockStorageGetItem(key),
    setItem: (key: string, value: string) => mockStorageSetItem(key, value),
    removeItem: (key: string) => mockStorageRemoveItem(key),
    getAllKeys: async () => [],
    multiGet: async () => [],
    multiRemove: async () => undefined,
  },
}));

type AxiosModule = typeof import('../axios');

/** Свежий инстанс модуля с заданным кольцом резервов (module state с нуля). */
function loadApiModule(fallbacks: string[]): AxiosModule {
  mockApiFallbackUrls = fallbacks;
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('../axios') as AxiosModule;
}

type Step = 'net' | 'net-no-code' | 'abort' | 'html' | 'html403' | 'ok' | 400 | 401 | 403 | 404 | 429 | 502 | 504;

function okResponse(
  config: InternalAxiosRequestConfig,
  data: unknown,
  contentType = 'application/json',
): AxiosResponse {
  return { data, status: 200, statusText: 'OK', headers: { 'content-type': contentType }, config };
}

function netError(config: InternalAxiosRequestConfig, code: 'ERR_NETWORK' | 'ECONNABORTED'): Error {
  return Object.assign(new Error(code === 'ERR_NETWORK' ? 'Network Error' : 'timeout of 15000ms exceeded'), {
    isAxiosError: true,
    code,
    config,
  });
}

function httpError(config: InternalAxiosRequestConfig, status: number): Error {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    code: 'ERR_BAD_REQUEST',
    config,
    response: { status, statusText: 'ERR', data: { message: 'ошибка' }, headers: {}, config },
  });
}

function playStep(config: InternalAxiosRequestConfig, step: Step): Promise<AxiosResponse> | AxiosResponse {
  if (step === 'ok') return okResponse(config, { token: 'jwt', user: { id: 1 } });
  if (step === 'html') return okResponse(config, '<!doctype html><html>портал оператора</html>', 'text/html');
  if (step === 'html403') {
    const error = httpError(config, 403) as Error & { response: AxiosResponse };
    error.response.data = '<!doctype html><html>blocked route</html>';
    error.response.headers = { 'content-type': 'text/html' };
    throw error;
  }
  if (step === 'net') throw netError(config, 'ERR_NETWORK');
  if (step === 'net-no-code') {
    throw Object.assign(new Error('Network request failed'), { isAxiosError: true, config });
  }
  if (step === 'abort') throw netError(config, 'ECONNABORTED');
  throw httpError(config, step);
}

/** Адаптер по baseURL — проверяет точный порядок последовательных попыток. */
function keyedAdapter(api: AxiosInstance, byBase: Record<string, Step>): InternalAxiosRequestConfig[] {
  const calls: InternalAxiosRequestConfig[] = [];
  api.defaults.adapter = async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => (
    calls.push(config),
    playStep(config, byBase[String(config.baseURL)])
  );
  return calls;
}

/** Скриптованный (последовательный) адаптер — для кольца из одного хоста. */
function scriptAdapter(api: AxiosInstance, script: Step[]): InternalAxiosRequestConfig[] {
  const calls: InternalAxiosRequestConfig[] = [];
  api.defaults.adapter = async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
    calls.push(config);
    return playStep(config, script[Math.min(calls.length - 1, script.length - 1)]);
  };
  return calls;
}

async function flushMicrotasks(times = 20): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

describe('loginAcrossHosts — rate-limit-safe route failover', () => {
  beforeEach(() => {
    // adopt(резерв) на успехе запускает setInterval пробы возврата primary —
    // фейковые таймеры не дают ему повиснуть открытым хендлом. Микротаски живые.
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
    mockStoredBase = null;
    mockStorageGetItem = async (key) => (key === 'active_api_base_v1' ? mockStoredBase : null);
    mockStorageSetItem.mockClear();
    mockStorageRemoveItem.mockClear();
    global.fetch = jest.fn(async () => ({
      ok: true,
      text: async () => '{"status":"ok"}',
      headers: { get: () => 'application/json' },
    })) as unknown as typeof fetch;
  });
  afterEach(() => {
    jest.useRealTimers();
    global.fetch = realFetch;
  });

  it('primary падает сетью, резерв отвечает → последовательно принимает и запоминает резерв', async () => {
    const mod = loadApiModule([RESERVE]);
    const calls = keyedAdapter(mod.default, { [PRIMARY]: 'net', [RESERVE]: 'ok' });

    const res = await mod.loginAcrossHosts({ phone: '+79990000000', password: 'x' });

    expect(res.status).toBe(200);
    expect(res.data).toEqual({ token: 'jwt', user: { id: 1 } });
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c.baseURL)).toEqual([PRIMARY, RESERVE]);
    expect(calls.every((c) => c.url === '/auth/login')).toBe(true);
    expect(mod.getActiveApiBaseUrl()).toBe(RESERVE);
  });

  it('native transport error без code всё равно продолжает login на резерве', async () => {
    const mod = loadApiModule([RESERVE]);
    const calls = keyedAdapter(mod.default, { [PRIMARY]: 'net-no-code', [RESERVE]: 'ok' });

    await expect(mod.loginAcrossHosts({ phone: '+79990000000', password: 'x' })).resolves.toMatchObject({ status: 200 });

    expect(calls.map((c) => c.baseURL)).toEqual([PRIMARY, RESERVE]);
    expect(mod.getActiveApiBaseUrl()).toBe(RESERVE);
  });

  it('активный H2 падает → кольцо продолжает с H3, а не возвращается сразу к H1', async () => {
    mockStoredBase = RESERVE;
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      if (!String(input).includes('reserve.test')) throw new Error('unreachable');
      return {
        ok: true,
        text: async () => '{"status":"ok"}',
        headers: { get: () => 'application/json' },
      } as unknown as Response;
    }) as unknown as typeof fetch;
    const mod = loadApiModule([RESERVE, THIRD]);
    const calls = keyedAdapter(mod.default, { [PRIMARY]: 'ok', [RESERVE]: 'net', [THIRD]: 'ok' });

    await expect(mod.loginAcrossHosts({ phone: '+79990000000', password: 'x' })).resolves.toMatchObject({ status: 200 });

    expect(calls.map((c) => c.baseURL)).toEqual([RESERVE, THIRD]);
    expect(mod.getActiveApiBaseUrl()).toBe(THIRD);
  });

  it('активный H3 падает → кольцо замыкается на H1', async () => {
    mockStoredBase = THIRD;
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      if (!String(input).includes('third.test')) throw new Error('unreachable');
      return {
        ok: true,
        text: async () => '{"status":"ok"}',
        headers: { get: () => 'application/json' },
      } as unknown as Response;
    }) as unknown as typeof fetch;
    const mod = loadApiModule([RESERVE, THIRD]);
    const calls = keyedAdapter(mod.default, { [PRIMARY]: 'ok', [RESERVE]: 'net', [THIRD]: 'net' });

    await expect(mod.loginAcrossHosts({ phone: '+79990000000', password: 'x' })).resolves.toMatchObject({ status: 200 });

    expect(calls.map((c) => c.baseURL)).toEqual([THIRD, PRIMARY]);
    expect(mod.getActiveApiBaseUrl()).toBe(PRIMARY);
  });

  it('нормальный вход делает ровно ОДИН POST, хотя доступны все три алиаса', async () => {
    const mod = loadApiModule([RESERVE, THIRD]);
    const calls = keyedAdapter(mod.default, { [PRIMARY]: 'ok', [RESERVE]: 'ok', [THIRD]: 'ok' });

    const res = await mod.loginAcrossHosts({ phone: '+79990000000', password: 'x' });

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].baseURL).toBe(PRIMARY);
  });

  it('404 маршрута пробует следующий хост, но 429 авторитетно останавливает кольцо', async () => {
    const mod = loadApiModule([RESERVE, THIRD]);
    const calls = keyedAdapter(mod.default, { [PRIMARY]: 404, [RESERVE]: 429, [THIRD]: 'ok' });

    await expect(mod.loginAcrossHosts({ phone: '+79990000000', password: 'x' })).rejects.toMatchObject({
      response: { status: 429 },
    });
    expect(calls.map((c) => c.baseURL)).toEqual([PRIMARY, RESERVE]);
  });

  it('403 на login — отказ WAF/маршрута и безопасно пробует следующий алиас', async () => {
    const mod = loadApiModule([RESERVE, THIRD]);
    const calls = keyedAdapter(mod.default, { [PRIMARY]: 403, [RESERVE]: 'ok', [THIRD]: 'ok' });

    await expect(mod.loginAcrossHosts({ phone: '+79990000000', password: 'x' })).resolves.toMatchObject({ status: 200 });
    expect(calls.map((c) => c.baseURL)).toEqual([PRIMARY, RESERVE]);
  });

  it('401 логина не очищает существующую сессию и не пробует другие алиасы', async () => {
    const mod = loadApiModule([RESERVE]);
    const expired = jest.fn();
    mod.setAuthToken('existing-token');
    mod.onAuthExpired(expired);
    const calls = keyedAdapter(mod.default, { [PRIMARY]: 401, [RESERVE]: 'ok' });

    await expect(mod.loginAcrossHosts({ phone: '+79990000000', password: 'x' })).rejects.toMatchObject({
      response: { status: 401 },
    });

    expect(calls).toHaveLength(1);
    expect(expired).not.toHaveBeenCalled();
    expect(mockStorageRemoveItem).not.toHaveBeenCalledWith('token');
    expect(mockStorageRemoveItem).not.toHaveBeenCalledWith('user');
  });

  it('поздний 401 со старым bearer не может стереть уже установленный новый токен', async () => {
    const mod = loadApiModule([RESERVE]);
    const expired = jest.fn();
    let rejectOld!: () => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    mod.setAuthToken('token-A');
    mod.onAuthExpired(expired);
    mod.default.defaults.adapter = (config: InternalAxiosRequestConfig) => {
      markStarted();
      return new Promise<AxiosResponse>((_resolve, reject) => {
        rejectOld = () => reject(httpError(config, 401));
      });
    };

    const oldRequest = mod.default.get('/auth/me');
    await started;
    mod.setAuthToken('token-B');
    rejectOld();

    await expect(oldRequest).rejects.toMatchObject({ response: { status: 401 } });
    expect(expired).not.toHaveBeenCalled();
    expect(mockStorageRemoveItem).not.toHaveBeenCalledWith('token');
    expect(mockStorageRemoveItem).not.toHaveBeenCalledWith('user');
  });

  it('поздний успешный ответ token A не попадает в caller уже после установки token B', async () => {
    const mod = loadApiModule([RESERVE]);
    const succeeded = jest.fn();
    let resolveOld!: () => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    mod.setAuthToken('token-A');
    mod.onRequestSucceeded(succeeded);
    mod.default.defaults.adapter = (config: InternalAxiosRequestConfig) => {
      markStarted();
      return new Promise<AxiosResponse>((resolve) => {
        resolveOld = () => resolve(okResponse(config, { tenant: 'A' }));
      });
    };

    const oldRequest = mod.default.get('/auth/me');
    await started;
    mod.setAuthToken('token-B');
    resolveOld();

    await expect(oldRequest).rejects.toMatchObject({ code: 'ERR_CANCELED' });
    expect(succeeded).not.toHaveBeenCalled();
  });

  it('route retry старого запроса не пересекает границу token A → token B', async () => {
    const mod = loadApiModule([RESERVE]);
    const calls: InternalAxiosRequestConfig[] = [];
    let rejectOldRoute!: () => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    mod.setAuthToken('token-A');
    mod.default.defaults.adapter = (config: InternalAxiosRequestConfig) => {
      calls.push(config);
      if (config.baseURL === PRIMARY) {
        markStarted();
        return new Promise<AxiosResponse>((_resolve, reject) => {
          rejectOldRoute = () => reject(netError(config, 'ERR_NETWORK'));
        });
      }
      return Promise.resolve(okResponse(config, { tenant: 'B' }));
    };

    const oldRequest = mod.default.get('/products');
    await started;
    mod.setAuthToken('token-B');
    rejectOldRoute();

    await expect(oldRequest).rejects.toMatchObject({ code: 'ERR_CANCELED' });
    expect(calls).toHaveLength(1);
  });

  it('401 текущего bearer по-прежнему завершает действительно истёкшую сессию', async () => {
    const mod = loadApiModule([RESERVE]);
    const expired = jest.fn();
    mod.setAuthToken('expired-token');
    mod.onAuthExpired(expired);
    const calls = keyedAdapter(mod.default, { [PRIMARY]: 401, [RESERVE]: 401 });

    await expect(mod.default.get('/auth/me')).rejects.toMatchObject({ response: { status: 401 } });

    expect(calls).toHaveLength(1);
    expect(expired).toHaveBeenCalledTimes(1);
    expect(mockStorageRemoveItem).not.toHaveBeenCalledWith('token');
    expect(mockStorageRemoveItem).not.toHaveBeenCalledWith('user');
  });

  it('новая сессия не наследует старое 2-секундное окно подавления 401', async () => {
    const mod = loadApiModule([]);
    const expired = jest.fn();
    mod.onAuthExpired(expired);
    const calls = scriptAdapter(mod.default, [401, 401]);

    mod.setAuthToken('token-A');
    await expect(mod.default.get('/auth/me')).rejects.toMatchObject({ response: { status: 401 } });
    mod.setAuthToken('token-B');
    await expect(mod.default.get('/auth/me')).rejects.toMatchObject({ response: { status: 401 } });

    expect(calls).toHaveLength(2);
    expect(expired).toHaveBeenCalledTimes(2);
  });

  it('transport → HTML-403 → успех: обходит все три route-class отказа', async () => {
    const mod = loadApiModule([RESERVE, THIRD]);
    const calls = keyedAdapter(mod.default, { [PRIMARY]: 'net', [RESERVE]: 'html403', [THIRD]: 'ok' });

    await expect(mod.loginAcrossHosts({ phone: '+79990000000', password: 'x' })).resolves.toMatchObject({ status: 200 });
    expect(calls.map((c) => c.baseURL)).toEqual([PRIMARY, RESERVE, THIRD]);
    expect(mod.getActiveApiBaseUrl()).toBe(THIRD);
  });

  it('502 → 504 → успех третьего: proxy-отказы проходят всё кольцо', async () => {
    const mod = loadApiModule([RESERVE, THIRD]);
    const calls = keyedAdapter(mod.default, { [PRIMARY]: 502, [RESERVE]: 504, [THIRD]: 'ok' });

    await expect(mod.loginAcrossHosts({ phone: '+79990000000', password: 'x' })).resolves.toMatchObject({ status: 200 });
    expect(calls.map((c) => c.baseURL)).toEqual([PRIMARY, RESERVE, THIRD]);
    expect(mod.getActiveApiBaseUrl()).toBe(THIRD);
  });

  it('все три transport-отказа дают одну recovery-сигнализацию и не зацикливаются', async () => {
    const mod = loadApiModule([RESERVE, THIRD]);
    const failed = jest.fn();
    mod.onNetworkClassFailure(failed);
    const calls = keyedAdapter(mod.default, { [PRIMARY]: 'net', [RESERVE]: 'net', [THIRD]: 'net' });

    await expect(mod.loginAcrossHosts({ phone: '+79990000000', password: 'x' })).rejects.toThrow(
      /Нет соединения с сервером/,
    );
    expect(calls.map((c) => c.baseURL)).toEqual([PRIMARY, RESERVE, THIRD]);
    expect(failed).toHaveBeenCalledTimes(1);
  });

  it('общий login budget обрывает зависший native request, а не ждёт 3×timeout', async () => {
    const mod = loadApiModule([RESERVE, THIRD]);
    const failed = jest.fn();
    const calls: InternalAxiosRequestConfig[] = [];
    mod.onNetworkClassFailure(failed);
    mod.default.defaults.adapter = (config: InternalAxiosRequestConfig) => {
      calls.push(config);
      return new Promise<AxiosResponse>((_resolve, reject) => {
        config.signal?.addEventListener?.('abort', () => {
          reject(
            Object.assign(new Error('canceled'), {
              isAxiosError: true,
              code: 'ERR_CANCELED',
              __CANCEL__: true,
              config,
            }),
          );
        });
      });
    };

    const login = mod.loginAcrossHosts({ phone: '+79990000000', password: 'x' });
    await flushMicrotasks();
    expect(calls).toHaveLength(1);
    jest.advanceTimersByTime(30_000);
    await flushMicrotasks();

    await expect(login).rejects.toThrow(/общий таймаут входа/);
    expect(calls).toHaveLength(1);
    expect(failed).toHaveBeenCalledTimes(1);
  });

  it('H1/H2 blackhole не съедают бюджет H3: третий login реально отправляется до 30с', async () => {
    const mod = loadApiModule([RESERVE, THIRD]);
    const calls: InternalAxiosRequestConfig[] = [];
    mod.default.defaults.adapter = (config: InternalAxiosRequestConfig) => {
      calls.push(config);
      if (calls.length === 3) return Promise.resolve(okResponse(config, { token: 'jwt', user: { id: 1 } }));
      return new Promise<AxiosResponse>((_resolve, reject) => {
        setTimeout(() => reject(netError(config, 'ECONNABORTED')), config.timeout ?? 0);
      });
    };

    const login = mod.loginAcrossHosts({ phone: '+79990000000', password: 'x' });
    await flushMicrotasks();
    expect(calls).toHaveLength(1);
    const h1Budget = calls[0].timeout ?? 0;
    jest.advanceTimersByTime(h1Budget);
    await flushMicrotasks();
    expect(calls).toHaveLength(2);
    const h2Budget = calls[1].timeout ?? 0;
    jest.advanceTimersByTime(h2Budget);
    await flushMicrotasks();

    await expect(login).resolves.toMatchObject({ status: 200 });
    expect(calls.map((c) => c.baseURL)).toEqual([PRIMARY, RESERVE, THIRD]);
    expect(h1Budget + h2Budget).toBeLessThan(30_000);
  });

  it('VPN/reselect во время зависшего H1 направляет следующую login-попытку сразу на новый H3', async () => {
    const mod = loadApiModule([RESERVE, THIRD]);
    const calls: InternalAxiosRequestConfig[] = [];
    let rejectH1!: () => void;
    let markH1Started!: () => void;
    const h1Started = new Promise<void>((resolve) => {
      markH1Started = resolve;
    });
    mod.default.defaults.adapter = (config: InternalAxiosRequestConfig) => {
      calls.push(config);
      if (config.baseURL === PRIMARY) {
        markH1Started();
        return new Promise<AxiosResponse>((_resolve, reject) => {
          rejectH1 = () => reject(netError(config, 'ERR_NETWORK'));
        });
      }
      return Promise.resolve(okResponse(config, { token: 'jwt', user: { id: 1 } }));
    };

    const login = mod.loginAcrossHosts({ phone: '+79990000000', password: 'x' });
    await h1Started;
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      if (!String(input).includes('third.test')) throw new Error('old route unavailable');
      return {
        ok: true,
        text: async () => '{"status":"ok"}',
        headers: { get: () => 'application/json' },
      } as unknown as Response;
    }) as unknown as typeof fetch;
    const reselection = mod.reselectApiHost(true);
    jest.advanceTimersByTime(150);
    await reselection;
    expect(mod.getActiveApiBaseUrl()).toBe(THIRD);

    rejectH1();
    await expect(login).resolves.toMatchObject({ status: 200 });
    expect(calls.map((c) => c.baseURL)).toEqual([PRIMARY, THIRD]);
  });

  it('зависшее чтение token из native storage не может навсегда повесить login', async () => {
    mockStorageGetItem = (key) =>
      key === 'token' ? new Promise<string | null>(() => {}) : Promise.resolve(null);
    const mod = loadApiModule([]);
    const calls = scriptAdapter(mod.default, ['ok']);

    const login = mod.loginAcrossHosts({ phone: '+79990000000', password: 'x' });
    await flushMicrotasks();
    expect(calls).toHaveLength(0);
    jest.advanceTimersByTime(750);
    await flushMicrotasks();

    await expect(login).resolves.toMatchObject({ status: 200 });
    expect(calls).toHaveLength(1);
  });

  it('mutation, созданная до смены сессии и зависшая на token read, не получает bearer B', async () => {
    let releaseToken!: (value: string | null) => void;
    mockStorageGetItem = (key) =>
      key === 'token'
        ? new Promise((resolve) => {
            releaseToken = resolve;
          })
        : Promise.resolve(null);
    const mod = loadApiModule([]);
    const calls = scriptAdapter(mod.default, ['ok']);

    const oldMutation = mod.default.post('/checks', { tenantPayload: 'A' });
    await flushMicrotasks();
    expect(calls).toHaveLength(0);

    mod.setAuthToken('token-B');
    releaseToken('token-A');

    await expect(oldMutation).rejects.toMatchObject({ code: 'ERR_CANCELED' });
    expect(calls).toHaveLength(0);
  });

  it.each([
    ['logout tombstone', null, 'stale-token-A', undefined],
    ['new envelope token', 'token-B', 'stale-token-A', 'Bearer token-B'],
  ])('authoritative auth envelope (%s) wins over a stale legacy token', async (_label, envelopeToken, legacy, expected) => {
    mockStorageGetItem = async (key) => {
      if (key === 'auth_session_v1') {
        return JSON.stringify({ v: 1, generation: 7, token: envelopeToken, user: null, impersonating: false });
      }
      if (key === 'token') return legacy;
      return null;
    };
    const mod = loadApiModule([]);
    const calls = scriptAdapter(mod.default, ['ok']);

    await mod.default.get('/products');

    expect(calls).toHaveLength(1);
    expect(calls[0].headers.Authorization).toBe(expected);
  });

  it('logout cleanup dispatches only captured token A after local token changed to B', async () => {
    const mod = loadApiModule([]);
    mod.setAuthToken('token-A');
    const calls = scriptAdapter(mod.default, ['ok']);

    const cleanup = mod.requestWithCapturedAuth('token-A', { method: 'delete', url: '/push/token' });
    mod.setAuthToken('token-B');

    // The old cleanup is allowed onto the wire with A, but its stale success
    // is canceled before it can publish into the new session.
    await expect(cleanup).rejects.toMatchObject({ code: 'ERR_CANCELED' });
    expect(calls).toHaveLength(1);
    expect(calls[0].headers.Authorization).toBe('Bearer token-A');
  });

  it('sequential logout cleanup keeps epoch/token A even when its second request is created after login B', async () => {
    const mod = loadApiModule([]);
    mod.setAuthToken('token-A');
    const cleanupAsA = mod.createCapturedAuthRequester('token-A');
    const calls = scriptAdapter(mod.default, ['ok']);

    mod.setAuthToken(null);
    mod.setAuthToken('token-B');
    const lateSecondCleanup = cleanupAsA({ method: 'post', url: '/auth/logout' });

    await expect(lateSecondCleanup).rejects.toMatchObject({ code: 'ERR_CANCELED' });
    expect(calls).toHaveLength(1);
    expect(calls[0].headers.Authorization).toBe('Bearer token-A');
  });

  it('кольцо из одного хоста: transport-ошибка = одна автоматическая попытка', async () => {
    const mod = loadApiModule([]);
    const calls = scriptAdapter(mod.default, ['net', 'ok']);

    await expect(mod.loginAcrossHosts({ phone: '+79990000000', password: 'x' })).rejects.toThrow(
      /Нет соединения с сервером/,
    );
    expect(calls).toHaveLength(1);
  });

  it('БЕЗОПАСНОСТЬ: обычная мутация (POST /expenses) НЕ гоняется и НЕ задваивается даже при кольце >1', async () => {
    const mod = loadApiModule([RESERVE]);
    const calls = keyedAdapter(mod.default, { [PRIMARY]: 'net', [RESERVE]: 'ok' });

    // Идёт обычным путём (не loginAcrossHosts): сетевой сбой мутации не ретраится
    // на другой хост — правило «мутации только при ERR_HTML_RESPONSE» не тронуто.
    await expect(mod.default.post('/expenses', { amount: 100 })).rejects.toThrow(/Нет соединения с сервером/);
    expect(calls).toHaveLength(1);
    expect(calls[0].baseURL).toBe(PRIMARY);
  });
});

describe('raceInitialActiveHost — стартовая гонка /health', () => {
  let fetchMock: jest.Mock;

  function mockHealth(
    reachable: (url: string) => boolean,
    opts?: { html?: (url: string) => boolean; body?: (url: string) => string },
  ): void {
    fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!reachable(url)) throw new Error('network');
      const html = opts?.html?.(url) ?? false;
      return {
        ok: true,
        text: async () => (html ? '<!doctype html><html></html>' : (opts?.body?.(url) ?? '{"status":"ok"}')),
        headers: { get: (_: string) => (html ? 'text/html' : 'application/json') },
      } as unknown as Response;
    });
    global.fetch = fetchMock as unknown as typeof fetch;
  }

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
    mockStoredBase = null;
    mockStorageGetItem = async (key) => (key === 'active_api_base_v1' ? mockStoredBase : null);
    mockStorageSetItem.mockClear();
    mockStorageRemoveItem.mockClear();
  });
  afterEach(() => {
    jest.useRealTimers();
    global.fetch = realFetch;
  });

  it('кольцо >1: primary недоступен, резерв отвечает валидно → активной базой становится резерв', async () => {
    mockHealth((url) => url.includes('reserve.test'));
    const mod = loadApiModule([RESERVE]);

    mod.raceInitialActiveHost();
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalled();
    expect(mod.getActiveApiBaseUrl()).toBe(RESERVE);
  });

  it('здоровый preferred получает head-start и не флапает на более быстрый gateway', async () => {
    const response = {
      ok: true,
      text: async () => '{"status":"ok"}',
      headers: { get: () => 'application/json' },
    } as unknown as Response;
    fetchMock = jest.fn((input: RequestInfo | URL) => {
      if (!String(input).includes('primary.test')) return Promise.resolve(response);
      return new Promise<Response>((resolve) => setTimeout(() => resolve(response), 300));
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const mod = loadApiModule([RESERVE, THIRD]);

    const ready = mod.ensureApiHostReady();
    await flushMicrotasks();
    jest.advanceTimersByTime(300);
    await flushMicrotasks();
    await ready;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mod.getActiveApiBaseUrl()).toBe(PRIMARY);
  });

  it('реальные cold-TLS пропорции сохраняют живой autexa.pw primary перед gateway', async () => {
    const response = {
      ok: true,
      text: async () => '{"status":"ok"}',
      headers: { get: () => 'application/json' },
    } as unknown as Response;
    fetchMock = jest.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('primary.test')) return new Promise<Response>((resolve) => setTimeout(() => resolve(response), 5_200));
      if (url.includes('third.test')) return new Promise<Response>((resolve) => setTimeout(() => resolve(response), 4_000));
      return new Promise<Response>((_resolve, reject) => setTimeout(() => reject(new Error('H2 blocked')), 8_000));
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const mod = loadApiModule([RESERVE, THIRD]);

    const ready = mod.ensureApiHostReady();
    await flushMicrotasks();
    jest.advanceTimersByTime(5_200);
    await flushMicrotasks();
    await ready;

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(mod.getActiveApiBaseUrl()).toBe(PRIMARY);
  });

  it('медленный 6-секундный cold TLS всё ещё считается живым, а не ложным outage', async () => {
    const response = {
      ok: true,
      text: async () => '{"status":"ok"}',
      headers: { get: () => 'application/json' },
    } as unknown as Response;
    fetchMock = jest.fn((input: RequestInfo | URL) => {
      if (!String(input).includes('primary.test')) return Promise.reject(new Error('reserve unavailable'));
      return new Promise<Response>((resolve) => setTimeout(() => resolve(response), 6_000));
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const mod = loadApiModule([RESERVE, THIRD]);

    const ready = mod.ensureApiHostReady();
    await flushMicrotasks();
    jest.advanceTimersByTime(6_000);
    await flushMicrotasks();
    await ready;

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(mod.getActiveApiBaseUrl()).toBe(PRIMARY);
  });

  it('HTML-200 (captive-portal) НЕ считается ответом — активная база не переезжает на него', async () => {
    // primary недоступен, резерв «доступен», но отдаёт HTML-заглушку (200).
    // Сломанный страж адоптировал бы резерв; рабочий — отвергает, база остаётся
    // primary (никто валидно не ответил).
    mockHealth((url) => url.includes('reserve.test'), { html: () => true });
    const mod = loadApiModule([RESERVE]);

    mod.raceInitialActiveHost();
    await flushMicrotasks();

    expect(mod.getActiveApiBaseUrl()).toBe(PRIMARY);
  });

  it('посторонний JSON-200 без health-маркера тоже не считается нашим API', async () => {
    mockHealth((url) => url.includes('reserve.test'), { body: () => '{"message":"proxy ok"}' });
    const mod = loadApiModule([RESERVE]);

    await mod.ensureApiHostReady();

    expect(mod.getActiveApiBaseUrl()).toBe(PRIMARY);
  });

  it('никто не ответил → активная база не трогается (никакого форс-офлайна)', async () => {
    mockHealth(() => false);
    const mod = loadApiModule([RESERVE]);

    mod.raceInitialActiveHost();
    await flushMicrotasks();

    expect(mod.getActiveApiBaseUrl()).toBe(PRIMARY);
  });

  it('зависший native fetch не может навсегда заблокировать initialization barrier', async () => {
    global.fetch = jest.fn(() => new Promise<Response>(() => {})) as unknown as typeof fetch;
    const mod = loadApiModule([RESERVE, THIRD]);

    const ready = mod.ensureApiHostReady();
    await flushMicrotasks();
    jest.advanceTimersByTime(1_500); // launch reserves after the sticky-host lead
    await flushMicrotasks();
    jest.advanceTimersByTime(8_000); // hard deadlines resolve, even though fetch never does
    await flushMicrotasks();

    await expect(ready).resolves.toBeUndefined();
    expect(mod.getActiveApiBaseUrl()).toBe(PRIMARY);
  });

  it('зависшее чтение сохранённого host hint пропускается по hard deadline', async () => {
    mockStorageGetItem = (key) =>
      key === 'active_api_base_v1' ? new Promise<string | null>(() => {}) : Promise.resolve(null);
    mockHealth((url) => url.includes('reserve.test'));
    const mod = loadApiModule([RESERVE, THIRD]);

    const ready = mod.ensureApiHostReady();
    await flushMicrotasks();
    expect(fetchMock).not.toHaveBeenCalled();
    jest.advanceTimersByTime(750);
    await flushMicrotasks();

    await expect(ready).resolves.toBeUndefined();
    expect(mod.getActiveApiBaseUrl()).toBe(RESERVE);
  });

  it('кольцо из одного хоста: ИНЕРТНА — /health не пробится вовсе', async () => {
    mockHealth(() => true);
    const mod = loadApiModule([]);

    mod.raceInitialActiveHost();
    await flushMicrotasks();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mod.getActiveApiBaseUrl()).toBe(PRIMARY);
  });

  it('идемпотентна: второй вызов — no-op (не удваивает пробы)', async () => {
    mockHealth(() => true);
    const mod = loadApiModule([RESERVE]);

    mod.raceInitialActiveHost();
    mod.raceInitialActiveHost();
    await flushMicrotasks();

    // Preferred ответил в head-start: один fetch за весь процесс, не два race.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('сохранённый хост — только hint: недоступный H2 не принимается, выбирается здоровый H3', async () => {
    mockStoredBase = RESERVE;
    mockHealth((url) => url.includes('third.test'));
    const mod = loadApiModule([RESERVE, THIRD]);

    await mod.ensureApiHostReady();

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(
      expect.arrayContaining([`${RESERVE}/health`, `${THIRD}/health`]),
    );
    expect(mod.getActiveApiBaseUrl()).toBe(THIRD);
  });

  it('удалённый из конфига старый сохранённый host очищается и не покидает текущее кольцо', async () => {
    mockStoredBase = 'https://removed-old.test/api';
    mockHealth((url) => url.includes('primary.test'));
    const mod = loadApiModule([RESERVE, THIRD]);

    await mod.ensureApiHostReady();
    await flushMicrotasks();

    expect(mod.getActiveApiBaseUrl()).toBe(PRIMARY);
    expect(mockStorageRemoveItem).toHaveBeenCalledWith('active_api_base_v1');
    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes('removed-old.test'))).toBe(true);
  });

  it('request interceptor ждёт единый initialization barrier до выбора baseURL', async () => {
    let releaseStored!: (value: string | null) => void;
    mockStorageGetItem = (key) =>
      key === 'active_api_base_v1'
        ? new Promise((resolve) => {
            releaseStored = resolve;
          })
        : Promise.resolve(null);
    mockHealth((url) => url.includes('reserve.test'));
    const mod = loadApiModule([RESERVE, THIRD]);
    const calls = scriptAdapter(mod.default, ['ok']);

    const request = mod.default.get('/products');
    await flushMicrotasks();
    expect(calls).toHaveLength(0);

    releaseStored(RESERVE);
    await request;
    expect(calls).toHaveLength(1);
    expect(calls[0].baseURL).toBe(RESERVE);
  });

  it('request interceptor ждёт и повторный selector после смены сети', async () => {
    mockHealth(() => true);
    const mod = loadApiModule([RESERVE, THIRD]);
    await mod.ensureApiHostReady();
    const calls = scriptAdapter(mod.default, ['ok']);
    let releaseRoute!: (response: Response) => void;
    global.fetch = jest.fn(
      () =>
        new Promise<Response>((resolve) => {
          releaseRoute = resolve;
        }),
    ) as unknown as typeof fetch;

    const selection = mod.reselectApiHost();
    jest.advanceTimersByTime(150);
    await flushMicrotasks();
    const request = mod.default.get('/products');
    await flushMicrotasks();
    expect(calls).toHaveLength(0);

    releaseRoute({
      ok: true,
      text: async () => '{"status":"ok"}',
      headers: { get: () => 'application/json' },
    } as unknown as Response);
    await selection;
    await request;
    expect(calls).toHaveLength(1);
  });

  it('request token A, задержанный route barrier, не превращается в request token B', async () => {
    mockHealth(() => true);
    const mod = loadApiModule([RESERVE, THIRD]);
    await mod.ensureApiHostReady();
    mod.setAuthToken('token-A');
    const calls = scriptAdapter(mod.default, ['ok']);
    let releaseRoute!: (response: Response) => void;
    global.fetch = jest.fn(
      () =>
        new Promise<Response>((resolve) => {
          releaseRoute = resolve;
        }),
    ) as unknown as typeof fetch;

    const selection = mod.reselectApiHost();
    jest.advanceTimersByTime(150);
    await flushMicrotasks();
    const request = mod.default.get('/products');
    await flushMicrotasks();
    expect(calls).toHaveLength(0);

    mod.setAuthToken('token-B');
    releaseRoute({
      ok: true,
      text: async () => '{"status":"ok"}',
      headers: { get: () => 'application/json' },
    } as unknown as Response);
    await selection;

    await expect(request).rejects.toMatchObject({ code: 'ERR_CANCELED' });
    expect(calls).toHaveLength(0);
  });

  it('поздний AsyncStorage не может перезаписать более новый network reselect', async () => {
    let releaseStored!: (value: string | null) => void;
    mockStorageGetItem = (key) =>
      key === 'active_api_base_v1'
        ? new Promise((resolve) => {
            releaseStored = resolve;
          })
        : Promise.resolve(null);
    mockHealth((url) => url.includes('third.test'));
    const mod = loadApiModule([RESERVE, THIRD]);

    const initial = mod.ensureApiHostReady();
    const reselection = mod.reselectApiHost();
    jest.advanceTimersByTime(150);
    await reselection;
    releaseStored(RESERVE);
    await initial;

    expect(mod.getActiveApiBaseUrl()).toBe(THIRD);
  });

  it('успех запроса со старого route epoch не перетирает победителя новой сети', async () => {
    mockHealth(() => true);
    const mod = loadApiModule([RESERVE, THIRD]);
    await mod.ensureApiHostReady();
    let resolveOldReserve!: (response: AxiosResponse) => void;
    let oldReserveConfig!: InternalAxiosRequestConfig;
    let markOldReserveStarted!: () => void;
    const oldReserveStarted = new Promise<void>((resolve) => {
      markOldReserveStarted = resolve;
    });
    mod.default.defaults.adapter = async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
      if (config.baseURL === PRIMARY) throw netError(config, 'ERR_NETWORK');
      if (config.baseURL === RESERVE) {
        oldReserveConfig = config;
        markOldReserveStarted();
        return new Promise<AxiosResponse>((resolve) => {
          resolveOldReserve = resolve;
        });
      }
      return okResponse(config, { ok: true });
    };

    const oldRequest = mod.default.get('/products');
    await oldReserveStarted;
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      if (!String(input).includes('third.test')) throw new Error('new route rejects old hosts');
      return {
        ok: true,
        text: async () => '{"status":"ok"}',
        headers: { get: () => 'application/json' },
      } as unknown as Response;
    }) as unknown as typeof fetch;
    const selection = mod.reselectApiHost();
    jest.advanceTimersByTime(150);
    await selection;
    expect(mod.getActiveApiBaseUrl()).toBe(THIRD);

    resolveOldReserve(okResponse(oldReserveConfig, { ok: true }));
    await oldRequest;
    expect(mod.getActiveApiBaseUrl()).toBe(THIRD);
  });

  it('reselect схлопывает burst, а следующий вызов реально проверяет sticky-active', async () => {
    mockHealth((url) => url.includes('reserve.test'));
    const mod = loadApiModule([RESERVE, THIRD]);

    const first = mod.reselectApiHost();
    const duplicate = mod.reselectApiHost();
    expect(duplicate).toBe(first);
    expect(fetchMock).not.toHaveBeenCalled();
    jest.advanceTimersByTime(150);
    await first;
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const second = mod.reselectApiHost();
    jest.advanceTimersByTime(150);
    await second;
    // После первого выбора RESERVE здоровый sticky-host отвечает в head-start,
    // поэтому второй проход обоснованно не будит ещё два резерва.
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('успешный whole-ring reselect публикует route-ready, полный отказ — нет', async () => {
    mockHealth((url) => url.includes('reserve.test'));
    const mod = loadApiModule([RESERVE, THIRD]);
    const ready = jest.fn();
    const unsubscribe = mod.onApiRouteReady(ready);

    const healthy = mod.reselectApiHost();
    jest.advanceTimersByTime(150);
    await healthy;
    expect(ready).toHaveBeenCalledTimes(1);

    mockHealth(() => false);
    const failed = mod.reselectApiHost();
    jest.advanceTimersByTime(150);
    await failed;
    expect(ready).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('две смены сети во время проб обе отменяют stale pass; третья не теряется', async () => {
    fetchMock = jest.fn((input: RequestInfo | URL) => {
      const callNumber = fetchMock.mock.calls.length;
      if (callNumber <= 6) return new Promise<Response>(() => {});
      if (String(input).includes('third.test')) {
        return Promise.resolve({
          ok: true,
          text: async () => '{"status":"ok"}',
          headers: { get: () => 'application/json' },
        } as unknown as Response);
      }
      return Promise.reject(new Error('old route unavailable'));
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const mod = loadApiModule([RESERVE, THIRD]);

    const selection = mod.reselectApiHost();
    jest.advanceTimersByTime(150);
    await flushMicrotasks();
    jest.advanceTimersByTime(1_500);
    await flushMicrotasks();
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // A real Wi-Fi/LTE/VPN transition aborts the stale pass and starts a new
    // one on the same bounded public barrier. Ordinary recovery calls only
    // join it and cannot manufacture extra passes.
    expect(mod.reselectApiHost(true)).toBe(selection);
    for (let i = 0; i < 9; i++) expect(mod.reselectApiHost()).toBe(selection);
    await flushMicrotasks();
    jest.advanceTimersByTime(1_500);
    await flushMicrotasks();
    expect(fetchMock).toHaveBeenCalledTimes(6);

    // A third route epoch while the follow-up is live used to be discarded.
    // It now aborts pass #2 and pass #3 selects the latest reachable H3.
    expect(mod.reselectApiHost(true)).toBe(selection);
    await flushMicrotasks();

    await expect(selection).resolves.toBe(THIRD);
    expect(fetchMock).toHaveBeenCalledTimes(9);
    expect(mod.getActiveApiBaseUrl()).toBe(THIRD);
  });
});
