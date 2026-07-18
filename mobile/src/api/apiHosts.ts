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
  return orderApiHosts(hosts, current).slice(1).find((host) => !tried.has(host)) ?? null;
}

/**
 * HTML вместо JSON от «/api» — признак чужого апстрима (битая база,
 * captive-portal оператора, страница ошибки хостинга). Такой ответ ОБЯЗАН
 * считаться сетевым сбоем, а не данными.
 */
export function isHtmlApiPayload(data: unknown, contentType: unknown): boolean {
  const ct = typeof contentType === 'string' ? contentType.toLowerCase() : '';
  if (ct.includes('text/html')) return true;
  if (typeof data === 'string' && /^\s*<(!doctype|html|head|body)/i.test(data)) return true;
  return false;
}
