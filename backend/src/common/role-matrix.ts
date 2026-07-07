/**
 * role-matrix.ts — мост совместимости между матрицей роли (Bitrix24-style,
 * миграция 114) и сегодняшним плоским словарём permission-ключей.
 *
 * Enforcement НЕ переписывается: все guards/сервисы продолжают спрашивать
 * `userHasPermission(actor, key)` (common/guards/permissions.guard.ts). Этот
 * модуль лишь превращает матрицу «секция × действие × охват» в те же плоские
 * булевы ключи, чтобы jwt.strategy мог подложить их КАК БАЗУ под персональные
 * users.permissions (overrides действуют поверх):
 *
 *   effective = flatten(roles.matrix) ⊕ users.permissions   — role_id задан
 *   effective = users.permissions                            — role_id NULL
 *                                                              (байт-в-байт
 *                                                              как до 114)
 *
 * Формат матрицы (JSONB): секции × действия. Значение действия:
 *   • scope-ключ  — 'none' | 'own' | 'all' (охват);
 *   • тумблер     — boolean.
 * Любое отсутствующее / невалидное значение читается как 'none' / false —
 * fail-closed, испорченный JSON не может ничего ВЫДАТЬ.
 *
 * Таблица соответствия «PermissionKey → путь в матрице» (полная, 28 ключей):
 *
 *   checks_view            ← checks.view       ('own'|'all' → true)
 *   checks_view_all        ← checks.view       ('all' → true)
 *   checks_create          ← checks.create
 *   checks_edit            ← checks.edit       ('own'|'all' → true; охват
 *                             'own'/'all' зарезервирован под будущие волны —
 *                             сегодня enforcement различает только наличие)
 *   checks_delete          ← checks.delete
 *   checks_change_datetime ← checks.changeDatetime
 *   edit_closed_check      ← checks.editClosed
 *   payment_edit           ← checks.editPayment
 *   accept_payment         ← checks.acceptPayment
 *   sell_installment       ← checks.sellInstallment
 *   warehouse_access       ← warehouse.view
 *   warehouse_delete       ← warehouse.delete
 *   suppliers_access       ← suppliers.view
 *   clients_view           ← clients.view
 *   clients_edit           ← clients.edit
 *   schedule_view          ← schedule.view
 *   bookings_access        ← bookings.view
 *   salary_view            ← salary.view       ('own'|'all' → true; охват
 *                             зарезервирован — сегодня ключ один)
 *   financial_reports      ← reports.view
 *   profit_view            ← reports.profit
 *   export_data            ← reports.export
 *   cashflow_view          ← reports.cashflow  ('own'|'all' → true)   (ITEM 6)
 *   cashflow_view_all      ← reports.cashflow  ('all' → true)         (ITEM 6)
 *   can_add_expenses       ← expenses.add
 *   marketing_access       ← marketing.view
 *   calls_view             ← calls.view
 *   calls_listen           ← calls.listen
 *   user_management        ← employees.manage
 *
 * ВАЖНО: словарь обязан оставаться зеркалом PermissionKey из
 * shared/types/index.ts (backend не может импортировать shared — вне rootDir;
 * та же причина, по которой MASTER_PERMISSION_DEFAULTS в permissions.guard.ts —
 * зеркало ROLE_PERMISSION_DEFAULTS). Новый permission-ключ = новая ячейка здесь
 * + в RoleMatrix (shared) + в сидах системных ролей при необходимости.
 *
 * cashflow_view / cashflow_view_all (ITEM 6) введены как СТУПЕНЧАТЫЕ ключи —
 * так же, как когда-то warehouse_delete и edit_closed_check: они уже типизированы
 * в shared UserPermissions и раскладываются здесь (⇒ входят в
 * CANONICAL_PERMISSION_KEYS и в GET /users/:id/effective-permissions), но НАМЕРЕННО
 * ещё НЕ добавлены в union PermissionKey / PERMISSION_GROUPS shared. Причина:
 * PERMISSION_GROUPS питает exhaustive `Record<PermissionKey, string>` в UI-файлах
 * ролей (mobile roleMatrixEditor.ts, web RolesManagement.tsx) — их правит
 * отдельная UI-волна (fan-out). До неё enforcement полностью рабочий (guard берёт
 * строковый ключ), а три typecheck зелёные без правки UI. Поэтому CANONICAL здесь
 * (28 ключей) временно шире shared PERMISSION_KEYS (26) ровно на эти два ключа.
 */

