const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

/**
 * Round 16 — стражи атрибуции зарплатных компонент по месяцам (деньги).
 *
 * Класс багов (живой тест владельца, август 2026):
 *   • БАГ 2 — премия «за июль» (periodMonthYear='2026-07'), выданная в
 *     августе, показывалась в АВГУСТЕ: getAll/getEmployeeMonth относили
 *     премию по created_at, игнорируя её собственный период. Контракт:
 *     месяц премии = period_month_year, fallback — месяц created_at МСК
 *     (зеркало выплат 149: COALESCE(period_month, to_char(created_at МСК))).
 *   • БАГ 3 — после смены ставки за прошлый месяц (setRate,
 *     master_rate_history) СПИСОК (getAll) показывал СТАРЫЙ процент из
 *     users.*, а карточка (getEmployeeMonth) — новый effective-процент
 *     месяца. Контракт: список резолвит процент месяца так же, как карточка
 *     (последняя строка master_rate_history с month <= месяца, fallback
 *     users.*). Начисления НЕ пересчитываются — суммируются запечённые
 *     salary_amount (setRate прошлого месяца сам перепекает его чеки).
 *
 * Тесты — статические стражи по исходникам (в backend нет тестовой БД).
 */

const read = (...p) => readFileSync(join(__dirname, '..', ...p), 'utf8');

const service = read('src', 'salary', 'salary.service.ts');
const premiumDto = read('src', 'salary', 'dto', 'create-premium.dto.ts');

const slice = (from, to) => {
  const start = service.indexOf(from);
  assert.notEqual(start, -1, `маркер не найден: ${from}`);
  const end = service.indexOf(to, start);
  assert.notEqual(end, -1, `маркер не найден: ${to}`);
  return service.slice(start, end);
};

// ── БАГ 2. Премия относится к СВОЕМУ месяцу (periodMonthYear) ────────────────

test('premiumMonthExpr: period_month_year с формат-guard, fallback created_at МСК', () => {
  assert.match(
    service,
    /premiumMonthExpr[\s\S]{0,400}?period_month_year ~ '\^\\\\d\{4\}-\\\\d\{2\}\$'/,
    'назначенный период учитывается только в формате YYYY-MM (мусор → fallback, а не «ни в одном месяце»)',
  );
  assert.match(
    service,
    /premiumMonthExpr[\s\S]{0,600}?created_at AT TIME ZONE \$\{tzPh\}, 'YYYY-MM'/,
    'fallback — месяц created_at в бизнес-таймзоне ТЕНАНТА (пояс параметром, не склейкой), как у выплат (149)',
  );
});

test('getAll: премии — по periodMonthMembership (месяц-к-дате ИЛИ дата факта), не разворот в целые месяцы', () => {
  const block = slice('Premiums for the period', 'Penalties for the same period');
  // Round 16 MEDIUM: раньше premiumMonthExpr IN (целые месяцы диапазона) —
  // узкий срез, задевший границу месяца, тянул премии ДВУХ целых месяцев.
  assert.match(
    block,
    /monthMember\('sp\.period_month_year', 'sp\.created_at'\)/,
    'getAll обязан относить премии через periodMonthMembership(period_month_year, created_at)',
  );
  assert.doesNotMatch(
    block,
    /premiumMonthExpr\('sp'\)\} IN/,
    'старый разворот premiumMonthExpr IN (целые месяцы диапазона) должен быть удалён (баг MEDIUM)',
  );
});

test('getEmployeeMonth: премии месяца — по назначенному месяцу, а не по created_at', () => {
  const block = slice('Premiums ASSIGNED to the month', 'Fines (штрафы');
  assert.match(
    block,
    /premiumMonthExpr\('sp', '\$4::text'\)\} = \$3/,
    'карточка месяца должна фильтровать премии через premiumMonthExpr = месяц (пояс тенанта — параметр $4)',
  );
  assert.doesNotMatch(
    block,
    /sp\.created_at >= \$3/,
    'старый created_at-диапазон должен быть удалён из выборки премий карточки',
  );
});

test('listPremiums: фильтр monthYear — та же атрибуция (NULL-период не теряется)', () => {
  const block = slice('async listPremiums', 'async removePremium');
  assert.match(
    block,
    /premiumMonthExpr\('sp', tzPh\)\}=\$/,
    'список премий обязан фильтровать месяц тем же выражением, что getAll/карточка',
  );
});

test('createPremium DTO: periodMonthYear строго YYYY-MM', () => {
  assert.match(
    premiumDto,
    /@Matches\(\/\^\\d\{4\}-\\d\{2\}\$\/,/,
    'мусорный период молча увёл бы премию в fallback-месяц — форматный отказ на входе',
  );
});

// ── БАГ 3. Список показывает effective-процент запрошенного месяца ──────────

test('getAll: процент резолвится из master_rate_history (LATERAL), как в карточке', () => {
  const block = slice('async getAll', 'async getPayments');
  assert.match(
    block,
    /LEFT JOIN LATERAL \(\s*SELECT mrh\.salary_percent, mrh\.product_salary_percent\s*FROM master_rate_history mrh\s*WHERE mrh\.tenant_id = u\.tenant_id AND mrh\.user_id = u\.id AND mrh\.month <= \$5\s*ORDER BY mrh\.month DESC\s*LIMIT 1\s*\) h ON true/,
    'effective-ставка месяца — последняя строка истории с month <= rateMonth',
  );
  assert.match(
    block,
    /COALESCE\(h\.salary_percent, u\.salary_percent, 0\) as salary_percent/,
    'NULL-колонка истории / отсутствие строк → fallback текущих users.* (семантика 150)',
  );
  assert.match(block, /COALESCE\(h\.product_salary_percent, u\.product_salary_percent, 0\) as product_salary_percent/);
  assert.match(
    block,
    /\[tenantID, dateFrom, dateTo, tz, rateMonth\]/,
    'пояс тенанта — $4, rateMonth — $5 в основном запросе',
  );
});

test('getAll: rateMonth — последний месяц запрошенного периода (месяц dateTo)', () => {
  const block = slice('async getAll', 'async getPayments');
  assert.match(
    block,
    /rateMonth = \/\^\\d\{4\}-\\d\{2\}\/\.test\(dateTo\)\s*\? dateTo\.slice\(0, 7\)/,
    '«ЗП за июль» (dateTo=2026-07-31) должна резолвить ставку июля',
  );
});

test('getEmployeeMonth: карточка сохраняет effective-резолв (150) — источник истины', () => {
  const block = slice('async getEmployeeMonth', 'Premiums ASSIGNED to the month');
  assert.match(block, /FROM master_rate_history/, 'карточка резолвит ставку месяца из истории');
  assert.match(block, /month <= \$3/, 'последняя строка с month <= запрошенного месяца');
});
