import axios, { AxiosError } from 'axios';
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

// Derive server origin for image URLs (strip /api suffix)
export const SERVER_URL = API_BASE_URL.replace(/\/api\/?$/, '');

/** Resolve a relative image path (/uploads/xxx) to full URL */
export function getImageUrl(path?: string | null): string | undefined {
  if (!path) return undefined;
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  return `${SERVER_URL}${path.startsWith('/') ? '' : '/'}${path}`;
}

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
});

// Attach JWT token from AsyncStorage
api.interceptors.request.use(async (config) => {
  const token = await AsyncStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
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
  (res) => res,
  async (error: AxiosError<{ message?: string }>) => {
    if (!error.response) {
      const baseURL = error.config?.baseURL || API_BASE_URL;
      const reason = error.code || error.message || 'unknown';
      const wrapped = new Error(`Нет соединения с сервером\nURL: ${baseURL}\nПричина: ${reason}`);
      (wrapped as any).code = error.code;
      (wrapped as any).baseURL = baseURL;
      return Promise.reject(wrapped);
    }

    const status = error.response.status;

    if (status === 401) {
      // Best-effort cleanup of the stale token; if another parallel 401
      // already removed it, this is a no-op.
      await AsyncStorage.removeItem('token').catch(() => {});
      await AsyncStorage.removeItem('user').catch(() => {});
      fireAuthExpired();
    }

    return Promise.reject(error);
  },
);

export default api;
