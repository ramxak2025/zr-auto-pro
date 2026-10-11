import test from 'node:test';
import assert from 'node:assert/strict';
import { isPublicSessionLandingPath } from '../publicAuthPath.js';

test('only the exact public booking and attendance routes stay open on staff-session expiry', () => {
  for (const path of [
    '/book/oil-service',
    '/BOOK/Oil-Service',
    '/nfc/attendance',
    '/NFC/Attendance',
    '/A1b2C3d4E5f6G7h8',
    '/' + 'a'.repeat(32),
  ]) {
    assert.equal(isPublicSessionLandingPath(path), true, path);
  }
  for (const path of [
    '/bookings',
    '/book',
    '/book/a/extra',
    '/nfc/attendance/extra',
    '/checks',
    '/company-settings',
    '/COMPANY-SETTINGS',
    '/login',
    '/A1b2C3d4E5f6G7h8/extra',
    '/short',
    '/' + 'a'.repeat(17),
  ]) {
    assert.equal(isPublicSessionLandingPath(path), false, path);
  }
});
