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
