const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

/**
 * Аудит 11.09.2026, зона «деньги и учёт». Восемь инвариантов, поломка каждого
 * означает неверные деньги на экране владельца или чужие деньги под рукой
 * сотрудника, а не косметику:
 *
 *   1. ВОЗВРАТ ПО ЧЕКУ ПРОШЛОЙ СМЕНЫ вычитается из ожидаемого остатка ТОЙ
 *      смены, в которой деньги реально выдали, и ровно ОДИН раз.
 *   2. НАЛИЧНЫЕ ПОГАШЕНИЯ РАССРОЧКИ входят в ожидаемый остаток — иначе
 *      Z-отчёт каждый день показывает излишек.
 *   3. ПРЕМИИ И МОТИВАЦИЯ уменьшают чистую прибыль (третий вид зарплатного
 *      начисления рядом с чековым и выплатным).
 *   4. УДАЛЕНИЕ РАСХОДА гейтится филиалом и запрещено для зеркала выплаты.
 *   5. МУТАЦИИ ИМУЩЕСТВА не трогают расход чужого филиала.
 *   6. «МОЯ ЗАРПЛАТА» считает сутки/неделю/месяц в поясе тенанта.
 *   7. ГАРАНТИЯ исключается из выручки ОДНОЙ формулой (common/check-money-sql).
 *   8. СМЕНА, ОТКРЫТАЯ ОТМЕТКОЙ В ГРАФИКЕ, получает филиал, а не NULL.
 *
 * Тест статический (читает исходники) + чистые арифметические модели: живой БД
 * в CI нет, а именно текст этих мест и формулы обязаны оставаться неизменными.
 * Конвенция — points-money-scope / points-scoping.
 */

const backendRoot = join(__dirname, '..');
const read = (relativePath) => readFileSync(join(backendRoot, relativePath), 'utf8');

const returns = read('src/returns/returns.service.ts');
const cashShifts = read('src/cash-shifts/cash-shifts.service.ts');
const reports = read('src/reports/reports.service.ts');
const salaryExtras = read('src/common/salary-extras-sql.ts');
const salary = read('src/salary/salary.service.ts');
const expenses = read('src/expenses/expenses.service.ts');
const expensesController = read('src/expenses/expenses.controller.ts');
const equipment = read('src/equipment/equipment.service.ts');
const equipmentController = read('src/equipment/equipment.controller.ts');
const schedule = read('src/schedule/schedule.service.ts');

/** Тело метода от его сигнатуры до сигнатуры следующего (грубо, но стабильно). */
const bodyBetween = (src, startMarker, endMarker) => {
  const start = src.indexOf(startMarker);
  assert.ok(start > 0, `не найден маркер начала: ${startMarker}`);
  const end = src.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `не найден маркер конца: ${endMarker}`);
  return src.slice(start, end);
};

// ── 1. Возврат прошлой смены: наличная часть пишется и вычитается по дате факта ──

test('возврат сохраняет НАЛИЧНУЮ часть, прочитанную под локом чека', () => {
  assert.ok(
    returns.includes('SELECT id, total_revenue, cash_amount, is_returned FROM checks'),
    'returns.service: cash_amount больше не читается под локом — после реверса исходные наличные чека не восстановить',
  );
  assert.ok(
    returns.includes('const refundCash = round2(Math.min(refundAmount, cashBefore));'),
    'returns.service: наличная часть возврата считается не как LEAST(возврат, наличные чека) — Z-отчёт вычтет из ящика деньги, выданные картой',
  );
  assert.ok(
    returns.includes('refund_amount, refund_cash_amount, scope'),
    'returns.service: refund_cash_amount не пишется в check_returns — кассовой смене неоткуда взять выдачу из ящика',
  );
});

