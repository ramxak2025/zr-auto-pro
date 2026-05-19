/**
 * Formatters tests — `shared/utils/formatters.ts`.
 *
 * formatMoney is rendered on the Dashboard hero, KPI strip, every chart,
 * every checks list, equipment cards, salary, cash flow. A regression
 * here changes the look of nearly every screen.
 */
import {
  formatMoney,
  formatDateShort,
  formatDateTime,
  getGreeting,
  paymentMethodLabels,
  roleLabels,
  isSubscriptionExpired,
} from '../../../../shared/utils/formatters';

describe('formatMoney', () => {
  it('formats zero', () => {
    expect(formatMoney(0)).toBe('0 ₽');
  });

  it('groups thousands with a thin space', () => {
    expect(formatMoney(1234)).toBe('1 234 ₽');
    expect(formatMoney(1234567)).toBe('1 234 567 ₽');
  });

  it('rounds to integer', () => {
    expect(formatMoney(1234.49)).toBe('1 234 ₽');
    expect(formatMoney(1234.5)).toBe('1 235 ₽');
    expect(formatMoney(1234.99)).toBe('1 235 ₽');
  });

  it('renders negative amounts', () => {
    expect(formatMoney(-1234)).toBe('-1 234 ₽');
  });

  it('handles billion-scale values', () => {
    expect(formatMoney(1_234_567_890)).toBe('1 234 567 890 ₽');
  });
});

describe('formatDateShort', () => {
  it('formats ISO date to DD.MM.YYYY (ru-RU)', () => {
    expect(formatDateShort('2026-05-19T10:00:00Z')).toMatch(/^\d{2}\.\d{2}\.\d{4}$/);
  });
});

describe('formatDateTime', () => {
  it('formats ISO datetime to DD.MM.YY HH:mm', () => {
    // Use a fixed instant in local time to avoid TZ flakiness in CI.
    const out = formatDateTime('2026-05-19T10:00:00');
    expect(out).toMatch(/^\d{2}\.\d{2}\.\d{2} \d{2}:\d{2}$/);
  });
});

describe('getGreeting', () => {
  const RealDate = Date;
  function fixHour(hour: number) {
    const date = new RealDate(2026, 4, 19, hour, 0, 0);
    // `as any` already silences the TS error; the directive was unused
    // and made `tsc --noEmit` fail with TS2578.
    global.Date = jest.fn(() => date) as any;
    global.Date.now = RealDate.now;
  }
  afterEach(() => {
    global.Date = RealDate;
  });

  it('returns "Доброе утро" for morning hours', () => {
    fixHour(8);
    expect(getGreeting()).toBe('Доброе утро');
  });

  it('returns "Добрый день" for midday hours', () => {
    fixHour(14);
    expect(getGreeting()).toBe('Добрый день');
  });

  it('returns "Добрый вечер" for evening hours', () => {
    fixHour(19);
    expect(getGreeting()).toBe('Добрый вечер');
  });

  it('returns "Доброй ночи" for night hours', () => {
    fixHour(2);
    expect(getGreeting()).toBe('Доброй ночи');
    fixHour(23);
    expect(getGreeting()).toBe('Доброй ночи');
  });
});

describe('paymentMethodLabels', () => {
  it('maps known payment methods to Russian', () => {
    expect(paymentMethodLabels.cash).toBe('Наличные');
    expect(paymentMethodLabels.card).toBe('Карта');
    expect(paymentMethodLabels.warranty).toBe('Гарантия');
    expect(paymentMethodLabels.cash_card).toBe('Нал/Карта');
  });
});

describe('roleLabels', () => {
  it('maps known roles to Russian', () => {
    expect(roleLabels.superadmin).toBe('Суперадмин');
    expect(roleLabels.director).toBe('Владелец');
    expect(roleLabels.admin).toBe('Администратор');
    expect(roleLabels.master).toBe('Мастер');
  });
});

describe('isSubscriptionExpired', () => {
  it('returns false for null / undefined / empty', () => {
    expect(isSubscriptionExpired(null)).toBe(false);
    expect(isSubscriptionExpired(undefined)).toBe(false);
    expect(isSubscriptionExpired('')).toBe(false);
  });

  it('returns true for a past date', () => {
    expect(isSubscriptionExpired('2020-01-01T00:00:00Z')).toBe(true);
  });

  it('returns false for a future date', () => {
    expect(isSubscriptionExpired('2099-01-01T00:00:00Z')).toBe(false);
  });
});
