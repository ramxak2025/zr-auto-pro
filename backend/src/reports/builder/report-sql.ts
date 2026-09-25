/**
 * Общие SQL-фрагменты и арифметика конструктора отчётов.
 *
 * КОНВЕНЦИЯ ПАРАМЕТРОВ: каждый запрос билдера начинается с массива
 * `baseParams(ctx)` = [$1 tenant_id, $2 dateFrom, $3 dateTo, $4 tz]. Все
 * фрагменты ниже адресуют ровно эти четыре индекса, поэтому их можно
 * переиспользовать между запросами без пересчёта. Дополнительные значения
 * (филиал, выбранные id, опорная дата) кладутся ПОСЛЕ и адресуются через
 * `$${params.length}` в момент push'а — ровно как в reports.service.
 *
 * ГРАНИЦЫ ПЕРИОДА — местный полуинтервал [from 00:00, to+1 00:00) в поясе
 * тенанта: тот же предикат, что у getFinancial / getCashFlow / salary.getAll,
 * иначе один и тот же чек попадал бы в разные сутки на разных экранах.
 * Пояс — всегда параметром ($4::text), никогда склейкой.
 */
import { ReportContext } from './report-context';

export const TENANT_PH = '$1';
export const FROM_PH = '$2';
export const TO_PH = '$3';
export const TZ_PH = '$4::text';

export function baseParams(ctx: Pick<ReportContext, 'tenantId' | 'dateFrom' | 'dateTo' | 'tz'>): unknown[] {
  return [ctx.tenantId, ctx.dateFrom, ctx.dateTo, ctx.tz];
}

/** `col` (timestamptz) попадает в период [from, to] по местному календарю. */
export function inPeriod(col: string): string {
  return (
    `${col} >= ${FROM_PH}::date::timestamp AT TIME ZONE ${TZ_PH}` +
    ` AND ${col} < (${TO_PH}::date + 1)::timestamp AT TIME ZONE ${TZ_PH}`
  );
}

/** Местная календарная дата инстанта (тип date). */
export function localDate(col: string): string {
  return `(${col} AT TIME ZONE ${TZ_PH})::date`;
}

/** Местная дата как 'YYYY-MM-DD' — строкой, чтобы pg не превращал DATE в JS Date со сдвигом. */
export function dayKey(col: string): string {
  return `to_char(${localDate(col)}, 'YYYY-MM-DD')`;
}

/**
 * Фильтр по выбранным сущностям: ` AND col = ANY($n::uuid[])`. Пустой список —
 * пустая строка (все). Массив кладётся одним параметром.
 */
export function idsFilter(col: string, ids: string[], params: unknown[]): string {
  if (ids.length === 0) return '';
  params.push(ids);
  return ` AND ${col} = ANY($${params.length}::uuid[])`;
}

/**
 * Положить филиал в params ОДИН раз и вернуть его плейсхолдер (или null без
 * филиала). Нужен там, где одно значение адресуют несколько таблиц одного
 * запроса (UNION / CTE): второй push дал бы Postgres лишний параметр.
 */
export function pushPoint(params: unknown[], pointId: string | null): string | null {
  if (!pointId) return null;
  params.push(pointId);
  return `$${params.length}`;
}

/**
 * Предикат отнесения расхода к периоду — ДОСЛОВНО как в reports.getFinancial
 * (149): строка без period_month — по дате факта; строка с назначенным
 * месяцем входит ТОЛЬКО когда диапазон покрывает этот месяц целиком (иначе
 * сумма недель месяца задваивала бы его). `alias` — алиас expenses.
 */
export function expenseMembership(alias: string): string {
  const pm = `${alias}.period_month`;
  const mfirst = `to_date(${pm} || '-01', 'YYYY-MM-DD')`;
  return (
    `((${pm} IS NULL AND ${inPeriod(`${alias}.date`)})` +
    ` OR (${pm} IS NOT NULL AND ${mfirst} >= ${FROM_PH}::date` +
    ` AND (${mfirst} + interval '1 month' - interval '1 day')::date <= ${TO_PH}::date))`
  );
}

/**
 * День, в который расход ложится в таблице «по дням»: дата факта, если она
 * внутри периода, иначе 1-е число назначенного месяца (по предикату выше он
 * внутри периода целиком). Так сумма таблицы совпадает с KPI до копейки.
 */
