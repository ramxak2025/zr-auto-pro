const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

/**
 * Round 15 (153) — стражи корректировок зарплаты (деньги).
 *
 * Класс багов: «отменили выплату, а сумма “выплачено” её всё ещё считает» —
 * сторно/отмена без исключения строки из ВСЕХ мест суммирования тихо врёт в
 * деньгах и не ловится ни typecheck, ни lint. Тесты — статические стражи по
 * исходникам (в backend нет тестовой БД): проверяют, что
 *   1) все суммы «выплачено» исключают reversed (legacy) и не-accepted
 *      (payouts — cancelled туда не попадает по построению);
 *   2) денежные корректировки транзакционны: адресный FOR UPDATE OF <alias>
 *      + идемпотентный guard статуса в UPDATE + транзакционный аудит logTx;
 *   3) новые endpoint'ы закрыты гейтом salary_payouts_manage;
 *   4) миграция 153 идемпотентна (guarded ADD COLUMN, статус 'cancelled'
 *      в пересозданном CHECK).
 */

const read = (...p) => readFileSync(join(__dirname, '..', ...p), 'utf8');

const service = read('src', 'salary', 'salary.service.ts');
const controller = read('src', 'salary', 'salary.controller.ts');
const migration = read('migrations', '153_salary_corrections.sql');

// ── 1. Суммы исключают отменённое/сторнированное ─────────────────────────────

test('getAll: paidAmount исключает сторнированные legacy-выплаты', () => {
  assert.match(
    service,
    /paidAmount = masterPayments\.reduce\([\s\S]{0,120}?p\.reversedAt \? 0 : p\.amount/,
    'getAll должен суммировать только не-reversed salary_payments',
  );
});

test('getEmployeeMonth: legacyPaidAmount исключает сторнированные выплаты', () => {
  assert.match(
    service,
    /legacyPaidAmount = payments\.reduce\([\s\S]{0,120}?p\.reversedAt \? 0 :/,
    'месячная карточка должна исключать reversed из «выплачено»',
  );
});

test('getEmployeeMonth: payouts считаются только со статусом accepted (cancelled исключён)', () => {
  assert.match(
    service,
    /acceptedPayoutsAmount = payouts\.reduce\([\s\S]{0,120}?p\.status === 'accepted'/,
    'суммируются только accepted-выплаты — cancelled/rejected/pending не считаются',
  );
});

test('mapPayout/маппинг платежей отдают поля отмены клиентам', () => {
  assert.match(service, /cancelledAt: r\.cancelled_at \?\? null/);
  assert.match(service, /cancelReason: r\.cancel_reason \?\? null/);
  assert.match(service, /reversedAt: (r|p)\.reversed_at \?\? null/);
});

test('confirmPayment отклоняет сторнированную выплату', () => {
  assert.match(service, /reversed_at/, 'confirmPayment должен читать reversed_at');
  assert.match(service, /Выплата отменена владельцем/);
});

// ── 2. Транзакционность и идемпотентность денежных путей ─────────────────────

test('cancelPayout: адресный лок, guard статуса, транзакционный аудит', () => {
  const body = service.slice(service.indexOf('async cancelPayout'), service.indexOf('async updatePendingPayout'));
  assert.match(body, /FOR UPDATE OF p/, 'лок строки выплаты — адресный (урок decidePayout)');
  assert.match(body, /status IN \('pending', 'accepted'\)/, 'UPDATE перепроверяет статус (идемпотентность)');
  assert.match(body, /logTx\(/, 'аудит пишется в ТОЙ ЖЕ транзакции');
  assert.match(body, /DELETE FROM expenses WHERE id = \$1 AND tenant_id = \$2/, 'сторно расхода tenant-scoped');
});

test('reversePayment: адресный лок, guard reversed_at, отказ при неоднозначном матче', () => {
  const body = service.slice(service.indexOf('async reversePayment'), service.indexOf('async updatePenalty'));
  assert.match(body, /FOR UPDATE OF sp/);
  assert.match(body, /reversed_at IS NULL\s+RETURNING/, 'UPDATE перепроверяет, что ещё не сторнирована');
  assert.match(body, /candidates\.length > 1/, 'больше одного кандидата-расхода → честный отказ, не угадываем');
  assert.match(body, /logTx\(/);
});

test('createPayment связывает выплату с расходом (expense_id) в одной транзакции', () => {
  assert.match(service, /UPDATE salary_payments SET expense_id = \$1 WHERE id = \$2/);
});

test('updatePenalty: правка штрафа с аудитом before/after', () => {
  const body = service.slice(service.indexOf('async updatePenalty'), service.indexOf('private mapPayout'));
  assert.match(body, /FOR UPDATE OF pen/);
  assert.match(body, /salary_penalty_update/);
});

// ── 3. Гейты новых endpoint'ов ───────────────────────────────────────────────

test('новые корректировочные маршруты закрыты salary_payouts_manage', () => {
  for (const route of [
    "@Post('payouts/:id/cancel')",
    "@Patch('payouts/:id')",
    "@Delete('payments/:id')",
    "@Patch('penalties/:id')",
  ]) {
    const idx = controller.indexOf(route);
    assert.ok(idx > 0, `маршрут ${route} должен существовать`);
    const before = controller.slice(Math.max(0, idx - 400), idx);
    assert.match(
      before,
      /@RequirePermission\('salary_payouts_manage'\)/,
      `${route} должен быть под salary_payouts_manage`,
    );
  }
});

// ── 4. Миграция 153 идемпотентна ─────────────────────────────────────────────

test('153: каждый ADD COLUMN защищён duplicate_column-guard', () => {
  const adds = migration.match(/ALTER TABLE \w+ ADD COLUMN/g) || [];
  const guarded = migration.match(/EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL/g) || [];
  assert.ok(adds.length >= 7, 'ожидаются колонки cancelled_* и reversed_*/expense_id');
  assert.ok(guarded.length >= adds.length, 'каждый ADD COLUMN обязан глотать duplicate_column');
});

test("153: CHECK статуса включает 'cancelled' и пересоздаётся идемпотентно", () => {
  assert.match(migration, /DROP CONSTRAINT IF EXISTS salary_payouts_status_check/);
  assert.match(migration, /CHECK \(status IN \('pending', 'accepted', 'rejected', 'cancelled'\)\)/);
  assert.match(migration, /EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_column THEN NULL/);
});
