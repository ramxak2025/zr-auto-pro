const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

/**
 * 167 — ФИЛИАЛ У ГРАФИКА, ПЛАНА ПОСТОЯННЫХ РАСХОДОВ И ЗАПИСЕЙ.
 *
 * Жалоба владельца (2026-09-13): «после последних правок перестало работать
 * расписание — невозможно отметить, кто пришёл, кто опоздал» и «когда
 * переключаюсь между филиалами, данные с основной точки там: расписание,
 * постоянные расходы и так далее — это отдельные автосервисы».
 *
 * Два корня, оба охраняются здесь:
 *   1. ensureShiftOpen считал филиал агрегатом MIN(uuid) — в PostgreSQL 16 его
 *      НЕТ, каждая отметка прихода падала с 500 (строка графика при этом уже
 *      была записана — клиент откатывал отметку, при обновлении она
 *      появлялась). Теперь филиал смены = филиал строки графика, параметром.
 *   2. У графика / плана / записей не было своего point_id: филиал выражался
 *      составом команды, а сотрудник без назначений виден везде — у тенанта,
 *      не расставившего людей, оба автосервиса показывали одно и то же.
 *
 * Тест статический (читает исходники и миграцию), как соседние points-*:
 * живой БД в CI нет. SQL миграции дополнительно прогнан на PostgreSQL 16
 * локально (см. docs/ios-redesign/POINT_SCHEDULE_PLANNING_2026-09-13.md).
 */

const backendRoot = join(__dirname, '..');
const read = (relativePath) => readFileSync(join(backendRoot, relativePath), 'utf8');
const stripComments = (src) => src.replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');

const migration = read('migrations/167_schedule_planning_bookings_point.sql');
const schedule = read('src/schedule/schedule.service.ts');
const scheduleController = read('src/schedule/schedule.controller.ts');
const planning = read('src/planning/planning.service.ts');
const planningController = read('src/planning/planning.controller.ts');
const bookings = read('src/bookings/bookings.service.ts');
const reports = read('src/reports/reports.service.ts');
const salary = read('src/salary/salary.service.ts');
const employees = read('src/employees/employees.service.ts');
const points = read('src/points/points.service.ts');
const pointScope = read('src/common/point-scope.ts');

// ── 1. Миграция: три колонки, привязка истории, без min/max(uuid) ───────────

test('167: point_id у schedule_entries / fixed_costs / bookings, идемпотентно', () => {
  for (const table of ['schedule_entries', 'fixed_costs', 'bookings']) {
    const re = new RegExp(
      `ALTER TABLE ${table}\\s+ADD COLUMN IF NOT EXISTS point_id UUID REFERENCES tenant_points\\(id\\) ON DELETE SET NULL`,
    );
    assert.ok(re.test(migration), `${table}: колонка point_id обязана добавляться идемпотентно (IF NOT EXISTS)`);
    assert.ok(
      new RegExp(`UPDATE ${table} \\w+\\s+SET point_id = [\\s\\S]{0,600}?WHERE \\w+\\.point_id IS NULL`).test(migration),
      `${table}: история без филиала обязана привязываться, и только она (point_id IS NULL)`,
    );
  }
  assert.ok(/CREATE INDEX IF NOT EXISTS idx_schedule_entries_tenant_point_date/.test(migration));
  assert.ok(/CREATE INDEX IF NOT EXISTS idx_bookings_tenant_point_scheduled/.test(migration));
  assert.ok(/CREATE OR REPLACE FUNCTION autexa_point_by_live_assignment/.test(migration));
  // Причина регрессии 3.7.0 — агрегат по uuid. В 167 его быть не должно нигде.
  const sql = migration.replace(/^\s*--.*$/gm, '');
  assert.ok(!/\b(min|max)\s*\(\s*[\w.]*id\s*\)/i.test(sql), 'в миграции агрегат min/max по uuid-колонке');
  assert.ok(/array_agg\(x\.point_id\)\)\[1\]/.test(sql), 'единственное назначение берётся через array_agg, не через min(uuid)');
});

