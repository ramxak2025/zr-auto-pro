/**
 * networkDiagnosis — тесты третьего сетевого диагноза («имена мертвы, сеть
 * жива»). Механизм пойман живьём 26.07.2026: VPN-клиент ломал разрешение имён,
 * все три хоста кольца умирали разом, и приложение врало «нет интернета».
 *
 * Герметично: единственная runtime-зависимость — global.fetch, роутим по URL.
 * apiHosts.isHtmlApiPayload — чистая функция без импортов, мокать нечего.
 */
import { diagnoseConnectivity, DNS_BYPASS_PROBES, NEUTRAL_PROBES } from '../networkDiagnosis';

const realFetch = global.fetch;

type FakeResponse = {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  headers: { get: (key: string) => string | null };
};

function response(init: { status?: number; body?: string; contentType?: string }): FakeResponse {
  const status = init.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => init.body ?? '',
    headers: { get: () => init.contentType ?? 'text/plain' },
  };
}

const DOH_OK = response({
  body: JSON.stringify({ Status: 0, Answer: [{ data: '212.8.229.254' }] }),
  contentType: 'application/dns-json',
});
const YANDEX_OK = response({ body: 'User-agent: *\nDisallow:', contentType: 'text/plain' });

const isNeutral = (url: string) => NEUTRAL_PROBES.some((p) => p.url === url);
const isDnsBypass = (url: string) => DNS_BYPASS_PROBES.some((p) => p.url === url);

/** Роутер: что каждому классу URL отвечать. Отказ = отвергнутый промис. */
function mockNetwork(handler: (url: string) => FakeResponse | 'fail') {
  const spy = jest.fn(async (url: string) => {
    const outcome = handler(url);
    if (outcome === 'fail') throw new Error('Network request failed');
    return outcome;
  });
  global.fetch = spy as unknown as typeof fetch;
  return spy;
}

afterEach(() => {
  global.fetch = realFetch;
  jest.restoreAllMocks();
});

describe('diagnoseConnectivity', () => {
  it('имена отвечают → internet-ok, и вторая ступень не тратится', async () => {
    const spy = mockNetwork((url) => (url === NEUTRAL_PROBES[0].url ? YANDEX_OK : 'fail'));

    await expect(diagnoseConnectivity(1_000)).resolves.toBe('internet-ok');

    const requested = spy.mock.calls.map(([url]) => url as string);
    expect(requested.some(isNeutral)).toBe(true);
    expect(requested.some(isDnsBypass)).toBe(false);
  });

  it('не отвечает ничего → no-internet', async () => {
    mockNetwork(() => 'fail');
    await expect(diagnoseConnectivity(1_000)).resolves.toBe('no-internet');
  });

  it('имена мертвы, а DoH по IP-литералу отвечает → dns-blocked', async () => {
    const spy = mockNetwork((url) => (isDnsBypass(url) ? DOH_OK : 'fail'));

    await expect(diagnoseConnectivity(1_000)).resolves.toBe('dns-blocked');

    // Обе ступени реально сходили в сеть — диагноз не угадан, а доказан.
    const requested = spy.mock.calls.map(([url]) => url as string);
    expect(requested.some(isNeutral)).toBe(true);
    expect(requested.some(isDnsBypass)).toBe(true);
  });

  it('отрицательный DoH-ответ (домен не найден) всё равно доказывает сеть', async () => {
    mockNetwork((url) =>
      isDnsBypass(url)
        ? response({ body: JSON.stringify({ Status: 3 }), contentType: 'application/dns-json' })
        : 'fail',
    );
    await expect(diagnoseConnectivity(1_000)).resolves.toBe('dns-blocked');
  });

  it('captive-portal: HTML со статусом 200 не считается ни интернетом, ни DoH-ответом', async () => {
    const portal = response({ body: '<!doctype html><html>вход в сеть</html>', contentType: 'text/html' });
    mockNetwork(() => portal);
    await expect(diagnoseConnectivity(1_000)).resolves.toBe('no-internet');
  });

  it('DoH-эндпоинт вернул 200, но не JSON → сеть не доказана', async () => {
    mockNetwork((url) => (isDnsBypass(url) ? response({ body: 'не-json' }) : 'fail'));
    await expect(diagnoseConnectivity(1_000)).resolves.toBe('no-internet');
  });

  it('уже отменённый signal → no-internet без второй ступени', async () => {
    const spy = mockNetwork((url) => (isDnsBypass(url) ? DOH_OK : 'fail'));
    const abort = new AbortController();
    abort.abort();

    await expect(diagnoseConnectivity(1_000, abort.signal)).resolves.toBe('no-internet');

    expect(spy.mock.calls.map(([url]) => url as string).some(isDnsBypass)).toBe(false);
  });

  it('зависшая проба не держит диагноз дольше таймаута', async () => {
    mockNetwork(() => 'fail');
    global.fetch = jest.fn(() => new Promise(() => {})) as unknown as typeof fetch;

    const started = Date.now();
    await expect(diagnoseConnectivity(150)).resolves.toBe('no-internet');
    // Две последовательные ступени по 150 мс; с запасом на планировщик.
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('DoH-пробы идут по IP-литералам — им не нужен DNS', () => {
    for (const probe of DNS_BYPASS_PROBES) {
      expect(probe.url).toMatch(/^https:\/\/(\d{1,3}\.){3}\d{1,3}\//);
    }
  });
});
