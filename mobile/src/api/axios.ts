import axios, { AxiosError } from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

const SERVER_URL_KEY = 'server_url';

// Get default API URL from config or dev server
function getDefaultApiBaseUrl(): string {
  const debuggerHost = Constants.expoConfig?.hostUri || (Constants as any).debuggerHost;
  if (debuggerHost) {
    const host = debuggerHost.split(':')[0];
    return `http://${host}:3000/api`;
  }
  return '';
}

let _currentBaseUrl = getDefaultApiBaseUrl();

/** Get saved server URL from AsyncStorage */
export async function getSavedServerUrl(): Promise<string> {
  const saved = await AsyncStorage.getItem(SERVER_URL_KEY);
  return saved || '';
}

/** Save server URL and update axios baseURL */
export async function setServerUrl(url: string): Promise<void> {
  // Normalize: remove trailing slashes, ensure /api suffix
  let normalized = url.replace(/\/+$/, '');
  if (!normalized.endsWith('/api')) {
    normalized = normalized + '/api';
  }
  await AsyncStorage.setItem(SERVER_URL_KEY, normalized);
  _currentBaseUrl = normalized;
  api.defaults.baseURL = normalized;
}

/** Initialize server URL from storage (call on app start) */
export async function initServerUrl(): Promise<boolean> {
  const saved = await AsyncStorage.getItem(SERVER_URL_KEY);
  if (saved) {
    _currentBaseUrl = saved;
    api.defaults.baseURL = saved;
    return true;
  }
  // Fallback to dev server if available
  const defaultUrl = getDefaultApiBaseUrl();
  if (defaultUrl) {
    _currentBaseUrl = defaultUrl;
    api.defaults.baseURL = defaultUrl;
    return true;
  }
  return false;
}

/** Check if server URL is configured */
export function isServerConfigured(): boolean {
  return !!_currentBaseUrl;
}

/** Get current server URL (without /api suffix) */
export function getServerUrl(): string {
  return _currentBaseUrl.replace(/\/api\/?$/, '');
}

// Derive server origin for image URLs (strip /api suffix)
export const SERVER_URL = '';

/** Resolve a relative image path (/uploads/xxx) to full URL */
export function getImageUrl(path?: string | null): string | undefined {
  if (!path) return undefined;
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  const base = getServerUrl();
  return `${base}${path.startsWith('/') ? '' : '/'}${path}`;
}

const api = axios.create({
  baseURL: _currentBaseUrl || 'http://localhost:3000/api',
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

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError<{ message?: string }>) => {
    if (!error.response) {
      return Promise.reject(new Error('Нет соединения с сервером'));
    }

    const status = error.response.status;

    if (status === 401) {
      await AsyncStorage.removeItem('token');
      await AsyncStorage.removeItem('user');
      authListeners.forEach((fn) => fn());
    }

    return Promise.reject(error);
  }
);

export default api;
