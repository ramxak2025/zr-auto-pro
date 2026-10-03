export const ONE_C_ENTITY_TYPES = ['products', 'stock', 'clients', 'purchases', 'workOrders', 'payments'] as const;
export type OneCEntityType = (typeof ONE_C_ENTITY_TYPES)[number];
export type OneCCapabilities = Record<OneCEntityType, { export: boolean; import: boolean }>;
export interface OneCConnection {
  id: string;
  pointId: string;
  status: 'paused' | 'active';
  configuration: 'UNF3';
  mappingConfirmed: boolean;
  capabilities: OneCCapabilities;
  keyHint: string;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface OneCJournalEntry {
  id: string;
  eventId: string;
  entityType: OneCEntityType;
  externalId: string;
  autexaId: string | null;
  direction: 'import' | 'export';
  status: 'applied' | 'needs_review' | 'rejected' | 'exported' | 'processing';
  message: string;
  createdAt: string;
  updatedAt: string;
}
export interface OneCSettings {
  connection: OneCConnection | null;
  availablePoints: { id: string; name: string }[];
  pilotNotice: string;
}
export interface OneCConfigureRequest {
  pointId?: string;
  status?: 'paused' | 'active';
  mappingConfirmed?: boolean;
  capabilities?: OneCCapabilities;
}
export interface OneCImportEvent {
  eventId: string;
  entityType: OneCEntityType;
  externalId: string;
  baseRevision?: string;
  payload: Record<string, unknown>;
}
export interface OneCImportResult {
  id: string;
  status: 'applied' | 'needs_review' | 'rejected';
  autexaId: string | null;
  message: string;
}
export interface OneCExportItem {
  autexaId: string;
  externalId: string | null;
  revision: string;
  payload: Record<string, unknown>;
}
export interface OneCExportPage {
  items: OneCExportItem[];
  nextCursor: string | null;
}
export interface OneCAckRequest {
  entityType: OneCEntityType;
  items: { autexaId: string; externalId: string; revision: string }[];
}
interface OneCHttpClient {
  get<T>(url: string, config?: unknown): Promise<{ data: T }>;
  post<T>(url: string, data?: unknown): Promise<{ data: T }>;
  patch<T>(url: string, data?: unknown): Promise<{ data: T }>;
}
export function createOneCApi(api: OneCHttpClient) {
  return {
    getConnection: () => api.get<OneCSettings>('/one-c/connection'),
    create: (data: { pointId: string }) =>
      api.post<{ connection: OneCConnection; apiKey: string }>('/one-c/connection', data),
    configure: (data: OneCConfigureRequest) => api.patch<OneCConnection>('/one-c/connection', data),
    rotateKey: () => api.post<{ connection: OneCConnection; apiKey: string }>('/one-c/connection/rotate-key'),
    journal: (params?: { limit?: number; offset?: number }) =>
      api.get<{ items: OneCJournalEntry[]; total: number }>('/one-c/journal', { params }),
  };
}
