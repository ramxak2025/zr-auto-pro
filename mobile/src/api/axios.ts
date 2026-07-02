import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

// API URL: hardcoded production server, fallback to dev server
function getApiBaseUrl(): string {
  const configUrl = Constants.expoConfig?.extra?.apiUrl;
  if (configUrl) return configUrl;

  const debuggerHost = Constants.expoConfig?.hostUri || (Constants as any).debuggerHost;
  if (debuggerHost) {
    const host = debuggerHost.split(':')[0];
    return `http://${host}:3000/api`;
  }
  return 'http://localhost:3000/api';
}

const API_BASE_URL = getApiBaseUrl();

// Exposed so screens can show what URL they're hitting in error dialogs.
export const API_URL = API_BASE_URL;

// ── Сетевой failover: резервные API-хосты (Round 9) ─────────────────────────
// Контекст: в сети автосервиса владельца оператор фильтрует TLD `.pw` — сам
// сервер жив (VPN лечит), но соединение до primary-домена умирает. Лечится
// резервным доменом (.ru), который владелец пропишет в app.json →
// extra.apiFallbackUrls (полные URL до корня API, как apiUrl:
// "https://reserve.example.ru/api").
//
// Поведение: на СЕТЕВОМ отказе любого запроса (нет ответа: DNS / connect /
// timeout) тот же запрос прозрачно повторяется ОДИН раз на следующий хост
// кольца. Успех на резерве → он запоминается активной базой (module state +
// AsyncStorage, переживает рестарт), а фоновая проба раз в 10 минут пытается
// вернуть primary. Auth (Bearer из interceptor'а ниже) и отсутствие
// клиентского ETag-слоя (удалён, см. историю ниже) действуют на резерве
// байт-в-байт так же — интерсепторы общие и от хоста не зависят.
//
// ГАРАНТИЯ ИНЕРТНОСТИ: пока apiFallbackUrls пуст, API_HOSTS.length === 1 —
// каждая ветка ниже начинается с проверки `API_HOSTS.length > 1`, поэтому ни
// failover-ретрай, ни подмена baseURL, ни проба возврата не выполняются
// вовсе; activeBaseUrl навсегда равен API_BASE_URL.

function normalizeBaseUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!/^https?:\/\/\S+$/i.test(trimmed)) return null;
  return trimmed;
}

const RESERVE_BASE_URLS: string[] = (() => {
  const raw = Constants.expoConfig?.extra?.apiFallbackUrls;
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>([API_BASE_URL]);
  const out: string[] = [];
  for (const item of raw) {
    const normalized = normalizeBaseUrl(item);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      out.push(normalized);
    }
  }
  return out;
})();

/** Кольцо хостов: primary всегда первый. */
const API_HOSTS: readonly string[] = [API_BASE_URL, ...RESERVE_BASE_URLS];

/** Активная база всех последующих запросов (module state). */
let activeBaseUrl = API_BASE_URL;

/** Текущая активная база — для health-проб OfflineBanner. */
export function getActiveApiBaseUrl(): string {
  return activeBaseUrl;
}

const ACTIVE_BASE_STORAGE_KEY = 'active_api_base_v1';
const PRIMARY_RETURN_PROBE_INTERVAL_MS = 10 * 60_000;
const PRIMARY_RETURN_PROBE_TIMEOUT_MS = 5_000;

let primaryReturnTimer: ReturnType<typeof setInterval> | null = null;

function stopPrimaryReturnProbe(): void {
  if (primaryReturnTimer) {
    clearInterval(primaryReturnTimer);
    primaryReturnTimer = null;
  }
}

/** Пока живём на резерве — раз в 10 минут пробуем /health primary и возвращаемся. */
function ensurePrimaryReturnProbe(): void {
  if (primaryReturnTimer || activeBaseUrl === API_BASE_URL) return;
  primaryReturnTimer = setInterval(async () => {
    if (activeBaseUrl === API_BASE_URL) {
      stopPrimaryReturnProbe();
      return;
    }
    const abort = new AbortController();
    const t = setTimeout(() => abort.abort(), PRIMARY_RETURN_PROBE_TIMEOUT_MS);
    try {
      const res = await fetch(`${API_BASE_URL}/health`, { method: 'GET', signal: abort.signal });
      if (res.ok) adoptActiveBase(API_BASE_URL);
    } catch {
      // primary всё ещё недоступен — остаёмся на резерве до следующей пробы
    } finally {
      clearTimeout(t);
    }
  }, PRIMARY_RETURN_PROBE_INTERVAL_MS);
}

