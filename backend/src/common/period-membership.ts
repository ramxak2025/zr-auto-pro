/**
 * Единое правило «в каком месяце считается денежная строка» — для экрана
 * «Зарплата» (salary.getAll) и для отчётов («По зарплатам», «Сводный»,
 * «По расходам»). Раньше правило жило локальной копией в SalaryService, а отчёты
 * считали выплату по дате факта: выплата «за сентябрь», выданная 3 октября,
 * стояла на экране в сентябре, а в отчёте — в октябре, и цифры расходились.
 *
 * ЭФФЕКТИВНЫЙ МЕСЯЦ СТРОКИ — назначенный («за какой месяц») либо, если он не
 * назначен, месяц даты факта в поясе тенанта:
 *   выплата         COALESCE(period_month, месяц created_at)
 *   legacy-платёж   month_year
 *   премия          COALESCE(period_month_year, месяц created_at)
 *   расход          COALESCE(period_month, месяц date)
 *   штраф, чек      без назначенного месяца — по своей дате (здесь не участвуют)
 *
 * Пояс тенанта приходит ГОТОВЫМ ПЛЕЙСХОЛДЕРОМ (`$4::text`): значение вызывающий
 * кладёт в params сам. Склеивать пояс в текст запроса нельзя — параметр единственная
 * защита, не зависящая от того, кто заполнил колонку.
 */

/** Ключ месяца 'YYYY-MM' с месяцем 01–12 — для проверки входных значений. */
export const MONTH_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * То же правило как SQL-литерал POSIX-регэкспа. Строгий диапазон месяцев нужен не
 * для красоты: `to_date('2026-13-01', …)` роняет ВЕСЬ запрос, а колонки периода
 * (TEXT / CHECK '^\d{4}-\d{2}$') такую строку пропускают. С guard'ом мусор уходит
 * в рукав «по дате факта», а не в 500.
 */
export const MONTH_KEY_SQL_LITERAL = "'^\\d{4}-(0[1-9]|1[0-2])$'";

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Плейсхолдеры границ периода. По умолчанию — конвенция всех билдеров и
 * getAll: $2 = dateFrom, $3 = dateTo. Ленте расходов, где нумерация параметров
 * динамическая, границы приходят своими номерами.
 */
export interface MembershipBounds {
  from: string;
  to: string;
}

const DEFAULT_BOUNDS: MembershipBounds = { from: '$2', to: '$3' };

/**
 * SQL-предикат периода [dateFrom..dateTo] для timestamptz-колонки `col`.
 * Строка `YYYY-MM-DD` трактуется как МЕСТНЫЙ календарный день тенанта:
 * полуинтервал [from 00:00, to+1 00:00) — тот же, что report-sql.inPeriod.
 * Полный timestamp в параметре — прежняя семантика 1:1 (guard для нестандартных
 * клиентов).
 */
export function periodPredicate(
  col: string,
  dateFrom: string,
  dateTo: string,
  tzPh: string,
  bounds: MembershipBounds = DEFAULT_BOUNDS,
): string {
  const lowerIsDay = DATE_ONLY_RE.test(dateFrom);
  const upperIsDay = DATE_ONLY_RE.test(dateTo);
  const lower = lowerIsDay
    ? `${col} >= ${bounds.from}::date::timestamp AT TIME ZONE ${tzPh}`
    : `${col} >= ${bounds.from}`;
  const upper = upperIsDay
    ? `${col} < (${bounds.to}::date + 1)::timestamp AT TIME ZONE ${tzPh}`
    : `${col} <= (${bounds.to}::date + 1)::timestamptz`;
  if (lowerIsDay || upperIsDay) return `${lower} AND ${upper}`;
  // Обе границы пришли полным timestamp'ом — AT TIME ZONE не нужен, но параметр
  // пояса УЖЕ передан в запрос, а Postgres отвергает и лишний параметр, и дырку в
  // нумерации. Якорь тождественно истинен и лишь гарантирует ссылку на плейсхолдер.
  return `${lower} AND ${upper} AND ${tzPh} IS NOT NULL`;
}

