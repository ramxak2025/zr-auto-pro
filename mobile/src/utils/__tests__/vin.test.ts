/**
 * VIN helpers — `shared/utils/vin.ts` (171, 2026-09-25). Backend держит копию
 * логики в backend/src/vin/vin.util.ts — эти тесты фиксируют ожидаемое поведение.
 */
import {
  normalizeVin,
  isValidVin,
  vinCheckDigitOk,
  vinNeedsCheckDigit,
  vinModelYear,
  formatVin,
  vinWmi,
} from '../../../../shared/utils/vin';

describe('normalizeVin', () => {
  it('uppercases and strips spaces/dashes', () => {
    expect(normalizeVin(' xta 21901-0k0123456 ')).toBe('XTA219010K0123456');
  });

  it('converts Cyrillic look-alikes to Latin', () => {
    // Х Т А — кириллица, набрано с русской раскладки
    expect(normalizeVin('ХТА219010К0123456')).toBe('XTA219010K0123456');
    expect(normalizeVin('А В Е К М Н Р С Т У Х')).toBe('ABEKMHPCTYX');
  });

  it('maps forbidden I/O/Q (and Cyrillic О) to digits', () => {
    expect(normalizeVin('1HGCM82633AOO4352')).toBe('1HGCM82633A004352');
    expect(normalizeVin('WBAІ')).toBe('WBA'); // украинская І — не латиница, отбрасывается
    expect(normalizeVin('JQ1I')).toBe('J011');
  });

  it('handles empty input', () => {
    expect(normalizeVin('')).toBe('');
    expect(normalizeVin(null)).toBe('');
    expect(normalizeVin(undefined)).toBe('');
  });
});

describe('isValidVin', () => {
  it('accepts 17 chars of the VIN alphabet', () => {
    expect(isValidVin('XTA219010K0123456')).toBe(true);
    expect(isValidVin('1HGCM82633A004352')).toBe(true);
  });

  it('rejects wrong length and forbidden letters', () => {
    expect(isValidVin('XTA219010K012345')).toBe(false);
    expect(isValidVin('XTA219010K01234567')).toBe(false);
    expect(isValidVin('XTA219010K012345O')).toBe(false);
    expect(isValidVin('')).toBe(false);
    expect(isValidVin(null)).toBe(false);
  });
});

describe('check digit', () => {
  it('is required only for North American VINs', () => {
    expect(vinNeedsCheckDigit('1HGCM82633A004352')).toBe(true);
    expect(vinNeedsCheckDigit('5YJSA1E26HF000337')).toBe(true);
    expect(vinNeedsCheckDigit('XTA219010K0123456')).toBe(false);
    expect(vinNeedsCheckDigit('WBA3A5C55CF123456')).toBe(false);
  });

  it('validates the 9th position', () => {
    // Известный корректный VIN Honda Accord 2003
    expect(vinCheckDigitOk('1HGCM82633A004352')).toBe(true);
    // Испорчена одна цифра
    expect(vinCheckDigitOk('1HGCM82633A004353')).toBe(false);
    expect(vinCheckDigitOk('1HGCM8263XA004352')).toBe(false);
  });
});

describe('vinModelYear', () => {
  const now = new Date('2026-09-25');
  it('decodes the 10th position within the current 30-year cycle', () => {
    expect(vinModelYear('1HGCM82633A004352', now)).toBe(2003);
    expect(vinModelYear('XTA219010K0123456', now)).toBe(2019);
    expect(vinModelYear('WBA3A5C55CF123456', now)).toBe(2012);
  });

  it('never returns a year later than next calendar year', () => {
    // 'T' = 1996 / 2026 → 2026 (не 2056)
    expect(vinModelYear('XTA219010T0123456', now)).toBe(2026);
    // 'V' = 1997 / 2027 → 2027 допустимо (модельный год с опережением)
    expect(vinModelYear('XTA219010V0123456', now)).toBe(2027);
    // 'W' = 1998 / 2028 → 2028 из будущего → 1998
    expect(vinModelYear('XTA219010W0123456', now)).toBe(1998);
  });

  it('returns null for unreadable codes', () => {
    expect(vinModelYear('XTA219010U0123456', now)).toBeNull();
    expect(vinModelYear('XTA', now)).toBeNull();
  });
});

describe('formatVin / vinWmi', () => {
  it('groups WMI · VDS · VIS', () => {
    expect(formatVin('XTA219010K0123456')).toBe('XTA 219010 K0123456');
    expect(formatVin('XTA2190')).toBe('XTA2190');
    expect(formatVin('')).toBe('');
  });

  it('extracts the WMI', () => {
    expect(vinWmi('XTA219010K0123456')).toBe('XTA');
  });
});
