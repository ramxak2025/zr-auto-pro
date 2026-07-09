/**
 * roleMatrixEditor — чистая (без React/RN и без runtime-импортов из shared/ —
 * тестируется под node-jest) логика редактора матрицы роли (Bitrix24-style,
 * миграция 114).
 *
 * Редактор ролей рисует ту же «простыню прав», что и матрица сотрудника в
 * UsersScreen: порядок секций и состав строк — зеркало канонического
 * PERMISSION_GROUPS (shared/types). Но роль хранит не плоские ключи, а матрицу
 * «секция × действие», где значение — либо охват ('none'|'own'|'all'), либо
 * boolean-тумблер. Таблица соответствия «PermissionKey → ячейка матрицы»
 * зафиксирована в backend/src/common/role-matrix.ts — этот модуль её повторяет:
 *
 *   • четыре scope-ячейки: checks.view (checks_view + checks_view_all),
 *     checks.edit (checks_edit + checks_edit_all), salary.view (salary_view +
 *     salary_view_all), reports.cashflow (cashflow_view + cashflow_view_all) —
 *     в UI сегмент [Нет | Свои | Все];
 *   • остальные ключи — boolean-тумблеры, 1:1 с ячейками.
 *
 * ВАЖНО: `checks_view_all`, `checks_edit_all`, `salary_view_all` и
 * `cashflow_view_all` НЕ являются отдельными строками редактора — это значение
 * 'all' сегментов checks.view / checks.edit / salary.view / reports.cashflow
 * (сервер флаттенит view/edit/cashflow==='all' → оба плоских ключа).
 *
 * Защита от дрейфа со shared (runtime-импорт shared/types под babel-jest
 * невозможен — @babel/runtime не резолвится из-за пределов mobile/, поэтому
 * ни один тест его и не импортирует):
 *   • CELL_KIND типизирован как Record<EditorPermissionKey, …> — новый ключ в
 *     union PermissionKey мгновенно валит `npm run typecheck`, пока редактор
 *     не узнает про новую ячейку;
 *   • ключи каждой группы типизированы срезом соответствующей shared-группы
 *     (EditorKeysOf<'Касса'> и т.д. через type-only `typeof import(…)`) —
 *     ключ в чужой группе не скомпилируется;
 *   • roleMatrixEditor.test.ts добивает остальное: полнота покрытия (каждый
 *     ключ ровно один раз), fail-closed чтение и roundtrip конвертеров.
 *
 * Чтение fail-closed — байт-в-байт семантика readScope/readBool на сервере:
 * отсутствующее/кривое значение читается как 'none'/false и никогда ничего
 * не ВЫДАЁТ.
 */
import type { PermissionKey, RoleMatrix, RoleScope } from '../../../shared/types';

// Type-only срез shared-модуля: `typeof import(…)` не порождает runtime
// require (babel стирает типы), но даёт настоящие литеральные типы групп.
type SharedTypesModule = typeof import('../../../shared/types');
type PermissionGroups = SharedTypesModule['PERMISSION_GROUPS'];

/** Название секции-аккордеона — ровно ключи PERMISSION_GROUPS. */
export type PermissionGroupTitle = keyof PermissionGroups;

/** Ключи, свёрнутые в 'all' scope-сегментов (не отдельные строки редактора). */
type CollapsedAllKey = 'checks_view_all' | 'checks_edit_all' | 'cashflow_view_all' | 'salary_view_all';

/** Ключи одной shared-группы за вычетом свёрнутых *_all-ключей. */
type EditorKeysOf<T extends PermissionGroupTitle> = Exclude<PermissionGroups[T][number], CollapsedAllKey>;

/** Ключи, чья ячейка — охват (сегмент [Нет | Свои | Все]). */
export type ScopePermissionKey = 'checks_view' | 'checks_edit' | 'salary_view' | 'cashflow_view';

/** Все ключи редактора (канонические минус свёрнутые *_all-ключи). */
export type EditorPermissionKey = Exclude<PermissionKey, CollapsedAllKey>;

/** Ключи-тумблеры (всё, что не охват). */
export type BoolPermissionKey = Exclude<EditorPermissionKey, ScopePermissionKey>;

export const SCOPE_PERMISSION_KEYS: readonly ScopePermissionKey[] = [
  'checks_view',
  'checks_edit',
  'salary_view',
  'cashflow_view',
];

