// ═══════════════════════════════════════════════════════════════════════════════
//  Plan feature catalog — the authoritative, runtime-served list of every
//  toggleable plan feature key (#55).
//
//  Served to the superadmin plan editor via GET /plans/features-catalog so the
//  admin UI can render a toggle per feature PER TARIFF (including the ones a plan
//  currently has OFF), and used to VALIDATE PUT /plans/:id/features so a stale or
//  malicious client cannot write an unknown key into a plan's `features` JSONB.
//
//  Keys mirror the `features` JSONB on `plans` rows and what FeatureGate checks
//  against `SubscriptionInfo.features` on web + mobile. The first block preserves
//  EVERY pre-existing key 1:1 (checks_view … check_photos) so existing gating
//  keeps working unchanged — we EXTEND, never rename. The remaining entries are
//  the sections that shipped after the original catalog; migration 102 backfills
//  them onto every existing plan so today's open access is preserved.
//
//  The backend can't import from `shared/`, so this list is MIRRORED in
//  shared/constants/features.ts (clients import that copy). Keep the two in sync —
//  same convention as ROLE_PERMISSION_DEFAULTS / SECTION_KEYS.
//
//  `gated`: does the key paywall a screen via FeatureGate? `false` (check_photos)
//  means an always-on capability that is still a real, editable feature key.
//  `group`: purely for admin-UI sectioning of the toggles (core / section /
//  integration) — it carries no enforcement meaning.
// ═══════════════════════════════════════════════════════════════════════════════

export type FeatureGroup = 'core' | 'section' | 'integration';

export interface FeatureDef {
  key: string;
  label: string;
  /** Does this key gate a screen via FeatureGate? */
  gated: boolean;
  /** Admin-UI grouping only — no enforcement semantics. */
  group: FeatureGroup;
}

export const ALL_FEATURES: readonly FeatureDef[] = [
  // ── Core (the base every workshop needs) ──────────────────────────────────
  { key: 'checks_view', label: 'Заказ-наряды', gated: true, group: 'core' },
  { key: 'clients_view', label: 'Клиенты и авто', gated: true, group: 'core' },
  { key: 'warehouse_view', label: 'Склад', gated: true, group: 'core' },
  { key: 'services_view', label: 'Услуги', gated: true, group: 'core' },
  { key: 'cashflow_view', label: 'Движение денег', gated: true, group: 'core' },
  { key: 'reports_view', label: 'Отчёты', gated: true, group: 'core' },
  { key: 'export_data', label: 'Экспорт данных', gated: true, group: 'core' },
  // In DB via migration 044 (enabled on all active plans). gated:false = always-on.
  { key: 'check_photos', label: 'Фотофиксация в чеке', gated: false, group: 'core' },

  // ── Sections (premium screens) ────────────────────────────────────────────
  { key: 'suppliers_view', label: 'Поставщики', gated: true, group: 'section' },
  { key: 'salary_view', label: 'Зарплата', gated: true, group: 'section' },
  { key: 'schedule_view', label: 'Расписание', gated: true, group: 'section' },
  { key: 'users_manage', label: 'Управление пользователями', gated: true, group: 'section' },
  // ── New sections (backfilled onto existing plans by migration 102) ────────
  { key: 'motivation_view', label: 'Мотивация мастеров', gated: true, group: 'section' },
  { key: 'installments_view', label: 'Рассрочка', gated: true, group: 'section' },
  { key: 'cash_shift_view', label: 'Кассовая смена', gated: true, group: 'section' },
  { key: 'work_board_view', label: 'Доска заказ-нарядов', gated: true, group: 'section' },
  { key: 'knowledge_view', label: 'База знаний', gated: true, group: 'section' },
  { key: 'purchase_orders_view', label: 'Заказы поставщикам', gated: true, group: 'section' },
  { key: 'loyalty_view', label: 'Программа лояльности', gated: true, group: 'section' },

  // ── Marketing integrations ────────────────────────────────────────────────
  { key: 'integration_fiscal', label: 'Фискализация (АТОЛ / ОФД)', gated: true, group: 'integration' },
  { key: 'integration_acquiring', label: 'Эквайринг (ЮKassa / Тинькофф)', gated: true, group: 'integration' },
  { key: 'integration_messaging', label: 'Мессенджеры (WhatsApp / Telegram)', gated: true, group: 'integration' },
  { key: 'integration_telephony', label: 'Телефония (Mango)', gated: true, group: 'integration' },
] as const;

/** Just the keys, in catalog order — used to validate PUT /plans/:id/features. */
export const ALL_FEATURE_KEYS: readonly string[] = ALL_FEATURES.map((f) => f.key);

/**
 * The keys backfilled by migration 102 (the post-catalog sections). Kept here so
 * the SQL list and the code stay traceable to one another. Not used at runtime.
 */
export const FEATURE_KEYS_ADDED_102: readonly string[] = [
  'motivation_view',
  'installments_view',
  'cash_shift_view',
  'work_board_view',
  'knowledge_view',
  'purchase_orders_view',
  'loyalty_view',
  'integration_fiscal',
  'integration_acquiring',
  'integration_messaging',
  'integration_telephony',
];
