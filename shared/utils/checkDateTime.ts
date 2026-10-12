/** Adapt a service's wall clock to device-local picker fields, without changing the instant. */
function fields(date: Date, timeZone: string): number[] {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  return ['year', 'month', 'day', 'hour', 'minute', 'second'].map((key) =>
    Number(parts.find((part) => part.type === key)?.value),
  );
}

function wallStamp(parts: number[], milliseconds: number): number {
  const date = new Date(0);
  date.setUTCFullYear(parts[0], parts[1] - 1, parts[2]);
  date.setUTCHours(parts[3], parts[4], parts[5], milliseconds);
  return date.getTime();
}

export interface CheckDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}

export function checkDateParts(instant: Date, timeZone: string): CheckDateParts {
  const [year, month, day, hour, minute, second] = fields(instant, timeZone);
  return { year, month, day, hour, minute, second, millisecond: instant.getMilliseconds() };
}

/** Keep service wall fields out of a device-local Date: its DST gaps differ. */
export function checkDateInstant(parts: CheckDateParts, timeZone: string): Date {
  const requested = wallStamp(
    [parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.second],
    parts.millisecond,
  );
  let candidate = requested;
  for (let step = 0; step < 3; step += 1) {
    const correction = requested - wallStamp(fields(new Date(candidate), timeZone), parts.millisecond);
    if (!correction) return new Date(candidate);
    candidate += correction;
  }
  throw new Error('This local time does not exist in the service timezone');
}

/** Untouched forms must let the server stamp submission time. */
export function selectedCheckDate(manual: Date | null, allowed: boolean): string | undefined {
  return allowed && manual ? manual.toISOString() : undefined;
}
