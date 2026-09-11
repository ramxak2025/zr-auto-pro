const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

/**
 * ПРАВКА РАСХОДА (пакет «потеря данных», 2026-09).
 *
 * Класс бага: ручки правки не существовало, и мобильный экран изображал
 * «Изменить» парой запросов — DELETE, потом POST. Удаление физическое, поэтому
 * ЛЮБОЙ отказ второго запроса (нет права, чужой филиал, оборвалась связь)
 * стирал расход НАВСЕГДА. Тесты — статические стражи по исходникам (тестовой БД
 * в backend нет): проверяют, что
 *   1) PATCH /expenses/:id существует, закрыт OR-гейтом и объявлен так, что не
 *      перекрывает ':id/approve' и ':id/reject';
 *   2) правка — ОДИН UPDATE: ни DELETE, ни INSERT в пути update;
 *   3) неизменяемое остаётся неизменяемым (id, автор, источник, филиал);
 *   4) статус одобрения правкой не повышается, а дневной лимит считается БЕЗ
 *      самой правимой строки;
 *   5) клиент (shared + мобильный экран) больше не делает delete+create и
 *      показывает текст сервера.
 */

const read = (...p) => readFileSync(join(__dirname, '..', ...p), 'utf8');
const readRepo = (...p) => readFileSync(join(__dirname, '..', '..', ...p), 'utf8');

const service = read('src', 'expenses', 'expenses.service.ts');
const controller = read('src', 'expenses', 'expenses.controller.ts');
const sharedApi = readRepo('shared', 'api', 'createServices.ts');
const mobileScreen = readRepo('mobile', 'src', 'screens', 'ExpensesScreen.tsx');

/** Тело ExpensesService.update — от сигнатуры до следующего метода верхнего уровня. */
function updateBody() {
  const start = service.indexOf('async update(id: string, actor: JwtPayload, dto: any) {');
  assert.ok(start > 0, 'ExpensesService.update должен существовать');
  const end = service.indexOf('\n  async remove(', start);
  assert.ok(end > start, 'после update должен идти remove');
  return service.slice(start, end);
}

// ── 1. Маршрут и гейт ───────────────────────────────────────────────────────