export function expenseBucketDay(alias: string): string {
  const ld = localDate(`${alias}.date`);
  return (
    `to_char(CASE WHEN ${alias}.period_month IS NULL OR (${ld} BETWEEN ${FROM_PH}::date AND ${TO_PH}::date)` +
    ` THEN ${ld} ELSE to_date(${alias}.period_month || '-01', 'YYYY-MM-DD') END, 'YYYY-MM-DD')`
  );
}

/** Только одобренные расходы (NULL у легаси = одобрен) — как во всех отчётах. */
export function expenseApproved(alias: string): string {
  return `COALESCE(${alias}.approval_status, 'approved') = 'approved'`;
}

/**
 * Предикат отнесения премии к периоду — как reports.salaryExtrasForPeriod:
 * назначенный месяц (period_month_year) входит только целиком, без него —
 * дата факта; мусор в колонке = «периода нет».
 */
export function premiumMembership(alias: string): string {
  const period = `CASE WHEN ${alias}.period_month_year ~ '^\\d{4}-\\d{2}$' THEN ${alias}.period_month_year END`;
  const mfirst = `to_date(${period} || '-01', 'YYYY-MM-DD')`;
  return (
    `((${period} IS NULL AND ${inPeriod(`${alias}.created_at`)})` +
    ` OR (${period} IS NOT NULL AND ${mfirst} >= ${FROM_PH}::date` +
    ` AND (${mfirst} + interval '1 month' - interval '1 day')::date <= ${TO_PH}::date))`
  );
}

// ── Числа ────────────────────────────────────────────────────────────────────

export function num(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
}

export function int(v: unknown): number {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : 0;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Доля в процентах 0–100 с одним знаком; 0 при нулевой базе. */
export function pct(part: number, whole: number): number {
  return whole > 0 ? round1((part / whole) * 100) : 0;
}

/** Изменение к прошлому периоду в %, null — сравнивать не с чем. */
export function deltaPct(current: number, previous: number): number | null {
  if (!(previous > 0)) return null;
  return round1(((current - previous) / previous) * 100);
}

export function avg(sum: number, count: number): number {
  return count > 0 ? round2(sum / count) : 0;
}

// ── Календарь по строковым ключам 'YYYY-MM-DD' (пояс уже применён в SQL) ─────

export function keyToUtcMs(key: string): number {
  return Date.parse(`${key}T00:00:00Z`);
}

export function msToKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(key: string, days: number): string {
  return msToKey(keyToUtcMs(key) + days * 86_400_000);
}

/** Количество дней в [from, to] включительно. */
export function daysInclusive(from: string, to: string): number {
  return Math.round((keyToUtcMs(to) - keyToUtcMs(from)) / 86_400_000) + 1;
}

/** Предыдущий период той же длины, примыкающий к текущему. */
export function previousPeriod(from: string, to: string): { from: string; to: string } {
  const len = daysInclusive(from, to);
  return { from: addDays(from, -len), to: addDays(from, -1) };
}

/** Понедельник ISO-недели календарного дня. */
export function mondayOf(key: string): string {
  const d = new Date(keyToUtcMs(key));
  const dow = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  return addDays(key, 1 - dow);
}

/** 'dd.mm' для подписи недели. */
export function ddmm(key: string): string {
  return `${key.slice(8, 10)}.${key.slice(5, 7)}`;
}

/** Подпись недели, обрезанная границами периода: «01.09 – 07.09». */
export function weekLabel(monday: string, from: string, to: string): string {
  const start = monday < from ? from : monday;
  const sunday = addDays(monday, 6);
  const end = sunday > to ? to : sunday;
  return `${ddmm(start)} – ${ddmm(end)}`;
}

/** Все дни периода — чтобы таблица «по дням» не пропускала пустые даты. */
export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let k = from; k <= to; k = addDays(k, 1)) out.push(k);
  return out;
}

/** Все понедельники, покрывающие период (первый — понедельник недели `from`). */
export function eachWeek(from: string, to: string): string[] {
  const out: string[] = [];
  for (let k = mondayOf(from); k <= to; k = addDays(k, 7)) out.push(k);
  return out;
}
