/**
 * Тесты пакета «связь всё ещё отваливается» (жалоба владельца, 2026-07):
 *   C3 — короткий бюджет хопа: blackhole-хост не съедает 15с как connect-timeout;
 *   M1 — после провала активного хоста ОСТАВШИЕСЯ гоняются параллельно
 *        (happy-eyeballs реального GET: хост №2 кольца — тот же VDS-IP);
 *   C2а — мутация с clientRequestId (серверный дедуп, мигр. 111) безопасно
 *        ретраится ПОСЛЕДОВАТЕЛЬНО на следующий хост;
 *   C2б — мутация, гарантированно НЕ доставленная (DNS/refused), тоже ретраится;
 *   C2в — таймаут мутации после отправки НЕ ретраится, но переключает хост
 *        для СЛЕДУЮЩИХ запросов;
 *   C1 — гистерезис возврата на primary: N подряд успешных /health, не один;
 *   M4 — только что провалившийся активный хост не получает head-start;
 *   M2 — multipart-аплоады пиннятся мимо шлюза с лимитом тела ~3.5МБ;
 *   M3 — регистрация (публичный pre-auth POST) идёт через кольцо как login;
 *   C-3 — реальная смена network signature (reselectApiHost(true)): circuit'ы
 *        чистятся сразу, серия гистерезиса сбрасывается, гонка идёт ПОЛНЫМ
 *        кольцом primary-first — живой primary принимается немедленно;
 *   C-4 — база, активная в момент смены сети, «подозрительна»: обычная (без
 *        ключа) мутация на ней получает 8с вместо 15с, пока в кольце есть
 *        живая альтернатива; первый успех любого хоста снимает пометку.
 *   C.1 — доказательства ПРЕЖНЕГО поколения маршрута не управляют свежей
 *        сетью: сбой запроса/race-кандидата, ушедшего до смены сети, не
 *        открывает circuit заново; успех, ушедший до смены сети, не снимает
 *        suspect/circuit (гейт по cfg._routeGeneration === selectionGeneration,
 *        зеркально adoptRequestWinner).
 *
 * Герметично, тем же способом, что axiosHostRace.test.ts: мокируются
 * expo-constants + AsyncStorage, сеть — adapter axios, /health — global.fetch,
 * модуль перезагружается на каждый тест.
 */
import type { AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from 'axios';

const PRIMARY = 'https://primary.test/api';
const RESERVE = 'https://reserve.test/api';
const THIRD = 'https://third.test/api';
const GATEWAY = 'https://gw.apigw.yandexcloud.net/api';
const UUID = '0f2a3b4c-5d6e-4f70-8123-456789abcdef';
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

function loadApiModule(fallbacks: string[]): AxiosModule {
  mockApiFallbackUrls = fallbacks;
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('../axios') as AxiosModule;
}

type Step = 'net' | 'abort' | 'refused' | 'dns' | 'hang' | 'ok' | 409;

function okResponse(config: InternalAxiosRequestConfig, data: unknown = { ok: true }): AxiosResponse {
  return { data, status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, config };
}

function netError(
  config: InternalAxiosRequestConfig,
  code: string,
  message = code === 'ECONNABORTED' ? 'timeout of 5000ms exceeded' : 'Network Error',
): Error {
  return Object.assign(new Error(message), { isAxiosError: true, code, config });
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
  if (step === 'ok') return okResponse(config);
  if (step === 'hang') return new Promise<AxiosResponse>(() => {});
  if (step === 'net') throw netError(config, 'ERR_NETWORK');
  if (step === 'abort') throw netError(config, 'ECONNABORTED');
  if (step === 'refused') throw netError(config, 'ECONNREFUSED', 'connect ECONNREFUSED');
  if (step === 'dns') {
    throw netError(config, 'ERR_NETWORK', 'Unable to resolve host "primary.test": No address associated with hostname');
  }
  throw httpError(config, step);
}

/** Снимок конфига в момент dispatch (конфиг мутируется ретраем — алиасить нельзя). */
interface SentConfig {
  baseURL?: string;
  timeout?: number;
  method?: string;
  url?: string;
  data?: unknown;
}

/** Адаптер по baseURL — фиксирует порядок и снапшоты реальных попыток. */
function keyedAdapter(api: AxiosInstance, byBase: Record<string, Step>): SentConfig[] {
  const calls: SentConfig[] = [];
  api.defaults.adapter = async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => (
    calls.push({
      baseURL: config.baseURL,
      timeout: config.timeout,
      method: config.method,
      url: config.url,
      data: config.data,
    }),
    playStep(config, byBase[String(config.baseURL)])
  );
  return calls;
}

async function flushMicrotasks(times = 20): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

function mockHealth(reachable: (url: string) => boolean): jest.Mock {
  const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
    if (!reachable(String(input))) throw new Error('network');
    return {
      ok: true,
      text: async () => '{"status":"ok"}',
      headers: { get: () => 'application/json' },
    } as unknown as Response;
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
  mockStoredBase = null;
  mockStorageGetItem = async (key) => (key === 'active_api_base_v1' ? mockStoredBase : null);
  mockStorageSetItem.mockClear();
  mockStorageRemoveItem.mockClear();
  mockHealth(() => true);
});
afterEach(() => {
  jest.useRealTimers();
  global.fetch = realFetch;
});

