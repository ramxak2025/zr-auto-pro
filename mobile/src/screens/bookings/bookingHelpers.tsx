/**
 * bookingHelpers — общая логика раздела «Записи» (список, деталка, создание).
 *
 * Держим тут всё, что переиспользуется между BookingsScreen /
 * BookingDetailScreen / BookingCreateScreen, чтобы не дублировать форматтеры
 * даты/времени и конфиг статус-чипов. Чистый JS (никаких iOS-only API) —
 * Android-safe.
 */
import { colors } from '../../theme';
import type { Booking, BookingStatus } from '../../../../shared/types';

// ── Статус-чип ────────────────────────────────────────────────────────────
// Семантическая палитра под каждый статус брони. bg — мягкая подложка, text —
// акцентный цвет надписи (как в roleBadgeColors из MoreScreen).
export interface StatusChipStyle {
  label: string;
  bg: string;
  text: string;
}

export const BOOKING_STATUS_CHIP: Record<BookingStatus, StatusChipStyle> = {
  scheduled: { label: 'Запланирована', bg: colors.blue[50], text: colors.blue[600] },
  arrived: { label: 'Пришёл', bg: colors.amber[50], text: colors.amber[700] },
  converted: { label: 'Проведена', bg: colors.green[50], text: colors.green[700] },
  cancelled: { label: 'Отменена', bg: colors.gray[100], text: colors.gray[500] },
  no_show: { label: 'Не пришёл', bg: colors.rose[50], text: colors.rose[600] },
};

export function statusChip(status: BookingStatus): StatusChipStyle {
  return BOOKING_STATUS_CHIP[status] ?? BOOKING_STATUS_CHIP.scheduled;
}

// ── Дата/время ──────────────────────────────────────────────────────────────
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** «14:30» — 24-часовой формат, продуктовый язык русский. */
export function formatBookingTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * Человекочитаемая дата относительно сегодня: «Сегодня», «Завтра», «Вчера»,
 * иначе «18 июн» (без года, если год текущий) либо «18 июн 2025».
 */
export function formatBookingDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const diffDays = Math.round((startOfDay(d) - startOfDay(now)) / (24 * 60 * 60 * 1000));
  if (diffDays === 0) return 'Сегодня';
  if (diffDays === 1) return 'Завтра';
  if (diffDays === -1) return 'Вчера';
  const base = `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

/** «Сегодня, 14:30» — заголовок для строки списка / деталки. */
export function formatBookingDateTime(iso: string): string {
  const day = formatBookingDay(iso);
  const time = formatBookingTime(iso);
  if (!day && !time) return '';
  return `${day}, ${time}`;
}

/** «без мастера» когда запись общая (master_id = null). */
export function masterLabel(b: Pick<Booking, 'masterName' | 'masterId'>): string {
  if (b.masterId && b.masterName) return b.masterName;
  if (b.masterId) return 'Мастер';
  return 'без мастера';
}

/** Запись «живая» (можно отменить / перенести / провести приход). */
export function isActiveBooking(status: BookingStatus): boolean {
  return status === 'scheduled' || status === 'arrived';
}

/**
 * Подсчёт «требует внимания» для бейджа на пункте меню: будущие
 * запланированные записи (scheduled и время ещё не прошло). Считаем по
 * scope=upcoming набору.
 */
export function countUpcoming(bookings: Booking[] | undefined): number {
  if (!bookings) return 0;
  const now = Date.now();
  let n = 0;
  for (const b of bookings) {
    if (b.status === 'scheduled' && new Date(b.scheduledAt).getTime() >= now) n += 1;
  }
  return n;
}
