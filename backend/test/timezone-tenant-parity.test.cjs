const assert = require('node:assert/strict');
const test = require('node:test');

/**
 * Перевод бизнес-логики с хардкода Europe/Moscow на пояс тенанта.
 *
 * ГЛАВНОЕ ТРЕБОВАНИЕ БЕЗОПАСНОСТИ: все существующие тенанты сидят на дефолте
 * (миграция 157: tenants.timezone DEFAULT 'Europe/Moscow'), поэтому у них не
 * имеет права измениться НИЧЕГО. Этот тест — доказательство: старая формула
 * (фиксированный сдвиг +3 часа, `new Date(Date.UTC(...) - MSK_OFFSET_MS)`) и
 * новая (Intl в поясе 'Europe/Moscow') обязаны давать один и тот же инстант на
 * пограничных моментах — 00:00 / 02:59 / 03:00 МСК, конец месяца, 29 февраля
 * високосного года, 31-е число, смена года — и на сплошном прогоне по годам.
 *
 * Второй блок проверяет, что для НЕмосковского пояса результат действительно
 * другой и равен «своему» фиксированному сдвигу (российские пояса без DST).
 */

const {
  DEFAULT_TIMEZONE,
  dayBoundsInZone,
  dayStartMsInZone,
  getZoneOffsetMs,
  isSameZonedDay,
  monthBoundsInZone,
  startOfDayInZone,
  startOfDayInZoneOffset,
  startOfMonthInZone,
  startOfMonthInZoneOffset,
  startOfWeekInZone,
  zonedDateKey,
  zonedHour,
  zonedIsoWeekday,
  zonedMidnight,
  zonedMonthKey,
  zonedTimeKey,
} = require('../dist/common/timezone');

const MSK_OFFSET_MS = 3 * 60 * 60 * 1000; // ровно то, что было зашито в сервисах
const DAY_MS = 24 * 60 * 60 * 1000;

// ── Старые формулы, СКОПИРОВАННЫЕ дословно из кода до правки ────────────────

/** checks.service.ts / purchase-orders.service.ts */
const oldMskDayOf = (ts) => new Date(ts + MSK_OFFSET_MS).toISOString().slice(0, 10);
/** checks.service.ts */
const oldMskDayStartMs = (day) => Date.parse(`${day}T00:00:00.000Z`) - MSK_OFFSET_MS;
/** reports.computeDashboardV2 / checks.getDashboard / salary / users */
function oldBounds(nowMs) {
  const mskNow = new Date(nowMs + MSK_OFFSET_MS);
  const y = mskNow.getUTCFullYear();
  const m = mskNow.getUTCMonth();
  const d = mskNow.getUTCDate();
  const dow = mskNow.getUTCDay() === 0 ? 7 : mskNow.getUTCDay();
  return {
    y,
    m,
    d,
    dow,
    todayStart: new Date(Date.UTC(y, m, d) - MSK_OFFSET_MS).toISOString(),
    tomorrowStart: new Date(Date.UTC(y, m, d + 1) - MSK_OFFSET_MS).toISOString(),
    yesterdayStart: new Date(Date.UTC(y, m, d - 1) - MSK_OFFSET_MS).toISOString(),
    weekStart: new Date(Date.UTC(y, m, d - dow + 1) - MSK_OFFSET_MS).toISOString(),
    monthStart: new Date(Date.UTC(y, m, 1) - MSK_OFFSET_MS).toISOString(),
    prevMonthStart: new Date(Date.UTC(y, m - 1, 1) - MSK_OFFSET_MS).toISOString(),
    nextMonthStart: new Date(Date.UTC(y, m + 1, 1) - MSK_OFFSET_MS).toISOString(),
  };
}
/** shifts.service.ts — «который сейчас час/минута по МСК» */
const oldMskHHMM = (ts) => new Date(ts + MSK_OFFSET_MS).toISOString().slice(11, 16);
/** salary.service.ts — период 'YYYY-MM' по МСК */
const oldMskMonth = (ts) => new Date(ts + MSK_OFFSET_MS).toISOString().slice(0, 7);

// ── Пограничные моменты ─────────────────────────────────────────────────────

