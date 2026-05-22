/**
 * Attendance tests — `shared/utils/attendance.ts`.
 *
 * Single-source-of-truth for every "опоздал / прогул / больничный / на смене"
 * count and the monthly score that drives masters' salary % bonuses, the
 * Dashboard's "Top performers" ranking, and the rating widget. A bug here
 * changes paychecks — these tests are the protection.
 */
import {
  calculateAttendanceStats,
  classifyEntry,
  dedupeEntriesByDay,
  attendanceScore,
  emptyBreakdown,
  LATE_MINOR_WEIGHT,
  MONTHLY_TARGET_SHIFTS,
  type RawScheduleEntry,
} from '../../../../shared/utils/attendance';

// All "now" anchors below use this fixed date so tests are deterministic
// regardless of when CI runs them.
const NOW = new Date(2026, 4, 19, 18, 0, 0); // 2026-05-19 18:00 local

describe('classifyEntry', () => {
  const base = (over: Partial<RawScheduleEntry>): RawScheduleEntry => ({
    userId: 'u1',
    date: '2026-05-18',
    ...over,
  });

  it('returns null for future dates', () => {
    expect(classifyEntry(base({ date: '2026-06-01' }), NOW)).toBe(null);
  });

  it('classifies sick from note (substring "больнич")', () => {
    expect(classifyEntry(base({ note: 'больничный' }), NOW)).toBe('sick');
    expect(classifyEntry(base({ note: 'на больничном' }), NOW)).toBe('sick');
  });

  it('classifies absent from note (substring "прогул")', () => {
    expect(classifyEntry(base({ note: 'прогул' }), NOW)).toBe('absent');
    expect(classifyEntry(base({ note: 'отметил прогул' }), NOW)).toBe('absent');
  });

  it('classifies day off via isDayOff', () => {
    expect(classifyEntry(base({ isDayOff: true }), NOW)).toBe('dayOff');
  });

  it('classifies late_major via explicit lateStatus', () => {
    expect(classifyEntry(base({ lateStatus: 'late_major' }), NOW)).toBe('lateMajor');
  });

  it('classifies late_major when lateMinutes >= 60', () => {
    expect(classifyEntry(base({ lateMinutes: 60 }), NOW)).toBe('lateMajor');
    expect(classifyEntry(base({ lateMinutes: 240 }), NOW)).toBe('lateMajor');
  });

  it('classifies late_minor via explicit lateStatus', () => {
    expect(classifyEntry(base({ lateStatus: 'late_minor' }), NOW)).toBe('lateMinor');
  });

  it('classifies late_minor when 0 < lateMinutes < 60', () => {
    expect(classifyEntry(base({ lateMinutes: 15 }), NOW)).toBe('lateMinor');
    expect(classifyEntry(base({ lateMinutes: 59 }), NOW)).toBe('lateMinor');
  });

  it('classifies a fulfilled shift (actualArrival)', () => {
    expect(classifyEntry(base({ actualArrival: '2026-05-18T09:00:00' }), NOW)).toBe('full');
  });

  it('classifies on_time even without actualArrival', () => {
    expect(classifyEntry(base({ lateStatus: 'on_time' }), NOW)).toBe('full');
  });

  it('marks past day with no arrival as absent', () => {
    expect(classifyEntry(base({ date: '2026-05-10' }), NOW)).toBe('absent');
  });

  it('returns null for today with no arrival yet (still in progress)', () => {
    const today = '2026-05-19';
    expect(classifyEntry(base({ date: today }), NOW)).toBe(null);
  });
});

describe('dedupeEntriesByDay', () => {
  it('keeps the entry with the most information', () => {
    const entries: RawScheduleEntry[] = [
      { userId: 'u1', date: '2026-05-18' },
      { userId: 'u1', date: '2026-05-18', actualArrival: '2026-05-18T09:00:00', lateStatus: 'on_time' },
    ];
    const out = dedupeEntriesByDay(entries);
    expect(out).toHaveLength(1);
    expect(out[0].actualArrival).toBeDefined();
  });

  it('uses createdAt as tiebreaker when info score is equal', () => {
    const entries: RawScheduleEntry[] = [
      { userId: 'u1', date: '2026-05-18', note: 'old', createdAt: '2026-05-18T08:00:00' },
      { userId: 'u1', date: '2026-05-18', note: 'new', createdAt: '2026-05-18T10:00:00' },
    ];
    const out = dedupeEntriesByDay(entries);
    expect(out).toHaveLength(1);
    expect(out[0].note).toBe('new');
  });

  it('preserves entries for different days', () => {
    const entries: RawScheduleEntry[] = [
      { userId: 'u1', date: '2026-05-18' },
      { userId: 'u1', date: '2026-05-17' },
    ];
    expect(dedupeEntriesByDay(entries)).toHaveLength(2);
  });

  it('preserves entries for different users on the same day', () => {
    const entries: RawScheduleEntry[] = [
      { userId: 'u1', date: '2026-05-18' },
      { userId: 'u2', date: '2026-05-18' },
    ];
    expect(dedupeEntriesByDay(entries)).toHaveLength(2);
  });

  it('skips invalid entries (missing userId or date)', () => {
    const entries: RawScheduleEntry[] = [
      { userId: '', date: '2026-05-18' },
      { userId: 'u1', date: '' },
      { userId: 'u1', date: '2026-05-18' },
    ];
    expect(dedupeEntriesByDay(entries)).toHaveLength(1);
  });
});

