const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { resolveAttendanceModePatch } = require('../dist/tenants/attendance-mode');
const { ShiftsService } = require('../dist/shifts/shifts.service');
const { ShiftsNfcService } = require('../dist/shifts/shifts-nfc.service');

test('legacy shiftsEnabled patch maps to admin/manual and explicit mode must agree', () => {
  assert.deepEqual(resolveAttendanceModePatch({ shiftsEnabled: false }), { attendanceMode: 'admin', shiftsEnabled: false });
  assert.deepEqual(resolveAttendanceModePatch({ shiftsEnabled: true }), { attendanceMode: 'manual', shiftsEnabled: true });
  assert.deepEqual(resolveAttendanceModePatch({ attendanceMode: 'nfc' }), { attendanceMode: 'nfc', shiftsEnabled: true });
  assert.deepEqual(resolveAttendanceModePatch({ shiftsEnabled: true, attendanceMode: 'nfc' }), {
    attendanceMode: 'nfc',
    shiftsEnabled: true,
  });
  assert.throws(() => resolveAttendanceModePatch({ shiftsEnabled: false, attendanceMode: 'manual' }), (error) =>
    error.getStatus?.() === 400,
  );
  assert.equal(resolveAttendanceModePatch({}), undefined);
});

test('only manual mode allows employees to open or close their own shifts', async () => {
  for (const attendanceMode of ['admin', 'nfc']) {
    const pool = {
      query: async (sql) => ({
        rows: sql.includes('SELECT user_id') ? [{ user_id: 'employee' }] : [{ attendance_mode: attendanceMode }],
      }),
    };
    const service = new ShiftsService(pool, {});
    const actor = { userID: 'employee', tenantID: 'tenant', role: 'master', permissions: {} };
    await assert.rejects(service.open(actor.userID, actor.tenantID, actor), (error) => error.getStatus?.() === 403);
    await assert.rejects(service.close('shift', actor.tenantID, actor), (error) => error.getStatus?.() === 403);
  }
});

test('revoked NFC tag archive is a soft archive and the list excludes archived rows', async () => {
  const statements = [];
  const tagRow = {
    id: 'tag', tenant_id: 'tenant', point_id: null, name: 'Door', token_hash: '0'.repeat(64),
    status: 'revoked', created_at: new Date('2026-10-01T00:00:00Z'), activated_at: null,
    revoked_at: new Date('2026-10-02T00:00:00Z'), archived_at: null,
  };
  const client = {
    query: async (sql) => {
      statements.push(sql);
      if (sql === 'SELECT clock_timestamp() AS instant') return { rows: [{ instant: new Date() }] };
      if (sql.includes('FROM users u JOIN tenants')) return { rows: [{
        role: 'director', full_name: 'Owner', is_active: true, dismissed_at: null, purged_at: null,
        matrix: null, timezone: 'Europe/Moscow', shifts_enabled: true, attendance_mode: 'nfc',
        tenant_active: true, point_allowed: true,
      }] };
      if (sql.includes('SELECT * FROM attendance_nfc_tags')) return { rows: [tagRow] };
      if (sql.includes('UPDATE attendance_nfc_tags SET archived_at')) return { rows: [{ ...tagRow, archived_at: new Date() }] };
      if (sql.includes('SELECT id FROM users')) return { rows: [{ id: 'owner' }] };
      return { rows: [] };
    },
    release: () => undefined,
  };
  const service = new ShiftsNfcService({ connect: async () => client }, {});
  const result = await service.archiveTag(
    { userID: 'owner', tenantID: 'tenant', role: 'director', permissions: {} },
    'tag',
  );
  assert.equal(result.status, 'revoked');
  assert.match(statements.find((sql) => sql.includes('UPDATE attendance_nfc_tags SET archived_at')), /status='revoked' AND archived_at IS NULL/);

  const source = fs.readFileSync(path.join(__dirname, '../dist/shifts/shifts-nfc.service.js'), 'utf8');
  assert.match(source, /archived_at IS NULL ORDER BY created_at DESC,id/);
});

test('migration backfills legacy tenants without touching POS mode and keeps NFC ledger rows', () => {
  const migration = fs.readFileSync(path.join(__dirname, '../migrations/183_attendance_modes_tag_archive.sql'), 'utf8');
  assert.match(migration, /CASE WHEN shifts_enabled THEN 'manual' ELSE 'admin' END/);
  assert.match(migration, /ALTER TABLE attendance_nfc_tags\s+ADD COLUMN archived_at timestamptz/);
  assert.doesNotMatch(migration, /shift_mode_enabled/);
  assert.doesNotMatch(migration, /DELETE FROM attendance_nfc_/);
});