const EDGE_INSTANTS = [
  // Полночь МСК ровно (21:00 UTC предыдущих суток) — момент, ради которого весь
  // сдвиг и существует: чек в 00:00 МСК должен быть «сегодняшним».
  '2026-03-09T21:00:00.000Z', // 2026-03-10 00:00:00 МСК
  '2026-03-09T20:59:59.999Z', // на миллисекунду раньше — ещё «вчера»
  '2026-03-09T23:59:59.999Z', // 02:59:59.999 МСК — всё ещё те же сутки
  '2026-03-10T00:00:00.000Z', // 03:00 МСК — UTC-сутки сменились, МСК-сутки нет
  // Конец месяца.
  '2026-01-31T21:00:00.000Z', // 1 февраля 00:00 МСК
  '2026-01-31T20:59:59.999Z', // 31 января 23:59:59 МСК
  '2026-04-30T22:30:00.000Z', // 1 мая 01:30 МСК
  '2026-08-31T21:00:00.000Z',
  // 31-е число (месяцы разной длины подряд).
  '2026-05-31T12:00:00.000Z',
  '2026-07-31T23:30:00.000Z',
  '2026-12-31T21:00:00.000Z', // 1 января 00:00 МСК — смена года
  '2026-12-31T20:59:59.000Z', // 31 декабря 23:59:59 МСК
  // Високосный год: 29 февраля и его границы.
  '2024-02-28T21:00:00.000Z', // 29.02.2024 00:00 МСК
  '2024-02-29T21:00:00.000Z', // 01.03.2024 00:00 МСК
  '2024-02-29T12:00:00.000Z',
  '2028-02-29T02:59:00.000Z',
  // Невисокосный февраль.
  '2026-02-28T21:00:00.000Z', // 1 марта 00:00 МСК
  // Воскресенье и понедельник — ISO-неделя.
  '2026-03-08T20:00:00.000Z', // вс 23:00 МСК
  '2026-03-08T21:00:00.000Z', // пн 00:00 МСК
  // Даты, когда в Европе переводят часы (Россия — нет; проверяем, что нас не
  // задело чужим DST).
  '2026-03-29T00:30:00.000Z',
  '2026-10-25T00:30:00.000Z',
].map((iso) => new Date(iso));

test('границы суток/месяца/недели по Москве: новая формула = старой на пограничных моментах', () => {
  for (const ref of EDGE_INSTANTS) {
    const ms = ref.getTime();
    const old = oldBounds(ms);
    const label = ref.toISOString();

    assert.equal(startOfDayInZone(DEFAULT_TIMEZONE, ref).toISOString(), old.todayStart, `todayStart @ ${label}`);
    assert.equal(
      startOfDayInZoneOffset(DEFAULT_TIMEZONE, 1, ref).toISOString(),
      old.tomorrowStart,
      `tomorrowStart @ ${label}`,
    );
    assert.equal(
      startOfDayInZoneOffset(DEFAULT_TIMEZONE, -1, ref).toISOString(),
      old.yesterdayStart,
      `yesterdayStart @ ${label}`,
    );
    assert.equal(startOfWeekInZone(DEFAULT_TIMEZONE, ref).toISOString(), old.weekStart, `weekStart @ ${label}`);
    assert.equal(startOfMonthInZone(DEFAULT_TIMEZONE, ref).toISOString(), old.monthStart, `monthStart @ ${label}`);
    assert.equal(
      startOfMonthInZoneOffset(DEFAULT_TIMEZONE, -1, ref).toISOString(),
      old.prevMonthStart,
      `prevMonthStart @ ${label}`,
    );
    assert.equal(
      startOfMonthInZoneOffset(DEFAULT_TIMEZONE, 1, ref).toISOString(),
      old.nextMonthStart,
      `nextMonthStart @ ${label}`,
    );
    assert.equal(zonedIsoWeekday(ref, DEFAULT_TIMEZONE), old.dow, `dow @ ${label}`);
    assert.equal(zonedDateKey(ref, DEFAULT_TIMEZONE), oldMskDayOf(ms), `dayKey @ ${label}`);
    assert.equal(zonedMonthKey(ref, DEFAULT_TIMEZONE), oldMskMonth(ms), `monthKey @ ${label}`);
    assert.equal(zonedTimeKey(ref, DEFAULT_TIMEZONE), oldMskHHMM(ms), `HH:MM @ ${label}`);
    assert.equal(zonedHour(ref, DEFAULT_TIMEZONE), Number(oldMskHHMM(ms).slice(0, 2)), `hour @ ${label}`);
    // Полуинтервал [start, end) — ровно то, что подставляется в SQL.
    const day = dayBoundsInZone(DEFAULT_TIMEZONE, ref);
    assert.equal(day.start.toISOString(), old.todayStart, `dayBounds.start @ ${label}`);
    assert.equal(day.end.toISOString(), old.tomorrowStart, `dayBounds.end @ ${label}`);
    const month = monthBoundsInZone(DEFAULT_TIMEZONE, ref);
    assert.equal(month.start.toISOString(), old.monthStart, `monthBounds.start @ ${label}`);
    assert.equal(month.end.toISOString(), old.nextMonthStart, `monthBounds.end @ ${label}`);
    // Календарные хелперы дашбордов (mskMidnight(y, m, d) один в один).
    assert.equal(
      zonedMidnight(DEFAULT_TIMEZONE, old.y, old.m, old.d).toISOString(),
      old.todayStart,
      `zonedMidnight @ ${label}`,
    );
  }
});

