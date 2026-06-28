// ═══════════════════════════════════════════════════════════════════════════════
//  Shared API Request/Response types
// ═══════════════════════════════════════════════════════════════════════════════

import type {
  User,
  KnowledgeArticleType,
  KnowledgeAttachment,
  KnowledgeBlock,
  KnowledgeQuizQuestion,
  TroubleshootingSeverity,
  BroadcastButton,
  BroadcastSegment,
  NotificationCategory,
} from '../types';

// ─── Notifications ─────────────────────────────────────────────────────────────

/** PUT /notifications/preferences body — full set of MUTED categories. */
export interface UpdateNotificationPreferencesRequest {
  muted: NotificationCategory[];
}

/** POST /admin/broadcast body — superadmin only. */
export interface CreateBroadcastRequest {
  title: string;
  body: string;
  imageUrl?: string;
  buttons?: BroadcastButton[];
  /** 096 — ISO 8601 instant to defer delivery to; omit / past = send immediately. */
  scheduledAt?: string;
  /** 096 — recipient segment; omit / empty = all active tenants. */
  segment?: BroadcastSegment;
}

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

// ─── Account deletion (Apple 5.1.1(v) / Google Play data-deletion) ──────────────

/** POST /account/delete body — re-confirmation required to avoid accidents. */
export interface DeleteAccountRequest {
  /** The caller's CURRENT password — re-authentication. */
  password: string;
  /** Explicit confirmation from the destructive dialog (must be true). */
  confirm: boolean;
}

/**
 * Outcome of a deletion request.
 *   - 'account_deleted'            — a non-owner employee's own record was
 *                                    anonymized + retired immediately.
 *   - 'tenant_deletion_requested' — the account holder (director) closed the
 *                                    whole tenant: access revoked now, physical
 *                                    purge after the grace window.
 */
export type AccountDeletionStatus = 'account_deleted' | 'tenant_deletion_requested';

export interface DeleteAccountResponse {
  status: AccountDeletionStatus;
  message: string;
  /** ISO instant the tenant deletion was requested (tenant branch only). */
  deletionRequestedAt?: string;
  /** ISO instant the residual data is physically purged (tenant branch only). */
  purgeScheduledAt?: string;
}

export interface PaginationParams {
  page?: number;
  limit?: number;
  search?: string;
}

export interface CarsQuery extends PaginationParams {
  /**
   * «Без номеров» filter. When true, the server returns only cars registered
   * without a plate (no_plate flag set, or an empty stored plate). Applied
   * server-side so it spans the whole paginated dataset, not just one page.
   */
  noPlate?: boolean;
}

export interface ChecksParams extends PaginationParams {
  masterId?: string;
  clientId?: string;
  carId?: string;
  dateFrom?: string;
  dateTo?: string;
  retail?: string;
  /**
   * OPTIONAL keyset cursor (opaque, from a previous response's `nextCursor`).
   * Presence switches the journal to keyset pagination — the offset
   * `{ page, limit }` path is untouched when this is omitted. Pass an empty
   * string to fetch the first keyset page (newest checks).
   */
  cursor?: string;
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
  /** 055 — hide from Schedule grid + attendance Rating. */
  hiddenFromSchedule?: boolean;
  /** 055 — hide everywhere (lists + cannot be chosen as master on a new check). */
  hiddenEverywhere?: boolean;
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
  /** 059 — register the car "без номера"; plate is stored empty. */
  noPlate?: boolean;
}

export interface UpdateCarRequest {
  plateNumber?: string;
  makeModel?: string;
  comment?: string;
  clientId?: string;
  /** 059 — toggle "без номера". When true, the stored plate is cleared. */
  noPlate?: boolean;
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
  /** 070 — flip the «Смены» (shifts) subsystem on/off for the tenant. */
  shiftsEnabled?: boolean;
  /** 092 — flip POS «Кассовая смена + роли» mode on/off for the tenant. */
  shiftModeEnabled?: boolean;
}

/** POST /tenants/:id/extend — extend the tenant's subscription by N days. */
export interface ExtendSubscriptionRequest {
  days: number;
}

