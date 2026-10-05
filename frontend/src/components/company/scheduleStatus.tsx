import { AlarmClock, AlertTriangle, Check, Clock, Moon, Thermometer, X, type LucideIcon } from 'lucide-react';
import type { ScheduleEntry, TodayEmployeeStatus } from '../../types';
import type { Tone } from '../../ui/tokens';
import { recordedAttendanceBucket } from '../../../../shared/utils/attendance';
import { formatTimeShort } from '../../../../shared/utils/formatters';

/**
 * Единый словарь статусов расписания: сетка графика, легенда, быстрый выбор
 * статуса, вкладка «Сегодня» и рейтинг рисуют один и тот же набор значков и
 * тонов. Палитра совпадает с виджетом «Сотрудники сегодня» на Главной
 * (StaffTodayCard): смена — ok, опоздание до часа — warn, больше часа — orange,
 * прогул — bad, больничный — info, выходной — нейтральный. Эмодзи заменены
 * lucide-значками с подписью: у эмодзи не было текста для скринридера, а
 * значение цвета не читалось без легенды.
 */
export type ScheduleStatusKind = 'planned' | 'onTime' | 'lateMinor' | 'lateMajor' | 'absent' | 'dayOff' | 'sick';

export interface ScheduleStatusDef {
  label: string;
  short: string;
  icon: LucideIcon;
  /** Классы ячейки сетки / плитки легенды. */
  cell: string;
  tone: Tone;
}

export const SCHEDULE_STATUS: Record<ScheduleStatusKind, ScheduleStatusDef> = {
  planned: {
    label: 'Смена запланирована',
    short: 'План',
    icon: Clock,
    cell: 'bg-surface-3 text-ink-3 border-line-strong',
    tone: 'neutral',
  },
  onTime: {
    label: 'На смене вовремя',
    short: 'Вовремя',
    icon: Check,
    cell: 'bg-ok-soft text-ok-text border-ok/40',
    tone: 'ok',
  },
  lateMinor: {
    label: 'Опоздание до часа',
    short: 'До 1 ч',
    icon: AlarmClock,
    cell: 'bg-warn-soft text-warn-text border-warn/40',
    tone: 'warn',
  },
  lateMajor: {
    label: 'Опоздание больше часа',
    short: 'Больше 1 ч',
    icon: AlertTriangle,
    cell: 'bg-orange-50 text-orange-700 border-orange-300',
    tone: 'warn',
  },
  absent: {
    label: 'Прогул',
    short: 'Прогул',
    icon: X,
    cell: 'bg-bad-soft text-bad-text border-bad/40',
    tone: 'bad',
  },
  dayOff: {
    label: 'Выходной',
    short: 'Выходной',
    icon: Moon,
    cell: 'bg-surface-3 text-ink-3 border-line-strong',
    tone: 'neutral',
  },
  sick: {
    label: 'Больничный',
    short: 'Больничный',
    icon: Thermometer,
    cell: 'bg-info-soft text-info-text border-info/40',
    tone: 'info',
  },
};

/** Порядок легенды под сеткой. */
export const LEGEND_KINDS: ScheduleStatusKind[] = ['planned', 'dayOff', 'sick', 'lateMinor', 'lateMajor', 'absent'];

export interface ScheduleCell {
  kind: ScheduleStatusKind;
  /** Время начала смены — показывается вместо значка, когда сотрудник пришёл вовремя. */
  time?: string;
}

/**
 * Recorded attendance wins over a plan. Unmarked days never imply absence.
 * Custom plan hours remain visible neutrally, even on today's date.
 */
export function scheduleCellOf(
  entry: ScheduleEntry | undefined,
  dateStr: string,
  todayKey: string,
): ScheduleCell | null {
  if (!entry) return null;
  const bucket = recordedAttendanceBucket(entry);
  if (bucket === 'sick') return { kind: 'sick' };
  if (bucket === 'absent') return { kind: 'absent' };
  if (bucket === 'dayOff') return { kind: 'dayOff' };
  if (bucket === 'lateMajor') return { kind: 'lateMajor' };
  if (bucket === 'lateMinor') return { kind: 'lateMinor' };
  if (bucket === 'full') return { kind: 'onTime', time: entry.shiftStart?.slice(0, 5) };
  if (entry.shiftStart && (dateStr > todayKey || entry.shiftStart.slice(0, 5) !== '09:00')) {
    return { kind: 'planned', time: entry.shiftStart.slice(0, 5) };
  }
  return null;
}

/** Статус сотрудника на вкладке «Сегодня» — подпись и тон пилюли. */
export function todayStatusOf(s: TodayEmployeeStatus): { label: string; tone: Tone } {
  const bucket = recordedAttendanceBucket(s);
  if (bucket === 'sick') return { label: 'Больничный', tone: 'info' };
  if (bucket === 'absent') return { label: 'Прогул', tone: 'bad' };
  if (bucket === 'dayOff') return { label: 'Выходной', tone: 'neutral' };
  if (bucket === 'lateMajor') return { label: 'Опоздание от часа', tone: 'warn' };
  if (bucket === 'lateMinor') return { label: 'Опоздание до часа', tone: 'warn' };
  if (bucket === 'full') return { label: 'Смена', tone: 'ok' };
  if (s.isWorking) return { label: 'На смене', tone: 'ok' };
  return { label: s.hasSchedule ? 'Не отмечен' : 'Нет расписания', tone: 'neutral' };
}

/** 'HH:MM' из 'HH:MM:SS' или ISO-строки; пусто → «—». */
export function shortTime(value?: string | null, timeZone?: string): string {
  if (!value) return '—';
  if (/^\d{2}:\d{2}/.test(value)) return value.slice(0, 5);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return formatTimeShort(d, timeZone);
}