test('границы суток по Москве: сплошной прогон каждые 37 минут за 2024 (високосный) и 2026', () => {
  // 37 минут — шаг, который «проползает» через каждую границу часа и суток, но
  // держит тест в ~40 тысяч точек (доли секунды).
  const STEP_MS = 37 * 60 * 1000;
  for (const year of [2024, 2026]) {
    const from = Date.UTC(year, 0, 1);
    const to = Date.UTC(year + 1, 0, 1);
    for (let ms = from; ms < to; ms += STEP_MS) {
      const ref = new Date(ms);
      const old = oldBounds(ms);
      assert.equal(startOfDayInZone(DEFAULT_TIMEZONE, ref).toISOString(), old.todayStart, `day @ ${ref.toISOString()}`);
      assert.equal(
        startOfMonthInZone(DEFAULT_TIMEZONE, ref).toISOString(),
        old.monthStart,
        `month @ ${ref.toISOString()}`,
      );
      assert.equal(
        startOfWeekInZone(DEFAULT_TIMEZONE, ref).toISOString(),
        old.weekStart,
        `week @ ${ref.toISOString()}`,
      );
      assert.equal(zonedDateKey(ref, DEFAULT_TIMEZONE), oldMskDayOf(ms), `key @ ${ref.toISOString()}`);
    }
  }
});

test('dayStartMsInZone по Москве = старому Date.parse(day) − 3ч, включая 29 февраля', () => {
  const days = [
    '2026-01-01',
    '2026-01-31',
    '2026-02-28',
    '2024-02-29',
    '2028-02-29',
    '2026-03-01',
    '2026-05-31',
    '2026-12-31',
    '2020-02-29',
  ];
  for (const day of days) {
    assert.equal(dayStartMsInZone(DEFAULT_TIMEZONE, day), oldMskDayStartMs(day), `dayStart ${day}`);
    // И обратная согласованность: начало дня → тот же самый день.
    assert.equal(zonedDateKey(new Date(dayStartMsInZone(DEFAULT_TIMEZONE, day)), DEFAULT_TIMEZONE), day);
  }
});

test('кривая дата даёт NaN ровно там же, где его давал старый Date.parse', () => {
  // Что V8 отвергал — отвергаем и мы.
  for (const bad of ['2026-13-01', '2026-00-10', '2026-02-00', '2026-02-32', 'вчера', '', '2026-1-1']) {
    assert.ok(Number.isNaN(oldMskDayStartMs(bad)), `старая формула NaN для ${bad}`);
    assert.ok(Number.isNaN(dayStartMsInZone(DEFAULT_TIMEZONE, bad)), `новая формула NaN для ${bad}`);
  }
  // А что он молча сворачивал вперёд (30 февраля → 2 марта) — сворачиваем так
  // же, побитово: ужесточение поменяло бы ответ API московскому тенанту.
  for (const rollover of ['2026-02-30', '2026-02-31', '2026-04-31', '2026-02-29']) {
    assert.equal(
      dayStartMsInZone(DEFAULT_TIMEZONE, rollover),
      oldMskDayStartMs(rollover),
      `перенос ${rollover} совпадает со старым`,
    );
  }
});

