import axios, { type AxiosRequestConfig } from 'axios';
import { createPublicBookingsApi } from '../../../shared/api/createServices';

// Deliberately separate from the authenticated axios singleton: no staff
// bearer, cross-host retry, session logout, or service-worker helper path.
const publicHttp = axios.create({ baseURL: '/api', timeout: 15000 });
export const publicBookingsApi = createPublicBookingsApi({
  async get<T>(url: string, config?: unknown) {
    const response = await publicHttp.get<T>(url, config as AxiosRequestConfig | undefined);
    return { data: response.data, status: response.status };
  },
  async post<T>(url: string, data?: unknown, config?: unknown) {
    const response = await publicHttp.post<T>(url, data, config as AxiosRequestConfig | undefined);
    return { data: response.data, status: response.status };
  },
});
