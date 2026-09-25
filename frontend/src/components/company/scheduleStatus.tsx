import { AlarmClock, AlertTriangle, Check, Moon, Thermometer, X, type LucideIcon } from 'lucide-react';
import type { ScheduleEntry, TodayEmployeeStatus } from '../../types';
import type { Tone } from '../../ui/tokens';

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
    short: 'Смена',
    icon: Check,
    cell: 'bg-ok-soft text-ok-text border-ok/30',
    tone: 'ok',
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

const isSickNote = (note?: string | null) => (note || '').toLowerCase().includes('больнич');
const isAbsentNote = (note?: string | null) => (note || '').toLowerCase().includes('прогул');

/**
 * Статус ячейки сетки по записи расписания. Логика перенесена без изменений:
 * заметка «больничный»/«прогул» важнее флагов; прошедший день со сменой без
 * факта прихода считается прогулом; будущий — просто запланированной сменой.
 */
export function scheduleCellOf(
  entry: ScheduleEntry | undefined,
  dateStr: string,
  todayKey: string,
): ScheduleCell | null {
  if (!entry) return null;
  const lateMin = entry.lateMinutes || 0;
  const isPast = dateStr < todayKey;
  const isToday = dateStr === todayKey;

  if (isSickNote(entry.note)) return { kind: 'sick' };
  if (isAbsentNote(entry.note)) return { kind: 'absent' };
  if (entry.isDayOff) return { kind: 'dayOff' };
  if (entry.lateStatus === 'late_major' || lateMin >= 60) return { kind: 'lateMajor' };
  if (entry.lateStatus === 'late_minor' || (lateMin > 0 && lateMin < 60)) return { kind: 'lateMinor' };
  if (entry.shiftStart && (entry.actualArrival || entry.lateStatus === 'on_time')) {
    return { kind: 'onTime', time: entry.shiftStart.slice(0, 5) };
  }
  if (entry.shiftStart && !entry.isDayOff && isPast && !isToday) return { kind: 'absent' };
  if (entry.shiftStart) return { kind: 'planned' };
  return null;
}

/** Статус сотрудника на вкладке «Сегодня» — подпись и тон пилюли. */
export function todayStatusOf(s: TodayEmployeeStatus): { label: string; tone: Tone } {
  if (isSickNote(s.note)) return { label: 'Больничный', tone: 'info' };
  if (s.isDayOff) return { label: 'Выходной', tone: 'neutral' };
  if (!s.hasSchedule) return { label: 'Нет расписания', tone: 'neutral' };
  if (s.lateStatus === 'late_major') return { label: 'Опоздание больше часа', tone: 'warn' };
  if (s.lateStatus === 'late_minor') return { label: 'Опоздание до часа', tone: 'warn' };
  if (s.isWorking || s.actualArrival || s.lateStatus === 'on_time') return { label: 'На смене', tone: 'ok' };
  if (isAbsentNote(s.note)) return { label: 'Прогул', tone: 'bad' };
  return { label: 'Не пришёл', tone: 'bad' };
}

/** 'HH:MM' из 'HH:MM:SS' или ISO-строки; пусто → «—». */
export function shortTime(value?: string | null): string {
  if (!value) return '—';
  if (/^\d{2}:\d{2}/.test(value)) return value.slice(0, 5);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}