export type RoleScopeValue = 'none' | 'own' | 'all';

/** Матрица как она приходит из jsonb / клиента — до валидации. */
export type RawRoleMatrix = Record<string, Record<string, unknown>>;

/** Действия-охваты: секция → список scope-ключей. */
const SCOPE_ACTIONS: Record<string, readonly string[]> = {
  checks: ['view', 'edit'],
  salary: ['view'],
  // reports.cashflow — охват «Движение денег» (ITEM 6): 'own' видит только свои
  // денежные операции, 'all' — все. Раскладывается в cashflow_view (own|all) +
  // cashflow_view_all (all). Enforcement — ReportsService.getCashFlow.
  reports: ['cashflow'],
};

/** Действия-тумблеры: секция → список boolean-ключей. */
const BOOL_ACTIONS: Record<string, readonly string[]> = {
  checks: ['create', 'delete', 'changeDatetime', 'editClosed', 'editPayment', 'acceptPayment', 'sellInstallment'],
  warehouse: ['view', 'delete'],
  suppliers: ['view'],
  clients: ['view', 'edit'],
  schedule: ['view'],
  bookings: ['view'],
  salary: [],
  reports: ['view', 'profit', 'export'],
  expenses: ['add'],
  marketing: ['view'],
  calls: ['view', 'listen'],
  employees: ['manage'],
};

/** Все известные секции матрицы (стабильный порядок для sanitize). */
const MATRIX_SECTIONS: readonly string[] = [
  'checks',
  'warehouse',
  'suppliers',
  'clients',
  'schedule',
  'bookings',
  'salary',
  'reports',
  'expenses',
  'marketing',
  'calls',
  'employees',
];

function readScope(matrix: RawRoleMatrix, section: string, action: string): RoleScopeValue {
  const v = matrix[section]?.[action];
  return v === 'own' || v === 'all' ? v : 'none';
}

function readBool(matrix: RawRoleMatrix, section: string, action: string): boolean {
  return matrix[section]?.[action] === true;
}

function asObject(value: unknown): RawRoleMatrix {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as RawRoleMatrix) : {};
}