function adoptActiveBase(next: string): void {
  if (activeBaseUrl === next) return;
  activeBaseUrl = next;
  if (next === API_BASE_URL) {
    stopPrimaryReturnProbe();
    AsyncStorage.removeItem(ACTIVE_BASE_STORAGE_KEY).catch(() => {});
  } else {
    ensurePrimaryReturnProbe();
    AsyncStorage.setItem(ACTIVE_BASE_STORAGE_KEY, next).catch(() => {});
  }
}

// Восстановление активной базы прошлой сессии — только когда резервы вообще
// сконфигурированы; иначе подчищаем возможный устаревший ключ и остаёмся
// строго на primary.
if (API_HOSTS.length > 1) {
  AsyncStorage.getItem(ACTIVE_BASE_STORAGE_KEY)
    .then((stored) => {
      if (stored && stored !== API_BASE_URL && API_HOSTS.includes(stored)) {
        activeBaseUrl = stored;
        ensurePrimaryReturnProbe();
      }
    })
    .catch(() => {});
} else {
  AsyncStorage.removeItem(ACTIVE_BASE_STORAGE_KEY).catch(() => {});
}

/** Флаги failover-ретрая на конфиге запроса (одна попытка на запрос). */
type FailoverAwareConfig = InternalAxiosRequestConfig & {
  _failoverAttempted?: boolean;
  _failoverBaseUrl?: string;
};

// Derive server origin for image URLs (strip /api suffix)
export const SERVER_URL = API_BASE_URL.replace(/\/api\/?$/, '');

/**
 * Resolve a relative image path (/uploads/xxx) to full URL.
 * Использует АКТИВНУЮ базу (failover): когда приложение живёт на резервном
 * домене, фото товаров/аватарки тоже должны грузиться через него. Пока
 * failover не сконфигурирован, activeBaseUrl === API_BASE_URL — поведение
 * прежнее байт-в-байт.
 */
export function getImageUrl(path?: string | null): string | undefined {
  if (!path) return undefined;
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  const origin = activeBaseUrl.replace(/\/api\/?$/, '');
  return `${origin}${path.startsWith('/') ? '' : '/'}${path}`;
}

// Budget for ordinary JSON requests. The server answers in ~0.4s, but the
// FIRST request after a cold launch also pays DNS + TLS handshake, and on a
// flaky mobile network (or shaky DNS) that handshake alone can eat several
// seconds. 8s was too aggressive — it turned a slow-but-fine first connection
// into a hard error the user had to "Повторить" past. 12s tolerates the cold
// handshake while still failing a genuinely dead connection; React Query's
// network-error retries (App.tsx) + persistent cache cover the rest.
const DEFAULT_TIMEOUT_MS = 12_000;

// Multipart uploads (photos) stream megabytes over LTE — the 8s budget that
// suits JSON would abort them mid-flight. Applied per-request in the request
// interceptor below; explicit per-request timeouts (e.g. the 120s/600s heavy
// endpoints in shared/createServices.ts) always win over both.
const UPLOAD_TIMEOUT_MS = 120_000;

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: DEFAULT_TIMEOUT_MS,
  // Default validateStatus (2xx ok). The client-side ETag / If-None-Match /
  // 304-substitution layer was REMOVED deliberately (см. ниже) — every GET now
  // fetches a full body, so a 304 must never be treated as success.
});

// ── In-memory auth token cache ──────────────────────────────────────────
// The request interceptor used to `await AsyncStorage.getItem('token')` on
// EVERY request. When ~10-15 dashboard queries fan out at once, those reads
// serialise through the single AsyncStorage native bridge and add latency to
// the whole wave. We keep the token in a module variable instead: read once,
// then update it on login / logout / 401 via `setAuthToken`. `undefined`
// means "not yet read from disk"; `null` means "known to be logged out".
let cachedAuthToken: string | null | undefined = undefined;

/**
 * Update the in-memory auth token. Called by AuthContext on login
 * (`setAuthToken(token)`), logout and the 401 handler (`setAuthToken(null)`).
 * Passing `null` clears the bearer for every subsequent request.
 */
export function setAuthToken(token: string | null): void {
  cachedAuthToken = token;
}

