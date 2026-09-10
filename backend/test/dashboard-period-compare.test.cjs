const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

/**
 * Сравнение с прошлым периодом на дашборде — «НА ТУ ЖЕ ДАТУ».
 *
 * ЧТО ОХРАНЯЕТ ЭТОТ ТЕСТ. Владелец 9 сентября видел «оборот −68 % к прошлому
 * месяцу»: 1–9 сентября сравнивались с полным августом (1–31). Отрезки разной
 * длины — дельта не значит ничего. Инварианты, каждый из которых при поломке
 * означает ВРУЩИЕ ДЕНЬГИ на главной:
 *
 *   1. Месяц-к-дате сравнивается с прошлым месяцем, обрезанным по тому же дню.
 *   2. 31 марта против февраля: 31-го числа в феврале нет — берём февраль до
 *      конца включительно, а не «до 3 марта» и не «до 28-го, но неполный».
 *   3. 1-е число — сравнение одного дня с одним днём.
 *   4. Границы дня и месяца — в поясе тенанта, а не сервера.
 *   5. Неделя, день и год сравниваются РАВНЫМИ отрезками — их семантику
 *      правка не трогает.
 *   6. Клиент больше не считает дельту сам из двух запросов графика.
 */

const { previousComparableWindow } = require('../dist/common/period-compare');

const MSK = 'Europe/Moscow';
const VLADIVOSTOK = 'Asia/Vladivostok';

/** Местная полночь как UTC-инстант — то, что отдают хелперы timezone. */
const { zonedMidnight, zonedDateKey } = require('../dist/common/timezone');

/** Границы календарного месяца в поясе: [1-е 00:00, секунда до 1-го следующего]. */
function monthWindow(tz, year, monthIndex) {
  return {
    currentFrom: zonedMidnight(tz, year, monthIndex, 1),
    currentTo: new Date(zonedMidnight(tz, year, monthIndex + 1, 1).getTime() - 1000),
  };
}

// ── 1. Месяц-к-дате против прошлого месяца на ту же дату ────────────────────

test('9 сентября сравнивается с 1–9 августа, а не с полным августом', () => {
  const now = zonedMidnight(MSK, 2026, 8, 9); // 9 сентября 2026, 00:00 МСК
  const w = previousComparableWindow({ tz: MSK, period: 'month', ...monthWindow(MSK, 2026, 8), now });
  assert.equal(w.fromKey, '2026-08-01');
  assert.equal(w.toKey, '2026-08-09');
  assert.equal(w.truncated, true);
  assert.equal(w.label, 'к 9 августа');
  // Верхняя граница ВКЛЮЧИТЕЛЬНАЯ — секунда до полуночи 10 августа.
  assert.equal(w.to.getTime(), zonedMidnight(MSK, 2026, 7, 10).getTime() - 1000);
});

test('поздний вечер того же дня не сдвигает окно на день вперёд', () => {
  // 23:59:59 по местному — всё ещё 9-е число, окно обязано остаться 1–9.
  const now = new Date(zonedMidnight(MSK, 2026, 8, 10).getTime() - 1000);
  const w = previousComparableWindow({ tz: MSK, period: 'month', ...monthWindow(MSK, 2026, 8), now });
  assert.equal(w.toKey, '2026-08-09');
});

// ── 2. 31 марта против февраля ──────────────────────────────────────────────

test('31 марта: в феврале нет 31-го — берём февраль до конца включительно', () => {
  const now = zonedMidnight(MSK, 2026, 2, 31); // 31 марта 2026
  const w = previousComparableWindow({ tz: MSK, period: 'month', ...monthWindow(MSK, 2026, 2), now });
  assert.equal(w.fromKey, '2026-02-01');
  assert.equal(w.toKey, '2026-02-28');
  // Февраль взят ЦЕЛИКОМ, значит окно не обрезано — и подпись без числа.
  assert.equal(w.truncated, false);
  assert.equal(w.label, 'к февралю');
  // Конец февраля примыкает к началу марта — ни одна секунда не потеряна и не
  // посчитана дважды.
  assert.equal(w.to.getTime(), zonedMidnight(MSK, 2026, 2, 1).getTime() - 1000);
});

test('31 марта високосного года берёт февраль по 29-е', () => {
  const now = zonedMidnight(MSK, 2028, 2, 31);
  const w = previousComparableWindow({ tz: MSK, period: 'month', ...monthWindow(MSK, 2028, 2), now });
  assert.equal(w.toKey, '2028-02-29');
  assert.equal(w.truncated, false);
});

test('27 марта берёт февраль по 27-е (обрезка, подпись с числом)', () => {
  const now = zonedMidnight(MSK, 2026, 2, 27);
  const w = previousComparableWindow({ tz: MSK, period: 'month', ...monthWindow(MSK, 2026, 2), now });
  assert.equal(w.toKey, '2026-02-27');
  assert.equal(w.truncated, true);
  assert.equal(w.label, 'к 27 февраля');
});

