/** Mirror shared service import wire types locally: the backend Docker build and
 * dist/main runtime compile only backend/src, never the external shared tree.
 * Keep these contracts aligned with shared/api/types.ts and shared/types/index.ts. */
type ServicePriceType = 'fixed' | 'range';

export interface Service {
  id: string;
  name: string;
  category?: string;
  defaultPrice: number;
  /** Absent on older servers: treat as fixed, with defaultPrice for both bounds. */
  priceType?: ServicePriceType;
  minPrice?: number;
  maxPrice?: number;
  priceVersion?: number;
  /** Custom master commission percent (overrides user.salaryPercent when set) */
  masterPercent?: number | null;
  /** Default warranty period (in days) applied to lines that reference this service. Null = no warranty. */
  warrantyDays: number | null;
  createdAt: string;
}

export interface ServiceImportRow {
  sourceRow: number;
  id?: string;
  name: string;
  category?: string;
  priceType: 'fixed' | 'range';
  defaultPrice?: number;
  minPrice?: number;
  maxPrice?: number;
  masterPercent?: number | null;
  warrantyDays?: number | null;
}

export interface ServiceImportPreviewRow {
  sourceRow: number;
  action: 'create' | 'update' | 'error';
  serviceId?: string;
  expectedPriceVersion?: number;
  name: string;
  category?: string;
  message?: string;
}

export interface ServiceImportPreview {
  previewId: string;
  rows: ServiceImportPreviewRow[];
  errors: string[];
  summary: { totalRows: number; create: number; update: number; errors: number };
}

export interface ServiceImportResult {
  requestId: string;
  created: number;
  updated: number;
  services: Service[];
}
