/**
 * Plate normalization for the imports module.
 *
 * Mirrors `shared/utils/plate.ts` logic. Backend can't import from `shared/`
 * directly (its tsconfig doesn't watch `../shared`), so we keep a small
 * duplicate here. The contract is verified by jest tests on the shared file
 * and by integration tests on the controller.
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

const PLATE_MAX_LENGTH = 9;

function normalizeChar(ch: string, position: number): string {
  const upper = ch.toUpperCase();
  const cyr = LAT_TO_CYR[upper] || upper;

  if (position === 0) return VALID_CYRILLIC.has(cyr) ? cyr : '';
  if (position >= 1 && position <= 3) return /\d/.test(upper) ? upper : '';
  if (position >= 4 && position <= 5) return VALID_CYRILLIC.has(cyr) ? cyr : '';
  if (position >= 6 && position <= 8) return /\d/.test(upper) ? upper : '';
  return '';
}

function processPlateInput(raw: string): string {
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

function normalizeForeignPlate(raw: string): string {
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

export function isValidRussianPlate(clean: string): boolean {
  return /^[АВЕКМНОРСТУХ]\d{3}[АВЕКМНОРСТУХ]{2}\d{2,3}$/.test(clean);
}

function looksLikeRussianPlate(raw: string): boolean {
  if (!raw) return false;
  const trimmed = raw.replace(/\s/g, '');
  if (!trimmed) return false;
  const first = trimmed[0].toUpperCase();
  const cyr = LAT_TO_CYR[first] || first;
  return VALID_CYRILLIC.has(cyr);
}

export interface NormalizedPlate {
  key: string;
  display: string;
  mode: 'ru' | 'foreign';
  isValidRussian: boolean;
  /** True if normalization couldn't extract anything usable from input. */
  isEmpty: boolean;
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

export function normalizePlate(raw: string | null | undefined): NormalizedPlate {
  const trimmed = (raw || '').trim();
  if (!trimmed) {
    return { key: '', display: '', mode: 'ru', isValidRussian: false, isEmpty: true };
  }

  if (looksLikeRussianPlate(trimmed)) {
    const clean = processPlateInput(trimmed);
    if (isValidRussianPlate(clean)) {
      return {
        key: clean,
        display: formatRussianDisplay(clean),
        mode: 'ru',
        isValidRussian: true,
        isEmpty: false,
      };
    }
  }

  const foreign = normalizeForeignPlate(trimmed);
  if (!foreign) {
    return { key: '', display: '', mode: 'foreign', isValidRussian: false, isEmpty: true };
  }
  return {
    key: foreign.replace(/[\s\-/]/g, ''),
    display: foreign,
    mode: 'foreign',
    isValidRussian: false,
    isEmpty: false,
  };
}