test('миграция 164 идемпотентна и не перетирает значения нового кода', () => {
  const path = 'migrations/164_return_cash_split.sql';
  assert.ok(existsSync(join(backendRoot, path)), 'нет миграции 164 — колонки refund_cash_amount не существует');
  const sql = read(path);
  assert.ok(
    /DO \$\$ BEGIN ALTER TABLE check_returns ADD COLUMN refund_cash_amount/.test(sql),
    'миграция 164: ADD COLUMN не обёрнут в DO-блок — повторный прогон упадёт на duplicate_column',
  );
  assert.ok(
    sql.includes('cr.refund_cash_amount IS NULL'),
    'миграция 164: бэкфилл не ограничен NULL-строками — повторный прогон перетрёт значения, записанные новым кодом',
  );
  assert.ok(
    sql.includes('SET NOT NULL'),
    'миграция 164: колонка осталась NULLable — «неизвестно, сколько выдали из ящика» снова возможно',
  );
});

test('Z-отчёт вычитает возврат по дате ФАКТА и только если продажи нет в окне', () => {
  const figures = bodyBetween(cashShifts, 'private async computeFigures(', 'private static expectedCash(');

  assert.ok(
    figures.includes('COALESCE(SUM(cr.refund_cash_amount), 0) AS cash_returns'),
    'computeFigures: наличные возвраты окна не считаются — возврат по чеку прошлой смены снова даст фантомную недостачу',
  );
  assert.ok(
    figures.includes('cr.created_at >= $2 AND cr.created_at <= $3'),
    'computeFigures: возвраты выбираются не по дате ФАКТА возврата',
  );
  assert.ok(
    figures.includes('AND NOT (ch.date >= $2 AND ch.date <= $3 AND ch.is_deferred = false)'),
    'computeFigures: пропала защита от ДВОЙНОГО вычета — возврат в день продажи уже учтён реверсом cash_amount внутри cashSales',
  );
  assert.ok(
    figures.includes("pointFilterSql('ch', pointId, retParams)"),
    'computeFigures: филиал возврата берётся не у чека — ящик филиала А вычтет возврат филиала Б',
  );
});

// ── 2. Наличные погашения рассрочки в ожидаемом остатке ─────────────────────

test('Z-отчёт прибавляет наличные погашения рассрочки', () => {
  const figures = bodyBetween(cashShifts, 'private async computeFigures(', 'private static expectedCash(');

  assert.ok(
    figures.includes('COALESCE(SUM(p.amount), 0) AS installment_cash'),
    'computeFigures: погашения рассрочки не считаются — Z-отчёт будет показывать излишек каждый день, когда принимают долг',
  );
  assert.ok(
    figures.includes("COALESCE(p.payment_method, 'cash') <> 'card'"),
    'computeFigures: в ящик попадают и карточные погашения — строки до миграции 119 обязаны считаться налом, карта — нет',
  );
  assert.ok(
    figures.includes('p.paid_at >= $2 AND p.paid_at <= $3'),
    'computeFigures: погашения выбираются не по дате платежа',
  );
  assert.ok(
    figures.includes('FROM installment_plans pl ON pl.id = p.plan_id') ||
      figures.includes('JOIN installment_plans pl ON pl.id = p.plan_id'),
    'computeFigures: платёж не связан с планом — филиал по чеку определить нечем',
  );
  assert.ok(
    figures.includes('AND mch.point_id') || figures.includes('AND ch.point_id = $'),
    'computeFigures: филиал погашения не берётся у чека плана — филиал А увидит долги филиала Б',
  );
});

