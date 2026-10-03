export const ENTITY_TYPES = ['products', 'stock', 'clients', 'purchases', 'workOrders', 'payments'] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];
export type Capabilities = Record<EntityType, { export: boolean; import: boolean }>;
export interface Connection {
  id: string;
  tenant_id: string;
  point_id: string;
  created_by: string;
  status: 'paused' | 'active';
  configuration: 'UNF3';
  mapping_confirmed: boolean;
  capabilities: Capabilities;
  key_hint: string;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
}
export interface ImportEvent {
  eventId: string;
  entityType: EntityType;
  externalId: string;
  baseRevision?: string;
  payload: Record<string, unknown>;
}
export interface Snapshot {
  id: string;
  payload: Record<string, unknown>;
}
export interface ImportResult {
  id: string;
  status: 'applied' | 'needs_review' | 'rejected';
  autexaId: string | null;
  message: string;
}