describe('C3 — короткий бюджет хопа вместо 15с connect-timeout', () => {
  it('GET в кольце >1 получает хоповый бюджет 5с, пока остаются непройденные хосты', async () => {
    const mod = loadApiModule([RESERVE, THIRD]);
    const calls = keyedAdapter(mod.default, { [PRIMARY]: 'ok' });

    await mod.default.get('/products');

    expect(calls).toHaveLength(1);
    expect(calls[0].timeout).toBe(5_000);
  });

  it('кольцо из одного хоста ИНЕРТНО — полный 15с бюджет сохраняется', async () => {
    const mod = loadApiModule([]);
    const calls = keyedAdapter(mod.default, { [PRIMARY]: 'ok' });

    await mod.default.get('/products');

    expect(calls[0].timeout).toBe(15_000);
  });

  it('явный per-request timeout не перекрывается хоповым бюджетом', async () => {
    const mod = loadApiModule([RESERVE, THIRD]);
    const calls = keyedAdapter(mod.default, { [PRIMARY]: 'ok' });

    await mod.default.get('/reports/heavy', { timeout: 120_000 });

    expect(calls[0].timeout).toBe(120_000);
  });

  it('worst-case обход кольца ≈ 12с (5с хоп + 7с гонка), а не 3×15с', async () => {
    const mod = loadApiModule([RESERVE, THIRD]);
    const calls = keyedAdapter(mod.default, { [PRIMARY]: 'net', [RESERVE]: 'net', [THIRD]: 'net' });

    await expect(mod.default.get('/products')).rejects.toThrow(/Нет соединения с сервером/);

    expect(calls.map((c) => c.baseURL)).toEqual([PRIMARY, RESERVE, THIRD]);
    expect(calls[0].timeout).toBe(5_000);
    expect(calls[1].timeout).toBe(7_000);
    expect(calls[2].timeout).toBe(7_000);
    // Гонка параллельна: полный worst-case = хоп + гонка, укладывается в 12с.
    expect((calls[0].timeout ?? 0) + Math.max(calls[1].timeout ?? 0, calls[2].timeout ?? 0)).toBeLessThanOrEqual(
      12_000,
    );
  });
});

describe('M1 — параллельная гонка оставшихся хостов для реального GET', () => {
  it('зависший H2 (тот же IP, что primary) не блокирует успех H3', async () => {
    const mod = loadApiModule([RESERVE, THIRD]);
    const calls = keyedAdapter(mod.default, { [PRIMARY]: 'net', [RESERVE]: 'hang', [THIRD]: 'ok' });

    // Последовательный обход завис бы на H2 до таймаута; гонка резолвится H3
    // без единого advanceTimers — доказательство параллельности.
    const res = await mod.default.get('/products');

    expect(res.status).toBe(200);
    expect(calls.map((c) => c.baseURL)).toEqual([PRIMARY, RESERVE, THIRD]);
    expect(mod.getActiveApiBaseUrl()).toBe(THIRD);
  });

  it('все кандидаты упали → reject ошибкой первого по порядку кольца, один recovery event', async () => {
    const mod = loadApiModule([RESERVE, THIRD]);
    const failed = jest.fn();
    const calls = keyedAdapter(mod.default, { [PRIMARY]: 'net', [RESERVE]: 409, [THIRD]: 'net' });
    mod.onNetworkClassFailure(failed);

    await expect(mod.default.get('/products')).rejects.toMatchObject({ response: { status: 409 } });

    expect(calls.map((c) => c.baseURL)).toEqual([PRIMARY, RESERVE, THIRD]);
    expect(failed).toHaveBeenCalledTimes(0); // авторитетный 409 — не сетевой класс
  });
});

