const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

/**
 * Правка №3 (2026-09-30) — «Зарплата и отчёты по месяцам».
 *
 * РЕШЕНИЕ ВЛАДЕЛЬЦА. Выплата зарплаты, выданная в октябре «за сентябрь»
 * (salary_payouts.period_month = '2026-09'), в ОТЧЁТАХ — «По зарплатам»,
 * «Сводный», «По расходам» — стоит в СЕНТЯБРЕ, а в КАССЕ — «Движение денег»,
 * лента расходов (attribution=date по умолчанию), кассовая смена, Z-отчёт —
 * остаётся в ОКТЯБРЕ, по дате факта. Финансовый отчёт и dashboard-v2 УЖЕ считали
 * по назначенному месяцу и не менялись.
 *
 * Оговорка по факту кода: «Движение денег» после Волны G (2026-07) оттоков не показывает
 * вообще (только нал/карта/рассрочка/возвраты, тест A «касса и финансовый отчёт» это
 * стережёт), поэтому кассой «по факту» для выплаты на деле служат лента расходов и смена.
 *
 * Файл доказывает это тремя слоями:
 *   A. Статика + чистые функции общего helper-а common/period-membership.ts:
 *      кто на нём считает, а кто нарочно нет (касса, финотчёт).
 *   B. Сервисы из сборки (dist) на фейковом пуле-маршрутизаторе: createPayout /
 *      createPayment / carryOver / attribution / замок period_month у зеркал.
 *   C. Билдеры отчётов на том же пуле: тот самый SQL-предикат, те самые params.
 *   D. LIVE (только при SALARY_LIVE_DB — МИГРИРОВАННАЯ БД приложения, роль без RLS):
 *      реплей тех же сервисов и билдеров на настоящем Postgres в одной откатываемой
 *      транзакции — выплата за прошлый месяц, выданная сегодня, попадает в отчёты
 *      прошлого месяца и в ленту (кассу) текущего; в БД после прогона ничего нет.
 *
 * Как и остальные тесты backend, работает на `node --test` без jest; сборка dist
 * обязательна (`npm test` = build + node --test).
 */

const read = (...p) => readFileSync(join(__dirname, '..', ...p), 'utf8');
const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
/** Срез исходника от маркера `from` до маркера `to` (или до конца), с проверкой что оба нашлись. */
const between = (src, from, to) => {
  const a = src.indexOf(from);
  assert.notEqual(a, -1, `не найден маркер «${from}»`);
  if (to === undefined) return src.slice(a);
  const b = src.indexOf(to, a + from.length);
  assert.notEqual(b, -1, `не найден маркер «${to}»`);
  return src.slice(a, b);
};

const {
  MONTH_KEY_RE,
  effectiveMonthMembershipSql,
  periodPredicate,
  isMonthKey,
  shiftMonthKey,
  monthKeysBefore,
} = require('../dist/common/period-membership');
const { zonedMonthKey } = require('../dist/common/timezone');

// Ожидаемые месяцы считаем ОТ РЕАЛЬНЫХ ЧАСОВ теми же функциями, что и сервис: тест не
// зависит от даты запуска, а Date-мок нужен только там, где важна граница пояса.
const CUR = zonedMonthKey(new Date(), 'Europe/Moscow');
const PREV = shiftMonthKey(CUR, -1);
const NEXT = shiftMonthKey(CUR, 1);

// ── Исходники для статических стражей ────────────────────────────────────────
const salaryServiceSrc = read('src', 'salary', 'salary.service.ts');
const expensesServiceSrc = read('src', 'expenses', 'expenses.service.ts');
const salaryBuilderSrc = read('src', 'reports', 'builder', 'builders', 'salary.builder.ts');
const expensesBuilderSrc = read('src', 'reports', 'builder', 'builders', 'expenses.builder.ts');
const summaryBuilderSrc = read('src', 'reports', 'builder', 'builders', 'summary.builder.ts');
const paymentsBuilderSrc = read('src', 'reports', 'builder', 'builders', 'payments.builder.ts');
const sharedQueriesSrc = read('src', 'reports', 'builder', 'report-shared-queries.ts');
const reportsServiceSrc = read('src', 'reports', 'reports.service.ts');
const cashShiftsSrc = read('src', 'cash-shifts', 'cash-shifts.service.ts');

// ═════════════════════════════════════════════════════════════════════════════
// A. Общий helper и статические стражи
// ═════════════════════════════════════════════════════════════════════════════

test('A: isMonthKey принимает только YYYY-MM с месяцем 01-12', () => {
  for (const ok of ['2026-01', '2026-09', '2026-12', '1999-10']) assert.equal(isMonthKey(ok), true, ok);
  for (const bad of ['2026-13', '2026-00', '2026-9', '2026-09-01', '26-09', '', ' 2026-09', '2026-09 ']) {
    assert.equal(isMonthKey(bad), false, `«${bad}» не месяц`);
  }
  for (const notString of [null, undefined, 202609, {}, [], ['2026-09']]) {
    assert.equal(isMonthKey(notString), false, `${JSON.stringify(notString)} не строка`);
  }
  // Тот же регэксп используют DTO (class-validator @Matches) — единый источник правды.
  assert.equal(MONTH_KEY_RE.test('2026-13'), false);
  assert.equal(MONTH_KEY_RE.test('2026-12'), true);
});

test('A: shiftMonthKey и monthKeysBefore — арифметика месяцев через границу года', () => {
  assert.equal(shiftMonthKey('2026-01', -1), '2025-12');
  assert.equal(shiftMonthKey('2026-12', 1), '2027-01');
  assert.equal(shiftMonthKey('2026-09', -12), '2025-09');
  assert.equal(shiftMonthKey('2026-09', 0), '2026-09');
  assert.deepEqual(monthKeysBefore('2026-03', 2), ['2026-02', '2026-01']);
  assert.deepEqual(monthKeysBefore('2026-01', 2), ['2025-12', '2025-11']);
  const window = monthKeysBefore('2026-09', 12);
  assert.equal(window.length, 12, 'окно остатков — ровно 12 месяцев');
  assert.equal(window[0], '2026-08', 'ближайший месяц первым');
  assert.equal(window[11], '2025-09', 'самый дальний — последним');
  assert.ok(!window.includes('2026-09'), 'сам месяц окна в него не входит');
});

