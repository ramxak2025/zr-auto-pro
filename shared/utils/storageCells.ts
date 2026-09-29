/**
 * Ячейки хранения на складе — чистые хелперы, общие для web и mobile
 * (2026-09-30, docs/specs/2026-09-30-STORAGE_CELLS.md). Никаких зависимостей от
 * React / RN / Node. Backend shared не импортирует и нормализует код сам — правила
 * обязаны совпадать (trim, пробелы в один, верхний регистр); поведение зафиксировано
 * тестом mobile/src/utils/__tests__/storageCells.test.ts.
 *
 *   - normalizeCellCode — канонический вид кода ячейки
 *   - generateCellCodes — коды сетки «стеллажи × полки × ячейки» для POST /storage-cells/bulk
 *   - countCellCodes    — сколько кодов даст сетка (предпросмотр и проверка лимита, без генерации)
 *   - expandRacks       — разбор поля «Стеллажи»: «A-C» → A,B,C; «1-5» → 1..5; «A,B,C» как есть
 *   - MAX_BULK_CELLS    — лимит кодов в одном bulk-запросе
 */

/**
 * Максимум кодов в одном `POST /storage-cells/bulk` (и `productIds` в
 * `POST /products/bulk-assign-cell`). Сервер на большее отвечает 400.
 */
export const MAX_BULK_CELLS = 2000;

/**
 * Максимум стеллажей, которые вернёт `expandRacks`. Список или диапазон длиннее —
 * считаем ошибкой ввода (вернётся `[]`), а не усекаем молча.
 */
export const MAX_RACKS = 100;

/** Длиннее метка стеллажа — уже не «метка» (`expandRacks` вернёт `[]`). */
const MAX_RACK_LABEL_LENGTH = 20;

/** Потолок ширины `pad`: номера при лимите 2000 ячеек не длиннее 4 знаков. */
const MAX_PAD = 6;

/**
 * Канонический вид кода ячейки: trim, любые пробельные символы (в т. ч. NBSP и
 * табы) схлопнуты в один пробел, буквы в верхнем регистре (латиница и кириллица).
 * Это то, что хранит сервер; уникальность кода на складе — без учёта регистра.
 * Пустой / null / undefined → ''.
 */
export function normalizeCellCode(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) return '';
  return String(raw).replace(/\s+/g, ' ').trim().toUpperCase();
}

/**
 * Параметры сетки. Любая часть необязательна: отсутствующая часть просто не входит в
 * код. `{ racks: ['A'], shelves: 2 }` → `A-1`, `A-2`; `{ shelves: 2, cells: 3 }` →
 * `1-1` … `2-3`; `{ cells: 5 }` → `1` … `5`; ничего не задано → `[]`.
 */
export interface CellGridParams {
  /** Метки стеллажей: `['A', 'B']`, `['1', '2']` (см. `expandRacks`). Пустой список = части нет. */
  racks?: readonly string[];
  /** Полок на стеллаж: номера 1..N. Не задано / < 1 / NaN = части нет; дробное усекается вниз. */
  shelves?: number;
  /** Ячеек на полку: номера 1..N. Правила как у `shelves`. */
  cells?: number;
  /** Разделитель частей кода. По умолчанию `'-'`; пустая строка склеивает части (`A11`). */
  separator?: string;
  /**
   * Минимальная ширина номеров полки и ячейки с ведущими нулями: `pad: 2` → `01`, `12`.
   * Не задано / < 2 — без нулей. Метки стеллажей не дополняются. Потолок — 6.
   */
  pad?: number;
}

/** Количество проходов части: не число / NaN / < 1 → 0 (части нет); дробное — вниз; +Infinity — «огромное». */
function toCount(n: unknown): number {
  if (typeof n !== 'number' || Number.isNaN(n) || n < 1) return 0;
  return Number.isFinite(n) ? Math.floor(n) : Number.MAX_SAFE_INTEGER;
}

function clampPad(n: unknown): number {
  if (typeof n !== 'number' || !(n >= 2)) return 0;
  return Math.min(Math.floor(n), MAX_PAD);
}

