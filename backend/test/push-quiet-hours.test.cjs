const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const { PushService } = require('../dist/push/push.service.js');

const backendRoot = join(__dirname, '..');
const readSource = (relativePath) => readFileSync(join(backendRoot, relativePath), 'utf8');

// A UTC instant we can reason about: 2026-01-15T20:30:00Z.
// In Moscow (+180) that is 23:30 local; in UTC (0) it is 20:30.
const AT_2030_UTC = new Date('2026-01-15T20:30:00.000Z');

test('quiet hours are OFF unless both ends are set', () => {
  assert.equal(PushService.isWithinQuietHours(AT_2030_UTC, null, null, 180), false);
  assert.equal(PushService.isWithinQuietHours(AT_2030_UTC, '22:00', null, 180), false);
  assert.equal(PushService.isWithinQuietHours(AT_2030_UTC, null, '07:00', 180), false);
});

test('a window that crosses midnight covers the late evening and the early morning', () => {
  // 23:30 Moscow is inside 22:00 → 07:00.
  assert.equal(PushService.isWithinQuietHours(AT_2030_UTC, '22:00', '07:00', 180), true);
  // 03:00 UTC == 06:00 Moscow — still inside the same window.
  const at0300Utc = new Date('2026-01-15T03:00:00.000Z');
  assert.equal(PushService.isWithinQuietHours(at0300Utc, '22:00', '07:00', 180), true);
  // 10:00 UTC == 13:00 Moscow — outside.
  const at1000Utc = new Date('2026-01-15T10:00:00.000Z');
  assert.equal(PushService.isWithinQuietHours(at1000Utc, '22:00', '07:00', 180), false);
});

test('a same-day window is inclusive of the start and exclusive of the end', () => {
  const at1200Msk = new Date('2026-01-15T09:00:00.000Z'); // 12:00 Moscow
  assert.equal(PushService.isWithinQuietHours(at1200Msk, '12:00', '14:00', 180), true);
  assert.equal(PushService.isWithinQuietHours(at1200Msk, '10:00', '12:00', 180), false);
});

test('the timezone offset is applied in the right DIRECTION', () => {
  // Same instant, two users. 20:30 UTC == 23:30 Moscow.
  // A window of 23:00→23:59 must catch the Moscow user and MISS the UTC user.
  assert.equal(PushService.isWithinQuietHours(AT_2030_UTC, '23:00', '23:59', 180), true);
  assert.equal(PushService.isWithinQuietHours(AT_2030_UTC, '23:00', '23:59', 0), false);
  // And a 20:00→21:00 window does the opposite.
  assert.equal(PushService.isWithinQuietHours(AT_2030_UTC, '20:00', '21:00', 0), true);
  assert.equal(PushService.isWithinQuietHours(AT_2030_UTC, '20:00', '21:00', 180), false);
});

test('a missing offset falls back to Moscow (+180), not to server time', () => {
  assert.equal(PushService.isWithinQuietHours(AT_2030_UTC, '23:00', '23:59', null), true);
  assert.equal(PushService.isWithinQuietHours(AT_2030_UTC, '23:00', '23:59', undefined), true);
});

test('from == to is treated as DISABLED, never as "silent for 24h"', () => {
  assert.equal(PushService.isWithinQuietHours(AT_2030_UTC, '09:00', '09:00', 180), false);
});

test('unparseable times disable the window instead of muting the user', () => {
  assert.equal(PushService.isWithinQuietHours(AT_2030_UTC, 'garbage', '07:00', 180), false);
  assert.equal(PushService.isWithinQuietHours(AT_2030_UTC, '25:00', '07:00', 180), false);
});

// ── Regression guard: the six pushes that used to ship UNGATED ──────────────
// They had no toggle anywhere, so a user could not turn them off. If someone
// reverts one to sendToUser it silently becomes unmutable again — catch it here.

test('user-facing pushes are category-gated, not raw sendToUser', () => {
  const cases = [
    ['src/checks/checks.service.ts', 'order_ready'],
    ['src/checks/checks.service.ts', 'order_paid'],
    ['src/bookings/booking-reminder.service.ts', 'booking_reminder'],
    ['src/telephony/telephony.service.ts', 'call_incoming'],
    ['src/profile/profile.service.ts', 'profile_request'],
    ['src/account/account.service.ts', 'account'],
  ];
  for (const [file, category] of cases) {
    const source = readSource(file);
    assert.match(
      source,
      new RegExp(`sendToUserCategory\\([\\s\\S]{0,80}'${category}'`),
      `${file} must gate its push on '${category}'`,
    );
  }
});

// ── The diagnostic must never claim success without positive evidence ───────
// `[].every(ok)` is TRUE, so the naive form reported "Доставлено" on the COMMON
// path where Expo has not produced a receipt yet — i.e. the diagnostic told the
// exact lie it was built to detect. Lock the shape of the check.

test('delivered requires BOTH a ticket and a receipt, never an empty list', () => {
  const source = readSource('src/push/push.service.ts');
  const block = source.slice(source.indexOf('const delivered ='), source.indexOf('const pending ='));
  assert.match(block, /outcome\.tickets\.length > 0/, 'delivered must require at least one ticket');
  assert.match(block, /receipts\.length > 0/, 'delivered must require at least one receipt');
});

test('a third "pending" state exists so an outstanding verdict is not painted as failure', () => {
  const source = readSource('src/push/push.service.ts');
  assert.match(source, /const pending =/);
  assert.match(source, /pending: boolean;/);
});

// ── Push tokens must not leak through Expo's error text ────────────────────

test('redactTokens strips the token Expo quotes back in its error payloads', () => {
  const raw =
    '{"errors":[{"message":"\\"ExponentPushToken[abcdefGHIJK1234567890]\\" is not a registered push notification recipient"}]}';
  const redacted = PushService.redactTokens(raw);
  assert.doesNotMatch(redacted, /abcdefGHIJK1234567890/, 'the token body must not survive redaction');
  assert.match(redacted, /ExponentPushToken\[…\]/, 'the shape stays readable for triage');
});

test('redactTokens handles the ExpoPushToken spelling and multiple tokens', () => {
  const raw = 'ExpoPushToken[aaa] and ExponentPushToken[bbb]';
  const redacted = PushService.redactTokens(raw);
  assert.doesNotMatch(redacted, /aaa|bbb/);
});

test('every gated category is accepted by the preferences DTO', () => {
  const dto = readSource('src/notifications/dto/notifications.dto.ts');
  for (const category of [
    'salary',
    'penalty',
    'check_assigned',
    'check_closed',
    'knowledge',
    'order_ready',
    'order_paid',
    'booking_reminder',
    'call_incoming',
    'profile_request',
    'account',
  ]) {
    assert.match(dto, new RegExp(`'${category}'`), `NOTIFICATION_CATEGORIES must contain '${category}'`);
  }
});
