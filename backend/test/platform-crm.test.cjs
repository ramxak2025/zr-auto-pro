const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { ValidationPipe } = require('@nestjs/common');
const {
  buildPlatformReminders,
  DEFAULT_PLATFORM_REMINDERS,
  PlatformCrmService,
} = require('../dist/platform-managers/platform-crm.service');
const {
  CreatePlatformTenantNoteDto,
  SetPlatformTenantFollowUpDto,
  PlatformReminderSettingsDto,
} = require('../dist/platform-managers/dto/platform-crm.dto');
const { ManagerCabinetController } = require('../dist/platform-managers/manager-cabinet.controller');
const pipe = new ValidationPipe({ transform: true, whitelist: true });
const validate = (dto, body) => pipe.transform(body, { type: 'body', metatype: dto });
const bad = (error) => error.getStatus?.() === 400;
const row = (changes = {}) => ({
  id: randomUUID(),
  name: 'Workshop',
  timezone: 'Europe/Moscow',
  subscription_end: '2026-10-24T09:00:00Z',
  suspended_at: null,
  is_active: true,
  next_contact_at: null,
  ...changes,
});
const at = new Date('2026-10-18T09:00:00Z');

test('note/follow-up DTOs reject malformed data and preserve explicit null', async () => {
  assert.equal(
    (await validate(CreatePlatformTenantNoteDto, { text: '  internal  ', requestId: randomUUID() })).text,
    'internal',
  );
  for (const text of ['', '  ', '\0private', 'x'.repeat(4001), 8]) {
    await assert.rejects(validate(CreatePlatformTenantNoteDto, { text, requestId: randomUUID() }), bad);
  }
  await assert.rejects(validate(CreatePlatformTenantNoteDto, { text: 'valid', requestId: 'not uuid' }), bad);
  for (const nextContactAt of [undefined, '', '2026-10-18', '2026-10-18T12:00:00', '2026-02-30T12:00:00Z']) {
    await assert.rejects(validate(SetPlatformTenantFollowUpDto, { nextContactAt }), bad);
  }
  assert.deepEqual(
    await validate(SetPlatformTenantFollowUpDto, { nextContactAt: null }),
    Object.assign(new SetPlatformTenantFollowUpDto(), { nextContactAt: null }),
  );
  assert.equal(
    (await validate(SetPlatformTenantFollowUpDto, { nextContactAt: '2026-10-18T12:00:00+03:00' })).nextContactAt,
    '2026-10-18T12:00:00+03:00',
  );
});

test('personal settings reject duplicates, fractions, out-of-range days and enabled empty set', async () => {
  const service = new PlatformCrmService({ query: () => assert.fail('invalid settings must not touch DB') });
  for (const daysBefore of [[1, 1], [0.5], [-1], [31], Array.from({ length: 9 }, (_, i) => i)]) {
    await assert.rejects(
      validate(PlatformReminderSettingsDto, { expiryEnabled: true, daysBefore, pushEnabled: false }),
      bad,
    );
  }
  await assert.rejects(
    service.updateReminderSettings(
      { userId: randomUUID() },
      { expiryEnabled: true, daysBefore: [], pushEnabled: false },
    ),
    bad,
  );
});

test('calendar thresholds select 7 at day 6, 3 at day 2 and expire only with explicit zero', () => {
  assert.match(buildPlatformReminders([row()], DEFAULT_PLATFORM_REMINDERS, at)[0].id, /:7$/);
  assert.match(
    buildPlatformReminders([row({ subscription_end: '2026-10-20T09:00:00Z' })], DEFAULT_PLATFORM_REMINDERS, at)[0].id,
    /:3$/,
  );
  const expired = row({ subscription_end: '2026-10-17T23:00:00Z' });
  const item = buildPlatformReminders([expired], DEFAULT_PLATFORM_REMINDERS, at)[0];
  assert.equal(item.subscriptionStatus, 'expired');
  assert.equal(item.daysRemaining, 0, 'same Moscow calendar day, although timestamp is already expired');
  assert.match(item.id, /:0$/);
  assert.deepEqual(buildPlatformReminders([expired], { ...DEFAULT_PLATFORM_REMINDERS, daysBefore: [7, 3, 1] }, at), []);
});

test('local date boundary is used instead of elapsed 24-hour rounding', () => {
  const now = new Date('2026-10-18T20:30:00Z');
  const end = '2026-10-18T21:30:00Z';
  const moscow = buildPlatformReminders(
    [row({ timezone: 'Europe/Moscow', subscription_end: end })],
    DEFAULT_PLATFORM_REMINDERS,
    now,
  )[0];
  const kamchatka = buildPlatformReminders(
    [row({ timezone: 'Asia/Kamchatka', subscription_end: end })],
    DEFAULT_PLATFORM_REMINDERS,
    now,
  )[0];
  assert.equal(moscow.daysRemaining, 1);
  assert.equal(kamchatka.daysRemaining, 0);
});

test('suspended and perpetual subscriptions excluded; contact reminders survive expiry toggle', () => {
  const contact = '2026-10-18T08:00:00Z';
  assert.deepEqual(
    buildPlatformReminders(
      [row({ suspended_at: new Date() }), row({ is_active: false }), row({ subscription_end: null })],
      DEFAULT_PLATFORM_REMINDERS,
      at,
    ),
    [],
  );
  const items = buildPlatformReminders(
    [row({ suspended_at: new Date(), next_contact_at: contact })],
    { ...DEFAULT_PLATFORM_REMINDERS, expiryEnabled: false },
    at,
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'follow_up');
  assert.deepEqual(
    buildPlatformReminders(
      [row({ next_contact_at: '2026-10-18T10:00:00Z' })],
      { ...DEFAULT_PLATFORM_REMINDERS, expiryEnabled: false },
      at,
    ),
    [],
  );
});

test('every added cabinet route rejects non-platform roles before service execution', () => {
  const stub = new Proxy({}, { get: () => () => assert.fail('service called for forbidden role') });
  const controller = new ManagerCabinetController(stub, stub);
  for (const method of [
    'analytics',
    'notes',
    'addNote',
    'setFollowUp',
    'reminderSettings',
    'updateReminderSettings',
    'reminders',
  ]) {
    for (const role of ['director', 'master', undefined]) {
      assert.throws(
        () => controller[method]({ userID: randomUUID(), role }, randomUUID(), {}),
        (error) => error.getStatus?.() === 403,
      );
    }
  }
});

test('background worker does zero work on HTTP-only replica', () => {
  const script = `const {PlatformReminderService}=require('./backend/dist/platform-managers/platform-reminder.service');
    new PlatformReminderService({query(){throw Error('must not query')}}, {}, {}).tick().then(()=>process.stdout.write('off'));`;
  const output = execFileSync(process.execPath, ['-e', script], {
    cwd: require('node:path').resolve(__dirname, '../..'),
    env: { ...process.env, RUN_BACKGROUND_JOBS: 'false' },
  });
  assert.equal(output.toString(), 'off');
});