/**
 * Русские подписи КАЖДОГО канонического PermissionKey (включая checks_view_all
 * и cashflow_view_all — они нужны плоской матрице сотрудника в UsersScreen;
 * редактор ролей их не рендерит, там это охват сегмента).
 * Один источник для UsersScreen и RoleEditorScreen: Record над полным union —
 * новый ключ в shared валит typecheck, пока подпись не добавлена.
 * Формулировки — «что сотрудник может ДЕЛАТЬ», чтобы владелец читал строку
 * как простое предложение.
 */
export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  // Касса
  checks_view: 'Видит чеки',
  checks_create: 'Создаёт чеки',
  checks_edit: 'Редактирует чеки',
  checks_delete: 'Удаляет чеки',
  checks_change_datetime: 'Меняет дату и время чека',
  checks_view_all: 'Видит чеки всех мастеров',
  checks_edit_all: 'Редактирует чужие чеки',
  payment_edit: 'Меняет оплату чека',
  accept_payment: 'Кассир смены (принимает оплату)',
  sell_installment: 'Продаёт в рассрочку',
  edit_closed_check: 'Редактирование проведённого чека',
  // Услуги
  services_view: 'Смотрит услуги и добавляет в чек',
  services_manage: 'Управляет каталогом услуг',
  // Финансы
  profit_view: 'Видит прибыль',
  financial_reports: 'Финансовые отчёты',
  export_data: 'Экспорт данных',
  cashflow_view: 'Движение денег: свои',
  cashflow_view_all: 'Движение денег: все',
  can_add_expenses: 'Вносит расходы',
  salary_view: 'Видит зарплаты',
  salary_view_all: 'Видит зарплаты всей команды',
  // Склад
  warehouse_access: 'Доступ к складу',
  warehouse_manage: 'Управляет складом (себестоимость, товары)',
  warehouse_delete: 'Удаление на складе',
  // Поставщики
  suppliers_access: 'Смотрит поставщиков',
  suppliers_manage: 'Управляет поставщиками и поставками',
  // Имущество
  equipment_view: 'Смотрит имущество',
  equipment_manage: 'Управляет имуществом',
  // CRM
  clients_view: 'Видит клиентов',
  clients_edit: 'Редактирует клиентов',
  schedule_view: 'Доступ к расписанию',
  bookings_access: 'Доступ к записям',
  marketing_access: 'Доступ к маркетингу',
  calls_view: 'Видит звонки',
  calls_listen: 'Слушает записи звонков',
  // Управление
  user_management: 'Управление пользователями',
};

/**
 * Вид контрола каждой ячейки. Record над ПОЛНЫМ union EditorPermissionKey —
 * компилятор требует ровно все ключи: появление нового PermissionKey в shared
 * валит typecheck до тех пор, пока редактор не опишет новую ячейку.
 */
const CELL_KIND: Record<EditorPermissionKey, 'scope' | 'bool'> = {
  // Касса
  checks_view: 'scope',
  checks_create: 'bool',
  checks_edit: 'scope',
  checks_delete: 'bool',
  checks_change_datetime: 'bool',
  payment_edit: 'bool',
  accept_payment: 'bool',
  sell_installment: 'bool',
  edit_closed_check: 'bool',
  // Услуги
  services_view: 'bool',
  services_manage: 'bool',
  // Финансы
  profit_view: 'bool',
  financial_reports: 'bool',
  export_data: 'bool',
  cashflow_view: 'scope',
  can_add_expenses: 'bool',
  salary_view: 'scope',
  // Склад
  warehouse_access: 'bool',
  warehouse_manage: 'bool',
  warehouse_delete: 'bool',
  // Поставщики
  suppliers_access: 'bool',
  suppliers_manage: 'bool',
  // Имущество
  equipment_view: 'bool',
  equipment_manage: 'bool',
  // CRM
  clients_view: 'bool',
  clients_edit: 'bool',
  schedule_view: 'bool',
  bookings_access: 'bool',
  marketing_access: 'bool',
  calls_view: 'bool',
  calls_listen: 'bool',
  // Управление
  user_management: 'bool',
};

/** Все ключи редактора (стабильный порядок CELL_KIND) — для сводок и тестов. */
export const EDITOR_PERMISSION_KEYS: readonly EditorPermissionKey[] = Object.keys(CELL_KIND) as EditorPermissionKey[];

