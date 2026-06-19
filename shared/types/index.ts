// ═══════════════════════════════════════════════════════════════════════════════
//  Shared Types — used by both Web and Mobile apps
// ═══════════════════════════════════════════════════════════════════════════════

export interface Plan {
  id: string;
  name: string;
  monthlyPrice: number;
  description?: string;
  features: string[];
  maxUsers: number;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
}

export interface Tenant {
  id: string;
  name: string;
  slug?: string;
  phone?: string;
  address?: string;
  email?: string;
  description?: string;
  logo?: string;
  isActive: boolean;
  maxUsers: number;
  planId?: string;
  plan?: Plan;
  monthlyPrice: number;
  subscriptionEnd?: string | null;
  subscriptionNote?: string | null;
  legalName?: string;
  inn?: string;
  kpp?: string;
  ogrn?: string;
  receiptFooter?: string;
  /**
   * 070 — per-tenant master toggle for the «Смены» (shifts) subsystem.
   * Absent on legacy payloads → treat as `false`. Mutable through the existing
   * PATCH /my-company update (Partial<Tenant>) — no dedicated endpoint.
   */
  shiftsEnabled?: boolean;
  users?: User[];
  userCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface SubscriptionInfo {
  tenantName: string;
  /**
   * The tenant's current plan id (authoritative link to `plans`). Prefer this
   * over `planName` when resolving the active plan.
   */
  planId?: string | null;
  /** Kept for backward-compat. New code should gate on `features` instead. */
  planName?: string | null;
  /**
   * Resolved feature keys of the tenant's CURRENT plan (by planId, server-side).
   * Clients gate features with `sub.features.includes(key)` — no fragile match
   * by plan name. See shared/constants/features.ts for the canonical key list.
   */
  features: string[];
  monthlyPrice: number;
  subscriptionEnd?: string | null;
  subscriptionNote?: string | null;
  maxUsers: number;
  currentUsers: number;
  plans: Plan[];
}

// ─── Notifications (066_notification_preferences + 067_notification_broadcasts) ─

/**
 * User-facing, mutable notification categories. Each maps to a push trigger
 * gated by NOT EXISTS in notification_mutes (opt-out: muted == has a row).
 * Silent cache-invalidation pushes and superadmin broadcasts are intentionally
 * excluded — they are not user-mutable.
 */
export type NotificationCategory = 'salary' | 'penalty' | 'check_assigned' | 'check_closed' | 'knowledge';

/** GET /notifications/preferences — `muted` is the set the user opted OUT of. */
export interface NotificationPreferences {
  muted: NotificationCategory[];
}

export interface BroadcastButton {
  label: string;
  action: 'dismiss' | 'link';
  url?: string;
}

/** A persisted superadmin → director broadcast (GET /notifications/broadcasts/unseen). */
export interface Broadcast {
  id: string;
  title: string;
  body: string;
  imageUrl?: string;
  buttons: BroadcastButton[];
  createdAt: string;
}

/** Data payload carried by the broadcast push (data.type === 'superadmin_broadcast'). */
export interface BroadcastPayload {
  type: 'superadmin_broadcast';
  broadcastId: string;
  title: string;
  body: string;
  imageUrl?: string;
  buttons?: BroadcastButton[];
}

export interface PlatformStats {
  totalTenants: number;
  activeTenants: number;
  totalUsers: number;
  /** Tenants whose subscription_end is in the past (lapsed). */
  expiredTenants: number;
  /** Monthly recurring revenue: Σ monthly_price over active, in-window tenants (rubles, rounded). */
  mrr: number;
  /** Average revenue per active tenant = mrr / activeTenants (rounded; 0 when no active tenants). */
  arpu: number;
  /** Tenants created since the start of the current month. */
  newTenantsThisMonth: number;
}

/**
 * Per-tenant activity metrics for the SUPERADMIN PLATFORM "показатели клиента"
 * card (GET /tenants/:id/metrics). These are ACTIVITY SIGNALS — Autexa has no
 * per-feature usage tracking, so check volume / revenue / last-activity are the
 * meaningful proxy for tenant health. All aggregates are server-side
 * COALESCE-guarded, never null (except `lastActivityAt`, which is null only if
 * the tenant has no checks AND no creation date).
 */
export interface TenantMetrics {
  usersCount: number;
  activeUsersCount: number;
  checksTotal: number;
  checksLast30d: number;
  revenueTotal: number;
  revenueLast30d: number;
  lastActivityAt: string | null;
  productsCount: number;
}

/**
 * POST /tenants/:id/impersonate response. `token` is a short-lived (30 min)
 * normal director JWT for the tenant's owner; `expiresIn` is in seconds (1800).
 */
export interface ImpersonateResponse {
  token: string;
  user: User;
  expiresIn: number;
}

/** One row of the superadmin platform audit trail (GET /admin/audit-log). */
export interface AuditLogEntry {
  id: string;
  actorName: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  targetName: string | null;
  detail: Record<string, unknown>;
  createdAt: string;
}

/**
 * 071 — per-employee top-level section visibility override.
 * `sectionKey` buckets navigation into five logical groups; a stored row with
 * `isVisible: false` hides that group for the user. The absence of a row means
 * "use the default" (visible) — only explicit overrides are persisted.
 */
export interface SectionVisibility {
  sectionKey: 'work' | 'finance' | 'warehouse' | 'marketing' | 'other';
  isVisible: boolean;
}

/**
 * 073 — granular per-employee visibility at the ITEM (sub-section) level.
 * This is ADDITIVE to {@link SectionVisibility}: a group can be visible while a
 * single item inside it is hidden. `itemKey` matches a «Ещё» menu row; a stored
 * row with `isVisible: false` hides that one item. Absence of a row → default
 * (visible) — only explicit overrides are persisted.
 */
export interface ItemVisibility {
  itemKey: string;
  isVisible: boolean;
}

/**
 * 073 — canonical item-key set, grouped by the same five buckets as
 * {@link SectionVisibility.sectionKey}. Keys mirror the «Ещё» menu rows in
 * mobile/src/screens/MoreScreen.tsx (one per row, derived from its `screen`).
 * Backend keeps NO DB CHECK on item_key (the set may grow) — this constant is
 * the single source of truth for the known set, used to materialize defaults.
 */
export const ITEM_KEYS = {
  work: ['bookings', 'schedule', 'clients', 'knowledge-base'],
  finance: ['cashflow', 'salary', 'expenses', 'reports'],
  warehouse: ['services', 'suppliers', 'equipment', 'warehouse-analytics'],
  marketing: ['marketing', 'calls', 'mailings', 'integrations'],
  other: ['employees', 'users', 'company-settings', 'subscription'],
} as const satisfies Record<SectionVisibility['sectionKey'], readonly string[]>;

/** Flat list of every known item key (defaults are materialized for all). */
export const ALL_ITEM_KEYS: readonly string[] = Object.values(ITEM_KEYS).flat();

export interface User {
  id: string;
  username?: string;
  avatar?: string;
  phone: string;
  fullName: string;
  role: UserRole;
  salaryPercent: number;
  productSalaryPercent?: number;
  permissions: UserPermissions;
  daysOff?: number[];
  sortOrder?: number;
  isActive: boolean;
  /** Free-text team grouping. Null/empty → "Без группы" on the FE. */
  team?: string | null;
  /**
   * 071 — explicit per-section visibility overrides for this employee. Absent /
   * empty → every section uses its default (visible). Sections not listed here
   * also fall back to the default.
   */
  sectionVisibility?: SectionVisibility[];
  /**
   * 073 — explicit per-ITEM visibility overrides for this employee (additive to
   * {@link sectionVisibility}). Absent / empty → every item uses its default
   * (visible). Items not listed here also fall back to the default.
   */
  itemVisibility?: ItemVisibility[];
  /** Per-employee permission to submit /expenses entries. Off by default. */
  canAddExpenses?: boolean;
  /** When set, non-privileged users' daily expense submissions auto-flip to 'pending' once the total crosses this number. */
  dailyExpenseLimit?: number | null;
  /** 055 — hide from Schedule grid + attendance Rating (FE filters by context). */
  hiddenFromSchedule?: boolean;
  /** 055 — hide everywhere: lists + cannot be selected as master on a new check. */
  hiddenEverywhere?: boolean;
  /**
   * 065 — «Уволенные» recycle bin. NULL on an active employee. When set, the
   * user is dismissed (fired): hidden from every active list, restorable within
   * the year. The row is kept so historical checks/shifts still resolve the
   * name — the client should render such a user as «Уволен» read-only.
   */
  dismissedAt?: string | null;
  /**
   * 065 — set on "delete completely" (purge). The row is STILL kept so FKs and
   * historical names resolve, but the user is hidden everywhere (including the
   * Уволенные list) and can no longer be restored.
   */
  purgedAt?: string | null;
  tenantId?: string;
  tenant?: Tenant;
  createdAt: string;
}

export enum UserRole {
  SUPERADMIN = 'superadmin',
  DIRECTOR = 'director',
  ADMIN = 'admin',
  MASTER = 'master',
}

export interface UserPermissions {
  checks_view: boolean;
  checks_create: boolean;
  checks_edit: boolean;
  checks_delete: boolean;
  checks_change_datetime: boolean;
  profit_view: boolean;
  clients_view: boolean;
  clients_edit: boolean;
  warehouse_access: boolean;
  suppliers_access: boolean;
  financial_reports: boolean;
  export_data: boolean;
  user_management: boolean;
  schedule_view: boolean;
  salary_view: boolean;
  marketing_access: boolean;
  // ── Additive keys (server-enforced permissions foundation) ──────────────
  // Kept OPTIONAL so existing `defaultPermissions: UserPermissions = { …16 keys }`
  // literals in web/mobile keep compiling. A new permission defaults to
  // "absent" → the PermissionsGuard falls back to the per-role default.
  /** See the calls list (calls module is also director+ role-gated). */
  calls_view?: boolean;
  /** Listen to call recordings. */
  calls_listen?: boolean;
  /** Submit /expenses entries. NOTE: server still enforces this via the
   *  separate users.can_add_expenses COLUMN, not this JSON key. */
  can_add_expenses?: boolean;
  /** Access the online-booking / appointments surface. */
  bookings_access?: boolean;
  /** Change cash/card split or payment status on a check. */
  payment_edit?: boolean;
  /** See ALL masters' checks in the journal. A master without this sees
   *  only their own (master_id = self); owner-class always sees all. */
  checks_view_all?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Canonical permission vocabulary (server-enforced foundation)
//
//  Single source of truth for action-permission keys, shared by backend
//  (PermissionsGuard + @RequirePermission), web and mobile. This is SEPARATE
//  from the section/item *menu*-visibility system (SECTION_KEYS / ITEM_KEYS) —
//  those control which menu rows render; these control which server actions an
//  account may perform.
// ═══════════════════════════════════════════════════════════════════════════

/** Action-permission key. A subset of `keyof UserPermissions`. */
export type PermissionKey =
  | 'checks_view'
  | 'checks_create'
  | 'checks_edit'
  | 'checks_delete'
  | 'checks_change_datetime'
  | 'checks_view_all'
  | 'payment_edit'
  | 'profit_view'
  | 'financial_reports'
  | 'export_data'
  | 'can_add_expenses'
  | 'warehouse_access'
  | 'suppliers_access'
  | 'clients_view'
  | 'clients_edit'
  | 'schedule_view'
  | 'salary_view'
  | 'bookings_access'
  | 'marketing_access'
  | 'calls_view'
  | 'calls_listen'
  | 'user_management';

/**
 * Permission keys grouped for UI rendering (Касса / Финансы / Склад / CRM /
 * Управление). The grouping drives the permissions editor; enforcement only
 * cares about the flat key.
 */
export const PERMISSION_GROUPS = {
  Касса: [
    'checks_view',
    'checks_create',
    'checks_edit',
    'checks_delete',
    'checks_change_datetime',
    'checks_view_all',
    'payment_edit',
  ],
  Финансы: ['profit_view', 'financial_reports', 'export_data', 'can_add_expenses', 'salary_view'],
  Склад: ['warehouse_access', 'suppliers_access'],
  CRM: [
    'clients_view',
    'clients_edit',
    'schedule_view',
    'bookings_access',
    'marketing_access',
    'calls_view',
    'calls_listen',
  ],
  Управление: ['user_management'],
} as const satisfies Record<string, readonly PermissionKey[]>;

/** Flat set of every canonical permission key (deduped, stable order). */
export const PERMISSION_KEYS: readonly PermissionKey[] = Array.from(
  new Set(Object.values(PERMISSION_GROUPS).flat()),
) as PermissionKey[];

/**
 * Per-role DEFAULT for each permission when the user's stored `permissions`
 * map does not have an explicit `true`/`false` for that key. This is the
 * lockout-safety net: an existing master whose `permissions` is `{}` is NOT
 * locked out of master-legitimate actions (касса, own data), and is NOT
 * silently granted financials/reports/profit, product mutations, calls,
 * marketing, or user management.
 *
 * Owner-class roles (superadmin / director / admin) are handled by the guard
 * as ALWAYS-allowed and do not consult this map; they are listed here only for
 * completeness / client-side mirroring.
 */
export const ROLE_PERMISSION_DEFAULTS: Record<UserRole, Partial<Record<PermissionKey, boolean>>> = {
  [UserRole.SUPERADMIN]: {},
  [UserRole.DIRECTOR]: {},
  [UserRole.ADMIN]: {},
  [UserRole.MASTER]: {
    // Касса — a master CAN use the cash screen and see/edit their own checks.
    checks_view: true,
    checks_create: true,
    checks_edit: true,
    checks_delete: false,
    checks_change_datetime: false,
    checks_view_all: false, // sees only their own checks by default
    payment_edit: false,
    // Финансы — NONE by default.
    profit_view: false,
    financial_reports: false,
    export_data: false,
    can_add_expenses: false,
    salary_view: false,
    // Склад — reads are open elsewhere; mutations are role-gated. No access flag by default.
    warehouse_access: false,
    suppliers_access: false,
    // CRM — masters can see their own clients/cars; broad CRM editing off.
    clients_view: true,
    clients_edit: false,
    schedule_view: true,
    bookings_access: false,
    marketing_access: false,
    calls_view: false,
    calls_listen: false,
    // Управление — never for a master.
    user_management: false,
  },
};

/**
 * Named permission template («роль»): a tenant-defined, reusable set of
 * action-permissions. A template is just a saved blueprint — applying it to an
 * employee COPIES `permissions` into that user's `permissions` map (a one-shot
 * copy, exactly like PATCH /users/:id/permissions; there is no live link back).
 * `permissions` is the SAME shape as {@link UserPermissions}. Backend table:
 * migration 077_permission_templates.sql; API: createPermissionTemplatesApi.
 */
export interface PermissionTemplate {
  id: string;
  name: string;
  permissions: Record<string, boolean>;
  createdAt?: string;
  updatedAt?: string;
}

export interface Client {
  id: string;
  fullName: string;
  phone: string;
  comment?: string;
  /** Acquisition source tag — value from `client_sources.sources` (e.g. "Яндекс", "Авито"). */
  source?: string | null;
  /** Owner-only free-form notes about the client. Capped at 4000 chars server-side. */
  ownerNotes?: string | null;
  /** True for the tenant's pinned "Розничный покупатель". */
  isRetail?: boolean;
  /** Last loyalty rating (1–5) from review_responses — DETAIL response only (#15). Null if никогда не оценивал. */
  lastRating?: number | null;
  /** Timestamp of that last rating — DETAIL response only. */
  lastRatingAt?: string | null;
  cars?: Car[];
  checks?: Check[];
  createdAt: string;
}

export interface Car {
  id: string;
  plateNumber: string;
  makeModel: string;
  comment?: string;
  clientId: string;
  /** 059 — true for cars registered "без номера" (plateNumber is empty). */
  noPlate?: boolean;
  client?: Client;
  createdAt: string;
}

export interface BundleItem {
  productId: string;
  name: string;
  quantity: number;
}

export interface Product {
  id: string;
  name: string;
  category?: string;
  photo?: string;
  costPrice: number;
  sellPrice: number;
  stock: number;
  minStock: number;
  unit?: string;
  isBundle?: boolean;
  bundleItems?: BundleItem[];
  supplierId?: string;
  supplier?: Supplier;
  /** Warehouse the product currently lives in. Null only for legacy rows that pre-date 028_warehouses.sql. */
  warehouseId: string | null;
  /** Default warranty period (in days) applied to lines that reference this product. Null = no warranty. */
  warrantyDays: number | null;
  /** EAN-13 / QR / custom barcode. Null if not set. */
  barcode?: string | null;
  createdAt: string;
}

export interface Service {
  id: string;
  name: string;
  category?: string;
  defaultPrice: number;
  /** Custom master commission percent (overrides user.salaryPercent when set) */
  masterPercent?: number | null;
  /** Default warranty period (in days) applied to lines that reference this service. Null = no warranty. */
  warrantyDays: number | null;
  createdAt: string;
}

export interface Warehouse {
  id: string;
  tenantId: string;
  name: string;
  kind: 'main' | 'defect' | 'used';
  sortOrder: number;
}

export interface WarrantyClaim {
  id: string;
  tenantId: string;
  checkId: string;
  clientId?: string | null;
  carId?: string | null;
  kind: 'product' | 'service';
  productId?: string | null;
  serviceId?: string | null;
  itemName?: string | null;
  warrantyDays: number;
  startedAt: string;
  expiresAt: string;
  usedAt?: string | null;
  usedCheckId?: string | null;
  createdAt?: string;
}

export interface CheckServiceLine {
  id?: string;
  serviceId?: string;
  masterId?: string;
  master?: { id: string; fullName: string };
  name: string;
  price: number;
  quantity: number;
  total: number;
}

export interface CheckProductLine {
  id?: string;
  productId?: string;
  name: string;
  sellPrice: number;
  costPrice: number;
  quantity: number;
  totalSell: number;
  totalCost: number;
}

export enum PaymentMethod {
  CASH = 'cash',
  CARD = 'card',
  WARRANTY = 'warranty',
  CASH_CARD = 'cash_card',
}

export interface Check {
  id: string;
  number: number;
  date: string;
  master?: User;
  masterId: string;
  client?: Client;
  clientId: string;
  car?: Car;
  carId: string;
  mileage?: number;
  services: CheckServiceLine[];
  products: CheckProductLine[];
  comment?: string;
  discount?: number;
  isDeferred?: boolean;
  paymentMethod: PaymentMethod;
  cashAmount: number;
  cardAmount: number;
  serviceTotal: number;
  productTotal: number;
  totalRevenue: number;
  productCostTotal: number;
  serviceSalaryTotal: number;
  productSalaryTotal?: number;
  totalCost: number;
  profit: number;
  /** Warranties spawned by this check (only populated by /checks/:id). */
  warrantyClaims?: WarrantyClaim[];
  /** Set when the check has been returned (full or partial). FE renders a strikethrough + badge in the journal. */
  isReturned?: boolean;
  returnedAt?: string | null;
  returnDestination?: 'warehouse' | 'defect' | null;
  returnScope?: 'full' | 'partial' | null;
  createdAt: string;
}

// ───────────────────────────────────────────────────────────────────────
//  Записи (appointments / bookings) — internal staff-side scheduling.
//  Backend: bookings/ module (migrations 075_bookings + 076_booking_settings).
//  A master books a client for a date/time; admin/owner sees all and may
//  assign/leave the master null. On «приход» the cash screen opens prefilled;
//  the saved check is then linked back via POST /bookings/:id/convert.
// ───────────────────────────────────────────────────────────────────────

export type BookingStatus = 'scheduled' | 'arrived' | 'converted' | 'cancelled' | 'no_show';

export interface Booking {
  id: string;
  tenantId: string;
  clientId: string;
  /** Denormalised from the client join (list/detail responses). */
  clientName?: string | null;
  clientPhone?: string | null;
  carId?: string | null;
  carPlate?: string | null;
  carMakeModel?: string | null;
  /** On whom the booking is. Null = unassigned (admin/owner only until assigned). */
  masterId?: string | null;
  masterName?: string | null;
  createdBy?: string | null;
  scheduledAt: string;
  comment?: string | null;
  status: BookingStatus;
  /** Set on conversion to the check created from the «приход» flow. */
  checkId?: string | null;
  checkNumber?: number | null;
  notifyOnCreate: boolean;
  reminderSentAt?: string | null;
  createdAt: string;
  cancelledAt?: string | null;
  cancelledBy?: string | null;
}

/**
 * POST/PATCH /bookings echo back the created/updated booking PLUS a soft
 * conflict: an overlapping scheduled booking for the same master near the
 * chosen time. It is a NON-blocking warning — the save already succeeded.
 */
export interface BookingMutationResult extends Booking {
  conflictWarning?: Booking | null;
}

export interface BookingSettings {
  /** Send the client a «вы записаны» message on create. */
  notifyClientOnCreate: boolean;
  /** Send the client a reminder N hours before. */
  reminderEnabled: boolean;
  reminderHours: number;
  /** 'auto' = use the provider configured in Маркетинг. */
  channel: 'auto' | 'sms' | 'whatsapp';
}

export interface Supplier {
  id: string;
  name: string;
  phone?: string;
  contactPerson?: string;
  comment?: string;
  totalPurchases: number;
  totalPaid: number;
  currentDebt: number;
  /** System-managed row — uneditable and undeletable. Currently used for the pinned "Покупка б/у товара" supplier. */
  isSystem?: boolean;
  /** Well-known marker. `'used_purchase'` is the inbound second-hand purchase channel; null for normal suppliers. */
  kind?: 'used_purchase' | null;
  createdAt: string;
}

export interface Delivery {
  id: string;
  supplierId: string;
  supplier?: Supplier;
  date: string;
  items: DeliveryItem[];
  totalAmount: number;
  paymentStatus: 'unpaid' | 'partial' | 'paid';
  comment?: string;
}

export interface DeliveryItem {
  id: string;
  productId: string;
  product?: Product;
  quantity: number;
  price: number;
  total: number;
}

export interface SupplierPayment {
  id: string;
  supplierId: string;
  amount: number;
  date: string;
  comment?: string;
}

export type StockMovementType =
  | 'income'
  | 'expense'
  | 'writeoff'
  | 'inventory'
  | 'defect_transfer'
  | 'used_transfer'
  | 'defect_return_to_supplier'
  // Inbound leg of a customer return to the main warehouse. Distinct from
  // 'income' (supplier purchase) so the journal renders «Возврат клиента».
  | 'customer_return';

export interface StockMovement {
  id: string;
  productId: string;
  product?: Product;
  type: StockMovementType;
  quantity: number;
  stockBefore: number;
  stockAfter: number;
  reason?: string;
  userId?: string;
  user?: { id: string; fullName: string } | null;
  /** Warehouse the movement applies to (target on transfers). */
  warehouseId?: string | null;
  warehouseName?: string | null;
  sourceWarehouseId?: string | null;
  sourceWarehouseName?: string | null;
  targetWarehouseId?: string | null;
  targetWarehouseName?: string | null;
  supplierId?: string | null;
  supplierName?: string | null;
  /** True when a writeoff also booked an `expenses` row. */
  recordAsExpense?: boolean;
  linkedExpenseId?: string | null;
  /** True when this movement is the inbound leg of a "Покупка б/у товара" — rendered specially in the journal. */
  isUsedPurchase?: boolean;
  createdAt: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  /**
   * OPTIONAL keyset cursor for the NEXT page. Only present on endpoints that
   * support keyset pagination (currently the checks journal) AND only when the
   * caller requested it via a `cursor` param. `null` means end-of-feed.
   * Offset-only callers never see this field — it stays undefined.
   */
  nextCursor?: string | null;
}

export interface FinancialReport {
  dateFrom: string;
  dateTo: string;
  revenue: number;
  productCost: number;
  salaries: number;
  grossProfit: number;
  netProfit: number;
  checkCount: number;
}

export interface SalaryPayment {
  id: string;
  userId: string;
  userName?: string;
  amount: number;
  monthYear: string;
  type: 'salary' | 'advance' | 'premium';
  comment?: string;
  createdBy?: string;
  creatorName?: string;
  date: string;
  /** When the employee confirmed receipt (049_salary_payment_confirmations). Null until confirmed. */
  confirmedAt?: string | null;
  createdAt: string;
}

export interface MasterSalary {
  masterId: string;
  masterName: string;
  salaryPercent: number;
  productSalaryPercent?: number;
  serviceEarnings?: number;
  productEarnings?: number;
  /** Sum of `type='cash'` premiums awarded inside the period (048_salary_premiums). */
  premiumsAmount?: number;
  /** Sum of penalties applied inside the period (056_salary_penalties). Subtracted from remainingAmount. */
  penaltiesAmount?: number;
  totalEarnings: number;
  totalRevenue: number;
  checkCount: number;
  paidAmount: number;
  /** totalEarnings − paidAmount − penaltiesAmount. */
  remainingAmount: number;
  payments?: SalaryPayment[];
  /** Premium rows awarded inside the period. */
  premiums?: SalaryPremium[];
  /** Penalty rows applied inside the period. */
  penalties?: SalaryPenalty[];
}

export interface ProductPromotion {
  productId: string;
  productName: string;
  percent: number;
  sellPrice: number;
  costPrice: number;
  photo?: string;
  estimatedBonus: number;
}

export interface SalarySummary {
  today: number;
  week: number;
  month: number;
  total: number;
  todayService?: number;
  todayProduct?: number;
  masterName: string;
  salaryPercent: number;
  productSalaryPercent?: number;
  todayChecks?: number;
  monthChecks?: number;
  todayCash?: number;
  todayCard?: number;
  todayWarranty?: number;
  productPromotions?: ProductPromotion[];
}

export interface DashboardStats {
  todayRevenue: number;
  todayChecks: number;
  weekRevenue: number;
  monthRevenue: number;
  todayProfit: number;
  monthProfit: number;
}

export interface EmployeeRanking {
  today: Array<{ masterId: string; masterName: string; revenue: number; checkCount: number }>;
  month: Array<{ masterId: string; masterName: string; revenue: number; checkCount: number }>;
}

export interface Shift {
  id: string;
  tenantId: string;
  userId: string;
  user?: User;
  date: string;
  openedAt: string;
  closedAt?: string | null;
  isAutoClosed: boolean;
  note?: string;
}

export type LateStatus = 'on_time' | 'late_minor' | 'late_major';

export interface ScheduleEntry {
  id: string;
  tenantId: string;
  userId: string;
  user?: User;
  date: string;
  shiftStart: string;
  shiftEnd: string;
  isDayOff: boolean;
  actualArrival?: string | null;
  lateMinutes: number;
  lateStatus?: LateStatus | null;
  note?: string;
  isManualOverride: boolean;
}

export interface WorkMode {
  id: string;
  tenantId: string;
  name: string;
  type: 'rotating' | 'weekly';
  workDays: number;
  offDays: number;
  weekDays: number[];
  shiftStart: string;
  shiftEnd: string;
}

export interface TodayEmployeeStatus {
  userId: string;
  fullName: string;
  role: string;
  isDayOff: boolean;
  shiftStart?: string | null;
  shiftEnd?: string | null;
  actualArrival?: string | null;
  lateMinutes: number;
  lateStatus?: LateStatus | null;
  note?: string | null;
  isWorking: boolean;
  hasSchedule: boolean;
}

export interface ExpenseCategory {
  id: string;
  name: string;
  tenantId: string;
  /** 057 — when true, non-privileged users' expenses in this category go to 'pending'. */
  approvalRequired?: boolean;
  createdAt: string;
}

export interface Expense {
  id: string;
  categoryId?: string;
  categoryName?: string;
  amount: number;
  description?: string;
  date: string;
  userId?: string;
  userName?: string;
  /** User who entered the row (047_expenses_by_employee). */
  createdBy?: string;
  creatorName?: string;
  /** 'owner' for owner/director/admin-created, 'employee' for non-privileged submitters. */
  source?: 'owner' | 'employee';
  /** 'approved' (default), 'pending' (over limit), 'rejected'. */
  approvalStatus?: 'approved' | 'pending' | 'rejected';
  createdAt: string;
}

export interface MarketingDashboard {
  totalReviews: number;
  avgRating: number;
  negativeReviews: number;
  positiveReviews: number;
  publicRedirects: number;
  tokensSent: number;
  tokensResponded: number;
  responseRate: number;
  conversionRate: number;
  unreadAlerts: number;
  employeeRatings: EmployeeReviewRating[];
}

export interface EmployeeReviewRating {
  employeeId: string;
  employeeName: string;
  reviewCount: number;
  avgRating: number;
  negativeRate: number;
}

export interface ReviewResponse {
  id: string;
  checkId?: string;
  clientId?: string;
  clientName?: string;
  employeeId?: string;
  employeeName?: string;
  rating: number;
  comment?: string;
  carMakeModel?: string;
  carPlate?: string;
  redirectedTo?: string;
  createdAt: string;
}

export interface ReviewAlert {
  id: string;
  alertType: 'consecutive_negative' | 'churn_risk';
  employeeName?: string;
  clientName?: string;
  details: Record<string, unknown>;
  isRead: boolean;
  createdAt: string;
}

export interface MessagingIntegration {
  id: string;
  // Mirrors the messaging_integrations.provider_type CHECK constraint —
  // migration 008 already widened the DB to include smsru / moizvonki.
  // Anything outside this union will be rejected by the backend DTO.
  providerType: 'whatsapp' | 'sms' | 'smsru' | 'moizvonki' | 'email';
  senderName?: string;
  senderPhone?: string;
  webhookUrl?: string;
  isActive: boolean;
  createdAt: string;
}

export interface ReviewPlatformLink {
  id: string;
  // Avito joined the list (migration 054). When extending — sync the
  // DB CHECK constraint AND the IntegrationsScreen / web ReviewPublic
  // platform map at the same time.
  platform: 'google' | 'yandex' | '2gis' | 'avito';
  url: string;
  isActive: boolean;
}

export interface ReviewSettings {
  sendTime: string;
  feedbackDelayHours: number;
  autoSendEnabled: boolean;
  messageTemplate: string;
  // "Подарок за отзыв" — single sentence the owner promises to clients
  // who leave honest reviews. Surfaced on the public landing page and
  // via the `{motivation}` variable in message templates.
  motivationMessage: string;
}

export interface PublicReviewData {
  tenantName: string;
  clientName?: string;
  employeeName?: string;
  platformLinks: ReviewPlatformLink[];
  // Optional — empty string when the tenant hasn't set anything.
  motivationMessage?: string;
}

export interface CheckPhoto {
  id: string;
  checkId: string;
  photoUrl: string;
  createdAt: string;
  createdBy: string;
}

export interface CheckTemplate {
  id: string;
  name: string;
  services: Array<{ serviceId?: string; name: string; price: number; quantity: number }>;
  products: Array<{ productId?: string; name: string; sellPrice: number; costPrice: number; quantity: number }>;
  createdAt: string;
}

export interface PushToken {
  token: string;
  platform: 'ios' | 'android';
}

export interface CallFunnel {
  totalCalls: number;
  uniqueCallers: number;
  arrivedClients: number;
  createdChecks: number;
  totalRevenue: number;
  avgCheckValue: number;
  repeatClients: number;
  conversionRate: number;
  period: { from: string; to: string };
}

export interface ReminderSettings {
  enabled: boolean;
  monthsInterval: number;
  messageTemplate: string;
  lastRunAt?: string | null;
}

// ───────────────────────────────────────────────────────────────────────
//  Returns
// ───────────────────────────────────────────────────────────────────────

export interface CheckReturn {
  id: string;
  checkId: string;
  destination: 'warehouse' | 'defect';
  reason?: string | null;
  refundAmount: number;
  scope: 'full' | 'partial';
  returnedBy?: string | null;
  createdAt: string;
  /** Joined from checks for journal display. */
  checkNumber?: number;
  checkTotal?: number;
  clientName?: string | null;
}

// ───────────────────────────────────────────────────────────────────────
//  Schedule settings (which attendance statuses count as a real shift)
// ───────────────────────────────────────────────────────────────────────

export interface ScheduleSettings {
  /**
   * Subset of allowed statuses: 'worked' | 'dayoff' | 'sick' | 'short' |
   * 'long' | 'absent'. Defaults to ['worked', 'short'].
   */
  shiftStatuses: string[];
}

// ───────────────────────────────────────────────────────────────────────
//  Employee profile / achievements / full profile composite
// ───────────────────────────────────────────────────────────────────────

export interface EmployeeProfile {
  id: string;
  fullName: string;
  role: string;
  hireDate?: string | null;
  specializations: string[];
  positionTitle?: string | null;
  customTitle?: string | null;
  monthlyKpiRevenue?: number | null;
  monthlyKpiChecks?: number | null;
  ownerNotes?: string | null;
  photoUrl?: string | null;
  whatsapp?: string | null;
}

export interface EmployeeDocument {
  id: string;
  type: string;
  name?: string | null;
  /**
   * Authenticated download endpoint
   * (`/api/employees/:id/documents/:docId/file`) — documents are PRIVATE
   * (passports etc.) and are no longer served from the public `/api/uploads/`
   * tier. Fetch with the JWT Authorization header; a bare <img src> without
   * auth will 401.
   */
  fileUrl: string;
  uploadedAt: string;
  expiresAt?: string | null;
}

export interface EmployeeAchievement {
  id: string;
  key: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  color?: string | null;
  type: 'auto' | 'custom';
  awardedBy?: string | null;
  awardedAt: string;
}

export interface EmployeeFullProfile {
  profile: EmployeeProfile;
  stats: {
    efficiency: number;
    discipline: number;
    activity: number;
    rating: number;
    quality: number;
  };
  streaks: {
    disciplineStreak: number;
    fiveStarStreak: number;
    checksStreak: number;
  };
  lifetime: {
    totalChecks: number;
    totalRevenue: number;
    clientsServed: number;
    bestDay?: { date: string; value: number };
    bestMonth?: { ym: string; value: number };
    topCarBrands: { brand: string; count: number }[];
    /** Most-sold products by this employee, descending by count. Optional / additive. */
    topProducts?: { productId: string; name: string; count: number; photo?: string }[];
  };
  /**
   * Shift / attendance summary for the employee. Populated only for tenants
   * with the «Смены» feature enabled (070 `shiftsEnabled`); omitted otherwise.
   */
  shifts?: {
    total: number;
    lateCount: number;
    avgLateMinutes: number;
    bestDay?: { date: string; checksCount: number };
    worstDay?: { date: string; checksCount: number };
  };
  yearHeatmap: { day: string; checks: number; revenue: number }[];
  teamRank: {
    revenueRank: number;
    disciplineRank: number;
    ratingRank: number;
    total: number;
  };
  serviceMastery: {
    serviceId: string;
    name: string;
    count: number;
    tier: 'bronze' | 'silver' | 'gold' | 'platinum';
  }[];
  careerTimeline: {
    date: string;
    kind: 'hire' | 'promotion' | 'top_month' | 'custom';
    title: string;
    description?: string;
  }[];
  achievements: EmployeeAchievement[];
}

// ───────────────────────────────────────────────────────────────────────
//  Owner dashboard v2 + supporting analytics
// ───────────────────────────────────────────────────────────────────────

export interface DashboardV2 {
  revenueToday: number;
  revenueMonth: number;
  checksToday: number;
  netProfitToday: number;
  netProfitMonth: number;
  cashPosition: { cash: number; card: number; warranty: number; total: number };
  marginPct: number;
  marginPctChange: number;
  marginSpark: number[];
  deferredSum: { count: number; sum: number };
  personalRecord: {
    bestDay?: { date: string; value: number };
    bestMonth?: { ym: string; value: number };
  };
  monthForecast: number;
  /** Returns recorded today (count + total refund amount). */
  returnsToday: number;
  returnsAmount: number;
  period: 'today' | 'week' | 'month' | 'year';
}

export interface ClientsNewVsReturning {
  newCount: number;
  returningCount: number;
  newRevenue: number;
  returningRevenue: number;
  period: { from: string; to: string };
}

export interface OwnerAlert {
  type: 'low_stock' | 'low_review' | 'warranty' | 'late_master' | 'pending_return';
  severity: 'info' | 'warn' | 'crit';
  message: string;
  link?: string;
}

export interface BestDayOfWeek {
  days: { weekday: number; revenue: number; count: number }[];
  best: number;
  worst: number;
}

export interface RecentReview {
  id: string;
  rating: number;
  comment?: string | null;
  clientName?: string | null;
  employeeName?: string | null;
  createdAt: string;
}

export interface RetentionStats {
  returningRate: number;
  avgLtv: number;
  avgDaysBetweenVisits: number;
}

// ───────────────────────────────────────────────────────────────────────
//  Warehouse analytics (045_stock_value_snapshots + computed endpoints)
// ───────────────────────────────────────────────────────────────────────

export interface WarehouseSummary {
  stockValueStart: number;
  stockValueCurrent: number;
  stockValueDelta: number;
  deltaPct: number;
  itemsCount: number;
  deadStock30: { count: number; value: number };
  deadStock60: { count: number; value: number };
  deadStock90: { count: number; value: number };
  abcAnalysis: { tier: 'A' | 'B' | 'C'; count: number; value: number; pct: number }[];
  avgMargin: number;
  gmroi: number;
  overStocked: { id: string; name: string; stock: number; sales: number }[];
  understocked: { id: string; name: string; stock: number; sales: number }[];
}

export interface VelocityRow {
  productId: string;
  name: string;
  soldQty: number;
  avgDailySales: number;
  currentStock: number;
  daysOfStock: number;
}

export interface ReorderItem {
  productId: string;
  name: string;
  currentStock: number;
  avgDailySales: number;
  daysOfStock: number;
  urgency: 'critical' | 'now' | 'soon' | 'overstocked';
  recommendedOrderQty: number;
}

export interface CategoryMargin {
  category: string;
  revenue: number;
  cost: number;
  margin: number;
  marginPct: number;
}

export interface TopProduct {
  productId: string;
  name: string;
  soldQty: number;
  revenue: number;
  profit: number;
}

// ───────────────────────────────────────────────────────────────────────
//  Active warranties (cash screen helper)
// ───────────────────────────────────────────────────────────────────────

export interface ActiveWarranty {
  kind: 'product' | 'service';
  name: string;
  expiresAt: string;
  daysLeft: number;
}

/**
 * Active warranty for a single car — badge-ready shape returned by
 * `GET /warranty-claims/active-for-car/:carId` (warrantyApi.activeForCar).
 * Drives the "Диагностика ещё N дней" chips on the CheckCreate screen.
 */
export interface WarrantyActive {
  id: string;
  itemType: 'product' | 'service';
  itemName: string;
  warrantyDays: number;
  expiresAt: string;
}

// ───────────────────────────────────────────────────────────────────────
//  Client sources (046_clients_source) and per-car checks (052)
// ───────────────────────────────────────────────────────────────────────

export interface ClientSources {
  sources: string[];
}

export interface PerCarChecks {
  carId: string;
  carPlate?: string;
  makeModel?: string;
  checks: Array<{
    id: string;
    number: number;
    date: string;
    totalRevenue: number;
    paymentMethod?: string;
    masterName?: string | null;
    carPlate?: string | null;
    carMakeModel?: string | null;
    isReturned?: boolean;
    isDeferred?: boolean;
  }>;
}

// ───────────────────────────────────────────────────────────────────────
//  Salary premiums (048_salary_premiums)
// ───────────────────────────────────────────────────────────────────────

export interface SalaryPremium {
  id: string;
  userId: string;
  userName?: string;
  type: 'cash' | 'rate_bonus';
  amount?: number;
  bonusPercent?: number;
  reason: string;
  periodMonthYear?: string;
  awardedBy?: string;
  awarderName?: string;
  awardedAt: string;
}

// ───────────────────────────────────────────────────────────────────────
//  Salary penalties (штрафы, 056_salary_penalties)
// ───────────────────────────────────────────────────────────────────────

export interface SalaryPenalty {
  id: string;
  userId: string;
  userName?: string;
  /** Positive deduction amount (RUB). Subtracted from the employee's remaining owed salary. */
  amount: number;
  description?: string;
  /** When the penalty applies. */
  date: string;
  createdBy?: string;
  creatorName?: string;
  createdAt: string;
}

// ───────────────────────────────────────────────────────────────────────
//  Journal / warehouse documents (050_journal_warehouse_docs_index)
// ───────────────────────────────────────────────────────────────────────

export interface JournalDoc {
  id: string;
  kind:
    | 'purchase'
    | 'return_to_supplier'
    | 'customer_return'
    | 'defect_transfer'
    | 'writeoff'
    | 'supplier_payment'
    | 'used_purchase';
  occurredAt: string;
  title: string;
  subtitle?: string;
  amount: number;
  badge: string;
  badgeColor: string;
  payeeName?: string;
}

// ───────────────────────────────────────────────────────────────────────
//  Knowledge Base / «База знаний» (063_knowledge_base)
//  Searchable KB (categories + articles + attachments) + regulations with
//  per-user acknowledgment ("Ознакомлен"). All tenant-scoped.
// ───────────────────────────────────────────────────────────────────────

export interface KnowledgeCategory {
  id: string;
  name: string;
  /** Ionicons name for the UI (e.g. 'document-text-outline'). */
  icon?: string;
  sortOrder: number;
}

export interface KnowledgeAttachment {
  url: string;
  name: string;
  size?: number;
  /**
   * Attachment kind. Absent on legacy attachments → treat as 'document'.
   * 'video' attachments may additionally carry `videoType`.
   */
  type?: 'image' | 'video' | 'document';
  /** For `type: 'video'` — how the `url` should be embedded/played. */
  videoType?: 'youtube' | 'vk' | 'embed';
}

/** 'article' = free-form KB article; 'regulation' = requires acknowledgment. */
export type KnowledgeArticleType = 'article' | 'regulation';

/**
 * Full article shape. The slim list endpoint (`listArticles`) returns a subset:
 * id, title, type, categoryId, pinned, coverImage, updatedAt, excerpt — the
 * heavy fields (body, attachments, acknowledged) are populated only by
 * `getArticle`. Both are typed as Partial-friendly via optional fields here.
 */
export interface KnowledgeArticle {
  id: string;
  categoryId?: string;
  /** Present on the full article (getArticle), omitted from the slim list. */
  categoryName?: string;
  type: KnowledgeArticleType;
  title: string;
  /** Markdown. Empty string on the slim list; full text on getArticle. */
  body: string;
  /** Short plain-text preview derived from the body (present on both list + detail). */
  excerpt?: string;
  coverImage?: string;
  /** Empty array on the slim list; populated on getArticle. */
  attachments: KnowledgeAttachment[];
  pinned: boolean;
  published: boolean;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  /** For type='regulation' on getArticle: whether THIS user has acked the CURRENT version. */
  acknowledged?: boolean;

