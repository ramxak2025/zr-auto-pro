import axios, { AxiosError, type AxiosRequestConfig, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { buildApiHosts, isHtmlApiPayload, nextUntriedApiHost, orderApiHosts } from './apiHosts';
import { AUTH_SESSION_ENVELOPE_KEY, parseAuthSessionEnvelope } from '../contexts/authSessionStorage';

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
// Поведение: идемпотентный GET/HEAD/OPTIONS обходит ВСЁ кольцо при transport-
// сбое, HTML-заглушке или 502/503/504. Мутации не ретраятся между хостами:
// таймаут не доказывает, что сервер не успел выполнить запись. Успешный хост
// запоминается в module state + AsyncStorage, а фоновая проба периодически
// пытается вернуть primary.
//
// HAPPY-EYEBALLS: вместо ожидания ~DEFAULT_TIMEOUT_MS на primary до первого
// failover'а — даём сохранённому/current хосту ограниченный head-start, затем
// гоняем GET /health по резервам параллельно. Так живой primary не флапает на
// платный gateway (live cold TLS: H1 ~5.2s vs H3 ~4.0s), а заблокированный
// blackhole добавляет не больше 1.5s. Быстрый DNS/RST отказ будит резервы
// немедленно. Старт,
// сохранённый хост и запросы синхронизированы через ensureApiHostReady().
// Параллельно дублируется ТОЛЬКО идемпотентный /health (GET). Даже /auth/login
// проходит хосты последовательно и только при доказанном route/proxy-сбое:
// все алиасы ведут на один backend, поэтому веер POST'ов зря умножал bcrypt и
// глобальный rate-limit. Обычные мутации (POST/PATCH/...) НИКОГДА не гоняются
// параллельно и не ретраятся вслепую — иначе возможно задвоение записи.
//
// ГАРАНТИЯ ИНЕРТНОСТИ: пока apiFallbackUrls пуст, API_HOSTS.length === 1 —
// межхостовый retry и подмена baseURL не выполняются; activeBaseUrl навсегда
// равен API_BASE_URL. Recovery может делать обычный GET /health этого
// единственного хоста, чтобы честно скрывать/показывать offline-баннер.

// Нормализация кольца вынесена в чистый модуль apiHosts.ts (jest-тесты там же).
// КРИТИЧНО (инцидент 05.07): резерв без пути наследует «/api» primary —
// «https://autexa.pw» → «https://autexa.pw/api». Уже раскатанные конфиги с
// голым origin (embedded 36/38 + старые OTA) самолечатся этим кодом.
const API_HOSTS: readonly string[] = buildApiHosts(API_BASE_URL, Constants.expoConfig?.extra?.apiFallbackUrls);

/** Активная база всех последующих запросов (module state). */
let activeBaseUrl = API_BASE_URL;

/** Текущая активная база — для health-проб OfflineBanner. */
export function getActiveApiBaseUrl(): string {
  return activeBaseUrl;
}

const ACTIVE_BASE_STORAGE_KEY = 'active_api_base_v1';
// Пока живём на резерве — как часто пробуем вернуться на primary. Было 10 мин:
// кратковременная просадка primary (blip) уводила сессию на более медленный
// резерв на все 10 минут. ~75 с (в окне 60–90 с) возвращает почти сразу, но не
// спамит: таймер живёт ТОЛЬКО пока activeBaseUrl !== primary (обычно никогда).
const PRIMARY_RETURN_PROBE_INTERVAL_MS = 75_000;
const PRIMARY_RETURN_PROBE_TIMEOUT_MS = 8_000;
/** Короткий таймаут одной пробы стартовой гонки хостов (happy-eyeballs). */
const LAUNCH_HOST_RACE_TIMEOUT_MS = 8_000;
/** Give the sticky/current host a small lead before waking reserve routes. */
const PREFERRED_HOST_HEAD_START_MS = 1_500;
/** Burst NetInfo/AppState/banner events collapse into one real health race. */
const RESELECT_DEBOUNCE_MS = 150;
/** A stale/corrupt native storage bridge is only an optional routing hint. */
const HOST_HINT_READ_TIMEOUT_MS = 750;
/** Route changes must never hold every API request behind an endless barrier. */
const RESELECT_SESSION_BUDGET_MS = 9_000;
/** Avoid multiplying one backend outage across every query retry wave. */
const HOST_ROUTE_FAILURE_COOLDOWN_MS = 8_000;
const hostRouteFailureUntil = new Map<string, number>();

function markHostRouteFailure(host: string): void {
  if (API_HOSTS.includes(host)) hostRouteFailureUntil.set(host, Date.now() + HOST_ROUTE_FAILURE_COOLDOWN_MS);
}

function markHostHealthy(host: unknown): void {
  if (typeof host === 'string') hostRouteFailureUntil.delete(host);
}

function circuitOpenHosts(): string[] {
  const now = Date.now();
  const open: string[] = [];
  for (const [host, until] of hostRouteFailureUntil) {
    if (until <= now) hostRouteFailureUntil.delete(host);
    else open.push(host);
  }
  return open;
}

/**
 * Проба живости ОДНОГО хоста кольца: GET {base}/health с коротким таймаутом,
 * true только на 2xx с точным JSON-маркером `{status:"ok"}` (HTML-200 или
 * посторонний JSON-200 = captive-portal / чужой апстрим — тот же страж, что
 * в axios / OfflineBanner / backendRecovery). Ходит через fetch (не через
 * инстанс axios), поэтому не
 * трогает auth-интерсепторы и не путается с «живым» трафиком. Никогда не
 * бросает — резолвит true/false.
 */
function probeHostHealth(base: string, timeoutMs: number, raceSignal?: AbortSignal): Promise<boolean> {
  const abort = new AbortController();
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      raceSignal?.removeEventListener?.('abort', onRaceAbort);
      resolve(result);
    };
    const onRaceAbort = () => {
      abort.abort();
      finish(false);
    };

    // AbortController is only a cancellation hint in some RN/native fetch
    // implementations. The timer resolves OUR promise itself, so a socket or
    // res.text() that ignores abort can never deadlock app initialization.
    const timer = setTimeout(() => {
      abort.abort();
      finish(false);
    }, timeoutMs);
    raceSignal?.addEventListener?.('abort', onRaceAbort);

    void (async () => {
      try {
        const res = await fetch(`${base}/health`, { method: 'GET', signal: abort.signal });
        if (!res.ok) {
          finish(false);
          return;
        }
        const body = await res.text();
        if (isHtmlApiPayload(body, res.headers.get('content-type'))) {
          finish(false);
          return;
        }
        // A proxy/captive portal can return a non-HTML 200 as well. Accept only
        // the marker emitted by our HealthController, not merely "some 2xx".
        const parsed = JSON.parse(body) as { status?: unknown };
        finish(parsed?.status === 'ok');
      } catch {
        finish(false);
      }
    })();
  });
}

