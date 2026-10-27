/**
 * Dashboard/current-month expense membership at a calendar-day cutoff.
 * An explicit assigned month wins independently of the payment date. Only
 * unallocated expenses use [month start, cutoff). Use the same predicate for
 * current MTD, yesterday MTD and the previous-month comparison; adding a fact
 * cutoff outside the allocation branch would charge allocated costs again in
 * today's signed component delta. Full-period financial reports keep their
 * existing membership rules.
 *
 * Arguments are trusted SQL identifiers/placeholders, never request values.
 * Month, timezone and boundary values are always bound by the caller.
 */
export function expenseMonthAsOfSql(
  alias: string,
  monthPh: string,
  timezonePh: string,
  fromPh: string,
  untilExclusive: string,
): string {
  return `(COALESCE(${alias}.period_month, to_char(${alias}.date AT TIME ZONE ${timezonePh}, 'YYYY-MM')) = ${monthPh}
    AND (${alias}.period_month IS NOT NULL OR
      (${alias}.date >= ${fromPh} AND ${alias}.date < (${untilExclusive}))))`;
}
