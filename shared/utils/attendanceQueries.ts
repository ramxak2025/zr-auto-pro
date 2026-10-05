/** Mutations of attendance affect the calendar, active shift, journal and derived stats. */
export const ATTENDANCE_QUERY_KEYS = [
  ['schedule'],
  ['schedule-today'],
  ['shifts'],
  ['schedule-my-stats'],
  ['my-schedule-stats'],
  ['employee-full-profile'],
  ['employee-schedule'],
  ['salary'],
  ['salary-my'],
  ['salary-all'],
  ['employee-salary'],
  ['employee-salary-prev'],
  ['my-summary'],
] as const;

export function invalidateAttendanceQueries(client: {
  invalidateQueries: (filters: { queryKey: readonly string[] }) => Promise<unknown>;
}): Promise<unknown[]> {
  return Promise.all(ATTENDANCE_QUERY_KEYS.map((queryKey) => client.invalidateQueries({ queryKey })));
}
