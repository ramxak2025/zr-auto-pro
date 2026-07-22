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
  /**
   * 115 — пакет минут голосового ввода в месяц, входящий в тариф (0 = не
   * входит). Сама фича гейтится ключом 'voice_input' в `features`; поверх
   * пакета возможна индивидуальная надбавка {@link Tenant.voiceMinutesExtra}.
   * Optional: старые payload'ы поля не имеют → трактовать как 0.
   */
  voiceMinutes?: number;
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
  /**
   * 115 — индивидуальная надбавка минут голосового ввода ПОВЕРХ пакета тарифа
   * (задаёт суперадмин через PATCH /tenants/:id). Optional: старые payload'ы
   * поля не имеют → трактовать как 0.
   */
  voiceMinutesExtra?: number;
  /**
   * 122 — самая свежая строка реестра продлений подписки (subscription_payments),
   * или null, если тенант ни разу не продлевался через ledger-путь. Позволяет
   * списку тенантов бейджить «оплачено до …» / «бесплатно до …». Absent на
   * legacy-payload'ах (эндпоинты, не выбирающие реестр).
   */
  lastPayment?: SubscriptionPayment | null;
  /**
   * 122 — платный или бесплатный ТЕКУЩИЙ период ('paid' | 'free'), либо null,
   * если определить нельзя (нет строки реестра, чей period_to == subscriptionEnd —
   * например, subscription_end задан напрямую через PATCH/legacy). Выведено на
   * сервере из последнего платежа.
   */
  currentPeriodKind?: SubscriptionPeriodKind | null;
  users?: User[];
  userCount?: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * 122 — платный ('paid') или бесплатный ('free') характер продления/периода
 * подписки. Бесплатное продление НИКОГДА не учитывается как выручка.
 */
export type SubscriptionPeriodKind = 'paid' | 'free';

/**
 * 122 — одна строка реестра продлений подписки (subscription_payments,
 * superadmin-only). Пишется атомарно с UPDATE tenants.subscription_end при
 * каждом продлении. `amount` в рублях (0 для бесплатного); `isFree=true` ⇒
 * строка не входит в выручку. `periodTo` — новый subscription_end, установленный
 * этим продлением; `previousEnd` — что было до него.
 */
