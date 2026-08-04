const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

/**
 * Round 16 salary hotfix — стражи денежных инвариантов getAll (adversarial-ревью).
 *
 *   HIGH — путь к ДВОЙНОЙ выплате: getAll.paidAmount суммировал ТОЛЬКО legacy
 *     salary_payments; принятые salary_payouts (confirm-flow, единственный путь
 *     мобилки) НЕ вычитались → remainingAmount показывал полный остаток →
 *     кнопка «Выдать · остаток» (R16) давала ПОВТОРНУЮ выдачу. Контракт: getAll
 *     вычитает status='accepted' salary_payouts, точным зеркалом карточки
 *     getEmployeeMonth (paidAmount = acceptedPayoutsAmount + legacyPaidAmount).
 *
 *   MEDIUM — премии/выплаты завышали веб-срезы < месяца: getMonthYearsForRange
 *     разворачивал ЛЮБОЙ диапазон в целые месяцы (IN) → узкий срез, задевший
 *     границу месяца, тянул премии/выплаты ДВУХ ЦЕЛЫХ месяцев. Контракт:
 *     атрибуция через periodMonthMembership — период-строка включается только
 *     когда диапазон покрывает месяц-к-дате; строка без периода — по дате факта.
 *
 * Часть 1 — статические стражи по исходнику (backend без тестовой БД, конвенция
 * salary-attribution.test.cjs). Часть 2 — живой сценарий на реальном Postgres,
 * запускается ТОЛЬКО когда задан SALARY_LIVE_DB (throwaway-инстанс); в CI и
 * обычном `npm test` пропускается, чтобы прогон оставался быстрым и без БД.
 */

const service = readFileSync(join(__dirname, '..', 'src', 'salary', 'salary.service.ts'), 'utf8');

// ── Часть 1. Статические стражи ──────────────────────────────────────────────

test('HIGH: getAll вычитает принятые salary_payouts (status=accepted), а не только legacy', () => {
  assert.match(
    service,
    /FROM salary_payouts p\s+WHERE p\.tenant_id = \$1\s+AND p\.status = 'accepted'\s+AND \$\{monthMember\('p\.period_month', 'p\.created_at'\)\}/,
    'должен быть агрегат принятых выплат по месяцу (зеркало getEmployeeMonth)',
  );
});

test('HIGH: paidAmount = acceptedPayoutsAmount + legacyPaidAmount (список == карточка)', () => {
  assert.match(
    service,
    /const acceptedPayoutsAmount = acceptedPayoutsByUser\[masterId\] \|\| 0;\s+const paidAmount = acceptedPayoutsAmount \+ legacyPaidAmount;/,
    'paidAmount обязан складывать принятые payouts и legacy payments',
  );
  assert.match(
    service,
    /remainingAmount: totalEarnings - paidAmount - penaltiesAmount/,
    'остаток по-прежнему = заработано − выплачено − штрафы',
  );
});

test('MEDIUM: premiums и legacy payments в getAll — через periodMonthMembership', () => {
  assert.match(service, /monthMember\('sp\.period_month_year', 'sp\.created_at'\)/, 'премии — по membership');
  assert.match(service, /monthMember\('sp\.month_year', 'sp\.date'\)/, 'legacy-выплаты — по membership');
});

