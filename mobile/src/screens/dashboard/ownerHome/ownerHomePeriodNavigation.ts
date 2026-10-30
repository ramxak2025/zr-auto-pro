import type { OwnerHomeTimelinePeriod } from '../../../../../shared/types/ownerHome';
import { moveOwnerDay, moveOwnerMonth, ownerDateLabel, ownerRangeLabel } from './ownerHomeState';

export const ownerPeriodLabels = {
  day: {
    current: 'Сегодня',
    previous: 'Предыдущий день',
    next: 'Следующий день',
    reset: 'Вернуться к сегодняшнему дню',
  },
  week: {
    current: 'Текущая неделя',
    previous: 'Предыдущая неделя',
    next: 'Следующая неделя',
    reset: 'Вернуться к текущей неделе',
  },
  month: {
    current: 'Текущий месяц',
    previous: 'Предыдущий месяц',
    next: 'Следующий месяц',
    reset: 'Вернуться к текущему месяцу',
  },
  year: {
    current: 'Текущий год',
    previous: 'Предыдущий год',
    next: 'Следующий год',
    reset: 'Вернуться к текущему году',
  },
} as const;

export interface OwnerPeriodNavigation {
  label: string;
  rangeLabel: string;
  previousDate: string | null;
  nextDate: string | null;
  canReturnToToday: boolean;
}

function civilDate(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) < 100) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function periodStart(period: OwnerHomeTimelinePeriod, selected: string): string {
  if (period === 'day') return selected;
  if (period === 'year') return `${selected.slice(0, 4)}-01-01`;
  if (period === 'month') return `${selected.slice(0, 7)}-01`;
  const weekday = new Date(`${selected}T12:00:00Z`).getUTCDay() || 7;
  return moveOwnerDay(selected, 1 - weekday);
}

/** Civil paging only: the server still owns tenant today and every financial window. */
export function ownerPeriodNavigation(
  period: OwnerHomeTimelinePeriod,
  selected: string | undefined,
  today: string | undefined,
): OwnerPeriodNavigation | null {
  if (!civilDate(selected) || !civilDate(today) || selected > today) return null;
  const from = periodStart(period, selected);
  const previous = moveOwnerDay(from, -1);
  let nextDate: string | null = null;
  if (from < periodStart(period, today)) {
    const next =
      period === 'day'
        ? moveOwnerDay(selected, 1)
        : period === 'week'
          ? moveOwnerDay(from, 13)
          : period === 'month'
            ? moveOwnerDay(moveOwnerMonth(from, 2, 1), -1)
            : `${String(Number(selected.slice(0, 4)) + 1).padStart(4, '0')}-12-31`;
    nextDate = next > today ? today : next;
  }
  const sameYear = selected.slice(0, 4) === today.slice(0, 4);
  let label: string;
  if (period === 'day') {
    const prefix = selected === today ? 'Сегодня, ' : selected === moveOwnerDay(today, -1) ? 'Вчера, ' : '';
    label = `${prefix}${ownerDateLabel(selected, !sameYear)}`;
  } else if (period === 'week') label = ownerRangeLabel(from, selected, today.slice(0, 4));
  else if (period === 'year') label = `${selected.slice(0, 4)} год`;
  else {
    const month = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', month: 'long' }).format(
      new Date(`${selected}T12:00:00Z`),
    );
    label = `${month.charAt(0).toUpperCase()}${month.slice(1)} ${selected.slice(0, 4)}`;
  }
  return {
    label,
    rangeLabel: ownerRangeLabel(from, selected),
    previousDate: civilDate(previous) ? previous : null,
    nextDate,
    canReturnToToday: selected !== today,
  };
}
