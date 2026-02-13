import axios from 'axios';
import { setupDemoInterceptor, setupDemoResponseInterceptor } from '../demo/interceptor';

const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Demo mode: intercept all API calls and return mock data
const isDemo = localStorage.getItem('demo') === 'true';
if (isDemo) {
  setupDemoResponseInterceptor(api);
  setupDemoInterceptor(api);
}

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.__demo) return Promise.reject(error);
    if (error.response?.status === 401 && !isDemo) {
      const hadToken = !!localStorage.getItem('token');
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      if (hadToken && window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  },
);

export default api;
