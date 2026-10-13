const test = require('node:test');
const assert = require('node:assert/strict');
const { validateJournalFilters } = require('../dist/checks/journal-filters');

test('journal filter API: inclusive amounts allow zero/cents, discount false means all', () => {
  assert.deepEqual(validateJournalFilters({ amountFrom: '0', amountTo: '12.50', hasDiscount: 'true' }), {
    amountFrom: 0,
    amountTo: 12.5,
    hasDiscount: true,
  });
  assert.equal(validateJournalFilters({ hasDiscount: false }).hasDiscount, false);
  assert.doesNotThrow(() =>
    validateJournalFilters({ dateFrom: '2024-02-29', dateTo: '2024-02-29', amountFrom: 0, amountTo: 0 }),
  );
});

test('journal filter API rejects malformed, nonfinite, negative/reversed amounts and dates with 400', () => {
  for (const value of ['', ' ', 'abc', '1,2', '-1', '-0.01', 'Infinity', NaN, Infinity, [], {}, true, ['1']]) {
    for (const key of ['amountFrom', 'amountTo'])
      assert.throws(
        () => validateJournalFilters({ [key]: value }),
        (error) => error.getStatus?.() === 400,
        `${key}: ${String(value)}`,
      );
  }
  for (const value of ['', '0000-01-01', '2025-02-29', '2026-04-31', '2026-1-01', '2026-01-01T00:00:00Z', [], null]) {
    assert.throws(
      () => validateJournalFilters({ dateFrom: value }),
      (error) => error.getStatus?.() === 400,
    );
  }
  for (const query of [
    { amountFrom: '2', amountTo: '1' },
    { dateFrom: '2026-01-02', dateTo: '2026-01-01' },
    { hasDiscount: 'yes' },
    { hasDiscount: [] },
  ]) {
    assert.throws(
      () => validateJournalFilters(query),
      (error) => error.getStatus?.() === 400,
    );
  }
});