test('A: helper — пояс приходит плейсхолдером, литерала пояса в SQL нет', () => {
  const sql = effectiveMonthMembershipSql('p.period_month', 'p.created_at', '2026-08-01', '2026-08-31', '$4::text');
  assert.match(sql, /now\(\) AT TIME ZONE \$4::text/, 'сегодня — в поясе тенанта, параметром');
  assert.match(sql, /\$2::date::timestamp AT TIME ZONE \$4::text/, 'нижняя граница дня — в поясе тенанта');
  assert.match(sql, /\(\$3::date \+ 1\)::timestamp AT TIME ZONE \$4::text/, 'верхняя граница дня — в поясе тенанта');
  assert.doesNotMatch(sql, /AT TIME ZONE '/, 'склейка пояса в SQL недопустима (инъекция) — только параметр');
  assert.doesNotMatch(sql, /Europe\//, 'зашитого региона нет');
  // Обе колонки участвуют: назначенный месяц и дата факта.
  assert.match(sql, /p\.period_month ~ /, 'рукав «назначенный месяц»');
  assert.match(sql, /p\.created_at >= /, 'рукав «по дате факта»');
  // Строгий диапазон месяцев 01-12: '2026-13' не должен ронять to_date, а уходить в рукав факта.
  assert.match(sql, /\(0\[1-9\]\|1\[0-2\]\)/, 'guard месяца 01-12 внутри SQL');
});

test('A: helper — собственные плейсхолдеры границ и пояса (лента расходов, динамическая нумерация)', () => {
  const sql = effectiveMonthMembershipSql('e.period_month', 'e.date', '2026-08-01', '2026-08-31', '$9::text', {
    from: '$7',
    to: '$8',
  });
  assert.match(sql, /\$7::date/, 'нижняя граница — $7');
  assert.match(sql, /\$8::date/, 'верхняя граница — $8');
  assert.match(sql, /\$9::text/, 'пояс — $9');
  assert.doesNotMatch(sql, /\$2|\$3|\$4/, 'дефолтные $2/$3/$4 не просачиваются');
});

test('A: periodPredicate — дни трактуются как местные сутки; при не-дневных границах пояс-параметр всё равно упомянут', () => {
  const day = periodPredicate('x.at', '2026-08-01', '2026-08-31', '$4::text');
  assert.equal(
    norm(day),
    'x.at >= $2::date::timestamp AT TIME ZONE $4::text AND x.at < ($3::date + 1)::timestamp AT TIME ZONE $4::text',
  );
  // Полный ISO-timestamp: AT TIME ZONE не нужен, но Postgres отвергает параметр, на который нет ссылки.
  const iso = periodPredicate('x.at', '2026-08-01T00:00:00.000Z', '2026-08-31T23:59:59.999Z', '$4::text');
  assert.match(iso, /\$4::text IS NOT NULL/, 'якорь плейсхолдера пояса');
  assert.doesNotMatch(iso, /AT TIME ZONE/);
});

test('A: salary.service — экран «Зарплата» считает тем же helper-ом; будущая выплата и carryOver закреплены в коде', () => {
  assert.match(salaryServiceSrc, /from '\.\.\/common\/period-membership'/);
  assert.doesNotMatch(salaryServiceSrc, /private static periodMonthMembership/, 'копии предиката нет');
  // carryOver: общий расчёт для списка и карточки.
  assert.match(salaryServiceSrc, /carryOverRemainders\(/, 'общий расчёт остатков прошлых месяцев');
  assert.match(salaryServiceSrc, /carryOverAmount/, 'MasterSalary.carryOverAmount');
  // getEmployeeMonth — последний метод класса, поэтому срез идёт до конца файла.
  const employeeMonth = between(salaryServiceSrc, 'async getEmployeeMonth(');
  assert.match(employeeMonth, /carryOverRemainders\(tenantID, \[employeeId\], monthYear, tz, pointId\)/);
  assert.match(employeeMonth, /const carryOver = \{/, 'SalaryMonthDetail.carryOver собирается всегда');
  assert.match(employeeMonth, /\n {6}carryOver,\n {4}\};/, 'и входит в ответ карточки месяца');
});

test('A: createPayout и createPayment пишут period_month (не NULL, не пусто)', () => {
  const createPayout = between(salaryServiceSrc, 'async createPayout(', '\n  /**');
  assert.match(createPayout, /zonedMonthKey\(new Date\(\), tz\)/, 'по умолчанию — месяц факта в поясе тенанта');
  assert.match(createPayout, /requested > currentMonth/, 'месяц позже текущего — 400');
  assert.match(createPayout, /!isMonthKey\(requested\)/, 'мусорный месяц — 400, а не 500 от CHECK');
  assert.match(createPayout, /periodMonth,\s+pointId: pointId,/, 'месяц уходит в зеркальный расход');
  const createPayment = between(salaryServiceSrc, 'async createPayment(', '\n  /**');
  assert.match(
    createPayment,
    /INSERT INTO expenses \(category_id, amount, description, date, user_id, tenant_id, point_id, period_month\)/,
    'зеркальный расход legacy-платежа несёт period_month',
  );
  assert.match(
    createPayment,
    /payment\.date, createdBy, tenantID, pointId, dto\.monthYear\]/,
    'period_month = month_year платежа',
  );
});

test('A: отчёты «По зарплатам»/«Сводный»/«По расходам» считают выплату по месяцу «за который» — общим helper-ом', () => {
  // «По зарплатам»: выплаты, legacy-платежи и премии — helper; штрафы своей датой.
  assert.match(salaryBuilderSrc, /effectiveMonthMembershipSql\(/);
  assert.match(salaryBuilderSrc, /member\('p\.period_month', 'p\.created_at'\)/);
  assert.match(salaryBuilderSrc, /member\('sp\.month_year', 'sp\.date'\)/);
  assert.match(salaryBuilderSrc, /member\('pr\.period_month_year', 'pr\.created_at'\)/);
  assert.match(salaryBuilderSrc, /inPeriod\('pen\.date'\)/, 'штраф — по своей дате');
  for (const stale of [/inPeriod\('p\.created_at'\)/, /inPeriod\('sp\.date'\)/, /inPeriod\('pr\.created_at'\)/]) {
    assert.doesNotMatch(salaryBuilderSrc, stale, 'прежний предикат «по дате факта» удалён');
  }
  // «Сводный»: KPI «Зарплата выплачено» = salaryPaidTotal; сам билдер сводного не менялся.
  const paidTotal = between(sharedQueriesSrc, 'export async function salaryPaidTotal', '\n/**');
  assert.match(paidTotal, /effectiveMonthMembershipSql\(/);
  assert.match(paidTotal, /member\('p\.period_month', 'p\.created_at'\)/);
  assert.match(paidTotal, /member\('sp\.month_year', 'sp\.date'\)/);
  assert.match(summaryBuilderSrc, /salaryPaidTotal\(this\.pool, ctx\)/, 'сводный берёт выплаты из общего запроса');
  // «По расходам»: расходы — helper; гарантийные убытки и выручка — по дате чека.
  assert.match(expensesBuilderSrc, /effectiveMonthMembershipSql\('e\.period_month', 'e\.date'/);
  assert.doesNotMatch(expensesBuilderSrc, /expenseMembership\(/, 'строгий предикат финотчёта здесь больше не нужен');
  assert.match(expensesBuilderSrc, /inPeriod\('ch\.date'\)/, 'гарантия и выручка — по дате чека');
});

test('A: касса и финансовый отчёт НЕ переехали на helper — по факту / по своему строгому правилу', () => {
  // Финотчёт и dashboard-v2 (reports.service.ts) владелец не трогал: у них своё строгое отнесение.
  assert.doesNotMatch(reportsServiceSrc, /period-membership/, 'reports.service.ts helper не подключает');
  // «Движение денег» — простой вид: ни расходов, ни выплат, ни period_month.
  const cashFlow = between(reportsServiceSrc, 'async getCashFlow(', 'private async getWallets(');
  for (const token of [/period_month/, /salary_payouts/, /salary_payments/, /FROM expenses/]) {
    assert.doesNotMatch(cashFlow, token, `getCashFlow не должен читать ${token}`);
  }
  // Кассовая смена: расходы смены — по дате факта, без period_month.
  assert.match(
    cashShiftsSrc,
    /FROM expenses\s+WHERE tenant_id = \$1\s+AND COALESCE\(approval_status, 'approved'\) = 'approved'\s+AND date >= \$2 AND date <= \$3\$\{expPoint\}/,
    'расходы смены — по дате факта',
  );
  assert.doesNotMatch(cashShiftsSrc, /period_month/, 'смена не знает про period_month');
  assert.doesNotMatch(cashShiftsSrc, /period-membership/);
  // «Платежи» — без расходов вовсе.
  assert.doesNotMatch(paymentsBuilderSrc, /period-membership/);
  // Строгое правило финотчёта осталось на otherExpensesTotal (KPI «Прочие расходы» сводного).
  const other = between(sharedQueriesSrc, 'export async function otherExpensesTotal', '\n/**');
  assert.match(other, /expenseMembership\('e'\)/, 'прочие расходы — прежнее строгое правило финотчёта');
});

test('A: лента расходов — attribution и periodMonth объявлены, замок period_month виден в исходнике', () => {
  assert.match(expensesServiceSrc, /parseAttribution\(query\.attribution\)/);
  assert.match(expensesServiceSrc, /attribution должен быть date или period/);
  assert.match(expensesServiceSrc, /periodMonth должен быть в формате YYYY-MM или null/);
  assert.match(expensesServiceSrc, /isSalaryCategory\(/, 'категория «Зарплата» заперта');
  assert.match(expensesServiceSrc, /Месяц расхода выплаты зарплаты задаётся самой выплатой/);
  const create = between(expensesServiceSrc, 'async create(', '\n  async update(');
  assert.match(create, /point_id, period_month\)\s+VALUES \(\$1, \$2, \$3, \$4, \$5, \$6, \$7, \$8, \$9, \$10, \$11\)/);
});

// ═════════════════════════════════════════════════════════════════════════════
// B. Сервисы из сборки (dist) на фейковом пуле-маршрутизаторе
// ═════════════════════════════════════════════════════════════════════════════

const { SalaryService } = require('../dist/salary/salary.service');
const { ExpensesService } = require('../dist/expenses/expenses.service');

/**
 * Пул-маршрутизатор. SQL сопоставляется с маршрутами (подстрока или регэксп, по
 * нормализованным пробелам), отвечает ПЕРВЫЙ совпавший. Запрос, для которого маршрута
 * нет, — ошибка теста: сервис не может «незаметно» сходить в БД туда, куда мы не
 * ожидали. Журнал хранит всё, что ушло в пул или в клиент транзакции, с параметрами.
 */
function makePool(routes) {
  const log = [];
  const run = async (sql, params) => {
    const text = norm(sql);
    const args = params ?? [];
    log.push({ sql: text, params: args });
    for (const route of routes) {
      const hit = typeof route.match === 'string' ? text.includes(route.match) : route.match.test(text);
      if (!hit) continue;
      const rows = typeof route.rows === 'function' ? route.rows(text, args) : route.rows;
      return { rows: rows ?? [], rowCount: (rows ?? []).length };
    }
    throw new Error(`unrouted SQL: ${text.slice(0, 240)}`);
  };
  return { log, query: run, connect: async () => ({ query: run, release() {} }) };
}

const TX = { match: /^(BEGIN|COMMIT|ROLLBACK)$/, rows: [] };
const tzRoute = (tz) => ({ match: 'FROM tenants', rows: [{ timezone: tz }] });

let tenantSeq = 0;
/** Пояс тенанта кэшируется на 5 минут по tenantID — каждому сценарию свой тенант, чтобы кэш их не склеивал. */
const nextTenant = () => `tenant-a3-${process.pid}-${++tenantSeq}`;

const responseText = (e) => {
  const body = typeof e?.getResponse === 'function' ? e.getResponse() : null;
  return typeof body === 'string' ? body : String(body?.message ?? e?.message ?? '');
};
/** Предикат для assert.rejects: HTTP-статус и фрагмент текста ошибки. */
const httpError = (status, re) => (e) => {
  const actual = typeof e?.getStatus === 'function' ? e.getStatus() : null;
  assert.equal(actual, status, `ожидался HTTP ${status}, пришло: ${e?.message}`);
  assert.match(responseText(e), re);
  return true;
};
const wroteToDb = (pool) => pool.log.some((q) => q.sql === 'BEGIN' || /^(INSERT|UPDATE|DELETE)\b/.test(q.sql));

/** SalaryService с заглушками соседей. `mirrors` — вызовы зеркального расхода выплаты. */
function salaryHarness(routes, tz = 'Europe/Moscow') {
  const pool = makePool([TX, tzRoute(tz), ...routes]);
  const mirrors = [];
  const expenses = {
    recordSalaryExpense: async (tenantID, data, executor) => {
      mirrors.push({ tenantID, data, inTransaction: executor !== pool });
      return { id: 'exp-1' };
    },
  };
  const push = { sendDataToTenant: () => Promise.resolve(), sendToUserInTenant: () => {} };
  const schedule = { buildShiftFilter: async () => null };
  const service = new SalaryService(pool, push, expenses, schedule, {});
  return { service, pool, mirrors };
}

/** Маршруты createPayout: сотрудник тенанта, INSERT выплаты и UPDATE expense_id возвращают строку целиком. */
function payoutRoutes(employeeName = 'Мастер Иван') {
  let row = null;
  return [
    { match: 'SELECT full_name FROM users', rows: [{ full_name: employeeName }] },
    {
      match: 'INSERT INTO salary_payouts',
      rows: (sql, p) => {
        row = {
          id: 'po-1',
          tenant_id: p[0],
          employee_id: p[1],
          type: p[2],
          amount: p[3],
          status: 'accepted',
          comment: p[4],
          created_by: p[5],
          period_month: p[6],
          point_id: p[7],
          created_at: new Date(),
          decided_at: new Date(),
          expense_id: null,
        };
        return [row];
      },
    },
    {
      match: 'UPDATE salary_payouts SET expense_id',
      rows: (sql, p) => {
        row = { ...row, expense_id: p[2] };
        return [row];
      },
    },
  ];
}

const DIRECTOR_PAYOUT = { employeeId: 'emp-1', type: 'salary', amount: 30000 };

test('B: createPayout без periodMonth — месяц ФАКТА в поясе тенанта, не NULL; тот же месяц уходит в зеркальный расход', async () => {
  const { service, pool, mirrors } = salaryHarness(payoutRoutes());
  const res = await service.createPayout(nextTenant(), 'dir-1', { ...DIRECTOR_PAYOUT });
  const insert = pool.log.find((q) => q.sql.includes('INSERT INTO salary_payouts'));
  assert.ok(insert, 'выплата записана');
  assert.match(insert.sql, /period_month, decided_at, point_id\)/, 'INSERT несёт period_month');
  assert.equal(insert.params[6], CUR, 'period_month по умолчанию = месяц факта');
  assert.notEqual(insert.params[6], null, 'NULL больше не пишем');
  assert.equal(mirrors.length, 1, 'ровно один зеркальный расход');
  assert.equal(mirrors[0].data.periodMonth, CUR, 'расход живёт в том же месяце, что и выплата');
  assert.equal(mirrors[0].inTransaction, true, 'расход пишется тем же клиентом транзакции, не пулом');
  assert.equal(res.periodMonth, CUR, 'ответ отдаёт месяц выплаты');
  assert.equal(res.amount, 30000);
  assert.equal(res.expenseId, 'exp-1');
  const order = pool.log.map((q) => q.sql.split(' ')[0]);
  assert.ok(order.indexOf('BEGIN') < order.indexOf('INSERT') && order.lastIndexOf('COMMIT') > order.indexOf('UPDATE'));
});

test('B: createPayout за ПРОШЛЫЙ месяц — period_month прошлый, а дата зеркального расхода = момент выдачи (касса по факту)', async () => {
  const { service, pool, mirrors } = salaryHarness(payoutRoutes());
  const before = Date.now();
  const res = await service.createPayout(nextTenant(), 'dir-1', { ...DIRECTOR_PAYOUT, periodMonth: PREV });
  const after = Date.now();
  const insert = pool.log.find((q) => q.sql.includes('INSERT INTO salary_payouts'));
  assert.equal(insert.params[6], PREV, 'выплата назначена прошлому месяцу');
  assert.equal(mirrors[0].data.periodMonth, PREV, 'зеркальный расход несёт тот же месяц «за который»');
  // ГЛАВНОЕ для кассы: дата расхода — сейчас, а не 1-е число прошлого месяца. Касса (лента
  // расходов, смена) режет по date, поэтому деньги остаются в текущем месяце.
  const at = Date.parse(mirrors[0].data.date);
  assert.ok(at >= before && at <= after + 1000, `date расхода = момент выдачи (${mirrors[0].data.date})`);
  assert.equal(res.periodMonth, PREV);
});

test('B: createPayout — месяц позже текущего это 400 (до BEGIN и до INSERT)', async () => {
  const { service, pool, mirrors } = salaryHarness(payoutRoutes());
  await assert.rejects(
    () => service.createPayout(nextTenant(), 'dir-1', { ...DIRECTOR_PAYOUT, periodMonth: NEXT }),
    httpError(400, /ещё не наступил/),
  );
  assert.equal(wroteToDb(pool), false, 'ни BEGIN, ни INSERT: отказ раньше любой записи');
  assert.equal(mirrors.length, 0, 'расход не создан');
  // Текущий месяц — можно, прошлый — можно.
  for (const ok of [CUR, PREV]) {
    const harness = salaryHarness(payoutRoutes());
    const res = await harness.service.createPayout(nextTenant(), 'dir-1', { ...DIRECTOR_PAYOUT, periodMonth: ok });
    assert.equal(res.periodMonth, ok);
  }
});

test('B: createPayout — мусорный periodMonth это 400, а не 500 от CHECK/to_date', async () => {
  for (const bad of ['2026-13', '2026-00', '2026-9', 'август', '2026-09-01', '26-09', 202609]) {
    const { service, pool } = salaryHarness(payoutRoutes());
    await assert.rejects(
      () => service.createPayout(nextTenant(), 'dir-1', { ...DIRECTOR_PAYOUT, periodMonth: bad }),
      httpError(400, /формате ГГГГ-ММ/),
      `«${String(bad)}»`,
    );
    assert.equal(wroteToDb(pool), false, `«${String(bad)}»: записи нет`);
  }
});

test('B: createPayout — пустая строка / null / пробелы = «не передан» (месяц факта)', async () => {
  for (const blank of ['', null, '   ', undefined]) {
    const { service, pool } = salaryHarness(payoutRoutes());
    const res = await service.createPayout(nextTenant(), 'dir-1', { ...DIRECTOR_PAYOUT, periodMonth: blank });
    assert.equal(res.periodMonth, CUR, `«${String(blank)}» → месяц факта`);
    assert.equal(pool.log.find((q) => q.sql.includes('INSERT INTO salary_payouts')).params[6], CUR);
  }
});

test('B: createPayout — «месяц факта» и «ещё не наступил» считаются в поясе ТЕНАНТА (граница месяца)', async (t) => {
  // 30.09 21:30 UTC: в Москве уже 1 октября 00:30, в Калининграде ещё 30 сентября 23:30,
  // во Владивостоке 1 октября 07:30. Date-мок нужен именно здесь: только на границе видно,
  // что месяц берётся в поясе тенанта, а не в поясе сервера или в UTC.
  try {
    t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-30T21:30:00.000Z') });
  } catch (err) {
    t.skip(`Date-мок недоступен в Node ${process.version}: ${err.message}`);
    return;
  }
  const cases = [
    ['Europe/Moscow', '2026-10'],
    ['Europe/Kaliningrad', '2026-09'],
    ['Asia/Vladivostok', '2026-10'],
  ];
  for (const [tz, expected] of cases) {
    const { service, pool, mirrors } = salaryHarness(payoutRoutes(), tz);
    const res = await service.createPayout(nextTenant(), 'dir-1', { ...DIRECTOR_PAYOUT });
    assert.equal(res.periodMonth, expected, `${tz}: месяц по умолчанию`);
    assert.equal(mirrors[0].data.periodMonth, expected, `${tz}: расход в том же месяце`);
    assert.equal(pool.log.find((q) => q.sql.includes('INSERT INTO salary_payouts')).params[6], expected);
  }
  // «2026-10» уже наступил в Москве и ещё не наступил в Калининграде.
  const moscow = salaryHarness(payoutRoutes(), 'Europe/Moscow');
  const ok = await moscow.service.createPayout(nextTenant(), 'dir-1', { ...DIRECTOR_PAYOUT, periodMonth: '2026-10' });
  assert.equal(ok.periodMonth, '2026-10');
  const kgd = salaryHarness(payoutRoutes(), 'Europe/Kaliningrad');
  await assert.rejects(
    () => kgd.service.createPayout(nextTenant(), 'dir-1', { ...DIRECTOR_PAYOUT, periodMonth: '2026-10' }),
    httpError(400, /ещё не наступил/),
  );
  assert.equal(wroteToDb(kgd.pool), false);
});

test('B: legacy createPayment — зеркальный расход несёт period_month = month_year выплаты (не NULL)', async () => {
  const paymentDate = new Date('2026-09-30T12:00:00.000Z');
  const pool = makePool([
    TX,
    { match: 'SELECT full_name FROM users', rows: [{ full_name: 'Мастер Иван' }] },
    {
      match: 'INSERT INTO salary_payments',
      rows: (sql, p) => [
        {
          id: 'pay-1',
          tenant_id: p[0],
          user_id: p[1],
          amount: p[2],
          month_year: p[3],
          type: p[4],
          comment: p[5],
          created_by: p[6],
          date: paymentDate,
          created_at: paymentDate,
          point_id: p[7],
        },
      ],
    },
    { match: "FROM expense_categories WHERE tenant_id = $1 AND name = 'Зарплата'", rows: [{ id: 'cat-1' }] },
    { match: 'INSERT INTO expenses', rows: [{ id: 'exp-9' }] },
    { match: 'UPDATE salary_payments SET expense_id', rows: [] },
  ]);
  const push = { sendDataToTenant: () => Promise.resolve(), sendToUserInTenant: () => {} };
  const service = new SalaryService(pool, push, {}, { buildShiftFilter: async () => null }, {});
  const tenantID = nextTenant();

  const res = await service.createPayment(tenantID, 'dir-1', {
    userId: 'emp-1',
    amount: 30000,
    monthYear: PREV,
    type: 'salary',
  });

  const expense = pool.log.find((q) => q.sql.includes('INSERT INTO expenses'));
  assert.ok(expense, 'зеркальный расход записан');
  assert.match(expense.sql, /point_id, period_month\) VALUES \(\$1, \$2, \$3, \$4, \$5, \$6, \$7, \$8\)/);
  assert.equal(expense.params[0], 'cat-1');
  assert.equal(expense.params[1], 30000);
  assert.match(expense.params[2], /^Зарплата: Мастер Иван за \S+ \d{4}$/);
  assert.equal(expense.params[3], paymentDate, 'касса: date расхода = дата выплаты (факт)');
  assert.equal(expense.params[5], tenantID);
  assert.equal(expense.params[7], PREV, 'period_month расхода = month_year выплаты («за какой месяц»)');
  const link = pool.log.find((q) => q.sql.startsWith('UPDATE salary_payments SET expense_id'));
  assert.deepEqual(link.params, ['exp-9', 'pay-1'], 'связь выплата → расход сохранена');
  assert.equal(res.monthYear, PREV);
  assert.equal(res.amount, 30000);
});

// ── carryOver: «долг за прошлые месяцы» в карточке месяца и в списке ─────────

const CARRY_TZ = 'Europe/Moscow';
const CARRY_MONTH = '2026-09';
// Окно остатков сентября 2026: 12 месяцев ДО сентября, границы — полночь пояса тенанта
// (Москва UTC+3: 1 сентября 2025 00:00 = 31 августа 21:00Z; 1 сентября 2026 — так же).
const CARRY_WINDOW = ['2025-08-31T21:00:00.000Z', '2026-08-31T21:00:00.000Z'];
const CARRY_KEYS = monthKeysBefore(CARRY_MONTH, 12);

/** Строки сгруппированного запроса остатков (сотрудник × месяц), часть — «мусор», который сервис обязан отбросить. */
const carryRows = (employeeId) => [
  { employee_id: employeeId, ym: '2026-08', remaining: '30000' },
  { employee_id: employeeId, ym: '2026-07', remaining: '-5000.5' }, // переплата: в месяцах есть, в total не входит
  { employee_id: employeeId, ym: '2026-06', remaining: '0' }, // ноль — не долг и не переплата
  { employee_id: employeeId, ym: '2026-05', remaining: '12000.25' },
  { employee_id: employeeId, ym: '2024-01', remaining: '999' }, // старше окна в 12 месяцев
  { employee_id: employeeId, ym: '2026-09', remaining: '777' }, // сам запрошенный месяц — не «прошлый»
  { employee_id: employeeId, ym: '2026-10', remaining: '555' }, // будущее
];
const CARRY_EXPECTED_MONTHS = [
  { month: '2026-08', remaining: 30000 },
  { month: '2026-07', remaining: -5000.5 },
  { month: '2026-05', remaining: 12000.25 },
];
const carryQueries = (pool) => pool.log.filter((q) => q.sql.includes('GROUP BY t.employee_id, t.ym'));

/**
 * Маршруты getEmployeeMonth. Запрос остатков идёт ПЕРВЫМ: в его тексте есть подстроки всех
 * остальных маршрутов (FROM checks ch, FROM salary_payouts p, …), первый совпавший побеждает.
 */
function cardRoutes({ carry = [], payouts = [], services = '0' } = {}) {
  return [
    { match: 'GROUP BY t.employee_id, t.ym', rows: carry },
    {
      match: 'FROM users WHERE id = $1 AND tenant_id = $2',
      rows: [{ full_name: 'Мастер Иван', salary_percent: '40', product_salary_percent: '10' }],
    },
    { match: 'FROM master_rate_history', rows: [] },
    {
      match: 'FROM checks WHERE master_id = $1',
      rows: [{ product_earnings: '0', total_revenue: '0', check_count: '0' }],
    },
    { match: 'FROM checks ch JOIN check_service_lines sl', rows: [{ service_earnings: services }] },
    { match: 'FROM motivation_accruals ma', rows: [{ amount: '0' }] },
    { match: 'FROM salary_premiums sp', rows: [] },
    { match: 'FROM salary_penalties pen', rows: [] },
    { match: 'FROM salary_payouts p', rows: payouts },
    { match: 'FROM salary_payments sp', rows: [] },
  ];
}

test('B: getEmployeeMonth.carryOver — остатки прошлых месяцев по убыванию, total = сумма ПОЛОЖИТЕЛЬНЫХ, переплата видна, окно/ноль/будущее отброшены', async () => {
  const tenantID = nextTenant();
  const { service, pool } = salaryHarness(cardRoutes({ carry: carryRows('emp-1') }));
  const card = await service.getEmployeeMonth(tenantID, 'emp-1', CARRY_MONTH);

  assert.deepEqual(card.carryOver.months, CARRY_EXPECTED_MONTHS);
  assert.equal(card.carryOver.total, 42000.25, '30000 + 12000.25; переплата -5000.5 не вычитается');
  for (let i = 1; i < card.carryOver.months.length; i += 1) {
    assert.ok(card.carryOver.months[i - 1].month > card.carryOver.months[i].month, 'месяцы строго по убыванию');
  }

  // Один сгруппированный запрос на всё окно (а не 12 вызовов карточки) и ровно те границы, что описаны.
  const carry = carryQueries(pool);
  assert.equal(carry.length, 1);
  assert.deepEqual(carry[0].params, [tenantID, ['emp-1'], CARRY_TZ, ...CARRY_WINDOW, CARRY_KEYS]);
  assert.equal(CARRY_KEYS.length, 12);
  assert.equal(CARRY_KEYS[0], '2026-08', 'ближайший к запрошенному');
  assert.equal(CARRY_KEYS[11], '2025-09');
  // Чужой тенант не подмешивается ни в одну из семи веток запроса.
  assert.ok((carry[0].sql.match(/\.tenant_id = \$1/g) ?? []).length >= 7, 'tenant_id = $1 в каждой ветке');
  // Выплата считается по ЭФФЕКТИВНОМУ месяцу — в поясе тенанта, а не по месяцу сервера.
  assert.match(carry[0].sql, /COALESCE\(p\.period_month, to_char\(p\.created_at AT TIME ZONE \$3::text, 'YYYY-MM'\)\)/);
  assert.match(carry[0].sql, /spm\.month_year = ANY\(\$6::text\[\]\)/, 'legacy-платежи — по month_year');
  assert.match(carry[0].sql, /spm\.reversed_at IS NULL/, 'сторнированный legacy-платёж долг не гасит');
});

test('B: getEmployeeMonth.carryOver — без долгов и переплат поле ВСЕГДА есть: { total: 0, months: [] }', async () => {
  const { service } = salaryHarness(cardRoutes({ carry: [] }));
  const card = await service.getEmployeeMonth(nextTenant(), 'emp-1', CARRY_MONTH);
  assert.deepEqual(card.carryOver, { total: 0, months: [] });
});

test('B: getEmployeeMonth — остаток самого месяца не меняется от carryOver; выплата ищется по эффективному месяцу', async () => {
  const tenantID = nextTenant();
  const payout = {
    id: 'po-9',
    employee_id: 'emp-1',
    user_name: 'Мастер Иван',
    type: 'salary',
    amount: '30000',
    status: 'accepted',
    period_month: CARRY_MONTH,
    created_at: new Date('2026-09-20T09:00:00.000Z'),
    created_by: 'dir-1',
    creator_name: 'Директор',
  };
  const { service, pool } = salaryHarness(
    cardRoutes({ carry: carryRows('emp-1'), payouts: [payout], services: '80000' }),
  );
  const card = await service.getEmployeeMonth(tenantID, 'emp-1', CARRY_MONTH);

  assert.equal(card.totalEarnings, 80000);
  assert.equal(card.paidAmount, 30000);
  assert.equal(card.remainingAmount, 50000, 'долг прошлых месяцев не подмешивается в остаток месяца');
  assert.equal(card.carryOver.total, 42000.25);

  const payoutQuery = pool.log.find((q) => q.sql.includes('FROM salary_payouts p') && !q.sql.includes('GROUP BY'));
  assert.match(
    payoutQuery.sql,
    /COALESCE\(p\.period_month, to_char\(p\.created_at AT TIME ZONE \$4::text, 'YYYY-MM'\)\) = \$3/,
    'выплата принадлежит месяцу «за который»; месяц факта — только когда period_month пуст',
  );
  assert.deepEqual(payoutQuery.params, [tenantID, 'emp-1', CARRY_MONTH, CARRY_TZ]);
});

test('B: carryOver — окно считается в поясе тенанта, а филиал режет каждую ветку тем же равенством', async () => {
  // Владивосток UTC+10: полночь 1 сентября = 31 августа 14:00Z.
  const vlad = salaryHarness(cardRoutes({ carry: [] }), 'Asia/Vladivostok');
  const tenantID = nextTenant();
  await vlad.service.getEmployeeMonth(tenantID, 'emp-1', CARRY_MONTH);
  assert.deepEqual(carryQueries(vlad.pool)[0].params.slice(2, 5), [
    'Asia/Vladivostok',
    '2025-08-31T14:00:00.000Z',
    '2026-08-31T14:00:00.000Z',
  ]);

  const branch = salaryHarness(cardRoutes({ carry: [] }));
  await branch.service.getEmployeeMonth(nextTenant(), 'emp-1', CARRY_MONTH, 'point-1');
  const q = carryQueries(branch.pool)[0];
  assert.equal(q.params[6], 'point-1', 'филиал — седьмым параметром');
  for (const alias of ['ch', 'pen', 'sp', 'p', 'spm']) {
    assert.ok(q.sql.includes(`${alias}.point_id = $7`), `ветка ${alias} режется филиалом`);
  }
  assert.match(q.sql, /chm\.point_id = \$7/, 'мотивация — по точке чека, у неё своей точки нет');
});

/** Маршруты getAll (без филиала): запрос остатков — первым, главный запрос листа — по CTE svc. */
function listRoutes({ masters, carry = [] }) {
  return [
    { match: 'GROUP BY t.employee_id, t.ym', rows: carry },
    { match: 'WITH svc AS (', rows: masters },
    { match: 'FROM salary_payments sp', rows: [] },
    { match: 'FROM salary_premiums sp', rows: [] },
    { match: 'FROM salary_penalties pen', rows: [] },
    { match: 'FROM motivation_accruals ma', rows: [] },
    { match: 'FROM salary_payouts p', rows: [] },
  ];
}
const listMaster = (id, name, earnings) => ({
  master_id: id,
  master_name: name,
  salary_percent: '40',
  product_salary_percent: '10',
  service_earnings: String(earnings),
  product_earnings: '0',
  total_earnings: String(earnings),
  total_revenue: '0',
  check_count: '0',
});
const MONTH_RANGE = { dateFrom: '2026-09-01', dateTo: '2026-09-30' };

test('B: getAll.carryOverAmount — сумма положительных остатков 12 месяцев до периода, ОДИН запрос на весь лист', async () => {
  const tenantID = nextTenant();
  const masters = [listMaster('e1', 'Иван', 50000), listMaster('e2', 'Пётр', 20000)];
  const carry = [
    ...carryRows('e1'),
    { employee_id: 'e2', ym: '2026-08', remaining: '-2000' }, // одна переплата — долга нет
    { employee_id: 'e2', ym: '2026-06', remaining: '0' },
  ];
  const { service, pool } = salaryHarness(listRoutes({ masters, carry }));
  const rows = await service.getAll(tenantID, { ...MONTH_RANGE });

  const byId = Object.fromEntries(rows.map((r) => [r.masterId, r]));
  assert.equal(byId.e1.carryOverAmount, 42000.25);
  assert.equal(byId.e2.carryOverAmount, 0, 'переплата долгом не считается, ноль остаётся нулём');
  // Отдельная цифра: остаток самого периода не меняет смысл.
  assert.equal(byId.e1.remainingAmount, 50000);
  assert.equal(byId.e2.remainingAmount, 20000);

  const carryQ = carryQueries(pool);
  assert.equal(carryQ.length, 1, 'один запрос на всех сотрудников листа');
  assert.deepEqual(carryQ[0].params, [tenantID, ['e1', 'e2'], CARRY_TZ, ...CARRY_WINDOW, CARRY_KEYS]);
});

test('B: getAll.carryOverAmount — «12 месяцев до месяца НАЧАЛА периода»: середина месяца и многомесячный диапазон', async () => {
  const mid = salaryHarness(listRoutes({ masters: [listMaster('e1', 'Иван', 1)] }));
  await mid.service.getAll(nextTenant(), { dateFrom: '2026-09-15', dateTo: '2026-09-30' });
  assert.deepEqual(carryQueries(mid.pool)[0].params[5], CARRY_KEYS, 'неделя внутри сентября — тот же сентябрь');

  const quarter = salaryHarness(listRoutes({ masters: [listMaster('e1', 'Иван', 1)] }));
  await quarter.service.getAll(nextTenant(), { dateFrom: '2026-07-01', dateTo: '2026-09-30' });
  assert.deepEqual(
    carryQueries(quarter.pool)[0].params[5],
    monthKeysBefore('2026-07', 12),
    'месяцы самого диапазона в «долг прошлых месяцев» не входят',
  );
  assert.equal(monthKeysBefore('2026-07', 12)[0], '2026-06');
});

test('B: getAll({ carryOver: false }) — поля нет и запроса остатков нет (отчёт «По зарплатам» его не оплачивает)', async () => {
  const { service, pool } = salaryHarness(listRoutes({ masters: [listMaster('e1', 'Иван', 50000)] }));
  const rows = await service.getAll(nextTenant(), { ...MONTH_RANGE }, null, { carryOver: false });
  assert.equal(rows.length, 1);
  assert.equal('carryOverAmount' in rows[0], false);
  assert.equal(carryQueries(pool).length, 0);
  assert.equal(rows[0].remainingAmount, 50000, 'остальные цифры листа прежние');
});

test('B: getAll на пустом листе не ходит за остатками', async () => {
  const { service, pool } = salaryHarness(listRoutes({ masters: [] }));
  const rows = await service.getAll(nextTenant(), { ...MONTH_RANGE });
  assert.deepEqual(rows, []);
  assert.equal(carryQueries(pool).length, 0);
});

// ── Расходы: attribution в ленте, periodMonth в create/update, замок зеркал выплат ─

const EXP_ID = '11111111-1111-4111-8111-111111111111';
const MSK = 'Europe/Moscow';
const directorOf = (tenantID, extra = {}) => ({ tenantID, userID: 'dir-1', role: 'director', ...extra });

function expensesHarness(routes = [], tz = MSK) {
  const pool = makePool([tzRoute(tz), ...routes]);
  return { service: new ExpensesService(pool), pool };
}

/** Строка `expenses` (то, что вернул бы Postgres), с подстановкой нужных полей. */
const expenseRow = (over = {}) => ({
  id: EXP_ID,
  category_id: null,
  category_name: null,
  amount: '5000',
  description: 'Аренда',
  date: new Date('2026-09-20T09:00:00.000Z'),
  user_id: 'dir-1',
  user_name: 'Директор',
  created_by: 'dir-1',
  creator_name: 'Директор',
  source: 'owner',
  approval_status: 'approved',
  period_month: null,
  recipient_name: null,
  created_at: new Date('2026-09-20T09:00:00.000Z'),
  ...over,
});
const warrantyRow = (id, iso, loss) => ({
  id,
  number: 100,
  date: new Date(iso),
  created_at: new Date(iso),
  master_id: 'm-1',
  loss: String(loss),
  master_name: 'Мастер Иван',
  plate_number: 'А123ВС77',
});

const feedRoutes = ({ rows = [], warranty = [] } = {}) => [
  { match: 'FROM expenses e LEFT JOIN expense_categories ec', rows },
  { match: 'FROM checks ch LEFT JOIN users u', rows: warranty },
];
const feedQuery = (pool) => pool.log.find((q) => q.sql.includes('FROM expenses e LEFT JOIN expense_categories ec'));
const warrantyQuery = (pool) => pool.log.find((q) => q.sql.includes('FROM checks ch LEFT JOIN users u'));
const FEED_RANGE = { dateFrom: '2026-09-01', dateTo: '2026-09-30' };

test('B: expenses.getAll — по умолчанию лента по ДАТЕ ФАКТА (касса): period_month в фильтре нет, но виден бейджем', async () => {
  for (const attribution of [undefined, null, '', 'date']) {
    const tenantID = nextTenant();
    const { service, pool } = expensesHarness(feedRoutes({ rows: [expenseRow({ period_month: '2026-08' })] }));
    const rows = await service.getAll(tenantID, { ...FEED_RANGE, attribution });
    const q = feedQuery(pool);

    assert.deepEqual(q.params, [tenantID, '2026-09-01', MSK, '2026-09-30', MSK], `attribution=${String(attribution)}`);
    assert.match(q.sql, /e\.date >= \$2::date::timestamp AT TIME ZONE \$3::text/);
    assert.match(q.sql, /e\.date < \(\$4::date \+ 1\)::timestamp AT TIME ZONE \$5::text/);
    assert.doesNotMatch(q.sql, /period_month/, 'касса не смотрит на месяц «за который»');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].periodMonth, '2026-08', 'месяц «за который» отдаётся строкой как есть');
  }
});

test('B: expenses.getAll?attribution=period — диапазон режется по месяцу «за который» тем же helper-ом, что отчёты', async () => {
  const tenantID = nextTenant();
  // Расход «за август», внесённый 20 сентября: в ленте сентября он есть (по факту), в августе по периоду — тоже.
  const row = expenseRow({ period_month: '2026-08', date: new Date('2026-09-20T09:00:00.000Z') });
  const { service, pool } = expensesHarness(feedRoutes({ rows: [row] }));
  const rows = await service.getAll(tenantID, { dateFrom: '2026-08-01', dateTo: '2026-08-31', attribution: 'period' });
  const q = feedQuery(pool);

  const expected = norm(
    effectiveMonthMembershipSql('e.period_month', 'e.date', '2026-08-01', '2026-08-31', '$4::text', {
      from: '$2',
      to: '$3',
    }),
  );
  assert.ok(q.sql.includes(expected), 'предикат периода — дословно общий helper со своими плейсхолдерами');
  assert.deepEqual(q.params, [tenantID, '2026-08-01', '2026-08-31', MSK]);
  // У строк БЕЗ месяца «за который» helper сам режет по факту (та же форма, но пояс — $4, а не $3):
  // в режиме date пояс стоит третьим параметром, здесь третий — правая граница диапазона.
  assert.doesNotMatch(q.sql, /AT TIME ZONE \$3::text/, 'форма режима date (пояс = $3) не подмешана');
  assert.match(q.sql, /e\.period_month IS NULL OR e\.period_month !~/, 'строки без месяца — по факту, внутри helper-а');
  assert.equal(rows[0].periodMonth, '2026-08');
  assert.match(q.sql, /e\.tenant_id = \$1/, 'тенант режет всегда');
});

test('B: expenses.getAll — невалидный attribution это 400 БЕЗ единого запроса в БД (молчаливого отката к date нет)', async () => {
  for (const bad of ['PERIOD', 'Period', 'month', 'fact', 'date ', 'periods', 0, false, {}, ['period', 'date']]) {
    const { service, pool } = expensesHarness(feedRoutes());
    await assert.rejects(
      service.getAll(nextTenant(), { ...FEED_RANGE, attribution: bad }),
      httpError(400, /attribution должен быть date или period/),
      `attribution=${JSON.stringify(bad)}`,
    );
    assert.equal(pool.log.length, 0, 'ошибка параметра — до любых обращений к БД');
  }
});

test('B: expenses.getAll?attribution=period — границы это ДНИ: мусор и несуществующая дата дают 400, а не 500 от Postgres', async () => {
  for (const bad of ['вчера', '2026-13-01', '2026-02-30', '01.09.2026', 20260901]) {
    for (const key of ['dateFrom', 'dateTo']) {
      const { service, pool } = expensesHarness(feedRoutes());
      const query = { ...FEED_RANGE, attribution: 'period', [key]: bad };
      await assert.rejects(
        service.getAll(nextTenant(), query),
        httpError(400, new RegExp(`${key}: (формат ГГГГ-ММ-ДД|такой даты нет)`)),
        `${key}=${String(bad)}`,
      );
      assert.equal(feedQuery(pool), undefined, 'в таблицу расходов не ходили');
    }
  }
});

test('B: expenses.getAll?attribution=period — хвост ISO отбрасывается, отсутствующая граница открыта, без диапазона — с 1-го числа месяца', async () => {
  const run = async (query) => {
    const tenantID = nextTenant();
    const { service, pool } = expensesHarness(feedRoutes());
    await service.getAll(tenantID, { attribution: 'period', ...query });
    return { tenantID, params: feedQuery(pool).params };
  };

  let r = await run({ dateFrom: '2026-08-01T00:00:00.000Z', dateTo: '2026-08-31T20:59:59.999Z' });
  assert.deepEqual(r.params, [r.tenantID, '2026-08-01', '2026-08-31', MSK]);

  r = await run({ dateTo: '2026-09-30' });
  assert.deepEqual(r.params, [r.tenantID, '1900-01-01', '2026-09-30', MSK], 'нет левой границы — с начала времён');

  r = await run({ dateFrom: '2026-09-01' });
  assert.deepEqual(r.params, [r.tenantID, '2026-09-01', '2999-12-31', MSK], 'нет правой границы — до конца времён');

  r = await run({});
  assert.match(
    r.params[1],
    /^\d{4}-\d{2}-01$/,
    'без диапазона — 1-е число текущего месяца (страховка от полного скана)',
  );
  assert.equal(r.params[2], '2999-12-31');
});

test('B: expenses.getAll — фильтры и филиал нумеруются ПОСЛЕ периода в обоих режимах', async () => {
  const tenantID = nextTenant();
  const actor = directorOf(tenantID, { currentPointId: 'pt-1' });

  const period = expensesHarness(feedRoutes());
  await period.service.getAll(
    tenantID,
    { ...FEED_RANGE, attribution: 'period', createdBy: 'u-1', approvalStatus: 'approved' },
    actor,
  );
  const pq = feedQuery(period.pool);
  assert.deepEqual(pq.params, [tenantID, '2026-09-01', '2026-09-30', MSK, 'u-1', 'approved', 'pt-1']);
  for (const frag of ['e.created_by = $5', 'e.approval_status = $6', 'e.point_id = $7']) {
    assert.ok(pq.sql.includes(frag), frag);
  }
  assert.equal(warrantyQuery(period.pool), undefined, 'по конкретному автору гарантийных строк нет');

  const date = expensesHarness(feedRoutes());
  await date.service.getAll(tenantID, { ...FEED_RANGE }, actor);
  const dq = feedQuery(date.pool);
  assert.deepEqual(dq.params, [tenantID, '2026-09-01', MSK, '2026-09-30', MSK, 'pt-1']);
  assert.ok(dq.sql.includes('e.point_id = $6'));
  assert.deepEqual(warrantyQuery(date.pool).params, [tenantID, '2026-09-01', MSK, '2026-09-30', MSK, 'pt-1']);
});

test('B: expenses.getAll — «Гарантия (убыток)» режется ПО ФАКТУ в обоих режимах, periodMonth у неё null, порядок — по дате убывания', async () => {
  for (const attribution of ['date', 'period']) {
    const tenantID = nextTenant();
    const { service, pool } = expensesHarness(
      feedRoutes({
        rows: [expenseRow({ date: new Date('2026-09-20T09:00:00.000Z') })],
        warranty: [
          warrantyRow('chk-1', '2026-09-10T10:00:00.000Z', 3000),
          warrantyRow('chk-2', '2026-09-25T10:00:00.000Z', 4000),
        ],
      }),
    );
    const rows = await service.getAll(tenantID, { ...FEED_RANGE, attribution });

    const w = warrantyQuery(pool);
    assert.deepEqual(w.params, [tenantID, '2026-09-01', MSK, '2026-09-30', MSK], attribution);
    assert.match(w.sql, /ch\.date >= \$2::date::timestamp AT TIME ZONE \$3::text/);
    assert.doesNotMatch(w.sql, /period_month/, 'гарантия — чек, у чека нет месяца «за который»');

    assert.deepEqual(
      rows.map((r) => r.id),
      ['warranty-loss:chk-2', EXP_ID, 'warranty-loss:chk-1'],
      'по убыванию даты факта',
    );
    const synthetic = rows.filter((r) => r.source === 'warranty');
    assert.equal(synthetic.length, 2);
    for (const s of synthetic) {
      assert.equal(s.periodMonth, null);
      assert.equal(s.categoryName, 'Гарантия (убыток)');
    }
    assert.deepEqual(
      synthetic.map((s) => s.amount),
      [4000, 3000],
    );
  }
});

/** INSERT возвращает строку целиком из своих параметров — так виден и порядок колонок, и период. */
const insertExpenseRoute = () => ({
  match: 'INSERT INTO expenses',
  rows: (_text, a) => [
    expenseRow({
      id: 'new-1',
      category_id: a[0],
      amount: String(a[1]),
      description: a[2],
      date: a[3],
      user_id: a[4],
      created_by: a[5],
      source: a[6],
      approval_status: a[7],
      point_id: a[9],
      period_month: a[10],
    }),
  ],
});
const insertQuery = (pool) => pool.log.find((q) => q.sql.startsWith('INSERT INTO expenses'));

test('B: expenses.create — periodMonth уходит в period_month; не передан или null это NULL (месяц по дате факта)', async () => {
  const withMonth = expensesHarness([insertExpenseRoute()]);
  const tenantID = nextTenant();
  const created = await withMonth.service.create(directorOf(tenantID), {
    amount: 5000,
    description: 'Аренда за август',
    periodMonth: '2026-08',
  });
  const q = insertQuery(withMonth.pool);
  assert.match(q.sql, /VALUES \(\$1, \$2, \$3, \$4, \$5, \$6, \$7, \$8, \$9, \$10, \$11\) RETURNING \*/);
  assert.match(q.sql, /point_id, period_month\)/);
  assert.equal(q.params[10], '2026-08');
  assert.equal(q.params[6], 'owner');
  assert.equal(q.params[7], 'approved');
  assert.equal(q.params[8], tenantID);
  assert.equal(q.params[9], null, 'у тенанта без филиалов точки нет');
  assert.equal(created.periodMonth, '2026-08');

  for (const dto of [{ amount: 100 }, { amount: 100, periodMonth: null }, { amount: 100, periodMonth: undefined }]) {
    const h = expensesHarness([insertExpenseRoute()]);
    const res = await h.service.create(directorOf(nextTenant()), dto);
    assert.equal(insertQuery(h.pool).params[10], null, JSON.stringify(dto));
    assert.equal(res.periodMonth, null);
  }
});

test('B: expenses.create — мусорный periodMonth это 400 до записи, а не 500 от CHECK', async () => {
  for (const bad of ['2026-13', '2026-00', '2026-9', '26-09', '2026-08-01', 'август', '', 202608, true, {}]) {
    const { service, pool } = expensesHarness([insertExpenseRoute()]);
    await assert.rejects(
      service.create(directorOf(nextTenant()), { amount: 100, periodMonth: bad }),
      httpError(400, /periodMonth должен быть в формате YYYY-MM или null/),
      `periodMonth=${JSON.stringify(bad)}`,
    );
    assert.equal(insertQuery(pool), undefined, 'ничего не записано');
  }
});

/** Маршруты update: текущая строка, наличие связи с выплатой, «Зарплата» ли категория, approval-флаг категории. */
function updateRoutes({ current, linked = false, salaryCategory = false }) {
  return [
    { match: 'SELECT * FROM expenses WHERE id = $1 AND tenant_id = $2', rows: [current] },
    { match: 'FROM salary_payouts WHERE expense_id = $1', rows: linked ? [{ '?column?': 1 }] : [] },
    { match: "AND name = 'Зарплата'", rows: salaryCategory ? [{ '?column?': 1 }] : [] },
    { match: 'SELECT approval_required FROM expense_categories', rows: [{ approval_required: false }] },
    {
      match: 'UPDATE expenses SET',
      rows: (text, args) => [
        { ...current, period_month: text.includes('period_month=$1') ? args[0] : current.period_month },
      ],
    },
  ];
}
const updateQuery = (pool) => pool.log.find((q) => q.sql.startsWith('UPDATE expenses SET'));
const linkQuery = (pool) => pool.log.find((q) => q.sql.includes('FROM salary_payouts WHERE expense_id = $1'));

test('B: expenses.update — обычная строка: месяц назначается, снимается (null), то же значение это no-op, без поля — не трогается', async () => {
  const tenantID = nextTenant();
  const actor = directorOf(tenantID);

  // назначить
  let h = expensesHarness(updateRoutes({ current: expenseRow({ period_month: null }) }));
  let res = await h.service.update(EXP_ID, actor, { periodMonth: '2026-08' });
  assert.match(
    updateQuery(h.pool).sql,
    /^UPDATE expenses SET period_month=\$1 WHERE id=\$2 AND tenant_id=\$3 RETURNING \*$/,
  );
  assert.deepEqual(updateQuery(h.pool).params, ['2026-08', EXP_ID, tenantID]);
  assert.equal(res.periodMonth, '2026-08');

  // снять
  h = expensesHarness(updateRoutes({ current: expenseRow({ period_month: '2026-08' }) }));
  res = await h.service.update(EXP_ID, actor, { periodMonth: null });
  assert.deepEqual(updateQuery(h.pool).params, [null, EXP_ID, tenantID]);
  assert.equal(res.periodMonth, null);

  // то же значение (форма отправлена как есть) — записи нет, отдаётся текущая строка
  for (const same of ['2026-08', null]) {
    h = expensesHarness(updateRoutes({ current: expenseRow({ period_month: same }) }));
    res = await h.service.update(EXP_ID, actor, { periodMonth: same });
    assert.equal(updateQuery(h.pool), undefined, `no-op для ${String(same)}`);
    assert.equal(res.periodMonth, same);
  }

  // поле не передано — период не в UPDATE
  h = expensesHarness(updateRoutes({ current: expenseRow({ period_month: '2026-08' }) }));
  res = await h.service.update(EXP_ID, actor, { description: 'Аренда (правка)' });
  assert.match(updateQuery(h.pool).sql, /^UPDATE expenses SET description=\$1 WHERE/);
  assert.doesNotMatch(updateQuery(h.pool).sql, /period_month/);
  assert.equal(res.periodMonth, '2026-08');

  // вместе с другими полями: период первым в SET, нумерация сквозная
  h = expensesHarness(updateRoutes({ current: expenseRow({ period_month: null }) }));
  await h.service.update(EXP_ID, actor, { amount: 6000, periodMonth: '2026-08' });
  assert.match(
    updateQuery(h.pool).sql,
    /^UPDATE expenses SET period_month=\$1, amount=\$2 WHERE id=\$3 AND tenant_id=\$4/,
  );
  assert.deepEqual(updateQuery(h.pool).params, ['2026-08', 6000, EXP_ID, tenantID]);
});

test('B: expenses.update — мусорный periodMonth это 400 ДО запроса связи с выплатой и до записи', async () => {
  for (const bad of ['2026-13', '2026-9', 202608, 'август', '', true]) {
    const h = expensesHarness(updateRoutes({ current: expenseRow() }));
    await assert.rejects(
      h.service.update(EXP_ID, directorOf(nextTenant()), { periodMonth: bad }),
      httpError(400, /periodMonth должен быть в формате YYYY-MM или null/),
      `periodMonth=${JSON.stringify(bad)}`,
    );
    assert.equal(linkQuery(h.pool), undefined);
    assert.equal(updateQuery(h.pool), undefined);
  }
});

test('B: expenses.update — зеркало выплаты: месяц задаёт сама выплата; то же значение игнорируется, иное и null это 400', async () => {
  const tenantID = nextTenant();
  const actor = directorOf(tenantID);
  const mirror = () => expenseRow({ category_id: 'cat-salary', period_month: '2026-08' });

  // то же значение — форма ушла как есть: записи нет, строка не меняется
  let h = expensesHarness(updateRoutes({ current: mirror(), linked: true }));
  const res = await h.service.update(EXP_ID, actor, { periodMonth: '2026-08' });
  assert.equal(updateQuery(h.pool), undefined);
  assert.equal(res.periodMonth, '2026-08');

  // иное значение и снятие
  for (const other of ['2026-07', '2026-09', null]) {
    h = expensesHarness(updateRoutes({ current: mirror(), linked: true }));
    await assert.rejects(
      h.service.update(EXP_ID, actor, { periodMonth: other }),
      httpError(400, /Месяц расхода выплаты зарплаты задаётся самой выплатой/),
      `periodMonth=${String(other)}`,
    );
    assert.equal(updateQuery(h.pool), undefined, 'ничего не записано');
  }

  // без periodMonth и с другими полями — прежний отказ зеркала
  for (const dto of [
    {},
    { description: 'x' },
    { amount: 1, periodMonth: '2026-08' },
    { date: '2026-09-01', periodMonth: '2026-08' },
  ]) {
    h = expensesHarness(updateRoutes({ current: mirror(), linked: true }));
    await assert.rejects(
      h.service.update(EXP_ID, actor, dto),
      httpError(400, /зеркальный расход выплаты зарплаты/),
      JSON.stringify(dto),
    );
    assert.equal(updateQuery(h.pool), undefined);
  }
});

test('B: expenses.update — категория «Зарплата» без связи заперта так же; «Выплата вне программы» остаётся редактируемой', async () => {
  const tenantID = nextTenant();
  const actor = directorOf(tenantID);

  let h = expensesHarness(
    updateRoutes({ current: expenseRow({ category_id: 'cat-salary', period_month: '2026-08' }), salaryCategory: true }),
  );
  await assert.rejects(
    h.service.update(EXP_ID, actor, { periodMonth: '2026-07' }),
    httpError(400, /задаётся самой выплатой/),
  );
  assert.equal(updateQuery(h.pool), undefined);
  // то же значение в категории «Зарплата» — no-op
  h = expensesHarness(
    updateRoutes({ current: expenseRow({ category_id: 'cat-salary', period_month: '2026-08' }), salaryCategory: true }),
  );
  await h.service.update(EXP_ID, actor, { periodMonth: '2026-08' });
  assert.equal(updateQuery(h.pool), undefined);

  // «Выплаты вне программы» — обычный расход с другим именем категории: месяц можно менять
  h = expensesHarness(
    updateRoutes({
      current: expenseRow({ category_id: 'cat-outside', period_month: '2026-08' }),
      salaryCategory: false,
    }),
  );
  const res = await h.service.update(EXP_ID, actor, { periodMonth: '2026-07' });
  assert.deepEqual(updateQuery(h.pool).params, ['2026-07', EXP_ID, tenantID]);
  assert.equal(res.periodMonth, '2026-07');
});

test('B: expenses.update — синтетический id гарантии и не-uuid это 404 без запросов', async () => {
  for (const id of ['warranty-loss:abc', 'не-uuid', '123']) {
    const h = expensesHarness(updateRoutes({ current: expenseRow() }));
    await assert.rejects(
      h.service.update(id, directorOf(nextTenant()), { periodMonth: '2026-08' }),
      httpError(404, /Расход не найден/),
    );
    assert.equal(h.pool.log.length, 0);
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// C. Билдеры отчётов на том же пуле: тот самый предикат, те самые params
// ═════════════════════════════════════════════════════════════════════════════

const { salaryPaidTotal } = require('../dist/reports/builder/report-shared-queries');
const { ExpensesBuilder } = require('../dist/reports/builder/builders/expenses.builder');
const { SalaryBuilder } = require('../dist/reports/builder/builders/salary.builder');

const REPORT_TENANT = 'tenant-report';
/** Контекст отчёта. Билдерам хватает этих полей — актёра, шапку и каталог собирает диспетчер. */
const reportCtx = (over = {}) => ({
  tenantId: REPORT_TENANT,
  pointId: null,
  tz: MSK,
  dateFrom: '2026-08-01',
  dateTo: '2026-08-31',
  ids: [],
  ...over,
});
/** Предикат «строка принадлежит периоду» так, как его собирают отчёты: границы $2/$3, пояс $4. */
const reportMember = (periodCol, factCol, ctx = reportCtx()) =>
  norm(effectiveMonthMembershipSql(periodCol, factCol, ctx.dateFrom, ctx.dateTo, '$4::text'));
/** SQL с вырезанными вхождениями helper-а: в остатке выплату по дате факта резать уже нечем. */
const withoutHelper = (sql, fragments) => fragments.reduce((s, f) => s.split(f).join('<helper>'), sql);
const findQuery = (pool, marker) => pool.log.find((q) => q.sql.includes(marker));
const num2 = (v) => Math.round(Number(v) * 100) / 100;

test('C: salaryPaidTotal («Сводный», KPI «Зарплата выплачено») — по месяцу «за который»; params [tenant, from, to, tz]', async () => {
  const ctx = reportCtx();
  const pool = makePool([{ match: 'FROM salary_payouts p', rows: [{ total: '30000.5' }] }]);
  const total = await salaryPaidTotal(pool, ctx);

  assert.equal(total, 30000.5, 'число из SUM, а не строка');
  assert.equal(pool.log.length, 1, 'один запрос на обе таблицы выплат');
  const [q] = pool.log;
  const payoutMember = reportMember('p.period_month', 'p.created_at');
  const legacyMember = reportMember('sp.month_year', 'sp.date');
  assert.ok(q.sql.includes(payoutMember), 'принятые выплаты — helper по (period_month, created_at)');
  assert.ok(q.sql.includes(legacyMember), 'legacy-платежи — helper по (month_year, date)');
  assert.deepEqual(q.params, [REPORT_TENANT, '2026-08-01', '2026-08-31', MSK]);
  assert.match(q.sql, /p\.status = 'accepted'/, 'только принятые выплаты');
  assert.match(q.sql, /sp\.reversed_at IS NULL/, 'legacy — без сторно');
  const rest = withoutHelper(q.sql, [payoutMember, legacyMember]);
  assert.doesNotMatch(
    rest,
    /created_at >=|\bsp\.date >=|AT TIME ZONE/,
    'вне helper-а выплату по дате факта никто не режет',
  );
});

test('C: salaryPaidTotal — филиал сессии адресуется $5 в обеих таблицах; пустой ответ — ноль', async () => {
  const ctx = reportCtx({ pointId: 'pt-1' });
  const pool = makePool([{ match: 'FROM salary_payouts p', rows: [] }]);
  assert.equal(await salaryPaidTotal(pool, ctx), 0, 'нет строк — ноль, а не NaN');
  const [q] = pool.log;
  assert.deepEqual(q.params, [REPORT_TENANT, '2026-08-01', '2026-08-31', MSK, 'pt-1']);
  assert.match(q.sql, /p\.point_id = \$5/);
  assert.match(q.sql, /sp\.point_id = \$5/);
  assert.ok(
    q.sql.includes(reportMember('p.period_month', 'p.created_at', ctx)),
    'филиал не подменяет предикат периода',
  );
});

const expensesReportRoutes = ({ cats = [], top = [], revenue = 0 } = {}) => [
  { match: 'GROUP BY 1', rows: cats },
  { match: 'ORDER BY e.amount DESC', rows: top },
  { match: 'AS revenue', rows: [{ revenue }] },
  { match: 'COUNT(*) FILTER (WHERE', rows: [{ cnt: 0, total: 0 }] },
  { match: 'ORDER BY loss DESC', rows: [] },
];
const SALARY_EXPENSE_ROWS = {
  cats: [
    { category: 'Зарплата', cnt: 1, total: '30000' },
    { category: 'Аренда', cnt: 1, total: '5000' },
  ],
  top: [
    {
      id: 'e-1',
      day: '2026-09-28',
      category: 'Зарплата',
      amount: '30000',
      description: 'Выплата зарплаты: Иван',
      employee: 'Иван',
    },
  ],
  revenue: '100000',
};

test('C: «По расходам» — категории и топ режутся месяцем «за который» ОДНИМ helper-ом; выручка и гарантия — по дате чека', async () => {
  const ctx = reportCtx();
  const pool = makePool(expensesReportRoutes(SALARY_EXPENSE_ROWS));
  const report = await new ExpensesBuilder(pool).build(ctx);

  const member = reportMember('e.period_month', 'e.date');
  const catQ = findQuery(pool, 'GROUP BY 1');
  const topQ = findQuery(pool, 'ORDER BY e.amount DESC');
  for (const [name, q] of [
    ['категории', catQ],
    ['топ', topQ],
  ]) {
    assert.ok(q, `запрос «${name}» ушёл в пул`);
    assert.ok(q.sql.includes(member), `«${name}»: предикат периода — общий helper по (period_month, date)`);
    assert.deepEqual(q.params, [REPORT_TENANT, '2026-08-01', '2026-08-31', MSK], `«${name}»: params`);
    // (AT TIME ZONE в топе остаётся — им считается колонка «день оплаты» для вывода, не фильтр.)
    assert.doesNotMatch(withoutHelper(q.sql, [member]), /e\.date (>=|<) /, `«${name}»: по дате оплаты не режется`);
    assert.match(q.sql, /COALESCE\(e\.approval_status, 'approved'\) = 'approved'/, `«${name}»: только одобренные`);
  }
  // Выручка и гарантийные убытки — по дате чека: у чека месяца «за который» нет.
  for (const marker of ['AS revenue', 'COUNT(*) FILTER (WHERE', 'ORDER BY loss DESC']) {
    const q = findQuery(pool, marker);
    assert.ok(q, `запрос «${marker}» ушёл в пул`);
    assert.match(q.sql, /ch\.date >= \$2::date::timestamp AT TIME ZONE \$4::text/, `«${marker}»: по дате чека`);
    assert.doesNotMatch(q.sql, /period_month/, `«${marker}»: месяца «за который» у чека нет`);
  }

  // Выплата «за август», выданная в сентябре, стоит в АВГУСТОВСКОМ отчёте: «Из них зарплата» её видит.
  const kpi = Object.fromEntries(report.kpis.map((k) => [k.key, k.value]));
  assert.equal(kpi.salary, 30000, 'KPI «Из них зарплата» = категория «Зарплата»');
  assert.equal(kpi.total, 35000);
  assert.equal(kpi.revenue, 100000);
  // Топ показывает ДЕНЬ ОПЛАТЫ (кассовый факт), хотя строка стоит в августе.
  assert.equal(report.sections[0].rows[0].date, '2026-09-28');
  assert.match(report.sections[0].description, /расход стоит в периоде того месяца, за который назначен/);
});

test('C: «По расходам» — формат отчёта прежний (CSV/Excel строятся из тех же колонок), филиал — $5 во всех запросах', async () => {
  const ctx = reportCtx({ pointId: 'pt-1' });
  const pool = makePool(expensesReportRoutes(SALARY_EXPENSE_ROWS));
  const report = await new ExpensesBuilder(pool).build(ctx);

  assert.deepEqual(
    report.columns.map((c) => c.key),
    ['category', 'count', 'amount', 'shareOfExpenses', 'shareOfRevenue'],
  );
  assert.deepEqual(
    report.sections[0].columns.map((c) => c.key),
    ['date', 'category', 'amount', 'comment', 'employee'],
  );
  assert.deepEqual(
    Object.keys(report).sort(),
    ['columns', 'kpis', 'notes', 'rows', 'sections', 'totals', 'truncated'],
    'ключи BuiltReport не менялись',
  );
  for (const marker of ['GROUP BY 1', 'ORDER BY e.amount DESC']) {
    const q = findQuery(pool, marker);
    assert.deepEqual(q.params, [REPORT_TENANT, '2026-08-01', '2026-08-31', MSK, 'pt-1']);
    assert.match(q.sql, /e\.point_id = \$5/, `«${marker}»: расход своей точки`);
    assert.ok(q.sql.includes(reportMember('e.period_month', 'e.date', ctx)));
  }
  for (const marker of ['AS revenue', 'COUNT(*) FILTER (WHERE', 'ORDER BY loss DESC']) {
    assert.match(findQuery(pool, marker).sql, /ch\.point_id = \$5/, `«${marker}»: чек своей точки`);
  }
});

const SALARY_LIST_ROW = {
  masterId: 'emp-1',
  masterName: 'Иван',
  serviceEarnings: 30000,
  productEarnings: 0,
  premiumsAmount: 0,
  penaltiesAmount: 0,
  motivationAmount: 0,
  totalEarnings: 30000,
  workedShifts: 20,
  perDay: 1500,
};

/** SalaryBuilder на пуле-маршрутизаторе; начисления (SalaryService.getAll) — заглушка, журнал вызовов в `calls`. */
function salaryReportHarness({ list = [SALARY_LIST_ROW], paid = [], movements = [], users = [] } = {}) {
  const pool = makePool([
    { match: 'GROUP BY x.user_id, x.kind', rows: paid },
    { match: 'ORDER BY x.at DESC', rows: movements },
    { match: 'FROM users WHERE tenant_id = $1 AND purged_at IS NULL', rows: users },
  ]);
  const calls = [];
  const salary = {
    getAll: async (...args) => {
      calls.push(args);
      return list;
    },
  };
  return { builder: new SalaryBuilder(pool, salary), pool, calls };
}
const EMP_USERS = [{ id: 'emp-1', full_name: 'Иван', dismissed_at: null }];
/** Выплата 30 000 «за август», выданная 28 сентября: в отчёт августа она входит по месяцу «за который». */
const PAID_FOR_AUGUST = {
  paid: [{ user_id: 'emp-1', kind: 'salary', total: '30000' }],
  movements: [
    {
      user_id: 'emp-1',
      kind: 'salary',
      amount: '30000',
      at: new Date('2026-09-28T10:00:00.000Z'),
      comment: 'за август',
    },
  ],
  users: EMP_USERS,
};

test('C: «По зарплатам» — выплаты, legacy-платежи и премии режутся helper-ом по месяцу «за который»; штраф — по своей дате', async () => {
  const ctx = reportCtx();
  const { builder, pool } = salaryReportHarness(PAID_FOR_AUGUST);
  await builder.build(ctx);

  const fragments = [
    reportMember('p.period_month', 'p.created_at'),
    reportMember('sp.month_year', 'sp.date'),
    reportMember('pr.period_month_year', 'pr.created_at'),
  ];
  const penalty =
    'pen.date >= $2::date::timestamp AT TIME ZONE $4::text AND pen.date < ($3::date + 1)::timestamp AT TIME ZONE $4::text';
  for (const marker of ['GROUP BY x.user_id, x.kind', 'ORDER BY x.at DESC']) {
    const q = findQuery(pool, marker);
    assert.ok(q, `запрос «${marker}» ушёл в пул`);
    for (const f of fragments) assert.ok(q.sql.includes(f), `«${marker}»: helper на ${f.slice(0, 40)}…`);
    assert.ok(q.sql.includes(penalty), `«${marker}»: штраф — по дате штрафа`);
    assert.deepEqual(q.params, [REPORT_TENANT, '2026-08-01', '2026-08-31', MSK], `«${marker}»: params`);
    assert.match(q.sql, /p\.status = 'accepted'/, 'только принятые выплаты');
    assert.match(q.sql, /sp\.reversed_at IS NULL/, 'legacy — без сторно');
    assert.match(q.sql, /pr\.type = 'cash'/, 'премии — только деньгами');
    // В колонке `at` остаётся ДАТА ВЫДАЧИ (её видит человек в секции), а период режется месяцем «за который».
    assert.match(q.sql, /p\.created_at AS at/);
    const rest = withoutHelper(q.sql, fragments).replace(penalty, '<penalty>');
    assert.doesNotMatch(rest, /AT TIME ZONE/, `«${marker}»: других отнесений к периоду нет`);
  }
});

test('C: «По зарплатам» — начисления берутся без carryOver, филиал и выбранные сотрудники нумеруются $5/$6', async () => {
  const ctx = reportCtx({ pointId: 'pt-1', ids: ['emp-1'] });
  const { builder, pool, calls } = salaryReportHarness(PAID_FOR_AUGUST);
  await builder.build(ctx);

  assert.equal(calls.length, 1, 'начисления считаются один раз');
  assert.deepEqual(calls[0], [
    REPORT_TENANT,
    { dateFrom: '2026-08-01', dateTo: '2026-08-31' },
    'pt-1',
    { carryOver: false },
  ]);
  for (const marker of ['GROUP BY x.user_id, x.kind', 'ORDER BY x.at DESC']) {
    const q = findQuery(pool, marker);
    assert.deepEqual(q.params, [REPORT_TENANT, '2026-08-01', '2026-08-31', MSK, 'pt-1', ['emp-1']]);
    for (const alias of ['p', 'sp', 'pr', 'pen']) assert.match(q.sql, new RegExp(`${alias}\\.point_id = \\$5`), alias);
    assert.match(q.sql, /x\.user_id = ANY\(\$6::uuid\[\]\)/);
  }
});

test('C: «По зарплатам» — выплата «за август» из сентября: «Выплачено» и «Остаток» сходятся, дата в секции — день выдачи', async () => {
  const { builder } = salaryReportHarness(PAID_FOR_AUGUST);
  const report = await builder.build(reportCtx());

  const row = report.rows[0];
  assert.equal(row.accrued, 30000);
  assert.equal(row.salaryPaid, 30000, '«Выплачено ЗП» — из paidByUser (без лимита секции)');
  assert.equal(row.paid, 30000);
  assert.equal(row.remaining, 0, 'заработано 30 000, выдано 30 000 — остаток ноль, а не «долг»');
  assert.equal(report.totals.remaining, 0);
  const kpi = Object.fromEntries(report.kpis.map((k) => [k.key, k.value]));
  assert.equal(kpi.paid, 30000);
  assert.equal(kpi.remaining, 0);

  const section = report.sections[0];
  assert.equal(section.rows.length, 1);
  assert.equal(section.rows[0].date, '2026-09-28T10:00:00.000Z', 'дата строки — день выдачи (кассовый факт)');
  assert.equal(section.rows[0].kind, 'Зарплата');
  assert.match(section.description, /выплата стоит в периоде того месяца, за который выдана/);
  assert.ok(
    report.notes.some((n) => /за который выдана/.test(n)),
    'пояснение в примечаниях отчёта',
  );
});

test('C: «По зарплатам» — без выплат в периоде остаток равен начисленному (выплата ушла в свой месяц)', async () => {
  // Сентябрьский отчёт: выплата «за август» сюда не попадает — paidByUser пуст, начислено 12 000.
  const list = [{ ...SALARY_LIST_ROW, serviceEarnings: 12000, totalEarnings: 12000 }];
  const { builder } = salaryReportHarness({ list, paid: [], movements: [], users: EMP_USERS });
  const report = await builder.build(reportCtx({ dateFrom: '2026-09-01', dateTo: '2026-09-30' }));

  assert.equal(report.rows[0].paid, 0);
  assert.equal(report.rows[0].remaining, 12000);
  assert.equal(report.sections[0].rows.length, 0);
});

test('C: «По зарплатам» — формат отчёта прежний: колонки и ключи для CSV/Excel не менялись', async () => {
  const { builder } = salaryReportHarness(PAID_FOR_AUGUST);
  const report = await builder.build(reportCtx());

  assert.deepEqual(
    report.columns.map((c) => c.key),
    [
      'name',
      'works',
      'products',
      'extras',
      'accrued',
      'penalties',
      'advances',
      'salaryPaid',
      'paid',
      'remaining',
      'shifts',
      'perShift',
    ],
  );
  assert.deepEqual(
    report.sections[0].columns.map((c) => c.key),
    ['date', 'name', 'kind', 'amount', 'comment'],
  );
  assert.deepEqual(
    report.kpis.map((k) => k.key),
    ['accrued', 'paid', 'penalties', 'remaining'],
  );
  assert.deepEqual(Object.keys(report).sort(), ['columns', 'kpis', 'notes', 'rows', 'sections', 'totals', 'truncated']);
  assert.equal(num2(report.totals.accrued), 30000);
});

// ═════════════════════════════════════════════════════════════════════════════
// D. LIVE на настоящем Postgres (только при SALARY_LIVE_DB)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Реплей сценария владельца на МИГРИРОВАННОЙ БД приложения: настоящие SalaryService,
 * ExpensesService и билдеры отчётов, настоящий SQL. Нужны реальные таблицы (tenants,
 * users, checks, salary_payouts, expenses...), поэтому пустая throwaway-схема не
 * подходит — тест сам пропускается. Подключаться нужно ролью без row-level security
 * (владелец БД / superuser): сценарий создаёт себе тенанта.
 *
 * Всё происходит в ОДНОЙ транзакции, которая в конце ВСЕГДА откатывается: ни тенанта,
 * ни выплат, ни расходов в БД не остаётся.
 */
const LIVE_DB = process.env.SALARY_LIVE_DB;
const LIVE = {
  skip: LIVE_DB
    ? false
    : 'нет SALARY_LIVE_DB (мигрированная БД приложения) — слои A-C доказывают то же на фейковом пуле',
};

/**
 * Пул поверх ОДНОГО клиента в открытой транзакции. Сервисы открывают собственные
 * транзакции через pool.connect() + BEGIN/COMMIT/ROLLBACK — здесь они превращаются в
 * вложенные SAVEPOINT-ы: отказ отдельной операции (ожидаемый 400) откатывает только её,
 * а внешняя транзакция теста остаётся живой и в конце откатывается целиком.
 */
function savepointPool(client) {
  let seq = 0;
  const scoped = () => {
    const open = [];
    return {
      query: async (sql, params) => {
        const text = typeof sql === 'string' ? sql.trim() : '';
        if (text === 'BEGIN') {
          const name = `a3_sp_${++seq}`;
          open.push(name);
          return client.query(`SAVEPOINT ${name}`);
        }
        if (text === 'COMMIT') return client.query(`RELEASE SAVEPOINT ${open.pop()}`);
        if (text === 'ROLLBACK') {
          const name = open.pop();
          await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
          return client.query(`RELEASE SAVEPOINT ${name}`);
        }
        return client.query(sql, params);
      },
      release() {},
    };
  };
  return { query: (sql, params) => client.query(sql, params), connect: async () => scoped() };
}

/** Открывает транзакцию на живой БД, отдаёт сценарию пул и клиент, в `finally` всегда откатывает. */
async function withLiveTx(t, scenario) {
  const { Client } = require('pg');
  const client = new Client({ connectionString: LIVE_DB });
  await client.connect();
  try {
    const { rows } = await client.query(
      `SELECT to_regclass('public.tenants') AS tenants,
              to_regclass('public.check_service_lines') AS lines,
              to_regclass('public.salary_payouts') AS payouts,
              to_regclass('public.motivation_accruals') AS motivation,
              to_regclass('public.master_rate_history') AS rates`,
    );
    if (Object.values(rows[0]).some((v) => v === null)) {
      t.skip('SALARY_LIVE_DB указывает не на мигрированную БД приложения (нет таблиц зарплаты) — LIVE пропущен');
      return;
    }
    await client.query('BEGIN');
    try {
      await scenario(savepointPool(client), client);
    } finally {
      await client.query('ROLLBACK');
    }
  } finally {
    await client.end();
  }
}

/** Тенант в поясе Москвы + директор + мастер; при `checkAt` — чек мастера на 30 000 работ в этот момент. */
async function seedLiveTenant(client, { checkAt = null, work = 30000 } = {}) {
  const {
    rows: [tenant],
  } = await client.query(`INSERT INTO tenants (name, timezone) VALUES ($1, 'Europe/Moscow') RETURNING id`, [
    `A3 live ${process.pid}-${Date.now()}`,
  ]);
  const person = async (role, fullName) =>
    (
      await client.query(
        `INSERT INTO users (tenant_id, phone, password, full_name, role)
         VALUES ($1, '+7' || lpad((floor(random() * 1e10))::bigint::text, 10, '0'), 'x', $2, $3) RETURNING id`,
        [tenant.id, fullName, role],
      )
    ).rows[0].id;
  const directorId = await person('director', 'Директор A3');
  const masterId = await person('master', 'Мастер A3');
  if (checkAt) {
    const {
      rows: [check],
    } = await client.query(
      `INSERT INTO checks (tenant_id, master_id, date) VALUES ($1, $2, $3::timestamptz) RETURNING id`,
      [tenant.id, masterId, checkAt],
    );
    await client.query(
      `INSERT INTO check_service_lines (check_id, master_id, name, salary_amount) VALUES ($1, $2, 'Работа', $3)`,
      [check.id, masterId, work],
    );
  }
  return { tenantID: tenant.id, directorId, masterId };
}

/** Полный календарный месяц 'YYYY-MM' как диапазон [1-е, последнее число] — то, что шлют мобильные клиенты. */
const monthRange = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { dateFrom: `${ym}-01`, dateTo: `${ym}-${String(last).padStart(2, '0')}` };
};

/** Сервисы, собранные на одном транзакционном пуле, и короткие обёртки над отчётами и лентой. */
function liveKit(pool, tenantID) {
  const expenses = new ExpensesService(pool);
  const push = { sendDataToTenant: () => Promise.resolve(), sendToUserInTenant: () => {} };
  const schedule = { buildShiftFilter: async () => null };
  const salary = new SalaryService(pool, push, expenses, schedule, {});
  const ctxOf = (range) => ({ tenantId: tenantID, pointId: null, tz: MSK, ids: [], ...range });
  const kpiOf = (report) => Object.fromEntries(report.kpis.map((k) => [k.key, k.value]));
  return {
    expenses,
    salary,
    ctxOf,
    kpiOf,
    salaryReport: (range) => new SalaryBuilder(pool, salary).build(ctxOf(range)),
    expensesReport: (range) => new ExpensesBuilder(pool).build(ctxOf(range)),
    paidTotal: (range) => salaryPaidTotal(pool, ctxOf(range)),
    feed: (range, attribution) => expenses.getAll(tenantID, attribution ? { ...range, attribution } : { ...range }),
  };
}

test(
  'D: LIVE — выплата «за прошлый месяц», выданная сегодня: отчёты и экран — в прошлом месяце, лента расходов — в текущем',
  LIVE,
  async (t) => {
    await withLiveTx(t, async (pool, client) => {
      const { tenantID, directorId, masterId } = await seedLiveTenant(client, {
        checkAt: `${PREV}-15T12:00:00+03:00`,
      });
      const kit = liveKit(pool, tenantID);
      const { salary, expenses, kpiOf } = kit;
      const prev = monthRange(PREV);
      const cur = monthRange(CUR);
      const listRow = (list) => list.find((r) => r.masterId === masterId);
      const reportRow = (report) => report.rows.find((r) => r.name === 'Мастер A3');
      const carryOver = async () => (await salary.getEmployeeMonth(tenantID, masterId, CUR)).carryOver;

      // ── До выплаты: мастер заработал 30 000 в прошлом месяце и ничего не получил ──
      assert.deepEqual(
        await carryOver(),
        { total: 30000, months: [{ month: PREV, remaining: 30000 }] },
        'карточка текущего месяца: «Не выплачено за прошлые месяцы» — август 30 000',
      );
      assert.equal(
        listRow(await salary.getAll(tenantID, cur)).carryOverAmount,
        30000,
        'список: долг за прошлые месяцы',
      );
      const cardPrevBefore = await salary.getEmployeeMonth(tenantID, masterId, PREV);
      assert.equal(cardPrevBefore.totalEarnings, 30000, 'карточка прошлого месяца: заработано 30 000');
      assert.equal(cardPrevBefore.remainingAmount, 30000);
      assert.equal(
        (await carryOver()).months.find((m) => m.month === PREV).remaining,
        cardPrevBefore.remainingAmount,
        'самоконтроль: remaining из carryOver месяца == remaining карточки этого месяца',
      );

      // ── Первая выплата: 12 000 «за прошлый месяц», выданные сегодня (частично) ─────
      const first = await salary.createPayout(tenantID, directorId, {
        employeeId: masterId,
        type: 'salary',
        amount: 12000,
        periodMonth: PREV,
      });
      assert.equal(first.periodMonth, PREV);
      assert.ok(first.expenseId, 'зеркальный расход создан');
      assert.deepEqual(await carryOver(), { total: 18000, months: [{ month: PREV, remaining: 18000 }] });
      assert.equal(
        (await salary.getEmployeeMonth(tenantID, masterId, PREV)).remainingAmount,
        18000,
        'и карточка прошлого месяца видит остаток 18 000',
      );

      // ── Вторая выплата закрывает месяц целиком: 30 000 = 12 000 + 18 000 ──────────
      await salary.createPayout(tenantID, directorId, {
        employeeId: masterId,
        type: 'salary',
        amount: 18000,
        periodMonth: PREV,
      });
      assert.deepEqual(await carryOver(), { total: 0, months: [] }, 'долгов за прошлые месяцы не осталось');
      assert.equal(listRow(await salary.getAll(tenantID, cur)).carryOverAmount, 0);

      // ── Отчёт «По зарплатам»: выплата стоит в прошлом месяце, а не в сегодняшнем ──
      const salaryPrev = await kit.salaryReport(prev);
      assert.deepEqual(
        {
          accrued: reportRow(salaryPrev).accrued,
          paid: reportRow(salaryPrev).paid,
          remaining: reportRow(salaryPrev).remaining,
        },
        { accrued: 30000, paid: 30000, remaining: 0 },
        'август: начислено 30 000, выплачено 30 000, остаток 0',
      );
      assert.equal(kpiOf(salaryPrev).paid, 30000);
      assert.equal(kpiOf(salaryPrev).remaining, 0);
      const salaryCur = await kit.salaryReport(cur);
      assert.equal(kpiOf(salaryCur).paid, 0, 'сентябрь: выплаты «за август» здесь нет');
      assert.equal(reportRow(salaryCur)?.paid ?? 0, 0);
      assert.equal(salaryCur.sections[0].rows.length, 0, 'и в движениях сентября её нет');
      assert.equal(salaryPrev.sections[0].rows.length, 2, 'а в движениях августа — обе выплаты, датой выдачи');

      // Отчёт == экран «Зарплата» за тот же период (до копейки).
      const screenPrev = listRow(await salary.getAll(tenantID, prev));
      assert.equal(screenPrev.paidAmount, reportRow(salaryPrev).paid, 'выплачено: экран == отчёт');
      assert.equal(screenPrev.remainingAmount, reportRow(salaryPrev).remaining, 'остаток: экран == отчёт');
      assert.equal(listRow(await salary.getAll(tenantID, cur)).paidAmount, 0);

      // ── «Сводный»: KPI «Зарплата выплачено» ─────────────────────────────────────
      assert.equal(await kit.paidTotal(prev), 30000, 'сводный за август: зарплата выплачено 30 000');
      assert.equal(await kit.paidTotal(cur), 0, 'сводный за сентябрь: 0');

      // ── «По расходам»: расход выплаты — в месяце «за который» ───────────────────
      const expensesPrev = await kit.expensesReport(prev);
      assert.equal(kpiOf(expensesPrev).salary, 30000, 'август: «Из них зарплата» 30 000');
      assert.equal(kpiOf(expensesPrev).total, 30000);
      const expensesCur = await kit.expensesReport(cur);
      assert.equal(kpiOf(expensesCur).salary, 0, 'сентябрь: зарплаты в расходах нет');
      assert.equal(kpiOf(expensesCur).total, 0);

      // ── Лента расходов (касса): по умолчанию — по факту, attribution=period — по месяцу «за» ──
      const payroll = (rows) => rows.filter((r) => r.categoryName === 'Зарплата');
      const byDateCur = payroll(await kit.feed(cur));
      assert.equal(byDateCur.length, 2, 'касса текущего месяца: обе выдачи стоят в дне выдачи');
      assert.ok(
        byDateCur.every((r) => r.periodMonth === PREV),
        'и несут бейдж «за прошлый месяц»',
      );
      assert.equal(
        byDateCur.reduce((s, r) => s + r.amount, 0),
        30000,
      );
      assert.equal(payroll(await kit.feed(prev)).length, 0, 'касса прошлого месяца выплаты не видит');
      assert.equal(payroll(await kit.feed(prev, 'date')).length, 0, 'attribution=date == поведению по умолчанию');
      assert.equal(
        payroll(await kit.feed(prev, 'period')).length,
        2,
        'attribution=period: обе выплаты — в прошлом месяце',
      );
      assert.equal(payroll(await kit.feed(cur, 'period')).length, 0, 'attribution=period: в текущем их нет');
      await assert.rejects(kit.feed(cur, 'garbage'), httpError(400, /attribution/), 'мусор в attribution — 400');

      // Замок: зеркальный расход выплаты месяц не меняет (это делает сама выплата).
      await assert.rejects(
        expenses.update(first.expenseId, { tenantID, userID: directorId, role: 'director' }, { periodMonth: CUR }),
        httpError(400, /задаётся самой выплатой/),
      );
    });
  },
);

test(
  'D: LIVE — месяц по умолчанию, будущий месяц, легаси-строки без месяца, легаси-платёж, замок и лента ручного расхода',
  LIVE,
  async (t) => {
    await withLiveTx(t, async (pool, client) => {
      const { tenantID, directorId, masterId } = await seedLiveTenant(client);
      const kit = liveKit(pool, tenantID);
      const { salary, expenses, kpiOf } = kit;
      const prev = monthRange(PREV);
      const cur = monthRange(CUR);
      const actor = { tenantID, userID: directorId, role: 'director' };
      const rowOf = (list) => list.find((r) => r.masterId === masterId);
      const payoutsCount = async () =>
        (await client.query(`SELECT count(*)::int AS n FROM salary_payouts WHERE tenant_id = $1`, [tenantID])).rows[0]
          .n;

      // Месяц не указан -> месяц факта (в поясе тенанта), а не NULL.
      const byDefault = await salary.createPayout(tenantID, directorId, {
        employeeId: masterId,
        type: 'advance',
        amount: 4000,
      });
      assert.equal(byDefault.periodMonth, CUR, 'без periodMonth выплата встаёт в месяц выдачи');
      const { rows: stored } = await client.query(`SELECT period_month FROM salary_payouts WHERE id = $1`, [
        byDefault.id,
      ]);
      assert.equal(stored[0].period_month, CUR, 'в БД — не NULL');

      // Будущий месяц и мусор — 400 без записи.
      for (const bad of [NEXT, '2026-13', '2026-9']) {
        await assert.rejects(
          salary.createPayout(tenantID, directorId, {
            employeeId: masterId,
            type: 'salary',
            amount: 100,
            periodMonth: bad,
          }),
          httpError(400, /.+/),
          `periodMonth «${bad}» отклонён`,
        );
      }
      assert.equal(await payoutsCount(), 1, 'отказы ничего не записали');

      // Строки, которых createPayout уже не создаёт, но в базе они есть: без месяца (до правки №3)
      // считаются по дате факта, а выплата в НЕ НАЧАВШИЙСЯ месяц не притягивается ни к одному периоду.
      await client.query(
        `INSERT INTO salary_payouts (tenant_id, employee_id, type, amount, status, period_month, created_by)
         VALUES ($1, $2, 'advance', 1000, 'accepted', NULL, $3)`,
        [tenantID, masterId, directorId],
      );
      await client.query(
        `INSERT INTO salary_payouts (tenant_id, employee_id, type, amount, status, period_month, created_by)
         VALUES ($1, $2, 'salary', 7000, 'accepted', $4, $3)`,
        [tenantID, masterId, directorId, NEXT],
      );
      assert.equal(
        await kit.paidTotal(cur),
        5000,
        'текущий месяц: 4 000 (месяц по умолчанию) + 1 000 (NULL — по факту)',
      );
      assert.equal(await kit.paidTotal(prev), 0);
      assert.equal(
        await kit.paidTotal({ dateFrom: `${PREV}-01`, dateTo: monthRange(NEXT).dateTo }),
        5000,
        'даже диапазон, накрывающий будущий месяц, 7 000 «за ещё не наступивший» не притягивает',
      );
      assert.equal(rowOf(await salary.getAll(tenantID, cur)).paidAmount, 5000, 'экран == сводный');
      const salaryCur = await kit.salaryReport(cur);
      assert.equal(kpiOf(salaryCur).paid, 5000, '«По зарплатам»: то же число');

      // Легаси-платёж (старый flow, /salary/payments): расход-зеркало несёт month_year в period_month.
      const legacy = await salary.createPayment(tenantID, directorId, {
        userId: masterId,
        amount: 500,
        monthYear: PREV,
        type: 'salary',
      });
      const { rows: mirror } = await client.query(
        `SELECT e.period_month, e.amount FROM salary_payments sp JOIN expenses e ON e.id = sp.expense_id WHERE sp.id = $1`,
        [legacy.id],
      );
      assert.equal(mirror.length, 1, 'у легаси-платежа есть зеркальный расход');
      assert.equal(mirror[0].period_month, PREV, 'зеркало легаси-платежа — в месяце «за который»');
      assert.equal(await kit.paidTotal(prev), 500, 'легаси-платёж «за прошлый месяц» — в прошлом месяце');
      assert.equal(await kit.paidTotal(cur), 5000, 'и не задваивается в текущем');

      // Замок period_month у зеркала выплаты: то же значение — no-op, другое и null — 400.
      const locked = /задаётся самой выплатой/;
      const same = await expenses.update(byDefault.expenseId, actor, { periodMonth: CUR });
      assert.equal(same.periodMonth, CUR, 'то же значение игнорируется и не роняет форму');
      await assert.rejects(expenses.update(byDefault.expenseId, actor, { periodMonth: PREV }), httpError(400, locked));
      await assert.rejects(expenses.update(byDefault.expenseId, actor, { periodMonth: null }), httpError(400, locked));
      await assert.rejects(
        expenses.update(byDefault.expenseId, actor, { amount: 1 }),
        httpError(400, /зеркальный расход/),
      );

      // Ручной расход: месяц «за который» назначается и снимается, лента переключается.
      const manual = await expenses.create(actor, { amount: 2500, description: 'Аренда A3', periodMonth: PREV });
      assert.equal(manual.periodMonth, PREV);
      const rent = (rows) => rows.filter((r) => r.description === 'Аренда A3').length;
      assert.equal(rent(await kit.feed(cur)), 1, 'по факту (по умолчанию) — в текущем месяце');
      assert.equal(rent(await kit.feed(prev)), 0);
      assert.equal(rent(await kit.feed(prev, 'period')), 1, 'attribution=period — в прошлом');
      assert.equal(rent(await kit.feed(cur, 'period')), 0);
      assert.equal(
        kpiOf(await kit.expensesReport(prev)).total,
        3000,
        '«По расходам» прошлого месяца: аренда 2 500 + зеркало легаси 500',
      );

      const cleared = await expenses.update(manual.id, actor, { periodMonth: null });
      assert.equal(cleared.periodMonth, null, 'месяц снят');
      assert.equal(rent(await kit.feed(prev, 'period')), 0, 'без назначенного месяца расход в прошлый не попадает');
      assert.equal(rent(await kit.feed(cur, 'period')), 1, 'а стоит по дате факта — в текущем');
      await assert.rejects(expenses.update(manual.id, actor, { periodMonth: '2026-13' }), httpError(400, /YYYY-MM/));
    });
  },
);
