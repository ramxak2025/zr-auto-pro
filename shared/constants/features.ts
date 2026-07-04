// ═══════════════════════════════════════════════════════════════════════════════
//  Canonical feature registry — the SINGLE source of truth for plan feature keys
//  on the CLIENTS (web + mobile).
//
//  Stops the ALL_FEATURES drift: the same list was hand-copied (and already
//  diverging) in frontend/src/pages/admin/AdminPlansPage.tsx and
//  mobile/src/screens/AdminScreen.tsx. Both editors — plus FeatureGate on web +
//  mobile — should consume THIS array instead of their local copies.
//
//  Keys mirror the `features` JSONB on `plans` rows and what FeatureGate checks
//  against `SubscriptionInfo.features`. The backend can't import from `shared/`,
//  so this list is MIRRORED in backend/src/plans/feature-catalog.ts (which the
//  GET /plans/features-catalog endpoint serves + uses to validate writes). Keep
//  the two in sync.
//
//  #55: extended with every section that shipped after the original catalog
//  (motivation, installments, cash-shift, work-board, knowledge, purchase orders,
//  loyalty + the marketing integrations). Migration 102 backfills these new keys
//  onto every existing plan so today's OPEN access to those sections is preserved
//  once the client UI wraps them in FeatureGate. We EXTEND, never rename — every
//  pre-existing key (checks_view … check_photos) is unchanged.
//
//  `gated`: whether the key paywalls a screen via FeatureGate. `false`
//  (check_photos) means an always-on capability that is still a real, editable
//  feature key. `group`: admin-UI sectioning only (core / section / integration),
//  no enforcement meaning.
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
  // 115 — голосовой ввод комментария (SpeechKit + YandexGPT). Продаётся пакетами
  // минут (Plan.voiceMinutes + Tenant.voiceMinutesExtra); НЕ бэкфиллится на
  // существующие тарифы — суперадмин включает сознательно. Серверный гейт тоже
  // есть: POST /voice/transcribe → 403 без ключа в тарифе.
  { key: 'voice_input', label: 'Голосовой ввод (пакет минут)', gated: true, group: 'section' },

  // ── Marketing integrations ────────────────────────────────────────────────
  { key: 'integration_fiscal', label: 'Фискализация (АТОЛ / ОФД)', gated: true, group: 'integration' },
  { key: 'integration_acquiring', label: 'Эквайринг (ЮKassa / Тинькофф)', gated: true, group: 'integration' },
  { key: 'integration_messaging', label: 'Мессенджеры (WhatsApp / Telegram)', gated: true, group: 'integration' },
  { key: 'integration_telephony', label: 'Телефония (Mango)', gated: true, group: 'integration' },
] as const;

/** Just the keys, in registry order — handy for validation / iteration. */
export const ALL_FEATURE_KEYS: readonly string[] = ALL_FEATURES.map((f) => f.key);

/** Human-readable label for a feature key (falls back to the raw key). */
export function featureLabel(key: string): string {
  return ALL_FEATURES.find((f) => f.key === key)?.label ?? key;
}
