import axios, { AxiosError } from 'axios';

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

// Guard against multiple simultaneous 401 redirects causing race conditions.
// Uses a timestamp-based debounce instead of a permanent boolean flag
// to avoid the bug where the flag was never reset.
let lastRedirectTime = 0;

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

    // Unauthorized — clear token and redirect (debounce 2s to avoid multiple redirects).
    // EXCEPTION: never auto-logout on /auth/me failures — that endpoint is the
    // one we use to validate the token, and a transient hiccup must not log out
    // an otherwise-valid session. AuthContext handles 401 from /me itself.
    if (status === 401 && !url.includes('/auth/me')) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');

      const now = Date.now();
      if (window.location.pathname !== '/login' && now - lastRedirectTime > 2000) {
        lastRedirectTime = now;
        window.location.href = '/login';
      }
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
  }
);

export default api;
