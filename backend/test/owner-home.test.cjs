const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');
const { Reflector } = require('@nestjs/core');
const { profitWindows, visitRange } = require('../dist/reports/owner-home/owner-home-dates');
const { OwnerHomeController } = require('../dist/reports/owner-home/owner-home.controller');
const { RolesGuard } = require('../dist/common/guards/roles.guard');
const { PermissionsGuard } = require('../dist/common/guards/permissions.guard');

test('owner-home calendar: selected historical day, leap clamp, local today and matching prior local clock', () => {
  const now = new Date('2026-10-29T09:15:12.345Z');
  const today = profitWindows(undefined, 'Asia/Vladivostok', now);
  assert.equal(today.canonicalDate, '2026-10-29');
  assert.equal(today.previous.untilExclusive, '2026-09-29T09:15:12.345Z');
  const old = profitWindows('2026-09-09', 'Asia/Vladivostok', now);
  assert.equal(old.previous.through, '2026-08-09');
  assert.equal(old.current.untilExclusive, '2026-09-09T14:00:00.000Z');
  assert.equal(old.current.partialDay, false);
  const leap = profitWindows('2028-03-31', 'Europe/Moscow', new Date('2028-04-01T09:00Z'));
  assert.equal(leap.previous.through, '2028-02-29');
  assert.equal(leap.clamped, true);
  const ordinary = profitWindows('2026-03-31', 'Europe/Moscow', now);
  assert.equal(ordinary.previous.through, '2026-02-28');
  const jan = profitWindows('2026-01-01', 'Europe/Moscow', now);
  assert.equal(jan.previous.through, '2025-12-01');
  const boundary = profitWindows(undefined, 'Asia/Vladivostok', new Date('2026-10-31T14:01Z'));
  assert.equal(boundary.canonicalDate, '2026-11-01');
  assert.equal(boundary.previous.untilExclusive, '2026-09-30T14:01:00.000Z');
});

test('owner-home rejects malformed, impossible, future dates and unbounded visits ranges', () => {
  const now = new Date('2026-10-29T09:00Z');
  for (const raw of ['2026-02-30', '2026-13-01', '', [], '2026-10-30', '2026-10-29T00:00Z'])
    assert.throws(
      () => profitWindows(raw, 'Europe/Moscow', now),
      (e) => e.getStatus() === 400,
    );
  for (const pair of [
    ['2026-10-30', '2026-10-30'],
    ['2026-10-10', '2026-10-09'],
    ['2025-09-30', '2026-10-01'],
  ])
    assert.throws(
      () => visitRange(...pair, 'Europe/Moscow', now),
      (e) => e.getStatus() === 400,
    );
  assert.equal(visitRange('2026-10-29', '2026-10-29', 'Europe/Moscow', now).until, now.toISOString());
});

test('new controller is owner-only even for financial-report capable staff; legacy permissions unchanged', () => {
  const reflector = new Reflector();
  const roles = new RolesGuard(reflector),
    permissions = new PermissionsGuard(reflector);
  for (const role of ['director', 'superadmin', 'admin', 'master']) {
    const context = {
      getHandler: () => OwnerHomeController.prototype.profit,
      getClass: () => OwnerHomeController,
      switchToHttp: () => ({ getRequest: () => ({ user: { role, permissions: { financial_reports: true } } }) }),
    };
    assert.equal(roles.canActivate(context), ['director', 'superadmin'].includes(role));
    if (role === 'director' || role === 'superadmin') assert.equal(permissions.canActivate(context), true);
  }
});

test('backend mirror matches frozen shared DTO AST', () => {
  const print = (path) =>
    ts
      .createPrinter({ removeComments: true })
      .printFile(ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true));
  assert.equal(
    print(join(__dirname, '../../shared/types/ownerHome.ts')),
    print(join(__dirname, '../src/reports/owner-home/owner-home.types.ts')),
  );
});
