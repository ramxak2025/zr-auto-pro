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

/**
 * Admin-UI grouping for the plan feature toggles (no enforcement meaning).
 * Mirrors shared/constants/features.ts FeatureGroup + backend feature-catalog.ts.
 */
export type FeatureGroup = 'core' | 'section' | 'integration';

/**
 * One entry of the authoritative plan feature catalog
 * (GET /plans/features-catalog, superadmin). The plan editor renders one toggle
 * per item — including keys a plan currently has OFF — grouped by `group`.
 */
export interface FeatureCatalogItem {
  key: string;
  label: string;
  /** Does this key gate a screen via FeatureGate? */
  gated: boolean;
  group: FeatureGroup;
}

/**
 * Tenant subscription state (102). Drives the professional block screen + hard
 * gate on every client:
 *   active    — in-window (or no expiry) and not suspended;
 *   expired   — subscription_end has passed;
 *   suspended — an operator explicitly suspended the tenant (or a legacy manual
 *               is_active=false). 'suspended' takes precedence over 'expired'.
 * Missing on a legacy payload ⇒ treat as 'active'.
 */
export type SubscriptionStatus = 'active' | 'expired' | 'suspended';

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
  /**
   * 092 — «Кассовая смена + роли» POS shift-mode master toggle. Absent on legacy
   * payloads → treat as `false`. When ON, a non-cashier master can only create
   * deferred work-orders and cannot close / take payment (server-enforced). When
   * OFF (default) the check/payment flow is unchanged. Mutable through PATCH
   * /my-company (Partial<Tenant>, director/superadmin) or PATCH /checks/pos-settings
   * (director/admin/superadmin) — see {@link PosSettings}.
   */
  shiftModeEnabled?: boolean;
  /**
   * 102 — explicit suspension marker (superadmin POST /tenants/:id/suspend).
   * Non-null ⇒ the tenant is suspended (and is_active is forced false).
   * Absent/null on legacy payloads.
   */
  suspendedAt?: string | null;
  /** 102 — optional human note for the suspension. */
  suspendedReason?: string | null;
  users?: User[];
  userCount?: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * 092 — POS shift-mode settings surface (GET/PATCH /checks/pos-settings).
 * `isCashier` is the CALLER's resolved capability (owner-class role OR the
 * `accept_payment` permission) — clients use it to decide the master order-create
 * flow + tab-bar swap without re-deriving the rule. PATCH accepts only
 * `shiftModeEnabled` and is owner-gated; GET is readable by any authenticated
 * user so a master can learn the mode.
 */
