import { ownerCallPhone, ownerCallPhoneLabel, ownerCallsSnapshot, ownerPendingCalls } from '../ownerHomeCalls';

const call = (id: string, overrides = {}) => ({
  id,
  from: '+7 (999) 000-00-01',
  date: '2026-10-30T08:00:00Z',
  direction: 'incoming',
  status: 'missed',
  duration: 0,
  calledBack: false,
  client: { fullName: 'Клиент', private: 'discard' },
  recordingUrl: 'secret-recording-url',
  private: 'discard',
  ...overrides,
});

test('previews group equivalent phone formats, deduplicate events, sort latest first and retain three callers', () => {
  const result = ownerPendingCalls([
    call('first'),
    call('first', { from: '8 999 000 00 01' }),
    call('later', { from: '9990000001', date: '2026-10-30T09:00:00Z' }),
    call('second', { from: '+79990000002', date: '2026-10-30T10:00:00Z', client: null }),
    call('third', { from: '+79990000003', date: '2026-10-30T07:00:00Z' }),
    call('fourth', { from: '+79990000004', date: '2026-10-30T06:00:00Z' }),
  ]);
  expect(result).toHaveLength(3);
  expect(result.map((row) => row.id)).toEqual(['second', 'later', 'third']);
  expect(result[1]).toEqual({
    id: 'later',
    phone: '+79990000001',
    name: 'Клиент',
    date: '2026-10-30T09:00:00.000Z',
    attempts: 2,
  });
  expect(Object.keys(result[0]).sort()).toEqual(['attempts', 'date', 'id', 'name', 'phone']);
  expect(JSON.stringify(result)).not.toMatch(/secret|recording|discard|client/);
});

test('only canonical incoming missed calls with explicitly false callback state enter previews', () => {
  for (const change of [
    { status: 'answered' },
    { status: 'unknown' },
    { direction: 'outgoing' },
    { calledBack: true },
    { calledBack: undefined },
    { calledBack: 'false' },
    { from: 'tel:+79990000001' },
    { from: 'hidden' },
    { from: '+79990000001;123' },
    { date: 'invalid' },
    { id: '' },
  ])
    expect(ownerPendingCalls([call('id', change)])).toEqual([]);
  expect(ownerPendingCalls(undefined)).toEqual([]);
});

test('phone labels are normalized safely without constructing a dial action', () => {
  expect(ownerCallPhone('8 (999) 000-00-01')).toBe('+79990000001');
  expect(ownerCallPhone('9990000001')).toBe('+79990000001');
  expect(ownerCallPhone('+4412345678')).toBe('+4412345678');
  expect(ownerCallPhoneLabel('+79990000001')).toBe('+7 (999) 000-00-01');
  for (const phone of ['+7 999 abc', '123', '+01234567', 'https://private', '*123#', '+79990000001,5'])
    expect(ownerCallPhone(phone)).toBeNull();
});

test('widget cache contains a copied summary plus only bounded unresolved preview fields', () => {
  const summary = { total: 1, incoming: 1, outgoing: 0, missed: 1, notCalledBack: 1, private: 'secret' };
  const snapshot = ownerCallsSnapshot({ summary, calls: [call('one')] });
  expect(snapshot.kind).toBe('connected');
  expect(JSON.stringify(snapshot)).not.toMatch(/secret|recording|private|discard/);
  expect(
    ownerCallsSnapshot({
      summary: { total: 0, incoming: 0, outgoing: 0, missed: 0, notCalledBack: 0 },
      calls: [call('one')],
    }),
  ).toEqual({
    kind: 'connected',
    summary: { total: 0, incoming: 0, outgoing: 0, missed: 0, notCalledBack: 0 },
    pending: [],
  });
});
