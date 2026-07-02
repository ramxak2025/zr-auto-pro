import axios, { AxiosError } from 'axios';
import { clearPersistentCache } from '../utils/persistentCache';
import { purgeApiCache, purgeOfflineQueues } from '../utils/swCache';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  timeout: 15000,
});

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
  (error: AxiosError<{ message?: string }>) => {
    // Network error or server unreachable
    if (!error.response) {
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
    if (status === 401 && url.includes('/auth/me')) {
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
