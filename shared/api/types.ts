// ═══════════════════════════════════════════════════════════════════════════════
//  Shared API Request/Response types
// ═══════════════════════════════════════════════════════════════════════════════

import type { User } from '../types';

export interface LoginRequest {
  phone: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  user: User;
}

export interface RegisterRequest {
  phone: string;
  password: string;
  fullName: string;
  tenantName?: string;
}

export interface PaginationParams {
  page?: number;
  limit?: number;
  search?: string;
}

export interface ChecksParams extends PaginationParams {
  masterId?: string;
  clientId?: string;
  carId?: string;
  dateFrom?: string;
  dateTo?: string;
  retail?: string;
}

export interface DateRangeParams {
  dateFrom?: string;
  dateTo?: string;
}

export interface CashFlowParams extends DateRangeParams {
  masterId?: string;
}

export interface CreateUserRequest {
  phone: string;
  password: string;
  fullName: string;
  role: string;
  salaryPercent?: number;
  permissions?: Record<string, boolean>;
}

export interface UpdateUserRequest {
  phone?: string;
  password?: string;
  fullName?: string;
  role?: string;
  salaryPercent?: number;
  permissions?: Record<string, boolean>;
  daysOff?: number[];
  isActive?: boolean;
  team?: string | null;
  /** 047_expenses_by_employee — gate for non-privileged users to /expenses POST. */
  canAddExpenses?: boolean;
  /** Daily cap (RUB). Null/undefined → unlimited. */
  dailyExpenseLimit?: number | null;
}

export interface CreateClientRequest {
  fullName: string;
  phone: string;
  comment?: string;
  /** Acquisition source tag — 046_clients_source. Empty string → null. */
  source?: string | null;
  /** Owner-only free-form notes. Capped at 4000 chars server-side. */
  ownerNotes?: string | null;
}

export interface UpdateClientRequest {
  fullName?: string;
  phone?: string;
  comment?: string;
  source?: string | null;
  ownerNotes?: string | null;
}

export interface CreateCarRequest {
  plateNumber: string;
  makeModel: string;
  comment?: string;
  clientId: string;
}

export interface UpdateCarRequest {
  plateNumber?: string;
  makeModel?: string;
  comment?: string;
  clientId?: string;
}

export interface CreateProductRequest {
  name: string;
  category?: string;
  photo?: string;
  costPrice: number;
  sellPrice: number;
  stock: number;
  minStock: number;
  unit?: string;
  isBundle?: boolean;
  bundleItems?: Array<{ productId: string; name: string; quantity: number }>;
  supplierId?: string;
  warehouseId?: string;
  warrantyDays?: number | null;
}

export interface UpdateProductRequest {
  name?: string;
  category?: string;
  photo?: string;
  costPrice?: number;
  sellPrice?: number;
  stock?: number;
  minStock?: number;
  unit?: string;
  isBundle?: boolean;
  bundleItems?: Array<{ productId: string; name: string; quantity: number }>;
  supplierId?: string;
  warehouseId?: string;
  warrantyDays?: number | null;
}

export interface StockUpdateRequest {
  type: 'income' | 'expense' | 'writeoff' | 'inventory';
  quantity: number;
  reason?: string;
  /** Only respected when type === 'writeoff'. Also writes an expenses row. */
  recordAsExpense?: boolean;
}

export interface CreateServiceRequest {
  name: string;
  category?: string;
  defaultPrice: number;
  masterPercent?: number | null;
  warrantyDays?: number | null;
}

export interface UpdateServiceRequest {
  name?: string;
  category?: string;
  defaultPrice?: number;
  masterPercent?: number | null;
  warrantyDays?: number | null;
}

export interface CreateCheckRequest {
  date?: string;
  masterId: string;
  clientId: string;
  carId: string;
  mileage?: number;
  comment?: string;
  discount?: number;
  isDeferred?: boolean;
  paymentMethod: string;
  cashAmount?: number;
  cardAmount?: number;
  services: Array<{
    serviceId?: string;
    masterId?: string;
    name: string;
    price: number;
    quantity: number;
  }>;
  products: Array<{
    productId?: string;
    name: string;
    sellPrice: number;
    costPrice: number;
    quantity: number;
  }>;
}

export interface UpdateCheckRequest {
  date?: string;
  paymentMethod?: string;
  isDeferred?: boolean;
  comment?: string;
  cashAmount?: number;
  cardAmount?: number;
  clientId?: string;
  carId?: string;
  masterId?: string;
  mileage?: number;
  discount?: number;
  services?: Array<{
    serviceId?: string;
    masterId?: string;
    name: string;
    price: number;
    quantity: number;
  }>;
  products?: Array<{
    productId?: string;
    name: string;
    sellPrice: number;
    costPrice: number;
    quantity: number;
  }>;
}

export interface CreateSupplierRequest {
  name: string;
  phone?: string;
  contactPerson?: string;
  comment?: string;
}

export interface UpdateSupplierRequest {
  name?: string;
  phone?: string;
  contactPerson?: string;
  comment?: string;
}

export interface CreateDeliveryRequest {
  supplierId: string;
  date?: string;
  comment?: string;
  items: Array<{
    productId: string;
    quantity: number;
    price: number;
  }>;
}

export interface CreatePaymentRequest {
  supplierId: string;
  amount: number;
  date?: string;
  comment?: string;
}

export interface CreateScheduleRequest {
  userId: string;
  date: string;
  shiftStart?: string;
  shiftEnd?: string;
  isDayOff?: boolean;
  note?: string;
}

export interface UpdateScheduleRequest {
  shiftStart?: string;
  shiftEnd?: string;
  isDayOff?: boolean;
  note?: string;
}

