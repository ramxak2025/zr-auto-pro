/**
 * Tests for shared/utils/plate.ts — used by backend imports, web admin
 * panel, and mobile clients screen for plate normalization + dedup.
 * A bug here corrupts car plates on bulk import.
 */
import {
  processPlateInput,
  normalizeForeignPlate,
  isValidRussianPlate,
  looksLikeRussianPlate,
  plateDedupKey,
  detectPlateMode,
  normalizePlate,
  PLATE_MAX_LENGTH,
} from '../../../../shared/utils/plate';

describe('processPlateInput', () => {
  it('returns empty string for empty input', () => {
    expect(processPlateInput('')).toBe('');
    expect(processPlateInput('   ')).toBe('');
  });

  it('converts Latin look-alikes to Cyrillic', () => {
    expect(processPlateInput('A123AA77')).toBe('А123АА77');
    expect(processPlateInput('p332pa05')).toBe('Р332РА05');
    expect(processPlateInput('m001mm777')).toBe('М001ММ777');
  });

  it('accepts Cyrillic directly', () => {
    expect(processPlateInput('А123АА77')).toBe('А123АА77');
  });

  it('strips spaces', () => {
    expect(processPlateInput('А 123 АА 77')).toBe('А123АА77');
    expect(processPlateInput('  А  123  АА  77  ')).toBe('А123АА77');
  });

  it('drops invalid characters at the wrong positions (greedy scan)', () => {
    // '1' at pos 0 (letter expected) → drop. 'А' becomes pos 0 letter.
    // '2' becomes pos 1 (digit OK), '3' becomes pos 2 (digit OK).
    expect(processPlateInput('1А23')).toBe('А23');
    // Letters after the first letter — only the first letter takes pos 0;
    // subsequent letters scan looking for a digit (pos 1) and drop.
    expect(processPlateInput('АААА')).toBe('А');
  });

  it('caps at PLATE_MAX_LENGTH (9)', () => {
    expect(PLATE_MAX_LENGTH).toBe(9);
    // 1 letter + 3 digits + 2 letters + 3 digits + extra = capped at 9
    expect(processPlateInput('А123АА7777').length).toBeLessThanOrEqual(9);
  });

  it('drops chars from outside АВЕКМНОРСТУХ at the leading-letter position', () => {
    // Я / Б are not in the valid set → dropped from pos 0. The next chars
    // try to fill pos 0 themselves; the algorithm is greedy: digits at
    // pos 0 also drop, but a later valid Cyrillic char will take pos 0
    // and the rest re-scan from pos 1 onward.
    expect(processPlateInput('Z123ZZ77')).toBe(''); // Z not in Latin map → all dropped
    // Real-world expectation: if the first char isn't a valid letter, the
    // result is best-effort — never the original string.
    expect(processPlateInput('Я123АА77')).not.toContain('Я');
    expect(processPlateInput('Б123АА77')).not.toContain('Б');
  });

  it('handles 2-digit and 3-digit regions', () => {
    expect(processPlateInput('А123АА77')).toBe('А123АА77');
    expect(processPlateInput('А123АА777')).toBe('А123АА777');
  });
});

describe('normalizeForeignPlate', () => {
  it('returns empty for empty input', () => {
    expect(normalizeForeignPlate('')).toBe('');
  });

  it('uppercases', () => {
    expect(normalizeForeignPlate('bg3845pa')).toBe('BG3845PA');
  });

  it('keeps A-Z, 0-9, spaces, dashes, slashes; strips other punctuation', () => {
    expect(normalizeForeignPlate('BG-3845/PA')).toBe('BG-3845/PA');
    expect(normalizeForeignPlate('BG 3845 PA')).toBe('BG 3845 PA');
    expect(normalizeForeignPlate('BG.3845.PA')).toBe('BG3845PA');
    expect(normalizeForeignPlate('BG!3845!PA')).toBe('BG3845PA');
  });

  it('transliterates Cyrillic look-alikes to Latin', () => {
    // АМ36Сu857: А→A, М→M, С→C, u stays then uppercased to U
    expect(normalizeForeignPlate('АМ36Сu857')).toBe('AM36CU857');
  });

  it('collapses repeated whitespace', () => {
    expect(normalizeForeignPlate('AB   12   CD')).toBe('AB 12 CD');
  });

  it('trims leading/trailing whitespace', () => {
    expect(normalizeForeignPlate('  AB12CD  ')).toBe('AB12CD');
  });

  it('caps at 20 chars', () => {
    const long = 'A'.repeat(30);
    expect(normalizeForeignPlate(long).length).toBe(20);
  });
});

describe('isValidRussianPlate', () => {
  it('accepts a valid 2-digit-region plate', () => {
    expect(isValidRussianPlate('А123АА77')).toBe(true);
  });

  it('accepts a valid 3-digit-region plate', () => {
    expect(isValidRussianPlate('А123АА777')).toBe(true);
  });

  it('rejects missing region', () => {
    expect(isValidRussianPlate('А123АА')).toBe(false);
  });

  it('rejects too-many region digits', () => {
    expect(isValidRussianPlate('А123АА7777')).toBe(false);
  });

  it('rejects wrong letter at any position', () => {
    expect(isValidRussianPlate('Я123АА77')).toBe(false);
    expect(isValidRussianPlate('А123ЯА77')).toBe(false);
  });

  it('rejects Latin in canonical form', () => {
    // Note: isValidRussianPlate checks the CLEAN cyrillic form only;
    // Latin lookalikes must be converted via processPlateInput first.
    expect(isValidRussianPlate('A123AA77')).toBe(false);
  });

  it('rejects empty', () => {
    expect(isValidRussianPlate('')).toBe(false);
  });
});