/** First host gets a short lead; reserves then race concurrently. */
function findFirstHealthyHost(
  hosts: readonly string[],
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<string | null> {
  if (hosts.length === 0) return Promise.resolve(null);
  return new Promise((resolve) => {
    const raceAbort = new AbortController();
    let settled = false;
    let completed = 0;
    let launched = 0;
    let reservesLaunched = hosts.length <= 1;
    let headStartTimer: ReturnType<typeof setTimeout> | null = null;

    const finish = (winner: string | null) => {
      if (settled) return;
      settled = true;
      if (headStartTimer) clearTimeout(headStartTimer);
      externalSignal?.removeEventListener?.('abort', onExternalAbort);
      raceAbort.abort();
      resolve(winner);
    };
    const onExternalAbort = () => finish(null);

    if (externalSignal?.aborted) {
      finish(null);
      return;
    }
    externalSignal?.addEventListener?.('abort', onExternalAbort);

    function launch(host: string, index: number) {
      launched += 1;
      void probeHostHealth(host, timeoutMs, raceAbort.signal).then((ok) => {
        if (settled) return;
        completed += 1;
        if (ok) {
          finish(host);
          return;
        }
        // A fast failure of the preferred host should not pay the head-start.
        if (index === 0) launchReserves();
        if (reservesLaunched && completed === launched && launched === hosts.length) finish(null);
      });
    }

    function launchReserves() {
      if (reservesLaunched || settled) return;
      reservesLaunched = true;
      if (headStartTimer) {
        clearTimeout(headStartTimer);
        headStartTimer = null;
      }
      hosts.slice(1).forEach((host, offset) => launch(host, offset + 1));
    }

    launch(hosts[0], 0);
    if (hosts.length > 1) {
      headStartTimer = setTimeout(launchReserves, PREFERRED_HOST_HEAD_START_MS);
    }
  });
}

let primaryReturnTimer: ReturnType<typeof setInterval> | null = null;
let selectionGeneration = 0;
let apiHostReady = false;
let apiHostReadyPromise: Promise<void> | null = null;
let reselectInFlight: Promise<string | null> | null = null;
let reselectProbeStarted = false;
let reselectRequestedAgain = false;
let reselectPassAbort: AbortController | null = null;
let activeBasePersistence: Promise<void> = Promise.resolve();
type ApiRouteReadyListener = () => void;
const apiRouteReadyListeners = new Set<ApiRouteReadyListener>();

/** Positive whole-ring health evidence, used by unresolved session recovery. */
export function onApiRouteReady(listener: ApiRouteReadyListener): () => void {
  apiRouteReadyListeners.add(listener);
  return () => apiRouteReadyListeners.delete(listener);
}

function fireApiRouteReady(): void {
  for (const listener of apiRouteReadyListeners) {
    try {
      listener();
    } catch {
      // A UI recovery subscriber must never break route adoption.
    }
  }
}

/**
 * AsyncStorage is only a sticky-ordering optimisation. Some RN native bridge
 * failures never reject, so this wrapper resolves independently and ignores a
 * late value instead of deadlocking cold-start, login and every interceptor.
 */
function readStoredBaseHint(): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), HOST_HINT_READ_TIMEOUT_MS);
    void AsyncStorage.getItem(ACTIVE_BASE_STORAGE_KEY).then(finish, () => finish(null));
  });
}

