/**
 * apiHosts — чистые (без RN-импортов, jest-тестируемые) помощники failover-кольца.
 *
 * ИНЦИДЕНТ 05.07 (корень «405 на входе» + волны крашей «X of undefined»):
 * резервные адреса в app.json extra.apiFallbackUrls были записаны БЕЗ пути
 * `/api` («https://autexa.pw»), а кольцо доверяло значению как есть. При
 * первом же сетевом сбое primary запросы уезжали в КОРЕНЬ резервного домена:
 *   • GET  → nginx отдаёт SPA-HTML со статусом 200 → экраны получали HTML
 *     вместо JSON и падали на доступе к полям (count/length/id of undefined);
 *   • POST → nginx-статика отвечает 405 (Method Not Allowed) → «ошибка 405»
 *     на логине;
 * и битая база ЗАПОМИНАЛАСЬ (AsyncStorage) — телефон оставался сломанным до
 * переустановки. Два рубежа ниже делают повтор невозможным:
 *   1) normalizeReserveApiBase — резерв без пути наследует API-путь primary
 *     («https://autexa.pw» → «https://autexa.pw/api»), уже раскатанные битые
 *     конфиги (embedded 36/38, старые OTA) самолечатся кодом;
 *   2) isHtmlApiPayload — HTML-ответ на /api-запрос классифицируется как
 *     СЕТЕВОЙ сбой (это же закрывает captive-порталы операторов: их страницы
 *     логина больше никогда не попадут в экраны как «данные»).
 */

/** Базовая чистка: строка, trim, срез хвостовых слэшей, http(s)-валидация. */
export function normalizeBaseUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!/^https?:\/\/\S+$/i.test(trimmed)) return null;
  return trimmed;
}

/** Путь API primary-базы: «https://host/api» → «/api»; нет пути → ''. */
export function apiPathOf(baseUrl: string): string {
  const m = baseUrl.match(/^https?:\/\/[^/]+(\/.*)?$/i);
  const path = m?.[1] ?? '';
  return path === '/' ? '' : path;
}

/**
 * Нормализация РЕЗЕРВНОЙ базы: значение без пути (голый origin) наследует
 * API-путь primary. Явный путь (в т.ч. нестандартный) уважается как есть.
 */
export function normalizeReserveApiBase(value: unknown, primaryBase: string): string | null {
  const base = normalizeBaseUrl(value);
  if (!base) return null;
  if (apiPathOf(base) === '') {
    return base + apiPathOf(primaryBase);
  }
  return base;
}

/** Кольцо: primary + резервы (нормализованные, дедуп, без дублей primary). */
export function buildApiHosts(primaryBase: string, rawFallbacks: unknown): string[] {
  const seen = new Set<string>([primaryBase]);
  const out: string[] = [primaryBase];
  if (Array.isArray(rawFallbacks)) {
    for (const item of rawFallbacks) {
      const normalized = normalizeReserveApiBase(item, primaryBase);
      if (normalized && !seen.has(normalized)) {
        seen.add(normalized);
        out.push(normalized);
      }
    }
  }
  return out;
}

/**
 * Stable ring order starting at `preferred`. Unknown preferences are ignored.
 * Keeping this pure makes both request failover and health selection use the
 * exact same host order.
 */
export function orderApiHosts(hosts: readonly string[], preferred: string | null | undefined): string[] {
  if (!preferred) return [...hosts];
  const start = hosts.indexOf(preferred);
  if (start < 0) return [...hosts];
  return [...hosts.slice(start), ...hosts.slice(0, start)];
}

/** Next host in the ring that this request has not already attempted. */
export function nextUntriedApiHost(
  hosts: readonly string[],
  current: string,
  attempted: readonly string[],
): string | null {
  const tried = new Set(attempted);
  tried.add(current);
  return (
    orderApiHosts(hosts, current)
      .slice(1)
      .find((host) => !tried.has(host)) ?? null
  );
}

/**
 * Хост-шлюз с лимитом тела запроса. Яндекс API Gateway (третий рубеж кольца)
 * режет request body ~3.5 МБ (docs/YANDEX_RESERVE_SETUP.md) — типичное фото
 * iPhone через него детерминированно не проходит, поэтому multipart-аплоады
 * пиннятся к прямым хостам (см. request-интерсептор в axios.ts).
 */
export function isBodyLimitedGatewayHost(base: string): boolean {
  const m = base.match(/^https?:\/\/([^/]+)/i);
  if (!m) return false;
  return /\.apigw\.yandexcloud\.net$/i.test(m[1].split(':')[0]);
}

/**
 * HTML вместо JSON от «/api» — признак чужого апстрима (битая база,
 * captive-portal оператора, страница ошибки хостинга). Такой ответ ОБЯЗАН
 * считаться сетевым сбоем, а не данными.
 */
export function isHtmlApiPayload(data: unknown, contentType: unknown): boolean {
  const ct = typeof contentType === 'string' ? contentType.toLowerCase() : '';
  if (ct.includes('text/html') || ct.includes('application/xhtml+xml')) return true;
  if (typeof data !== 'string') return false;
  // Scan each prefix once. A repeated lazy-comment regex can backtrack
  // exponentially on a small hostile/non-HTML proxy response and freeze JS.
  let cursor = 0;
  const whitespace = /\s/;
  while (cursor < data.length) {
    while (cursor < data.length && whitespace.test(data[cursor])) cursor++;
    if (data.startsWith('<!--', cursor)) {
      const end = data.indexOf('-->', cursor + 4);
      if (end < 0) return false;
      cursor = end + 3;
      continue;
    }
    if (data.slice(cursor, cursor + 5).toLowerCase() === '<?xml') {
      const end = data.indexOf('?>', cursor + 5);
      if (end < 0) return false;
      cursor = end + 2;
      continue;
    }
    return /^<(?:!doctype\b|html\b|head\b|body\b)/i.test(data.slice(cursor, cursor + 16));
  }
  return false;
}

type ApiFailure = { code?: string; response?: { status?: number; data?: unknown; headers?: Record<string, unknown> } };

/** One classification for transport, bootstrap and query recovery. */
export function isApiRouteFailure(error: unknown): boolean {
  const e = error as ApiFailure | null | undefined;
  if (e?.code === 'ERR_CANCELED') return false;
  if (!e?.response || e.code === 'ERR_HTML_RESPONSE' || e.code === 'ERR_SESSION_RECOVERING') return true;
  // The API's error contract is {message:string}. Unknown proxy 401 payloads
  // cannot revoke credentials merely because a gateway chose that status.
  if (
    e.response.status === 401 &&
    (!e.response.data ||
      typeof e.response.data !== 'object' ||
      Array.isArray(e.response.data) ||
      typeof (e.response.data as { message?: unknown }).message !== 'string')
  )
    return true;
  return (
    [408, 421, 451, 502, 503, 504].includes(e.response.status ?? 0) ||
    isHtmlApiPayload(e.response.data, e.response.headers?.['content-type'])
  );
}

/** HTTP status alone is not evidence that the API rejected credentials. */
export function isAuthoritativeAuthFailure(error: unknown): boolean {
  const e = error as ApiFailure | null | undefined;
  return (
    e?.response?.status === 401 &&
    !isApiRouteFailure(error) &&
    !!e.response.data &&
    typeof e.response.data === 'object' &&
    !Array.isArray(e.response.data) &&
    typeof (e.response.data as { message?: unknown }).message === 'string'
  );
}