test('167: привязка истории — тот же порядок свидетелей, что в PointsService', () => {
  // Запись: филиал чека → живое назначение мастера → основной сервис.
  const bookingsOrder = /SELECT ch\.point_id FROM checks ch[\s\S]{0,200}autexa_point_by_live_assignment\(b\.tenant_id, b\.master_id\)[\s\S]{0,60}mp\.main_id/;
  assert.ok(bookingsOrder.test(migration), 'миграция: у записи порядок свидетелей нарушен');
  assert.ok(bookingsOrder.test(points), 'PointsService: у записи порядок свидетелей нарушен');
  // График: живое назначение → основной.
  const scheduleOrder = /autexa_point_by_live_assignment\(se\.tenant_id, se\.user_id\),\s*mp\.main_id/;
  assert.ok(scheduleOrder.test(migration), 'миграция: у дня графика порядок свидетелей нарушен');
  assert.ok(scheduleOrder.test(points), 'PointsService: у дня графика порядок свидетелей нарушен');
  // План — основному сервису, и только ему.
  assert.ok(/UPDATE fixed_costs fc\s+SET point_id = mp\.main_id/.test(migration));
  assert.ok(/UPDATE fixed_costs fc\s+SET point_id = mp\.main_id/.test(points));
});

// ── 2. Отметка прихода снова работает: филиал смены — параметром ────────────

test('ensureShiftOpen: без агрегатов, филиал смены = филиал строки графика', () => {
  const from = schedule.indexOf('private async ensureShiftOpen(');
  const to = schedule.indexOf('async create(tenantID: string, dto: any');
  assert.ok(from > 0 && to > from, 'ensureShiftOpen / create не найдены');
  const body = stripComments(schedule.slice(from, to));
  assert.ok(!/MIN\(|MAX\(|HAVING/.test(body), 'ensureShiftOpen снова считает филиал агрегатом — min(uuid) в PG16 нет');
  assert.ok(/VALUES \(\$1, \$2, \$3, now\(\), \$4\)/.test(body), 'филиал смены обязан идти параметром');
  // Оба вызывающих передают филиал СТРОКИ (rows[0].point_id), а не актора.
  assert.equal(
    (schedule.match(/ensureShiftOpen\([^)]*rows\[0\]\.point_id \?\? null\)/g) ?? []).length,
    2,
    'create и update обязаны передавать филиал строки графика в ensureShiftOpen',
  );
});

// ── 3. График: день штампуется и режется своим филиалом ─────────────────────

test('график: чтение/запись по schedule_entries.point_id, состав — по назначениям', () => {
  const code = stripComments(schedule);
  assert.ok(/pointFilterSql\('se', actorPointId\(actor\), params\)/.test(code), 'сетка месяца без фильтра по филиалу строки');
  assert.ok(/INSERT INTO schedule_entries \([^)]*point_id\)/.test(code), 'create не штампует филиал');
  assert.ok(/point_id\s*=\s*EXCLUDED\.point_id/.test(code), 'upsert не переносит день в филиал сессии');
  assert.ok(/assertRowPointForWrite\(this\.pool, 'schedule_entries'/.test(code), 'update без гейта филиала');
  assert.ok(/DELETE FROM schedule_entries WHERE id=\$1 AND tenant_id=\$2\$\{pointFilter\}/.test(code), 'remove без гейта филиала');
  // applyWorkMode: команда филиала + штамп.
  assert.ok(/assignedToPointSql\('u', '\$1', pointId, teamParams\)/.test(code), 'applyWorkMode: «все мастера» обязаны быть командой филиала');
  assert.ok(
    /INSERT INTO schedule_entries \(user_id, date, shift_start, shift_end, is_day_off, tenant_id, point_id\)/.test(code),
    'applyWorkMode не штампует филиал',
  );
  // Контроллер передаёт актора во все мутации.
  for (const call of ['create(user.tenantID, dto, user)', 'update(id, user.tenantID, dto, user)', 'remove(id, user.tenantID, user)', 'applyWorkMode(user.tenantID, dto, user)']) {
    assert.ok(scheduleController.includes(call), `schedule.controller: ${call} — актор не передан`);
  }
  // Гейт записи знает новые таблицы.
  for (const table of ["'schedule_entries'", "'fixed_costs'", "'bookings'"]) {
    assert.ok(pointScope.includes(`| ${table}`), `PointScopedTable: нет ${table}`);
  }
});

// ── 4. План постоянных расходов — на каждый автосервис свой ─────────────────

test('планирование: fixed_costs по филиалу, оклады — по команде филиала', () => {
  const code = stripComments(planning);
  assert.ok(/FROM fixed_costs WHERE tenant_id = \$1\$\{pointFilter\}/.test(code), 'список плана не режется филиалом');
  assert.ok(/INSERT INTO fixed_costs \(tenant_id, name, category, monthly_amount, active, point_id\)/.test(code), 'план не штампуется филиалом');
  assert.equal(
    (code.match(/await this\.assertOwnFixedCost\(id, tenantID, pointId\)/g) ?? []).length,
    2,
    'правка и удаление плана обязаны стоять за гейтом филиала',
  );
  assert.ok(/assignedToPointSql\('u', '\$1', pointId, params\)/.test(code), 'оклады не режутся командой филиала');
  for (const call of [
    'listFixedCosts(user.tenantID, actorPointId(user))',
    'createFixedCost(user.tenantID, dto, actorPointId(user))',
    'updateFixedCost(id, user.tenantID, dto, actorPointId(user))',
    'removeFixedCost(id, user.tenantID, actorPointId(user))',
    'listCompensation(user.tenantID, actorPointId(user))',
  ]) {
    assert.ok(planningController.includes(call), `planning.controller: ${call} — филиал не передан`);
  }
  // Accrual-прибыль филиала вычитает ЕГО план и оклады ЕГО команды.
  const r = stripComments(reports);
  assert.ok(/FROM fixed_costs WHERE tenant_id = \$1 AND active = true\$\{fcPointFilter\}/.test(r), 'reports: план постоянки по сети, а не по филиалу');
  assert.ok(/FROM employee_compensation ec\s+JOIN users u ON u\.id = ec\.user_id[\s\S]{0,200}\$\{compTeamFilter\}/.test(r), 'reports: оклады по сети, а не по команде филиала');
});

// ── 5. Записи — свой филиал ─────────────────────────────────────────────────

test('записи: список по bookings.point_id, штамп при создании, гейт на правку/отмену', () => {
  const code = stripComments(bookings);
  assert.ok(/sql \+= ` AND b\.point_id = \$\$\{idx\+\+\}`/.test(code), 'список записей не режется своим филиалом');
  assert.ok(!/up_none\.user_id = b\.master_id/.test(code), 'старый предикат по назначениям мастера остался');
  assert.ok(/notify_on_create, point_id\)/.test(code) && /actorPointId\(user\),\s*\]/.test(code), 'запись не штампуется филиалом сессии');
  assert.equal((code.match(/await this\.assertOwnPoint\(id, user\)/g) ?? []).length, 2, 'правка и отмена записи без гейта филиала');
});