/** Строка редактора: канонический ключ + вид контрола. */
export interface MatrixRowDef {
  key: EditorPermissionKey;
  kind: 'scope' | 'bool';
}

/** Секция-аккордеон редактора — группа PERMISSION_GROUPS с готовыми строками. */
export interface MatrixGroupDef {
  title: PermissionGroupTitle;
  rows: MatrixRowDef[];
}

/**
 * Порядок групп и порядок ключей внутри — зеркало PERMISSION_GROUPS
 * (Касса / Услуги / Финансы / Склад / Поставщики / Имущество / CRM /
 * Управление). Каждый массив типизирован срезом СВОЕЙ shared-группы: ключ из
 * чужой группы не скомпилируется.
 */
const GROUP_SPECS: readonly [
  { title: 'Касса'; keys: readonly EditorKeysOf<'Касса'>[] },
  { title: 'Услуги'; keys: readonly EditorKeysOf<'Услуги'>[] },
  { title: 'Финансы'; keys: readonly EditorKeysOf<'Финансы'>[] },
  { title: 'Склад'; keys: readonly EditorKeysOf<'Склад'>[] },
  { title: 'Поставщики'; keys: readonly EditorKeysOf<'Поставщики'>[] },
  { title: 'Имущество'; keys: readonly EditorKeysOf<'Имущество'>[] },
  { title: 'CRM'; keys: readonly EditorKeysOf<'CRM'>[] },
  { title: 'Управление'; keys: readonly EditorKeysOf<'Управление'>[] },
] = [
  {
    title: 'Касса',
    keys: [
      'checks_view',
      'checks_create',
      'checks_edit',
      'checks_delete',
      'checks_change_datetime',
      'payment_edit',
      'accept_payment',
      'sell_installment',
      'edit_closed_check',
    ],
  },
  { title: 'Услуги', keys: ['services_view', 'services_manage'] },
  {
    title: 'Финансы',
    keys: ['profit_view', 'financial_reports', 'export_data', 'cashflow_view', 'can_add_expenses', 'salary_view'],
  },
  { title: 'Склад', keys: ['warehouse_access', 'warehouse_manage', 'warehouse_delete'] },
  { title: 'Поставщики', keys: ['suppliers_access', 'suppliers_manage'] },
  { title: 'Имущество', keys: ['equipment_view', 'equipment_manage'] },
  {
    title: 'CRM',
    keys: [
      'clients_view',
      'clients_edit',
      'schedule_view',
      'bookings_access',
      'marketing_access',
      'calls_view',
      'calls_listen',
    ],
  },
  { title: 'Управление', keys: ['user_management'] },
];

/** Секции редактора, готовые к рендеру. */
export const MATRIX_GROUPS: readonly MatrixGroupDef[] = GROUP_SPECS.map((spec) => ({
  title: spec.title,
  rows: (spec.keys as readonly EditorPermissionKey[]).map((key) => ({ key, kind: CELL_KIND[key] })),
}));

/** Все строки редактора одной плоской пачкой (для сводок «X из Y»). */
export const ALL_MATRIX_ROWS: readonly MatrixRowDef[] = MATRIX_GROUPS.flatMap((g) => g.rows);

/**
 * Локальное состояние редактора: каждая ячейка матрицы под своим
 * PermissionKey. Полностью материализовано (все ячейки присутствуют явно) —
 * рендер детерминирован, а сохранение пишет полную матрицу без «дыр».
 */
export interface RoleMatrixDraft {
  scopes: Record<ScopePermissionKey, RoleScope>;
  bools: Record<BoolPermissionKey, boolean>;
}

// ── Чтение матрицы (fail-closed, зеркало backend readScope/readBool) ─────────

function readScope(value: unknown): RoleScope {
  return value === 'own' || value === 'all' ? value : 'none';
}

function readBool(value: unknown): boolean {
  return value === true;
}

/** Пустой драфт — всё запрещено ('none'/false), как flatten пустой матрицы. */
export function emptyDraft(): RoleMatrixDraft {
  return draftFromMatrix(undefined);
}

/**
 * Матрица (из GET /roles, jsonb — может быть частичной или испорченной) →
 * полностью материализованный драфт. Любое кривое значение → 'none'/false.
 */