  // ─── Регламенты+ (064) ────────────────────────────────────────────────────
  /** Current revision. A version bump re-requires acknowledgment. (getArticle) */
  version?: number;
  /** Regulation must be acknowledged by the audience. */
  mandatory?: boolean;
  /** ISO date by which a mandatory regulation should be acknowledged. */
  dueDate?: string;
  /** Total times this article was opened (fire-and-forget counter). */
  viewCount?: number;
  /** Optional car-make tag for contextual KB (e.g. 'Lada'). null/absent = all makes. */
  carMake?: string;
  /** helpful-vote count (getArticle). */
  helpfulCount?: number;
  /** not-helpful-vote count (getArticle). */
  notHelpfulCount?: number;
  /** THIS user's own feedback vote: true=helpful, false=not, undefined=no vote yet. */
  myFeedback?: boolean;
}

export interface KnowledgeAck {
  userId: string;
  userName: string;
  acknowledgedAt: string;
}

/** Response of GET /knowledge/articles/:id/acks (manager). */
export interface KnowledgeAcksResponse {
  /** Users who acknowledged, newest first. */
  acknowledged: KnowledgeAck[];
  /** Active tenant employees who have NOT acknowledged yet. */
  pending: { userId: string; userName: string }[];
  acknowledgedCount: number;
  /** acknowledged + pending — drives "8/10 ознакомлены". */
  totalAudience: number;
}

/** Response of GET /knowledge/regulations/summary-for-user/:userId (manager). */
export interface RegulationUserSummary {
  total: number;
  acknowledged: number;
}

/** Response of POST /knowledge/articles/:id/feedback. */
export interface ArticleFeedbackResult {
  helpfulCount: number;
  notHelpfulCount: number;
  /** The vote just recorded by THIS user. */
  myFeedback: boolean;
}

// ───────────────────────────────────────────────────────────────────────
//  Учебный центр / Learning center (064) — courses → lessons → progress
//  + quizzes + completion. READ: any user; WRITE: manager roles.
// ───────────────────────────────────────────────────────────────────────

/** A single quiz question. `correctIndex` is only present for managers (editing). */
export interface KnowledgeQuizQuestion {
  question: string;
  options: string[];
  /** Index of the correct option. Omitted in learner-facing payloads. */
  correctIndex?: number;
}

/**
 * Course shape. The list endpoint (`listCourses`) and getCourse share this base;
 * getCourse additionally returns `lessons`. Progress fields are per signed-in user.
 */
export interface KnowledgeCourse {
  id: string;
  title: string;
  description: string;
  coverImage?: string;
  categoryId?: string;
  published: boolean;
  sortOrder: number;
  lessonCount: number;
  /** Lessons completed by THIS user. */
  completedLessons: number;
  /** 0–100, derived from completedLessons / lessonCount. */
  progressPercent: number;
  /** Whether THIS user has a course_completion row. */
  completed: boolean;
  createdAt: string;
  updatedAt: string;
  /** Present only on getCourse. */
  lessons?: KnowledgeLesson[];
}

export interface KnowledgeLesson {
  id: string;
  title: string;
  /** Markdown. */
  body: string;
  sortOrder: number;
  /** Whether THIS user completed the lesson. */
  completed: boolean;
  hasQuiz: boolean;
  /** Present when hasQuiz; learner payloads omit each question's correctIndex. */
  quiz?: KnowledgeQuizQuestion[];
  createdAt: string;
  updatedAt: string;
}

/** Response of POST /knowledge/lessons/:id/complete. */
export interface LessonProgress {
  lessonId: string;
  lessonCompleted: boolean;
  courseId: string;
  /** True when this completion finished every lesson in the course. */
  courseCompleted: boolean;
  progress: { completed: number; total: number };
}

/** Response of GET /knowledge/courses/:id/progress/:userId (manager). */
export interface CourseProgress {
  courseId: string;
  userId: string;
  total: number;
  completed: number;
  /** 0–100. */
  percent: number;
  /** ISO timestamp of course completion, or null if not completed. */
  completedAt: string | null;
}

// ───────────────────────────────────────────────────────────────────────
//  Справочник типовых неисправностей / Troubleshooting (064)
// ───────────────────────────────────────────────────────────────────────

export type TroubleshootingSeverity = 'low' | 'med' | 'high';

export interface Troubleshooting {
  id: string;
  /** Short symptom headline. */
  title: string;
  /** e.g. «Двигатель», «Тормоза». */
  system?: string;
  /** Applies to this car make; absent = all makes. */
  carMake?: string;
  symptom: string;
  cause: string;
  /** Markdown. */
  solution: string;
  severity?: TroubleshootingSeverity;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

/** Response of GET /knowledge/for-car. */
export interface KnowledgeForCar {
  make: string | null;
  model: string | null;
  /** Slim articles: general (car_make null) + make-specific. */
  articles: KnowledgeArticle[];
  /** Troubleshooting entries for this make (empty when no make given). */
  troubleshooting: Troubleshooting[];
}
