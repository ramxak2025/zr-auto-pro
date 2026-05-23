import { normalizePlateQuery, looksLikePlateQuery, plateMatches } from '../plateNormalize';

describe('normalizePlateQuery', () => {
  it('uppercases mixed-case input', () => {
    expect(normalizePlateQuery('а123вс')).toBe('А123ВС');
  });

  it('strips spaces, dashes and slashes', () => {
    expect(normalizePlateQuery(' А 123 ВС 77 ')).toBe('А123ВС77');
    expect(normalizePlateQuery('BG-3845-PA')).toBe('ВG3845РА');
  });

  it('maps Latin letters that have visual Cyrillic equivalents', () => {
    expect(normalizePlateQuery('a123bc')).toBe('А123ВС');
    expect(normalizePlateQuery('K123MH')).toBe('К123МН');
  });

  it('leaves untouchable Latin letters intact (D, F, etc.)', () => {
    expect(normalizePlateQuery('DFL123')).toBe('DFL123');
  });
});

describe('looksLikePlateQuery', () => {
  it('true for Cyrillic-leading queries with at least 2 chars', () => {
    expect(looksLikePlateQuery('А1')).toBe(true);
    expect(looksLikePlateQuery('А123')).toBe(true);
  });

  it('false for a single Cyrillic letter', () => {
    expect(looksLikePlateQuery('А')).toBe(false);
  });

  it('true for digit-only runs of 3+ chars', () => {
    expect(looksLikePlateQuery('123')).toBe(true);
    expect(looksLikePlateQuery('77')).toBe(false);
  });

  it('false for plain name-like input', () => {
    expect(looksLikePlateQuery('Ivan')).toBe(false);
    expect(looksLikePlateQuery('Иван')).toBe(false);
  });

  it('false for empty', () => {
    expect(looksLikePlateQuery('')).toBe(false);
  });
});

describe('plateMatches', () => {
  it('matches substring of normalized stored plate', () => {
    expect(plateMatches('А123АА77', '123')).toBe(true);
    expect(plateMatches('А123АА77', 'аа77')).toBe(true);
  });

  it('handles Latin keyboard inputs against Cyrillic plates', () => {
    expect(plateMatches('А123АА77', 'a123')).toBe(true);
  });

  it('returns false when query empty or plate empty', () => {
    expect(plateMatches('', 'А123')).toBe(false);
    expect(plateMatches('А123АА77', '')).toBe(false);
  });

  it('returns false when no overlap', () => {
    expect(plateMatches('А123АА77', '555')).toBe(false);
  });
});