export function draftFromMatrix(matrix: RoleMatrix | null | undefined): RoleMatrixDraft {
  const m = matrix ?? {};
  return {
    scopes: {
      checks_view: readScope(m.checks?.view),
      checks_edit: readScope(m.checks?.edit),
      salary_view: readScope(m.salary?.view),
      cashflow_view: readScope(m.reports?.cashflow),
    },
    bools: {
      checks_create: readBool(m.checks?.create),
      checks_delete: readBool(m.checks?.delete),
      checks_change_datetime: readBool(m.checks?.changeDatetime),
      edit_closed_check: readBool(m.checks?.editClosed),
      payment_edit: readBool(m.checks?.editPayment),
      accept_payment: readBool(m.checks?.acceptPayment),
      sell_installment: readBool(m.checks?.sellInstallment),
      services_view: readBool(m.services?.view),
      services_manage: readBool(m.services?.manage),
      warehouse_access: readBool(m.warehouse?.view),
      warehouse_manage: readBool(m.warehouse?.manage),
      warehouse_delete: readBool(m.warehouse?.delete),
      suppliers_access: readBool(m.suppliers?.view),
      suppliers_manage: readBool(m.suppliers?.manage),
      equipment_view: readBool(m.equipment?.view),
      equipment_manage: readBool(m.equipment?.manage),
      clients_view: readBool(m.clients?.view),
      clients_edit: readBool(m.clients?.edit),
      schedule_view: readBool(m.schedule?.view),
      bookings_access: readBool(m.bookings?.view),
      financial_reports: readBool(m.reports?.view),
      profit_view: readBool(m.reports?.profit),
      export_data: readBool(m.reports?.export),
      can_add_expenses: readBool(m.expenses?.add),
      marketing_access: readBool(m.marketing?.view),
      calls_view: readBool(m.calls?.view),
      calls_listen: readBool(m.calls?.listen),
      user_management: readBool(m.employees?.manage),
    },
  };
}

/**
 * Драфт → полная матрица для POST/PATCH /roles. Каждая ячейка записана явно
 * (никаких отсутствующих действий): PATCH заменяет матрицу целиком, и то, что
 * владелец видит на экране, и есть ровно то, что сохранится.
 */
export function matrixFromDraft(draft: RoleMatrixDraft): RoleMatrix {
  const { scopes: s, bools: b } = draft;
  return {
    checks: {
      view: s.checks_view,
      create: b.checks_create,
      edit: s.checks_edit,
      delete: b.checks_delete,
      changeDatetime: b.checks_change_datetime,
      editClosed: b.edit_closed_check,
      editPayment: b.payment_edit,
      acceptPayment: b.accept_payment,
      sellInstallment: b.sell_installment,
    },
    services: { view: b.services_view, manage: b.services_manage },
    warehouse: { view: b.warehouse_access, manage: b.warehouse_manage, delete: b.warehouse_delete },
    suppliers: { view: b.suppliers_access, manage: b.suppliers_manage },
    equipment: { view: b.equipment_view, manage: b.equipment_manage },
    clients: { view: b.clients_view, edit: b.clients_edit },
    schedule: { view: b.schedule_view },
    bookings: { view: b.bookings_access },
    salary: { view: s.salary_view },
    reports: { view: b.financial_reports, profit: b.profit_view, export: b.export_data, cashflow: s.cashflow_view },
    expenses: { add: b.can_add_expenses },
    marketing: { view: b.marketing_access },
    calls: { view: b.calls_view, listen: b.calls_listen },
    employees: { manage: b.user_management },
  };
}

/** Значение строки редактора «разрешено?»: scope !== 'none' или тумблер true. */
export function isRowGranted(draft: RoleMatrixDraft, row: MatrixRowDef): boolean {
  return row.kind === 'scope'
    ? draft.scopes[row.key as ScopePermissionKey] !== 'none'
    : draft.bools[row.key as BoolPermissionKey] === true;
}

/** Сколько строк из набора разрешено (сводка секции-аккордеона). */
export function countGranted(draft: RoleMatrixDraft, rows: readonly MatrixRowDef[]): number {
  return rows.reduce((acc, row) => acc + (isRowGranted(draft, row) ? 1 : 0), 0);
}

/** Сводка всей матрицы для карточки роли: «Разрешено X из Y». */
export function matrixSummary(matrix: RoleMatrix | null | undefined): { granted: number; total: number } {
  const draft = draftFromMatrix(matrix);
  return { granted: countGranted(draft, ALL_MATRIX_ROWS), total: ALL_MATRIX_ROWS.length };
}