function stopPrimaryReturnProbe(): void {
  if (primaryReturnTimer) {
    clearInterval(primaryReturnTimer);
    primaryReturnTimer = null;
  }
}

/** Пока живём на резерве — раз в ~75 с пробуем /health primary и возвращаемся. */
function ensurePrimaryReturnProbe(): void {
  if (primaryReturnTimer || activeBaseUrl === API_BASE_URL) return;
  primaryReturnTimer = setInterval(async () => {
    if (activeBaseUrl === API_BASE_URL) {
      stopPrimaryReturnProbe();
      return;
    }
    const generation = selectionGeneration;
    if (await probeHostHealth(API_BASE_URL, PRIMARY_RETURN_PROBE_TIMEOUT_MS)) {
      // A network reselect/failover that happened while this probe was in
      // flight is newer evidence and must win.
      adoptActiveBase(API_BASE_URL, generation);
    }
    // primary всё ещё недоступен — остаёмся на резерве до следующей пробы.
  }, PRIMARY_RETURN_PROBE_INTERVAL_MS);
}

/** Serialize storage writes and skip stale generations. */
function persistActiveBase(next: string, generation: number): void {
  activeBasePersistence = activeBasePersistence
    .catch(() => {})
    .then(async () => {
      if (generation !== selectionGeneration || activeBaseUrl !== next) return;
      if (next === API_BASE_URL) {
        await AsyncStorage.removeItem(ACTIVE_BASE_STORAGE_KEY).catch(() => {});
      } else {
        await AsyncStorage.setItem(ACTIVE_BASE_STORAGE_KEY, next).catch(() => {});
      }
    });
}

/**
 * Adopt only ring members. `expectedGeneration` protects async health races;
 * direct request success omits it and invalidates every older selector.
 */
function adoptActiveBase(next: string, expectedGeneration?: number): boolean {
  if (!API_HOSTS.includes(next)) return false;
  if (expectedGeneration !== undefined && expectedGeneration !== selectionGeneration) return false;

  if (activeBaseUrl !== next && expectedGeneration === undefined) selectionGeneration += 1;
  activeBaseUrl = next;
  markHostHealthy(next);
  apiHostReady = true;
  const generation = selectionGeneration;
  if (next === API_BASE_URL) {
    stopPrimaryReturnProbe();
  } else {
    ensurePrimaryReturnProbe();
  }
  persistActiveBase(next, generation);
  return true;
}

/**
 * Awaitable one-time initialization. The persisted host is only an ordering
 * hint: it is never adopted until its /health succeeds. Request interceptors
 * await this promise, so a late AsyncStorage read cannot overwrite a newer
 * health winner or request failover.
 */
export function ensureApiHostReady(): Promise<void> {
  // A meaningful route change is a barrier even after cold-start readiness:
  // mutations must not leave on the stale Wi-Fi/LTE/VPN route while its
  // selector is already in flight. Hard probe deadlines bound this await.
  if (reselectInFlight) return reselectInFlight.then(() => undefined);
  if (apiHostReady) return Promise.resolve();
  if (apiHostReadyPromise) return apiHostReadyPromise;

  const generation = ++selectionGeneration;
  apiHostReadyPromise = (async () => {
    if (API_HOSTS.length <= 1) {
      apiHostReady = true;
      persistActiveBase(API_BASE_URL, generation);
      return;
    }

    const stored = await readStoredBaseHint();
    if (generation !== selectionGeneration) {
      if (reselectInFlight) await reselectInFlight;
      apiHostReady = true;
      return;
    }

    const storedHint = stored && API_HOSTS.includes(stored) ? stored : null;
    if (stored && !storedHint) {
      // Old bare origin/removed host: queue a generation-checked cleanup.
      persistActiveBase(API_BASE_URL, generation);
    }

    const winner = await findFirstHealthyHost(orderApiHosts(API_HOSTS, storedHint), LAUNCH_HOST_RACE_TIMEOUT_MS);
    if (generation === selectionGeneration && winner) adoptActiveBase(winner, generation);
    if (generation !== selectionGeneration && reselectInFlight) await reselectInFlight;
    apiHostReady = true;
  })().finally(() => {
    apiHostReadyPromise = null;
  });
  return apiHostReadyPromise;
}

/**
 * Re-run health selection after Wi-Fi/LTE/VPN/foreground changes. Calls in
 * the same burst share one delayed, real probe. A generation token prevents
 * an older probe from overwriting a newer request success.
 */