test('контроллер отдаёт PATCH /expenses/:id', () => {
  assert.match(controller, /@Patch\(':id'\)\s+update\(/, 'нужен хэндлер PATCH :id');
  assert.match(controller, /this\.expensesService\.update\(id, user, dto\)/);
});

test("PATCH ':id' объявлен ПОСЛЕ ':id/approve' и ':id/reject'", () => {
  // Nest матчит маршруты в порядке объявления — порядок здесь часть контракта.
  const approve = controller.indexOf("@Patch(':id/approve')");
  const reject = controller.indexOf("@Patch(':id/reject')");
  const generic = controller.indexOf("@Patch(':id')\n  update(");
  assert.ok(approve > 0 && reject > 0 && generic > 0);
  assert.ok(generic > approve && generic > reject, "':id' должен идти после ':id/approve' и ':id/reject'");
});

test('правка закрыта OR-гейтом (вносящий расходы ИЛИ финансист)', () => {
  const start = controller.indexOf("@Patch(':id')\n  update(");
  const body = controller.slice(start, controller.indexOf('@Delete', start));
  assert.match(body, /userHasPermission\(user, 'can_add_expenses'\)/);
  assert.match(body, /userHasPermission\(user, 'financial_reports'\)/);
  assert.match(body, /throw new ForbiddenException/);
});

test('сервис дублирует гейт прав и ограничивает не-финансиста своими строками', () => {
  const body = updateBody();
  assert.match(body, /userHasPermission\(actor, 'financial_reports'\)/);
  assert.match(body, /userHasPermission\(actor, 'can_add_expenses'\)/);
  assert.match(body, /current\.created_by !== actor\.userID/, 'чужую строку правит только финансист');
});

// ── 2. Правка — это ОДИН UPDATE, а не удаление с пересозданием ──────────────

test('в пути правки нет ни DELETE, ни INSERT', () => {
  const body = updateBody();
  assert.doesNotMatch(body, /DELETE FROM expenses/i, 'правка не имеет права удалять строку');
  assert.doesNotMatch(body, /INSERT INTO expenses/i, 'правка не имеет права создавать новую строку');
  assert.match(body, /UPDATE expenses SET \$\{sets\.join\(', '\)\} WHERE id=\$\$\{idx\+\+\} AND tenant_id=\$\$\{idx\}/);
});

test('гейт филиала стоит до правки — чужой филиал получает 404', () => {
  const body = updateBody();
  assert.match(body, /await this\.assertOwnPoint\(id, tenantID, actor\)/);
});

test('синтетический id «Гарантия (убыток)» не доходит до SQL', () => {
  assert.match(updateBody(), /if \(!UUID_RE\.test\(id\)\) throw new NotFoundException/);
});

// ── 3. Что правка НЕ трогает ────────────────────────────────────────────────

test('автор, источник и филиал строки правкой не переписываются', () => {
  const body = updateBody();
  for (const column of ['created_by=', 'user_id=', 'source=', 'point_id=', 'tenant_id=']) {
    assert.ok(!body.includes(`sets.push(\`${column}`), `правка не должна менять ${column}`);
  }
});

test('зеркальный расход выплаты зарплаты правкой не трогается', () => {
  // Его сумма и дата обязаны совпадать со строкой выплаты
  // (salary_payouts.expense_id / salary_payments.expense_id). Сдвиг здесь дал бы
  // «выдано 30 000, из кассы ушло 3 000» без единого следа — тот же инвариант,
  // что защищает remove().
  const body = updateBody();
  assert.match(body, /FROM salary_payouts WHERE expense_id = \$1 AND tenant_id = \$2/);
  assert.match(body, /FROM salary_payments WHERE expense_id = \$1 AND tenant_id = \$2/);
  assert.match(body, /зеркальный расход выплаты зарплаты/);
});

// ── 4. Очередь одобрения ────────────────────────────────────────────────────

test('статус меняется только approved → pending (отклонённое правкой не «чинится»)', () => {
  const body = updateBody();
  assert.match(body, /currentStatus === 'approved'/, 'эскалация считается только от одобренной строки');
  assert.match(body, /nextStatus = 'pending'/);
  assert.ok(!/nextStatus = 'approved'/.test(body), 'правка не имеет права одобрять расход');
  assert.ok(!/nextStatus = 'rejected'/.test(body), 'правка не имеет права отклонять расход');
});

test('дневной лимит считается БЕЗ самой правимой строки', () => {
  // Иначе старая сумма учлась бы дважды и любая правка вниз всё равно уходила
  // бы в очередь на одобрение.
  assert.match(updateBody(), /AND id <> \$4/);
});

test('категория проверяется на принадлежность тенанту', () => {
  const body = updateBody();
  assert.match(body, /FROM expense_categories WHERE id = \$1 AND tenant_id = \$2/);
  assert.match(body, /Категория расходов не найдена/);
});

test('сумма валидируется теми же правилами, что в create', () => {
  const body = updateBody();
  assert.match(body, /Сумма должна быть положительной/);
  assert.match(body, /amount > 100_000_000/);
  assert.match(body, /Сумма слишком велика/);
});

test('побочки правки те же, что у create: сброс кэша отчётов + пуш', () => {
  const body = updateBody();
  assert.match(body, /invalidateReportsForTenant\(tenantID\)/);
  assert.match(body, /type: 'cash-changed'/);
});

// ── 5. Клиенты ──────────────────────────────────────────────────────────────

test('shared-контракт отдаёт expensesApi.update', () => {
  assert.match(sharedApi, /update: \(id: string, data: \{[^}]*\}\) =>\s*api\.patch\(`\/expenses\/\$\{id\}`, data\)/);
});

test('мобильный экран правит расход одним PATCH и показывает текст сервера', () => {
  const start = mobileScreen.indexOf('const editMutation = useMutation({');
  assert.ok(start > 0, 'editMutation должен существовать');
  const body = mobileScreen.slice(start, mobileScreen.indexOf('const deleteMutation', start));
  assert.match(body, /expensesApi\.update\(id, data\)/);
  assert.doesNotMatch(body, /expensesApi\.remove\(/, 'правка не имеет права удалять расход');
  assert.doesNotMatch(body, /expensesApi\.create\(/, 'правка не имеет права создавать расход заново');
  assert.match(body, /apiErrorMessage\(err\)/, 'причина отказа должна быть текстом сервера, а не немым сообщением');
});