/** Метки стеллажей в каноническом виде, без пустых и без повторов (регистр не важен), порядок сохранён. */
function uniqueRacks(racks: readonly string[] | null | undefined): string[] {
  if (!racks) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of racks) {
    const label = normalizeCellCode(raw);
    if (label && !seen.has(label)) {
      seen.add(label);
      out.push(label);
    }
  }
  return out;
}

/**
 * Сколько кодов даст `generateCellCodes(params)` — без генерации, за O(racks).
 * Для предпросмотра «Будет создано N ячеек» и проверки лимита (`> MAX_BULK_CELLS`) ДО
 * вызова генератора. Не бросает и не ограничивает: при абсурдных значениях вернёт
 * очень большое число или `Infinity`. Ни одной части → 0.
 */
export function countCellCodes(params: CellGridParams): number {
  let total = 1;
  let parts = 0;
  const racks = uniqueRacks(params.racks).length;
  if (racks > 0) {
    total *= racks;
    parts++;
  }
  const shelves = toCount(params.shelves);
  if (shelves > 0) {
    total *= shelves;
    parts++;
  }
  const cells = toCount(params.cells);
  if (cells > 0) {
    total *= cells;
    parts++;
  }
  return parts === 0 ? 0 : total;
}

/**
 * Коды ячеек сетки «стеллажи × полки × ячейки» в порядке «стеллаж → полка → ячейка».
 *
 *   generateCellCodes({ racks: ['A', 'B'], shelves: 3, cells: 4, separator: '-' })
 *     → 'A-1-1', 'A-1-2', … 'A-3-4', 'B-1-1', … 'B-3-4'   (24 кода)
 *
 * Номера — без ведущих нулей, пока не задан `pad`. Метки стеллажей нормализуются
 * (`normalizeCellCode`: верхний регистр, пробелы), повторы и пустые отбрасываются, так
 * что результат совпадает с тем, что сохранит сервер.
 *
 * ЛИМИТ: если кодов больше `MAX_BULK_CELLS` (2000) — БРОСАЕТ `Error` с русским
 * текстом, ничего не усекая (усечение молча дало бы не ту сетку, что просил
 * пользователь). Проверяйте `countCellCodes(params) > MAX_BULK_CELLS` заранее и
 * блокируйте кнопку; `Error` — страховка. Проверка идёт ДО генерации, память не
 * расходуется даже при `shelves: 1e9`.
 */
export function generateCellCodes(params: CellGridParams): string[] {
  const total = countCellCodes(params);
  if (total === 0) return [];
  if (total > MAX_BULK_CELLS) {
    throw new Error(
      `Слишком много ячеек за один раз: максимум ${MAX_BULK_CELLS}. Уменьшите число стеллажей, полок или ячеек.`,
    );
  }

  const separator = typeof params.separator === 'string' ? params.separator : '-';
  const pad = clampPad(params.pad);
  const racks = uniqueRacks(params.racks);
  const shelves = toCount(params.shelves);
  const cells = toCount(params.cells);

  // Отсутствующая часть — один проход, не попадающий в код.
  const rackList: Array<string | null> = racks.length > 0 ? racks : [null];
  const shelfPasses = shelves > 0 ? shelves : 1;
  const cellPasses = cells > 0 ? cells : 1;

  const out: string[] = [];
  for (const rack of rackList) {
    for (let shelf = 1; shelf <= shelfPasses; shelf++) {
      for (let cell = 1; cell <= cellPasses; cell++) {
        const parts: string[] = [];
        if (rack !== null) parts.push(rack);
        if (shelves > 0) parts.push(String(shelf).padStart(pad, '0'));
        if (cells > 0) parts.push(String(cell).padStart(pad, '0'));
        out.push(normalizeCellCode(parts.join(separator)));
      }
    }
  }
  return out;
}

// ─── expandRacks ─────────────────────────────────────────────────────────────

