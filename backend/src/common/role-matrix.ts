/**
 * role-matrix.ts — единственный механизм разрешений (ROLE-ONLY, консолидация
 * 2026-07). Матрица роли (JSONB, миграция 114) — единственный источник
 * эффективных прав. Персональные users.permissions ОТКЛЮЧЕНЫ в jwt.strategy
 * (см. mergeEffectivePermissions — теперь возвращает только flatten(matrix)),
 * permission_templates удалены. Enforcement по-прежнему через
 * userHasPermission(actor, key) (common/guards/permissions.guard.ts) — этот
 * модуль лишь превращает матрицу «секция × действие × охват» в плоские булевы
 * ключи, которыми оперируют guards и сервисы.
 *
 * Формат матрицы (JSONB): секции × действия. Значение действия:
 *   • scope-ключ  — 'none' | 'own' | 'all' (охват);
 *   • тумблер     — boolean.
 * Любое отсутствующее / невалидное значение читается как 'none' / false —
 * fail-closed, испорченный JSON не может ничего ВЫДАТЬ.
 *
 * ── Секции и действия (view-vs-manage гранулярность) ─────────────────────────
 *   checks:
 *     view (own|all), create, edit (own|all), delete, changeDatetime,
 *     editClosed, editPayment, acceptPayment, sellInstallment
 *   services:  view, manage
 *     • view   — смотреть услуги + добавлять в чек (→ services_view);
 *     • manage — создавать/редактировать/менять %+гарантию/удалять (→ services_manage).
 *   warehouse: view, manage, delete
 *     • view   — товары БЕЗ себестоимости + в чек (→ warehouse_access);
 *     • manage — себестоимость + add/edit/цены/сток/инвентаризация (→ warehouse_manage);
 *     • delete — удаление товаров/папок (→ warehouse_delete, legacy back-compat).
 *   suppliers: view, manage   (→ suppliers_access / suppliers_manage)
 *   equipment: view, manage   (→ equipment_view / equipment_manage)
 *   clients:   view, edit
 *   schedule:  view
 *   bookings:  view
 *   salary:    view (none|own|all)   (→ salary_view (own|all) + salary_view_all (all))
 *   reports:   view, profit, export, cashflow (none|own|all)
 *   expenses:  add
 *   marketing: view
 *   calls:     view, listen
 *   employees: manage
 *
 * Таблица соответствия «PermissionKey → путь в матрице» (плоский словарь):
 *
 *   checks_view            ← checks.view       ('own'|'all' → true)
 *   checks_view_all        ← checks.view       ('all' → true)
 *   checks_create          ← checks.create
 *   checks_edit            ← checks.edit       ('own'|'all' → true)
 *   checks_edit_all        ← checks.edit       ('all' → true)
 *   checks_delete          ← checks.delete
 *   checks_change_datetime ← checks.changeDatetime
 *   edit_closed_check      ← checks.editClosed
 *   payment_edit           ← checks.editPayment
 *   accept_payment         ← checks.acceptPayment
 *   sell_installment       ← checks.sellInstallment
 *   services_view          ← services.view     (manage ⇒ view: manage тоже даёт view)
 *   services_manage        ← services.manage
 *   warehouse_access       ← warehouse.view    (manage ⇒ view)
 *   warehouse_manage       ← warehouse.manage
 *   warehouse_delete       ← warehouse.delete  (manage ⇒ delete: manage тоже удаляет)
 *   suppliers_access       ← suppliers.view    (manage ⇒ view)
 *   suppliers_manage       ← suppliers.manage
 *   equipment_view         ← equipment.view    (manage ⇒ view)
 *   equipment_manage       ← equipment.manage
 *   clients_view           ← clients.view
 *   clients_edit           ← clients.edit
 *   schedule_view          ← schedule.view
 *   bookings_access        ← bookings.view
 *   salary_view            ← salary.view       ('own'|'all' → true)
 *   salary_view_all        ← salary.view       ('all' → true)
 *   financial_reports      ← reports.view
 *   profit_view            ← reports.profit
 *   export_data            ← reports.export
 *   cashflow_view          ← reports.cashflow  ('own'|'all' → true)
 *   cashflow_view_all      ← reports.cashflow  ('all' → true)
 *   can_add_expenses       ← expenses.add
 *   marketing_access       ← marketing.view
 *   calls_view             ← calls.view
 *   calls_listen           ← calls.listen
 *   user_management        ← employees.manage
 *
 * ВАЖНО: словарь обязан оставаться зеркалом PermissionKey из
 * shared/types/index.ts (backend не может импортировать shared — вне rootDir).
 * Новый permission-ключ = новая ячейка здесь + в RoleMatrix (shared) + в сидах
 * системных ролей + в бэкфилле миграции.
 *
 * «manage ⇒ view/delete»: manage — надмножество view (и для склада — delete).
 * Раскладка это учитывает, чтобы UI мог хранить только { manage: true } и
 * пользователь всё равно проходил view-гейты (add-to-check, list).
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
  services: ['view', 'manage'],
  warehouse: ['view', 'manage', 'delete'],
  suppliers: ['view', 'manage'],
  equipment: ['view', 'manage'],
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
  'services',
  'warehouse',
  'suppliers',
  'equipment',
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
 * ЯВНОЕ boolean-значение для КАЖДОГО канонического ключа. Значения вне словаря /
 * невалидные — false ('none'): fail-closed.
 *
 * «manage ⇒ view» (и для склада «manage ⇒ delete»): manage-тумблер — надмножество
 * view/delete, раскладка это учитывает.
 */