export interface SubscriptionPayment {
  id: string;
  tenantId: string;
  /** Рубли; 0 для бесплатного продления. */
  amount: number;
  /** true → бесплатное продление, никогда не выручка. */
  isFree: boolean;
  /** Начало покрытого периода (якорь = max(текущий конец, now)). */
  periodFrom: string | null;
  /** Новый subscription_end, установленный этим продлением. */
  periodTo: string | null;
  /** subscription_end ДО продления (аудит). */
  previousEnd: string | null;
  note: string | null;
  /** id действующего суперадмина (null, если пользователь удалён). */
  createdBy: string | null;
  createdAt: string;
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

// ─── Голосовой ввод комментария (115_voice_input) ───────────────────────────

/**
 * GET /voice/usage — остаток помесячного пакета минут голосового ввода.
 * Период — календарный месяц ПО МСК ('YYYY-MM'). Списание идёт блоками по
 * 15 секунд (зеркало биллинга Яндекса), поэтому минуты имеют шаг 0.25.
 * Доступно любой роли тенанта — мастеру полезно видеть остаток при записи.
 */
export interface VoiceUsage {
  /** 'YYYY-MM' текущего месяца по МСК. */
  period: string;
  /**
   * Полный лимит месяца = max(planMinutes, freeMinutes) + extraMinutes.
   * Бесплатный лимит перекрывается пакетом тарифа (не суммируется), надбавка —
   * сверху.
   */
  limitMinutes: number;
  usedMinutes: number;
  remainingMinutes: number;
  /** Пакет тарифа (Plan.voiceMinutes). */
  planMinutes: number;
  /**
   * Глобальный бесплатный лимит платформы — по нему бесплатные минуты получают
   * ВСЕ тенанты (тест-доступ). Правит супер-админ (PATCH /admin/settings,
   * PlatformSettings.globalFreeVoiceMinutes). Входит в limitMinutes через max().
   */
  freeMinutes: number;
  /** Индивидуальная надбавка тенанта (Tenant.voiceMinutesExtra). */
  extraMinutes: number;
  /** Точный остаток в секундах — для таймера на экране записи. */
  remainingSeconds: number;
  /** Ключ 'voice_input' входит в тариф тенанта. */
  featureEnabled: boolean;
  /** На сервере заданы ключи Яндекса (иначе transcribe ответит 503). */
  configured: boolean;
}

/**
 * POST /voice/transcribe — результат распознавания + полировки.
 * `text` — итог для подстановки в комментарий (полированный YandexGPT или,
 * при сбое полировки, сырой STT); `rawText` — всегда сырой SpeechKit-текст
 * (пустая строка = речь не распознана; блоки при этом СПИСАНЫ — Яндекс биллит
 * и тишину). Ошибки контрактные: 402 {code:'VOICE_QUOTA_EXCEEDED',
 * remainingSeconds}, 403 {code:'VOICE_FEATURE_NOT_IN_PLAN'},
 * 503 {code:'VOICE_NOT_CONFIGURED'}.
 */
export interface VoiceTranscribeResult {
  text: string;
  rawText: string;
  /** Списано из квоты этим запросом (кратно 15 сек). */
  billedSeconds: number;
  /** Остаток квоты после списания, сек. */
  remainingSeconds: number;
}

// ─── Глобальные настройки платформы (116_platform_settings, superadmin) ──────

/**
 * GET/PATCH /admin/settings — глобальные (без-тенантные) настройки платформы,
 * редактируемые ТОЛЬКО супер-админом (RolesGuard @Roles('superadmin')).
 * Синглтон в БД (миграция 116). Все поля добавляются аддитивно.
 */
export interface PlatformSettings {
  /**
   * Бесплатные минуты голосового ввода в месяц для КАЖДОГО тенанта (тест-доступ,
   * дефолт 10). Формула лимита тенанта — max(planMinutes, globalFree) + extra,
   * см. {@link VoiceUsage}. Целое ≥ 0; 0 — глобально выключить бесплатный тир.
   */
  globalFreeVoiceMinutes: number;
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
  /**
   * 122 — фактически СОБРАННАЯ платная выручка за текущий месяц: Σ
   * subscription_payments.amount WHERE NOT is_free и created_at ≥ начало месяца
   * (рубли, округлено). В отличие от `mrr` (сумма ценников тарифов) — это живые
   * деньги от продлений. Бесплатные продления сюда НЕ входят.
   */
  paidRevenueThisMonth: number;
  /** 122 — собранная платная выручка за всё время (free исключены; рубли, округлено). */
  paidRevenueTotal: number;
  /** 122 — число ПЛАТНЫХ продлений за текущий месяц. */
  paidExtensionsThisMonth: number;
  /** 122 — число БЕСПЛАТНЫХ продлений за текущий месяц (никогда не выручка). */
  freeExtensionsThisMonth: number;
}

/**
 * 122 — один месяц ряда платной выручки от подписок (GET /admin/subscription-revenue,
 * superadmin-only). Строится из subscription_payments так же, как MRR-тренд:
 * последние N месяцев, старший месяц первым. `paidRevenue` суммирует ТОЛЬКО
 * платные строки (WHERE NOT is_free) — бесплатные продления сюда не попадают,
 * их число отдаётся отдельным `freeCount` (справочно, не выручка).
 */
export interface SubscriptionRevenuePoint {
  /** Метка месяца, 'YYYY-MM'. */
  month: string;
  /** Σ subscription_payments.amount за месяц WHERE NOT is_free (рубли, округлено). */
  paidRevenue: number;
  /** Число платных продлений за месяц. */
  paidCount: number;
  /** Число бесплатных продлений за месяц (справочно, НЕ выручка). */
  freeCount: number;
}

/**
 * 122 — сводка платной выручки от подписок для суперадмин-дашборда
 * (GET /admin/subscription-revenue, superadmin-only). Бесплатные продления
 * (is_free=true, amount=0) НИКОГДА не попадают в поля `paidRevenue*` — только
 * в отдельные счётчики `free*`.
 */
export interface SubscriptionRevenue {
  /** Собранная платная выручка за текущий месяц (рубли, округлено). */
  paidRevenueThisMonth: number;
  /** Собранная платная выручка за всё время (рубли, округлено). */
  paidRevenueTotal: number;
  /** Число платных продлений за текущий месяц. */
  paidExtensionsThisMonth: number;
  /** Число бесплатных продлений за текущий месяц. */
  freeExtensionsThisMonth: number;
  /** Число платных продлений за всё время. */
  paidExtensionsTotal: number;
  /** Число бесплатных продлений за всё время. */
  freeExtensionsTotal: number;
  /** Помесячный ряд платной выручки (старший месяц первым). */
  monthly: SubscriptionRevenuePoint[];
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
  /**
   * 122 — самая свежая строка реестра продлений (subscription_payments), null
   * если тенант ещё не продлевался через ledger-путь. Для бейджа «оплачено до …»
   * / «бесплатно до …» в кабинете.
   */
  lastPayment: SubscriptionPayment | null;
  /**
   * 122 — платный/бесплатный ТЕКУЩИЙ период ('paid' | 'free'), либо null, если
   * определить нельзя (нет платежа, чей period_to == subscriptionEnd).
   */
  currentPeriodKind: SubscriptionPeriodKind | null;
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
 * A self-service registration request (migration 123) — a prospective autoservice
 * owner's application submitted UNAUTHENTICATED from the login screen and reviewed
 * by a superadmin. NEVER carries the password hash: the owner's chosen password is
 * stored server-side as a bcrypt hash and, on approve, reused to create the owner
 * account — it is never exposed in any API response.
 */
export interface RegistrationRequest {
  id: string;
  companyName: string;
  ownerName: string;
  phone: string;
  comment: string | null;
  status: 'pending' | 'approved' | 'rejected';
  /** Populated when status='rejected'. */
  rejectReason: string | null;
  /** Superadmin who reviewed it (approve/reject), or null while pending. */
  reviewedBy: string | null;
  reviewedAt: string | null;
  /** The tenant created on approval, or null. */
  createdTenantId: string | null;
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
  /**
   * 114 — назначенная роль (Bitrix24-style, см. {@link Role}). null/absent →
   * легаси-дефолты строковой роли (поведение до 114, у всех существующих
   * пользователей). Задана → база эффективных прав берётся из матрицы роли,
   * персональные {@link User.permissions} действуют поверх.
   */
  roleId?: string | null;
  /**
   * Имя назначенной роли (roles.name) — для бэйджа роли на клиенте. Отдаётся
   * /auth/login и /auth/me (LEFT JOIN roles); null/absent у пользователей без
   * role_id и в ответах, которые roles не джойнят.
   */
  roleName?: string | null;
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
  // ── ROLE-ONLY vocabulary (консолидация 2026-07) — view-vs-manage granularity ─
  // Optional так же, как ключи ниже: старые literal-карты остаются валидны, а
  // enforcement берёт строковый ключ. Все выводятся из матрицы роли (flatten).
  /** Услуги: смотреть каталог + добавлять в чек (manage ⇒ view). */
  services_view?: boolean;
  /** Услуги: создавать/редактировать/менять %+гарантию/удалять. */
  services_manage?: boolean;
  /** Склад: полное управление (себестоимость + add/edit/цены/сток/инвентаризация); manage ⇒ view И delete. */
  warehouse_manage?: boolean;
  /** Поставщики: создавать/редактировать/удалять + поставки/оплаты (manage ⇒ view). */
  suppliers_manage?: boolean;
  /** Имущество: смотреть справочник (manage ⇒ view). */
  equipment_view?: boolean;
  /** Имущество: create/update/delete/issue/replace/trash/restore. */
  equipment_manage?: boolean;
  /** Зарплата: видеть ЧУЖУЮ зарплату (вся команда). Own → salary_view. Derived from salary.view === 'all'. */
  salary_view_all?: boolean;
  /** Касса: редактировать ЧУЖИЕ чеки (охват 'all'). Own → checks_edit. Derived from checks.edit === 'all'. */
  checks_edit_all?: boolean;
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
  /**
   * «Удаление на складе» (#60) — may soft-delete products and folders/categories
   * (a full folder cascades its products to the Корзина; everything is reversible).
   * OFF by default — the owner grants it explicitly. Owner-class roles
   * (director/admin/superadmin) always allowed. Server-enforced via
   * @RequirePermission('warehouse_delete') on the delete endpoints; the backend
   * default mirror lives in PermissionsGuard.MASTER_PERMISSION_DEFAULTS.
   *
   * NOTE: intentionally added here (typed, grantable via PATCH
   * /users/:id/permissions) but NOT yet in the PermissionKey union /
   * PERMISSION_GROUPS UI catalog. Surfacing the toggle in the permissions editor
   * is part of the warehouse delete-UI client wave — that wave adds
   * 'warehouse_delete' to PermissionKey + PERMISSION_GROUPS.Склад +
   * ROLE_PERMISSION_DEFAULTS[master] and the web/mobile PERMISSION_LABELS maps
   * together (the mobile map is an exhaustive Record<PermissionKey, string>).
   */
  warehouse_delete?: boolean;
  /**
   * «Редактирование закрытого заказ-наряда» (#61) — may edit a PROVEDЁN
   * (closed / not-deferred) check: change its services / products / client /
   * car / executor / payment. On save the backend re-derives EVERYTHING the
   * check affected (stock, per-line + total salary, cash-flow, cost/profit,
   * «Мотивация» accruals) in ONE transaction and re-writes it — the check STAYS
   * closed. OFF by default — the owner grants it explicitly. Owner-class roles
   * (director/admin/superadmin) always allowed. Server-enforced in
   * ChecksService (userHasPermission('edit_closed_check')); the backend default
   * mirror lives in PermissionsGuard.MASTER_PERMISSION_DEFAULTS.
   *
   * NOTE: intentionally added here (typed, grantable via PATCH
   * /users/:id/permissions) but NOT yet in the PermissionKey union /
   * PERMISSION_GROUPS UI catalog — mirrors exactly how `warehouse_delete` was
   * first introduced. Surfacing the toggle in the permissions editor is the
   * #61 client (mobile) wave: that wave adds 'edit_closed_check' to
   * PermissionKey + PERMISSION_GROUPS.Касса + ROLE_PERMISSION_DEFAULTS[master]
   * AND the web/mobile PERMISSION_LABELS maps together (the mobile map is an
   * exhaustive Record<PermissionKey, string>, so adding the key here-only keeps
   * all three typechecks green without touching mobile/web).
   */
  edit_closed_check?: boolean;
  /**
   * «Движение денег: свои» (ITEM 6) — may open «Движение денег» / cash-flow and
   * see ITS OWN money operations (own checks + installment repayments the user
   * accepted). This is a ROLE permission — distinct from the plan/tariff feature
   * flag also named `cashflow_view` in shared/constants/features.ts (different
   * namespace: plan.features array vs this permissions map). Server-enforced in
   * ReportsService.getCashFlow via @RequirePermission('cashflow_view'); the
   * backend default mirror lives in PermissionsGuard.MASTER_PERMISSION_DEFAULTS
   * (false). Owner-class roles (director/admin/superadmin) always see all.
   * Derived from the role matrix cell `reports.cashflow` ('own'|'all' → true).
   *
   * NOTE: intentionally added here (typed, grantable) but NOT yet in the
   * PermissionKey union / PERMISSION_GROUPS UI catalog — same staging as
   * `warehouse_delete` / `edit_closed_check`. The reports/roles UI fan-out wave
   * promotes it to PermissionKey + PERMISSION_GROUPS.Финансы +
   * ROLE_PERMISSION_DEFAULTS[master] AND the web/mobile PERMISSION_LABELS maps
   * together, so adding it here-only keeps all three typechecks green.
   */
  cashflow_view?: boolean;
  /**
   * «Движение денег: все» (ITEM 6) — may see ALL masters' money operations in
   * cash-flow (not just their own). Derived from `reports.cashflow` === 'all'.
   * Owner-class roles are implicit. Same staging note as `cashflow_view` above.
   */
  cashflow_view_all?: boolean;
  // ── Словарь v3 (миграция 136, волна «права как в Битрикс24») ────────────────
  // Перевод хардкод-@Roles('director','admin','superadmin') на ключи матрицы.
  // Все optional (легаси literal-карты остаются валидны); каждое выводится из
  // своей ячейки RoleMatrix (см. backend/src/common/role-matrix.ts).
  /** Кассовые смены: открытие/закрытие/инкассация (checks.cashShifts). */
  cash_shifts_manage?: boolean;
  /** CRUD колонок доски заказ-нарядов (checks.board). */
  checks_board_manage?: boolean;
  /** Удаление клиентов (clients.delete). */
  clients_delete?: boolean;
  /** Долги и рассрочка: начисление/погашение/напоминания (clients.debts). */
  debts_manage?: boolean;
  /** Мутации расписания и режимов работы (schedule.manage). */
  schedule_manage?: boolean;
  /** Выплаты/авансы/штрафы по зарплате (salary.payouts). У системного «Администратора» сид false — owner-only. */
  salary_payouts_manage?: boolean;
  /** Премии (salary.premiums). */
  salary_premiums_manage?: boolean;
  /** Акции «Мотивации» (salary.motivation). */
  motivation_manage?: boolean;
  /** Аналитика склада: маржа/себестоимость (warehouse.analytics). */
  warehouse_analytics_view?: boolean;
  /** Безвозвратное удаление имущества (equipment.permanentDelete). Сид Админ=false — owner-only. */
  equipment_permanent_delete?: boolean;
  /** Согласование заявок на изменение профиля (employees.approveProfile). Сид Админ=false — owner-only. */
  employees_approve_profile?: boolean;
  /** Настройки интеграций/кассы/справочников (settings.manage). */
  settings_manage?: boolean;
  /** Данные компании /my-company (settings.company). Сид Админ=false — owner-only. */
  company_manage?: boolean;
  /** Мутации базы знаний (knowledge.manage). */
  knowledge_manage?: boolean;
  // ── Уровень «смотрит vs редактирует» для маркетинга и базы знаний (миграция 137) ──
  /**
   * Маркетинг: УПРАВЛЕНИЕ (marketing.manage) — все мутации раздела «Маркетинг»
   * (интеграции/площадки/настройки/car-ready/reminders(+send)/winback/send/
   * broadcast/send/alerts read). marketing_access = только ПРОСМОТР. manage ⇒ view.
   */
  marketing_manage?: boolean;
  /**
   * База знаний: ПРОСМОТР (knowledge.view) — гейт GET-чтений базы знаний, которые
   * раньше были открыты всем. knowledge_manage = УПРАВЛЕНИЕ (мутации). manage ⇒ view.
   */
  knowledge_view?: boolean;
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

/**
 * Action-permission key. A subset of `keyof UserPermissions`. Каждый ключ
 * выводится ровно из одной ячейки {@link RoleMatrix} (см.
 * backend/src/common/role-matrix.ts flattenRoleMatrix). ROLE-ONLY (консолидация
 * 2026-07): это единственный словарь enforcement.
 */
export type PermissionKey =
  | 'checks_view'
  | 'checks_create'
  | 'checks_edit'
  | 'checks_edit_all'
  | 'checks_delete'
  | 'checks_change_datetime'
  | 'checks_view_all'
  | 'payment_edit'
  | 'accept_payment'
  | 'sell_installment'
  | 'edit_closed_check'
  | 'services_view'
  | 'services_manage'
  | 'profit_view'
  | 'financial_reports'
  | 'export_data'
  | 'cashflow_view'
  | 'cashflow_view_all'
  | 'can_add_expenses'
  | 'salary_view'
  | 'salary_view_all'
  | 'warehouse_access'
  | 'warehouse_manage'
  | 'warehouse_delete'
  | 'suppliers_access'
  | 'suppliers_manage'
  | 'equipment_view'
  | 'equipment_manage'
  | 'clients_view'
  | 'clients_edit'
  | 'schedule_view'
  | 'bookings_access'
  | 'marketing_access'
  | 'marketing_manage'
  | 'calls_view'
  | 'calls_listen'
  | 'user_management'
  // ── Словарь v3 (миграция 136) ──
  | 'cash_shifts_manage'
  | 'checks_board_manage'
  | 'clients_delete'
  | 'debts_manage'
  | 'schedule_manage'
  | 'salary_payouts_manage'
  | 'salary_premiums_manage'
  | 'motivation_manage'
  | 'warehouse_analytics_view'
  | 'equipment_permanent_delete'
  | 'employees_approve_profile'
  | 'settings_manage'
  | 'company_manage'
  // ── Уровень «смотрит vs редактирует» (миграция 137) ──
  | 'knowledge_view'
  | 'knowledge_manage';

/**
 * Permission keys grouped for UI rendering (Касса / Услуги / Финансы / Склад /
 * Поставщики / Имущество / CRM / Управление). The grouping drives the permissions
 * editor; enforcement only cares about the flat key.
 */
export const PERMISSION_GROUPS = {
  Касса: [
    'checks_view',
    'checks_view_all',
    'checks_create',
    'checks_edit',
    'checks_edit_all',
    'checks_delete',
    'checks_change_datetime',
    'payment_edit',
    'accept_payment',
    'sell_installment',
    'edit_closed_check',
    'cash_shifts_manage',
    'checks_board_manage',
  ],
  Услуги: ['services_view', 'services_manage'],
  Финансы: [
    'profit_view',
    'financial_reports',
    'export_data',
    'cashflow_view',
    'cashflow_view_all',
    'can_add_expenses',
    'salary_view',
    'salary_view_all',
    'salary_payouts_manage',
    'salary_premiums_manage',
    'motivation_manage',
  ],
  Склад: ['warehouse_access', 'warehouse_manage', 'warehouse_delete', 'warehouse_analytics_view'],
  Поставщики: ['suppliers_access', 'suppliers_manage'],
  Имущество: ['equipment_view', 'equipment_manage', 'equipment_permanent_delete'],
  CRM: [
    'clients_view',
    'clients_edit',
    'clients_delete',
    'debts_manage',
    'schedule_view',
    'schedule_manage',
    'bookings_access',
    'marketing_access',
    'marketing_manage',
    'calls_view',
    'calls_listen',
  ],
  Управление: ['user_management', 'employees_approve_profile'],
  Настройки: ['settings_manage', 'company_manage'],
  'База знаний': ['knowledge_view', 'knowledge_manage'],
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
    checks_edit_all: false, // редактирует только СВОИ чеки по умолчанию
    checks_delete: false,
    checks_change_datetime: false,
    checks_view_all: false, // sees only their own checks by default
    payment_edit: false,
    accept_payment: false, // not a cashier by default — owner grants it explicitly
    sell_installment: false, // продажа в рассрочку — owner grants it explicitly
    edit_closed_check: false, // #61 — редактирование проведённого чека выключено по умолчанию; владелец выдаёт явно
    // Услуги — мастер СМОТРИТ услуги и добавляет их в чек; каталог не редактирует.
    services_view: true,
    services_manage: false,
    // Финансы — NONE by default.
    profit_view: false,
    financial_reports: false,
    export_data: false,
    cashflow_view: false, // «Движение денег» закрыто по умолчанию; владелец выдаёт «свои» или «все»
    cashflow_view_all: false,
    can_add_expenses: false,
    salary_view: false,
    salary_view_all: false,
    // Склад — мастер СМОТРИТ товары (без себестоимости) и добавляет их в чек;
    // управление (себестоимость/CRUD/инвентаризация) и удаление — off.
    warehouse_access: true,
    warehouse_manage: false,
    warehouse_delete: false, // #60 — удаление товаров/папок выключено по умолчанию; владелец выдаёт явно
    // Поставщики / Имущество — none by default.
    suppliers_access: false,
    suppliers_manage: false,
    equipment_view: false,
    equipment_manage: false,

    // CRM — masters can see their own clients/cars; broad CRM editing off.
    clients_view: true,
    clients_edit: false,
    schedule_view: true,
    bookings_access: false,
    marketing_access: false,
    marketing_manage: false, // маркетинг мастеру недоступен — управление тем более
    calls_view: false,
    calls_listen: false,
    // Управление — never for a master.
    user_management: false,
    // ── Словарь v3 (миграция 136) — мастеру всё off: эти роуты и раньше были
    // @Roles(d,a,sa) / owner-only, сиды 1:1 (зеркало MASTER_PERMISSION_DEFAULTS).
    cash_shifts_manage: false,
    checks_board_manage: false,
    clients_delete: false,
    debts_manage: false,
    schedule_manage: false,
    salary_payouts_manage: false,
    salary_premiums_manage: false,
    motivation_manage: false,
    warehouse_analytics_view: false,
    equipment_permanent_delete: false,
    employees_approve_profile: false,
    settings_manage: false,
    company_manage: false,
    // База знаний — мастер СМОТРИТ базу знаний (чтения были открыты всем), но не
    // редактирует. Миграция 137: view=true (1:1 с сегодняшним поведением), manage=false.
    knowledge_view: true,
    knowledge_manage: false,
  },
};

// PermissionTemplate удалён (ROLE-ONLY, консолидация 2026-07): шаблоны прав
// (permission_templates) и per-user override заменены единственным механизмом —
// ролями (см. {@link Role} ниже). Роль — живая база прав (не одноразовая копия).

// ═══════════════════════════════════════════════════════════════════════════
//  Роли (Bitrix24-style, миграция 114) — матрица «право × охват»
//
//  ROLE-ONLY (консолидация 2026-07): роль — ЕДИНСТВЕННЫЙ источник прав.
//  Назначенному пользователю (User.roleId) сервер строит эффективные права как
//  flatten(Role.matrix) (персональные User.permissions удалены из модели).
//  Enforcement — guards смотрят плоские ключи PermissionKey; таблица
//  соответствия «ключ → ячейка матрицы» зафиксирована в
//  backend/src/common/role-matrix.ts.
// ═══════════════════════════════════════════════════════════════════════════

/** Охват действия в матрице роли: нет / только своё / всё по автосервису. */
export type RoleScope = 'none' | 'own' | 'all';

/**
 * Матрица роли: секции × действия. Scope-действия ('none'|'own'|'all') —
 * checks.view, checks.edit, salary.view; остальные — boolean-тумблеры.
 * Отсутствующее действие читается сервером как 'none'/false (fail-closed).
 * Каждая ячейка соответствует ровно одному {@link PermissionKey}:
 *   checks.view→checks_view(+checks_view_all при 'all'), checks.create→checks_create,
 *   checks.edit→checks_edit(+checks_edit_all при 'all'), checks.delete→checks_delete,
 *   checks.changeDatetime→checks_change_datetime, checks.editClosed→edit_closed_check,
 *   checks.editPayment→payment_edit, checks.acceptPayment→accept_payment,
 *   checks.sellInstallment→sell_installment,
 *   services.view→services_view (manage⇒view), services.manage→services_manage,
 *   warehouse.view→warehouse_access (manage⇒view), warehouse.manage→warehouse_manage,
 *   warehouse.delete→warehouse_delete (manage⇒delete),
 *   suppliers.view→suppliers_access (manage⇒view), suppliers.manage→suppliers_manage,
 *   equipment.view→equipment_view (manage⇒view), equipment.manage→equipment_manage,
 *   clients.view→clients_view, clients.edit→clients_edit, schedule.view→schedule_view,
 *   bookings.view→bookings_access, salary.view→salary_view(+salary_view_all при 'all'),
 *   reports.view→financial_reports, reports.profit→profit_view, reports.export→export_data,
 *   reports.cashflow→cashflow_view(+cashflow_view_all при 'all'), expenses.add→can_add_expenses,
 *   marketing.view→marketing_access (manage⇒view), marketing.manage→marketing_manage,
 *   calls.view→calls_view, calls.listen→calls_listen,
 *   employees.manage→user_management.
 *   Словарь v3 (миграция 136): checks.cashShifts→cash_shifts_manage,
 *   checks.board→checks_board_manage, clients.delete→clients_delete,
 *   clients.debts→debts_manage, schedule.manage→schedule_manage,
 *   salary.payouts→salary_payouts_manage, salary.premiums→salary_premiums_manage,
 *   salary.motivation→motivation_manage, warehouse.analytics→warehouse_analytics_view,
 *   equipment.permanentDelete→equipment_permanent_delete,
 *   employees.approveProfile→employees_approve_profile, settings.manage→settings_manage,
 *   settings.company→company_manage.
 *   Уровень «смотрит vs редактирует» (миграция 137): marketing.manage→marketing_manage,
 *   knowledge.view→knowledge_view (manage⇒view), knowledge.manage→knowledge_manage.
 *
 * «manage ⇒ view/delete»: manage — надмножество view (и для склада delete):
 * ячейка { manage: true } проходит и view-гейты (add-to-check, list) — сервер
 * раскладывает это автоматически (flattenRoleMatrix).
 */
export interface RoleMatrix {
  checks?: {
    view?: RoleScope;
    create?: boolean;
    edit?: RoleScope;
    delete?: boolean;
    changeDatetime?: boolean;
    editClosed?: boolean;
    editPayment?: boolean;
    acceptPayment?: boolean;
    sellInstallment?: boolean;
    /** Кассовые смены: открытие/закрытие/инкассация (→ cash_shifts_manage). */
    cashShifts?: boolean;
    /** CRUD колонок доски заказ-нарядов (→ checks_board_manage). */
    board?: boolean;
  };
  /** Услуги: view (смотреть + в чек) / manage (CRUD + %/гарантия). manage ⇒ view. */
  services?: { view?: boolean; manage?: boolean };
  /**
   * Склад: view (товары БЕЗ себестоимости + в чек) / manage (себестоимость +
   * add/edit/цены/сток/инвентаризация) / delete (удаление) / analytics
   * (/warehouse-analytics/* — маржа/себестоимость). manage ⇒ view И delete.
   */
  warehouse?: { view?: boolean; manage?: boolean; delete?: boolean; analytics?: boolean };
  /** Поставщики: view / manage. manage ⇒ view. */
  suppliers?: { view?: boolean; manage?: boolean };
  /**
   * Имущество: view (справочник) / manage (выдача/CRUD) / permanentDelete
   * (безвозвратное удаление — owner-only, сид Админ=false). manage ⇒ view.
   */
  equipment?: { view?: boolean; manage?: boolean; permanentDelete?: boolean };
  /** Клиенты: view / edit / delete / debts (долги + рассрочка). */
  clients?: { view?: boolean; edit?: boolean; delete?: boolean; debts?: boolean };
  /** Расписание: view / manage (мутации расписания и режимов работы). */
  schedule?: { view?: boolean; manage?: boolean };
  bookings?: { view?: boolean };
  /**
   * Зарплата: охват 'own' → только своя ЗП (salary_view), 'all' → вся команда
   * (salary_view + salary_view_all). Отсутствует → 'none' (fail-closed).
   * payouts — выплаты/авансы/штрафы (owner-only, сид Админ=false);
   * premiums — премии; motivation — акции «Мотивации».
   */
  salary?: { view?: RoleScope; payouts?: boolean; premiums?: boolean; motivation?: boolean };
  reports?: {
    view?: boolean;
    profit?: boolean;
    export?: boolean;
    /**
     * «Движение денег» охват (ITEM 6): 'own' → только свои операции,
     * 'all' → все. Раскладывается сервером в cashflow_view (own|all) +
     * cashflow_view_all (all). Отсутствует → 'none' (fail-closed).
     */
    cashflow?: RoleScope;
  };
  expenses?: { add?: boolean };
  /**
   * Маркетинг: view — смотреть раздел (→ marketing_access); manage — все мутации
   * (интеграции/площадки/настройки/рассылки/alerts) (→ marketing_manage). manage ⇒ view.
   */
  marketing?: { view?: boolean; manage?: boolean };
  calls?: { view?: boolean; listen?: boolean };
  /**
   * Управление сотрудниками: manage (→ user_management) / approveProfile
   * (согласование заявок на смену профиля — owner-only, сид Админ=false).
   */
  employees?: { manage?: boolean; approveProfile?: boolean };
  /**
   * Настройки (новая секция v3): manage — интеграции/касса/справочники
   * (→ settings_manage); company — /my-company (→ company_manage, owner-only).
   */
  settings?: { manage?: boolean; company?: boolean };
  /**
   * База знаний (секция v3): view — просмотр базы (→ knowledge_view, миграция 137);
   * manage — все мутации + менеджерские чтения (→ knowledge_manage). manage ⇒ view.
   */
  knowledge?: { view?: boolean; manage?: boolean };
}

/** Стабильный ключ системной роли (миграция 121). Null у кастомных ролей. */
export type RoleSystemKey = 'master' | 'admin' | 'director';

/**
 * Роль. Системные (`isSystem: true` — «Мастер», «Администратор», «Директор»)
 * видны каждому тенанту.
 *
 * Волна 3 (миграция 121, ITEM 5): директор тенанта МОЖЕТ настроить матрицу
 * системной роли ДЛЯ СВОЕГО тенанта — сервер делает copy-on-write (создаёт
 * тенантный override с тем же `systemKey`, глобальный шаблон не трогается, users
 * переводятся на override). Исключение — «Директор» (`systemKey: 'director'`):
 * `locked: true`, полные права, вечно read-only.
 *   • `systemKey` — 'master'|'admin'|'director' у системной роли и её тенантного
 *     override; null у кастомной. Позволяет UI понять, что override заменяет
 *     системную роль (в списке дубля «Мастер» нет — сервер прячет глобал).
 *   • `locked`   — редактируемость: true ТОЛЬКО у «Директора». Всё остальное
 *     (системные «Мастер»/«Администратор», их override, кастомные) — редактируемо.
 * Кастомные роли по-прежнему тенантные, редактируются на месте; копия — через
 * POST /roles c copyFromRoleId. Backend: roles/; API: createRolesApi.
 */
export interface Role {
  id: string;
  name: string;
  description?: string | null;
  isSystem: boolean;
  matrix: RoleMatrix;
  sort: number;
  /** 'master'|'admin'|'director' у системной роли/override; null|undefined у кастомной. */
  systemKey?: RoleSystemKey | null;
  /** true ТОЛЬКО у «Директора» — вечно read-only. Иначе редактируема (copy-on-write у системных). */
  locked?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Ответ GET /users/:id/effective-permissions — плоские ЭФФЕКТИВНЫЕ права
 * (flatten(матрицы роли) ⊕ персональные overrides, через ту же
 * userHasPermission, что и серверный enforcement). Для UI волны 2.
 */
export interface EffectivePermissionsResult {
  role: UserRole;
  roleId: string | null;
  permissions: Record<string, boolean>;
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

/**
 * Body of the 409 Conflict returned by `POST /clients` when a client with the
 * same normalized phone (see `phoneSearchKey`) already exists in the tenant.
 * The FE reads `clientId` to offer «Клиент с этим номером уже добавлен →
 * Перейти к клиенту» instead of surfacing a raw error. Additive contract —
 * success responses are unchanged (`Client`); this only types the error body.
 */
export interface ClientPhoneConflict {
  message: string;
  code: 'CLIENT_PHONE_EXISTS';
  /** Existing client's id — navigate / select it instead of creating a dup. */
  clientId: string;
  client: { id: string; fullName: string; phone: string };
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
  /**
   * 120 (дробные количества) — единица измерения товара из каталога
   * ('шт','м','кг','л','уп','компл'). Опциональна: старый backend её не шлёт,
   * free-text строки без productId — тоже. UI рендерит «12.5 м» только когда
   * поле пришло.
   */
  unit?: string;
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
  /**
   * «По гарантии» (payment_method='warranty'). Warranty work earns nothing and
   * is a LOSS: it is excluded from revenue / turnover / profit everywhere, and
   * instead subtracts {@link warrantyLoss} from net profit. Present on BOTH the
   * list (journal) and detail responses. Additive — older clients ignore it.
   */
  isWarranty?: boolean;
  /**
   * Computed loss for a warranty check = parts purchase cost
   * (Σ cost_price × qty = productCostTotal) + the master's payout for the labor
   * on this check (serviceSalaryTotal). 0 for non-warranty checks. Derived
   * server-side from the check's own columns (never materialised). The journal
   * can label the check and show this as the loss.
   */
  warrantyLoss?: number;
  /** Warranties spawned by this check (only populated by /checks/:id). */
  warrantyClaims?: WarrantyClaim[];
  /** Set when the check has been returned (full or partial). FE renders a strikethrough + badge in the journal. */
  isReturned?: boolean;
  returnedAt?: string | null;
  returnDestination?: 'warehouse' | 'defect' | null;
  returnScope?: 'full' | 'partial' | null;
  /**
   * Корзина (106). Set (ISO timestamp) when the check has been soft-deleted and
   * moved to the trash; NULL / absent for a live check. A trashed check is
   * excluded from every list / report / salary / cash-flow until it is restored
   * (owner-only) or permanently purged after 30 days. Additive & optional —
   * existing consumers safely ignore it.
   */
  deletedAt?: string | null;
  /** users.id of the actor who moved the check to the trash (106). */
  deletedBy?: string | null;
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
 * One row of the Корзина (trash) list — GET /checks/trash (106), owner-only.
 * A slim summary of a soft-deleted check: enough to identify it and show who
 * trashed it + when. Only checks trashed within the last 30 days are returned
 * (older ones are purged). Restoring is a separate POST /checks/:id/restore.
 */
export interface TrashedCheck {
  id: string;
  number: number;
  /** The check's own date (sale date), NOT the deletion time. */
  date: string;
  clientName: string | null;
  totalRevenue: number;
  isDeferred: boolean;
  /** When it was moved to the trash (ISO). */
  deletedAt: string;
  /** users.id of the actor who trashed it (may be null on legacy rows). */
  deletedBy: string | null;
  /** Display name of the actor who trashed it, resolved server-side. */
  deletedByName: string | null;
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
  /**
   * Способ оплаты погашения (119). Опционален — старый бэкенд его не шлёт;
   * до-миграционные платежи бэкенд отдаёт как 'cash'.
   */
  paymentMethod?: 'cash' | 'card';
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
  | 'customer_return'
  // Продажа товара из чека (волна G). Синтетический тип — на сервере НЕ
  // создаётся движением склада, только подмешивается в ленту «Движение товара»
  // карточки товара при includeSales. Несёт checkId/checkNumber для перехода
  // в чек; остаток (stockBefore/After) для него не осмыслен (0/0).
  | 'sale';

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
  /** Только для type='sale' (волна G): чек, из которого пришла продажа — для перехода в него. */
  checkId?: string | null;
  /** Только для type='sale' (волна G): номер чека продажи. */
  checkNumber?: number | null;
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
  /**
   * «По гарантии» — total warranty LOSS in the window = Σ(parts cost + master
   * labor payout) over warranty checks. Warranty checks are EXCLUDED from
   * revenue / productCost / salaries; this loss is subtracted from netProfit
   * separately. Optional so an older backend (no field) is treated as 0.
   */
  warrantyLoss?: number;
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
  /**
   * v3.0.1 ФИЧА 4 — отработанные смены за период (по настройкам расписания
   * тенанта: schedule_settings.shift_statuses). Optional — старый бэкенд не шлёт.
   */
  workedShifts?: number;
  /**
   * «ЗП за день» = totalEarnings ÷ workedShifts (округлено). null при 0 смен
   * (не делим). Optional — старый бэкенд не шлёт.
   */
  perDay?: number | null;
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
  /**
   * v3.0.1 ФИЧА 4 — отработанные смены сотрудника с начала месяца по сегодня (по
   * настройкам расписания). Для master-view на ГЛАВНОЙ. Optional — старый бэкенд
   * не шлёт.
   */
  workedShiftsMonth?: number;
  /**
   * «ЗП за день» = month ÷ workedShiftsMonth (округлено). null при 0 смен — тогда
   * показываем только «ЗП за месяц» (month). Optional — старый бэкенд не шлёт.
   */
  perDay?: number | null;
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
  /**
   * 132 (v3.0.1 ФИЧА 1) — when true this category = «оплата плановой постоянки»
   * (аренда/коммуналка/маркетинг/зарплата). Its expenses are accrual-neutral: they
   * do NOT reduce the accrual net profit (already accrued from the planning config)
   * and show up only in cash-flow. Legacy/one-off categories (false) reduce profit
   * as real costs, unchanged.
   */
  isRecurring?: boolean;
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
  /**
   * 'owner' for owner/director/admin-created, 'employee' for non-privileged
   * submitters, 'warranty' for the DERIVED «Гарантия (убыток)» rows the server
   * injects into the list (not a persisted expense — see below). A 'warranty'
   * row has a synthetic id (`warranty-loss:<checkId>`) and cannot be
   * approved / rejected / deleted.
   */
  source?: 'owner' | 'employee' | 'warranty';
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
  /**
   * Independent outbound-SMS switch (migration 127), decoupled from `isActive`.
   * When false the integration stays CONNECTED (for «Мои Звонки» call sync it
   * keeps syncing calls) but is never chosen as a client-SMS sender — the send
   * is skipped. Defaults to true (server backfills legacy rows to true), so an
   * integration keeps sending SMS unless the owner explicitly mutes it.
   */
  smsNotificationsEnabled: boolean;
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
  /**
   * Personal templates (round 8, migration 110). `userId` NULL/undefined =
   * общий шаблон (legacy or owner-published), visible to every employee of
   * the tenant; otherwise the template is personal and visible only to its
   * author. `isShared` mirrors `userId == null` for convenience.
   */
  userId?: string | null;
  /** Personal folder the template lives in; общие templates are folder-less. */
  folderId?: string | null;
  isShared?: boolean;
}

/**
 * Personal folder for check templates (`check_template_folders`). Folders
 * are strictly per-employee: the API returns only the actor's own tree as a
 * flat list — build hierarchy client-side via `parentId`.
 */
export interface CheckTemplateFolder {
  id: string;
  name: string;
  parentId: string | null;
  sort: number;
  createdAt?: string;
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
  /**
   * Recipients the anti-spam gate (sent_messages, migration 124) refused as a
   * would-be duplicate — cooldown / exact-duplicate / 24h cap / already sent.
   * Optional for back-compat; absent on legacy responses.
   */
  skippedDedup?: number;
}

// ───────────────────────────────────────────────────────────────────────
//  Рассылки — ручная сегментная рассылка + обзор авто-рассылок (мигр. 124).
//  Каждая отправка проходит анти-спам-гейт (журнал sent_messages): не дублируем
//  SMS и не спамим клиентов. НЕ путать с superadmin→tenant Broadcast выше.
// ───────────────────────────────────────────────────────────────────────

/** Criteria for a manual «Рассылки» segment (all optional, AND-combined). */
export interface SegmentBroadcastCriteria {
  /** Last non-deferred visit older than N days (or never visited). */
  lastVisitDays?: number;
  /** clients.source exact match. */
  source?: string;
  /** Only clients that currently owe money (debt ledger > 0 OR open installment). */
  hasDebt?: boolean;
  /** Explicit client id allow-list (still filtered to messageable clients). */
  clientIds?: string[];
}

/** Request body for POST /marketing/broadcast/send. */
export interface SegmentBroadcastRequest {
  /** Segment criteria; omit/empty = every messageable (non-retail, has-phone) client. */
  segment?: SegmentBroadcastCriteria;
  message: string;
  /** Choose a specific connected integration… */
  integrationId?: string;
  /** …or a provider type; omit both to use the tenant's default active channel. */
  providerType?: MessagingIntegration['providerType'];
  /** Makes a retried request idempotent (no client double-charged). */
  idempotencyKey?: string;
}

/** Result of POST /marketing/broadcast/send. sent + skippedDedup + failed = total. */
export interface SegmentBroadcastResult {
  sent: number;
  skippedDedup: number;
  failed: number;
  total: number;
}

/**
 * One row of GET /marketing/auto-mailings — a read-only overview of an AUTO
 * mailing surface so the UI can list enabled-state + deep-link to its editor.
 * `type`: review | car_ready | installment_reminder | service_reminder.
 * `settingsRef`: relative API path of the settings endpoint that edits it.
 */
export interface AutoMailingOverview {
  type: 'review' | 'car_ready' | 'installment_reminder' | 'service_reminder';
  enabled: boolean;
  summary: string;
  settingsRef: string;
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

/**
 * v3.0.1 ФИЧА 1 — «Реальная чистая прибыль (по начислению)».
 *
 * Гладкая, прогнозируемая прибыль: постоянные расходы (аренда/коммуналка/маркетинг)
 * и оклады НЕ прыгают в день оплаты, а размазываются по всем календарным дням
 * месяца. Приходит в DashboardV2.netProfitAccrual (owner dashboard, reports v2).
 *
 * ФОРМУЛА (MTD = с начала месяца по сегодня):
 *   netProfit = checkProfit                 (выручка − запчасти − %мастеру за работу)
 *             − plannedFixedAmortized       (Σ постоянка / дней_в_месяце × прошедших)
 *             − staffFixedAmortized         (Σ оклады / дней_в_месяце × прошедших)
 *             − staffPctTurnover            (выручка периода × Σ% с оборота / 100)
 *             − staffPctProfit              (checkProfit × Σ% с прибыли / 100)
 *             − oneOffExpenses              (разовые approved-расходы; НЕ постоянка/ЗП)
 * ПРОГНОЗ на месяц: run-rate выручки/прибыли (÷ прошедших × дней_в_месяце) минус
 * ПОЛНАЯ (не амортизированная) постоянка и %-сотрудники от run-rate.
 *
 * РАЗВЯЗКА ДВОЙНОГО СЧЁТА: постоянка вычитается только из конфига (planned/staff),
 * а её ФАКТИЧЕСКИЕ оплаты (recurring-категории расходов + «Зарплата») в прибыль
 * повторно НЕ попадают — только в «Движение денег» (кассовый netProfitMonth).
 */
export interface NetProfitAccrual {
  daysInMonth: number;
  /** Прошедших календарных дней месяца (1..daysInMonth). */
  daysElapsed: number;
  /** Факт «с начала месяца по сегодня» (начислено к сегодняшнему дню). */
  mtd: {
    checkProfit: number;
    plannedFixedAmortized: number;
    staffFixedAmortized: number;
    staffPctTurnover: number;
    staffPctProfit: number;
    /** Разовые (не постоянные, не «Зарплата») расходы месяца — сунк, один раз. */
    oneOffExpenses: number;
    /**
     * Непокрытый планом избыток ФАКТИЧЕСКОЙ постоянки: расходы, помеченные
     * «постоянными» (is_recurring), но не заведённые в План (fixed_costs). Вычтен
     * из netProfit, чтобы ничего не терялось. 0 без планового конфига.
     */
    recurringExcess: number;
    /** Итоговая чистая прибыль по начислению на сегодня. */
    netProfit: number;
  };
  /** Прогноз на ВЕСЬ месяц (run-rate + полная плановая постоянка). */
  projection: {
    revenue: number;
    checkProfit: number;
    plannedFixed: number;
    staffFixed: number;
    staffPctTurnover: number;
    staffPctProfit: number;
    /** Разовые расходы — сунк-стоимость, считаются один раз (= mtd.oneOffExpenses). */
    oneOffExpenses: number;
    /** Run-rate непокрытого планом избытка постоянки. */
    recurringExcess: number;
    netProfit: number;
  };
  /** Снимок конфига (для прозрачности UI). */
  config: {
    plannedFixedMonthly: number;
    staffFixedMonthly: number;
    /** Σ % с оборота по всем сотрудникам. */
    pctTurnoverTotal: number;
    /** Σ % с прибыли по всем сотрудникам. */
    pctProfitTotal: number;
    /**
     * Сколько фактической постоянки (MTD) помечено «постоянной», но НЕ заведено в
     * План (fixed_costs). > 0 → UI показывает предупреждение «отмечено постоянным,
     * но не заведено в План: X ₽». 0 когда всё покрыто планом или планового
     * конфига нет.
     */
    recurringUncovered: number;
  };
}

export interface DashboardV2 {
  revenueToday: number;
  revenueMonth: number;
  checksToday: number;
  netProfitToday: number;
  netProfitMonth: number;
  /**
   * total = cash + card (ITEM 2 — гарантия БОЛЬШЕ не входит в total: работа по
   * гарантии денег в кассу не приносит). `warranty` остаётся справочным полем
   * (отпускная стоимость гарантийных работ, НЕ входит в total); `warrantyLoss`
   * — сегодняшний убыток по гарантии (запчасти + выплата мастеру), показывается
   * затратой. installmentDebt — долг по сегодняшним чекам в рассрочку;
   * installmentPaid — сегодняшние погашения рассрочки (по дате платежа, деньги
   * за прошлые продажи). installmentPaidCash/Card (119) — разбивка погашений по
   * способу оплаты (installmentPaid = Cash + Card; до-миграционные платежи
   * считаются налом). Все опциональны — старый бэкенд их не шлёт, клиенты
   * показывают строки только по числу.
   */
  cashPosition: {
    cash: number;
    card: number;
    warranty: number;
    /** «По гарантии» — сегодняшний убыток (запчасти + выплата мастеру). */
    warrantyLoss?: number;
    total: number;
    installmentDebt?: number;
    installmentPaid?: number;
    installmentPaidCash?: number;
    installmentPaidCard?: number;
  };
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
  /**
   * v3.0.1 ФИЧА 1 — чистая прибыль ПО НАЧИСЛЕНИЮ (факт MTD + прогноз на месяц).
   * Additive/optional: старый бэкенд поле не шлёт → клиент показывает прежний
   * кассовый netProfitMonth. Новые клиенты рендерят netProfitAccrual.mtd.netProfit
   * («с начала месяца») и .projection.netProfit («прогноз на месяц»).
   */
  netProfitAccrual?: NetProfitAccrual;
  period: 'today' | 'week' | 'month' | 'year';
}

export interface ClientsNewVsReturning {
  /** Новые = клиенты, чья запись создана в периоде (clients.created_at ∈ [from,to]). */
  newCount: number;
  /** Существующие = активные в периоде клиенты, заведённые в базу ДО периода. */
  returningCount: number;
  /** Выручка чеков периода у клиентов, заведённых в периоде. */
  newRevenue: number;
  /** Выручка чеков периода у клиентов, заведённых раньше. */
  returningRevenue: number;
  /**
   * v3.0.1 ФИЧА 5 — явная база расчёта «новый vs существующий». 'client_created_at'
   * = «новый» это дата ЗАВЕДЕНИЯ клиента в базу (не дата первого чека). Позволяет
   * UI подписать «новые (добавлены в базу за период)» однозначно. Optional —
   * старый бэкенд поле не шлёт.
   */
  basis?: 'client_created_at';
  period: { from: string; to: string };
}

// ───────────────────────────────────────────────────────────────────────
//  v3.0.1 ФИЧА 1 — «Планирование / Постоянные расходы» (owner-only config).
//  Feeds the ACCRUAL net profit (DashboardV2.netProfitAccrual). CRUD via
//  createPlanningApi → /planning/*. Owner-class + financial_reports gated.
// ───────────────────────────────────────────────────────────────────────

export type FixedCostCategory = 'rent' | 'utilities' | 'marketing' | 'other';

/** One planned recurring MONTHLY fixed cost (amortised over calendar days). */
export interface FixedCost {
  id: string;
  tenantId: string;
  /** Display name: «Аренда», «Коммуналка», «Реклама Авито», … */
  name: string;
  category: FixedCostCategory;
  /** Amount PER MONTH (RUB). */
  monthlyAmount: number;
  /** Paused rows never accrue into the net profit. */
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Compensation type for a non-piece-rate employee (cleaner / admin / cashier /
 * manager). Per-check master commission is separate (already in check profit).
 *   • fixed_monthly — оклад (RUB/month), amortised over calendar days.
 *   • pct_turnover  — % of period revenue (`amount` = percent 0..100).
 *   • pct_profit    — % of check profit  (`amount` = percent 0..100).
 */
export type EmployeeCompensationType = 'fixed_monthly' | 'pct_turnover' | 'pct_profit';

/** One employee's compensation config (one per employee, v1). */
export interface EmployeeCompensation {
  id: string;
  tenantId: string;
  userId: string;
  userName?: string;
  userRole?: string;
  type: EmployeeCompensationType;
  /** RUB/month for fixed_monthly; percent 0..100 for pct_*. */
  amount: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * v3.0.1 ФИЧА 3 — one deferred (is_deferred) check for the dashboard reminder
 * card. Newest first. Owner/director see ALL tenant deferred checks; an employee
 * sees only their OWN (authored). GET /checks/deferred-reminders.
 */
export interface DeferredCheckReminder {
  id: string;
  number: number;
  date: string;
  clientName: string | null;
  plate: string | null;
  total: number;
  masterName: string | null;
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
//  Marketing report (GET /reports/marketing?from&to) — consolidated,
//  period-based marketing analytics for the «Маркетинговые отчёты» screen.
//  Owner-class / marketing_access gated. Every sub-section is computed
//  best-effort server-side, so a failure in one (e.g. no calls integration)
//  degrades to zeros instead of failing the whole report.
// ───────────────────────────────────────────────────────────────────────

/** One acquisition-source bucket for new clients acquired within the window. */
export interface MarketingAcquisitionSource {
  /** clients.source, or «Без источника» when null/empty. */
  source: string;
  /** New clients (first check inside the window) carrying this source. */
  count: number;
  /** Revenue from those clients' checks inside the window. */
  revenue: number;
}

/**
 * One weekly cohort of NEW clients — v3.0.1 ФИЧА 5: those ADDED TO THE BASE
 * (clients.created_at) inside this ISO week within the window (was «first-ever
 * visit»). `periodStart` = Monday of that week (ISO YYYY-MM-DD). Only weeks with
 * ≥1 new client are present.
 */
export interface MarketingFirstVisitCohort {
  periodStart: string;
  newClients: number;
  /** Revenue those new clients generated on their in-window checks. */
  revenue: number;
}

/** One bucket of the repeat-purchase histogram (visit count → client count). */
export interface MarketingRepeatBucket {
  /** Lifetime non-deferred visit count: '1'..'4' or '5+'. */
  visits: string;
  /** Clients (active in the window) with exactly this many lifetime visits. */
  clients: number;
}

/** Revenue grouped by client acquisition source (warranty checks excluded). */
export interface MarketingRevenueBySource {
  /** clients.source, or «Без источника». */
  source: string;
  checks: number;
  revenue: number;
}

/** Revenue grouped by the check's master (warranty checks excluded). */
export interface MarketingRevenueByMaster {
  /** users.id, or null when the check has no master. */
  masterId: string | null;
  /** users.full_name, or «Без мастера». */
  masterName: string;
  checks: number;
  revenue: number;
}

/**
 * One point of a marketing time-series (weekly or monthly). `periodStart` is the
 * ISO date (YYYY-MM-DD) of the bucket's first day (Monday for weeks, 1st for
 * months). Every bucket over the window is emitted, zero-filled where there was
 * no activity, so a chart draws a continuous line.
 */
export interface MarketingTrendPoint {
  periodStart: string;
  /** Clients ADDED TO BASE (clients.created_at) in this bucket — v3.0.1 ФИЧА 5. */
  newClients: number;
  /** Non-warranty check revenue in this bucket. */
  revenue: number;
  /** % of bucket-active clients with >1 lifetime visit (0..100, 1 decimal). */
  returningRate: number;
  /** sms_history contact rows in this bucket (accurate per-bucket call proxy). */
  calls: number;
  /** review_responses created in this bucket. */
  reviews: number;
}

/**
 * Consolidated «Маркетинговые отчёты» (GET /reports/marketing?from&to).
 *
 * REDESIGNED contract: every field is derived from real rows in existing tables
 * — nothing invented or forward-accumulated. Directions and their backing data:
 *   • acquisition — checks + clients.source
 *   • retention   — checks
 *   • calls       — CallsService (live) + sms_history (funnel); zeros w/o telephony
 *   • reviews     — review_responses + review_tokens
 *   • loyalty     — loyalty_settings + client_bonuses (migration 083)
 *   • revenue     — checks (by source, by master; warranty excluded)
 *   • trends      — checks + sms_history + review_responses (weekly + monthly)
 * Every sub-section is computed best-effort server-side; a failure in one (e.g.
 * no telephony) degrades to zeros/empty instead of failing the whole report.
 */
export interface MarketingReport {
  period: { from: string; to: string };
  /**
   * New vs returning acquisition — v3.0.1 ФИЧА 5 (владельческое определение):
   * new = client's base record was CREATED in the window (clients.created_at);
   * returning = client active in the window whose created_at predates it. Plus a
   * by-source breakdown of the NEW clients (clients.source) and a weekly cohort
   * bucketed by created_at.
   */
  acquisition: {
    newClients: number;
    returningClients: number;
    newRevenue: number;
    returningRevenue: number;
    bySource: MarketingAcquisitionSource[];
    firstVisitCohort: MarketingFirstVisitCohort[];
  };
  /**
   * Retention over the window. returningRate/avgLtv/avgDaysBetweenVisits are
   * computed over the ALL-TIME visit history of clients who had ≥1 check inside
   * [from,to]. repeatPurchaseDistribution is a histogram of those clients'
   * lifetime visit counts.
   */
  retention: {
    returningRate: number;
    avgLtv: number;
    avgDaysBetweenVisits: number;
    repeatPurchaseDistribution: MarketingRepeatBucket[];
  };
  /**
   * Calls for the window. total/incoming/outgoing/missed/notCalledBack come
   * from the live calls provider (МоиЗвонки proxy / stored Mango) and are 0
   * when no telephony integration is configured. answerRate = answered/total
   * where answered = total − missed. funnel is the sms_history→checks funnel.
   */
  calls: {
    total: number;
    incoming: number;
    outgoing: number;
    missed: number;
    notCalledBack: number;
    answerRate: number;
    funnel: {
      uniqueCallers: number;
      arrivedClients: number;
      createdChecks: number;
      conversionRate: number;
      repeatClients: number;
      revenue: number;
    };
  };
  /** Reviews for the window (period-scoped review_responses + review_tokens). */
  reviews: {
    total: number;
    avgRating: number;
    positive: number;
    negative: number;
    responseRate: number;
    conversionRate: number;
    tokensSent: number;
    tokensResponded: number;
  };
  /**
   * Loyalty ROI (loyalty_settings + client_bonuses, migration 083). pointsAccrued
   * / pointsRedeemed are money amounts of accrual / redemption movements CREATED
   * in the window; outstandingBalance is the ALL-TIME live liability
   * (Σaccrual − Σredemption). enabled=false + zeros when the tenant never used
   * loyalty. Nothing here is fabricated.
   */
  loyalty: {
    enabled: boolean;
    accrualPercent: number;
    participants: number;
    pointsAccrued: number;
    pointsRedeemed: number;
    accrualCount: number;
    redemptionCount: number;
    outstandingBalance: number;
  };
  /** Revenue attribution (checks, warranty excluded) by client source and master. */
  revenue: {
    bySource: MarketingRevenueBySource[];
    byMaster: MarketingRevenueByMaster[];
  };
  /** Time-series for charts: weekly AND monthly buckets over the window. */
  trends: {
    weekly: MarketingTrendPoint[];
    monthly: MarketingTrendPoint[];
  };
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
