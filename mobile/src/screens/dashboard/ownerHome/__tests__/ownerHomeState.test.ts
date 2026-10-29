import { formatDayKey } from '../../../../../../shared/utils/formatters';
import {
  loadOwnerHome,
  moveOwnerDay,
  moveOwnerMonth,
  ownerDeltaLabel,
  ownerHomeEnabled,
  ownerPickerDate,
  ownerRangeLabel,
  ownerComparisonBars,
  ownerMoney,
  ownerPercentLabel,
} from '../ownerHomeState';

test('only an explicit internal flag and director role select the pilot', () => {
  expect(ownerHomeEnabled(true, 'director')).toBe(true);
  for (const flag of [undefined, null, false, 'true', 1]) expect(ownerHomeEnabled(flag, 'director')).toBe(false);
  for (const role of [undefined, 'admin', 'master', 'superadmin', 'custom'])
    expect(ownerHomeEnabled(true, role)).toBe(false);
});

test('calendar navigation crosses month/year and DST boundaries without device-date authority', () => {
  expect(moveOwnerDay('2026-01-01', -1)).toBe('2025-12-31');
  expect(moveOwnerDay('2026-03-29', 1)).toBe('2026-03-30');
  expect(moveOwnerMonth('2026-03-31', -1)).toBe('2026-02-28');
  expect(moveOwnerMonth('2024-03-31', -1)).toBe('2024-02-29');
  expect(moveOwnerMonth('2026-02-28', -1, 31)).toBe('2026-01-31');
  expect(moveOwnerMonth('2026-01-31', -1)).toBe('2025-12-31');
});

test('native picker roundtrips the selected tenant day even when UTC is another day', () => {
  const date = ownerPickerDate('2026-01-01', 'Pacific/Kiritimati');
  expect(date.toISOString().slice(0, 10)).toBe('2025-12-31');
  expect(formatDayKey(date, 'Pacific/Kiritimati')).toBe('2026-01-01');
  expect(formatDayKey(ownerPickerDate('2026-03-29', 'Europe/Berlin'), 'Europe/Berlin')).toBe('2026-03-29');
});

test('presentation retains kopecks and omits only the server current year', () => {
  expect(ownerMoney(33199.15).replace(/\s/g, ' ')).toBe('33 199,15 ₽');
  expect(ownerMoney(100).replace(/\s/g, ' ')).toBe('100,00 ₽');
  expect(ownerRangeLabel('2026-10-01', '2026-10-29', '2026')).toBe('1–29 октября');
  expect(ownerRangeLabel('2025-10-01', '2025-10-29', '2026')).toContain('2025');
  expect(ownerRangeLabel('2026-10-01', '2026-10-29')).toContain('2026');
});

test('comparison bars encode only two positive aggregates, without a fabricated baseline or percentage', () => {
  expect(ownerComparisonBars(200, 100)).toEqual({ current: 1, previous: 0.5 });
  expect(ownerComparisonBars(100, 200)).toEqual({ current: 0.5, previous: 1 });
  for (const [current, previous] of [
    [100, 0],
    [100, -1],
    [-1, 100],
    [0, 100],
    [NaN, 100],
    [100, Infinity],
  ]) {
    expect(ownerComparisonBars(current, previous)).toBeNull();
  }
  expect(ownerPercentLabel({ amount: 300, percent: 99 }, -20)).toBeNull();
  expect(ownerPercentLabel({ amount: 300, percent: null }, 0)).toBeNull();
  expect(ownerPercentLabel({ amount: -300, percent: -15 }, 2000)).toBe('-15%');
});

test('comparison cannot invent percentages for missing or nonpositive baselines', () => {
  expect(ownerDeltaLabel({ amount: 300, percent: null }, 0)).toBe('+300 ₽');
  expect(ownerDeltaLabel({ amount: 300, percent: 99 }, -20)).toBe('+300 ₽');
  expect(ownerDeltaLabel({ amount: -300, percent: -15 }, 2000)).toContain('-15%');
  expect(ownerDeltaLabel({ amount: 0, percent: 0 }, 2000)).toBe('0 ₽ · 0%');
  expect(ownerDeltaLabel({ amount: 1, percent: Infinity }, 5)).not.toContain('%');
});

test('an expired data session cannot start a request', async () => {
  const load = jest.fn();
  await expect(loadOwnerHome({ key: ['A'], isCurrent: () => false }, load)).rejects.toThrow('Сессия изменилась');
  expect(load).not.toHaveBeenCalled();
});

test('a response arriving after a session change cannot become successful owner data', async () => {
  let current = true;
  const load = jest.fn(async () => {
    current = false;
    return { data: { netProfit: 12345 } };
  });
  await expect(loadOwnerHome({ key: ['A'], isCurrent: () => current }, load)).rejects.toThrow('Сессия изменилась');
  expect(load).toHaveBeenCalledTimes(1);
});
