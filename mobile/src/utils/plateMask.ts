/**
 * Russian license plate mask logic.
 *
 * Pattern: X 000 XX 00(0)
 * Where X = Cyrillic from {АВЕКМНОРСТУХ}
 *
 * Under the hood: one string "А123АА77" stored without spaces.
 * Visual display adds spaces: "А 123 АА 77"
 * Backspace deletes one char from the right, seamlessly crossing
 * the visual region/main boundary.
 */

// Only valid Cyrillic letters on Russian plates
const VALID_CYRILLIC = new Set('АВЕКМНОРСТУХ'.split(''));

// Latin → Cyrillic auto-conversion (same visual shape)
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

/**
 * Normalize a single character: uppercase + Latin→Cyrillic.
 * Returns the char or '' if it's not valid at this position.
 */
function normalizeChar(ch: string, position: number): string {
  const upper = ch.toUpperCase();
  const cyr = LAT_TO_CYR[upper] || upper;

  // Position 0: must be a letter
  if (position === 0) return VALID_CYRILLIC.has(cyr) ? cyr : '';
  // Position 1-3: must be digits
  if (position >= 1 && position <= 3) return /\d/.test(upper) ? upper : '';
  // Position 4-5: must be letters
  if (position >= 4 && position <= 5) return VALID_CYRILLIC.has(cyr) ? cyr : '';
  // Position 6-8: must be digits (region, 2-3 chars)
  if (position >= 6 && position <= 8) return /\d/.test(upper) ? upper : '';
  return '';
}

/** Max length of raw plate string (9 chars: X000XX000) */
export const PLATE_MAX_LENGTH = 9;

/**
 * Process the MAIN block alone (1 letter + 3 digits + 2 letters → max 6 chars).
 * Used when the input has separate main and region fields (recommended UX).
 */
export function processPlateMainInput(raw: string): string {
  const chars: string[] = [];
  let pos = 0;
  for (const ch of raw) {
    if (pos >= 6) break;
    const normalized = normalizeChar(ch, pos);
    if (normalized) {
      chars.push(normalized);
      pos++;
    }
  }
  return chars.join('');
}

/**
 * Process the REGION block alone (2-3 digits).
 */
export function processPlateRegionInput(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  return digits.slice(0, 3);
}

/**
 * Combine separate main + region back into a single clean plate string.
 */
export function combinePlate(main: string, region: string): string {
  return `${main}${region}`;
}

/**
 * Process a raw input string into a clean plate string.
 * Applies character-by-character validation + Latin→Cyrillic conversion.
 */
export function processPlateInput(raw: string): string {
  const chars: string[] = [];
  let pos = 0;
  for (const ch of raw) {
    if (pos >= PLATE_MAX_LENGTH) break;
    const normalized = normalizeChar(ch, pos);
    if (normalized) {
      chars.push(normalized);
      pos++;
    }
  }
  return chars.join('');
}

/**
 * Format a clean plate string into display format with spaces.
 *
 * Input: "А123АА77"
 * Output: "А 123 АА 77"
 *
 * Handles partial inputs:
 * "А"       → "А"
 * "А12"     → "А 12"
 * "А123А"   → "А 123 А"
 * "А123АА7" → "А 123 АА 7"
 */
export function formatPlateDisplay(clean: string): string {
  if (!clean) return '';
  const parts: string[] = [];

  // Part 1: first letter (pos 0)
  if (clean.length >= 1) parts.push(clean[0]);
  // Part 2: digits (pos 1-3)
  if (clean.length > 1) parts.push(clean.slice(1, 4));
  // Part 3: two letters (pos 4-5)
  if (clean.length > 4) parts.push(clean.slice(4, 6));
  // Part 4: region digits (pos 6-8)
  if (clean.length > 6) parts.push(clean.slice(6, 9));

  return parts.join(' ');
}