export function flattenRoleMatrix(rawMatrix: unknown): Record<string, boolean> {
  const matrix = asObject(rawMatrix);
  const checksView = readScope(matrix, 'checks', 'view');
  const checksEdit = readScope(matrix, 'checks', 'edit');
  const salaryView = readScope(matrix, 'salary', 'view');
  // ITEM 6 — охват «Движение денег»: own|all → cashflow_view; all → cashflow_view_all.
  const reportsCashflow = readScope(matrix, 'reports', 'cashflow');

  // manage-надмножества.
  const servicesManage = readBool(matrix, 'services', 'manage');
  const warehouseManage = readBool(matrix, 'warehouse', 'manage');
  const suppliersManage = readBool(matrix, 'suppliers', 'manage');
  const equipmentManage = readBool(matrix, 'equipment', 'manage');

  return {
    checks_view: checksView !== 'none',
    checks_view_all: checksView === 'all',
    checks_create: readBool(matrix, 'checks', 'create'),
    checks_edit: checksEdit !== 'none',
    checks_edit_all: checksEdit === 'all',
    checks_delete: readBool(matrix, 'checks', 'delete'),
    checks_change_datetime: readBool(matrix, 'checks', 'changeDatetime'),
    edit_closed_check: readBool(matrix, 'checks', 'editClosed'),
    payment_edit: readBool(matrix, 'checks', 'editPayment'),
    accept_payment: readBool(matrix, 'checks', 'acceptPayment'),
    sell_installment: readBool(matrix, 'checks', 'sellInstallment'),
    // Услуги — view (смотреть + в чек) / manage (CRUD + %/гарантия). manage ⇒ view.
    services_view: readBool(matrix, 'services', 'view') || servicesManage,
    services_manage: servicesManage,
    // Склад — view (без себестоимости + в чек) / manage (себестоимость + CRUD +
    // инвентаризация) / delete. manage ⇒ view И delete.
    warehouse_access: readBool(matrix, 'warehouse', 'view') || warehouseManage,
    warehouse_manage: warehouseManage,
    warehouse_delete: readBool(matrix, 'warehouse', 'delete') || warehouseManage,
    // Поставщики — view / manage. manage ⇒ view.
    suppliers_access: readBool(matrix, 'suppliers', 'view') || suppliersManage,
    suppliers_manage: suppliersManage,
    // Имущество — view / manage. manage ⇒ view.
    equipment_view: readBool(matrix, 'equipment', 'view') || equipmentManage,
    equipment_manage: equipmentManage,
    clients_view: readBool(matrix, 'clients', 'view'),
    clients_edit: readBool(matrix, 'clients', 'edit'),
    schedule_view: readBool(matrix, 'schedule', 'view'),
    bookings_access: readBool(matrix, 'bookings', 'view'),
    salary_view: salaryView !== 'none',
    salary_view_all: salaryView === 'all',
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
 * попасть в jsonb. Отсутствующее действие НЕ материализуется (flatten и так
 * читает его как false/'none') — храним ровно то, что задали.
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
 * в POST /roles c copyFromRoleId + matrix. Обе стороны проходят sanitize у
 * вызывающего.
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
 * Эффективные permissions актора — ТОЛЬКО из матрицы роли (ROLE-ONLY, консолидация
 * 2026-07). Персональные overrides УДАЛЕНЫ: второй аргумент игнорируется (оставлен
 * в сигнатуре, чтобы не переписывать все вызовы разом; будет вычищен в следующей
 * волне). roleMatrix == null/undefined → пустая карта: deny-by-default. Owner-class
 * (superadmin/director/admin) обходит гейты по строковой роли в userHasPermission,
 * поэтому пустая база им не мешает.
 *
 * @param roleMatrix матрица назначенной роли (или null, если роль не назначена)
 * @param _legacyUserPermissions — DEPRECATED, игнорируется (ROLE-ONLY cutover)
 */
export function mergeEffectivePermissions(
  roleMatrix: unknown | null | undefined,
  _legacyUserPermissions?: Record<string, boolean>,
): Record<string, boolean> {
  if (roleMatrix === null || roleMatrix === undefined) return {};
  return flattenRoleMatrix(roleMatrix);
}