export function reselectApiHost(forceFreshRoute = false): Promise<string | null> {
  if (reselectInFlight) {
    // BackendRecovery, OfflineBanner and axios may all report the SAME outage;
    // they join the current selector. Only a caller that observed an actual
    // route/foreground transition may invalidate an already-running pass.
    if (forceFreshRoute && reselectProbeStarted) {
      reselectRequestedAgain = true;
      selectionGeneration += 1;
      reselectPassAbort?.abort();
    }
    return reselectInFlight;
  }

  selectionGeneration += 1;
  const work = new Promise<string | null>((resolve) => {
    setTimeout(() => {
      void (async () => {
        let finalResult: string | null = null;
        let budgetExpired = false;
        const budgetTimer = setTimeout(() => {
          budgetExpired = true;
          reselectPassAbort?.abort();
        }, RESELECT_SESSION_BUDGET_MS);
        do {
          reselectRequestedAgain = false;
          reselectProbeStarted = true;
          const passAbort = new AbortController();
          reselectPassAbort = passAbort;
          const generation = selectionGeneration;
          const winner = await findFirstHealthyHost(
            orderApiHosts(API_HOSTS, activeBaseUrl),
            LAUNCH_HOST_RACE_TIMEOUT_MS,
            passAbort.signal,
          );
          if (generation === selectionGeneration) {
            if (winner) {
              // A route transition invalidates short-lived failures learned on
              // the previous Wi-Fi/LTE/VPN path. Otherwise a healthy H2/H3
              // could still be skipped after the new winner later fails.
              hostRouteFailureUntil.clear();
              if (adoptActiveBase(winner, generation)) fireApiRouteReady();
            }
            finalResult = winner;
          } else {
            // A successful real request or queued newer selector is fresher.
            finalResult = apiHostReady ? activeBaseUrl : null;
          }
          if (reselectPassAbort === passAbort) reselectPassAbort = null;
          reselectProbeStarted = false;
        } while (reselectRequestedAgain && !budgetExpired);
        clearTimeout(budgetTimer);
        apiHostReady = true;
        resolve(finalResult);
      })();
    }, RESELECT_DEBOUNCE_MS);
  });
  const shared = work.finally(() => {
    if (reselectInFlight === shared) {
      reselectInFlight = null;
      reselectProbeStarted = false;
      reselectRequestedAgain = false;
      reselectPassAbort = null;
    }
  });
  reselectInFlight = shared;
  return shared;
}

/** Флаги failover на конфиге одного логического запроса. */
type FailoverAwareConfig = InternalAxiosRequestConfig & {
  _failoverBaseUrl?: string;
  _failoverTriedBases?: string[];
  _disableHostFailover?: boolean;
  /** Native route epoch at the moment this physical attempt was dispatched. */
  _routeGeneration?: number;
  /** Auth snapshot used by this physical attempt; protects a newer session. */
  _authEpoch?: number;
  _authToken?: string | null;
  /** Logout-only cleanup may finish with its captured old bearer after local teardown. */
  _allowCapturedAuthDispatch?: boolean;
  /** loginAcrossHosts emits one network failure only after every route fails. */
  _suppressNetworkFailure?: boolean;
};

/**
 * Это POST /auth/login? baseURL уже содержит «/api», поэтому матчим по хвосту
 * `config.url` (обычно '/auth/login'; допускаем абсолютный URL и trailing
 * slash, но НЕ '/auth/login-history' и т. п. — якорь по концу строки).
 */
function isLoginRequest(cfg: InternalAxiosRequestConfig): boolean {
  if ((cfg.method || 'get').toLowerCase() !== 'post') return false;
  return /(^|\/)auth\/login\/?$/.test(cfg.url || '');
}

/** A response from an older Wi-Fi/LTE/VPN epoch must not change new routing. */
function adoptRequestWinner(next: string, cfg: FailoverAwareConfig): boolean {
  if (cfg._routeGeneration === undefined || cfg._routeGeneration !== selectionGeneration) return false;
  if (next === activeBaseUrl) return true;
  selectionGeneration += 1;
  return adoptActiveBase(next, selectionGeneration);
}

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
// into a hard error the user had to "Повторить" past. 15s (was 12s) also
// tolerates the slow VPN path many RF users are forced onto, while still
// failing a genuinely dead connection — the host-failover ring bounds the
// worst case anyway; React Query's network-error retries (App.tsx) +
// persistent cache cover the rest.
const DEFAULT_TIMEOUT_MS = 15_000;
/** Auth persistence is useful, but a wedged native bridge must not hang HTTP. */
const AUTH_TOKEN_READ_TIMEOUT_MS = 750;

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
let authTokenEpoch = 0;
// Unlike authTokenEpoch, this advances only on an explicit AuthContext/session
// transition, not when the one-time native-storage load is adopted. A request
// that started before login/logout must not wake from that storage await and
// silently inherit the new bearer.
let explicitAuthTransitionEpoch = 0;
let authTokenLoadPromise: Promise<string | null> | null = null;