describe('C2а — мутация с clientRequestId безопасно ретраится последовательно', () => {
  it('POST /checks с ключом: transport-сбой → следующий хост, тот же payload', async () => {
    const mod = loadApiModule([RESERVE]);
    const calls = keyedAdapter(mod.default, { [PRIMARY]: 'abort', [RESERVE]: 'ok' });

    await expect(mod.default.post('/checks', { clientRequestId: UUID, total: 100 })).resolves.toMatchObject({
      status: 200,
    });

    expect(calls.map((c) => c.baseURL)).toEqual([PRIMARY, RESERVE]);
    expect(calls.every((c) => (c.method || '').toLowerCase() === 'post')).toBe(true);
    expect(String(calls[1].data)).toContain(UUID);
    expect(mod.getActiveApiBaseUrl()).toBe(RESERVE);
  });

  it('не-финальный хоп 5с, финальный хоп возвращает полный 15с бюджет', async () => {
    const mod = loadApiModule([RESERVE]);
    const calls = keyedAdapter(mod.default, { [PRIMARY]: 'abort', [RESERVE]: 'ok' });

    await mod.default.post('/checks', { clientRequestId: UUID });

    expect(calls[0].timeout).toBe(5_000);
    expect(calls[1].timeout).toBe(15_000);
  });

  it('мутация НИКОГДА не гоняется параллельно: строго один хост за раз', async () => {
    const mod = loadApiModule([RESERVE, THIRD]);
    const calls = keyedAdapter(mod.default, { [PRIMARY]: 'abort', [RESERVE]: 'ok', [THIRD]: 'ok' });

    await mod.default.post('/checks', { clientRequestId: UUID });

    expect(calls.map((c) => c.baseURL)).toEqual([PRIMARY, RESERVE]);
  });

  it('битый/пустой ключ дедупа не даёт права на ретрай (сервер его игнорирует)', async () => {
    const mod = loadApiModule([RESERVE]);
    const calls = keyedAdapter(mod.default, { [PRIMARY]: 'abort', [RESERVE]: 'ok' });

    await expect(mod.default.post('/checks', { clientRequestId: '' })).rejects.toThrow(/Нет соединения с сервером/);
    expect(calls).toHaveLength(1);
  });
});

describe('C2б — гарантированно недоставленная мутация ретраится', () => {
  it.each<[string, Step]>([
    ['DNS не разрезолвился (Android «Unable to resolve host»)', 'dns'],
    ['connect отвергнут (ECONNREFUSED)', 'refused'],
  ])('%s → безопасный ретрай на следующем хосте', async (_label, step) => {
    const mod = loadApiModule([RESERVE]);
    const calls = keyedAdapter(mod.default, { [PRIMARY]: step, [RESERVE]: 'ok' });

    await expect(mod.default.post('/expenses', { amount: 100 })).resolves.toMatchObject({ status: 200 });

    expect(calls.map((c) => c.baseURL)).toEqual([PRIMARY, RESERVE]);
  });

  it('generic «Network Error» (мог случиться после отправки) НЕ ретраится', async () => {
    const mod = loadApiModule([RESERVE]);
    const calls = keyedAdapter(mod.default, { [PRIMARY]: 'net', [RESERVE]: 'ok' });

    await expect(mod.default.post('/expenses', { amount: 100 })).rejects.toThrow(/Нет соединения с сервером/);
    expect(calls).toHaveLength(1);
  });
});

describe('C2в — таймаут мутации после отправки переключает хост для СЛЕДУЮЩИХ запросов', () => {
  it('мутация не ретраится, но кольцо переизбирается и новые запросы уходят на резерв', async () => {
    const mod = loadApiModule([RESERVE]);
    const calls = keyedAdapter(mod.default, { [PRIMARY]: 'abort', [RESERVE]: 'ok' });

    await expect(mod.default.post('/expenses', { amount: 100 })).rejects.toThrow(/Нет соединения с сервером/);
    expect(calls).toHaveLength(1);
    expect(calls[0].baseURL).toBe(PRIMARY);

    // Троттлинг добрался и до /health primary; резерв жив. Автоматический
    // reselect (debounce 150мс) принимает здоровый резерв…
    mockHealth((url) => url.includes('reserve.test'));
    jest.advanceTimersByTime(150);
    await flushMicrotasks();
    expect(mod.getActiveApiBaseUrl()).toBe(RESERVE);

    // …и ручной «Повторить» уходит уже на живой хост.
    await expect(mod.default.get('/products')).resolves.toMatchObject({ status: 200 });
    expect(calls[1].baseURL).toBe(RESERVE);
  });
});

