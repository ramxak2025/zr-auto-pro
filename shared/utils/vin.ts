/**
 * VIN (Vehicle Identification Number, ISO 3779) — чистые хелперы, общие для
 * backend, web и mobile. Никаких зависимостей от React / RN / Node.
 *
 *   - normalizeVin   — привести ввод пользователя к каноническому виду
 *                      (латиница, верхний регистр, без пробелов; кириллические
 *                      двойники → латиница; I/O/Q → 1/0/0, т.к. в VIN их не бывает)
 *   - isValidVin     — 17 символов допустимого алфавита
 *   - vinCheckDigitOk — контрольная цифра (9-я позиция). Обязательна только
 *                      для североамериканских VIN (первый символ 1–5); для
 *                      остальных рынков её НЕ проверяем (Европа/Азия её не считают)
 *   - vinModelYear   — модельный год по 10-й позиции (цикл 30 лет — берём
 *                      самый свежий не «из будущего»)
 *   - formatVin      — группировка для отображения: WMI · VDS · VIS
 */

export const VIN_LENGTH = 17;

/** Разрешённый алфавит VIN: латиница без I, O, Q + цифры. */
const VIN_ALPHABET = /^[A-HJ-NPR-Z0-9]+$/;

/**
 * Кириллические буквы, визуально совпадающие с латиницей. Пользователь
 * набирает VIN с русской раскладки — превращаем в латиницу молча.
 */
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

/** Символов I, O, Q в VIN не бывает — это всегда опечатка вместо 1, 0, 0. */
const FORBIDDEN_TO_DIGIT: Record<string, string> = { I: '1', O: '0', Q: '0' };

/**
 * Привести сырой ввод к каноническому VIN. НЕ обрезает до 17 символов —
 * длину проверяет isValidVin (чтобы поле ввода могло показать «лишний символ»).
 */
export function normalizeVin(raw: string | null | undefined): string {
  if (!raw) return '';
  let out = '';
  for (const ch of raw.toUpperCase()) {
    const lat = CYR_TO_LAT[ch] ?? ch;
    const fixed = FORBIDDEN_TO_DIGIT[lat] ?? lat;
    if (/[A-Z0-9]/.test(fixed)) out += fixed;
  }
  return out;
}

/** true, если строка — синтаксически корректный VIN (17 символов алфавита). */
export function isValidVin(vin: string | null | undefined): boolean {
  if (!vin || vin.length !== VIN_LENGTH) return false;
  return VIN_ALPHABET.test(vin);
}

// ── Контрольная цифра (только Северная Америка) ─────────────────────────────

const TRANSLITERATION: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
};
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

/** Нужна ли проверка контрольной цифры: VIN североамериканских заводов (1–5). */
export function vinNeedsCheckDigit(vin: string): boolean {
  return /^[1-5]/.test(vin);
}

/** Контрольная цифра сходится (для VIN, где она обязательна). */
export function vinCheckDigitOk(vin: string): boolean {
  if (!isValidVin(vin)) return false;
  let sum = 0;
  for (let i = 0; i < VIN_LENGTH; i++) {
    const ch = vin[i];
    const value = /\d/.test(ch) ? Number(ch) : TRANSLITERATION[ch];
    if (value === undefined) return false;
    sum += value * WEIGHTS[i];
  }
  const rem = sum % 11;
  const expected = rem === 10 ? 'X' : String(rem);
  return vin[8] === expected;
}

// ── Модельный год (10-я позиция) ────────────────────────────────────────────

/** Коды года: 1980–2009 → A…Y, 1–9; с 2010 цикл повторяется. I, O, Q, U, Z и 0 не используются. */
const YEAR_CODES = 'ABCDEFGHJKLMNPRSTVWXY123456789';

/**
 * Модельный год по коду. Цикл 30 лет, поэтому кандидатов несколько — берём
 * самый свежий, который не позже следующего календарного года (заводы
 * присваивают модельный год с опережением на год). null — код не читается.
 */
export function vinModelYear(vin: string, now: Date = new Date()): number | null {
  if (!vin || vin.length < 10) return null;
  const idx = YEAR_CODES.indexOf(vin[9]);
  if (idx < 0) return null;
  const base = 1980 + idx;
  const maxYear = now.getFullYear() + 1;
  let year = base;
  while (year + 30 <= maxYear) year += 30;
  return year;
}

// ── Отображение ─────────────────────────────────────────────────────────────

/**
 * Разбить VIN на визуальные группы «WMI VDS VIS» (3 · 6 · 8) — так номер
 * читается с кузова и сверяется с ПТС. Некорректной длины строка вернётся как есть.
 */
export function formatVin(vin: string | null | undefined): string {
  if (!vin) return '';
  if (vin.length !== VIN_LENGTH) return vin;
  return `${vin.slice(0, 3)} ${vin.slice(3, 9)} ${vin.slice(9)}`;
}

/** WMI — первые три символа (код производителя). */
export function vinWmi(vin: string): string {
  return (vin || '').slice(0, 3);
}
