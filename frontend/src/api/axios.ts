import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { clearPersistentCache } from '../utils/persistentCache';
import { purgeApiCache, purgeOfflineQueues } from '../utils/swCache';
import { rememberSessionEndedNotice } from '../utils/sessionNotice';
import { sessionPointLostMessage } from '../../../shared/utils/apiError';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  timeout: 15000,
});

// Best-effort reserve API base. When the site's own origin `/api` path is
// filtered by a carrier/VPN, an installed PWA still boots from its
// service-worker-cached shell but every same-origin `/api` call dies with a
// transport error and no fallback. This mirrors the mobile reserve ring: the
// same Yandex API Gateway the mobile app uses, which proxies to the backend.
// Configurable via env; an empty value disables the failover entirely (then
// behaviour is byte-for-byte identical to before this change).
const RESERVE_API_URL: string =
  import.meta.env.VITE_API_FALLBACK_URL || 'https://d5dpq4hcfoor5l4q1a97.wnq2w1o5.apigw.yandexcloud.net/api';

// Only these methods may be transparently retried against the reserve. A
// mutation (POST/PATCH/PUT/DELETE) that failed at the transport layer may still
// have reached the server, so re-sending it risks a double-write — never retry
// those. GET/HEAD/OPTIONS are idempotent and safe to replay once.
const IDEMPOTENT_METHODS = new Set(['get', 'head', 'options']);

// Custom marker so a request is retried against the reserve at most once (loop
// guard): once we flip it, an inner failure re-enters the interceptor and skips.
type ReserveRetryConfig = InternalAxiosRequestConfig & { _reserveRetried?: boolean };

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Guard against multiple simultaneous redirects causing race conditions.
// Uses a timestamp-based debounce instead of a permanent boolean flag
// to avoid the bug where the flag was never reset.
let lastRedirectTime = 0;

/**
 * Tear down the session and bounce to /login. Called ONLY when the token is
 * proven invalid by the session-validating endpoint (/auth/me). A full page
 * reload does NOT run AuthContext.logout(), so we purge the SW API cache and
 * the persist IndexedDB store here too (cross-tenant isolation on a shared
 * browser). Debounced so a wave of failures fires this once.
 */
