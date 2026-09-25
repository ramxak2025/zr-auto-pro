/**
 * VIN (Vehicle Identification Number, ISO 3779) — чистые хелперы.
 *
 * КОПИЯ shared/utils/vin.ts (171, 2026-09-25). Backend не импортирует shared/
 * (он вне rootDir tsconfig — ровно как normalize-plate.ts и normalize-phone.ts),
 * поэтому логика продублирована и ОБЯЗАНА совпадать по поведению байт-в-байт:
 * эталон — тесты mobile/src/utils/__tests__/vin.test.ts, их зеркало для этой
 * копии — backend/test/vin-decode.test.cjs. Меняя одно, меняй оба файла.
 *
 *   - normalizeVin    — привести ввод пользователя к каноническому виду
 *                       (латиница, верхний регистр, без пробелов; кириллические
 *                       двойники → латиница; I/O/Q → 1/0/0, т.к. в VIN их не бывает)
 *   - isValidVin      — 17 символов допустимого алфавита
 *   - vinCheckDigitOk — контрольная цифра (9-я позиция). Обязательна только
 *                       для североамериканских VIN (первый символ 1–5); для
 *                       остальных рынков её НЕ проверяем (Европа/Азия её не считают)
 *   - vinModelYear    — модельный год по 10-й позиции (цикл 30 лет — берём
 *                       самый свежий не «из будущего»)
 *   - formatVin       — группировка для отображения: WMI · VDS · VIS
 *
 * Плюс серверный хелпер humanizeMake — приведение марки из NHTSA («TOYOTA»,
 * «LAND ROVER») к человеческому виду. На клиентах его нет — им не нужен.
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
  A: 1,
  B: 2,
  C: 3,
  D: 4,
  E: 5,
  F: 6,
  G: 7,
  H: 8,
  J: 1,
  K: 2,
  L: 3,
  M: 4,
  N: 5,
  P: 7,
  R: 9,
  S: 2,
  T: 3,
  U: 4,
  V: 5,
  W: 6,
  X: 7,
  Y: 8,
  Z: 9,
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

// ── Серверное: человеческий вид марки ───────────────────────────────────────

/**
 * Марки, которые пишутся не «с заглавной»: аббревиатуры и фирменные написания.
 * Ключ — верхний регистр, как отдаёт NHTSA.
 */
const MAKE_SPELLING: Record<string, string> = {
  BMW: 'BMW',
  GMC: 'GMC',
  MG: 'MG',
  DS: 'DS',
  JAC: 'JAC',
  GAC: 'GAC',
  BYD: 'BYD',
  FAW: 'FAW',
  BAIC: 'BAIC',
  JMC: 'JMC',
  DFSK: 'DFSK',
  SWM: 'SWM',
  KGM: 'KGM',
  UAZ: 'УАЗ',
  GAZ: 'ГАЗ',
  KAMAZ: 'КАМАЗ',
  VAZ: 'Lada',
  LADA: 'Lada',
  AVTOVAZ: 'Lada',
  MCLAREN: 'McLaren',
  SSANGYONG: 'SsangYong',
  DETOMASO: 'De Tomaso',
  'MERCEDES-BENZ': 'Mercedes-Benz',
  'ROLLS-ROYCE': 'Rolls-Royce',
  'ALFA ROMEO': 'Alfa Romeo',
  'LAND ROVER': 'Land Rover',
  'ASTON MARTIN': 'Aston Martin',
  'LYNK & CO': 'Lynk & Co',
  CITROËN: 'Citroën',
  CITROEN: 'Citroën',
  ŠKODA: 'Škoda',
  SKODA: 'Škoda',
  VW: 'Volkswagen',
  VOLKSWAGEN: 'Volkswagen',
  CHEVROLET: 'Chevrolet',
};

/**
 * «TOYOTA» → «Toyota», «LAND ROVER» → «Land Rover», «BMW» остаётся «BMW»,
 * «MERCEDES-BENZ» → «Mercedes-Benz». Пустое/не строка → null.
 * Каждое слово (и каждая часть через дефис) — с заглавной; аббревиатуры до
 * трёх букв без гласных и известные написания — из таблицы выше.
 */
export function humanizeMake(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.replace(/\s+/g, ' ').trim();
  if (!trimmed) return null;
  const upper = trimmed.toUpperCase();
  if (MAKE_SPELLING[upper]) return MAKE_SPELLING[upper];
  const capitalize = (word: string): string => {
    if (!word) return word;
    // Короткая аббревиатура без гласных (GMC, BRP, KTM) — оставляем как есть.
    if (word.length <= 3 && !/[AEIOUY]/.test(word) && /^[A-Z]+$/.test(word)) return word;
    return word[0].toUpperCase() + word.slice(1).toLowerCase();
  };
  return upper
    .split(' ')
    .map((word) => word.split('-').map(capitalize).join('-'))
    .join(' ');
}
