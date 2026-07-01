/**
 * Phone formatting tests — `shared/validation/phone.ts`.
 *
 * The mask `+7 (XXX) XXX-XX-XX` is now wired into every phone-pad input
 * in the app (LoginScreen, ClientsScreen, SuppliersScreen, UsersScreen,
 * CompanySettingsScreen). A regression here changes the way every user
 * types their phone number — these tests are the safety net.
 */
import {
  formatPhone,
  normalizePhone,
  isValidPhone,
  phoneSearchKey,
  phoneSearchVariants,
} from '../../../../shared/validation/phone';

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

describe('phoneSearchVariants', () => {
  // ── Empty / digit-less inputs ──────────────────────────────────────────
  it('returns [] for empty and digit-less input', () => {
    expect(phoneSearchVariants('')).toEqual([]);
    expect(phoneSearchVariants('abc — def')).toEqual([]);
  });

  // ── Trunk-prefixed partial queries (the Round 7 #8 gap) ────────────────
  it('adds the trunk-stripped variant for a leading 8', () => {
    expect(phoneSearchVariants('8988')).toEqual(['8988', '988']);
  });

  it('adds the trunk-stripped variant for a leading 7', () => {
    expect(phoneSearchVariants('7988')).toEqual(['7988', '988']);
  });

  it('ignores formatting — «8(988)», «7-988», «+7 988» all strip the trunk', () => {
    expect(phoneSearchVariants('8(988)')).toEqual(['8988', '988']);
    expect(phoneSearchVariants('7-988')).toEqual(['7988', '988']);
    expect(phoneSearchVariants('+7 988')).toEqual(['7988', '988']);
  });

  it('does NOT strip a leading 9 (national mobile code, not a trunk)', () => {
    expect(phoneSearchVariants('988')).toEqual(['988']);
    expect(phoneSearchVariants('9884444485')).toEqual(['9884444485']);
  });

  it('needs at least 2 digits to strip a trunk', () => {
    expect(phoneSearchVariants('8')).toEqual(['8']);
    expect(phoneSearchVariants('7')).toEqual(['7']);
  });

  // ── Full numbers: stripped variant == last-10 key (deduped) ────────────
  it('dedupes when the stripped variant equals the last-10 key', () => {
    expect(phoneSearchVariants('89884444485')).toEqual(['89884444485', '9884444485']);
    expect(phoneSearchVariants('+79884444485')).toEqual(['79884444485', '9884444485']);
  });

  // ── phoneSearchKey parity — the old single-key behaviour is a subset ───
  it('always includes phoneSearchKey(raw) so no old match is lost', () => {
    // Double-prefixed garbage paste: «+7 8 988 444-44-85» → 12 digits.
    // Neither the raw digits nor the single-trunk strip fit a 10-digit
    // stored key, but the last-10 element still collapses to it.
    const doublePrefixed = '+7 8 988 444-44-85';
    expect(phoneSearchVariants(doublePrefixed)).toContain(phoneSearchKey(doublePrefixed));
    expect(phoneSearchVariants(doublePrefixed)).toEqual(['789884444485', '89884444485', '9884444485']);
  });

  // ── The containment contract the Касса display filter relies on ────────
  it('every user-typed trunk form finds the stored last-10 key', () => {
    const storedKey = phoneSearchKey('+7 (988) 444-44-85'); // '9884444485'
    for (const typed of ['8988', '8(988)', '7-988', '+7 988', '988', '89884444485', '9884444485']) {
      const variants = phoneSearchVariants(typed);
      expect(variants.some((v) => storedKey.includes(v))).toBe(true);
    }
  });

  it('keeps the most-national form LAST (the network-send contract)', () => {
    expect(phoneSearchVariants('8988').at(-1)).toBe('988');
    expect(phoneSearchVariants('+79884444485').at(-1)).toBe('9884444485');
    expect(phoneSearchVariants('988').at(-1)).toBe('988');
  });
});