describe('C1 — гистерезис возврата на primary', () => {
  it('ОДНА удачная проба больше не возвращает; возврат после двух подряд', async () => {
    const mod = loadApiModule([RESERVE]);
    keyedAdapter(mod.default, { [PRIMARY]: 'net', [RESERVE]: 'ok' });
    await mod.default.get('/products');
    expect(mod.getActiveApiBaseUrl()).toBe(RESERVE);

    jest.advanceTimersByTime(75_000); // проба №1 успешна — этого мало
    await flushMicrotasks();
    expect(mod.getActiveApiBaseUrl()).toBe(RESERVE);

    jest.advanceTimersByTime(75_000); // проба №2 подряд — возврат
    await flushMicrotasks();
    expect(mod.getActiveApiBaseUrl()).toBe(PRIMARY);
  });

  it('неудачная проба сбрасывает серию — интермиттирующий троттлинг не маятничит', async () => {
    const probeOutcomes = [true, false, true, true];
    let probeIndex = 0;
    const mod = loadApiModule([RESERVE]);
    keyedAdapter(mod.default, { [PRIMARY]: 'net', [RESERVE]: 'ok' });
    await mod.default.get('/products');
    expect(mod.getActiveApiBaseUrl()).toBe(RESERVE);

    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      if (!String(input).includes('primary.test')) throw new Error('unused');
      const okNow = probeOutcomes[Math.min(probeIndex, probeOutcomes.length - 1)];
      probeIndex += 1;
      if (!okNow) throw new Error('throttled');
      return {
        ok: true,
        text: async () => '{"status":"ok"}',
        headers: { get: () => 'application/json' },
      } as unknown as Response;
    }) as unknown as typeof fetch;

    for (let tick = 1; tick <= 3; tick++) {
      jest.advanceTimersByTime(75_000); // ok → fail → ok: серии из двух нет
      await flushMicrotasks();
      expect(mod.getActiveApiBaseUrl()).toBe(RESERVE);
    }
    jest.advanceTimersByTime(75_000); // ok+ok подряд — возврат
    await flushMicrotasks();
    expect(mod.getActiveApiBaseUrl()).toBe(PRIMARY);
  });
});

describe('M4 — провалившийся активный хост без head-start в reselect', () => {
  // Контракт сознательно уточнён волной C: сбойный (НЕ-force) reselect —
  // production-путь этого сценария (onNetworkFailure / таймаут мутации) — как
  // и раньше не дарит head-start circuit-open хосту. Форс-путь (реальная
  // смена сети) теперь по C-3 чистит circuit'ы и возвращает primary
  // head-start — см. describe «C-3» ниже.
  it('после сбоя активного все пробы стартуют одновременно (без 1.5с форы)', async () => {
    const mod = loadApiModule([RESERVE, THIRD]);
    keyedAdapter(mod.default, { [PRIMARY]: 'net', [RESERVE]: 'net', [THIRD]: 'net' });
    await expect(mod.default.get('/products')).rejects.toThrow(/Нет соединения/);

    const fetchMock = jest.fn(() => new Promise<Response>(() => {}));
    global.fetch = fetchMock as unknown as typeof fetch;
    const selection = mod.reselectApiHost();
    jest.advanceTimersByTime(150); // только debounce, БЕЗ 1.5с head-start
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalledTimes(3);

    jest.advanceTimersByTime(9_000);
    await flushMicrotasks();
    await selection;
  });
});

describe('M2 — аплоады мимо шлюза с лимитом тела', () => {
  async function adoptGateway(mod: AxiosModule): Promise<void> {
    await mod.ensureApiHostReady();
    expect(mod.getActiveApiBaseUrl()).toBe(GATEWAY);
  }

  it('FormData-аплоад при активном шлюзе уходит на прямой хост; JSON-мутация — нет', async () => {
    mockStoredBase = GATEWAY;
    mockHealth((url) => url.includes('apigw.yandexcloud.net'));
    const mod = loadApiModule([RESERVE, GATEWAY]);
    await adoptGateway(mod);
    const calls = keyedAdapter(mod.default, { [PRIMARY]: 'ok', [RESERVE]: 'ok', [GATEWAY]: 'ok' });

    await mod.default.post('/uploads', new FormData());
    await mod.default.post('/expenses', { amount: 1 });

    expect(calls[0].baseURL).toBe(PRIMARY); // пин мимо шлюза
    expect(calls[0].timeout).toBe(120_000); // бюджет аплоада сохранён
    expect(calls[1].baseURL).toBe(GATEWAY); // обычная мутация — на активном
  });

  it('прямые хосты недоступны → понятная ошибка про большие файлы, без слепого ретрая', async () => {
    mockStoredBase = GATEWAY;
    mockHealth((url) => url.includes('apigw.yandexcloud.net'));
    const mod = loadApiModule([RESERVE, GATEWAY]);
    await adoptGateway(mod);
    const calls = keyedAdapter(mod.default, { [PRIMARY]: 'net', [RESERVE]: 'ok', [GATEWAY]: 'ok' });

    await expect(mod.default.post('/uploads', new FormData())).rejects.toThrow(/не пропускает большие файлы/);
    expect(calls).toHaveLength(1);
    expect(calls[0].baseURL).toBe(PRIMARY);
  });

  it('refused-аплоад ретраится на ДРУГОЙ прямой хост, но никогда на шлюз', async () => {
    mockStoredBase = GATEWAY;
    mockHealth((url) => url.includes('apigw.yandexcloud.net'));
    const mod = loadApiModule([RESERVE, GATEWAY]);
    await adoptGateway(mod);
    const calls = keyedAdapter(mod.default, { [PRIMARY]: 'refused', [RESERVE]: 'ok', [GATEWAY]: 'ok' });

    await expect(mod.default.post('/uploads', new FormData())).resolves.toMatchObject({ status: 200 });

    expect(calls.map((c) => c.baseURL)).toEqual([PRIMARY, RESERVE]);
  });
});

