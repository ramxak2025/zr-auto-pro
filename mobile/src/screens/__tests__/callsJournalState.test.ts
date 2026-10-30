import {
  CALLS_TABS,
  callsEntry,
  callsFilterCount,
  callsJournalSnapshot,
  callsSummary,
  filterCalls,
  isMissedCall,
  newCallsEntry,
} from '../callsJournalState';

const call = (id: string, overrides = {}) => ({
  id,
  date: '2026-10-30T08:00:00Z',
  direction: 'incoming',
  status: 'answered',
  duration: 0,
  from: '+79990000001',
  to: '+79990000000',
  calledBack: false,
  ...overrides,
});
const rows = [
  call('answered-zero'),
  call('missed-pending', { status: 'missed' }),
  call('missed-returned', { status: 'missed', calledBack: true }),
  call('outgoing', { direction: 'outgoing', duration: 15 }),
];
const summary = { total: 4, incoming: 3, outgoing: 1, missed: 2, notCalledBack: 1 };

test('all journal filters match their summary counts, including accepted zero-second calls', () => {
  for (const tab of CALLS_TABS) expect(filterCalls(rows, tab.key)).toHaveLength(callsFilterCount(summary, tab.key));
  expect(filterCalls(rows, 'incoming').map((row) => row.id)).toEqual(['answered-zero']);
  expect(filterCalls(rows, 'pending').map((row) => row.id)).toEqual(['missed-pending']);
  expect(isMissedCall(rows[0])).toBe(false);
  expect(isMissedCall({ direction: 'outgoing', status: 'missed', duration: 0 })).toBe(false);
  expect(isMissedCall({ direction: 'incoming', status: 'unknown', duration: 0 })).toBe(false);
});

test('pending excludes only confirmed callbacks while explicit previews use stricter metadata', () => {
  expect(filterCalls([call('legacy', { status: 'missed', calledBack: undefined })], 'pending')).toHaveLength(1);
  expect(filterCalls([call('returned', { status: 'missed', calledBack: true })], 'pending')).toHaveLength(0);
});

test('journal rejects absent or inconsistent data rather than displaying a zero day', () => {
  expect(callsJournalSnapshot({ calls: rows, summary })).toEqual({ kind: 'connected', calls: rows, summary });
  for (const invalid of [
    undefined,
    {},
    { summary },
    { calls: [], summary },
    { calls: [null], summary },
    { calls: rows, summary: { ...summary, missed: 1 } },
  ]) {
    expect(() => callsJournalSnapshot(invalid)).toThrow('Не удалось прочитать журнал звонков');
  }
  const zero = { total: 0, incoming: 0, outgoing: 0, missed: 0, notCalledBack: 0 };
  expect(callsJournalSnapshot({ calls: [], summary: zero })).toEqual({ kind: 'connected', calls: [], summary: zero });
  expect(callsSummary({ ...zero, total: '0' })).toBeNull();
});

test('Home entries are typed, validated and unique even during the same clock tick', () => {
  const now = jest.spyOn(Date, 'now').mockReturnValue(1);
  const first = newCallsEntry('pending');
  const next = newCallsEntry('pending');
  expect(next.entryRequestId).not.toBe(first.entryRequestId);
  expect(callsEntry(first)).toEqual(first);
  for (const invalid of [
    undefined,
    {},
    { ...first, filter: 'other' },
    { ...first, focusToday: false },
    { ...first, entryRequestId: '' },
  ]) {
    expect(callsEntry(invalid)).toBeNull();
  }
  now.mockRestore();
});