test('формула ожидаемого нала живёт в ОДНОМ месте и её зовут оба пути', () => {
  assert.ok(
    cashShifts.includes(
      'round2(opening + f.cashSales + f.installmentCash - f.cashExpenses - f.cashReturns - f.collectionsTotal)',
    ),
    'cash-shifts: формула ожидаемого остатка изменилась или потеряла слагаемое',
  );
  const calls = cashShifts.match(/CashShiftsService\.expectedCash\(/g) || [];
  assert.equal(
    calls.length,
    2,
    'cash-shifts: ожидаемый остаток считают не ровно два места (живой Z-отчёт + заморозка при закрытии) — копия формулы разъедется',
  );
  assert.ok(
    !/opening \+ figures\.cashSales - figures\.cashExpenses/.test(cashShifts),
    'cash-shifts: вернулась инлайновая копия старой формулы без возвратов и рассрочки',
  );
});

test('«Остаток в кассе» в движении денег считает ящик теми же пятью слагаемыми', () => {
  const wallets = bodyBetween(reports, 'private async getWallets(', '//  Owner dashboard v2');

  assert.ok(
    wallets.includes('AS cash_returns') && wallets.includes('AS installment_cash'),
    'getWallets: ящик считается без возвратов и погашений рассрочки — «Остаток в кассе» разойдётся с ожидаемым остатком Z-отчёта',
  );
  assert.ok(
    wallets.includes('AND NOT (ch.date >= $2 AND ch.date <= now() AND ch.is_deferred = false)'),
    'getWallets: пропала защита от двойного вычета возврата в день продажи',
  );
  assert.ok(
    /\(parseFloat\(f\.installment_cash\) \|\| 0\) -\s*\n\s*\(parseFloat\(f\.cash_expenses\) \|\| 0\) -\s*\n\s*\(parseFloat\(f\.cash_returns\) \|\| 0\) -/.test(
      wallets,
    ),
    'getWallets: слагаемые ящика собраны не так, как в cash-shifts.expectedCash',
  );
});

test('арифметика ожидаемого остатка: возврат вычитается ровно один раз', () => {
  const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  const expected = (opening, f) =>
    round2(
      opening +
        f.cashSales +
        (f.installmentCash || 0) -
        (f.cashExpenses || 0) -
        (f.cashReturns || 0) -
        (f.collectionsTotal || 0),
    );

  // Сценарий A. Продажа 10 000 наличными и возврат 10 000 В ТУ ЖЕ смену.
  // cash_amount чека уже обнулён реверсом → cashSales = 0, и cashReturns = 0
  // (чек В ОКНЕ, поэтому в выборку возвратов он не попадает). Ящик: пусто.
  assert.equal(expected(5000, { cashSales: 0, cashReturns: 0 }), 5000, 'возврат в день продажи вычелся дважды');

  // Сценарий B. Сегодня продали на 3 000 и вернули 10 000 по ВЧЕРАШНЕМУ чеку.
  // Вчерашний чек в окно не входит, его реверс сегодняшних продаж не касается —
  // значит выдача 10 000 обязана уменьшить ожидаемый остаток именно сегодня.
  assert.equal(
    expected(5000, { cashSales: 3000, cashReturns: 10000 }),
    -2000,
    'возврат по чеку прошлой смены не уменьшил ожидаемый остаток — кассир получит фантомную недостачу',
  );

  // Сценарий C. Погашение рассрочки наличными — деньги в ящике, продажи нет.
  assert.equal(
    expected(1000, { cashSales: 0, installmentCash: 4000 }),
    5000,
    'наличное погашение рассрочки не попало в ожидаемый остаток — Z-отчёт покажет излишек',
  );

  // Сценарий D. Всё вместе + расход и инкассация.
  assert.equal(
    expected(2000, {
      cashSales: 50000,
      installmentCash: 7000,
      cashExpenses: 1500,
      cashReturns: 3000,
      collectionsTotal: 40000,
    }),
    14500,
    'суммарная формула ожидаемого остатка изменилась',
  );
});

// ── 3. Премии и мотивация уменьшают прибыль ─────────────────────────────────

test('общий модуль считает премией только деньги, а не бонус к ставке', () => {
  assert.ok(
    salaryExtras.includes("CASE WHEN ${alias}.type = 'cash'"),
    'salary-extras-sql: в прибыль попал rate_bonus — процент к ставке уже запечён в зарплатные колонки чеков, это двойной вычет',
  );
  assert.ok(
    salaryExtras.includes('mch.check_id') || salaryExtras.includes('mch.id = ${alias}.check_id'),
    'salary-extras-sql: филиал мотивации берётся не у чека — своей точки у строки мотивации нет',
  );
});

test('финотчёт вычитает премии и мотивацию и показывает их отдельными строками', () => {
  const financial = bodyBetween(reports, 'async getFinancial(', 'private async salaryExtrasForPeriod(');

  assert.ok(
    /const netProfit = grossProfit - salaries - otherExpenses - warrantyLoss - extras\.total;/.test(financial),
    'getFinancial: премии и мотивация снова не уменьшают прибыль — владелец видит прибыль выше фактической на сумму выданных мастерам денег',
  );
  assert.ok(
    /premiums: extras\.premiums/.test(financial) && /motivation: extras\.motivation/.test(financial),
    'getFinancial: премии/мотивация не отдаются отдельными строками — владелец не увидит, из чего сложилась разница',
  );

  const extras = bodyBetween(
    reports,
    'private async salaryExtrasForPeriod(',
    'private async salaryExtrasForDashboard(',
  );
  assert.ok(
    extras.includes("sp.period_month_year ~ '^\\\\d{4}-\\\\d{2}$'"),
    'salaryExtrasForPeriod: кривой period_month_year уронит to_date и весь отчёт',
  );
  assert.ok(
    extras.includes("pointFilterSql('sp', pointId, premParams)"),
    'salaryExtrasForPeriod: премии не режутся филиалом — прибыль филиала А уменьшится на премии филиала Б',
  );
  assert.ok(
    extras.includes("motivationPointFilterSql('ma', '$1', pointId, motParams)"),
    'salaryExtrasForPeriod: мотивация не режется филиалом',
  );
});

test('дашборд вычитает премии/мотивацию во ВСЕХ ногах прибыли', () => {
  const dash = bodyBetween(reports, 'private async computeDashboardV2(', 'async clientsNewVsReturning(');

  assert.ok(
    /const netProfitToday = profitToday - expToday - salaryExtras\.today;/.test(dash),
    'computeDashboardV2: «прибыль сегодня» не учитывает премии/мотивацию дня',
  );
  assert.ok(
    /const netProfitMonth = profitMonth - expMonth - salaryExtras\.month;/.test(dash),
    'computeDashboardV2: «прибыль за месяц» не учитывает премии/мотивацию месяца',
  );
  assert.ok(
    /const prevNet = prevProfit - expPrevMonth - salaryExtras\.prevWindow;/.test(dash),
    'computeDashboardV2: окно сравнения маржи не вычитает премии — marginPctChange покажет фантомное падение',
  );
  assert.ok(
    /mtdRecurringExcess -\s*\n\s*mtdSalaryExtras;/.test(dash),
    'computeDashboardV2: accrual-прибыль (mtd) не вычитает премии — инвариант «без планового конфига mtd.netProfit === netProfitMonth» сломан',
  );
  assert.ok(
    /projRecurringExcess -\s*\n\s*projSalaryExtras;/.test(dash),
    'computeDashboardV2: прогноз на месяц не вычитает премии',
  );
  assert.ok(
    /const projSalaryExtras = mtdSalaryExtras \* runRateFactor;/.test(dash),
    "computeDashboardV2: премии в прогнозе считаются сунк-стоимостью — они ongoing и обязаны run-rate'иться",
  );
});

test('арифметика: без планового конфига accrual-прибыль совпадает с кассовой', () => {
  // Модель — дословно ветки computeDashboardV2 без планового конфига.
  const model = ({ profitMonth, expMonth, extrasMonth }) => {
    const hasPlannedConfig = false;
    const mtdOneOff = hasPlannedConfig ? 0 : expMonth;
    const mtdNetProfit = profitMonth - 0 - 0 - 0 - 0 - mtdOneOff - 0 - extrasMonth;
    const netProfitMonth = profitMonth - expMonth - extrasMonth;
    return { mtdNetProfit, netProfitMonth };
  };

  for (const extrasMonth of [0, 1, 25000]) {
    const { mtdNetProfit, netProfitMonth } = model({ profitMonth: 300000, expMonth: 80000, extrasMonth });
    assert.equal(mtdNetProfit, netProfitMonth, 'accrual-прибыль разъехалась с кассовой на сумму премий');
  }

  // И сама честность: премия 25 000 обязана уменьшить прибыль ровно на 25 000.
  const withoutPremium = model({ profitMonth: 300000, expMonth: 80000, extrasMonth: 0 }).netProfitMonth;
  const withPremium = model({ profitMonth: 300000, expMonth: 80000, extrasMonth: 25000 }).netProfitMonth;
  assert.equal(withoutPremium - withPremium, 25000, 'премия не уменьшила прибыль на свою сумму');
});

// ── 4. Удаление расхода ─────────────────────────────────────────────────────

test('удаление расхода гейтится филиалом', () => {
  assert.ok(
    /async remove\(id: string, tenantID: string, actor\?: JwtPayload\) \{/.test(expenses),
    'expenses.remove: актор не принимается — филиал проверять нечем',
  );
  const remove = bodyBetween(expenses, 'async remove(id: string, tenantID: string', 'async recordSalaryExpense(');
  assert.ok(
    remove.includes('await this.assertOwnPoint(id, tenantID, actor);'),
    'expenses.remove: пропал гейт филиала — актор филиала А снова стирает расход филиала Б',
  );
  assert.ok(
    /this\.expensesService\.remove\(id, user\.tenantID, user\)/.test(expensesController),
    'expenses.controller: актор не передаётся в remove — гейт получит undefined и пропустит всё',
  );
});

test('расход-зеркало выплаты зарплаты удалить нельзя', () => {
  const remove = bodyBetween(expenses, 'async remove(id: string, tenantID: string', 'async recordSalaryExpense(');
  assert.ok(
    remove.includes('FROM salary_payouts WHERE expense_id = $1'),
    'expenses.remove: не проверяется связь с выплатой нового flow (salary_payouts)',
  );
  assert.ok(
    remove.includes('FROM salary_payments WHERE expense_id = $1'),
    'expenses.remove: не проверяется связь с легаси-выплатой (salary_payments)',
  );
  assert.ok(
    /отмените саму выплату/.test(remove),
    'expenses.remove: пользователю не подсказано отменять выплату, а не расход',
  );
  // Сторно выплаты по-прежнему удаляет расход НАПРЯМУЮ, минуя remove(), — иначе
  // отмена выплаты стала бы невозможной.
  assert.ok(
    salary.includes('DELETE FROM expenses WHERE id = $1 AND tenant_id = $2'),
    'salary: сторно выплаты больше не удаляет свой расход напрямую — новый запрет заблокирует отмену выплаты',
  );
});

// ── 5. Имущество не трогает расход чужого филиала ───────────────────────────

test('мутации имущества проверяют филиал связанного расхода', () => {
  assert.ok(
    equipment.includes('private assertExpensePoint(') && equipment.includes('assertRowPointForWrite('),
    'equipment: нет гейта филиала на зеркальном расходе — админ филиала А вернёт в оборот деньги филиала Б',
  );
  const calls = equipment.match(/await this\.assertExpensePoint\(client,/g) || [];
  assert.equal(
    calls.length,
    2,
    'equipment: гейт стоит не на обоих путях (правка цены и удаление карточки) — открытая дверь остаётся',
  );
  assert.ok(
    /removeStorageItem\(id: string, tenantId: string, reverseExpense = false, pointId: string \| null = null\)/.test(
      equipment,
    ),
    'equipment.removeStorageItem: филиал не принимается — гейту нечего проверять',
  );
  assert.ok(
    /removeStorageItem\(id, user\.tenantID, reverseExpense, actorPointId\(user\)\)/.test(equipmentController),
    'equipment.controller: филиал сессии не передаётся в удаление карточки',
  );
});

// ── 6. «Моя зарплата» — сутки в поясе тенанта ───────────────────────────────

test('«Моя зарплата» режет сутки/неделю/месяц по поясу автосервиса', () => {
  const getMy = bodyBetween(salary, 'async getMy(tenantID: string, userID: string)', '// ─── Payouts');

  assert.ok(
    getMy.includes('startOfDayInZone(tz, now)') &&
      getMy.includes('startOfWeekInZone(tz, now)') &&
      getMy.includes('startOfMonthInZone(tz, now)'),
    'salary.getMy: границы периодов считаются не в поясе тенанта — у мастера восточнее Москвы «сегодня» начинается посреди рабочего дня',
  );
  assert.ok(
    !/new Date\(now\.getFullYear\(\), now\.getMonth\(\)/.test(getMy),
    'salary.getMy: вернулась арифметика по локали контейнера (UTC)',
  );
  assert.ok(
    getMy.includes('zonedDateKey(now, tz)'),
    'salary.getMy: окно отработанных смен считается не по календарю тенанта — «ЗП за день» разъедется с начислениями',
  );
});

// ── 7. Гарантия — одной формулой из общего модуля ───────────────────────────

test('выручка отчётов считается общим модулем, а не копиями формулы', () => {
  const funnel = bodyBetween(reports, 'async getCallFunnel(', 'async getCashFlow(');
  assert.ok(
    funnel.includes("SUM(${checkRevenueExpr('ch')})"),
    'getCallFunnel: выручка воронки снова включает гарантию — конверсия в рублях раздувается бесплатным ремонтом',
  );

  const dow = bodyBetween(reports, 'async bestDayOfWeek(', 'async recentReviews(');
  assert.ok(
    dow.includes('SUM(${checkRevenueExpr()})'),
    'bestDayOfWeek: «лучший день недели» снова считается с гарантией — планировать загрузку по нему нельзя',
  );

  const tags = bodyBetween(reports, 'async getTagAnalytics(', 'async getDefectWriteoffReport(');
  assert.ok(
    tags.includes("SUM(${checkRevenueExpr('ch')})") && tags.includes("SUM(${checkProfitExpr('ch')})"),
    'getTagAnalytics: вернулась дословная копия формул выручки и прибыли вместо общего модуля',
  );

  // LTV клиента — обе реализации удержания.
  const ltvMatches = reports.match(/SUM\(\$\{checkRevenueExpr\(\)\}\) AS ltv/g) || [];
  assert.equal(
    ltvMatches.length,
    2,
    'retention/retentionForWindow: LTV считается не общей формулой в обоих местах — гарантийный визит снова «принёс деньги»',
  );

  assert.ok(!/SUM\(total_revenue\) AS ltv/.test(reports), 'reports: остался сырой SUM(total_revenue) в LTV');
});

// ── 8. Смена, открытая отметкой в графике, получает филиал ──────────────────

test('автооткрытая смена штампуется филиалом, а не NULL', () => {
  const ensure = bodyBetween(schedule, 'private async ensureShiftOpen(', 'async create(tenantID: string, dto: any');

  assert.ok(
    ensure.includes('INSERT INTO shifts (user_id, date, tenant_id, opened_at, point_id)'),
    'schedule.ensureShiftOpen: смена снова рождается без филиала — человек на работе, а филиал показывает ноль',
  );
  // 167 — филиал смены = филиал СТРОКИ ГРАФИКА, приходит параметром.
  assert.ok(
    /VALUES \(\$1, \$2, \$3, now\(\), \$4\)/.test(ensure),
    'schedule.ensureShiftOpen: филиал смены обязан приходить готовым параметром (филиал строки графика)',
  );
  assert.ok(
    ensure.includes('pointId: string | null'),
    'schedule.ensureShiftOpen: сигнатура обязана принимать филиал строки графика',
  );
  // РЕГРЕССИЯ 3.7.0: MIN(uuid) не существует в PostgreSQL 16 — каждая отметка
  // «пришёл/опоздал» падала с 500. Никаких агрегатов по uuid в этом пути.
  assert.ok(
    !/MIN\(|MAX\(|HAVING COUNT/.test(ensure),
    'schedule.ensureShiftOpen: агрегат по uuid — min/max(uuid) в Postgres 16 нет, отметка прихода снова упадёт с 500',
  );
});