test('isSameZonedDay по Москве повторяет сравнение mskDayOf', () => {
  const a = Date.parse('2026-03-09T21:30:00.000Z'); // 10.03 00:30 МСК
  const b = Date.parse('2026-03-10T20:00:00.000Z'); // 10.03 23:00 МСК
  const c = Date.parse('2026-03-10T21:00:00.000Z'); // 11.03 00:00 МСК
  assert.equal(isSameZonedDay(a, b, DEFAULT_TIMEZONE), oldMskDayOf(a) === oldMskDayOf(b));
  assert.equal(isSameZonedDay(a, b, DEFAULT_TIMEZONE), true);
  assert.equal(isSameZonedDay(b, c, DEFAULT_TIMEZONE), false);
});

// ── Немосковские пояса: поведение обязано отличаться, и ровно на свой сдвиг ──

const RU_FIXED_OFFSETS_H = {
  'Europe/Kaliningrad': 2,
  'Europe/Moscow': 3,
  'Europe/Samara': 4,
  'Asia/Yekaterinburg': 5,
  'Asia/Omsk': 6,
  'Asia/Krasnoyarsk': 7,
  'Asia/Irkutsk': 8,
  'Asia/Yakutsk': 9,
  'Asia/Vladivostok': 10,
  'Asia/Magadan': 11,
  'Asia/Kamchatka': 12,
};

test('для каждого российского пояса границы суток = сдвигу этого пояса', () => {
  for (const [tz, hours] of Object.entries(RU_FIXED_OFFSETS_H)) {
    const offsetMs = hours * 60 * 60 * 1000;
    for (const ref of EDGE_INSTANTS) {
      assert.equal(getZoneOffsetMs(ref, tz), offsetMs, `offset ${tz} @ ${ref.toISOString()}`);
      const local = new Date(ref.getTime() + offsetMs);
      const expected = new Date(
        Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - offsetMs,
      ).toISOString();
      assert.equal(startOfDayInZone(tz, ref).toISOString(), expected, `day ${tz} @ ${ref.toISOString()}`);
    }
  }
});

test('владивостокский тенант в 00:30 МСК уже живёт СЛЕДУЮЩИМ днём', () => {
  // 2026-03-09T21:30Z = 10.03 00:30 МСК = 10.03 07:30 Владивосток. А вот в
  // 2026-03-09T15:00Z (18:00 МСК, 9 марта) Владивосток уже 01:00 десятого.
  const evening = new Date('2026-03-09T15:00:00.000Z');
  assert.equal(zonedDateKey(evening, 'Europe/Moscow'), '2026-03-09');
  assert.equal(zonedDateKey(evening, 'Asia/Vladivostok'), '2026-03-10');
  // Сутки владивостокского тенанта начинаются на 7 часов раньше московских.
  const diff =
    startOfDayInZone('Europe/Moscow', evening).getTime() - startOfDayInZone('Asia/Vladivostok', evening).getTime();
  assert.equal(diff, -17 * 60 * 60 * 1000);
});

test('мусорный пояс не роняет расчёт и деградирует в Москву', () => {
  for (const bad of [null, undefined, '', '   ', 'Mars/Olympus', 42]) {
    const ref = new Date('2026-03-09T21:00:00.000Z');
    assert.equal(startOfDayInZone(bad, ref).toISOString(), startOfDayInZone(DEFAULT_TIMEZONE, ref).toISOString());
    assert.equal(zonedDateKey(ref, bad), zonedDateKey(ref, DEFAULT_TIMEZONE));
  }
});

test('сутки любого пояса — ровно 24 часа и полуинтервал стыкуется без дыр', () => {
  for (const tz of Object.keys(RU_FIXED_OFFSETS_H)) {
    for (const ref of EDGE_INSTANTS) {
      const { start, end } = dayBoundsInZone(tz, ref);
      assert.equal(end.getTime() - start.getTime(), DAY_MS, `длина суток ${tz}`);
      assert.ok(start.getTime() <= ref.getTime() && ref.getTime() < end.getTime(), `ref внутри суток ${tz}`);
      // Конец суток = начало следующих: ни одна операция не проваливается между.
      assert.equal(startOfDayInZone(tz, end).toISOString(), end.toISOString(), `стык суток ${tz}`);
    }
  }
});