describe('M3 — регистрация через кольцо (postPublicAcrossHosts)', () => {
  it('route-сбой primary → следующий хост, тот же публичный URL', async () => {
    const mod = loadApiModule([RESERVE]);
    const calls = keyedAdapter(mod.default, { [PRIMARY]: 'net', [RESERVE]: 'ok' });

    await expect(mod.postPublicAcrossHosts('/registration-requests', { phone: '+79990000000' })).resolves.toMatchObject(
      { status: 200 },
    );

    expect(calls.map((c) => c.baseURL)).toEqual([PRIMARY, RESERVE]);
    expect(calls.every((c) => c.url === '/registration-requests')).toBe(true);
  });

  it('авторитетный ответ (409 дубль телефона) останавливает кольцо', async () => {
    const mod = loadApiModule([RESERVE, THIRD]);
    const calls = keyedAdapter(mod.default, { [PRIMARY]: 409, [RESERVE]: 'ok', [THIRD]: 'ok' });

    await expect(mod.postPublicAcrossHosts('/registration-requests', { phone: '+79990000000' })).rejects.toMatchObject({
      response: { status: 409 },
    });
    expect(calls).toHaveLength(1);
  });
});

describe('C-3 — смена network signature: мгновенный перезапуск кольца', () => {
  /** Сессия «уезжает» на резерв реальным трафиком (primary упал на GET). */
  async function driveSessionToReserve(mod: AxiosModule): Promise<void> {
    keyedAdapter(mod.default, { [PRIMARY]: 'net', [RESERVE]: 'ok' });
    await mod.default.get('/products');
    expect(mod.getActiveApiBaseUrl()).toBe(RESERVE);
  }

  it('reselect(true) гонит пробы primary-first; фоновый reselect — с активного хоста', async () => {
    const mod = loadApiModule([RESERVE]);
    await driveSessionToReserve(mod);

    // Фоновый (не-force) проход: первым пробится АКТИВНЫЙ резерв (гистерезис
    // и sticky-предпочтение сохранены — маятника при троттлинге нет).
    let fetchMock = jest.fn((_input: RequestInfo | URL) => new Promise<Response>(() => {}));
    global.fetch = fetchMock as unknown as typeof fetch;
    const background = mod.reselectApiHost();
    jest.advanceTimersByTime(150);
    await flushMicrotasks();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${RESERVE}/health`);
    jest.advanceTimersByTime(9_000);
    await flushMicrotasks();
    await background;

    // Реальная смена маршрута: гонка стартует ПОЛНЫМ кольцом primary-first.
    fetchMock = jest.fn((_input: RequestInfo | URL) => new Promise<Response>(() => {}));
    global.fetch = fetchMock as unknown as typeof fetch;
    const fresh = mod.reselectApiHost(true);
    jest.advanceTimersByTime(150);
    await flushMicrotasks();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${PRIMARY}/health`);
    jest.advanceTimersByTime(9_000);
    await flushMicrotasks();
    await fresh;
  });

  it('«VPN выключили»: primary снова здоров → сессия на нём сразу, а не через 2×75с', async () => {
    const mod = loadApiModule([RESERVE]);
    await driveSessionToReserve(mod);

    mockHealth(() => true); // на новой сети primary жив
    const fresh = mod.reselectApiHost(true);
    jest.advanceTimersByTime(150);
    await flushMicrotasks();
    await fresh;

    expect(mod.getActiveApiBaseUrl()).toBe(PRIMARY);
  });

  it('resetRouteCircuits() открывает немедленный полный обход кольца после circuit-cooldown', async () => {
    const mod = loadApiModule([RESERVE, THIRD]);
    const calls = keyedAdapter(mod.default, { [PRIMARY]: 'net', [RESERVE]: 'net', [THIRD]: 'net' });

    await expect(mod.default.get('/products')).rejects.toThrow(/Нет соединения/);
    expect(calls).toHaveLength(3); // все хосты выгорели → circuit-open

    await expect(mod.default.get('/products')).rejects.toThrow(/Нет соединения/);
    expect(calls).toHaveLength(4); // волна ретраев схлопнута circuit'ами

    mod.resetRouteCircuits(); // смена сети: сбои прежнего пути неактуальны
    await expect(mod.default.get('/products')).rejects.toThrow(/Нет соединения/);
    expect(calls).toHaveLength(7); // полный обход кольца снова разрешён сразу
  });

  it('reselect(true) сбрасывает серию гистерезиса; фоновой пробе снова нужно 2 подряд', async () => {
    const mod = loadApiModule([RESERVE]);
    await driveSessionToReserve(mod);

    // Проба №1 успешна — серия = 1 (для возврата нужно 2).
    mockHealth((url) => url.includes('primary.test'));
    jest.advanceTimersByTime(75_000);
    await flushMicrotasks();
    expect(mod.getActiveApiBaseUrl()).toBe(RESERVE);

    // Смена сети: на новом пути primary НЕдоступен → остаёмся на резерве,
    // а накопленная серия обнуляется (она измеряла ПРЕЖНИЙ путь).
    mockHealth((url) => url.includes('reserve.test'));
    const fresh = mod.reselectApiHost(true);
    jest.advanceTimersByTime(150);
    await flushMicrotasks();
    await fresh;
    expect(mod.getActiveApiBaseUrl()).toBe(RESERVE);

    // Primary ожил: одна прошедшая проба — ещё НЕ возврат (серия шла бы с 1)…
    mockHealth(() => true);
    jest.advanceTimersByTime(75_000);
    await flushMicrotasks();
    expect(mod.getActiveApiBaseUrl()).toBe(RESERVE);

    // …вторая подряд — возврат: сам гистерезис 2×75с сохранён как был.
    jest.advanceTimersByTime(75_000);
    await flushMicrotasks();
    expect(mod.getActiveApiBaseUrl()).toBe(PRIMARY);
  });
});

