import { checkDateParts, checkDateInstant, selectedCheckDate } from '../../../../shared/utils/checkDateTime';

describe('explicit check date and service clock', () => {
  it.each(['Europe/Moscow', 'Asia/Vladivostok', 'Asia/Kamchatka', 'Europe/Kaliningrad'])(
    'roundtrips an instant near midnight through device picker fields in %s',
    (zone) => {
      const actual = new Date('2026-10-11T22:59:37.123Z');
      expect(checkDateInstant(checkDateParts(actual, zone), zone).toISOString()).toBe(actual.toISOString());
    },
  );
  it('saves the chosen service-local date and exact minute, not the device timezone', () => {
    const parts = { year: 2026, month: 10, day: 12, hour: 9, minute: 1, second: 0, millisecond: 0 };
    const actual = checkDateInstant(parts, 'Asia/Vladivostok');
    expect(actual.toISOString()).toBe('2026-10-11T23:01:00.000Z');
    expect(selectedCheckDate(actual, true)).toBe(actual.toISOString());
  });
  it('does not normalize a service clock through the device DST gap', () => {
    const actual = new Date('2026-03-07T23:30:00Z');
    const parts = checkDateParts(actual, 'Europe/Moscow');
    expect(parts.hour).toBe(2);
    expect(checkDateInstant(parts, 'Europe/Moscow').toISOString()).toBe(actual.toISOString());
  });
  it('leaves automatic timestamps and permissionless forms to the server', () => {
    expect(selectedCheckDate(null, true)).toBeUndefined();
    expect(selectedCheckDate(new Date('2000-01-01T00:00:00Z'), false)).toBeUndefined();
  });
  it('does not mutate an existing check timestamp while preparing a picker', () => {
    const actual = new Date('2026-10-01T20:30:45Z');
    const parts = checkDateParts(actual, 'Europe/Moscow');
    parts.day = 12;
    expect(actual.toISOString()).toBe('2026-10-01T20:30:45.000Z');
    expect(checkDateInstant(parts, 'Europe/Moscow').toISOString()).toBe('2026-10-12T20:30:45.000Z');
  });
});
