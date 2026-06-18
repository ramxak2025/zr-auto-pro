/**
 * Тесты bookingHelpers — защита load-bearing логики раздела «Записи»:
 *   • относительные даты (Сегодня/Завтра/Вчера/дата);
 *   • 24-часовое время с ведущими нулями;
 *   • «без мастера» когда master_id = null;
 *   • статус-чип для каждого BookingStatus;
 *   • countUpcoming считает только будущие scheduled.
 */
import {
  formatBookingTime,
  formatBookingDay,
  formatBookingDateTime,
  masterLabel,
  isActiveBooking,
  countUpcoming,
  statusChip,
  BOOKING_STATUS_CHIP,
} from '../bookings/bookingHelpers';
import type { Booking, BookingStatus } from '../../../../shared/types';

// Фиксируем «сейчас» детерминированно, чтобы относительные даты были стабильны.
const NOW = new Date('2026-06-18T12:00:00');

beforeAll(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
});
afterAll(() => {
  jest.useRealTimers();
});

// Утилита: ISO для даты в этот же день, конкретное время.
function at(dateISO: string): string {
  return new Date(dateISO).toISOString();
}

describe('formatBookingTime', () => {
  it('24-часовой формат с ведущими нулями', () => {
    expect(formatBookingTime(at('2026-06-18T09:05:00'))).toBe('09:05');
    expect(formatBookingTime(at('2026-06-18T18:30:00'))).toBe('18:30');
    expect(formatBookingTime(at('2026-06-18T00:00:00'))).toBe('00:00');
  });
  it('пустая строка на невалидной дате', () => {
    expect(formatBookingTime('not-a-date')).toBe('');
  });
});

describe('formatBookingDay', () => {
  it('Сегодня / Завтра / Вчера', () => {
    expect(formatBookingDay(at('2026-06-18T08:00:00'))).toBe('Сегодня');
    expect(formatBookingDay(at('2026-06-19T08:00:00'))).toBe('Завтра');
    expect(formatBookingDay(at('2026-06-17T08:00:00'))).toBe('Вчера');
  });
  it('дата того же года — без года', () => {
    expect(formatBookingDay(at('2026-06-25T08:00:00'))).toBe('25 июн');
  });
  it('дата другого года — с годом', () => {
    expect(formatBookingDay(at('2025-12-31T08:00:00'))).toBe('31 дек 2025');
  });
});

describe('formatBookingDateTime', () => {
  it('склеивает день и время', () => {
    expect(formatBookingDateTime(at('2026-06-18T14:30:00'))).toBe('Сегодня, 14:30');
  });
});

describe('masterLabel', () => {
  it('имя мастера, когда назначен', () => {
    expect(masterLabel({ masterId: 'm1', masterName: 'Иван Петров' })).toBe('Иван Петров');
  });
  it('«без мастера», когда master_id = null', () => {
    expect(masterLabel({ masterId: null, masterName: null })).toBe('без мастера');
    expect(masterLabel({ masterId: undefined, masterName: undefined })).toBe('без мастера');
  });
  it('фолбэк «Мастер», если id есть, а имени нет', () => {
    expect(masterLabel({ masterId: 'm1', masterName: null })).toBe('Мастер');
  });
});

describe('isActiveBooking', () => {
  it('scheduled / arrived — активны', () => {
    expect(isActiveBooking('scheduled')).toBe(true);
    expect(isActiveBooking('arrived')).toBe(true);
  });
  it('converted / cancelled / no_show — нет', () => {
    expect(isActiveBooking('converted')).toBe(false);
    expect(isActiveBooking('cancelled')).toBe(false);
    expect(isActiveBooking('no_show')).toBe(false);
  });
});

describe('statusChip', () => {
  it('у каждого статуса есть лейбл и цвета', () => {
    const statuses: BookingStatus[] = ['scheduled', 'arrived', 'converted', 'cancelled', 'no_show'];
    for (const s of statuses) {
      const chip = statusChip(s);
      expect(chip.label.length).toBeGreaterThan(0);
      expect(chip.bg).toMatch(/^#|rgb/);
      expect(chip.text).toMatch(/^#|rgb/);
      expect(chip).toBe(BOOKING_STATUS_CHIP[s]);
    }
  });
});

describe('countUpcoming', () => {
  const mk = (status: BookingStatus, iso: string): Booking =>
    ({
      id: Math.random().toString(),
      tenantId: 't',
      clientId: 'c',
      scheduledAt: at(iso),
      status,
      notifyOnCreate: false,
      createdAt: at('2026-06-01T00:00:00'),
    }) as Booking;

  it('считает только будущие scheduled', () => {
    const list: Booking[] = [
      mk('scheduled', '2026-06-19T10:00:00'), // future scheduled ✓
      mk('scheduled', '2026-06-20T10:00:00'), // future scheduled ✓
      mk('scheduled', '2026-06-17T10:00:00'), // past scheduled ✗
      mk('arrived', '2026-06-19T10:00:00'), // arrived ✗ (не scheduled)
      mk('converted', '2026-06-19T10:00:00'), // converted ✗
      mk('cancelled', '2026-06-19T10:00:00'), // cancelled ✗
    ];
    expect(countUpcoming(list)).toBe(2);
  });

  it('undefined → 0', () => {
    expect(countUpcoming(undefined)).toBe(0);
  });
  it('пустой список → 0', () => {
    expect(countUpcoming([])).toBe(0);
  });
});