function readAuthTokenWithDeadline(): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (token: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(token);
    };
    const timer = setTimeout(() => finish(null), AUTH_TOKEN_READ_TIMEOUT_MS);
    // The versioned envelope is authoritative. Its logged-out tombstone must
    // beat a stale legacy mirror, and its token B must beat legacy token A
    // while a native repair is still pending. Legacy remains a migration
    // fallback for installations that have not written the envelope yet.
    void Promise.all([
      AsyncStorage.getItem(AUTH_SESSION_ENVELOPE_KEY).catch(() => null),
      AsyncStorage.getItem('token').catch(() => null),
    ]).then(([rawEnvelope, legacyToken]) => {
      const envelope = parseAuthSessionEnvelope(rawEnvelope);
      if (envelope) {
        finish(envelope.token);
        return;
      }
      finish(legacyToken ?? null);
    }, () => finish(null));
  });
}

/**
 * Update the in-memory auth token. Called by AuthContext on login
 * (`setAuthToken(token)`), logout and the 401 handler (`setAuthToken(null)`).
 * Passing `null` clears the bearer for every subsequent request.
 */
export function setAuthToken(token: string | null): void {
  if (cachedAuthToken !== token) {
    authTokenEpoch += 1;
    explicitAuthTransitionEpoch += 1;
  }
  cachedAuthToken = token;
}

/**
 * Dispatch a bounded, best-effort logout cleanup with the bearer captured by
 * AuthContext before it clears local state. The request may cross the local
 * A→logged-out/B boundary, but it can only carry token A; it can never inherit
 * B, and a late 401/response cannot expire or publish into B. Used only for
 * push-token unregister + server-side JWT revocation.
 */
export function requestWithCapturedAuth<T = unknown>(
  token: string,
  config: AxiosRequestConfig,
  capturedEpoch = authTokenEpoch,
): Promise<AxiosResponse<T>> {
  const captured: AxiosRequestConfig & {
    _authEpoch: number;
    _authToken: string;
    _allowCapturedAuthDispatch: boolean;
    _disableHostFailover: boolean;
    _suppressNetworkFailure: boolean;
  } = {
    ...config,
    timeout: config.timeout ?? 8_000,
    _authEpoch: capturedEpoch,
    _authToken: token,
    _allowCapturedAuthDispatch: true,
    _disableHostFailover: true,
    _suppressNetworkFailure: true,
  };
  return api.request<T>(captured);
}

/**
 * Capture token A and its epoch once, then allow a short cleanup sequence to
 * finish after the local logout boundary. This matters for push unregister →
 * JWT revoke: the second request is intentionally created only after the
 * first settles, but must still belong to A even if B signs in meanwhile.
 */
export function createCapturedAuthRequester(token: string) {
  const capturedEpoch = authTokenEpoch;
  return <T = unknown>(config: AxiosRequestConfig): Promise<AxiosResponse<T>> =>
    requestWithCapturedAuth<T>(token, config, capturedEpoch);
}