// ── Client-side ETag / If-None-Match: REMOVED (2026-06-12) ───────────────
// HISTORY: we used to cache `{ etag, data }` per GET signature, send
// `If-None-Match` on the next identical GET, and substitute the stored body on
// a 304. It was a network micro-optimisation on top of the backend's ETag
// interceptor (`backend/src/common/interceptors/etag.interceptor.ts`).
//
// WHY IT WAS REMOVED — it produced a DETERMINISTIC "повторить не помогает"
// failure on real (data-heavy) tenants:
//   1. Poll-heavy screens (CashFlow / Журнал / Dashboard refetch every 30s)
//      and the post-login fan-out (prefetch + per-id details) blow past the
//      LRU cap, so a body gets evicted while a poll has already attached its
//      `If-None-Match`. The backend then answers 304 with an EMPTY body.
//   2. The recovery re-request (sans If-None-Match) added a SECOND round-trip
//      to the VDS for every such miss; under the VDS's intermittent
//      502 / slow-handshake load that extra request frequently failed,
//      surfacing as the screen's error card.
//   3. On a manual «Повторить» the request interceptor re-attached the SAME
//      `If-None-Match` (the slot was repopulated by a parallel poll), so retry
//      walked straight back into the same fragile 304→recovery dance instead
//      of issuing one clean fetch — i.e. retry deterministically failed.
//   4. The `Promise.reject('Сервер вернул 304 без тела …')` escape hatch could
//      reject a load outright.
//
// The owner prioritises reliability over this micro-optimisation, and
// persistentCache (`utils/persistentCache.ts`) + the global
// `placeholderData: prev => prev` + per-screen `staleTime` already deliver the
// "instant" feel. So every GET now performs ONE normal request: 2xx → data,
// failure → honest error that React Query's transient-retry policy
// (App.tsx: retry network/5xx, never 4xx) handles. No If-None-Match is ever
// sent, no 304 is ever treated as success, nothing ever rejects on an empty
// body. The backend keeps emitting ETags (harmless) for HTTP-cache-aware
// clients; we simply stop participating.

// Attach the JWT token. Reads the in-memory token first; only touches
// AsyncStorage once if the module variable hasn't been primed yet (e.g. a
// request fired before AuthContext mounted).
api.interceptors.request.use(async (config) => {
  // Failover: направляем запрос на активную базу (или на хост, явно заданный
  // failover-ретраем ниже). При пустом apiFallbackUrls ветка не выполняется —
  // baseURL остаётся дефолтом инстанса, поведение прежнее.
  if (API_HOSTS.length > 1) {
    config.baseURL = (config as FailoverAwareConfig)._failoverBaseUrl ?? activeBaseUrl;
  }

  if (cachedAuthToken === undefined) {
    cachedAuthToken = (await AsyncStorage.getItem('token').catch(() => null)) ?? null;
  }
  if (cachedAuthToken) {
    config.headers.Authorization = `Bearer ${cachedAuthToken}`;
  }

  // Multipart uploads (photo → /uploads) must NOT inherit the JSON fail-fast
  // budget — a 3-5 MB photo on LTE легко takes longer. Only bump when the
  // request kept the instance default; an explicit per-request timeout
  // (createServices' 120s/600s heavy endpoints) is left untouched.
  if (config.timeout === DEFAULT_TIMEOUT_MS && typeof FormData !== 'undefined' && config.data instanceof FormData) {
    config.timeout = UPLOAD_TIMEOUT_MS;
  }

  return config;
});

// Event emitter for auth state changes
type AuthListener = () => void;
const authListeners: AuthListener[] = [];

export function onAuthExpired(listener: AuthListener) {
  authListeners.push(listener);
  return () => {
    const idx = authListeners.indexOf(listener);
    if (idx >= 0) authListeners.splice(idx, 1);
  };
}

// ── Лёгкие сетевые события (Round 9) ────────────────────────────────────────
// Два дешёвых хука для пакета надёжности связи:
//   • onRequestSucceeded — ЛЮБОЙ успешный ответ (сеть доказуемо жива):
//     App.tsx дёргает досылку офлайн-очереди чеков (с дебаунсом внутри неё),
//     OfflineBanner мгновенно прячется.
//   • onNetworkClassFailure — ФИНАЛЬНЫЙ сетевой отказ (нет ответа после
//     failover-попытки, либо 502/503/504): OfflineBanner запускает дуальную
//     пробу «интернет есть? сервер доступен?».
// Слушателей единицы, вызов — просто проход по массиву; ошибки слушателей
// глушатся, чтобы не ломать цепочку интерсепторов.
type NetworkListener = () => void;
const requestSuccessListeners: NetworkListener[] = [];
const networkFailureListeners: NetworkListener[] = [];

export function onRequestSucceeded(listener: NetworkListener) {
  requestSuccessListeners.push(listener);
  return () => {
    const idx = requestSuccessListeners.indexOf(listener);
    if (idx >= 0) requestSuccessListeners.splice(idx, 1);
  };
}

export function onNetworkClassFailure(listener: NetworkListener) {
  networkFailureListeners.push(listener);
  return () => {
    const idx = networkFailureListeners.indexOf(listener);
    if (idx >= 0) networkFailureListeners.splice(idx, 1);
  };
}

