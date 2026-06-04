// ═══════════════════════════════════════════════════════════════════════════════
//  Attendance stats — SINGLE SOURCE OF TRUTH
//
//  Used by every rating widget across web + mobile so numbers are identical
//  everywhere. Computes per-user stats from raw schedule_entries for a month.
//
//  RULES (in evaluation order):
//    1. Only days in the past or today are counted (future days skipped).
//    2. Per (userId, date) — deduplicate. If duplicate entries exist (from
//       race conditions, legacy data before the unique constraint), keep the
//       one with the most information (actualArrival > lateStatus > newer).
//    3. Note contains "больнич" → sick (not counted in total).
//    4. Note contains "прогул"  → absent (counted in total).
//    5. isDayOff = true         → day off (not counted in total).
//    6. Otherwise the day IS a working day (total++), then:
//       - late_major OR lateMinutes ≥ 60  → late major (miss)
//       - late_minor OR 0 < lateMinutes < 60 → late minor (miss)
//       - actualArrival set AND lateStatus='on_time' (or no lateness) → FULL
//       - else (past date, no arrival) → absent
//
//  "Full shift" is the numerator for the attendance score:
//    score = round((full / total) * 100)
// ═══════════════════════════════════════════════════════════════════════════════

export interface RawScheduleEntry {
  userId: string;
  date: string;
  isDayOff?: boolean;
  note?: string | null;
  actualArrival?: string | null;
  lateStatus?: string | null;
  lateMinutes?: number | null;
  createdAt?: string | null;
}

export interface AttendanceBreakdown {
  full: number;
  late: number;
  lateMinor: number;
  lateMajor: number;
  absent: number;
  sick: number;
  dayOff: number;
  total: number;
  // Lists of dates (YYYY-MM-DD) for transparency / UI breakdown
  fullDates: string[];
  lateMinorDates: string[];
  lateMajorDates: string[];
  absentDates: string[];
  sickDates: string[];
  dayOffDates: string[];
}

const EMPTY_BREAKDOWN = (): AttendanceBreakdown => ({
  full: 0, late: 0, lateMinor: 0, lateMajor: 0, absent: 0, sick: 0, dayOff: 0, total: 0,
  fullDates: [], lateMinorDates: [], lateMajorDates: [], absentDates: [], sickDates: [], dayOffDates: [],
});

function entryInfoScore(e: RawScheduleEntry): number {
  return (e.actualArrival ? 4 : 0)
       + (e.lateStatus ? 2 : 0)
       + (e.note ? 1 : 0);
}

/**
 * Deduplicate entries by (userId, date). Keep the "best" entry per day —
 * the one with the most information. Ties broken by newest createdAt.
 */
export function dedupeEntriesByDay<E extends RawScheduleEntry>(entries: E[]): E[] {
  const best = new Map<string, E>();
  // Defensive: a malformed cache value (undefined / null / non-array) must
  // never make `for…of` throw "undefined is not iterable". Shared by web +
  // mobile, so this single guard hardens both clients.
  for (const e of Array.isArray(entries) ? entries : []) {
    if (!e || !e.userId || !e.date) continue;
    const key = `${e.userId}|${String(e.date).slice(0, 10)}`;
    const prev = best.get(key);
    if (!prev) { best.set(key, e); continue; }
    const prevScore = entryInfoScore(prev);
    const curScore  = entryInfoScore(e);
    if (curScore > prevScore) { best.set(key, e); continue; }
    if (curScore === prevScore) {
      const prevCreated = prev.createdAt ? new Date(prev.createdAt).getTime() : 0;
      const curCreated  = e.createdAt    ? new Date(e.createdAt).getTime()    : 0;
      if (curCreated > prevCreated) best.set(key, e);
    }
  }
  return Array.from(best.values());
}

/**
 * Classify a single entry into exactly one bucket.
 * Returns null if the day should be skipped entirely (future dates).
 */
export type AttendanceBucket = 'sick' | 'absent' | 'dayOff' | 'lateMajor' | 'lateMinor' | 'full';