describe('C-4 — «подозрительная» база после смены сети: мутации умирают быстрее', () => {
  /** Смена signature, у которой reselect НЕ нашёл победителя (ring недоступен
   * для /health) — пометка «подозрительно» переживает проход. */
  async function forceRouteChangeWithoutWinner(mod: AxiosModule): Promise<void> {
    mockHealth(() => false);
    const fresh = mod.reselectApiHost(true);
    jest.advanceTimersByTime(150);
    await flushMicrotasks();
    await fresh;
  }

  it('обычная мутация на подозрительной базе получает 8с; первый успех снимает пометку', async () => {
    const mod = loadApiModule([RESERVE]);
    await forceRouteChangeWithoutWinner(mod);
    const calls = keyedAdapter(mod.default, { [PRIMARY]: 'ok', [RESERVE]: 'ok' });

    await mod.default.post('/expenses', { amount: 100 });
    expect(calls[0].baseURL).toBe(PRIMARY);
    expect(calls[0].timeout).toBe(8_000); // вместо полных 15с — быстрее честная ошибка

    // Успех доказал живой маршрут — следующая мутация снова с полным бюджетом.
    await mod.default.post('/expenses', { amount: 200 });
    expect(calls[1].timeout).toBe(15_000);
  });

  it('доказуемо-недоставленный ретрай уходит на СЛЕДУЮЩИЙ хост с полным бюджетом', async () => {
    const mod = loadApiModule([RESERVE]);
    await forceRouteChangeWithoutWinner(mod);
    const calls = keyedAdapter(mod.default, { [PRIMARY]: 'refused', [RESERVE]: 'ok' });

    await expect(mod.default.post('/expenses', { amount: 100 })).resolves.toMatchObject({ status: 200 });

    expect(calls.map((c) => c.baseURL)).toEqual([PRIMARY, RESERVE]);
    expect(calls[0].timeout).toBe(8_000); // подозрительная база — коротко
    expect(calls[1].timeout).toBe(15_000); // свежий хост подозрению не подлежит
  });

  it('кольцо из одного хоста ИНЕРТНО — бюджет мутации не трогается', async () => {
    const mod = loadApiModule([]);
    await forceRouteChangeWithoutWinner(mod);
    const calls = keyedAdapter(mod.default, { [PRIMARY]: 'ok' });

    await mod.default.post('/expenses', { amount: 100 });

    expect(calls[0].timeout).toBe(15_000);
  });

  it('живой альтернативы нет (резерв в circuit-cooldown) — полный 15с бюджет', async () => {
    const mod = loadApiModule([RESERVE]);
    await forceRouteChangeWithoutWinner(mod);

    // Реальный трафик выжег ОБА хоста → у подозрительной базы нет живой
    // альтернативы, торопить мутацию некуда.
    keyedAdapter(mod.default, { [PRIMARY]: 'net', [RESERVE]: 'net' });
    await expect(mod.default.get('/products')).rejects.toThrow(/Нет соединения/);

    const calls = keyedAdapter(mod.default, { [PRIMARY]: 'ok', [RESERVE]: 'ok' });
    await mod.default.post('/expenses', { amount: 100 });

    expect(calls[0].baseURL).toBe(PRIMARY);
    expect(calls[0].timeout).toBe(15_000);
  });

  it('keyed-мутация сохраняет свой хоповый бюджет 5с (не растягивается до 8с)', async () => {
    const mod = loadApiModule([RESERVE]);
    await forceRouteChangeWithoutWinner(mod);
    const calls = keyedAdapter(mod.default, { [PRIMARY]: 'ok', [RESERVE]: 'ok' });

    await mod.default.post('/checks', { clientRequestId: UUID, total: 100 });

    expect(calls[0].timeout).toBe(5_000);
  });

  it('победа reselect при смене сети снимает пометку — мутации сразу с полным бюджетом', async () => {
    const mod = loadApiModule([RESERVE]);
    // Смена signature, ring жив: селектор находит победителя → подозрение
    // не переживает проход (маршрут доказуемо здоров).
    const fresh = mod.reselectApiHost(true);
    jest.advanceTimersByTime(150);
    await flushMicrotasks();
    await fresh;
    const calls = keyedAdapter(mod.default, { [PRIMARY]: 'ok', [RESERVE]: 'ok' });

    await mod.default.post('/expenses', { amount: 100 });

    expect(calls[0].timeout).toBe(15_000);
  });
});