/** POST /tenants/:id/assign-plan — switch the tenant to a plan (syncs price + max users). */
export interface AssignPlanRequest {
  planId: string;
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

// ───────────────────────────────────────────────────────────────────────
//  Knowledge Base requests (063_knowledge_base)
// ───────────────────────────────────────────────────────────────────────

export interface KnowledgeCategoryInput {
  name: string;
  /** Ionicons name for the UI. */
  icon?: string | null;
  sortOrder?: number;
  /**
   * Parent category for folders/subfolders (079). Pass null (on update) to move
   * the category back to the root. The server rejects cycles with a 400.
   */
  parentId?: string | null;
}

export interface KnowledgeArticleInput {
  title: string;
  /** Markdown body. Kept alongside `blocks` for fallback rendering. */
  body?: string;
  /**
   * Block-based content (079) — ordered text/heading/image/VK-video blocks. Pass
   * [] to clear blocks (renderers then fall back to `body`). `body` is never
   * replaced by setting `blocks`. Each block is deep-validated server-side;
   * unknown types or non-VK video URLs are rejected with a 400.
   */
  blocks?: KnowledgeBlock[];
  type?: KnowledgeArticleType;
  /** Pass null to clear the category on update. */
  categoryId?: string | null;
  coverImage?: string | null;
  attachments?: KnowledgeAttachment[];
  pinned?: boolean;
  published?: boolean;
  // ─── Регламенты+ (064) ────────────────────────────────────────────────────
  /** Regulation must be acknowledged by the audience. */
  mandatory?: boolean;
  /** ISO date; pass null to clear. */
  dueDate?: string | null;
  /** Car-make tag for contextual KB; pass null to clear. */
  carMake?: string | null;
  /**
   * Update only: force a version bump (re-requires acknowledgment). A real body
   * change auto-bumps a regulation even without this flag.
   */
  bumpVersion?: boolean;
}

export interface ListArticlesParams {
  categoryId?: string;
  type?: KnowledgeArticleType;
  /** Free-text — matched against title + body via pg_trgm. */
  search?: string;
  /** Send 'true' to return only pinned articles. */
  pinned?: 'true' | 'false';
  /**
   * Optional facet — keep only articles that carry at least one attachment of
   * this kind (e.g. 'video' for "статьи с видео"). Additive: omit to leave the
   * existing search/listing untouched.
   */
  hasAttachmentType?: 'image' | 'video' | 'document';
}

// ───────────────────────────────────────────────────────────────────────
//  Learning center requests (064)
// ───────────────────────────────────────────────────────────────────────

export interface KnowledgeCourseInput {
  title: string;
  description?: string;
  coverImage?: string | null;
  /** Pass null to clear on update. */
  categoryId?: string | null;
  published?: boolean;
  sortOrder?: number;
}

export interface KnowledgeLessonInput {
  title: string;
  /** Markdown. */
  body?: string;
  sortOrder?: number;
  /** Full quiz incl. correctIndex (manager). Pass null to clear. */
  quiz?: KnowledgeQuizQuestion[] | null;
}

export interface CompleteLessonInput {
  /** Answer index per quiz question — required only when the lesson has a quiz. */
  answers?: number[];
}

// ───────────────────────────────────────────────────────────────────────
//  Troubleshooting requests (064)
// ───────────────────────────────────────────────────────────────────────

export interface TroubleshootingInput {
  title: string;
  system?: string | null;
  carMake?: string | null;
  symptom?: string;
  cause?: string;
  solution?: string;
  severity?: TroubleshootingSeverity | null;
  tags?: string[];
}

export interface ListTroubleshootingParams {
  /** Free-text — matched against title/symptom/cause/solution via pg_trgm. */
  search?: string;
  system?: string;
  carMake?: string;
  tag?: string;
}

export interface ForCarParams {
  make?: string;
  model?: string;
}

// ─── Записи (bookings) ───────────────────────────────────────────────────────

/** GET /bookings query. */
export interface ListBookingsParams {
  scope?: 'upcoming' | 'past';
  /** ISO 8601 lower bound on scheduled_at. */
  from?: string;
  /** ISO 8601 upper bound on scheduled_at. */
  to?: string;
}

/** POST /bookings body. */
export interface CreateBookingRequest {
  clientId: string;
  carId?: string | null;
  /** Omit when a master books for self; admin/owner may set any master or null. */
  masterId?: string | null;
  /** ISO 8601 date+time. */
  scheduledAt: string;
  comment?: string;
  notifyOnCreate?: boolean;
}

/** PATCH /bookings/:id body (reschedule / comment / reassign). */
export interface UpdateBookingRequest {
  scheduledAt?: string;
  comment?: string;
  masterId?: string | null;
  carId?: string | null;
}

/** POST /bookings/:id/convert body. */
export interface ConvertBookingRequest {
  checkId: string;
}

/** PATCH /bookings/settings body — all fields optional. */
export interface UpdateBookingSettingsRequest {
  notifyClientOnCreate?: boolean;
  reminderEnabled?: boolean;
  reminderHours?: number;
  channel?: 'auto' | 'sms' | 'whatsapp';
}
