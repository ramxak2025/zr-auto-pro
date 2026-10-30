const test = require('node:test');
const assert = require('node:assert/strict');
const { Reflector } = require('@nestjs/core');
const { profitWindows, visitRange } = require('../dist/reports/owner-home/owner-home-dates');
const { timelineRange, timelineCutoffs } = require('../dist/reports/owner-home/owner-home-timeline-dates');
const { OwnerHomeController } = require('../dist/reports/owner-home/owner-home.controller');
const { RolesGuard } = require('../dist/common/guards/roles.guard');
const bad = (e) => e.getStatus?.() === 400;
const cutoffs = (period, day, tz = 'Europe/Moscow', now = new Date('2029-01-01T12:00Z')) => {
  const w = profitWindows(day, tz, now);
  const range = timelineRange(period, w.current, tz);
  return { range, points: timelineCutoffs(range, tz) };
};

test('timeline strict periods, civil Monday/month/year start and cross-year weeks', () => {
  for (const raw of ['', null, [], {}, 'days', 'DAY']) assert.throws(() => cutoffs(raw, '2026-10-29'), bad);
  assert.equal(cutoffs(undefined, '2026-10-29').range.period, 'day');
  assert.equal(cutoffs('week', '2026-11-01').range.from, '2026-10-26');
  assert.equal(cutoffs('week', '2027-01-01').range.from, '2026-12-28');
  assert.equal(cutoffs('month', '2028-02-29').points.length, 29);
  assert.equal(cutoffs('year', '2028-12-31').points.length, 12);
  const year = cutoffs('year', '2028-03-01');
  assert.equal(year.range.from, '2028-01-01');
  assert.deepEqual(
    year.points.map((p) => p.localDate),
    ['2028-01-31', '2028-02-29', '2028-03-01'],
  );
});

test('day emits real DST 23/25 hour boundaries and exact partial cutoff without a future hour', () => {
  for (const [day, length] of [
    ['2026-03-08', 23],
    ['2026-11-01', 25],
  ]) {
    const { range, points } = cutoffs('day', day, 'America/New_York');
    assert.equal(points.length, length);
    assert.equal(Date.parse(range.untilExclusive) - Date.parse(range.start), length * 3600000);
    assert.equal(new Set(points.map((p) => p.untilExclusive)).size, length);
    for (const point of points) assert.equal(Date.parse(point.untilExclusive) - Date.parse(point.from), 3600000);
  }
  const now = new Date('2026-03-08T07:12:34.567Z');
  const { points } = cutoffs('day', undefined, 'America/New_York', now);
  assert.equal(points.length, 3);
  assert.equal(points.at(-1).untilExclusive, now.toISOString());
  assert.ok(points.every((p) => p.untilExclusive <= now.toISOString()));
});

test('exact midnight preserves one coincident allocation endpoint and no invented interval', () => {
  const now = new Date('2026-10-28T21:00:00.000Z');
  for (const period of ['day', 'week', 'month', 'year']) {
    const { points } = cutoffs(period, undefined, 'Europe/Moscow', now);
    assert.equal(points.at(-1).untilExclusive, now.toISOString());
    if (period !== 'year') assert.equal(points.at(-1).from, now.toISOString());
  }
});

test('visits accepts at most 366 inclusive civil dates through DST, leap years and month boundaries', () => {
  const now = new Date('2029-01-01T00:00Z');
  assert.equal(visitRange('2028-01-01', '2028-12-31', 'Europe/Moscow', now).to, '2028-12-31');
  assert.equal(visitRange('2026-01-01', '2027-01-01', 'America/New_York', now).from, '2026-01-01');
  assert.throws(() => visitRange('2028-01-01', '2029-01-01', 'Europe/Moscow', now), bad);
  assert.throws(() => visitRange('2026-02-30', '2026-12-31', 'Europe/Moscow', now), bad);
});

test('timeline inherits owner roles and controller forwards only authenticated tenant/point scope', () => {
  const roles = new RolesGuard(new Reflector());
  for (const role of ['director', 'superadmin', 'admin', 'master']) {
    const context = {
      getClass: () => OwnerHomeController,
      getHandler: () => OwnerHomeController.prototype.timeline,
      switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
    };
    assert.equal(roles.canActivate(context), ['director', 'superadmin'].includes(role));
  }
  const calls = [];
  const controller = new OwnerHomeController({ timeline: (...args) => calls.push(args) });
  const query = { period: 'year', asOf: '2026-10-29', pointId: 'attacker-point', tenantID: 'attacker-tenant' };
  controller.timeline(
    { tenantID: 'trusted', role: 'director', currentPointId: '11111111-1111-4111-8111-111111111111' },
    query,
  );
  assert.equal(calls[0][0], 'trusted');
  assert.equal(calls[0][1], '11111111-1111-4111-8111-111111111111');
});