export interface PosSettings {
  shiftModeEnabled: boolean;
  isCashier: boolean;
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
  /**
   * 102 — authoritative subscription status. Clients render the block message +
   * hard gate from this. Absent on a legacy payload ⇒ treat as 'active' (so old
   * clients behave exactly as today when the field is missing).
   */
  status: SubscriptionStatus;
  monthlyPrice: number;
  /**
   * 102 — the tenant's effective plan price (== monthlyPrice). Explicit alias so
   * the block screens can render «тариф X — N ₽» without aliasing in the UI.
   */
  planPrice: number;
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

/**
 * Subscription billing state a broadcast segment can target (096):
 *   trial   — active & in-window on a free (monthly_price = 0) plan;
 *   paid    — active & in-window on a paid (monthly_price > 0) plan;
 *   expired — subscription lapsed (subscription_end in the past).
 */
export type BroadcastSubscriptionStatus = 'trial' | 'paid' | 'expired';

/**
 * Optional recipient segment for a superadmin broadcast (096). ABSENT / empty =
 * every active tenant (back-compat). Criteria AND-combine; the statuses inside
 * `subscriptionStatuses` OR-combine. Resolved to a frozen tenant set at SEND
 * time, so a deferred broadcast targets the tenants matching it when it fires.
 */
export interface BroadcastSegment {
  /** Match tenants whose plan is any of these plan ids. */
  planIds?: string[];
  /** Match tenants in any of these billing states. */
  subscriptionStatuses?: BroadcastSubscriptionStatus[];
  /** 'active' = has checks within the window; 'dormant' = none. */
  activity?: 'active' | 'dormant';
  /** Activity window in days (default 30). */
  activityWindowDays?: number;
  /** Include manually-disabled (is_active = false) tenants too (default false). */
  includeInactive?: boolean;
}

/** A persisted superadmin → director broadcast (GET /notifications/broadcasts/unseen). */
export interface Broadcast {
  id: string;
  title: string;
  body: string;
  imageUrl?: string;
  buttons: BroadcastButton[];
  createdAt: string;
  /**
   * 096 — delivery instant (≈ createdAt for an immediate send, a future instant
   * for a deferred one). Optional/null for legacy rows that predate scheduling.
   */
  scheduledAt?: string | null;
  /** 096 — when fan-out fired; null = still queued (a scheduled, not-yet-sent broadcast). */
  sentAt?: string | null;
}

/**
 * One row of superadmin broadcast history (GET /admin/broadcasts, newest-first,
 * superadmin-only). `cancelledAt` is the revoke marker: `null` = live and still
 * surfacing to directors; a timestamp means it was cancelled (DELETE
 * /admin/broadcast/:id) and no longer reaches anyone. `seenCount` is how many
 * directors have acknowledged it.
 */
export interface BroadcastHistoryItem {
  id: string;
  title: string;
  body: string;
  imageUrl?: string;
  buttons: BroadcastButton[];
  createdAt: string;
  cancelledAt: string | null;
  seenCount: number;
  // ─── 096 — targeting + scheduling ──────────────────────────────────────────
  /** Delivery instant; for a deferred broadcast this is its future send time. */
  scheduledAt: string | null;
  /** When fan-out fired; null = still queued (scheduled, not yet sent). */
  sentAt: string | null;
  /** Segment criteria; null = broadcast to ALL active tenants. */
  segment: BroadcastSegment | null;
  /** true = sent to everyone (no segment). */
  targetAll: boolean;
  /** Materialized target tenants (0 for target_all, or for a not-yet-sent segment). */
  recipientCount: number;
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
 * One month of the platform MRR trend (GET /admin/mrr-trends, superadmin-only).
 *
 * Reconstructed from CURRENT tenant/plan state — Autexa keeps no historical
 * subscription snapshots, so a tenant counts toward a month if it existed by
 * that month's end and its subscription was still valid then; current
 * `is_active` is used as the activity proxy. Oldest month first.
 */
export interface MrrTrendPoint {
  /** Month label, 'YYYY-MM'. */
  month: string;
  /** Σ monthly_price of active PAYING tenants that month (rubles, rounded). */
  mrr: number;
  /** Active tenants that month. */
  activeTenants: number;
  /** Tenants created during that month. */
  newTenants: number;
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

/** Subscription block of the superadmin tenant cabinet (GET /tenants/:id/cabinet). */
export interface TenantSubscriptionStatus {
  status: SubscriptionStatus;
  planId: string | null;
  planName: string | null;
  planPrice: number;
  subscriptionEnd: string | null;
  suspendedAt: string | null;
  suspendedReason: string | null;
  maxUsers: number;
  currentUsers: number;
}

/**
 * Superadmin "drill into a tenant" cabinet (GET /tenants/:id/cabinet,
 * superadmin-only). One composed payload: identity + subscription status/plan +
 * the activity {@link TenantMetrics} (same aggregates as GET /tenants/:id/metrics).
 */
export interface TenantCabinet {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  subscription: TenantSubscriptionStatus;
  metrics: TenantMetrics;
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
  /**
   * «Кассир смены» — may accept payment / close a check when the tenant's POS
   * shift-mode is ON (Tenant.shiftModeEnabled). A master WITHOUT this can only
   * create deferred work-orders in shift-mode (server-enforced in ChecksService).
   * Owner-class roles (director/admin/superadmin) are implicit cashiers. When
   * shift-mode is OFF this flag has no effect (current behaviour preserved).
   */
  accept_payment?: boolean;
  /**
   * «Продажа в рассрочку» (093) — may create a check with paymentMethod
   * 'installment'. Owner-class roles (director/admin/superadmin) are implicit.
   * Server-enforced in ChecksService.create; rejected otherwise.
   */
  sell_installment?: boolean;
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
  | 'accept_payment'
  | 'sell_installment'
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
    'accept_payment',
    'sell_installment',
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
    accept_payment: false, // not a cashier by default — owner grants it explicitly
    sell_installment: false, // продажа в рассрочку — owner grants it explicitly
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

/**
 * One row of a product's price-change ledger — returned by
 * `GET /products/:id/price-history` (productsApi.priceHistory). Backend
 * orders newest-first, capped at 50 rows. The cost fields are role-sensitive
 * on the client (masters don't see cost), so consumers must gate them the
 * same way they gate `costPrice` on the product itself.
 */
export interface ProductPriceHistoryEntry {
  id: string;
  costPriceBefore: number;
  costPriceAfter: number;
  sellPriceBefore: number;
  sellPriceAfter: number;
  user: { id: string; fullName: string } | null;
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
  /**
   * Рассрочка (093). The check is a real sale (revenue counts in full); the
   * cash/card amounts are the FIRST instalment (первый взнос), and the rest is
   * owed via an `InstallmentPlan` created server-side from the check. Creating a
   * check with this method requires the `sell_installment` permission.
   */
  INSTALLMENT = 'installment',
}

/**
 * Канбан-статус заказ-наряда. Historically (board 082) a fixed enum
 * приёмка → в работе → готов → выдан; since 091 the columns are
 * OWNER-CONFIGURABLE, so the work-status is now an arbitrary column KEY (slug).
 * These four are kept as the LEGACY DEFAULT keys (seeded for every tenant) so
 * existing consumers that reference them still compile. ORTHOGONAL to payment
 * state — purely a board-tracking flag. NULL/undefined = not on the board.
 *
 * @deprecated The board is no longer limited to these four; treat work-status as
 * an open `string`. Kept only for back-compat with code that hard-codes them.
 */
export type CheckWorkStatus = 'accepted' | 'in_progress' | 'ready' | 'delivered';

/**
 * Owner-configurable kanban board column (091). `key` is the slug stored in a
 * check's workStatus; the rest is presentation + behaviour. `notifyClient`
 * marks the column whose entry fires the «машина готова» client notification.
 */
export interface WorkBoardColumn {
  id: string;
  key: string;
  label: string;
  /** Hex accent color (e.g. '#22C55E'); null → UI falls back to a neutral. */
  color: string | null;
  /** Left-to-right board order. */
  sortOrder: number;
  /** Hidden columns drop off the board until re-enabled. */
  isActive: boolean;
  /** Entry into this column fires the «машина готова» client notification. */
  notifyClient: boolean;
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
  /**
   * Канбан work-status (082 + 091). The KEY of an owner-configured board column
   * (or one of the legacy CheckWorkStatus keys). NULL = не на доске. Additive &
   * orthogonal to payment — existing consumers safely ignore it. Loosened from
   * the fixed CheckWorkStatus union to `string` now that columns are
   * owner-configurable.
   */
  workStatus?: string | null;
  /**
   * Journal executor marker (#59). Only populated on the check LIST response
   * (GET /checks): true when the REQUESTING user is a service-line executor on
   * this check but is NOT its creator (i.e. they were added as an executor by
   * someone else). Drives a per-check tint in the journal. Additive & per-viewer
   * — absent/false everywhere else; existing consumers safely ignore it.
   */
  isExecutor?: boolean;
  createdAt: string;
}

/**
 * Kanban board response from GET /checks/board (091). BREAKING SHAPE CHANGE vs
 * the old fixed {accepted,in_progress,ready,delivered} object:
 *
 *   - `columns`: the tenant's ACTIVE board columns, ordered by sortOrder.
 *   - `groups`: a map keyed by column key → that column's checks, newest-first,
 *     capped server-side (≈100/column). Every active column key is present
 *     (empty array when the column holds no checks).
 *
 * Consumers iterate `columns` to render headers and read `groups[column.key]`
 * for each column's cards.
 */
export interface ChecksBoard {
  columns: WorkBoardColumn[];
  groups: Record<string, Check[]>;
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

// ───────────────────────────────────────────────────────────────────────
//  Кассовая смена / Z-отчёт / Инкассация (cash shift / Z-report / collection).
//  Backend: cash-shifts/ module (migration 080_cash_shifts). ADDITIVE — purely
//  read-aggregated from existing checks/expenses; does not change cash-flow,
//  checks or expenses write behaviour. At most ONE open shift per tenant.
// ───────────────────────────────────────────────────────────────────────

export type CashShiftStatus = 'open' | 'closed';

export interface CashShift {
  id: string;
  tenantId: string;
  openedBy?: string | null;
  /** Denormalised from the users join. */
  openedByName?: string | null;
  openedAt: string;
  /** Разменная касса / float counted in the drawer at open. */
  openingAmount: number;
  closedBy?: string | null;
  closedByName?: string | null;
  closedAt?: string | null;
  /** Фактический нал при закрытии. Null while open. */
  closingAmount?: number | null;
  /** Расчётный остаток, frozen at close. Null while open. */
  expectedAmount?: number | null;
  /** closingAmount − expectedAmount (>0 излишек, <0 недостача). Null while open. */
  difference?: number | null;
  status: CashShiftStatus;
  note?: string | null;
  createdAt: string;
}

export interface CashCollection {
  id: string;
  tenantId: string;
  shiftId: string;
  amount: number;
  collectedBy?: string | null;
  collectedByName?: string | null;
  collectedAt: string;
  note?: string | null;
  createdAt: string;
}

/**
 * Z-отчёт — the reconciliation of one shift window [windowStart, windowEnd].
 * Returned by open / close / current / report / collect.
 *
 *   expectedAmount = openingAmount + cashSales − cashExpenses − collectionsTotal
 *   difference     = factualAmount − expectedAmount   (null while the shift is open)
 *
 * cashSales/cardSales come from checks.cash_amount / checks.card_amount over
 * non-deferred checks in the window, so a split-payment check is counted by
 * tender and returns are already netted in place. cashExpenses = approved
 * expenses in the window (treated as cash out of the drawer).
 */
export interface CashShiftReport {
  shift: CashShift;
  /** Net cash taken from sales (Σ checks.cash_amount, non-deferred, returns netted). */
  cashSales: number;
  /** Net card taken from sales (Σ checks.card_amount, non-deferred, returns netted). */
  cardSales: number;
  /** Σ checks.total_revenue in the window (cash + card + any warranty). */
  totalRevenue: number;
  /** Σ approved expenses in the window — cash outflow from the drawer. */
  cashExpenses: number;
  /** Σ инкассация for this shift. */
  collectionsTotal: number;
  /** Count of non-deferred checks in the window. */
  checksCount: number;
  openingAmount: number;
  expectedAmount: number;
  /** Фактический нал при закрытии. Null while the shift is open. */
  factualAmount: number | null;
  /** factualAmount − expectedAmount. Null while the shift is open. */
  difference: number | null;
  collections: CashCollection[];
  windowStart: string;
  windowEnd: string;
}

// ───────────────────────────────────────────────────────────────────────
//  Дебиторка / долги клиентов (client receivables / debts ledger).
//  Backend: debts/ (migration 081). A plain double-sided ledger per client.
//  charge = client owes more, payment = repayment. Balance = Σcharge − Σpayment
//  (never clamped — may go negative when the client overpays / has credit).
// ───────────────────────────────────────────────────────────────────────

export type ClientDebtType = 'charge' | 'payment';

/** One movement in a client's debt ledger. */
export interface ClientDebtEntry {
  id: string;
  tenantId: string;
  clientId: string;
  /** Positive money amount of this single movement; direction is in `type`. */
  amount: number;
  /** 'charge' = долг вырос, 'payment' = погашение. */
  type: ClientDebtType;
  reason?: string | null;
  /** Soft link to the originating check, if any (nulled if that check is deleted). */
  checkId?: string | null;
  /** Denormalised from the checks join — present when checkId links to a check. */
  checkNumber?: string | null;
  createdBy?: string | null;
  /** Denormalised from the users join. */
  createdByName?: string | null;
  createdAt: string;
}

/** Read-only context inside a debt summary — an outstanding deferred check. */
export interface DebtDeferredCheck {
  id: string;
  number: string;
  date: string;
  totalRevenue: number;
}

/**
 * Per-client debt summary. Returned by GET /debts/client/:clientId and by the
 * charge / payment / delete mutations (so the UI updates instantly).
 *
 *   balance = Σcharge − Σpayment  (may be negative = client has credit)
 *
 * `deferredChecks` is READ-ONLY context (outstanding is_deferred checks) and is
 * NOT counted in `balance` — purely informational for the per-client UI.
 */
export interface ClientDebtSummary {
  clientId: string;
  clientName?: string | null;
  clientPhone?: string | null;
  balance: number;
  ledger: ClientDebtEntry[];
  deferredChecks: DebtDeferredCheck[];
}

/** One row in the debtors overview — a client with a positive balance. */
export interface Debtor {
  clientId: string;
  name: string;
  phone?: string | null;
  /** Positive outstanding balance (Σcharge − Σpayment). */
  balance: number;
}

// ───────────────────────────────────────────────────────────────────────
//  Рассрочка (installments). Backend: installments/ (migration 093). REPLACES
//  the manual «Дебиторка» (debts/, 081) as the primary sell-on-credit flow.
//
//  A plan is created server-side when a check is sold with paymentMethod
//  'installment' (gated by the `sell_installment` permission): the check is a
//  real sale (revenue counts), down_payment = первый взнос (cash+card paid now),
//  and `remaining` (= total − paid) is owed. Partial payments live in a per-plan
//  ledger; when remaining hits 0 the plan closes.
// ───────────────────────────────────────────────────────────────────────

export type InstallmentStatus = 'open' | 'closed';

/** One installment plan (one per check). */
export interface InstallmentPlan {
  id: string;
  tenantId: string;
  /** Originating check (nulled if that check is deleted — the debt record stays). */
  checkId?: string | null;
  /** Denormalised order-наряд number from the checks join, when checkId is set. */
  checkNumber?: number | null;
  clientId: string;
  /** Denormalised from the clients join. */
  clientName?: string | null;
  clientPhone?: string | null;
  /** Full sale amount (= the check's totalRevenue at sale time). */
  total: number;
  /** Первый взнос (cash + card paid at sale time). */
  downPayment: number;
  /** Everything collected so far INCLUDING the down payment (downPayment + Σ payments). */
  paid: number;
  /** Outstanding debt = total − paid (never negative). */
  remaining: number;
  /** Date of the next expected payment (YYYY-MM-DD). Null = not scheduled. */
  nextPaymentDate?: string | null;
  status: InstallmentStatus;
  /** True when open AND nextPaymentDate is in the past (computed server-side). */
  overdue: boolean;
  /** Whole days until nextPaymentDate (negative = overdue by N). Null when unscheduled. */
  dueInDays?: number | null;
  comment?: string | null;
  createdBy?: string | null;
  /** Denormalised from the users join. */
  createdByName?: string | null;
  createdAt: string;
  closedAt?: string | null;
}

/** One movement in a plan's payment ledger. */
export interface InstallmentPayment {
  id: string;
  tenantId: string;
  planId: string;
  /** Positive money amount of this payment. */
  amount: number;
  comment?: string | null;
  createdBy?: string | null;
  createdByName?: string | null;
  paidAt: string;
}

/**
 * A client's installment summary — for the client card section. Returned by
 * GET /installments/client/:clientId.
 */
export interface InstallmentClientLedger {
  clientId: string;
  clientName?: string | null;
  clientPhone?: string | null;
  /** Σ remaining over the client's OPEN plans. */
  totalRemaining: number;
  plans: InstallmentPlan[];
  payments: InstallmentPayment[];
}

/** One row in the Главная installment widget (due-soon / overdue). */
export interface InstallmentWidgetItem {
  planId: string;
  clientId: string;
  clientName?: string | null;
  clientPhone?: string | null;
  total: number;
  remaining: number;
  nextPaymentDate?: string | null;
  overdue: boolean;
  /** Whole days until nextPaymentDate (negative = overdue by N). */
  dueInDays?: number | null;
}

/**
 * GET /installments/widget response (owner/admin): open plans due within the
 * next N days plus all overdue ones, with summary counts for the dashboard card.
 */
export interface InstallmentWidget {
  items: InstallmentWidgetItem[];
  overdueCount: number;
  dueSoonCount: number;
  totalRemaining: number;
}

/**
 * Per-tenant installment-reminder settings (093). Mirrors car_ready_settings:
 * disabled (mode 'off') by default. 'auto' = a daily cron sends; 'manual' = the
 * owner fires reminders from the UI. Template placeholders: {clientName},
 * {amount}, {date}.
 */
export interface InstallmentReminderSettings {
  mode: 'off' | 'auto' | 'manual';
  /** Days before nextPaymentDate to send a pre-reminder. */
  daysBefore: number;
  /** Also remind on the due date itself. */
  onDue: boolean;
  /** Also remind on overdue plans. */
  onOverdue: boolean;
  template: string;
  lastRunAt?: string | null;
}

/** Result of a reminder send (manual trigger / cron summary). */
export interface InstallmentReminderSendResult {
  sent: number;
  failed: number;
  total: number;
}

// ───────────────────────────────────────────────────────────────────────
//  Программа лояльности / бонусы / кешбэк (loyalty / bonus / cashback).
//  Backend: loyalty/ (migration 083). Per-tenant config + single-sided bonus
//  ledger per client. accrual = bonus credited, redemption = bonus spent.
//  balance = Σaccrual − Σredemption (never negative — a redemption that would
//  overdraw is rejected 400). ADDITIVE — does NOT touch the checks write path;
//  the cash UI calls accrue/redeem explicitly. Apple Wallet is a later task.
// ───────────────────────────────────────────────────────────────────────

export type BonusType = 'accrual' | 'redemption';

/** Per-tenant loyalty config. Returned by GET/PATCH /loyalty/settings. */
export interface LoyaltySettings {
  /** Master switch. While false: no accrual (422); existing balance still spendable. */
  enabled: boolean;
  /** % of a check total credited as bonus on accrual (0..100). */
  accrualPercent: number;
  /** Max % of a single check payable with bonus on redemption (0..100). */
  redeemMaxPercent: number;
  updatedAt?: string | null;
}

/** One movement in a client's bonus ledger. */
export interface BonusEntry {
  id: string;
  tenantId: string;
  clientId: string;
  /** Positive money amount of this single movement; direction is in `type`. */
  amount: number;
  /** 'accrual' = бонус начислен, 'redemption' = бонус списан. */
  type: BonusType;
  reason?: string | null;
  /** Soft link to the originating check, if any (nulled if that check is deleted). */
  checkId?: string | null;
  /** Denormalised from the checks join — present when checkId links to a check. */
  checkNumber?: string | null;
  createdBy?: string | null;
  /** Denormalised from the users join. */
  createdByName?: string | null;
  createdAt: string;
}

/**
 * Per-client bonus summary. Returned by GET /loyalty/client/:clientId and by the
 * accrue / redeem / adjust mutations (so the UI updates instantly).
 *
 *   balance = Σaccrual − Σredemption  (never negative)
 */
export interface ClientBonusSummary {
  clientId: string;
  clientName?: string | null;
  clientPhone?: string | null;
  /** Mirrors loyalty_settings.enabled so the UI can show/hide accrue/redeem. */
  enabled: boolean;
  balance: number;
  totalAccrued: number;
  totalRedeemed: number;
  ledger: BonusEntry[];
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
  /**
   * Set when this supply (поставка) was created by receiving a purchase order
   * (migration 098). null for manual / legacy deliveries. Lets the «Поставки»
   * tab show "по заказу" and link back to the order.
   */
  purchaseOrderId?: string | null;
  /** User who accepted the supply at receiving (order-sourced supplies). */
  receivedBy?: string | null;
}

export interface DeliveryItem {
  id: string;
  productId: string;
  product?: Product;
  quantity: number;
  price: number;
  total: number;
  /** The purchase-order line this supply line received against (098); null otherwise. */
  purchaseOrderItemId?: string | null;
}

export interface SupplierPayment {
  id: string;
  supplierId: string;
  amount: number;
  date: string;
  comment?: string;
  /**
   * Set when this payment was auto-created by «Оплатить сразу» at order receiving
   * (migration 098) — points at the supply (delivery) it settled. null for manual
   * payments made from the supplier Payments flow.
   */
  deliveryId?: string | null;
}

// ───────────────────────────────────────────────────────────────────────
//  Заказы поставщикам + приёмка (purchase orders + receiving).
//  Backend: purchase-orders/ (migration 084). Lifecycle:
//    draft → ordered → received   (or → cancelled while not yet received).
//  Receiving credits product stock through the SAME `income` stock-movement
//  path manual receiving uses (transactional: PO status + every stock income
//  commit or roll back together). ADDITIVE — does NOT touch any existing write
//  path; it only calls the income service.
// ───────────────────────────────────────────────────────────────────────

export type PurchaseOrderStatus = 'draft' | 'ordered' | 'received' | 'cancelled';

/** One line on a purchase order. `name` + `costPrice` are snapshots at create time. */
export interface PurchaseOrderItem {
  id: string;
  purchaseOrderId: string;
  productId: string;
  /** Product name snapshot (survives later renames). */
  name: string;
  /** Ordered quantity. */
  quantity: number;
  /** Per-unit purchase price. */
  costPrice: number;
  /** How much has been received so far (partial receipts accumulate here). */
  receivedQuantity: number;
  /** quantity * costPrice (server-computed convenience). */
  total: number;
}

/**
 * A purchase order header. `items` is present on detail / mutation responses;
 * list responses omit it and expose `itemCount` instead.
 */
export interface PurchaseOrder {
  id: string;
  supplierId: string;
  supplierName?: string | null;
  status: PurchaseOrderStatus;
  note?: string | null;
  /** Σ(quantity * costPrice) over the items. */
  total: number;
  /** Line count — present on list responses (items omitted there). */
  itemCount?: number;
  createdBy?: string | null;
  createdByName?: string | null;
  /** Set when the order leaves `draft` (or backfilled on first receive). */
  orderedAt?: string | null;
  /** Set only when the order is fully received. */
  receivedAt?: string | null;
  createdAt: string;
  /** Present on detail / mutation responses; omitted on list. */
  items?: PurchaseOrderItem[];
}

/** One row in the reorder-suggestions response, scoped to a preferred supplier. */
export interface PurchaseOrderSuggestionItem {
  productId: string;
  name: string;
  stock: number;
  minStock: number;
  costPrice: number;
  /** Hint quantity to reorder (restore at least to min stock); UI may override. */
  suggestedQuantity: number;
}

/** GET /purchase-orders/suggestions → low-stock products grouped by preferred supplier. */
export interface PurchaseOrderSuggestionGroup {
  /** null = products without a preferred supplier. */
  supplierId: string | null;
  supplierName: string | null;
  items: PurchaseOrderSuggestionItem[];
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
  /**
   * «Мотивация» — sum of promo-product (акционные товары) bonuses accrued to this
   * master inside the period (095_motivation_promo_products). Already INCLUDED in
   * totalEarnings (and therefore remainingAmount). 0 when the tenant has no promos.
   */
  motivationAmount?: number;
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
  /** «Мотивация» — promo-product bonus accrued to this master today (095). */
  motivationToday?: number;
  /** «Мотивация» — promo-product bonus accrued this month (095). */
  motivationMonth?: number;
  /** «Мотивация» — promo-product bonus accrued all-time (095). */
  motivationTotal?: number;
}

// ───────────────────────────────────────────────────────────────────────
//  «Мотивация сотрудников» v1 — акционные товары
//  (095_motivation_promo_products). Owner marks products as promotional with a
//  percent; on a PAID check the credited master earns percent × margin, summed
//  into the salary «Мотивация» component.
// ───────────────────────────────────────────────────────────────────────

/** A product flagged «акционный» with a bonus percent (tenant-scoped). */
export interface MotivationPromo {
  id: string;
  productId: string;
  productName: string;
  /** Bonus percent applied to the sale margin (0..100). */
  percent: number;
  /** Paused promos keep their config but never accrue. */
  active: boolean;
  /** Optional window start (ISO). null = no lower bound. */
  startsAt?: string | null;
  /** Optional window end (ISO). null = no upper bound. */
  endsAt?: string | null;
  /** Current warehouse prices, for an at-a-glance bonus preview. */
  sellPrice: number;
  costPrice: number;
  photo?: string;
  /** round((sellPrice − costPrice) × percent / 100) — bonus per single unit now. */
  estimatedBonusPerUnit: number;
  createdAt: string;
  updatedAt: string;
}

/** One accrued promo-product bonus row (ledger), written when a check is paid. */
export interface MotivationAccrual {
  id: string;
  /** Credited master (= checks.master_id). null if the user was later deleted. */
  employeeId?: string | null;
  employeeName?: string;
  checkId: string;
  checkNumber?: number;
  productId?: string | null;
  productName?: string;
  qty: number;
  /** Margin the bonus was computed from: Σ(sell − cost) × qty over the lines. */
  marginBase: number;
  percent: number;
  /** marginBase × percent / 100 (RUB). */
  amount: number;
  accruedAt: string;
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
  // 008 widened the DB to smsru / moizvonki; 087 added telegram.
  // Anything outside this union will be rejected by the backend DTO.
  providerType: 'whatsapp' | 'sms' | 'smsru' | 'moizvonki' | 'email' | 'telegram';
  senderName?: string;
  senderPhone?: string;
  webhookUrl?: string;
  // WhatsApp Cloud API phoneNumberId (087). Non-secret routing config — the
  // Bearer token is write-only (api_key) and never returned. Only meaningful
  // for providerType === 'whatsapp'.
  phoneNumberId?: string;
  // Telegram target chat_id (087). Telegram bots cannot DM an arbitrary phone,
  // so Telegram messages go to this configured owner/staff chat, NOT the
  // client's phone. The bot token is write-only (api_key). Only meaningful for
  // providerType === 'telegram'.
  chatId?: string;
  isActive: boolean;
  createdAt: string;
}

/**
 * «Машина готова» auto-notification settings (car_ready_settings, migration 087).
 * When `enabled`, a check transitioning to work_status 'ready' (kanban board)
 * sends the client a templated message via the tenant's active messaging
 * provider. Placeholders in `messageTemplate`: {number} (order number), {car}
 * (make/model + plate), {clientName}. Disabled by default.
 * GET/PATCH /marketing/car-ready.
 */
export interface CarReadyNotificationSettings {
  enabled: boolean;
  messageTemplate: string;
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
//  Win-back («давно не приезжал») — derived segment, no dedicated table
// ───────────────────────────────────────────────────────────────────────

/** A client in the win-back segment (GET /marketing/winback?days=N). */
export interface WinbackClient {
  clientId: string;
  name: string;
  phone: string;
  /** Most recent non-deferred visit (ISO). null = never visited (longest absent). */
  lastVisit: string | null;
  totalChecks: number;
}

/** Result of POST /marketing/winback/send. */
export interface WinbackSendResult {
  sent: number;
  failed: number;
  total: number;
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
  /**
   * Owner-facing alias of `description` — the fine reason «за что». Now always
   * present (NOT NULL since 100_salary_payouts_and_fines). Same value as
   * `description`; `SalaryFine` reads this.
   */
  comment?: string;
  /** When the penalty applies. */
  date: string;
  createdBy?: string;
  creatorName?: string;
  createdAt: string;
}

// ───────────────────────────────────────────────────────────────────────
//  Salary payouts-with-confirmation + fines (100_salary_payouts_and_fines)
//
//  PAYOUT: владелец (director + superadmin) issues a ЗП / АВАНС to an employee
//  → it starts `pending` and the employee accepts or rejects it (push-driven).
//  On accept the amount is recorded into expenses (category «Зарплата», dated
//  the accept day) and `expenseId` links it; on reject the payout is voided and
//  nothing is recorded. Separate from the legacy `SalaryPayment` flow.
//
//  FINE (штраф): a mandatory-comment deduction, backed by salary_penalties
//  (056). `SalaryFine` is the owner-facing shape of a penalty with the reason
//  always present.
// ───────────────────────────────────────────────────────────────────────

export type SalaryPayoutType = 'salary' | 'advance';
export type SalaryPayoutStatus = 'pending' | 'accepted' | 'rejected';

export interface SalaryPayout {
  id: string;
  /** Recipient employee id. */
  userId: string;
  userName?: string;
  type: SalaryPayoutType;
  amount: number;
  status: SalaryPayoutStatus;
  /** Optional owner note (a payout comment is NOT required, unlike a fine). */
  comment?: string;
  /** The владелец who issued the payout. */
  createdBy?: string;
  creatorName?: string;
  createdAt: string;
  /** When the employee accepted / rejected. Null while `pending`. */
  decidedAt?: string | null;
  /** Expense row written on accept (category «Зарплата»). Null until accepted. */
  expenseId?: string | null;
}

/** A штраф with a MANDATORY reason. Backed by salary_penalties (056). */
export interface SalaryFine {
  id: string;
  userId: string;
  userName?: string;
  /** Positive deduction amount (RUB). Subtracted from «к выплате». */
  amount: number;
  /** Reason «за что» — always present. */
  comment: string;
  date: string;
  createdBy?: string;
  creatorName?: string;
  createdAt: string;
}

/**
 * One employee's salary breakdown for one calendar month — powers the
 * full-screen salary card that pages month-by-month (`getEmployeeMonth`).
 * `totalEarnings` = service + product + premiums + motivation (mirrors
 * MasterSalary). `remainingAmount` = totalEarnings − finesAmount − paidAmount,
 * where paidAmount counts accepted payouts plus legacy salary_payments.
 */
export interface SalaryMonthDetail {
  userId: string;
  userName: string;
  /** 'YYYY-MM'. */
  month: string;
  salaryPercent: number;
  productSalaryPercent?: number;
  serviceEarnings: number;
  productEarnings: number;
  premiumsAmount: number;
  motivationAmount: number;
  totalEarnings: number;
  /** Sum of fines (штрафы) in the month — deducted. */
  finesAmount: number;
  /** Accepted payouts + legacy salary_payments in the month. */
  paidAmount: number;
  remainingAmount: number;
  totalRevenue: number;
  checkCount: number;
  payouts: SalaryPayout[];
  fines: SalaryFine[];
  premiums: SalaryPremium[];
  /** Legacy salary_payments for the month (old immediate-expense flow). */
  payments: SalaryPayment[];
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
  /**
   * Parent category id for folders/subfolders (079). Absent/null = a root-level
   * category. Build the tree client-side by grouping on `parentId`. Deleting a
   * parent orphans its children to the root (ON DELETE SET NULL), never deletes
   * them. The server rejects cycles (a category can't become its own ancestor).
   */
  parentId?: string;
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
 * Block-based article content (079) — an ordered, interleaved array of content
 * blocks: paragraphs, headings, images (with caption) and VK videos. When an
 * article has `blocks`, render them in order; when `blocks` is absent/empty,
 * fall back to the markdown `body`.
 *
 * Notes for the renderer:
 *   - `video` is VK-only (`provider: 'vk'`). The `url` is a VK link
 *     (`vk.com/video-123_456`); to embed, expect the player URL form
 *     `https://vk.com/video_ext.php?...` inside an <iframe>/WebView.
 *   - `heading.level` defaults to 2 when omitted.
 *   - `image.url` / `video.url` are validated server-side (VK host whitelist for
 *     video) — unknown block types or bad video URLs are rejected with a 400.
 */
export type KnowledgeBlock =
  | { type: 'text'; text: string }
  | { type: 'heading'; text: string; level?: 2 | 3 }
  | { type: 'image'; url: string; caption?: string }
  | { type: 'video'; provider: 'vk'; url: string; caption?: string };

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
  /**
   * Block-based content (079). Present (on both list + detail) only when the
   * article has blocks; absent/empty → render the markdown `body` instead.
   */
  blocks?: KnowledgeBlock[];
  /** Short plain-text preview derived from the body (present on both list + detail). */
  excerpt?: string;
  coverImage?: string;
  /** Empty array on the slim list; populated on getArticle. */
  attachments: KnowledgeAttachment[];
  pinned: boolean;
  /**
   * Visibility / «Скрыть» (#54). `false` = hidden: regular employees do not see
   * the article in lists, search or detail; manager roles still see it and can
   * un-hide by patching `published: true`. Present on BOTH the slim list and the
   * full detail. (Reuses the existing flag — there is no separate `hidden`.)
   */
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

