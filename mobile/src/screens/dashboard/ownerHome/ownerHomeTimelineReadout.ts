import type { OwnerHomeTimeline } from '../../../../../shared/types/ownerHome';
import { formatDayKey } from '../../../../../shared/utils/formatters';
import { ownerClock, ownerDateLabel } from './ownerHomeState';
import { ownerOffsetLabel, type OwnerTimelineModel, type OwnerTimelinePoint } from './ownerHomeTimelineModel';

/** Compact visual caption; the complete server interval remains the accessible label. */
export function ownerTimelineReadoutLabel(
  data: OwnerHomeTimeline,
  model: OwnerTimelineModel,
  point: OwnerTimelinePoint,
): string {
  if (model.period === 'year') {
    const month = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', month: 'long' }).format(
      new Date(`${point.localDate}T12:00:00Z`),
    );
    const [year, monthNumber, day] = point.localDate.split('-').map(Number);
    return day === new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
      ? month
      : `${month} · ${day === 1 ? '1' : `1–${day}`}`;
  }
  const date = ownerDateLabel(point.localDate);
  if (model.period !== 'day') return date;
  const start = ownerClock(point.at, data.timezone);
  const end =
    formatDayKey(new Date(point.untilExclusive), data.timezone) > point.localDate
      ? '24:00'
      : ownerClock(point.untilExclusive, data.timezone);
  const startOffset = ownerOffsetLabel(point.at, data.timezone),
    endOffset = ownerOffsetLabel(point.untilExclusive, data.timezone);
  const repeated = model.points.some((other) => other.at !== point.at && ownerClock(other.at, data.timezone) === start);
  if (point.at === point.untilExclusive) return `${date} · ${start}`;
  if (startOffset !== endOffset) return `${date} · ${start} ${startOffset}–${end} ${endOffset}`;
  return `${date} · ${start}–${end}${repeated ? ` ${startOffset}` : ''}`;
}