describe('C.1 — доказательства прежнего поколения маршрута не управляют свежей сетью', () => {
  /** Снапшот конфига попытки (аналог keyedAdapter, но с управляемым исходом). */
  function snapshot(config: InternalAxiosRequestConfig): SentConfig {
    return {
      baseURL: config.baseURL,
      timeout: config.timeout,
      method: config.method,
      url: config.url,
      data: config.data,
    };
  }

  /** Микротасковый дренаж до условия: глубина цепочки cold-start → интерсептор
   *  → адаптер → error-путь → гонка не фиксирована, фикс. 20 раундов мало. */
  async function flushUntil(predicate: () => boolean, maxRounds = 500): Promise<void> {
    for (let i = 0; i < maxRounds && !predicate(); i++) await Promise.resolve();
    expect(predicate()).toBe(true);
  }

  /** Смена network-signature (reselect(true)) при живом /health — принимает primary. */
  async function switchNetworkAdoptingPrimary(mod: AxiosModule): Promise<void> {
    const fresh = mod.reselectApiHost(true);
    jest.advanceTimersByTime(150);
    await flushMicrotasks();
    await fresh;
    expect(mod.getActiveApiBaseUrl()).toBe(PRIMARY);
  }

  it('сбой запроса, ушедшего до смены сети, НЕ открывает circuit на свежей сети', async () => {
    const mod = loadApiModule([RESERVE]);
    const calls: SentConfig[] = [];
    let rejectInFlight: (() => void) | null = null;
    mod.default.defaults.adapter = async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
      calls.push(snapshot(config));
      if (String(config.baseURL) === PRIMARY && !rejectInFlight) {
        return new Promise<AxiosResponse>((_resolve, reject) => {
          rejectInFlight = () => reject(netError(config, 'ERR_NETWORK'));
        });
      }
      return okResponse(config);
    };

    // Обычная мутация уходит на PRIMARY прежней сети и зависает в полёте.
    const inFlight = mod.default.post('/expenses', { amount: 100 });
    const settled = expect(inFlight).rejects.toThrow(/Нет соединения с сервером/);
    await flushUntil(() => calls.length === 1);
    expect(calls[0].baseURL).toBe(PRIMARY);

    // Реальная смена маршрута: resetRouteCircuits() + новое поколение.
    await switchNetworkAdoptingPrimary(mod);

    // Пробы следующего reselect считаем на зависшем fetch.
    const fetchMock = jest.fn((_input: RequestInfo | URL) => new Promise<Response>(() => {}));
    global.fetch = fetchMock as unknown as typeof fetch;

    // Generic net-сбой СТАРОГО пути доезжает уже после смены сети.
    rejectInFlight!();
    await settled;

    // C2в дёрнул фоновый reselect. PRIMARY НЕ в circuit-cooldown (улика была
    // прежнего поколения) → активный хост сохраняет 1.5с head-start: на
    // отметке debounce пробится ровно ОДИН хост, а не весь веер.
    jest.advanceTimersByTime(150);
    await flushMicrotasks();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${PRIMARY}/health`);

    // Дать пассу дожить до конца (бюджет 9с + таймауты проб).
    jest.advanceTimersByTime(10_000);
    await flushMicrotasks();
  });

  it('сбой race-кандидата из прежнего поколения не закорачивает хост на свежей сети', async () => {
    const mod = loadApiModule([RESERVE, THIRD]);
    const calls: SentConfig[] = [];
    const deferred = new Map<string, { resolve: () => void; reject: () => void }>();
    mod.default.defaults.adapter = async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
      calls.push(snapshot(config));
      const base = String(config.baseURL);
      if (base === PRIMARY) throw netError(config, 'ERR_NETWORK');
      if (!deferred.has(base)) {
        return new Promise<AxiosResponse>((resolve, reject) => {
          deferred.set(base, {
            resolve: () => resolve(okResponse(config)),
            reject: () => reject(netError(config, 'ERR_NETWORK')),
          });
        });
      }
      return okResponse(config);
    };

    // PRIMARY падает сразу (текущее поколение — его circuit легитимен),
    // гонка RESERVE/THIRD повисает в полёте на ПРЕЖНЕЙ сети.
    const inFlight = mod.default.get('/products');
    const settled = expect(inFlight).resolves.toMatchObject({ status: 200 });
    await flushUntil(() => calls.length === 3);
    expect(calls.map((c) => c.baseURL)).toEqual([PRIMARY, RESERVE, THIRD]);

    // Смена маршрута, пока гонка в полёте: circuit'ы чисты, поколение новое.
    await switchNetworkAdoptingPrimary(mod);

    // Сбой RESERVE доезжает ПОСЛЕ смены сети — улика старого пути,
    // circuit на свежей сети открываться НЕ должен.
    deferred.get(RESERVE)!.reject();
    await flushMicrotasks();
    deferred.get(THIRD)!.resolve();
    await settled;

    // Свежая волна: RESERVE не в cooldown → гонка снова пробует ВСЁ кольцо.
    const before = calls.length;
    await expect(mod.default.get('/products')).resolves.toMatchObject({ status: 200 });
    await flushMicrotasks(50); // дать долететь и проигравшему кандидату гонки
    expect(calls.slice(before).map((c) => c.baseURL)).toEqual([PRIMARY, RESERVE, THIRD]);
  });

  it('успех, ушедший в полёт до смены сети, НЕ снимает подозрение со свежего маршрута', async () => {
    const mod = loadApiModule([RESERVE]);
    const calls: SentConfig[] = [];
    let releaseInFlight: (() => void) | null = null;
    mod.default.defaults.adapter = async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
      calls.push(snapshot(config));
      if (String(config.baseURL) === PRIMARY && !releaseInFlight) {
        return new Promise<AxiosResponse>((resolve) => {
          releaseInFlight = () => resolve(okResponse(config));
        });
      }
      return okResponse(config);
    };

    // GET уходит на PRIMARY прежней сети и висит в полёте.
    const inFlight = mod.default.get('/products');
    await flushUntil(() => calls.length === 1);

    // Смена сети БЕЗ победителя /health — база остаётся «подозрительной» (C-4).
    mockHealth(() => false);
    const fresh = mod.reselectApiHost(true);
    jest.advanceTimersByTime(150);
    await flushMicrotasks();
    await fresh;

    // Успех СТАРОГО маршрута доезжает после смены сети: suspect снимать нельзя.
    releaseInFlight!();
    await expect(inFlight).resolves.toMatchObject({ status: 200 });

    // Подозрение живо: обычная мутация на подозрительной базе — 8с, не 15с.
    await mod.default.post('/expenses', { amount: 100 });
    const post = calls[calls.length - 1];
    expect(post.baseURL).toBe(PRIMARY);
    expect(post.method).toBe('post');
    expect(post.timeout).toBe(8_000);
  });
});