export function classifyEntry(e: RawScheduleEntry, now: Date = new Date()): AttendanceBucket | null {
  const dateStr = String(e.date || '').slice(0, 10);
  if (!dateStr) return null;
  const entryDate = new Date(dateStr + 'T00:00:00');
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  if (entryDate > todayEnd) return null; // future — skip

  const note = (e.note || '').toLowerCase();
  if (note.includes('больнич')) return 'sick';
  if (note.includes('прогул'))  return 'absent';
  if (e.isDayOff)               return 'dayOff';

  const lateMin = Number(e.lateMinutes) || 0;
  if (e.lateStatus === 'late_major' || lateMin >= 60) return 'lateMajor';
  if (e.lateStatus === 'late_minor' || (lateMin > 0 && lateMin < 60)) return 'lateMinor';
  if (e.actualArrival || e.lateStatus === 'on_time')  return 'full';

  // Past working day, no arrival recorded → absent
  const entryEnd = new Date(dateStr + 'T23:59:59');
  if (entryEnd < now) return 'absent';
  return null; // today but not yet marked — don't count either way
}

/**
 * Compute per-user attendance stats from a list of schedule entries.
 */
export function calculateAttendanceStats<E extends RawScheduleEntry>(
  entries: E[],
  now: Date = new Date(),
): Record<string, AttendanceBreakdown> {
  const deduped = dedupeEntriesByDay(entries);
  const map: Record<string, AttendanceBreakdown> = {};

  for (const e of deduped) {
    const bucket = classifyEntry(e, now);
    if (bucket === null) continue;

    if (!map[e.userId]) map[e.userId] = EMPTY_BREAKDOWN();
    const s = map[e.userId];
    const dateStr = String(e.date).slice(0, 10);

    switch (bucket) {
      case 'sick':
        s.sick++;
        s.sickDates.push(dateStr);
        break;
      case 'dayOff':
        s.dayOff++;
        s.dayOffDates.push(dateStr);
        break;
      case 'absent':
        s.absent++;
        s.total++;
        s.absentDates.push(dateStr);
        break;
      case 'lateMinor':
        s.lateMinor++;
        s.late++;
        s.total++;
        s.lateMinorDates.push(dateStr);
        break;
      case 'lateMajor':
        s.lateMajor++;
        s.late++;
        s.total++;
        s.lateMajorDates.push(dateStr);
        break;
      case 'full':
        s.full++;
        s.total++;
        s.fullDates.push(dateStr);
        break;
    }
  }

  // Sort date arrays for consistent display
  for (const s of Object.values(map)) {
    s.fullDates.sort();
    s.lateMinorDates.sort();
    s.lateMajorDates.sort();
    s.absentDates.sort();
    s.sickDates.sort();
    s.dayOffDates.sort();
  }

  return map;
}

/** Score = round((full / total) * 100). Total includes late + absent + full. */
/**
 * Weight for a "late minor" day (< 1 hour late): gives 50% credit.
 * Everything else is binary: full = 1, late_major / absent / sick / dayOff = 0.
 */
export const LATE_MINOR_WEIGHT = 0.5;

/**
 * Monthly target: 22 full shifts = 100%.
 * Based on standard Russian work month (5 days/week × ~4.4 weeks).
 */
export const MONTHLY_TARGET_SHIFTS = 22;

/**
 * Score = (full + lateMinor × 0.5) / 22 × 100, capped at 100.
 *
 *   22 full on-time shifts → 100%
 *   20 full + 2 late minor → (20 + 1) / 22 = 95%
 *   15 full shifts only → 68%
 *   0 shifts → 0%
 */
export function attendanceScore(
  s: Pick<AttendanceBreakdown, 'full' | 'lateMinor'>,
): number {
  const points = s.full + s.lateMinor * LATE_MINOR_WEIGHT;
  return Math.min(100, Math.round((points / MONTHLY_TARGET_SHIFTS) * 100));
}

export function emptyBreakdown(): AttendanceBreakdown {
  return EMPTY_BREAKDOWN();
}
