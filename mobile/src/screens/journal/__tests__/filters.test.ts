import {
  emptyJournalFilters,
  journalAmount,
  journalDay,
  journalFilterCount,
  journalFilterError,
  journalPeriod,
  journalPickerDate,
  journalQueryKey,
  journalQueryParams,
} from '../filters';

it('accepts zero, cents and comma, and keeps off flags absent from API', () => {
  expect(journalAmount('0')).toBe(0);
  expect(journalAmount('12,50')).toBe(12.5);
  expect(journalQueryParams(emptyJournalFilters())).toEqual({});
  const filters = { ...emptyJournalFilters(), amountFrom: '0', amountTo: '12,50', hasDiscount: true };
  expect(journalQueryParams(filters)).toEqual({ amountFrom: 0, amountTo: 12.5, hasDiscount: true });
  expect(journalFilterCount(filters)).toBe(3);
});

it('rejects invalid and reversed ranges while allowing one independent bound', () => {
  for (const value of ['-1', '12,', '1.234', 'abc', 'Infinity'])
    expect(journalFilterError({ ...emptyJournalFilters(), amountFrom: value })).not.toBeNull();
  expect(journalFilterError({ ...emptyJournalFilters(), amountTo: '0' })).toBeNull();
  expect(journalFilterError({ ...emptyJournalFilters(), amountFrom: '10', amountTo: '9,99' })).not.toBeNull();
  expect(journalFilterError({ ...emptyJournalFilters(), dateFrom: '2026-10-14', dateTo: '2026-10-13' })).not.toBeNull();
});

it('uses service calendar for presets and date picker even across device day/month and DST', () => {
  const now = new Date('2026-09-30T21:30:00Z');
  expect(journalPeriod('today', 'Europe/Moscow', now)).toEqual({ dateFrom: '2026-10-01', dateTo: '2026-10-01' });
  expect(journalPeriod('week', 'Europe/Moscow', now)).toEqual({ dateFrom: '2026-09-25', dateTo: '2026-10-01' });
  expect(journalPeriod('month', 'Europe/Moscow', now)).toEqual({ dateFrom: '2026-10-01', dateTo: '2026-10-01' });
  expect(journalPeriod('today', 'America/Los_Angeles', now).dateTo).toBe('2026-09-30');
  expect(journalDay(journalPickerDate('2026-03-08', 'America/New_York'), 'America/New_York')).toBe('2026-03-08');
});

it('preserves persistent search and existing positional fields, appending amount/discount', () => {
  const filters = {
    ...emptyJournalFilters(),
    masterId: 'master',
    isDeferred: true,
    isReturned: true,
    amountFrom: '0',
    amountTo: '20,50',
    hasDiscount: true,
  };
  expect(journalQueryKey('client', filters)).toEqual([
    'checks-infinite',
    'client',
    '',
    '',
    'master',
    'deferred',
    'returns',
    0,
    20.5,
    'discount',
  ]);
  expect(journalQueryParams(filters)).toEqual({
    masterId: 'master',
    isDeferred: true,
    isReturned: true,
    amountFrom: 0,
    amountTo: 20.5,
    hasDiscount: true,
  });
});
