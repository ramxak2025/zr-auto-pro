import { ownerPeriodNavigation } from '../ownerHomePeriodNavigation';

test.each([
  ['2026-01-01', '2025-12-31', '2026-01-02'],
  ['2024-03-01', '2024-02-29', '2024-03-02'],
  ['2026-03-29', '2026-03-28', '2026-03-30'],
  ['2026-10-25', '2026-10-24', '2026-10-26'],
])('day paging from %s uses civil dates through year, leap and DST boundaries', (selected, previous, next) => {
  const navigation = ownerPeriodNavigation('day', selected, '2026-12-31')!;
  expect(navigation.previousDate).toBe(previous);
  expect(navigation.nextDate).toBe(next);
});

test.each([
  ['2024-03-14', '2024-02-29', '2024-04-30'],
  ['2025-03-14', '2025-02-28', '2025-04-30'],
  ['2026-01-31', '2025-12-31', '2026-02-28'],
  ['2025-12-10', '2025-11-30', '2026-01-31'],
])('month paging from %s selects completed adjacent months', (selected, previous, next) => {
  const navigation = ownerPeriodNavigation('month', selected, '2026-12-31')!;
  expect(navigation.previousDate).toBe(previous);
  expect(navigation.nextDate).toBe(next);
});

test('week paging selects the adjacent Sunday across December and January', () => {
  const current = ownerPeriodNavigation('week', '2027-01-06', '2027-02-01')!;
  expect(current.previousDate).toBe('2027-01-03');
  expect(current.nextDate).toBe('2027-01-17');
  const previous = ownerPeriodNavigation('week', current.previousDate!, '2027-02-01')!;
  expect(previous.previousDate).toBe('2026-12-27');
  expect(previous.nextDate).toBe('2027-01-10');
  expect(previous.label).toContain('28 декабря 2026');
  expect(previous.label).toContain('3 января');
});

test('year paging selects December 31 of the adjacent calendar year', () => {
  const navigation = ownerPeriodNavigation('year', '2024-02-29', '2026-10-30')!;
  expect(navigation.previousDate).toBe('2023-12-31');
  expect(navigation.nextDate).toBe('2025-12-31');
  expect(navigation.label).toBe('2024 год');
});

test.each([
  ['day', '2026-10-28'],
  ['week', '2026-10-25'],
  ['month', '2026-09-30'],
  ['year', '2025-12-31'],
] as const)('%s paging into the current period caps at tenant today', (period, selected) => {
  const navigation = ownerPeriodNavigation(period, selected, '2026-10-29')!;
  expect(navigation.nextDate).toBe('2026-10-29');
  expect(navigation.canReturnToToday).toBe(true);
  expect(ownerPeriodNavigation(period, navigation.nextDate!, '2026-10-29')!.nextDate).toBeNull();
});

test.each([
  ['day', '2026-10-29'],
  ['week', '2026-10-26'],
  ['month', '2026-10-01'],
  ['year', '2026-01-01'],
] as const)('%s has no next period when the chosen date is in the current period', (period, selected) => {
  const navigation = ownerPeriodNavigation(period, selected, '2026-10-29')!;
  expect(navigation.nextDate).toBeNull();
  expect(navigation.canReturnToToday).toBe(selected !== '2026-10-29');
});

test('labels use the requested period and retain the exact cutoff for accessibility', () => {
  expect(ownerPeriodNavigation('day', '2026-10-29', '2026-10-29')!.label).toBe('Сегодня, 29 октября');
  expect(ownerPeriodNavigation('day', '2025-12-31', '2026-01-01')!.label).toContain('Вчера, 31 декабря 2025');
  const month = ownerPeriodNavigation('month', '2024-02-14', '2026-10-29')!;
  expect(month.label).toBe('Февраль 2024');
  expect(month.rangeLabel).toContain('1–14 февраля 2024');
  expect(ownerPeriodNavigation('week', '2026-10-29', '2026-10-29')!.label).toBe('26–29 октября');
});

test.each([undefined, '2026-02-30', '2026-13-01', '2026-10-30', '0099-12-31'])(
  'missing, invalid or future selection %s cannot create a navigation destination',
  (selected) => expect(ownerPeriodNavigation('day', selected, '2026-10-29')).toBeNull(),
);

test('navigation waits for server today rather than inferring the device date', () => {
  expect(ownerPeriodNavigation('month', '2026-10-29', undefined)).toBeNull();
  expect(ownerPeriodNavigation('day', '0100-01-01', '0100-01-01')!.previousDate).toBeNull();
});
