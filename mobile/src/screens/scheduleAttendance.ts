import type { Ionicons } from '@expo/vector-icons';
import type { ScheduleEntry, TodayEmployeeStatus } from '../../../shared/types';
import { recordedAttendanceBucket } from '../../../shared/utils/attendance';
import { colors } from '../theme';

type CellStatusKey = 'worked' | 'dayoff' | 'sick' | 'short' | 'long' | 'absent';

interface CellDescriptor {
  key: CellStatusKey | null;
  hasEntry: boolean;
  icon: keyof typeof Ionicons.glyphMap | null;
  dotColor: string;
  bgColor: string;
  bgDark: string;
  label: string;
}

const EMPTY_CELL: CellDescriptor = {
  key: null,
  hasEntry: false,
  icon: null,
  dotColor: 'transparent',
  bgColor: 'transparent',
  bgDark: 'transparent',
  label: '',
};

// Default shift start time. When the entry simply mirrors this we do
// NOT render the time label — every worked day would otherwise read
// "09:00" and turn the grid into chatbot noise.
const DEFAULT_SHIFT_START = '09:00';

export function gridAttendanceCounts(
  entries: (ScheduleEntry | undefined)[],
  today: string,
): { worked: number; off: number } {
  let worked = 0;
  let off = 0;
  for (const entry of entries) {
    if (!entry) continue;
    if (entry.isDayOff) off++;
    const date = String(entry.date ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today) continue;
    const bucket = recordedAttendanceBucket(entry);
    if (bucket === 'full' || bucket === 'lateMinor' || bucket === 'lateMajor') worked++;
  }
  return { worked, off };
}

export function getCellDot(entry: ScheduleEntry | undefined, today: string): CellDescriptor {
  if (!entry) return EMPTY_CELL;
  const bucket = recordedAttendanceBucket(entry);
  const dateOnly = String(entry.date ?? '').slice(0, 10);
  if (!dateOnly) return EMPTY_CELL;
  // 1. Больничный
  if (bucket === 'sick')
    return {
      key: 'sick',
      hasEntry: true,
      icon: 'medkit-outline',
      dotColor: colors.orange[600],
      bgColor: colors.orange[50],
      bgDark: 'rgba(234, 88, 12, 0.18)',
      label: '',
    };
  // 2. Прогул из note — лёгкий X-glyph вместо «жирного красного кружка».
  if (bucket === 'absent')
    return {
      key: 'absent',
      hasEntry: true,
      icon: 'close',
      dotColor: colors.red[600],
      bgColor: colors.red[50],
      bgDark: 'rgba(220, 38, 38, 0.18)',
      label: '',
    };
  // 3. Выходной
  if (bucket === 'dayOff')
    return {
      key: 'dayoff',
      hasEntry: true,
      icon: 'moon-outline',
      dotColor: colors.gray[500],
      bgColor: colors.gray[100],
      bgDark: 'rgba(148, 163, 184, 0.15)',
      label: '',
    };
  // 4. Опоздание >1ч — clean triangle-warning stroke. Previously the
  //    Ionicons `alert-circle` mapped to a heavy filled circle that the
  //    owner reported as "красный кружок вместо иконки". Swap to the
  //    outline triangle which reads as "warning" with a clean stroke.
  if (bucket === 'lateMajor')
    return {
      key: 'long',
      hasEntry: true,
      icon: 'warning-outline',
      dotColor: colors.red[500],
      bgColor: colors.red[50],
      bgDark: 'rgba(239, 68, 68, 0.15)',
      label: '',
    };
  // 5. Опоздание <1ч
  if (bucket === 'lateMinor')
    return {
      key: 'short',
      hasEntry: true,
      icon: 'time-outline',
      dotColor: colors.amber[600],
      bgColor: colors.amber[50],
      bgDark: 'rgba(217, 119, 6, 0.18)',
      label: '',
    };
  // 6. Открыл смену вовремя (FACT) — saturated green background + light
  //    pastel-green check. Owner explicitly wanted this to read as "yes,
  //    this shift was actually worked" at-a-glance, distinct from a
  //    merely-planned green outline cell (case #8 below). Time is shown
  //    only when it differs from the default start.
  if (bucket === 'full') {
    const startHHMM = String(entry.shiftStart || DEFAULT_SHIFT_START).slice(0, 5);
    return {
      key: 'worked',
      hasEntry: true,
      icon: 'checkmark',
      // Light pastel check on saturated green canvas — high contrast,
      // owner can sweep the grid and instantly see what was confirmed.
      dotColor: colors.green[100],
      bgColor: colors.green[600],
      bgDark: 'rgba(22, 163, 74, 0.55)',
      label: startHHMM === DEFAULT_SHIFT_START ? '' : startHHMM,
    };
  }
  // A plan is not attendance. Show a custom start today neutrally; default unmarked days stay blank.
  if (entry.shiftStart && (dateOnly > today || entry.shiftStart.slice(0, 5) !== DEFAULT_SHIFT_START)) {
    return {
      key: null,
      hasEntry: true,
      icon: null,
      dotColor: colors.gray[600],
      bgColor: colors.gray[100],
      bgDark: 'rgba(148, 163, 184, 0.15)',
      label: entry.shiftStart.slice(0, 5),
    };
  }
  return EMPTY_CELL;
}

export const getTodayStatusInfo = (
  s: TodayEmployeeStatus,
): {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
  softBg: string;
} => {
  const bucket = recordedAttendanceBucket(s);
  if (bucket === 'sick')
    return { label: 'Больничный', icon: 'medkit-outline', tint: colors.rose[600], softBg: colors.rose[50] };
  if (bucket === 'dayOff')
    return { label: 'Выходной', icon: 'moon-outline', tint: colors.gray[500], softBg: colors.gray[100] };
  if (bucket === 'lateMajor')
    return {
      label: s.lateMinutes ? `Опоздание ${s.lateMinutes} мин` : 'Опоздание больше часа',
      icon: 'warning-outline',
      tint: colors.orange[600],
      softBg: colors.orange[50],
    };
  if (bucket === 'lateMinor')
    return {
      label: s.lateMinutes ? `Опоздание ${s.lateMinutes} мин` : 'Опоздание меньше часа',
      icon: 'time-outline',
      tint: colors.amber[600],
      softBg: colors.amber[50],
    };
  if (bucket === 'absent') return { label: 'Прогул', icon: 'close', tint: colors.red[600], softBg: colors.red[50] };
  if (bucket === 'full' || s.isWorking)
    return {
      label: bucket === 'full' ? 'Смена' : 'На смене',
      icon: 'checkmark-circle',
      tint: colors.green[600],
      softBg: colors.green[50],
    };
  return { label: 'Не отмечен', icon: 'remove-outline', tint: colors.gray[400], softBg: colors.gray[50] };
};
