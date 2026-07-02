/**
 * roleMatrixEditor — редактор матрицы роли обязан покрывать каждый ключ
 * редактора ровно один раз (checks_view_all свёрнут в сегмент checks_view),
 * а конвертация драфт ↔ матрица должна быть без потерь и fail-closed.
 *
 * NB: runtime-импорт shared/types здесь невозможен (babel-jest не резолвит
 * @babel/runtime из-за пределов mobile/ — ни один тест его и не импортирует).
 * Сихрон со SHARED-словарём держит typecheck: CELL_KIND в модуле — Record над
 * полным union PermissionKey, новый ключ валит `npm run typecheck`. Тесты ниже
 * добивают полноту групп и семантику конвертеров. `import type` — стирается.
 */
import type { RoleMatrix } from '../../../../shared/types';
import {
  ALL_MATRIX_ROWS,
  EDITOR_PERMISSION_KEYS,
  MATRIX_GROUPS,
  SCOPE_PERMISSION_KEYS,
  countGranted,
  draftFromMatrix,
  emptyDraft,
  isRowGranted,
  matrixFromDraft,
  matrixSummary,
} from '../roleMatrixEditor';

describe('MATRIX_GROUPS — покрытие словаря редактора', () => {
  it('каждый ключ редактора представлен в группах ровно один раз', () => {
    const groupKeys = ALL_MATRIX_ROWS.map((r) => r.key);
    expect(new Set(groupKeys).size).toBe(groupKeys.length); // без дублей
    expect([...groupKeys].sort()).toEqual([...EDITOR_PERMISSION_KEYS].sort()); // полное покрытие
  });

  it('26 канонических ключей − свёрнутый checks_view_all = 25 строк редактора', () => {
    expect(ALL_MATRIX_ROWS).toHaveLength(25);
    expect(ALL_MATRIX_ROWS.some((r) => (r.key as string) === 'checks_view_all')).toBe(false);
  });

  it('scope-строки — ровно три ячейки охвата из role-matrix.ts', () => {
    const scopeRows = ALL_MATRIX_ROWS.filter((r) => r.kind === 'scope').map((r) => r.key);
    expect([...scopeRows].sort()).toEqual([...SCOPE_PERMISSION_KEYS].sort());
  });

  it('порядок и названия секций — из PERMISSION_GROUPS', () => {
    expect(MATRIX_GROUPS.map((g) => g.title)).toEqual(['Касса', 'Финансы', 'Склад', 'CRM', 'Управление']);
  });
});

describe('draftFromMatrix — fail-closed чтение', () => {
  it('пустая/отсутствующая матрица → всё запрещено', () => {
    const draft = draftFromMatrix(undefined);
    expect(draft.scopes).toEqual({ checks_view: 'none', checks_edit: 'none', salary_view: 'none' });
    expect(Object.values(draft.bools).every((v) => v === false)).toBe(true);
    expect(countGranted(draft, ALL_MATRIX_ROWS)).toBe(0);
  });

  it('испорченные значения читаются как none/false (не выдают прав)', () => {
    const dirty = {
      checks: { view: 'ALL', create: 'true', edit: 42 },
      warehouse: { view: 1 },
      salary: { view: null },
    } as unknown as RoleMatrix;
    const draft = draftFromMatrix(dirty);
    expect(draft.scopes.checks_view).toBe('none');
    expect(draft.scopes.checks_edit).toBe('none');
    expect(draft.scopes.salary_view).toBe('none');
    expect(draft.bools.checks_create).toBe(false);
    expect(draft.bools.warehouse_access).toBe(false);
  });

  it('валидная частичная матрица читается точно (охваты + тумблеры)', () => {
    const matrix: RoleMatrix = {
      checks: { view: 'own', create: true, edit: 'all' },
      salary: { view: 'all' },
      employees: { manage: true },
    };
    const draft = draftFromMatrix(matrix);
    expect(draft.scopes.checks_view).toBe('own');
    expect(draft.scopes.checks_edit).toBe('all');
    expect(draft.scopes.salary_view).toBe('all');
    expect(draft.bools.checks_create).toBe(true);
    expect(draft.bools.user_management).toBe(true);
    expect(draft.bools.checks_delete).toBe(false);
  });
});

describe('matrixFromDraft — полная материализация и roundtrip', () => {
  it('roundtrip: draftFromMatrix(matrixFromDraft(d)) === d', () => {
    const draft = emptyDraft();
    draft.scopes.checks_view = 'all';
    draft.scopes.checks_edit = 'own';
    draft.scopes.salary_view = 'own';
    draft.bools.checks_create = true;
    draft.bools.warehouse_access = true;
    draft.bools.calls_listen = true;
    draft.bools.user_management = true;
    expect(draftFromMatrix(matrixFromDraft(draft))).toEqual(draft);
  });

  it('каждая ячейка записана явно — PATCH заменяет матрицу без «дыр»', () => {
    const matrix = matrixFromDraft(emptyDraft());
    // Все 12 секций матрицы присутствуют, scope-ячейки материализованы.
    expect(Object.keys(matrix).sort()).toEqual(
      [
        'bookings',
        'calls',
        'checks',
        'clients',
        'employees',
        'expenses',
        'marketing',
        'reports',
        'salary',
        'schedule',
        'suppliers',
        'warehouse',
      ].sort(),
    );
    expect(matrix.checks?.view).toBe('none');
    expect(matrix.checks?.create).toBe(false);
    expect(matrix.salary?.view).toBe('none');
    expect(matrix.employees?.manage).toBe(false);
  });
});

describe('сводки', () => {
  it('isRowGranted: scope разрешён при own/all, тумблер — при true', () => {
    const draft = emptyDraft();
    draft.scopes.checks_view = 'own';
    draft.bools.clients_view = true;
    expect(isRowGranted(draft, { key: 'checks_view', kind: 'scope' })).toBe(true);
    expect(isRowGranted(draft, { key: 'salary_view', kind: 'scope' })).toBe(false);
    expect(isRowGranted(draft, { key: 'clients_view', kind: 'bool' })).toBe(true);
    expect(isRowGranted(draft, { key: 'calls_view', kind: 'bool' })).toBe(false);
  });

  it('matrixSummary: пустая матрица 0 из N, частичная считает точно', () => {
    expect(matrixSummary(undefined)).toEqual({ granted: 0, total: ALL_MATRIX_ROWS.length });
    const summary = matrixSummary({ checks: { view: 'all', create: true }, clients: { view: true } });
    expect(summary.granted).toBe(3);
  });
});
