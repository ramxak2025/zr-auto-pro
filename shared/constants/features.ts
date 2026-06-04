// ═══════════════════════════════════════════════════════════════════════════════
//  Canonical feature registry — the SINGLE source of truth for plan feature keys.
//
//  Stops the ALL_FEATURES drift: the same list was hand-copied (and already
//  diverging) in frontend/src/pages/admin/AdminPlansPage.tsx and
//  mobile/src/screens/AdminScreen.tsx. Both editors — plus FeatureGate on web +
//  mobile — should consume THIS array instead of their local copies.
//
//  Keys mirror the `features` JSONB on `plans` rows and what FeatureGate checks
//  against `SubscriptionInfo.features`. `check_photos` lives in the DB via
//  migration 044 (enabled on every active plan) but was missing from every
//  editor — it's included here so the plan editor can actually toggle it.
//
//  `gated`: whether the key paywalls a screen via FeatureGate. `false` means the
//  capability is effectively always-on (e.g. check_photos opened to all tiers)
//  but still a real, editable feature key.
//
//  NOTE: consumers are intentionally NOT refactored in this step — this file is
//  just the registry. Wiring AdminPlansPage / AdminScreen / FeatureGate to it is
//  a separate UI task.
// ═══════════════════════════════════════════════════════════════════════════════

export interface FeatureDef {
  key: string;
  label: string;
  /** Does this key gate a screen via FeatureGate? */
  gated: boolean;
}

export const ALL_FEATURES: readonly FeatureDef[] = [
  { key: 'checks_view', label: 'Заказ-наряды', gated: true },
  { key: 'clients_view', label: 'Клиенты и авто', gated: true },
  { key: 'warehouse_view', label: 'Склад', gated: true },
  { key: 'services_view', label: 'Услуги', gated: true },
  { key: 'suppliers_view', label: 'Поставщики', gated: true },
  { key: 'cashflow_view', label: 'Движение денег', gated: true },
  { key: 'salary_view', label: 'Зарплата', gated: true },
  { key: 'schedule_view', label: 'Расписание', gated: true },
  { key: 'reports_view', label: 'Отчёты', gated: true },
  { key: 'users_manage', label: 'Управление пользователями', gated: true },
  { key: 'export_data', label: 'Экспорт данных', gated: true },
  // In DB via migration 044 (enabled on all active plans), missing from editors.
  { key: 'check_photos', label: 'Фотофиксация в чеке', gated: false },
] as const;

/** Just the keys, in registry order — handy for validation / iteration. */
export const ALL_FEATURE_KEYS: readonly string[] = ALL_FEATURES.map((f) => f.key);

/** Human-readable label for a feature key (falls back to the raw key). */
export function featureLabel(key: string): string {
  return ALL_FEATURES.find((f) => f.key === key)?.label ?? key;
}
