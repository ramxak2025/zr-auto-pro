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
 *     editClosed, editPayment, acceptPayment, sellInstallment,
 *     cashShifts (кассовые смены: open/close/collect), board (колонки доски)
 *   services:  view, manage
 *     • view   — смотреть услуги + добавлять в чек (→ services_view);
 *     • manage — создавать/редактировать/менять %+гарантию/удалять (→ services_manage).
 *   warehouse: view, manage, delete, analytics
 *     • view   — товары БЕЗ себестоимости + в чек (→ warehouse_access);
 *     • manage — себестоимость + add/edit/цены/сток/инвентаризация (→ warehouse_manage);
 *     • delete — удаление товаров/папок (→ warehouse_delete, legacy back-compat);
 *     • analytics — /warehouse-analytics/* (маржа/себестоимость) (→ warehouse_analytics_view).
 *   suppliers: view, manage, paymentsCorrect
 *     • view   — смотреть поставщиков/поставки/оплаты (→ suppliers_access);
 *     • manage — CRUD + поставки/оплаты/возвраты/б-у (→ suppliers_manage);
 *     • paymentsCorrect — сторно платежа + возврат от поставщика
 *       (→ suppliers_payments_correct, миграция 145). manage НЕ влечёт
 *       paymentsCorrect — право корректировать деньги выдаётся явно.
 *   equipment: view, manage, permanentDelete (безвозвратное удаление — owner-only)
 *   clients:   view, edit, delete, debts (долги + рассрочка)
 *   schedule:  view, manage (мутации расписания / work-modes)
 *   bookings:  view
 *   salary:    view (none|own|all)   (→ salary_view (own|all) + salary_view_all (all)),
 *              payouts (выплаты/авансы/штрафы), premiums (премии), motivation (акции)
 *   reports:   view, profit, export, cashflow (none|own|all)
 *   expenses:  add
 *   marketing: view, manage
 *     • view   — смотреть раздел «Маркетинг» (dashboard/reviews/…) (→ marketing_access);
 *     • manage — все мутации (интеграции/площадки/настройки/рассылки/alerts) (→ marketing_manage). manage ⇒ view.
 *   calls:     view, listen
 *   employees: manage, approveProfile (согласование заявок на смену профиля)
 *   settings:  manage (интеграции/касса/справочники), company (данные компании)
 *   knowledge: view, manage
 *     • view   — смотреть базу знаний (курсы/статьи/troubleshooting/…) (→ knowledge_view);
 *     • manage — мутации + менеджерские чтения (→ knowledge_manage). manage ⇒ view.
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
 *   marketing_access       ← marketing.view   (manage ⇒ view)
 *   marketing_manage       ← marketing.manage
 *   calls_view             ← calls.view
 *   calls_listen           ← calls.listen
 *   user_management        ← employees.manage
 *   ── v3 (миграция 136) — перевод @Roles-гейтов на матрицу ──
 *   cash_shifts_manage         ← checks.cashShifts
 *   checks_board_manage        ← checks.board
 *   clients_delete             ← clients.delete
 *   debts_manage               ← clients.debts
 *   schedule_manage            ← schedule.manage
 *   salary_payouts_manage      ← salary.payouts       (у системного «Администратора» сид false!)
 *   salary_premiums_manage     ← salary.premiums
 *   motivation_manage          ← salary.motivation
 *   warehouse_analytics_view   ← warehouse.analytics
 *   equipment_permanent_delete ← equipment.permanentDelete (сид Админ=false)
 *   employees_approve_profile  ← employees.approveProfile  (сид Админ=false)
 *   settings_manage            ← settings.manage
 *   company_manage             ← settings.company          (сид Админ=false)
 *   knowledge_view             ← knowledge.view            (manage ⇒ view)
 *   knowledge_manage           ← knowledge.manage
 *   ── Round 14 (миграция 148) — режим «Кассир» ──
 *   checks_edit_assigned_order ← checks.editAssignedOrder (сид ВСЕМ ролям true —
 *                                презервация 1:1, владелец выключает сам)
 *   ── Round 14 (миграция 145) — корректировка платежей поставщикам ──
 *   suppliers_payments_correct ← suppliers.paymentsCorrect (сид Админ=false —
 *                                owner-only; manage НЕ влечёт)
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
  checks: [
    'create',
    'delete',
    'changeDatetime',
    'editClosed',
    'editPayment',
    'acceptPayment',
    'sellInstallment',
    'cashShifts',
    'board',
    'editAssignedOrder',
  ],
  services: ['view', 'manage'],
  warehouse: ['view', 'manage', 'delete', 'analytics'],
  suppliers: ['view', 'manage', 'paymentsCorrect'],
  equipment: ['view', 'manage', 'permanentDelete'],
  clients: ['view', 'edit', 'delete', 'debts'],
  schedule: ['view', 'manage'],
  bookings: ['view'],
  salary: ['payouts', 'premiums', 'motivation'],
  reports: ['view', 'profit', 'export'],
  expenses: ['add'],
  marketing: ['view', 'manage'],
  calls: ['view', 'listen'],
  employees: ['manage', 'approveProfile'],
  settings: ['manage', 'company'],
  knowledge: ['view', 'manage'],
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
  'settings',
  'knowledge',
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
  const marketingManage = readBool(matrix, 'marketing', 'manage');
  const knowledgeManage = readBool(matrix, 'knowledge', 'manage');

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
    // Round 14 (миграция 148, режим «Кассир»): менять СОСТАВ назначенного
    // заказа в конвейере (is_deferred + work_status). Миграция засеяла true
    // всем существующим ролям (презервация 1:1); отсутствие в новой роли —
    // fail-closed false, как у всех ячеек.
    checks_edit_assigned_order: readBool(matrix, 'checks', 'editAssignedOrder'),
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
    // Корректировка платежей поставщикам (миграция 145): сторно + возврат от
    // поставщика. ЯВНАЯ галка — manage НЕ влечёт (деньги правит только тот,
    // кому владелец включил ячейку; у системных ролей сид только у Директора).
    suppliers_payments_correct: readBool(matrix, 'suppliers', 'paymentsCorrect'),
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
    // Маркетинг — view (смотреть раздел) / manage (мутации: интеграции/площадки/
    // настройки/рассылки/alerts). manage ⇒ view.
    marketing_access: readBool(matrix, 'marketing', 'view') || marketingManage,
    marketing_manage: marketingManage,
    calls_view: readBool(matrix, 'calls', 'view'),
    calls_listen: readBool(matrix, 'calls', 'listen'),
    user_management: readBool(matrix, 'employees', 'manage'),
    // ── v3 (миграция 136) — новые ячейки перевода @Roles-гейтов на матрицу ──
    // Касса — кассовые смены (open/close/collect) и колонки доски.
    cash_shifts_manage: readBool(matrix, 'checks', 'cashShifts'),
    checks_board_manage: readBool(matrix, 'checks', 'board'),
    // CRM — удаление клиентов, долги/рассрочка, мутации расписания.
    clients_delete: readBool(matrix, 'clients', 'delete'),
    debts_manage: readBool(matrix, 'clients', 'debts'),
    schedule_manage: readBool(matrix, 'schedule', 'manage'),
    // Финансы — выплаты/штрафы (owner-only у системных ролей), премии, мотивация.
    salary_payouts_manage: readBool(matrix, 'salary', 'payouts'),
    salary_premiums_manage: readBool(matrix, 'salary', 'premiums'),
    motivation_manage: readBool(matrix, 'salary', 'motivation'),
    // Склад — аналитика (маржа/себестоимость).
    warehouse_analytics_view: readBool(matrix, 'warehouse', 'analytics'),
    // Имущество — безвозвратное удаление (owner-only у системных ролей).
    equipment_permanent_delete: readBool(matrix, 'equipment', 'permanentDelete'),
    // Управление — согласование заявок на смену профиля (owner-only у системных).
    employees_approve_profile: readBool(matrix, 'employees', 'approveProfile'),
    // Настройки — интеграции/касса/справочники и данные компании (owner-only).
    settings_manage: readBool(matrix, 'settings', 'manage'),
    company_manage: readBool(matrix, 'settings', 'company'),
    // База знаний — view (смотреть базу) / manage (мутации + менеджерские чтения:
    // категории/курсы/статьи/troubleshooting). manage ⇒ view.
    knowledge_view: readBool(matrix, 'knowledge', 'view') || knowledgeManage,
    knowledge_manage: knowledgeManage,
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
 * (superadmin/director) обходит гейты по строковой роли в userHasPermission,
 * поэтому пустая база им не мешает; admin живёт по матрице своей роли, а при
 * role_id NULL (аномалия после cutover 126) падает на ADMIN_PERMISSION_DEFAULTS
 * внутри userHasPermission — пустая карта его тоже не запирает.
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
