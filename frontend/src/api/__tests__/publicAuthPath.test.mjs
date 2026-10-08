import test from 'node:test';
import assert from 'node:assert/strict';
import { isPublicSessionLandingPath } from '../publicAuthPath.js';

test('only the exact public booking and attendance routes stay open on staff-session expiry', () => {
  for (const path of ['/book/oil-service', '/BOOK/Oil-Service', '/nfc/attendance', '/NFC/Attendance']) {
    assert.equal(isPublicSessionLandingPath(path), true, path);
  }
  for (const path of ['/bookings', '/book', '/book/a/extra', '/nfc/attendance/extra', '/checks', '/login']) {
    assert.equal(isPublicSessionLandingPath(path), false, path);
  }
});