export interface CreateWorkModeRequest {
  name: string;
  type: 'rotating' | 'weekly';
  workDays: number;
  offDays: number;
  weekDays?: number[];
  shiftStart: string;
  shiftEnd: string;
}

export interface UpdateWorkModeRequest {
  name?: string;
  type?: string;
  shiftStart?: string;
  shiftEnd?: string;
}

export interface CreateTenantRequest {
  name: string;
  phone?: string;
  address?: string;
  email?: string;
  description?: string;
  maxUsers?: number;
  isActive?: boolean;
  planId?: string;
  monthlyPrice?: number;
  subscriptionEnd?: string;
  subscriptionNote?: string;
  directorName?: string;
  directorPhone?: string;
  directorPassword?: string;
}

export interface UpdateTenantRequest {
  name?: string;
  phone?: string;
  address?: string;
  email?: string;
  description?: string;
  isActive?: boolean;
  maxUsers?: number;
  planId?: string;
  monthlyPrice?: number;
  subscriptionEnd?: string;
  subscriptionNote?: string;
}

export interface CreatePlanRequest {
  name: string;
  monthlyPrice: number;
  description?: string;
  features?: string[];
  maxUsers?: number;
  sortOrder?: number;
}

export interface UpdatePlanRequest {
  name?: string;
  monthlyPrice?: number;
  description?: string;
  features?: string[];
  maxUsers?: number;
  isActive?: boolean;
  sortOrder?: number;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Imports — clients & cars
// ═══════════════════════════════════════════════════════════════════════════
//
// Frontend parses the spreadsheet (xlsx/csv) on the client and sends a JSON
// payload to the backend. One file row = one ImportRowInput (a client paired
// with at most one car). Multiple rows can share the same phone — they get
// folded into one client with multiple cars.

export interface ImportRowInput {
  /** 1-based row number from the source file (used in messages). */
  sourceRow: number;
  clientName?: string | null;
  /** Raw phone exactly as it appeared in the source file. */
  phoneRaw?: string | null;
  /** Normalized phone, if the file already had one. Backend re-normalizes anyway. */
  phone?: string | null;
  carPlate?: string | null;
  carModel?: string | null;
  /** Free-form data-quality tags from the source ("unclear_car_model", "no_phone", …). */
  notes?: string | null;
  /** Original raw client text — preserved for audit. */
  originalClientText?: string | null;
}

/** Per-row issue surfaced in preview. Severity drives the UI section. */
export type ImportIssueKind =
  | 'no_phone'
  | 'invalid_phone'
  | 'no_name'
  | 'no_plate'
  | 'invalid_plate'
  | 'foreign_plate'
  | 'unclear_car_model'
  | 'plate_belongs_to_other_client'
  | 'duplicate_in_file'
  | 'multiple_name_candidates'
  | 'name_conflict_same_phone';

export interface ImportRowIssue {
  sourceRow: number;
  kind: ImportIssueKind;
  message: string;
  /** Hint about which side of a conflict already exists. */
  existing?: {
    clientId?: string;
    clientName?: string;
    plateNumber?: string;
  };
}

/** Plan for one phone-grouped client computed by preview. */
export interface ImportClientGroup {
  /** Canonical phone (`+7…`). */
  phoneKey: string;
  /** Client name we plan to use. */
  fullName: string;
  /** Matching existing client (if any) — full record, by phone within the tenant. */
  existingClientId?: string | null;
  /** Names present in the file under this phone. */
  candidateNames: string[];
  /** Source rows that contributed to this group. */
  sourceRows: number[];
  cars: ImportPlannedCar[];
}

export interface ImportPlannedCar {
  /** Canonical key for dedup — RU plate w/o spaces or normalized foreign string. */
  plateKey: string;
  /** Display value to be written into `cars.plate_number`. */
  plateDisplay: string;
  /** Will be written into `cars.make_model` (placeholder for unclear). */
  makeModel: string;
  /** Original raw model text — preserved into `cars.comment` if it differs. */
  rawModel?: string | null;
  /** True if plate parsed as foreign / unrecognized RU. */
  isForeign: boolean;
  sourceRow: number;
  /** True if the plate already exists for this tenant. */
  existsForCurrentClient?: boolean;
  /** Set when plate is bound to a different client — preview blocks this row. */
  conflictsWithClientId?: string | null;
  conflictsWithClientName?: string | null;
}

export interface ImportPreviewSummary {
  totalRows: number;
  uniqueClients: number;
  clientsWillCreate: number;
  clientsWillReuse: number;
  carsWillCreate: number;
  carsAlreadyExist: number;
  rowsSkipped: number;
  errors: number;
  warnings: number;
}

export interface ImportPreviewRequest {
  rows: ImportRowInput[];
  options?: ImportOptions;
}

export interface ImportOptions {
  /** Allow `foreign_plate` rows to create cars (default true). */
  allowForeignPlates?: boolean;
}

export interface ImportPreviewResponse {
  summary: ImportPreviewSummary;
  groups: ImportClientGroup[];
  issues: ImportRowIssue[];
  /** Rows that were dropped before grouping (no phone, invalid phone, etc.). */
  skippedRows: Array<{ sourceRow: number; reason: ImportIssueKind; message: string }>;
}

export interface ImportConfirmRequest {
  rows: ImportRowInput[];
  options?: ImportOptions;
}

export interface ImportConfirmResponse {
  importRunId: string;
  summary: ImportPreviewSummary;
  createdClientIds: string[];
  createdCarIds: string[];
  reusedClientIds: string[];
  /** Rows that were skipped despite confirmation (e.g. plate stolen between preview and confirm). */
  skipped: Array<{ sourceRow: number; reason: ImportIssueKind; message: string }>;
}