/** Значение секции как plain-object действий (или пустой объект). */
function asSection(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * Развернуть матрицу роли в плоский словарь permission-ключей. Возвращает
 * ЯВНОЕ boolean-значение для КАЖДОГО из 26 канонических ключей — merged-карта
 * актора получает полную базу, и per-role fallback в userHasPermission для
 * канонических ключей больше не срабатывает (охват решён матрицей). Значения
 * вне словаря / невалидные — false ('none'): fail-closed.
 */
export function flattenRoleMatrix(rawMatrix: unknown): Record<string, boolean> {
  const matrix = asObject(rawMatrix);
  const checksView = readScope(matrix, 'checks', 'view');
  const checksEdit = readScope(matrix, 'checks', 'edit');
  const salaryView = readScope(matrix, 'salary', 'view');
  // ITEM 6 — охват «Движение денег»: own|all → cashflow_view; all → cashflow_view_all.
  const reportsCashflow = readScope(matrix, 'reports', 'cashflow');

  return {
    checks_view: checksView !== 'none',
    checks_view_all: checksView === 'all',
    checks_create: readBool(matrix, 'checks', 'create'),
    checks_edit: checksEdit !== 'none',
    checks_delete: readBool(matrix, 'checks', 'delete'),
    checks_change_datetime: readBool(matrix, 'checks', 'changeDatetime'),
    edit_closed_check: readBool(matrix, 'checks', 'editClosed'),
    payment_edit: readBool(matrix, 'checks', 'editPayment'),
    accept_payment: readBool(matrix, 'checks', 'acceptPayment'),
    sell_installment: readBool(matrix, 'checks', 'sellInstallment'),
    warehouse_access: readBool(matrix, 'warehouse', 'view'),
    warehouse_delete: readBool(matrix, 'warehouse', 'delete'),
    suppliers_access: readBool(matrix, 'suppliers', 'view'),
    clients_view: readBool(matrix, 'clients', 'view'),
    clients_edit: readBool(matrix, 'clients', 'edit'),
    schedule_view: readBool(matrix, 'schedule', 'view'),
    bookings_access: readBool(matrix, 'bookings', 'view'),
    salary_view: salaryView !== 'none',
    financial_reports: readBool(matrix, 'reports', 'view'),
    profit_view: readBool(matrix, 'reports', 'profit'),
    export_data: readBool(matrix, 'reports', 'export'),
    cashflow_view: reportsCashflow !== 'none',
    cashflow_view_all: reportsCashflow === 'all',
    can_add_expenses: readBool(matrix, 'expenses', 'add'),
    marketing_access: readBool(matrix, 'marketing', 'view'),
    calls_view: readBool(matrix, 'calls', 'view'),
    calls_listen: readBool(matrix, 'calls', 'listen'),
    user_management: readBool(matrix, 'employees', 'manage'),
  };
}

/**
 * Канонический список плоских permission-ключей (зеркало PERMISSION_KEYS из
 * shared/types). Выводится из flatten пустой матрицы, чтобы список и flatten
 * физически не могли разойтись.
 */
export const CANONICAL_PERMISSION_KEYS: readonly string[] = Object.keys(flattenRoleMatrix({}));

/**
 * Санитизация матрицы перед записью в БД: остаются только известные секции и
 * действия; scope-значения принудительно 'none'|'own'|'all', тумблеры — строгий
 * boolean. Подделка ("true", 1, вложенный мусор, неизвестные ключи) не может
 * попасть в jsonb — тот же принцип, что cleanPermissions в permission-templates.
 * Отсутствующее действие НЕ материализуется (flatten и так читает его как
 * false/'none') — храним ровно то, что задали.
 */
export function sanitizeRoleMatrix(rawMatrix: unknown): RawRoleMatrix {
  const matrix = asObject(rawMatrix);
  const clean: RawRoleMatrix = {};
  for (const section of MATRIX_SECTIONS) {
    const rawSection = asSection(matrix[section]);
    const cleanSection: Record<string, unknown> = {};
    for (const action of SCOPE_ACTIONS[section] ?? []) {
      const v = rawSection[action];
      if (v === 'none' || v === 'own' || v === 'all') cleanSection[action] = v;
    }
    for (const action of BOOL_ACTIONS[section] ?? []) {
      const v = rawSection[action];
      if (typeof v === 'boolean') cleanSection[action] = v;
    }
    if (Object.keys(cleanSection).length > 0) clean[section] = cleanSection;
  }
  return clean;
}

/**
 * Двухуровневое слияние матриц (секция → действие): base ⊕ patch. Используется
 * в POST /roles c copyFromRoleId + matrix — «копия Мастера, но checks.view=all»
 * одним запросом, не теряя соседние действия секции. Обе стороны проходят
 * sanitize у вызывающего.
 */
export function mergeRoleMatrix(base: RawRoleMatrix, patch: RawRoleMatrix): RawRoleMatrix {
  const merged: RawRoleMatrix = {};
  for (const section of MATRIX_SECTIONS) {
    const combined = { ...asSection(base[section]), ...asSection(patch[section]) };
    if (Object.keys(combined).length > 0) merged[section] = combined;
  }
  return merged;
}

/**
 * Эффективные permissions актора: база из матрицы роли (если назначена),
 * персональные overrides — поверх. roleMatrix == null/undefined → карта
 * пользователя без изменений, т.е. ровно сегодняшний путь (guard добьёт
 * отсутствующие ключи дефолтами строковой роли).
 */
export function mergeEffectivePermissions(
  roleMatrix: unknown | null | undefined,
  userPermissions: Record<string, boolean>,
): Record<string, boolean> {
  if (roleMatrix === null || roleMatrix === undefined) return userPermissions;
  return { ...flattenRoleMatrix(roleMatrix), ...userPermissions };
}
