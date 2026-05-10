/**
 * Plate normalization helpers shared between backend, web and mobile.
 *
 * Pure logic only — no React Native / browser deps. Mirrors the masking rules
 * used in `mobile/src/utils/plateMask.ts`, but stripped down to what backend
 * and web import flows actually need:
 *   - normalize a raw plate string to a canonical key for dedup
 *   - decide whether a plate looks like a Russian plate or foreign
 */

const VALID_CYRILLIC = new Set('АВЕКМНОРСТУХ'.split(''));

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

const CYR_TO_LAT: Record<string, string> = {
  А: 'A',
  В: 'B',
  Е: 'E',
  К: 'K',
  М: 'M',
  Н: 'H',
  О: 'O',
  Р: 'P',
  С: 'C',
  Т: 'T',
  У: 'Y',
  Х: 'X',
};

function normalizeChar(ch: string, position: number): string {
  const upper = ch.toUpperCase();
  const cyr = LAT_TO_CYR[upper] || upper;

  if (position === 0) return VALID_CYRILLIC.has(cyr) ? cyr : '';
  if (position >= 1 && position <= 3) return /\d/.test(upper) ? upper : '';
  if (position >= 4 && position <= 5) return VALID_CYRILLIC.has(cyr) ? cyr : '';
  if (position >= 6 && position <= 8) return /\d/.test(upper) ? upper : '';
  return '';
}

export const PLATE_MAX_LENGTH = 9;

/**
 * Process a raw input string into a clean RU plate string (no spaces).
 * Drops invalid characters and converts Latin look-alikes to Cyrillic.
 *   "  p332pa05 " → "Р332РА05"
 *   "А 123 АА 77" → "А123АА77"
 */
export function processPlateInput(raw: string): string {
  if (!raw) return '';
  const chars: string[] = [];
  let pos = 0;
  for (const ch of raw) {
    if (pos >= PLATE_MAX_LENGTH) break;
    if (/\s/.test(ch)) continue;
    const normalized = normalizeChar(ch, pos);
    if (normalized) {
      chars.push(normalized);
      pos++;
    }
  }
  return chars.join('');
}

/**
 * Normalize a foreign-mode plate input.
 *   - Uppercase
 *   - Keep only [A-Z 0-9 \- /]
 *   - Trim spaces, collapse repeated whitespace
 *   - Cap at 20 chars
 */
export function normalizeForeignPlate(raw: string): string {
  if (!raw) return '';
  // Transliterate Cyrillic look-alikes to Latin so mixed-script plates like
  // "АМ36Сu857" survive: cyrillic А/М/С → A/M/C, Latin u uppercases to U.
  const transliterated = Array.from(raw)
    .map((ch) => CYR_TO_LAT[ch.toUpperCase()] || ch)
    .join('');
  return transliterated
    .toUpperCase()
    .replace(/[^A-Z0-9 \-/]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 20);
}

/** A complete RU plate looks like X 000 XX 00(0) — letters only from the valid Cyrillic set. */
export function isValidRussianPlate(clean: string): boolean {
  return /^[АВЕКМНОРСТУХ]\d{3}[АВЕКМНОРСТУХ]{2}\d{2,3}$/.test(clean);
}

/**
 * Returns true if the first non-space character looks like a valid Russian
 * plate letter (or its Latin look-alike). Used to pick RU vs foreign mode.
 */
export function looksLikeRussianPlate(raw: string): boolean {
  if (!raw) return false;
  const trimmed = raw.replace(/\s/g, '');
  if (!trimmed) return false;
  const first = trimmed[0].toUpperCase();
  const cyr = LAT_TO_CYR[first] || first;
  return VALID_CYRILLIC.has(cyr);
}

export type PlateMode = 'ru' | 'foreign';

/**
 * Pick the canonical key for plate dedup. Strips spaces and dashes so that
 * "Р 332 РА 05" and "Р332РА05" map to the same key.
 *
 * Returns an empty string when the input has no recognizable plate chars.
 */
export function plateDedupKey(raw: string, mode: PlateMode = 'ru'): string {
  if (!raw) return '';
  if (mode === 'ru') {
    return processPlateInput(raw);
  }
  return normalizeForeignPlate(raw).replace(/[\s\-/]/g, '');
}

/** Decide whether to treat a raw value as a RU or foreign plate. */
export function detectPlateMode(raw: string): PlateMode {
  return looksLikeRussianPlate(raw) ? 'ru' : 'foreign';
}

export interface NormalizedPlate {
  /** Canonical key with no spaces, used for dedup and DB lookup. */
  key: string;
  /** Display value with conventional spaces ("Р 332 РА 05" or "BG 3845 PA"). */
  display: string;
  /** Whether the plate parsed as a valid RU plate. */
  mode: PlateMode;
  /** True only for fully valid RU plates (1L+3D+2L+2-3D). */
  isValidRussian: boolean;
}

function formatRussianDisplay(clean: string): string {
  if (!clean) return '';
  const parts: string[] = [];
  if (clean.length >= 1) parts.push(clean[0]);
  if (clean.length > 1) parts.push(clean.slice(1, 4));
  if (clean.length > 4) parts.push(clean.slice(4, 6));
  if (clean.length > 6) parts.push(clean.slice(6, 9));
  return parts.join(' ');
}

/**
 * Full normalization for import: returns a value suitable for DB writes (`display`)
 * and a `key` for dedup. Empty-input safe.
 */
export function normalizePlate(raw: string): NormalizedPlate {
  const trimmed = (raw || '').trim();
  if (!trimmed) {
    return { key: '', display: '', mode: 'ru', isValidRussian: false };
  }

  if (looksLikeRussianPlate(trimmed)) {
    const clean = processPlateInput(trimmed);
    if (isValidRussianPlate(clean)) {
      return {
        key: clean,
        display: formatRussianDisplay(clean),
        mode: 'ru',
        isValidRussian: true,
      };
    }
    // looks Russian but didn't fully parse — fall through to foreign treatment
    // so we don't lose the user's value
  }

  const foreign = normalizeForeignPlate(trimmed);
  return {
    key: foreign.replace(/[\s\-/]/g, ''),
    display: foreign,
    mode: 'foreign',
    isValidRussian: false,
  };
}