/**
 * Предикат принадлежности ПОМЕСЯЧНО-относимой строки диапазону [dateFrom..dateTo].
 * `periodCol` — колонка назначенного месяца ('YYYY-MM'), `factCol` — дата факта
 * (timestamptz).
 *
 *   • строка с ЯВНЫМ месяцем входит, когда диапазон покрывает месяц «по
 *     сегодняшний день»: from ≤ 1-е число месяца, месяц уже НАЧАЛСЯ (1-е ≤
 *     сегодня в поясе тенанта — будущие месяцы не притягиваются) и to ≥
 *     LEAST(последнее число, сегодня). Значит ПОЛНЫЙ календарный месяц (мобильный
 *     дефолт) и «месяц-к-дате» (веб-пресет «Месяц» = [1-е, сегодня]) месяц
 *     ВКЛЮЧАЮТ, а «неделя»/«день» вне 1-го числа — НЕТ, поэтому сумма недель не
 *     задваивает месяц;
 *   • строка БЕЗ явного месяца (NULL / мусор) относится по ДАТЕ ФАКТА
 *     (полуинтервал periodPredicate) — узкий срез видит ровно те строки, что
 *     реально произошли в его дни.
 *
 * Clamp к «сегодня» нужен деньгам: клиенты смотрят ТЕКУЩИЙ месяц как
 * [1-е, сегодня] ещё до его конца, и принятая сегодня выплата обязана списываться
 * из остатка сразу — иначе «недосписанная» выплата открывает путь к ПОВТОРНОЙ
 * выдаче. Для ПОЛНОГО месяца оба рукава сводятся к равенству эффективного месяца
 * (`COALESCE(period, месяц факта) = M`), поэтому список и карточка сотрудника
 * сходятся до копейки.
 */
export function effectiveMonthMembershipSql(
  periodCol: string,
  factCol: string,
  dateFrom: string,
  dateTo: string,
  tzPh: string,
  bounds: MembershipBounds = DEFAULT_BOUNDS,
): string {
  const validPeriod = `${periodCol} ~ ${MONTH_KEY_SQL_LITERAL}`;
  const mfirst = `to_date(CASE WHEN ${validPeriod} THEN ${periodCol} || '-01' END, 'YYYY-MM-DD')`;
  const mlast = `(${mfirst} + interval '1 month' - interval '1 day')::date`;
  const today = `(now() AT TIME ZONE ${tzPh})::date`;
  const assigned =
    `${validPeriod} AND ${bounds.from}::date <= ${mfirst} AND ${mfirst} <= ${today} ` +
    `AND ${bounds.to}::date >= LEAST(${mlast}, ${today})`;
  const byFact =
    `(${periodCol} IS NULL OR ${periodCol} !~ ${MONTH_KEY_SQL_LITERAL}) ` +
    `AND ${periodPredicate(factCol, dateFrom, dateTo, tzPh, bounds)}`;
  return `((${assigned}) OR (${byFact}))`;
}

export function isMonthKey(value: unknown): value is string {
  return typeof value === 'string' && MONTH_KEY_RE.test(value);
}

/** Сдвиг ключа месяца на `delta` месяцев (отрицательное — назад): '2026-01', -1 → '2025-12'. */
export function shiftMonthKey(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number);
  const total = y * 12 + (m - 1) + delta;
  const year = Math.floor(total / 12);
  const month = total - year * 12 + 1;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

/** `count` месяцев, предшествующих `key`, — ближайший первым: ('2026-03', 2) → ['2026-02', '2026-01']. */
export function monthKeysBefore(key: string, count: number): string[] {
  const keys: string[] = [];
  for (let i = 1; i <= count; i++) keys.push(shiftMonthKey(key, -i));
  return keys;
}
