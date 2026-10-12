import type {
  StarterDirection,
  StarterSelection,
  StarterPreview,
  StarterInstallRequest,
  StarterInstallResult,
} from '../types/starterCatalogs';
interface StarterHttpClient {
  get<T>(url: string): Promise<{ data: T }>;
  post<T>(url: string, body: unknown): Promise<{ data: T }>;
}
export const createStarterCatalogsApi = (api: StarterHttpClient) => ({
  directions: () => api.get<{ directions: StarterDirection[]; version: string }>('/starter-catalogs'),
  preview: (selection: StarterSelection) => api.post<StarterPreview>('/starter-catalogs/preview', selection),
  install: (request: StarterInstallRequest) => api.post<StarterInstallResult>('/starter-catalogs/install', request),
});