  // ─── Regulation targeting / audience (#54) ────────────────────────────────
  /**
   * Audience of a regulation. `true` = «для всех сотрудников» (default); `false`
   * = only `targetUserIds` see it and must acknowledge — non-targeted employees
   * neither see it nor count toward its pending acks. Present on the slim list
   * AND detail for regulations; absent (undefined) for plain articles.
   */
  targetAll?: boolean;
  /**
   * The selected employee ids when `targetAll` is false (empty when targetAll).
   * Returned by getArticle (detail) so the manager edit screen can pre-fill the
   * audience; omitted from the slim list.
   */
  targetUserIds?: string[];

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

/**
 * Response of GET /knowledge/search?q=… — global, tenant-scoped smart search.
 * `articles` are slim (ranked: title > body > block-text), `categories` match by
 * name, `courses` by title/description (with this user's progress). All buckets
 * are empty when the query is shorter than 2 characters. Non-managers only see
 * published articles/courses.
 */
export interface KnowledgeSearchResults {
  /** The trimmed query that was executed. */
  query: string;
  articles: KnowledgeArticle[];
  categories: KnowledgeCategory[];
  courses: KnowledgeCourse[];
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

// ───────────────────────────────────────────────────────────────────────
//  Эквайринг + СБП (online acquiring + Faster Payments). Backend: payments/
//  (migration 085). Provider-agnostic — ЮKassa is implemented for real, Tinkoff
//  is reserved. The module is INERT until the owner pastes real ЮKassa keys in
//  settings: POST /payments/create returns 422 until then.
//
//  NOTE: distinct from the check-tender `enum PaymentMethod` (cash/card/warranty)
//  above — that is how a closed check was paid; `AcquiringMethod` is how an online
//  payment is collected (СБП-QR vs card redirect).
// ───────────────────────────────────────────────────────────────────────

export type PaymentProviderName = 'yookassa' | 'tinkoff';
/** How an online payment is collected: 'sbp' → СБП-QR, 'card' → card redirect. */
export type AcquiringMethod = 'sbp' | 'card';
/** Normalized online-payment lifecycle. */
export type PaymentStatus = 'pending' | 'succeeded' | 'canceled';

/**
 * Masked per-tenant acquiring config (GET /payments/settings). Owner-class only.
 * The raw secret key is NEVER sent to a client — only a mask + a "configured" flag.
 */
export interface PaymentIntegrationSettings {
  provider: PaymentProviderName;
  enabled: boolean;
  /** Semi-public shop identifier (ЮKassa shopId); shown in full. */
  shopId: string | null;
  /** Masked secret like '••••1234', or null when none stored. NEVER the raw key. */
  secretKeyMask: string | null;
  /** True when a secret key is stored, so the UI can show "configured". */
  hasSecretKey: boolean;
  updatedAt: string | null;
}

/** One payment ledger row (POST /payments/create response, GET /payments/:id). */
export interface Payment {
  id: string;
  tenantId: string;
  provider: PaymentProviderName;
  /** Provider-side payment id (ЮKassa payment.id). */
  providerPaymentId: string | null;
  amount: number;
  currency: string;
  description: string | null;
  method: AcquiringMethod | null;
  status: PaymentStatus;
  /** URL the client opens to pay (card redirect / SBP). */
  confirmationUrl: string | null;
  /** Optional link to the заказ-наряд this payment settles. */
  checkId: string | null;
  createdBy: string | null;
  createdAt: string;
  paidAt: string | null;
  /**
   * SBP-QR payload (a string to render as a QR / open). Present ONLY on the
   * create response for the СБП flow — it is ephemeral and never persisted.
   */
  qr?: string | null;
}

// ───────────────────────────────────────────────────────────────────────
//  Онлайн-касса / фискализация 54-ФЗ. Backend: fiscal/ (migration 086).
//  Provider-agnostic — АТОЛ Онлайн (ATOL Online v4) is implemented for real.
//  The module is INERT until the owner enters АТОЛ login + password + group_code
//  AND flips `enabled` on: POST /fiscal/fiscalize returns 422 until then. АТОЛ is
//  POLL-based (no webhook) — GET /fiscal/receipt/:checkId re-syncs a pending
//  receipt straight from the operator.
//
//  Distinct from the acquiring `Payment` above: that COLLECTS money online;
//  фискализация registers a legal 54-ФЗ receipt (ФД № + ФПД + ссылка ОФД) for a
//  closed check with the tax authority via the OFD operator.
// ───────────────────────────────────────────────────────────────────────

export type FiscalProviderName = 'atol';
/** Система налогообложения (tax system) reported on the receipt. */
export type FiscalSno = 'osn' | 'usn_income' | 'usn_income_outcome' | 'envd' | 'esn' | 'patent';
/** vat.type for receipt items. Most autoservices use 'none'. */
export type FiscalVat = 'none' | 'vat0' | 'vat10' | 'vat20' | 'vat110' | 'vat120';
/** Normalized фискализация lifecycle: sent → done / failed. */
export type FiscalStatus = 'pending' | 'done' | 'failed';

/**
 * Masked per-tenant фискализация config (GET /fiscal/settings). Owner-class only.
 * The raw `password` is NEVER sent to a client — only a mask + a "configured" flag.
 */
export interface FiscalSettings {
  provider: FiscalProviderName;
  enabled: boolean;
  /** АТОЛ API login (semi-public); shown in full. */
  login: string | null;
  /** Masked password like '••••1234', or null when none stored. NEVER the raw value. */
  passwordMask: string | null;
  /** True when a password is stored, so the UI can show "configured". */
  hasPassword: boolean;
  /** АТОЛ group_code (код группы ККТ). */
  groupCode: string | null;
  sno: FiscalSno | null;
  inn: string | null;
  /** Адрес расчётов (place of settlement / shop address). */
  paymentAddress: string | null;
  /** Email организации-отправителя чека. */
  companyEmail: string | null;
  vat: FiscalVat | string;
  updatedAt: string | null;
}

/** One фискализация ledger row (POST /fiscal/fiscalize response, GET /fiscal/receipt/:checkId). */
export interface FiscalReceipt {
  id: string;
  tenantId: string;
  provider: FiscalProviderName;
  /** The заказ-наряд this receipt fiscalizes. */
  checkId: string | null;
  /** Idempotence key sent to the operator (АТОЛ external_id). */
  externalId: string;
  /** Operator document uuid (АТОЛ). NULL only if /sell never returned one. */
  providerUuid: string | null;
  status: FiscalStatus;
  /** ФД — фискальный документ № (filled once done). */
  fiscalDocNumber: string | null;
  /** ФП/ФПД — фискальный признак документа (filled once done). */
  fiscalSign: string | null;
  /** Ссылка на чек в ОФД, если оператор её вернул. */
  ofdReceiptUrl: string | null;
  /** Текст ошибки при status='failed'. */
  error: string | null;
  createdAt: string;
  doneAt: string | null;
}

// ───────────────────────────────────────────────────────────────────────
//  Телефония (Mango Office). Backend: telephony/ (migration 088).
//  Provider-agnostic VPBX call-event ingestion. Mango PUSHES callbacks to a
//  PUBLIC, signature-verified webhook (server-only — NOT part of this client API).
//  Incoming/missed calls are matched to a client, PERSISTED in the `calls` table,
//  and surfaced through the existing calls list; the staff get a push the moment
//  the phone rings (RN has no CallKit here, so the push approximates a screen-pop).
//
//  Settings get/update are owner-class (director/admin/superadmin) gated
//  server-side. The Mango api_key / api_salt are WRITE-ONLY — getSettings returns
//  only masks + "configured" flags, NEVER the raw secrets.
//
//  INERT until configured: nothing is matched, persisted or pushed until the owner
//  enters the real Mango vpbx api key + salt AND flips `enabled` on.
// ───────────────────────────────────────────────────────────────────────

export type TelephonyProviderName = 'mango';

/**
 * Masked per-tenant telephony config (GET /telephony/settings). Owner-class only.
 * The raw api_key / api_salt are NEVER sent to a client — only masks + flags.
 */
export interface TelephonySettings {
  provider: TelephonyProviderName;
  enabled: boolean;
  /** Masked API key like '••••1234', or null when none stored. NEVER the raw key. */
  apiKeyMask: string | null;
  /** True when an API key is stored, so the UI can show "configured". */
  hasApiKey: boolean;
  /** Masked sign salt like '••••1234', or null when none stored. NEVER the raw salt. */
  apiSaltMask: string | null;
  /** True when a sign salt is stored. */
  hasApiSalt: boolean;
  updatedAt: string | null;
}

// ───────────────────────────────────────────────────────────────────────
//  Apple Wallet — карта лояльности (.pkpass). Backend: wallet/ (migration 089).
//  A storeCard pass showing the client's bonus balance (read from loyalty/) plus a
//  QR encoding the clientId, so staff can scan the card to accrue/redeem. The pass
//  is built and PKCS#7-signed SERVER-SIDE (passkit-generator) with the tenant's own
//  Apple Pass Type ID certificate.
//
//  Settings get/update are owner-class (director/admin/superadmin) gated
//  server-side. The signing material (cert + key + key password + Apple WWDR cert)
//  is WRITE-ONLY — getSettings returns ONLY boolean "stored" flags, NEVER any PEM
//  (a private key has no meaningful last-4 mask). The .pkpass download itself is a
//  separate binary endpoint (GET /wallet/pass/:clientId) — see createWalletApi.
//
//  INERT until configured: GET /wallet/pass/:clientId returns 422 until the owner
//  uploads a real Pass Type ID cert + key + WWDR cert AND flips `enabled` on.
//  Nothing produces a usable pass before that.
// ───────────────────────────────────────────────────────────────────────

/**
 * Masked per-tenant Apple Wallet config (GET /wallet/settings). Owner-class only.
 * The raw cert / key / password / WWDR are NEVER sent to a client — only flags.
 */
export interface WalletSettings {
  enabled: boolean;
  /** Apple Pass Type ID (e.g. 'pass.com.autexa.loyalty'); semi-public, shown in full. */
  passTypeId: string | null;
  /** Apple Developer Team ID (10-char); semi-public, shown in full. */
  teamId: string | null;
  /** Organization name printed on the pass (falls back server-side to the tenant name). */
  organizationName: string | null;
  /** Optional branding logo URL. */
  logoUrl: string | null;
  /** Optional background color hex (e.g. '#1E88E5'). */
  bgColor: string | null;
  /** True when the Pass Type ID signing certificate (PEM) is stored. NEVER the PEM. */
  hasCert: boolean;
  /** True when the signing private key (PEM) is stored. NEVER the PEM. */
  hasCertKey: boolean;
  /** True when a private-key passphrase is stored. NEVER the value. */
  hasCertKeyPassword: boolean;
  /** True when the Apple WWDR intermediate certificate (PEM) is stored. NEVER the PEM. */
  hasWwdr: boolean;
  /**
   * True when enabled AND cert + key + WWDR + passTypeId + teamId are all present —
   * i.e. GET /wallet/pass/:clientId will produce a pass instead of a 422. The UI can
   * use this to decide whether to show the «Добавить в Apple Wallet» button.
   */
  configured: boolean;
  updatedAt: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
//  «Мой профиль» — profile change requests (migration 099)
//
//  Владелец (director + superadmin) edits ФИО/телефон/аватар DIRECTLY. A
//  Сотрудник (admin + master) instead SUBMITS a request that a владелец
//  approves or rejects; the request carries the old→new diff. Password is
//  NEVER part of this flow (it is self-service for every role and never
//  exposed to an owner).
// ═══════════════════════════════════════════════════════════════════════════

/** Lifecycle of a profile change request. */
export type ProfileChangeStatus = 'pending' | 'approved' | 'rejected';

/** A profile field an employee may request to change (client-facing camelCase). */
export type ProfileChangeField = 'fullName' | 'phone' | 'avatar';

/** One per-field diff shown to the owner as «было → стало». */
export interface ProfileChangeDiff {
  field: ProfileChangeField;
  /** Value at the time the request was created (may be null, e.g. no avatar). */
  oldValue: string | null;
  /** Requested new value (null clears, e.g. avatar). */
  newValue: string | null;
}

/** Minimal requester identity attached to a request for the owner's review list. */
export interface ProfileChangeRequester {
  id: string;
  fullName: string;
  phone: string;
  avatar?: string;
  role: string;
}

/** A pending/decided employee profile change request (owner approval flow). */
export interface ProfileChangeRequest {
  id: string;
  /** Tenant the request belongs to. */
  tenantId?: string;
  /** The employee (requester) whose profile would change. */
  userId: string;
  /** Requester identity for display (present on owner-facing reads). */
  requester?: ProfileChangeRequester;
  /** The requested field changes, old→new. */
  changes: ProfileChangeDiff[];
  status: ProfileChangeStatus;
  createdAt: string;
  /** The владелец who approved/rejected, once decided. */
  decidedBy?: string;
  decidedAt?: string;
}