test('MEDIUM: старый разворот в целые месяцы удалён (getMonthYearsForRange + IN)', () => {
  assert.doesNotMatch(service, /getMonthYearsForRange\(/, 'метод разворота диапазона (его вызов/определение) должен быть удалён');
  assert.doesNotMatch(service, /month_year IN \(\$\{placeholders\}\)/, 'month_year IN (месяцы) удалён');
  assert.doesNotMatch(service, /premiumMonthExpr\('sp'\)\} IN \(/, 'premiumMonthExpr IN (месяцы) удалён');
});

test('membership: месяц-к-дате (clamp LEAST к сегодня) + fallback по дате факта', () => {
  const idx = service.indexOf('private static periodMonthMembership');
  assert.notEqual(idx, -1, 'helper periodMonthMembership должен существовать');
  const body = service.slice(idx, service.indexOf('private static readonly MONTH_NAMES'));
  // Верхняя граница покрытия clamp-ится к «сегодня-МСК» — [1-е, сегодня]
  // (веб-пресет «Месяц») списывает принятую выплату уже сейчас (money-safe).
  assert.match(body, /LEAST\(\$\{mlast\}, \$\{today\}\)/, 'верх покрытия = LEAST(последнее число, сегодня)');
  assert.match(body, /now\(\) AT TIME ZONE '\$\{tz\}'/, 'сегодня — в бизнес-таймзоне (МСК)');
  // Строка без периода → по дате факта (московский полуинтервал periodPredicate).
  assert.match(body, /periodPredicate\(factCol, dateFrom, dateTo\)/, 'fallback — periodPredicate по дате факта');
  // Будущий месяц не притягивается: 1-е ≤ сегодня.
  assert.match(body, /\$\{mfirst\} <= \$\{today\}/, 'месяц должен уже начаться (не будущий)');
});

// ── Часть 2. Живой сценарий на реальном Postgres (SALARY_LIVE_DB) ─────────────

test(
  'LIVE: принятый payout снижает остаток; getAll(месяц)==getEmployeeMonth; неделя не двоит премии',
  { skip: !process.env.SALARY_LIVE_DB ? 'нет SALARY_LIVE_DB (throwaway-Postgres) — статические стражи покрывают структуру' : false },
  async () => {
    const { Client } = require('pg');
    const TZ = 'Europe/Moscow';
    const periodPredicate = (col) =>
      `${col} >= $1::date::timestamp AT TIME ZONE '${TZ}' AND ${col} < ($2::date + 1)::timestamp AT TIME ZONE '${TZ}'`;
    const membership = (p, f) => {
      const v = `${p} ~ '^\\d{4}-\\d{2}$'`;
      const mf = `to_date(CASE WHEN ${v} THEN ${p} || '-01' END, 'YYYY-MM-DD')`;
      const ml = `(${mf} + interval '1 month' - interval '1 day')::date`;
      const t = `(now() AT TIME ZONE '${TZ}')::date`;
      return `((${v} AND $1::date <= ${mf} AND ${mf} <= ${t} AND $2::date >= LEAST(${ml}, ${t})) OR ((${p} IS NULL OR ${p} !~ '^\\d{4}-\\d{2}$') AND ${periodPredicate(f)}))`;
    };
    const EMP = '11111111-1111-1111-1111-111111111111';
    const c = new Client({ connectionString: process.env.SALARY_LIVE_DB });
    await c.connect();
    try {
      await c.query('CREATE SCHEMA IF NOT EXISTS salary_r16_live; SET search_path TO salary_r16_live');
      await c.query(`
        CREATE TABLE salary_payouts (id serial primary key, employee_id uuid, amount numeric, status text,
          period_month text, created_at timestamptz default now());
        CREATE TABLE salary_payments (id serial primary key, user_id uuid, amount numeric, month_year text,
          reversed_at timestamptz, date timestamptz default now());
        CREATE TABLE salary_premiums (id serial primary key, user_id uuid, type text, amount numeric,
          period_month_year text, created_at timestamptz default now());`);
      const paid = async (from, to) =>
        Number((await c.query(`SELECT COALESCE(SUM(amount),0) s FROM salary_payouts WHERE employee_id=$3 AND status='accepted' AND ${membership('period_month', 'created_at')}`, [from, to, EMP])).rows[0].s);
      const paidMonth = async (ym) =>
        Number((await c.query(`SELECT COALESCE(SUM(amount),0) s FROM salary_payouts WHERE employee_id=$2 AND status='accepted' AND COALESCE(period_month, to_char(created_at AT TIME ZONE '${TZ}','YYYY-MM'))=$1`, [ym, EMP])).rows[0].s);
      const prem = async (from, to) =>
        Number((await c.query(`SELECT COALESCE(SUM(amount),0) s FROM salary_premiums WHERE user_id=$3 AND type='cash' AND ${membership('period_month_year', 'created_at')}`, [from, to, EMP])).rows[0].s);
      const now = (await c.query(`SELECT to_char(now() AT TIME ZONE '${TZ}','YYYY-MM') ym, to_char(now() AT TIME ZONE '${TZ}','YYYY-MM-DD') today`)).rows[0];
      const [y, m] = now.ym.split('-').map(Number);
      const curLast = `${now.ym}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;

      // HIGH — accept a payout for the current month.
      await c.query(`INSERT INTO salary_payouts(employee_id,amount,status,period_month) VALUES ($1,40000,'accepted',$2)`, [EMP, now.ym]);
      assert.equal(await paid(`${now.ym}-01`, curLast), 40000, 'getAll full month counts accepted payout');
      assert.equal(await paid(`${now.ym}-01`, now.today), 40000, 'web month-to-date counts accepted payout (clamp)');
      assert.equal(await paid(`${now.ym}-01`, curLast), await paidMonth(now.ym), 'getAll(month) == getEmployeeMonth(month)');
      await c.query(`INSERT INTO salary_payouts(employee_id,amount,status,period_month) VALUES ($1,15000,'cancelled',$2)`, [EMP, now.ym]);
      assert.equal(await paid(`${now.ym}-01`, curLast), 40000, 'cancelled payout excluded');

      // MEDIUM — premiums for two past months + a boundary-crossing week.
      await c.query(`INSERT INTO salary_premiums(user_id,type,amount,period_month_year) VALUES ($1,'cash',9000,'2020-07'),($1,'cash',8000,'2020-08')`, [EMP]);
      assert.equal(await prem('2020-07-01', '2020-07-31'), 9000, 'full July includes July premium');
      assert.equal(await prem('2020-07-30', '2020-08-02'), 0, 'boundary week does NOT pull whole months (was 17000)');
      assert.equal(await prem('2020-07-01', '2020-08-31'), 17000, 'full 2-month range includes both');
    } finally {
      await c.query('DROP SCHEMA IF EXISTS salary_r16_live CASCADE').catch(() => {});
      await c.end();
    }
  },
);