/**
 * Get cursor visual position from raw position.
 * Accounts for spaces inserted by formatPlateDisplay.
 */
export function rawPosToDisplayPos(rawPos: number): number {
  if (rawPos <= 1) return rawPos;
  if (rawPos <= 4) return rawPos + 1; // space after first letter
  if (rawPos <= 6) return rawPos + 2; // space after digits
  return rawPos + 3; // space after two letters
}

/**
 * Split a clean plate string into main part and region.
 * Used for visual layout (main block | region block).
 */
export function splitPlate(clean: string): { main: string; region: string } {
  if (clean.length <= 6) return { main: clean, region: '' };
  return {
    main: clean.slice(0, 6),
    region: clean.slice(6),
  };
}

/**
 * Format main part with spaces: "А123АА" → "А 123 АА"
 */
export function formatMain(main: string): string {
  if (!main) return '';
  const parts: string[] = [];
  if (main.length >= 1) parts.push(main[0]);
  if (main.length > 1) parts.push(main.slice(1, 4));
  if (main.length > 4) parts.push(main.slice(4, 6));
  return parts.join(' ');
}

/**
 * Validate a complete Russian plate number.
 */
export function isValidPlate(clean: string): boolean {
  return /^[АВЕКМНОРСТУХ]\d{3}[АВЕКМНОРСТУХ]{2}\d{2,3}$/.test(clean);
}

/**
 * Check if input starts with a valid Cyrillic plate letter.
 */
export function isRussianInput(text: string): boolean {
  if (!text) return false;
  const first = text[0].toUpperCase();
  const cyr = LAT_TO_CYR[first] || first;
  return VALID_CYRILLIC.has(cyr);
}

// ═══════════════════════════════════════════════════════════════════════════
//  Foreign plate normalization
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Normalize a foreign-mode plate input.
 *
 * Rules:
 *  - Uppercase
 *  - Collapse multiple spaces into single space
 *  - Trim leading/trailing whitespace
 *  - Keep only [A-Z 0-9 \- /] (drop accidental cyrillic / specials)
 *  - Max 20 characters
 *
 * Examples:
 *   "  bg-3845-pa  " → "BG-3845-PA"
 *   "t 123 ab"        → "T 123 AB"
 *   "BG3845PA"        → "BG3845PA"
 */
export function normalizeForeignPlate(raw: string): string {
  if (!raw) return '';
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9 \-/]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 20);
}

/**
 * Normalize plate for backend search (clients/cars).
 *
 * Returns a clean string without spaces/regional dividers, ready for
 * the `?search=` parameter on `clients/getAll`.
 *
 *  - mode='ru':   pass through processPlateInput (latin→cyrillic, drop invalid)
 *  - mode='foreign': uppercase + drop spaces/dashes (server typically stores
 *                    a denormalized version, so search by raw chars wins)
 *
 * Examples:
 *   normalizePlateForSearch('p 332 pa 05', 'ru')        → 'Р332РА05'
 *   normalizePlateForSearch('р332ра05', 'ru')           → 'Р332РА05'
 *   normalizePlateForSearch('bg-3845-pa', 'foreign')    → 'BG3845PA'
 *   normalizePlateForSearch('BG3845PA', 'foreign')      → 'BG3845PA'
 */
export function normalizePlateForSearch(raw: string, mode: 'ru' | 'foreign' = 'ru'): string {
  if (!raw) return '';
  if (mode === 'ru') {
    return processPlateInput(raw.replace(/\s/g, ''));
  }
  // foreign: drop separators for tighter substring match
  return normalizeForeignPlate(raw).replace(/[\s\-/]/g, '');
}

/**
 * Decide initial mode from an existing value (e.g. when editing an existing
 * client). Defaults to 'ru' for empty input.
 */
export function detectPlateMode(value: string): 'ru' | 'foreign' {
  if (!value) return 'ru';
  return isRussianInput(value) ? 'ru' : 'foreign';
}