// Дефис, en dash, em dash, знак минус: iOS «умная пунктуация» превращает «--» в «—».
const NUMBER_RANGE = /^(\d+)\s*[-–—−]\s*(\d+)$/;
const LETTER_RANGE = /^([A-ZА-ЯЁ])\s*[-–—−]\s*([A-ZА-ЯЁ])$/;
// Метка: начинается и кончается буквой/цифрой, внутри ещё пробел . _ -
const RACK_LABEL = /^[A-ZА-ЯЁ0-9](?:[A-ZА-ЯЁ0-9 ._-]*[A-ZА-ЯЁ0-9])?$/;

const isLatin = (code: number): boolean => code >= 0x41 && code <= 0x5a;
// А..Я по кодовым точкам (U+0410–U+042F). Ё (U+0401) вне диапазона — в границах диапазона не участвует.
const isCyrillic = (code: number): boolean => code >= 0x410 && code <= 0x42f;

function letterRange(from: string, to: string): string[] | null {
  const a = from.charCodeAt(0);
  const b = to.charCodeAt(0);
  const sameAlphabet = (isLatin(a) && isLatin(b)) || (isCyrillic(a) && isCyrillic(b));
  if (!sameAlphabet || a > b) return null;
  const out: string[] = [];
  for (let code = a; code <= b; code++) out.push(String.fromCharCode(code));
  return out;
}

function numberRange(fromStr: string, toStr: string): string[] | null {
  if (fromStr.length > 9 || toStr.length > 9) return null;
  const from = Number(fromStr);
  const to = Number(toStr);
  if (from > to || to - from + 1 > MAX_RACKS) return null;
  // «01-05» → 01..05: ведущий ноль в любой границе задаёт ширину.
  const leadingZero = (s: string): boolean => s.length > 1 && s.charAt(0) === '0';
  const width = leadingZero(fromStr) || leadingZero(toStr) ? Math.max(fromStr.length, toStr.length) : 0;
  const out: string[] = [];
  for (let n = from; n <= to; n++) out.push(String(n).padStart(width, '0'));
  return out;
}

/** Метки одного токена; `[]` — пустой токен (пропускаем); `null` — токен не разобрать. */
function parseRackToken(token: string): string[] | null {
  const t = normalizeCellCode(token);
  if (!t) return [];
  const num = NUMBER_RANGE.exec(t);
  if (num) return numberRange(num[1], num[2]);
  const letters = LETTER_RANGE.exec(t);
  if (letters) return letterRange(letters[1], letters[2]);
  return t.length <= MAX_RACK_LABEL_LENGTH && RACK_LABEL.test(t) ? [t] : null;
}

/**
 * Разбор поля «Стеллажи» в список меток для `generateCellCodes({ racks })`.
 * Разделители токенов — запятая, точка с запятой, перевод строки; пустые токены
 * (`A,,B`, хвостовая запятая) пропускаются. Токен — одно из:
 *
 *   - диапазон букв ОДНОГО алфавита: `A-C` → A,B,C; `А-Г` (кириллица) → А,Б,В,Г; регистр не важен;
 *   - диапазон целых: `1-5` → 1..5; ведущие нули задают ширину: `01-05` → 01..05;
 *   - метка как есть (верхний регистр): `A`, `3`, `Б`, `A-1`, `Зона 2`.
 *
 * Повторы (`A-C, B`) схлопываются, порядок — по первому появлению.
 *
 * Всё или ничего: если ХОТЬ ОДИН токен не разобрать (обратный диапазон `C-A` / `5-1`,
 * разные алфавиты `A-Г`, диапазон с Ё, метка из одних знаков `!!!`, метка длиннее 20
 * символов) или итог длиннее `MAX_RACKS` (100) — возвращает `[]`, ничего не усекая.
 * Пустой ввод / null / undefined → `[]`. Не бросает. UI при `[]` на непустом вводе
 * показывает подсказку формата.
 */
export function expandRacks(input: string | null | undefined): string[] {
  if (!input) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const token of String(input).split(/[,;\r\n]+/)) {
    const items = parseRackToken(token);
    if (items === null) return [];
    for (const item of items) {
      if (seen.has(item)) continue;
      seen.add(item);
      out.push(item);
      if (out.length > MAX_RACKS) return [];
    }
  }
  return out;
}
