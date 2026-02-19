import axios, { AxiosError } from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  timeout: 30000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (error: AxiosError<{ message?: string }>) => {
    // Network error or server unreachable
    if (!error.response) {
      console.error('Network error:', error.message);
      return Promise.reject(new Error('Нет соединения с сервером'));
    }

    const status = error.response.status;

    // Unauthorized — clear token and redirect
    if (status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }

    // Server error — generic message
    if (status >= 500) {
      console.error(`Server error ${status}:`, error.response.data);
    }

    return Promise.reject(error);
  }
);

export default api;