// ── 6. Производные срезы графика тоже по филиалу ───────────────────────────

test('зарплата, карточка сотрудника и алерты считают дни графика своего филиала', () => {
  assert.ok(/pointId: string \| null = null,\s*\): Promise<Map<string, number>>/.test(salary), 'workedShiftsByUser без параметра филиала');
  assert.ok(/this\.workedShiftsByUser\(tenantID, dateFrom, dateTo, pointId\)/.test(salary), 'зарплатный список не передаёт филиал в подсчёт смен');
  assert.equal(
    (stripComments(employees).match(/FROM schedule_entries[\s\S]{0,400}?\$\{\w+PointFilter\}/g) ?? []).length,
    4,
    'карточка сотрудника: не все четыре запроса к графику режутся филиалом',
  );
  assert.ok(/se\.late_status = 'late_major'\$\{latePointFilter\}/.test(reports), 'алерт «опоздавшие сегодня» не режется филиалом');
});

// ── 7. Точка — всегда параметром ────────────────────────────────────────────

test('ни один новый путь не склеивает point_id со значением', () => {
  for (const [name, src] of [
    ['schedule.service', schedule],
    ['planning.service', planning],
    ['bookings.service', bookings],
  ]) {
    const code = stripComments(src);
    assert.ok(!/point_id\s*=\s*'/.test(code), `${name}: point_id сравнивается со строковым литералом`);
    assert.ok(!/point_id\s*=\s*\$\{(?!idx)/.test(code), `${name}: point_id склеен интерполяцией значения`);
  }
});