describe('calculateAttendanceStats', () => {
  it('returns an empty map for empty input', () => {
    expect(calculateAttendanceStats([], NOW)).toEqual({});
  });

  it('counts a mixed month correctly', () => {
    const entries: RawScheduleEntry[] = [
      { userId: 'u1', date: '2026-05-01', actualArrival: '2026-05-01T09:00:00', lateStatus: 'on_time' },
      { userId: 'u1', date: '2026-05-02', actualArrival: '2026-05-02T09:00:00', lateStatus: 'on_time' },
      { userId: 'u1', date: '2026-05-03', lateMinutes: 30 }, // late_minor
      { userId: 'u1', date: '2026-05-04', lateMinutes: 120 }, // late_major
      { userId: 'u1', date: '2026-05-05', note: 'прогул' },
      { userId: 'u1', date: '2026-05-06', note: 'на больничном' },
      { userId: 'u1', date: '2026-05-07', isDayOff: true },
    ];
    const stats = calculateAttendanceStats(entries, NOW);
    expect(stats.u1.full).toBe(2);
    expect(stats.u1.lateMinor).toBe(1);
    expect(stats.u1.lateMajor).toBe(1);
    expect(stats.u1.late).toBe(2);
    expect(stats.u1.absent).toBe(1);
    expect(stats.u1.sick).toBe(1);
    expect(stats.u1.dayOff).toBe(1);
    // total excludes sick + dayOff (those are not "working days missed")
    expect(stats.u1.total).toBe(2 + 1 + 1 + 1);
  });

  it('sorts date arrays', () => {
    const entries: RawScheduleEntry[] = [
      { userId: 'u1', date: '2026-05-05', actualArrival: '2026-05-05T09:00:00', lateStatus: 'on_time' },
      { userId: 'u1', date: '2026-05-01', actualArrival: '2026-05-01T09:00:00', lateStatus: 'on_time' },
      { userId: 'u1', date: '2026-05-03', actualArrival: '2026-05-03T09:00:00', lateStatus: 'on_time' },
    ];
    const stats = calculateAttendanceStats(entries, NOW);
    expect(stats.u1.fullDates).toEqual(['2026-05-01', '2026-05-03', '2026-05-05']);
  });

  it('ignores future dates', () => {
    const entries: RawScheduleEntry[] = [{ userId: 'u1', date: '2099-01-01', actualArrival: '2099-01-01T09:00:00' }];
    expect(calculateAttendanceStats(entries, NOW)).toEqual({});
  });

  it('isolates stats per user', () => {
    const entries: RawScheduleEntry[] = [
      { userId: 'u1', date: '2026-05-01', actualArrival: 'x', lateStatus: 'on_time' },
      { userId: 'u2', date: '2026-05-01', note: 'прогул' },
    ];
    const stats = calculateAttendanceStats(entries, NOW);
    expect(stats.u1.full).toBe(1);
    expect(stats.u2.absent).toBe(1);
  });
});

describe('attendanceScore', () => {
  it('returns 0 for an empty record', () => {
    expect(attendanceScore({ full: 0, lateMinor: 0 })).toBe(0);
  });

  it('returns 100 at 22 full shifts (monthly target)', () => {
    expect(attendanceScore({ full: MONTHLY_TARGET_SHIFTS, lateMinor: 0 })).toBe(100);
  });

  it('caps at 100 above target', () => {
    expect(attendanceScore({ full: 30, lateMinor: 0 })).toBe(100);
  });

  it('counts late minor at 0.5x weight', () => {
    expect(LATE_MINOR_WEIGHT).toBe(0.5);
    // 20 full + 2 lateMinor = 21 points / 22 target = 95.4… → 95
    expect(attendanceScore({ full: 20, lateMinor: 2 })).toBe(95);
  });

  it('matches the doc example (15 full only → 68%)', () => {
    expect(attendanceScore({ full: 15, lateMinor: 0 })).toBe(68);
  });
});

describe('emptyBreakdown', () => {
  it('returns a fresh zeroed breakdown each call', () => {
    const a = emptyBreakdown();
    a.full = 5;
    const b = emptyBreakdown();
    expect(b.full).toBe(0);
    expect(b.fullDates).toEqual([]);
  });
});
