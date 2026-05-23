/**
 * plateNormalize — search-time helpers for matching what the user typed
 * against `plateNumber` strings stored on cars.
 *
 * Distinct from `plateMask.ts`, which is about input MASKING (cursor
 * positions, Latin→Cyrillic conversion while typing). Here we only care
 * about turning ANY user input into a canonical "comparison string"
 * that we can substring-match against a stored plate.
 *
 * Rules:
 *  • Uppercase.
 *  • Strip spaces, dashes, slashes.
 *  • Latin A/B/E/K/M/H/O/P/C/T/Y/X are mapped to their Cyrillic visual
 *    equivalents (А/В/Е/К/М/Н/О/Р/С/Т/У/Х) so somebody typing on a Latin
 *    keyboard still finds his russian plate. Mirrors the behaviour of
 *    `processPlateInput` from plateMask.ts.
 *  • Looks-like-a-plate detection: does the user input start with the
 *    canonical `letter + 3 digits + 2 letters …` shape? Used to decide
 *    "search by plate first" vs "search by phone/name first" priority.
 */
const LAT_TO_CYR: Record<string, string> = {
  A: 'А',
  B: 'В',
  E: 'Е',
  K: 'К',
  M: 'М',
  H: 'Н',
  O: 'О',
  P: 'Р',
  C: 'С',
  T: 'Т',
  Y: 'У',
  X: 'Х',
};

/** Turn ANY user input into a canonical case-folded, separator-free string. */
export function normalizePlateQuery(raw: string): string {
  if (!raw) return '';
  const upper = raw.toUpperCase();
  let out = '';
  for (const ch of upper) {
    if (ch === ' ' || ch === '-' || ch === '/' || ch === '\t' || ch === ' ') continue;
    out += LAT_TO_CYR[ch] ?? ch;
  }
  return out;
}

/**
 * Detect whether the user is searching by a Russian plate.
 * True when:
 *   • First char (after normalization) is a Cyrillic-from-АВЕКМНОРСТУХ letter,
 *     AND length ≥ 2 (avoids matching single-letter typing while user is mid-word);
 *   • OR the typed string is a pure-digit run of 3+ digits (typical user starts
 *     by typing the 3-digit body of the plate).
 */
const VALID_CYR = new Set('АВЕКМНОРСТУХ'.split(''));
export function looksLikePlateQuery(raw: string): boolean {
  const q = normalizePlateQuery(raw);
  if (q.length === 0) return false;
  if (VALID_CYR.has(q[0]) && q.length >= 2) return true;
  if (/^\d{3,}$/.test(q)) return true;
  return false;
}

/**
 * Test whether a stored plate matches the user's query.
 * Substring match against the normalized stored plate string.
 */
export function plateMatches(storedPlate: string | undefined | null, query: string): boolean {
  if (!storedPlate) return false;
  const q = normalizePlateQuery(query);
  if (!q) return false;
  return normalizePlateQuery(storedPlate).includes(q);
}
