/**
 * Ячейки хранения (2026-09-30): чистая логика экранов мобилки — поиск по коду,
 * разбор ошибок сервера и предпросмотр сетки. Без react / react-native, поэтому
 * тестируется под node-jest (storageCellsUi.test.ts).
 *
 * Коды сетки считают и генерируют ТОЛЬКО функции shared/utils/storageCells —
 * здесь они собраны воедино для формы «Создать сетку», правила не повторены:
 * иначе предпросмотр разошёлся бы с тем, что примет сервер.
 */
import type { StorageCell, StorageCellError } from '../../../shared/types';
import {
  MAX_BULK_CELLS,
  countCellCodes,
  expandRacks,
  generateCellCodes,
  normalizeCellCode,
  type CellGridParams,
} from '../../../shared/utils/storageCells';
import { extractApiErrorMessage } from './apiError';

/** Потолок длины кода при вводе: сервер лимита не декларирует, а «Стеллаж 2 · Полка 4» короче. */
export const MAX_CELL_CODE_LENGTH = 32;

/** Потолок длины подписи ячейки («у входа», «масла») при вводе. */
export const MAX_CELL_NAME_LENGTH = 60;

/** Русское склонение числительного: 1 товар, 2 товара, 5 товаров (11–14 — «товаров»). */
export function pluralRu(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

/** «3 товара» — счётчик товаров в ячейке. */
export function productsCountText(n: number): string {
  return `${n} ${pluralRu(n, 'товар', 'товара', 'товаров')}`;
}

/** «12 ячеек» — счётчик ячеек. */
export function cellsCountText(n: number): string {
  return `${n} ${pluralRu(n, 'ячейка', 'ячейки', 'ячеек')}`;
}

// ─── Поиск ───────────────────────────────────────────────────────────────────

/**
 * Код ячейки подходит под запрос — тем же правилом, каким сервер хранит код
 * (`normalizeCellCode`: регистр и лишние пробелы не важны). Пустой запрос — «фильтра
 * нет», подходит всё; вызывающий, который склеивает условие с поиском по названию,
 * сам не зовёт функцию с пустым запросом.
 */
export function cellCodeMatchesQuery(code: string | null | undefined, query: string): boolean {
  const q = normalizeCellCode(query);
  if (!q) return true;
  return normalizeCellCode(code).includes(q);
}

/** Ячейки, у которых код или подпись содержат запрос. Без запроса — тот же массив (без копии). */
export function filterStorageCells(cells: StorageCell[], query: string): StorageCell[] {
  const q = normalizeCellCode(query);
  if (!q) return cells;
  return cells.filter((c) => normalizeCellCode(c.code).includes(q) || normalizeCellCode(c.name).includes(q));
}

// ─── Ошибки сервера ──────────────────────────────────────────────────────────

export interface ParsedStorageCellError {
  code: StorageCellError['code'];
  /** Только у `STORAGE_CELL_NOT_EMPTY`. */
  productsCount?: number;
}

/**
 * Ошибка модуля ячеек из axios-ответа. Сверяем `code` верхнего уровня тела
 * (HttpExceptionFilter кладёт дополнительные поля рядом с `message`), а не текст:
 * текст сервера можно поправить, контракт по `code` — нет. Не наша ошибка → `null`.
 */
export function parseStorageCellError(error: unknown): ParsedStorageCellError | null {
  const data = (error as { response?: { data?: unknown } } | null)?.response?.data;
  if (!data || typeof data !== 'object') return null;
  const { code, productsCount } = data as { code?: unknown; productsCount?: unknown };
  if (code !== 'STORAGE_CELL_EXISTS' && code !== 'STORAGE_CELL_NOT_EMPTY' && code !== 'STORAGE_CELL_WRONG_WAREHOUSE') {
    return null;
  }
  const count = typeof productsCount === 'number' && Number.isFinite(productsCount) ? productsCount : undefined;
  return { code, productsCount: count };
}

/** Код занят — на экране самих ячеек: список рядом, отправлять «выбрать из списка» незачем. */
export const STORAGE_CELL_TAKEN_TEXT = 'Ячейка с таким кодом уже есть на этом складе. Задайте другой код.';

/** Понятный текст отказа: свои формулировки для кодов модуля, для остального — ответ сервера или fallback. */
export function storageCellFailureText(error: unknown, fallback: string): string {
  const parsed = parseStorageCellError(error);
  switch (parsed?.code) {
    case 'STORAGE_CELL_EXISTS':
      return 'Ячейка с таким кодом уже есть на этом складе. Выберите её из списка или задайте другой код.';
    case 'STORAGE_CELL_WRONG_WAREHOUSE':
      return 'Эта ячейка относится к другому складу. Выберите ячейку того склада, на котором лежит товар.';
    case 'STORAGE_CELL_NOT_EMPTY':
      return typeof parsed.productsCount === 'number'
        ? `Ячейка не пуста (${productsCountText(parsed.productsCount)}). Перенесите их в другую ячейку или снимите адрес.`
        : 'Ячейка не пуста. Перенесите товары в другую ячейку или снимите адрес.';
    default:
      return extractApiErrorMessage(error, fallback);
  }
}

/** Отказ формы создания / переименования на экране «Ячейки хранения». */
export function storageCellFormFailureText(error: unknown, fallback: string): string {
  if (parseStorageCellError(error)?.code === 'STORAGE_CELL_EXISTS') return STORAGE_CELL_TAKEN_TEXT;
  return storageCellFailureText(error, fallback);
}

// ─── Карточка товара после смены адреса ──────────────────────────────────────

/** Поля адреса хранения, которые читает карточка товара. */
interface ProductCellFields {
  storageCellId?: string | null;
  storageCellCode?: string | null;
  storageCellName?: string | null;
}

/**
 * Приводит товар из ответа `PATCH /products/:id` к адресу, который отправили. Ответ мог
 * прийти без склейки с ячейкой (нет кода и подписи) — тогда после смены адреса карточка
 * на миг показала бы «Не указана», пока не доедет повторное чтение.
 *
 * `requestedId`: `undefined` — адрес в запросе не менялся; `null` — снят; строка — id
 * выбранной ячейки (`cell` — она же, с кодом). Если склейка в ответе есть, ответ не трогаем.
 */
export function withRequestedStorageCell<T extends ProductCellFields>(
  product: T,
  requestedId: string | null | undefined,
  cell: { id: string; code: string; name?: string | null } | null,
): T {
  if (requestedId === undefined) return product;
  if (requestedId === null) {
    return { ...product, storageCellId: null, storageCellCode: null, storageCellName: null };
  }
  if (product.storageCellId === requestedId && product.storageCellCode) return product;
  if (!cell || cell.id !== requestedId) return product;
  return { ...product, storageCellId: cell.id, storageCellCode: cell.code, storageCellName: cell.name ?? null };
}

// ─── Сетка «стеллажи × полки × ячейки» ───────────────────────────────────────

/** Значения полей формы «Создать сетку» как есть — строки из TextInput. */
export interface CellGridInput {
  /** «A-C», «1-5», «A, B, C» — разбирает `expandRacks`. */
  racksText: string;
  shelves: string;
  cells: string;
  /** Разделитель частей кода: «-», «.», «/». */
  separator: string;
  /** Ведущие нули у номеров: 1 → 01. */
  padZeros: boolean;
}

export interface CellGridPreview {
  /** Сколько ячеек даст сетка. 0 — сетка не задана или поле «Стеллажи» не разобрано. */
  count: number;
  /** Поле «Стеллажи» не пустое, но `expandRacks` его не разобрал — показываем подсказку формата. */
  racksInvalid: boolean;
  /** Сетка больше лимита одного запроса (`MAX_BULK_CELLS`): создать нельзя. */
  overLimit: boolean;
  /** Коды к отправке. Заполнены только когда `canCreate`. */
  codes: string[];
  canCreate: boolean;
}

/** Число из поля: только цифры; пусто / 0 — части сетки нет (`undefined`). Огромное значение остаётся огромным. */
function parseGridCount(text: string): number | undefined {
  const digits = String(text ?? '').replace(/\D+/g, '');
  if (!digits) return undefined;
  const n = Number(digits);
  return n > 0 ? n : undefined;
}

/**
 * Предпросмотр сетки для формы. Порядок важен: сначала считаем `countCellCodes`
 * (без генерации) и сверяем с лимитом, и лишь потом зовём `generateCellCodes` —
 * иначе на «полок: 9999» генератор бросил бы Error.
 */
export function buildCellGridPreview(input: CellGridInput): CellGridPreview {
  const racks = expandRacks(input.racksText);
  const racksInvalid = input.racksText.trim() !== '' && racks.length === 0;
  const params: CellGridParams = {
    racks,
    shelves: parseGridCount(input.shelves),
    cells: parseGridCount(input.cells),
    separator: input.separator,
    pad: input.padZeros ? 2 : undefined,
  };
  // Не разобранное поле стеллажей не превращаем молча в сетку «без стеллажей».
  const count = racksInvalid ? 0 : countCellCodes(params);
  const overLimit = count > MAX_BULK_CELLS;
  const canCreate = count > 0 && !overLimit;
  return { count, racksInvalid, overLimit, canCreate, codes: canCreate ? generateCellCodes(params) : [] };
}

/** Число с пробелами между тысячами. Бесконечность и совсем огромные значения — словами, а не «1e+300». */
export function formatBigCount(n: number): string {
  if (!Number.isFinite(n) || n >= 1e9) return 'слишком много';
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** Начало и конец списка кодов для строки предпросмотра: «A-1-1, A-1-2, A-1-3 … C-3-4». */
export function formatCodesSample(codes: string[], head = 3): string {
  if (codes.length <= head + 1) return codes.join(', ');
  return `${codes.slice(0, head).join(', ')} … ${codes[codes.length - 1]}`;
}

/** Итог `POST /storage-cells/bulk` одной фразой: «Создано 6 ячеек. Уже были: A-1-1, A-1-2». */
export function bulkResultMessage(created: number, skipped: string[]): string {
  const head = created > 0 ? `Создано: ${cellsCountText(created)}.` : 'Новых ячеек не создано.';
  if (skipped.length === 0) return head;
  const shown = skipped.slice(0, 5).join(', ');
  const rest = skipped.length > 5 ? ` и ещё ${skipped.length - 5}` : '';
  return `${head} Уже были на складе (${skipped.length}): ${shown}${rest}.`;
}