describe('looksLikeRussianPlate', () => {
  it('true for Cyrillic first letter', () => {
    expect(looksLikeRussianPlate('А123АА77')).toBe(true);
  });

  it('true for Latin look-alike first letter', () => {
    expect(looksLikeRussianPlate('a123aa77')).toBe(true);
    expect(looksLikeRussianPlate('P332PA05')).toBe(true);
  });

  it('false for digit first', () => {
    expect(looksLikeRussianPlate('123ABC')).toBe(false);
  });

  it('false for non-mappable Latin first letter', () => {
    expect(looksLikeRussianPlate('ZB12345')).toBe(false);
    expect(looksLikeRussianPlate('Q123QQ77')).toBe(false);
  });

  it('false for empty / whitespace', () => {
    expect(looksLikeRussianPlate('')).toBe(false);
    expect(looksLikeRussianPlate('   ')).toBe(false);
  });

  it('ignores leading whitespace', () => {
    expect(looksLikeRussianPlate('  А123АА77')).toBe(true);
  });
});

describe('plateDedupKey', () => {
  it('strips spaces from RU input', () => {
    expect(plateDedupKey('А 123 АА 77', 'ru')).toBe('А123АА77');
    expect(plateDedupKey('А123АА77', 'ru')).toBe('А123АА77');
  });

  it('strips spaces, dashes, slashes from foreign', () => {
    expect(plateDedupKey('BG-3845/PA', 'foreign')).toBe('BG3845PA');
    expect(plateDedupKey('BG 3845 PA', 'foreign')).toBe('BG3845PA');
  });

  it('returns same key for equivalent inputs (dedup invariant)', () => {
    const a = plateDedupKey('Р 332 РА 05', 'ru');
    const b = plateDedupKey('p332pa05', 'ru');
    expect(a).toBe(b);
  });

  it('returns empty for empty input', () => {
    expect(plateDedupKey('', 'ru')).toBe('');
    expect(plateDedupKey('   ', 'ru')).toBe('');
  });
});

describe('detectPlateMode', () => {
  it('returns ru for plates that look Russian', () => {
    expect(detectPlateMode('А123АА77')).toBe('ru');
    expect(detectPlateMode('p332pa05')).toBe('ru');
  });

  it('returns foreign for plates that start with a digit or non-mappable letter', () => {
    expect(detectPlateMode('123-ABC-456')).toBe('foreign'); // digit first
    expect(detectPlateMode('QQ123QQ')).toBe('foreign'); // Q not in Latin map
    expect(detectPlateMode('ZZ123ZZ')).toBe('foreign'); // Z not in Latin map
    // NOTE: a plate that BEGINS with a Latin look-alike (B→В, A→А) is
    // detected as 'ru' because the first char is ambiguous. That's
    // intentional and lets foreign plates starting with M/A/B/etc. fall
    // through to processPlateInput → which then either succeeds (rare)
    // or fails-gracefully and the caller picks foreign mode.
  });

  it('returns foreign for empty / unparseable input', () => {
    expect(detectPlateMode('')).toBe('foreign');
  });
});

describe('normalizePlate', () => {
  it('parses a valid RU plate with display formatting', () => {
    const out = normalizePlate('p332pa05');
    expect(out).toEqual({
      key: 'Р332РА05',
      display: 'Р 332 РА 05',
      mode: 'ru',
      isValidRussian: true,
    });
  });

  it('formats 3-digit region correctly', () => {
    const out = normalizePlate('А123АА777');
    expect(out.display).toBe('А 123 АА 777');
    expect(out.isValidRussian).toBe(true);
  });

  it('falls through to foreign treatment when RU-looking but invalid', () => {
    // Has RU-look first letter but incomplete — falls to foreign so the
    // import doesn't lose the user's value.
    const out = normalizePlate('А1');
    expect(out.mode).toBe('foreign');
    expect(out.isValidRussian).toBe(false);
    expect(out.key).toBe('A1');
  });

  it('handles foreign plate', () => {
    const out = normalizePlate('BG-3845-PA');
    expect(out.mode).toBe('foreign');
    expect(out.isValidRussian).toBe(false);
    expect(out.key).toBe('BG3845PA');
    expect(out.display).toBe('BG-3845-PA');
  });

  it('handles empty input', () => {
    expect(normalizePlate('')).toEqual({
      key: '',
      display: '',
      mode: 'ru',
      isValidRussian: false,
    });
    expect(normalizePlate('   ')).toEqual({
      key: '',
      display: '',
      mode: 'ru',
      isValidRussian: false,
    });
  });

  it('preserves dedup invariant across formatted/unformatted inputs', () => {
    const a = normalizePlate('Р 332 РА 05');
    const b = normalizePlate('p332pa05');
    expect(a.key).toBe(b.key);
  });
});
