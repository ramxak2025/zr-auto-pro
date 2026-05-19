/**
 * Phone formatting tests — `shared/validation/phone.ts`.
 *
 * The mask `+7 (XXX) XXX-XX-XX` is now wired into every phone-pad input
 * in the app (LoginScreen, ClientsScreen, SuppliersScreen, UsersScreen,
 * CompanySettingsScreen). A regression here changes the way every user
 * types their phone number — these tests are the safety net.
 */
import { formatPhone, normalizePhone, isValidPhone } from '../../../../shared/validation/phone';

describe('formatPhone', () => {
  // ── Empty / partial inputs ─────────────────────────────────────────────
  it('returns empty string for empty input', () => {
    expect(formatPhone('')).toBe('');
  });

  it('returns empty string for input with no digits', () => {
    expect(formatPhone('abc-def')).toBe('');
  });

  it('formats a single leading digit', () => {
    expect(formatPhone('7')).toBe('+7');
    expect(formatPhone('9')).toBe('+9');
  });

  // ── Leading-8 conversion (Russian "8 800" → "+7 (800)") ────────────────
  it('converts leading 8 to 7', () => {
    expect(formatPhone('89001234567')).toBe('+7 (900) 123-45-67');
  });

  it('does not convert non-leading 8s', () => {
    expect(formatPhone('79008888888')).toBe('+7 (900) 888-88-88');
  });

  it('converts the 8 even on partial input', () => {
    expect(formatPhone('8900')).toBe('+7 (900');
  });

  // ── Progressive formatting as the user types ───────────────────────────
  it('formats 4 digits with opening paren', () => {
    expect(formatPhone('7900')).toBe('+7 (900');
  });

  it('formats 7 digits with closing paren and first segment', () => {
    expect(formatPhone('7900123')).toBe('+7 (900) 123');
  });

  it('formats 9 digits with two dashes', () => {
    expect(formatPhone('790012345')).toBe('+7 (900) 123-45');
  });

  it('formats a complete 11-digit number', () => {
    expect(formatPhone('79001234567')).toBe('+7 (900) 123-45-67');
  });

  // ── Robustness — accepts already-formatted input ───────────────────────
  it('strips existing formatting before re-applying mask', () => {
    expect(formatPhone('+7 (900) 123-45-67')).toBe('+7 (900) 123-45-67');
  });

  it('handles dirty input (mix of digits, spaces, dashes, parens)', () => {
    expect(formatPhone('8 (900) 123 45 67')).toBe('+7 (900) 123-45-67');
  });

  it('drops extra digits beyond 11', () => {
    // Owner enters 12 digits — we silently take the first 11.
    expect(formatPhone('790012345678')).toBe('+7 (900) 123-45-67');
  });
});

describe('normalizePhone', () => {
  it('strips formatting to canonical +7XXXXXXXXXX', () => {
    expect(normalizePhone('+7 (900) 123-45-67')).toBe('+79001234567');
  });

  it('converts a leading 8 to 7 when present', () => {
    expect(normalizePhone('8 (900) 123-45-67')).toBe('+79001234567');
  });

  it('keeps non-Russian numbers intact (no +7 prefix-injection)', () => {
    expect(normalizePhone('+19001234567')).toBe('+19001234567');
  });

  it('returns the original string when it contains no digits', () => {
    expect(normalizePhone('not a phone')).toBe('not a phone');
  });
});

describe('isValidPhone', () => {
  it('accepts a full Russian number', () => {
    expect(isValidPhone('+7 (900) 123-45-67')).toBe(true);
  });

  it('accepts an unformatted 11-digit string', () => {
    expect(isValidPhone('79001234567')).toBe(true);
  });

  it('rejects too-short inputs', () => {
    expect(isValidPhone('+7 (900)')).toBe(false);
    expect(isValidPhone('900')).toBe(false);
  });

  it('rejects empty', () => {
    expect(isValidPhone('')).toBe(false);
  });

  it('accepts 10 digits (without +7)', () => {
    // Edge: the test for "enough digits" is `>= 10`, so a domestic
    // 10-digit form is permitted by `isValidPhone` (formatPhone still
    // needs the leading 7/8 to render the mask).
    expect(isValidPhone('9001234567')).toBe(true);
  });
});
