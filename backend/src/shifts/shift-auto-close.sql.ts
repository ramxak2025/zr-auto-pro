/**
 * Attendance shifts end at the next midnight in the tenant's timezone.
 * Every recovery path uses this expression so a delayed sweep records the
 * same boundary as the scheduled job. Historical attendance can be entered
 * after that boundary; never record its closure before its actual opening.
 * The argument is an internal SQL placeholder, never a request value.
 */
export function staleShiftSql(timezoneParam: `$${number}`, instantParam?: `$${number}`) {
  return {
    closedAt: `GREATEST(opened_at, ((date + 1)::timestamp AT TIME ZONE ${timezoneParam}::text))`,
    predicate: `date < (${instantParam ? `${instantParam}::timestamptz` : 'now()'} AT TIME ZONE ${timezoneParam}::text)::date`,
  };
}