test('31 мая берёт апрель целиком (в апреле 30 дней)', () => {
  const now = zonedMidnight(MSK, 2026, 4, 31);
  const w = previousComparableWindow({ tz: MSK, period: 'month', ...monthWindow(MSK, 2026, 4), now });
  assert.equal(w.toKey, '2026-04-30');
  assert.equal(w.truncated, false);
});

// ── 3. Первое число ─────────────────────────────────────────────────────────

test('1-е число: один день против одного дня', () => {
  const now = zonedMidnight(MSK, 2026, 8, 1);
  const w = previousComparableWindow({ tz: MSK, period: 'month', ...monthWindow(MSK, 2026, 8), now });
  assert.equal(w.fromKey, '2026-08-01');
  assert.equal(w.toKey, '2026-08-01');
  assert.equal(w.truncated, true);
  assert.equal(w.label, 'к 1 августа');
});

test('1 января сравнивается с 1 декабря прошлого года', () => {
  const now = zonedMidnight(MSK, 2026, 0, 1);
  const w = previousComparableWindow({ tz: MSK, period: 'month', ...monthWindow(MSK, 2026, 0), now });
  assert.equal(w.fromKey, '2025-12-01');
  assert.equal(w.toKey, '2025-12-01');
  assert.equal(w.label, 'к 1 декабря');
});

// ── 4. Закрытый месяц и будущее ─────────────────────────────────────────────

test('закрытый месяц (навигация назад) сравнивается с прошлым ЦЕЛИКОМ', () => {
  const now = zonedMidnight(MSK, 2026, 8, 10); // сегодня — сентябрь
  const w = previousComparableWindow({ tz: MSK, period: 'month', ...monthWindow(MSK, 2026, 7), now }); // смотрим август
  assert.equal(w.fromKey, '2026-07-01');
  assert.equal(w.toKey, '2026-07-31');
  assert.equal(w.truncated, false);
  assert.equal(w.label, 'к июлю');
});

test('месяц в будущем сравнивать не с чем — null, а не дельта к первому дню', () => {
  const now = zonedMidnight(MSK, 2026, 8, 10);
  const w = previousComparableWindow({ tz: MSK, period: 'month', ...monthWindow(MSK, 2026, 9), now });
  assert.equal(w, null);
});

// ── 5. Пояс тенанта ─────────────────────────────────────────────────────────

test('день месяца берётся в поясе автосервиса, а не в UTC', () => {
  // 08 сентября 2026, 21:00 UTC = 09 сентября 07:00 во Владивостоке (UTC+10)
  // и 09 сентября 00:00 в Москве. Для владивостокского тенанта окно обязано
  // быть по 9-е, а границы — по местной полуночи.
  const now = new Date(Date.UTC(2026, 8, 8, 21, 0, 0));
  const w = previousComparableWindow({
    tz: VLADIVOSTOK,
    period: 'month',
    ...monthWindow(VLADIVOSTOK, 2026, 8),
    now,
  });
  assert.equal(w.toKey, '2026-08-09');
  assert.equal(zonedDateKey(w.from, VLADIVOSTOK), '2026-08-01');
  // Местная полночь 1 августа во Владивостоке = 31 июля 14:00 UTC.
  assert.equal(w.from.toISOString(), '2026-07-31T14:00:00.000Z');
});

test('тот же инстант в Калининграде — ещё 8-е число', () => {
  // 08 сентября 2026, 21:00 UTC = 08 сентября 23:00 в Калининграде (UTC+2).
  const now = new Date(Date.UTC(2026, 8, 8, 21, 0, 0));
  const w = previousComparableWindow({
    tz: 'Europe/Kaliningrad',
    period: 'month',
    ...monthWindow('Europe/Kaliningrad', 2026, 8),
    now,
  });
  assert.equal(w.toKey, '2026-08-08');
});

// ── 6. Неделя / день / год — семантику НЕ меняем ────────────────────────────

test('неделя: прошлая неделя целиком, примыкает к текущей', () => {
  const currentFrom = zonedMidnight(MSK, 2026, 8, 7); // понедельник
  const currentTo = new Date(zonedMidnight(MSK, 2026, 8, 14).getTime() - 1000);
  const now = zonedMidnight(MSK, 2026, 8, 9);
  const w = previousComparableWindow({ tz: MSK, period: 'week', currentFrom, currentTo, now });
  assert.equal(w.fromKey, '2026-08-31');
  assert.equal(w.toKey, '2026-09-06');
  assert.equal(w.truncated, false);
  assert.equal(w.to.getTime(), currentFrom.getTime() - 1000);
  assert.equal(w.label, 'к предыдущей неделе');
});