function staleAuthCancellation(config: InternalAxiosRequestConfig): Error {
  return Object.assign(new Error('Request belongs to a stale auth session'), {
    isAxiosError: true,
    code: 'ERR_CANCELED',
    __CANCEL__: true,
    config,
  });
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
  const cfg = config as FailoverAwareConfig;

  // Capture auth BEFORE the route barrier. A request created by token A must
  // not wait for Wi-Fi/VPN selection, wake after login B and silently become
  // a token-B request. Native storage is bounded for the same reason.
  if (cfg._authEpoch === undefined) {
    if (cachedAuthToken === undefined) {
      const transitionAtStart = explicitAuthTransitionEpoch;
      authTokenLoadPromise ??= readAuthTokenWithDeadline();
      const loadedToken = await authTokenLoadPromise;
      // setAuthToken() ran while this logical request was suspended on the
      // native bridge. Cancelling is the only safe outcome for mutations: the
      // payload may belong to the previous tenant/session and must never be
      // dispatched with the newly installed bearer. Multiple callers sharing
      // the same initial storage load do not trip this guard, because adopting
      // that load changes authTokenEpoch but not explicitAuthTransitionEpoch.
      if (transitionAtStart !== explicitAuthTransitionEpoch) {
        throw staleAuthCancellation(config);
      }
      if (cachedAuthToken === undefined) {
        cachedAuthToken = loadedToken;
        authTokenEpoch += 1;
      }
      authTokenLoadPromise = null;
    }
    cfg._authEpoch = authTokenEpoch;
    cfg._authToken = cachedAuthToken ?? null;
  }

  // No request can race a late persisted-host restore or a meaningful native
  // route change. Hard deadlines bound both storage and health probing.
  await ensureApiHostReady();

  // Never let one logical request cross a session boundary. This check runs
  // after every await and also protects retries that preserve the snapshot.
  if (cfg._authEpoch !== authTokenEpoch && !cfg._allowCapturedAuthDispatch) {
    throw staleAuthCancellation(config);
  }

  // Route to the selected base (or the explicit next ring member) and keep
  // traversal state on the config across axios retries.
  cfg._routeGeneration = selectionGeneration;
  if (API_HOSTS.length > 1) {
    const selectedBase = cfg._failoverBaseUrl ?? activeBaseUrl;
    config.baseURL = selectedBase;
    if (!cfg._failoverTriedBases?.includes(selectedBase)) {
      cfg._failoverTriedBases = [...(cfg._failoverTriedBases ?? []), selectedBase];
    }
  }

  if (cfg._authToken) {
    config.headers.Authorization = `Bearer ${cfg._authToken}`;
  } else {
    delete config.headers.Authorization;
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

function fireAuthExpired() {
  // Token/epoch matching in the 401 handler is the coalescer: the first 401
  // clears the current bearer, so every parallel response from that bearer is
  // stale and ignored. A wall-clock debounce would be unsafe because a newly
  // logged-in session can legitimately expire inside the old 2s window.
  authListeners.forEach((fn) => {
    try {
      fn();
    } catch {
      // Listener errors must not block other listeners or the next
      // 401 from firing the chain.
    }
  });
}

// ── HTML-страж (инцидент 05.07) — ОТДЕЛЬНЫЙ интерсептор, зарегистрирован ДО
// основной пары. КРИТИЧНО (находка ревью): reject из success-хендлера НЕ
// попадает в error-хендлер ТОЙ ЖЕ пары (axios ловит только ошибки более
// ранних звеньев цепочки) — поэтому страж живёт первым звеном, и его reject
// честно проваливается в error-хендлер основной пары ниже → срабатывает
// failover на следующий хост кольца и сигнал баннеру.
// Суть: HTML вместо JSON от нашего /api = чужой апстрим (битая база кольца,
// captive-portal оператора, страница ошибки хостинга). Такой «успех» раньше
// уезжал в React Query как данные и ронял экраны (count/length/id of
// undefined). Ошибка без .response = сетевой класс. Межхостовый retry всё
// равно разрешён только для GET/HEAD/OPTIONS: мутации нельзя задваивать на
// основании ответа посредника.
api.interceptors.response.use((res) => {
  const cfg = res.config as FailoverAwareConfig;
  if (cfg._authEpoch !== undefined && cfg._authEpoch !== authTokenEpoch) {
    return Promise.reject(staleAuthCancellation(res.config));
  }
  if (isHtmlApiPayload(res.data, res.headers?.['content-type'])) {
    const e = new Error(
      `Сервер вернул HTML вместо данных (чужой апстрим/портал оператора)\nURL: ${res.config?.baseURL || activeBaseUrl}`,
    ) as Error & { isAxiosError: boolean; code: string; config: unknown };
    e.isAxiosError = true;
    e.code = 'ERR_HTML_RESPONSE';
    e.config = res.config;
    return Promise.reject(e);
  }
  return res;
});

api.interceptors.response.use(
  // Success path: почти pass-through (no 304 substitution, no ETag
  // bookkeeping — see the "ETag … REMOVED" note above for why). Единственное
  // дополнение — сигнал «сеть жива» для офлайн-очереди чеков и баннера.
  (res) => {
    markHostHealthy(res.config?.baseURL);
    fireNetworkListeners(requestSuccessListeners);
    return res;
  },
  async (error: AxiosError<{ message?: string }>) => {
    // Callers may cancel requests deliberately; cancellation is not an
    // offline event and must not be wrapped as a transport failure.
    if (axios.isCancel(error) || error.code === 'ERR_CANCELED') return Promise.reject(error);

    const cfg = error.config as FailoverAwareConfig | undefined;
    const status = error.response?.status;
    const gatewayFailure = status === 502 || status === 503 || status === 504;
    const routeStatusFailure = status === 408 || status === 421 || status === 451;
    // Axios sends non-2xx responses straight to this error handler, so the
    // success-path HTML guard cannot see a captive/WAF page with 403/451.
    // Detect it here too; JSON 4xx remains an authoritative API response.
    const htmlErrorResponse = isHtmlApiPayload(
      error.response?.data,
      error.response?.headers?.['content-type'],
    );
    const transportOrHtmlFailure = !error.response || error.code === 'ERR_HTML_RESPONSE' || htmlErrorResponse;
    const failoverClassFailure = transportOrHtmlFailure || gatewayFailure || routeStatusFailure;
    const method = (cfg?.method || 'get').toLowerCase();
    const idempotent = method === 'get' || method === 'head' || method === 'options';

    // Idempotent requests traverse every host exactly once. Mutations never
    // enter this path: a timeout/HTML/proxy status cannot prove that a write
    // was not already applied by the backend.
    if (cfg && API_HOSTS.length > 1 && idempotent && !cfg._disableHostFailover && failoverClassFailure) {
      const failedBase =
        typeof cfg.baseURL === 'string' && API_HOSTS.includes(cfg.baseURL) ? cfg.baseURL : activeBaseUrl;
      markHostRouteFailure(failedBase);
      const tried = cfg._failoverTriedBases ?? [failedBase];
      // One logical request still gets a complete first traversal. Subsequent
      // query/retry waves skip hosts that just proved dead, collapsing a
      // backend-wide outage from up to 21 requests/query to roughly one per
      // retry until the short circuit expires or a health reselect clears it.
      const nextBase = nextUntriedApiHost(API_HOSTS, failedBase, [...tried, ...circuitOpenHosts()]);
      if (nextBase) {
        cfg._failoverBaseUrl = nextBase;
        cfg._failoverTriedBases = [...new Set([...tried, failedBase])];
        const retried = await api.request(cfg);
        const successfulBase =
          typeof retried.config.baseURL === 'string' && API_HOSTS.includes(retried.config.baseURL)
            ? retried.config.baseURL
            : nextBase;
        adoptRequestWinner(successfulBase, retried.config as FailoverAwareConfig);
        return retried;
      }
    }

    if (!error.response) {
      if (!cfg?._suppressNetworkFailure) fireNetworkListeners(networkFailureListeners);
      const baseURL = error.config?.baseURL || API_BASE_URL;
      const reason = error.code || error.message || 'unknown';
      // Preserve the axios/route identity even when a native adapter omits
      // `code` (observed on a few Android DNS/TLS failures). loginAcrossHosts
      // must still recognise this as a route failure and try the next alias;
      // a plain Error here used to stop the ring after H1.
      const wrapped = Object.assign(
        new Error(`Нет соединения с сервером\nURL: ${baseURL}\nПричина: ${reason}`),
        {
          isAxiosError: true,
          code: error.code,
          baseURL,
          config: error.config,
        },
      );
      return Promise.reject(wrapped);
    }

    // Only the FINAL gateway failure emits offline/recovery work; intermediate
    // 502/503/504 responses have already moved to the next ring member above.
    if ((gatewayFailure || routeStatusFailure || htmlErrorResponse) && !cfg?._suppressNetworkFailure) {
      fireNetworkListeners(networkFailureListeners);
    }

    // Expire only the exact bearer epoch that produced this 401. A response
    // from token A may arrive after login committed token B; it must never
    // delete B from memory/storage. Anonymous/public 401s are ignored too.
    const authSnapshotIsCurrent =
      !!cfg?._authToken && cfg._authEpoch === authTokenEpoch && cfg._authToken === cachedAuthToken;
    if (status === 401 && cfg && !isLoginRequest(cfg) && authSnapshotIsCurrent) {
      // Persistence belongs to AuthContext's serialized session-transition
      // queue. Removing native-storage keys here can race a newer login and
      // delete token/user B after they were written. Clear the in-memory
      // bearer synchronously, then let the listener enqueue an ordered wipe.
      setAuthToken(null);
      fireAuthExpired();
    }

    return Promise.reject(error);
  },
);

/**
 * Compatibility wrapper for the existing App bootstrap. The actual work is
 * the same awaitable barrier used by every request; repeated calls are no-op.
 */
export function raceInitialActiveHost(): void {
  void ensureApiHostReady();
}

/** Конфиг одной ограниченной попытки входа на конкретный хост. */
type LoginAttemptConfig = AxiosRequestConfig &
  Pick<
    FailoverAwareConfig,
    '_failoverBaseUrl' | '_disableHostFailover' | '_suppressNetworkFailure'
  >;

/** Bound a stale route without making normal VPN logins artificially tight. */
const LOGIN_HOST_TIMEOUT_MS = 8_000;
/** One user action must not accumulate three independent timeout budgets. */
const LOGIN_TOTAL_BUDGET_MS = 30_000;
/** Leave room for JS/bridge hand-off so the final ring member can be sent. */
const LOGIN_BUDGET_HANDOFF_RESERVE_MS = 300;

function waitForLoginRouteBarrier(
  barrier: Promise<void>,
  deadline: number,
  signal: AbortSignal,
): Promise<boolean> {
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0 || signal.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ready: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener?.('abort', onAbort);
      resolve(ready);
    };
    const onAbort = () => finish(false);
    const timer = setTimeout(() => finish(false), remainingMs);
    signal.addEventListener?.('abort', onAbort);
    void barrier.then(() => finish(true), () => finish(true));
  });
}