function hardLogoutRedirect(): void {
  localStorage.removeItem('token');
  localStorage.removeItem('user');

  const now = Date.now();
  if (window.location.pathname !== '/login' && now - lastRedirectTime > 2000) {
    lastRedirectTime = now;
    void clearPersistentCache();
    void purgeApiCache();
    // Сессия мертва → её недоигранная SW-очередь мутаций тоже: replay берёт
    // токен ТЕКУЩЕЙ сессии, и очередь пользователя A нельзя доигрывать под
    // пользователем B. Двухканальная очистка (SW message + прямой IndexedDB);
    // SW-часть доработает через waitUntil даже после redirect'а.
    void purgeOfflineQueues();
    // Give the purge a brief head start, then redirect regardless — never hang
    // the user on a stuck SW. The direct caches.delete() resolves in a few ms.
    setTimeout(() => {
      window.location.href = '/login';
    }, 200);
  }
}

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError<{ message?: string }>) => {
    // Network error or server unreachable
    if (!error.response) {
      // ── Best-effort reserve failover ──────────────────────────────────────
      // `!error.response` is the ONLY signal that the origin `/api` path itself
      // is unreachable (DNS/timeout/blocked/no CORS), as opposed to a real HTTP
      // error from the server. In that case retry the SAME request ONCE against
      // the absolute reserve base — but only for idempotent methods
      // (GET/HEAD/OPTIONS), never for mutations, to avoid a double-write, and at
      // most once (loop guard via `_reserveRetried`). Re-issuing via
      // `api.request` re-runs the request interceptor, so Authorization /
      // withCredentials behaviour is byte-identical to the primary path.
      //
      // CORS reality: the reserve is a different origin, so this only succeeds
      // if the gateway returns CORS headers for our origin. If CORS blocks it,
      // the retry just fails and we fall through to today's rejection below —
      // best-effort, strictly never worse than the current behaviour.
      const config = error.config as ReserveRetryConfig | undefined;
      const method = (config?.method || '').toLowerCase();
      if (
        config &&
        RESERVE_API_URL &&
        !config._reserveRetried &&
        IDEMPOTENT_METHODS.has(method) &&
        config.baseURL !== RESERVE_API_URL
      ) {
        config._reserveRetried = true;
        config.baseURL = RESERVE_API_URL;
        try {
          return await api.request(config);
        } catch {
          // Reserve also unreachable / CORS-blocked → fall through to the
          // original network-error rejection. No regression vs. today.
        }
      }

      console.error('Network error:', error.message);
      return Promise.reject(new Error('Нет соединения с сервером'));
    }

    const status = error.response.status;
    const url = error.config?.url || '';

    // ── Session validity: /auth/me is the SOLE authority ───────────────────
    // A 401 means "this request was not authorized" — it does NOT mean the
    // session token is dead. The ONLY endpoint that proves the token itself is
    // invalid is /auth/me (it validates the bearer and nothing else). A 401
    // from any DATA endpoint (a permission-scoped resource the current role
    // can't read, an owner-only widget a master shouldn't hit, a deterministic
    // server-side failure on real data) must surface to React Query as an
    // error WITHOUT wiping a valid token — otherwise one unrelated 401 during
    // the post-refresh data fan-out logs the user out on EVERY refresh.
    //
    // This mirrors mobile, where the navigation gate is driven by
    // `useAuth().user` (revalidated via /auth/me), never by a data endpoint.
    //
    // AuthContext owns the /auth/me boot path: it clears the token only when
    // /auth/me itself returns 401/403. For a 401 on /auth/me that happens
    // OUTSIDE that boot flow (e.g. a background refreshUser after the token was
    // revoked), we tear the session down here so the user lands on /login.
    // ── Сессия потеряла свой филиал (163) ─────────────────────────────────
    // Единственное исключение из правила выше. Филиал лежит в подписанном
    // токене, и когда его архивируют или снимают у сотрудника доступ, сервер
    // отвечает 401 «Филиал больше не доступен — войдите заново» на КАЖДЫЙ
    // запрос, а не только на /auth/me. Токен после этого мёртв целиком —
    // держать его дальше значит показывать человеку экраны, где ни одна цифра
    // не обновится, и дать ему пробить чек в филиал, откуда его убрали.
    // Подставить другой филиал молча НЕЛЬЗЯ: он бы этого не заметил.
    //
    // Отличаем по ПОЛНОМУ тексту сервера (shared/utils/apiError.ts), а не по
    // одному коду 401: обычный 401 с денежной ручки — это отказ в доступе к
    // данным, и он не должен ронять живую сессию.
    //
    // ПРИЧИНУ ЗАПОМИНАЕМ ПЕРВОЙ СТРОКОЙ — до любого вызова hardLogoutRedirect
    // (тот же отказ мог прилететь и с /auth/me, и тогда сессию гасит ветка
    // ниже). Экран входа обязан объяснить, ПОЧЕМУ человека выкинуло, а после
    // перезагрузки на /login объяснять будет уже нечем.
    const pointLost = sessionPointLostMessage(error);
    if (pointLost) rememberSessionEndedNotice(pointLost);

    if (status === 401 && url.includes('/auth/me')) {
      hardLogoutRedirect();
    }

    if (pointLost) {
      hardLogoutRedirect();
    }

    // Rate-limited — log so we can see in console, but don't logout
    if (status === 429) {
      console.warn('Rate limited:', error.response.data);
    }

    // Server error — generic message
    if (status >= 500) {
      console.error(`Server error ${status}:`, error.response.data);
    }

    return Promise.reject(error);
  },
);

export default api;