function fireNetworkListeners(listeners: NetworkListener[]): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // Слушатель не должен ронять остальных / сам ответ.
    }
  }
}

/**
 * Auth-expiry coalescer — a wave of parallel 401s (8+ dashboard queries
 * all hit the API at once with a stale token) would otherwise fire the
 * listeners 8 times, each one triggering `queryClient.clear()` /
 * `clearPersistentCache()` / state updates. We collapse them into a
 * single notification per 2 s window.
 */
let lastAuthExpiredAt = 0;
const AUTH_EXPIRED_COALESCE_MS = 2_000;

function fireAuthExpired() {
  const now = Date.now();
  if (now - lastAuthExpiredAt < AUTH_EXPIRED_COALESCE_MS) return;
  lastAuthExpiredAt = now;
  authListeners.forEach((fn) => {
    try {
      fn();
    } catch {
      // Listener errors must not block other listeners or the next
      // 401 from firing the chain.
    }
  });
}

api.interceptors.response.use(
  // Success path: почти pass-through (no 304 substitution, no ETag
  // bookkeeping — see the "ETag … REMOVED" note above for why). Единственное
  // дополнение — сигнал «сеть жива» для офлайн-очереди чеков и баннера.
  (res) => {
    fireNetworkListeners(requestSuccessListeners);
    return res;
  },
  async (error: AxiosError<{ message?: string }>) => {
    if (!error.response) {
      // ── Failover-ретрай (см. блок «Сетевой failover» выше) ──────────────
      // Сетевой отказ (DNS / connect / timeout — ответа нет вовсе): один
      // прозрачный повтор ТОГО ЖЕ запроса на следующий хост кольца. Флаг
      // _failoverAttempted гарантирует не больше одной failover-попытки на
      // запрос; при пустом apiFallbackUrls (API_HOSTS.length === 1) ветка
      // мертва и поведение прежнее.
      if (API_HOSTS.length > 1) {
        const cfg = error.config as FailoverAwareConfig | undefined;
        if (cfg && !cfg._failoverAttempted) {
          const failedBase =
            typeof cfg.baseURL === 'string' && API_HOSTS.includes(cfg.baseURL) ? cfg.baseURL : activeBaseUrl;
          const nextBase = API_HOSTS[(API_HOSTS.indexOf(failedBase) + 1) % API_HOSTS.length];
          if (nextBase && nextBase !== failedBase) {
            cfg._failoverAttempted = true;
            cfg._failoverBaseUrl = nextBase;
            const retried = await api.request(cfg);
            // Резерв ответил → запоминаем его активной базой для всех
            // последующих запросов (persist в AsyncStorage внутри). Отказ
            // ретрая сюда не доходит: его собственный проход интерсептора
            // уже обернул ошибку и бросил её вызывающему.
            adoptActiveBase(nextBase);
            return retried;
          }
        }
      }

      // Финальный сетевой отказ — сигнал баннеру запустить дуальную пробу.
      fireNetworkListeners(networkFailureListeners);

      const baseURL = error.config?.baseURL || API_BASE_URL;
      const reason = error.code || error.message || 'unknown';
      const wrapped = new Error(`Нет соединения с сервером\nURL: ${baseURL}\nПричина: ${reason}`);
      (wrapped as any).code = error.code;
      (wrapped as any).baseURL = baseURL;
      return Promise.reject(wrapped);
    }

    const status = error.response.status;

    // Шлюзовые 502/503/504 — тоже сетевой класс для баннера (nginx жив, но
    // backend за ним недоступен). На teardown-логику ниже не влияет.
    if (status === 502 || status === 503 || status === 504) {
      fireNetworkListeners(networkFailureListeners);
    }

    // ONLY a genuine 401 (token expired / revoked) tears down the session.
    // A 403 (master hitting an owner-only endpoint), 404, 429 (rate-limited
    // post-login burst), 5xx or 502 from ONE endpoint must NEVER log the user
    // out — otherwise a single failing request would nuke the whole session and
    // make every subsequent retry fail ("повторить не помогает"). Those statuses
    // simply reject and surface as that one screen's error, which React Query's
    // transient-retry policy (App.tsx) re-attempts.
    if (status === 401) {
      // Best-effort cleanup of the stale token; if another parallel 401 already
      // removed it, this is a no-op. `setAuthToken(null)` clears the in-memory
      // bearer so a coalesced re-login can't reuse the previous tenant's token.
      setAuthToken(null);
      await AsyncStorage.removeItem('token').catch(() => {});
      await AsyncStorage.removeItem('user').catch(() => {});
      fireAuthExpired();
    }

    return Promise.reject(error);
  },
);

export default api;
