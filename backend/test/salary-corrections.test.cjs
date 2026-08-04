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
  // Round 16: paidAmount = acceptedPayoutsAmount + legacyPaidAmount; legacy-часть
  // по-прежнему исключает reversed (сторно восстанавливает долг сотруднику).
  assert.match(
    service,
    /legacyPaidAmount = masterPayments\.reduce\([\s\S]{0,120}?p\.reversedAt \? 0 : p\.amount/,
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

test('confirmPayment: INSERT подтверждения условный (guard от гонки со сторно)', () => {
  // Review п.6 — read-then-act по reversed_at без лока: между пре-чеком и
  // INSERT владелец мог сторнировать выплату. Авторитетный guard обязан жить
  // в самом INSERT (INSERT … SELECT … WHERE reversed_at IS NULL), а не только
  // в пре-чеке.
  assert.match(
    service,
    /INSERT INTO salary_payment_confirmations \(payment_id, user_id\)\s+SELECT sp\.id, \$2\s+FROM salary_payments sp\s+WHERE sp\.id = \$1 AND sp\.tenant_id = \$3 AND sp\.user_id = \$2\s+AND sp\.reversed_at IS NULL/,
    'подтверждение вставляется ТОЛЬКО при живой (не сторнированной) выплате',
  );
});

test('getAll.payments: reversed исключены + confirmed_at замаплен (compat старых сборок)', () => {
  // Review п.3 — старые сборки без reversedAt-guard зациклили бы confirm-модал
  // на сторнированной строке; серверный compat — не отдавать reversed в
  // getAll.payments (карточка месяца — getEmployeeMonth, web-история —
  // getPayments: там reversed остаются и рисуются зачёркнутыми).
  // Round 16: month_year IN (месяцы) заменён на periodMonthMembership, но
  // reversed_at IS NULL остаётся первым условием — сторно по-прежнему скрыто.
  assert.match(
    service,
    /sp\.reversed_at IS NULL\s+AND \$\{monthMember\('sp\.month_year', 'sp\.date'\)\}/,
    'сторнированные legacy-выплаты не должны попадать в getAll.payments',
  );
  // Pre-existing gap: без confirmed_at клиентский фильтр `!confirmedAt` был
  // истинным всегда — подтверждённая выплата всплывала модалом до конца месяца.
  assert.match(
    service,
    /confirmedAt: p\.confirmed_at \?\? null/,
    'getAll обязан отдавать confirmedAt по строкам payments',
  );
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

test('reversePayment: best-effort-матч расхода сужен по ИМЕНИ сотрудника', () => {
  // Review п.1 [деньги] — матч только по сумма+категория+±1с+'Зарплата:%' при
  // «ровно одном НЕВЕРНОМ кандидате» удалял расход ДРУГОГО сотрудника (свой
  // удалён руками раньше, а рядом зарплата соседа той же суммы). Описания
  // создаются как «Зарплата: <имя> …» (createPayment) — матч обязан включать
  // имя из уже прочитанной строки выплаты, с экранированием LIKE-спецсимволов.
  const body = service.slice(service.indexOf('async reversePayment'), service.indexOf('async updatePenalty'));
  assert.match(
    body,
    /e\.description LIKE 'Зарплата: ' \|\| \$4 \|\| '%'/,
    'префикс-матч описания обязан содержать имя сотрудника',
  );
  assert.match(
    body,
    /escapeLike\(payment\.user_name\)/,
    'имя в LIKE-шаблоне экранируется (иначе %/_ в имени — wildcard)',
  );
  assert.match(
    body,
    /else if \(payment\.user_name\)/,
    'без имени (сотрудник удалён) матч не выполняется → expenseCompensated=false',
  );
});

test('cancelPayout/reversePayment: один авторетрай FK-дедлока 40P01', () => {
  // Review п.5 — cancel/reverse vs ручное удаление того же расхода: DELETE
  // expenses в чужой транзакции ждёт наш лок (FK … ON DELETE SET NULL), мы —
  // его лок. Жертва 40P01 обязана ретраить всю транзакцию ровно один раз:
  // после отката FK уже обнулил expense_id → ретрай проходит с
  // expenseCompensated=false.
  const cancel = service.slice(service.indexOf('async cancelPayout'), service.indexOf('async updatePendingPayout'));
  assert.match(cancel, /'40P01'/, 'cancelPayout: ретрай дедлока');
  const reverse = service.slice(service.indexOf('async reversePayment'), service.indexOf('async updatePenalty'));
  assert.match(reverse, /'40P01'/, 'reversePayment: ретрай дедлока');
});

test('cancelPayout возвращает expenseCompensated (клиент показывает «проверьте Расходы»)', () => {
  const cancel = service.slice(service.indexOf('async cancelPayout'), service.indexOf('async updatePendingPayout'));
  assert.match(cancel, /return \{ \.\.\.this\.mapPayout\(result\), expenseCompensated \}/);
});

test('пуши отмены/сторно несут data.type для листенера мобильного контекста', () => {
  // Review п.2в — SalaryNotificationContext матчит push по data.type;
  // без него модал сотрудника не узнаёт об отмене, пока открыт.
  assert.match(service, /type: 'payout-cancelled'/);
  assert.match(service, /type: 'payment-reversed'/);
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
