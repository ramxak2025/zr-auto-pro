const { test } = require('node:test');
const assert = require('node:assert/strict');
const { markCallFollowUps } = require('../dist/calls/call-follow-ups');
const phone = '+7 (988) 444-44-36';
const call = (hour, overrides = {}) => ({
  date: `2026-10-30T${String(hour).padStart(2, '0')}:00:00Z`,
  direction: 'incoming',
  status: 'missed',
  duration: 0,
  from: phone,
  to: '100',
  calledBack: false,
  ...overrides,
});

test('a morning successful call must not clear a later missed call', () => {
  for (const contact of [
    call(9, { status: 'answered', duration: 20 }),
    call(9, { direction: 'outgoing', to: phone, duration: 20 }),
  ]) {
    const missed = call(12);
    assert.deepEqual(markCallFollowUps([missed, contact]), [missed]);
    assert.equal(missed.calledBack, false);
  }
});

test('only missed calls before the successful contact are resolved, regardless of input order', () => {
  for (const reverse of [false, true]) {
    const earlier = call(9),
      later = call(12),
      contact = call(10, { direction: 'outgoing', to: '89884444436', duration: 31 });
    const rows = [earlier, later, contact];
    assert.deepEqual(markCallFollowUps(reverse ? rows.reverse() : rows), [later]);
    assert.equal(earlier.calledBack, true);
    assert.equal(later.calledBack, false);
  }
});

test('a later answered incoming call resolves the missed call even without a recording duration', () => {
  const missed = call(10);
  assert.deepEqual(markCallFollowUps([missed, call(11, { status: 'answered' })]), []);
  assert.equal(missed.calledBack, true);
});

test('an unanswered outgoing attempt, equal timestamp, or different phone does not resolve a missed call', () => {
  for (const contact of [
    call(11, { direction: 'outgoing', to: phone, duration: 0 }),
    call(10, { status: 'answered', duration: 30 }),
    call(11, { status: 'answered', from: '+79990000000' }),
  ]) {
    const missed = call(10);
    assert.equal(markCallFollowUps([missed, contact]).length, 1);
  }
});

test('unknown phones and invalid timestamps remain unresolved instead of clearing each other', () => {
  for (const overrides of [{ from: '' }, { from: 'anonymous' }, { date: 'invalid' }]) {
    const missed = call(9, overrides);
    const contact = call(10, { ...overrides, status: 'answered', duration: 60 });
    assert.equal(markCallFollowUps([missed, contact]).length, 1);
  }
});

test('the latest of several contacts is used and stale callback flags are reset', () => {
  const missed = call(10, { calledBack: true });
  assert.equal(markCallFollowUps([call(9, { status: 'answered' }), missed]).length, 1);
  assert.equal(missed.calledBack, false);
  assert.equal(
    markCallFollowUps([call(11, { status: 'answered' }), missed, call(9, { status: 'answered' })]).length,
    0,
  );
  assert.equal(missed.calledBack, true);
});
