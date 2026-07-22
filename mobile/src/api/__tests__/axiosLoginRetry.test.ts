/**
 * Тесты границы failover в общем axios-интерсепторе.
 *
 * Контракт:
 *   1) прямой POST /auth/login и остальные мутации никогда не ретраятся;
 *      безопасным последовательным входом владеет только loginAcrossHosts;
 *   2) ответ сервера (401 / 400) также не ретраится;
 *   3) GET/HEAD/OPTIONS обходят всё трёххостовое кольцо.
 *
 * Герметично: мокируем ЕДИНСТВЕННЫЕ runtime-зависимости axios.ts
 * (expo-constants, AsyncStorage), сетевой слой подменяем adapter'ом axios —
 * реальный интерсепторный конвейер прогоняется целиком под node jest env.
 * Модуль перезагружается на каждый тест (module state: activeBaseUrl, кольцо
 * хостов из мокнутого конфига).
 */
import type { AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from 'axios';

const PRIMARY = 'https://primary.test/api';
const RESERVE = 'https://reserve.test/api';
const THIRD = 'https://third.test/api';
const realFetch = global.fetch;

// Переменная читается фабрикой мока ЛЕНИВО (getter) — каждый reload модуля
// axios.ts видит актуальное кольцо. Префикс `mock` обязателен для hoisted
// jest.mock-фабрик.
let mockApiFallbackUrls: string[] = [];

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
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
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

type Step = 'net' | 'abort' | 'html' | 'html403' | 'ok' | 400 | 401 | 403 | 408 | 421 | 451 | 502 | 503 | 504;

function okResponse(
  config: InternalAxiosRequestConfig,
  data: unknown,
  contentType = 'application/json',
): AxiosResponse {
  return { data, status: 200, statusText: 'OK', headers: { 'content-type': contentType }, config };
}

function netError(config: InternalAxiosRequestConfig, code: 'ERR_NETWORK' | 'ECONNABORTED'): Error {
  return Object.assign(new Error(code === 'ERR_NETWORK' ? 'Network Error' : 'timeout of 12000ms exceeded'), {
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

/**
 * Скриптованный сетевой слой: i-й вызов адаптера играет i-й шаг сценария
 * (лишние вызовы повторяют последний шаг — их отлавливают ассерты на
 * количество). Возвращает лог конфигов всех реально ушедших «в сеть» попыток.
 */
function scriptAdapter(api: AxiosInstance, script: Step[]): InternalAxiosRequestConfig[] {
  const calls: InternalAxiosRequestConfig[] = [];
  api.defaults.adapter = async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
    calls.push(config);
    const step = script[Math.min(calls.length - 1, script.length - 1)];
    if (step === 'ok') return okResponse(config, { token: 'jwt', user: { id: 1 } });
    if (step === 'html') return okResponse(config, '<!doctype html><html>портал оператора</html>', 'text/html');
    if (step === 'html403') {
      const error = httpError(config, 403) as Error & { response: AxiosResponse };
      error.response.data = '<!doctype html><html>blocked by upstream</html>';
      error.response.headers = { 'content-type': 'text/html' };
      throw error;
    }
    if (step === 'net') throw netError(config, 'ERR_NETWORK');
    if (step === 'abort') throw netError(config, 'ECONNABORTED');
    throw httpError(config, step);
  };
  return calls;
}

describe('границы failover axios-интерсептора', () => {
  beforeEach(() => {
    // Успешный переезд на резерв запускает 10-минутную пробу возврата primary
    // (setInterval) — фейковые таймеры не дают ей повиснуть открытым хендлом.
    // Микротаски (await / промисы моков) не фейкаем.
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
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

  it('прямой POST /auth/login при ERR_NETWORK не получает скрытый второй запрос', async () => {
    const mod = loadApiModule([RESERVE]);
    const calls = scriptAdapter(mod.default, ['net', 'ok']);

    await expect(mod.default.post('/auth/login', { phone: '+79990000000', password: 'x' })).rejects.toThrow(
      /Нет соединения с сервером/,
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].baseURL).toBe(PRIMARY);
  });

  it('прямой POST /auth/login при ECONNABORTED на одном хосте тоже не дублируется', async () => {
    const mod = loadApiModule([]);
    const calls = scriptAdapter(mod.default, ['abort', 'ok']);

    await expect(mod.default.post('/auth/login', { phone: '+79990000000', password: 'x' })).rejects.toThrow(
      /Нет соединения с сервером/,
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].baseURL).toBe(PRIMARY);
  });

  it('прямой login при route failure не обходит кольцо', async () => {
    const mod = loadApiModule([RESERVE]);
    const calls = scriptAdapter(mod.default, ['net', 'net']);

    await expect(mod.default.post('/auth/login', { phone: '+79990000000', password: 'x' })).rejects.toThrow(
      /Нет соединения с сервером/,
    );
    expect(calls).toHaveLength(1);
  });

  it('401 НЕ ретраится — ответ сервера дошёл (неверный пароль ≠ обрыв сети)', async () => {
    const mod = loadApiModule([RESERVE]);
    const calls = scriptAdapter(mod.default, [401]);

    await expect(mod.default.post('/auth/login', { phone: '+79990000000', password: 'плохой' })).rejects.toMatchObject({
      response: { status: 401 },
    });
    expect(calls).toHaveLength(1);
  });

  it('400 НЕ ретраится — ответ сервера дошёл', async () => {
    const mod = loadApiModule([RESERVE]);
    const calls = scriptAdapter(mod.default, [400]);

    await expect(mod.default.post('/auth/login', {})).rejects.toMatchObject({ response: { status: 400 } });
    expect(calls).toHaveLength(1);
  });

  it('обычная мутация (POST /expenses) при ERR_NETWORK НЕ ретраится — правило для мутаций не тронуто', async () => {
    const mod = loadApiModule([RESERVE]);
    const calls = scriptAdapter(mod.default, ['net']);

    await expect(mod.default.post('/expenses', { amount: 100 })).rejects.toThrow(/Нет соединения с сервером/);
    expect(calls).toHaveLength(1);
  });

  it.each<Step>(['html', 502, 504])('мутация при %s не уходит на другой хост', async (failure) => {
    const mod = loadApiModule([RESERVE, THIRD]);
    const calls = scriptAdapter(mod.default, [failure, 'ok']);

    await expect(mod.default.post('/expenses', { amount: 100 })).rejects.toBeTruthy();
    expect(calls).toHaveLength(1);
    expect(calls[0].baseURL).toBe(PRIMARY);
  });

  it('ERR_HTML_RESPONSE на логине при одном хосте НЕ ретраится этим механизмом (та же статика ответит снова)', async () => {
    const mod = loadApiModule([]);
    const calls = scriptAdapter(mod.default, ['html']);

    await expect(mod.default.post('/auth/login', { phone: '+79990000000', password: 'x' })).rejects.toThrow(
      /Нет соединения с сервером/,
    );
    expect(calls).toHaveLength(1);
  });

  it('GET проходит все 3 хоста: transport → HTML → успех третьего', async () => {
    const mod = loadApiModule([RESERVE, THIRD]);
    const calls = scriptAdapter(mod.default, ['net', 'html', 'ok']);

    const res = await mod.default.get('/products');

    expect(res.status).toBe(200);
    expect(calls.map((call) => call.baseURL)).toEqual([PRIMARY, RESERVE, THIRD]);
    expect(mod.getActiveApiBaseUrl()).toBe(THIRD);
  });

  it('GET проходит 502 и 504 двух маршрутов и принимает третий', async () => {
    const mod = loadApiModule([RESERVE, THIRD]);
    const calls = scriptAdapter(mod.default, [502, 504, 'ok']);

    const res = await mod.default.get('/dashboard');

    expect(res.status).toBe(200);
    expect(calls.map((call) => call.baseURL)).toEqual([PRIMARY, RESERVE, THIRD]);
    expect(mod.getActiveApiBaseUrl()).toBe(THIRD);
  });

  it.each<Step>([408, 421, 451])('GET обходит route-status %s и принимает живой резерв', async (failure) => {
    const mod = loadApiModule([RESERVE]);
    const calls = scriptAdapter(mod.default, [failure, 'ok']);

    await expect(mod.default.get('/products')).resolves.toMatchObject({ status: 200 });
    expect(calls.map((call) => call.baseURL)).toEqual([PRIMARY, RESERVE]);
  });

  it('финальные 451 всех трёх путей дают один recovery event', async () => {
    const mod = loadApiModule([RESERVE, THIRD]);
    const failed = jest.fn();
    mod.onNetworkClassFailure(failed);
    const calls = scriptAdapter(mod.default, [451, 451, 451]);

    await expect(mod.default.get('/products')).rejects.toMatchObject({ response: { status: 451 } });
    expect(calls).toHaveLength(3);
    expect(failed).toHaveBeenCalledTimes(1);
  });

  it('GET с обычным JSON-403 авторитетен и не обходит permission-ответ', async () => {
    const mod = loadApiModule([RESERVE]);
    const calls = scriptAdapter(mod.default, [403, 'ok']);

    await expect(mod.default.get('/admin')).rejects.toMatchObject({ response: { status: 403 } });
    expect(calls).toHaveLength(1);
  });

  it('GET failover видит HTML даже когда captive/WAF вернул HTTP 403', async () => {
    const mod = loadApiModule([RESERVE]);
    const calls = scriptAdapter(mod.default, ['html403', 'ok']);

    const res = await mod.default.get('/products');

    expect(res.status).toBe(200);
    expect(calls.map((call) => call.baseURL)).toEqual([PRIMARY, RESERVE]);
    expect(mod.getActiveApiBaseUrl()).toBe(RESERVE);
  });

  it('после полного отказа circuit breaker не умножает каждый query retry на три хоста', async () => {
    const mod = loadApiModule([RESERVE, THIRD]);
    const calls = scriptAdapter(mod.default, ['net', 'net', 'net', 'net', 'net', 'net', 'ok']);

    await expect(mod.default.get('/products')).rejects.toThrow(/Нет соединения с сервером/);
    expect(calls).toHaveLength(3); // first logical request proves the whole ring dead

    await expect(mod.default.get('/products')).rejects.toThrow(/Нет соединения с сервером/);
    expect(calls).toHaveLength(4); // retry wave touches active only while circuits are open

    jest.advanceTimersByTime(8_000);
    const recovered = await mod.default.get('/products');
    expect(recovered.status).toBe(200);
    expect(calls.map((call) => call.baseURL)).toEqual([PRIMARY, RESERVE, THIRD, PRIMARY, PRIMARY, RESERVE, THIRD]);
    expect(mod.getActiveApiBaseUrl()).toBe(THIRD);
  });

  it('успешный network reselect очищает circuits старого маршрута', async () => {
    const mod = loadApiModule([RESERVE, THIRD]);
    const calls = scriptAdapter(mod.default, ['net', 'net', 'net', 'net', 'ok']);

    await expect(mod.default.get('/products')).rejects.toThrow(/Нет соединения с сервером/);
    expect(calls).toHaveLength(3);

    const reselection = mod.reselectApiHost(true);
    jest.advanceTimersByTime(150);
    await reselection;

    const recovered = await mod.default.get('/products');
    expect(recovered.status).toBe(200);
    // Circuits очищены → оба оставшихся хоста снова кандидаты и гоняются
    // ПАРАЛЛЕЛЬНО (M1, happy-eyeballs реального GET); побеждает первый
    // успешный — RESERVE (диспатчится раньше THIRD).
    expect(calls.map((call) => call.baseURL)).toEqual([PRIMARY, RESERVE, THIRD, PRIMARY, RESERVE, THIRD]);
    expect(mod.getActiveApiBaseUrl()).toBe(RESERVE);
  });
});
