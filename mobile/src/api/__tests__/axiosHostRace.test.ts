/**
 * Тесты happy-eyeballs (FIX B) — приложение подключается со скоростью САМОГО
 * БЫСТРОГО доступного хоста, а не «тормозим ~15 с на primary → потом failover».
 *
 * Два механизма (оба ЗА `API_HOSTS.length > 1` — single-host байт-в-байт как был):
 *   1) loginAcrossHosts — POST /auth/login на ВСЕ хосты параллельно, первый
 *      успех выигрывает; проигравшие игнорируются; детерминированный 4xx
 *      (неверный пароль) reject'ится СРАЗУ, не дожидаясь медленного хоста;
 *   2) raceInitialActiveHost — GET /health по всем хостам параллельно на старте,
 *      активной базой становится первый ответивший (валидно, не HTML).
 *
 * КРИТИЧНО (безопасность записи): дублируется ТОЛЬКО идемпотентное. Пины ниже
 * доказывают, что loginAcrossHosts ходит исключительно на /auth/login, а
 * обычная мутация НЕ задваивается (её ретрай-правило не тронуто). Гонка хостов
 * пробит только GET /health.
 *
 * Герметично: мокируем expo-constants + AsyncStorage (единственные runtime-
 * зависимости axios.ts), сеть логина — через adapter axios, /health — через
 * подменённый global.fetch. Модуль перезагружается на каждый тест (module
 * state: activeBaseUrl, кольцо хостов, launchHostRaceStarted).
 */
import type { AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from 'axios';

const PRIMARY = 'https://primary.test/api';
const RESERVE = 'https://reserve.test/api';

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

type Step = 'net' | 'abort' | 'html' | 'ok' | 'hang' | 400 | 401;

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
  if (step === 'hang') return new Promise<AxiosResponse>(() => {}); // никогда не резолвится
  if (step === 'net') throw netError(config, 'ERR_NETWORK');
  if (step === 'abort') throw netError(config, 'ECONNABORTED');
  throw httpError(config, step);
}

/** Адаптер по baseURL — дочерние запросы гонки уходят конкурентно на разные хосты. */
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

describe('loginAcrossHosts — happy-eyeballs логин', () => {
  beforeEach(() => {
    // adopt(резерв) на успехе запускает setInterval пробы возврата primary —
    // фейковые таймеры не дают ему повиснуть открытым хендлом. Микротаски живые.
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('кольцо >1: primary падает сетью, резерв отвечает → первый успех = резерв, adopt резерва, по одному запросу на хост', async () => {
    const mod = loadApiModule([RESERVE]);
    const calls = keyedAdapter(mod.default, { [PRIMARY]: 'net', [RESERVE]: 'ok' });

    const res = await mod.loginAcrossHosts({ phone: '+79990000000', password: 'x' });

    expect(res.status).toBe(200);
    expect(res.data).toEqual({ token: 'jwt', user: { id: 1 } });
    // Ровно по одному запросу на каждый хост — параллельный веер, без рекурсии.
    expect(calls).toHaveLength(2);
    const bases = calls.map((c) => c.baseURL).sort();
    expect(bases).toEqual([PRIMARY, RESERVE].sort());
    // Все запросы — исключительно на /auth/login (не на другой роут).
    expect(calls.every((c) => c.url === '/auth/login')).toBe(true);
    // Победитель-резерв запоминается активной базой.
    expect(mod.getActiveApiBaseUrl()).toBe(RESERVE);
  });

  it('оба хоста доступны → резолвится успехом (2 запроса, победитель — активная база кольца)', async () => {
    const mod = loadApiModule([RESERVE]);
    const calls = keyedAdapter(mod.default, { [PRIMARY]: 'ok', [RESERVE]: 'ok' });

    const res = await mod.loginAcrossHosts({ phone: '+79990000000', password: 'x' });

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect([PRIMARY, RESERVE]).toContain(mod.getActiveApiBaseUrl());
  });

  it('неверный пароль: primary → 401 быстро, резерв висит → reject 401 СРАЗУ (не ждём медленный хост)', async () => {
    const mod = loadApiModule([RESERVE]);
    const calls = keyedAdapter(mod.default, { [PRIMARY]: 401, [RESERVE]: 'hang' });

    // Если бы гонка ждала «зависший» резерв — тест повис бы. Быстрый reject на
    // детерминированном 4xx доказывает reject-fast.
    await expect(mod.loginAcrossHosts({ phone: '+79990000000', password: 'плохой' })).rejects.toMatchObject({
      response: { status: 401 },
    });
    // Оба дочерних запроса были отправлены и оба — на /auth/login.
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.url === '/auth/login')).toBe(true);
  });

  it('оба захода упали сетью → reject честной сетевой ошибкой, ровно 2 запроса (не цикл)', async () => {
    const mod = loadApiModule([RESERVE]);
    const calls = keyedAdapter(mod.default, { [PRIMARY]: 'net', [RESERVE]: 'net' });

    await expect(mod.loginAcrossHosts({ phone: '+79990000000', password: 'x' })).rejects.toThrow(
      /Нет соединения с сервером/,
    );
    expect(calls).toHaveLength(2);
    expect(mod.getActiveApiBaseUrl()).toBe(PRIMARY);
  });

  it('кольцо из одного хоста: НЕ гоняется — ровно как раньше (сетевой сбой → один прозрачный login-retry на тот же хост)', async () => {
    const mod = loadApiModule([]);
    const calls = scriptAdapter(mod.default, ['net', 'ok']);

    const res = await mod.loginAcrossHosts({ phone: '+79990000000', password: 'x' });

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(calls[0].baseURL).toBe(PRIMARY);
    expect(calls[1].baseURL).toBe(PRIMARY);
  });

  it('кольцо из одного хоста, неверный пароль → один запрос, reject 401 (без ретрая)', async () => {
    const mod = loadApiModule([]);
    const calls = scriptAdapter(mod.default, [401]);

    await expect(mod.loginAcrossHosts({ phone: '+79990000000', password: 'плохой' })).rejects.toMatchObject({
      response: { status: 401 },
    });
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
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;

  function mockHealth(reachable: (url: string) => boolean, opts?: { html?: (url: string) => boolean }): void {
    fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!reachable(url)) throw new Error('network');
      const html = opts?.html?.(url) ?? false;
      return {
        ok: true,
        text: async () => (html ? '<!doctype html><html></html>' : '{"status":"ok"}'),
        headers: { get: (_: string) => (html ? 'text/html' : 'application/json') },
      } as unknown as Response;
    });
    global.fetch = fetchMock as unknown as typeof fetch;
  }

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
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

  it('никто не ответил → активная база не трогается (никакого форс-офлайна)', async () => {
    mockHealth(() => false);
    const mod = loadApiModule([RESERVE]);

    mod.raceInitialActiveHost();
    await flushMicrotasks();

    expect(mod.getActiveApiBaseUrl()).toBe(PRIMARY);
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

    // Ровно по одной пробе на хост за весь процесс (2 хоста = 2 fetch, не 4).
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