test('день: вчерашний день целиком', () => {
  const currentFrom = zonedMidnight(MSK, 2026, 8, 9);
  const currentTo = new Date(zonedMidnight(MSK, 2026, 8, 10).getTime() - 1000);
  const w = previousComparableWindow({ tz: MSK, period: 'today', currentFrom, currentTo, now: currentFrom });
  assert.equal(w.fromKey, '2026-09-08');
  assert.equal(w.toKey, '2026-09-08');
  assert.equal(w.truncated, false);
  assert.equal(w.label, 'к 8 сентября');
});

test('год: прошлый год целиком', () => {
  const currentFrom = zonedMidnight(MSK, 2026, 0, 1);
  const currentTo = new Date(zonedMidnight(MSK, 2027, 0, 1).getTime() - 1000);
  const now = zonedMidnight(MSK, 2026, 8, 9);
  const w = previousComparableWindow({ tz: MSK, period: 'year', currentFrom, currentTo, now });
  assert.equal(w.fromKey, '2025-01-01');
  assert.equal(w.toKey, '2025-12-31');
  assert.equal(w.truncated, false);
  assert.equal(w.label, 'к 2025 году');
});

// ── 7. Инварианты в исходниках ──────────────────────────────────────────────

const read = (relativePath) => readFileSync(join(__dirname, '..', relativePath), 'utf8');
const checksService = read('src/checks/checks.service.ts');
const reportsService = read('src/reports/reports.service.ts');
const dashboardScreen = readFileSync(
  join(__dirname, '..', '..', 'mobile', 'src', 'screens', 'DashboardScreen.tsx'),
  'utf8',
);

test('оба дашборда берут окно сравнения из одного хелпера', () => {
  assert.ok(
    /previousComparableWindow\(/.test(checksService),
    'checks.service: график считает сравнение сам, а не через period-compare',
  );
  assert.ok(
    /previousComparableWindow\(/.test(reportsService),
    'reports.service: marginPctChange снова берёт полный прошлый месяц',
  );
});

test('reports.service больше не сравнивает с полным прошлым месяцем', () => {
  // Старая формула: [tenantID, prevMonthStart, monthStart] + `date < $3`.
  assert.ok(
    !/prevParams: any\[\] = \[tenantID, prevMonthStart, monthStart\]/.test(reportsService),
    'reports.service: окно marginPctChange снова «весь прошлый месяц»',
  );
  // Расходы прошлого месяца обязаны резаться ТЕМ ЖЕ ОКНОМ, что и прибыль, —
  // обеими границами. Только верхняя граница пропускала в срез «1–9 августа»
  // предоплаченную в июле аренду за август ЦЕЛЫМ месяцем, и маржа прошлого
  // месяца сравнивалась с девятью днями выручки.
  assert.ok(
    /AS exp_prev_month/.test(reportsService) &&
      /\$\{effMonth\} = \$4 AND e\.date >= \$7 AND e\.date <= \$6/.test(reportsService),
    'reports.service: расходы прошлого месяца обрезаны не тем же окном, что прибыль',
  );
  assert.ok(
    /const expenseParams: any\[\] = \[tenantID, todayStart, curYm, prevYm, tz, prevWindowEnd, prevWindowStart\];/.test(
      reportsService,
    ),
    'reports.service: нижняя граница окна сравнения не уходит в запрос расходов',
  );
});

test('версия формы ответа в ключе кеша графика стоит после сегмента точки', () => {
  assert.ok(
    /reports:dashboard-chart:\$\{tenantID\}:\$\{pointCacheSegment\(pointId\)\}:v2:/.test(checksService),
    'checks.service: ключ кеша графика не отражает форму ответа с previous',
  );
});

test('прибыль прошлого периода зануляется вместе с текущей (profit_view)', () => {
  assert.ok(
    /previous: data\.previous \? \{ \.\.\.data\.previous, totalProfit: 0 \} : null/.test(checksService),
    'checks.service: без profit_view прошлый период отдаёт реальную прибыль',
  );
});

test('мобилка не считает месячную дельту вторым запросом графика', () => {
  assert.ok(
    !/const prevMonth = useQuery/.test(dashboardScreen),
    'DashboardScreen: KpiStrip снова тянет прошлый месяц отдельным запросом',
  );
  assert.ok(
    /const p = c\?\.previous \?\? null;/.test(dashboardScreen),
    'DashboardScreen: KpiStrip берёт прошлый период не из ответа сервера',
  );
  assert.ok(
    /const compareLabel = p\?\.label \?\? null;/.test(dashboardScreen),
    'DashboardScreen: подпись сравнения не приходит с сервера',
  );
});
