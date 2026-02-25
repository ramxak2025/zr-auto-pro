import axios, { AxiosError } from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

// TODO: Replace with your actual server URL
const API_BASE_URL = 'https://your-server.com/api';

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
