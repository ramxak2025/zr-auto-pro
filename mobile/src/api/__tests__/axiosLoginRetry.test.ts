/**
 * Тесты одиночного прозрачного ретрая логина (сеть с потерей пакетов:
 * оператор рвёт соединение до того, как ответ сервера дошёл).
 *
 * Контракт (см. login-retry блок в ../axios.ts):
 *   1) POST /auth/login при ERR_NETWORK / ECONNABORTED повторяется РОВНО один
 *      раз: в кольце >1 хоста — на следующий хост (тот же механизм смены
 *      хоста, что failover, + adoptActiveBase на успехе); один хост — на тот
 *      же хост;
 *   2) ответ сервера (401 / 400) НЕ ретраится — у ошибки есть .response;
 *   3) остальные мутации (POST /expenses) при ERR_NETWORK НЕ ретраятся —
 *      правило «мутации только при ERR_HTML_RESPONSE» не тронуто;
 *   4) GET-failover продолжает работать как раньше (регрессионный пин).
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

type Step = 'net' | 'abort' | 'html' | 'ok' | 400 | 401;

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
    if (step === 'net') throw netError(config, 'ERR_NETWORK');
    if (step === 'abort') throw netError(config, 'ECONNABORTED');
    throw httpError(config, step);
  };
  return calls;
}

describe('одиночный прозрачный ретрай POST /auth/login', () => {
  beforeEach(() => {
    // Успешный переезд на резерв запускает 10-минутную пробу возврата primary
    // (setInterval) — фейковые таймеры не дают ей повиснуть открытым хендлом.
    // Микротаски (await / промисы моков) не фейкаем.
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('ERR_NETWORK, кольцо >1: ровно один повтор на СЛЕДУЮЩИЙ хост + адопция резерва (как failover)', async () => {
    const mod = loadApiModule([RESERVE]);
    const calls = scriptAdapter(mod.default, ['net', 'ok']);

    const res = await mod.default.post('/auth/login', { phone: '+79990000000', password: 'x' });

    expect(res.status).toBe(200);
    expect(res.data).toEqual({ token: 'jwt', user: { id: 1 } });
    expect(calls).toHaveLength(2);
    expect(calls[0].baseURL).toBe(PRIMARY);
    expect(calls[1].baseURL).toBe(RESERVE);
    expect(calls[1].url).toBe('/auth/login');
    // Успех на резерве запоминается активной базой — тот же механизм, что failover.
    expect(mod.getActiveApiBaseUrl()).toBe(RESERVE);
  });

  it('ECONNABORTED, один хост в кольце: ровно один повтор на ТОТ ЖЕ хост', async () => {
    const mod = loadApiModule([]);
    const calls = scriptAdapter(mod.default, ['abort', 'ok']);

    const res = await mod.default.post('/auth/login', { phone: '+79990000000', password: 'x' });

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(calls[0].baseURL).toBe(PRIMARY);
    expect(calls[1].baseURL).toBe(PRIMARY);
    expect(mod.getActiveApiBaseUrl()).toBe(PRIMARY);
  });

  it('оба захода упали сетью: РОВНО две попытки (не цикл), наружу — честная сетевая ошибка', async () => {
    const mod = loadApiModule([RESERVE]);
    const calls = scriptAdapter(mod.default, ['net', 'net']);

    await expect(mod.default.post('/auth/login', { phone: '+79990000000', password: 'x' })).rejects.toThrow(
      /Нет соединения с сервером/,
    );
    expect(calls).toHaveLength(2);
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

  it('ERR_HTML_RESPONSE на логине при одном хосте НЕ ретраится этим механизмом (та же статика ответит снова)', async () => {
    const mod = loadApiModule([]);
    const calls = scriptAdapter(mod.default, ['html']);

    await expect(mod.default.post('/auth/login', { phone: '+79990000000', password: 'x' })).rejects.toThrow(
      /Нет соединения с сервером/,
    );
    expect(calls).toHaveLength(1);
  });

  it('регрессия: GET-failover работает как раньше (сетевой отказ → следующий хост)', async () => {
    const mod = loadApiModule([RESERVE]);
    const calls = scriptAdapter(mod.default, ['net', 'ok']);

    const res = await mod.default.get('/products');

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(calls[0].baseURL).toBe(PRIMARY);
    expect(calls[1].baseURL).toBe(RESERVE);
    expect(mod.getActiveApiBaseUrl()).toBe(RESERVE);
  });
});