/**
 * Fail over only when the request demonstrably failed on the route/proxy.
 * Credential, validation and rate-limit answers are authoritative and must
 * never be multiplied across aliases of the same backend.
 */
function isLoginHostRouteFailure(error: unknown): boolean {
  const candidate = error as AxiosError | undefined;
  const status = candidate?.response?.status;
  if (
    isHtmlApiPayload(candidate?.response?.data, candidate?.response?.headers?.['content-type']) ||
    candidate?.code === 'ERR_HTML_RESPONSE'
  ) {
    return true;
  }
  if (!candidate?.response) {
    return (
      axios.isAxiosError(error) ||
      candidate?.code === 'ERR_NETWORK' ||
      candidate?.code === 'ECONNABORTED' ||
      candidate?.code === 'ETIMEDOUT'
    );
  }
  return status === 403 || status === 404 || status === 405 || status === 408 || status === 421 || status === 451 ||
    status === 502 || status === 503 || status === 504;
}

/**
 * Safe login failover. Start with the already health-checked active host and
 * move through the ring only for route/proxy failures. The aliases terminate
 * at one backend, whose global guard charges every POST /auth/login; a
 * parallel fan-out therefore turns one tap into three password checks and
 * three rate-limit increments even when loser requests are later cancelled.
 *
 * 400/401/422/429/500 are authoritative and stop immediately. This public
 * backend route has no permission guard and never emits 403, so any 403 is a
 * route-level WAF/operator refusal and may safely try another alias.
 * Transport/timeouts, HTML portal/WAF pages, 403/404/405 route mismatches,
 * censorship 451 and 502-504 may try the next host. Each host is attempted at
 * most once, normal login sends exactly one request, and all route failures
 * emit one recovery event only after the ring is exhausted.
 */
export async function loginAcrossHosts<T = unknown>(data: unknown): Promise<AxiosResponse<T>> {
  let lastRouteError: unknown;
  let totalBudgetExpired = false;
  const loginDeadline = Date.now() + LOGIN_TOTAL_BUDGET_MS;
  const totalAbort = new AbortController();
  const totalTimer = setTimeout(() => {
    totalBudgetExpired = true;
    totalAbort.abort();
  }, LOGIN_TOTAL_BUDGET_MS);
  try {
    const attemptedHosts = new Set<string>();
    while (attemptedHosts.size < API_HOSTS.length) {
      // Re-read the ring after every bounded route barrier. If the user turns
      // VPN on while H1 is timing out and the selector adopts H3, the next
      // POST must follow fresh H3 rather than a stale order captured at tap.
      const routeReady = await waitForLoginRouteBarrier(
        ensureApiHostReady(),
        loginDeadline,
        totalAbort.signal,
      );
      const host = orderApiHosts(API_HOSTS, activeBaseUrl).find((candidate) => !attemptedHosts.has(candidate));
      if (!routeReady || !host) {
        totalBudgetExpired = true;
        const timeoutHost = host ?? activeBaseUrl;
        lastRouteError = Object.assign(
          new Error(`Нет соединения с сервером\nURL: ${timeoutHost}\nПричина: общий таймаут входа`),
          { code: 'ECONNABORTED', baseURL: timeoutHost },
        );
        break;
      }
      attemptedHosts.add(host);
      try {
        const remainingMs = loginDeadline - Date.now();
        if (remainingMs <= 0) {
          totalBudgetExpired = true;
          lastRouteError = Object.assign(
            new Error(`Нет соединения с сервером\nURL: ${host}\nПричина: общий таймаут входа`),
            { code: 'ECONNABORTED', baseURL: host },
          );
          break;
        }
        const hostsLeft = API_HOSTS.length - attemptedHosts.size + 1;
        // A fixed 8s per host could spend most of the 30s budget on H1/H2 after
        // cold-start selection and never send H3. Share the remaining budget
        // fairly, while preserving the 8s ceiling when earlier routes fail
        // fast. Every ring member therefore receives a real attempt.
        const fairShareMs = Math.max(
          1,
          Math.floor((remainingMs - LOGIN_BUDGET_HANDOFF_RESERVE_MS) / hostsLeft),
        );
        const cfg: LoginAttemptConfig = {
          method: 'post',
          url: '/auth/login',
          data,
          signal: totalAbort.signal,
          timeout: Math.min(LOGIN_HOST_TIMEOUT_MS, fairShareMs),
          _failoverBaseUrl: host,
          _disableHostFailover: true,
          _suppressNetworkFailure: true,
        };
        const response = await api.request<T>(cfg);
        const successfulBase =
          typeof response.config.baseURL === 'string' && API_HOSTS.includes(response.config.baseURL)
            ? response.config.baseURL
            : host;
        adoptRequestWinner(successfulBase, response.config as FailoverAwareConfig);
        return response;
      } catch (error) {
        if (totalBudgetExpired) {
          lastRouteError = Object.assign(
            new Error(`Нет соединения с сервером\nURL: ${host}\nПричина: общий таймаут входа`),
            { code: 'ECONNABORTED', baseURL: host },
          );
          break;
        }
        if (!isLoginHostRouteFailure(error)) throw error;
        lastRouteError = error;
      }
    }
  } finally {
    clearTimeout(totalTimer);
  }

  fireNetworkListeners(networkFailureListeners);
  throw lastRouteError ?? new Error('Нет доступных API-хостов');
}

export default api;
