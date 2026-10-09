import type { Service } from '../types';
import type { ServiceImportRow } from '../api/types';

const MAX_ROWS = 2000;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 20 * 1024 * 1024;

export function serviceWorkbookBytesFromBase64(value: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = value.replace(/[^A-Za-z0-9+/]/g, '');
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let output = 0;
  let buffer = 0;
  let bits = 0;
  for (const char of clean) {
    const digit = alphabet.indexOf(char);
    if (digit < 0) continue;
    buffer = (buffer << 6) | digit;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      if (output < bytes.length) bytes[output++] = (buffer >> bits) & 0xff;
    }
  }
  return bytes.subarray(0, output);
}

function headerKey(value: unknown): string {
  return String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase('ru-RU').replace(/[\s_./\\-]+/g, '');
}

function cellText(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function parseMoney(value: unknown): number | undefined {
  if (value == null || String(value).trim() === '') return undefined;
  const parsed = Number(String(value).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseOptionalNumber(value: unknown, column: string, sourceRow: number): number | undefined {
  if (value == null || String(value).trim() === '') return undefined;
  const parsed = parseMoney(value);
  if (parsed === undefined) throw new Error(`В строке ${sourceRow} поле «${column}» должно быть числом`);
  return parsed;
}

/** Parse a header-based sheet into the shared server-import shape. `sourceRow` is the Excel row number. */
export function parseServiceImportMatrix(matrix: unknown[][]): ServiceImportRow[] {
  if (matrix.length < 2) throw new Error('В файле нет строк услуг');
  if (matrix.length > MAX_ROWS + 1) throw new Error(`В одном файле допускается не более ${MAX_ROWS} строк`);
  const headers = matrix[0].map(headerKey);
  const find = (...names: string[]) => headers.findIndex((header) => names.includes(header));
  const columns = {
    id: find('id', 'idуслуги', 'идентификатор'),
    name: find('название', 'услуга', 'name'),
    category: find('категория', 'категорияпуть', 'category', 'папка'),
    type: find('типцены', 'pricetype'),
    price: find('цена', 'price', 'defaultprice'),
    min: find('от', 'минимум', 'минимальнаяцена', 'minprice'),
    max: find('до', 'максимум', 'максимальнаяцена', 'maxprice'),
    masterPercent: find('%мастера', 'процентмастера', 'masterpercent'),
    warrantyDays: find('гарантиядней', 'гарантия,дней', 'срокгарантии', 'warrantydays'),
  };
  if (columns.name < 0 || columns.type < 0 || (columns.price < 0 && (columns.min < 0 || columns.max < 0))) {
    throw new Error('Не найдены обязательные колонки: Название, Тип цены и Цена либо От/До');
  }
  const rows: ServiceImportRow[] = [];
  for (let index = 1; index < matrix.length; index++) {
    const cells = matrix[index];
    if (cells.every((cell) => cell == null || String(cell).trim() === '')) continue;
    const name = cellText(cells[columns.name]);
    const rawType = columns.type >= 0 ? headerKey(cells[columns.type]) : 'fixed';
    if (!['range', 'диапазон', 'fixed', 'фиксированная', 'фикс'].includes(rawType)) {
      throw new Error(`Неизвестный тип цены в строке ${index + 1}`);
    }
    const priceType: ServiceImportRow['priceType'] = rawType === 'range' || rawType === 'диапазон' ? 'range' : 'fixed';
    const price = columns.price >= 0 ? parseMoney(cells[columns.price]) : undefined;
    const minPrice = columns.min >= 0 ? parseMoney(cells[columns.min]) : undefined;
    const maxPrice = columns.max >= 0 ? parseMoney(cells[columns.max]) : undefined;
    if (priceType === 'fixed' && price === undefined) throw new Error(`В строке ${index + 1} не указана цена. Для нуля введите 0.`);
    if (priceType === 'range' && (minPrice === undefined || maxPrice === undefined)) {
      throw new Error(`В строке ${index + 1} заполните обе границы диапазона. Для нуля введите 0.`);
    }
    const masterPercent = columns.masterPercent >= 0 ? parseOptionalNumber(cells[columns.masterPercent], '% мастера', index + 1) : undefined;
    const warrantyDays = columns.warrantyDays >= 0 ? parseOptionalNumber(cells[columns.warrantyDays], 'гарантия, дней', index + 1) : undefined;
    rows.push({
      sourceRow: index + 1,
      ...(columns.id >= 0 && cellText(cells[columns.id]) ? { id: cellText(cells[columns.id]) } : {}),
      name,
      ...(columns.category >= 0 && cellText(cells[columns.category]) ? { category: cellText(cells[columns.category]) } : {}),
      priceType,
      ...(priceType === 'fixed'
        ? { defaultPrice: price }
        : { defaultPrice: minPrice, minPrice, maxPrice }),
      ...(columns.masterPercent < 0 ? {} : { masterPercent: masterPercent ?? null }),
      ...(columns.warrantyDays < 0 ? {} : { warrantyDays: warrantyDays ?? null }),
    });
  }
  return rows;
}

/** Stable column order used by both XLSX exports and the documented import template. */
export function serviceExportMatrix(services: Service[]): (string | number)[][] {
  return [
    ['ID', 'Название', 'Категория', 'Тип цены', 'Цена', 'От', 'До', '% мастера', 'Гарантия, дней'],
    ...services.map((service) => [
      service.id,
      service.name,
      service.category ?? '',
      service.priceType === 'range' ? 'Диапазон' : 'Фиксированная',
      service.priceType === 'range' ? (service.minPrice ?? service.defaultPrice) : service.defaultPrice,
      service.priceType === 'range' ? (service.minPrice ?? service.defaultPrice) : '',
      service.priceType === 'range' ? (service.maxPrice ?? service.defaultPrice) : '',
      service.masterPercent ?? '',
      service.warrantyDays ?? '',
    ]),
  ];
}

/** Bound the compressed and expanded size before SheetJS inflates an XLSX archive. */
export function assertServiceWorkbookSafe(bytes: Uint8Array): void {
  if (bytes.byteLength > MAX_FILE_BYTES) throw new Error('Файл больше 5 МБ');
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const floor = Math.max(0, bytes.length - 65_557);
  let endRecord = -1;
  for (let offset = bytes.length - 22; offset >= floor; offset--) {
    if (view.getUint32(offset, true) === 0x06054b50) { endRecord = offset; break; }
  }
  if (endRecord < 0) throw new Error('Не удалось проверить структуру XLSX-файла');
  const entryCount = view.getUint16(endRecord + 10, true);
  let offset = view.getUint32(endRecord + 16, true);
  let expanded = 0;
  for (let entry = 0; entry < entryCount; entry++) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) throw new Error('Повреждён архив XLSX');
    const uncompressed = view.getUint32(offset + 24, true);
    if (uncompressed === 0xffffffff) throw new Error('XLSX-файл ZIP64 слишком велик');
    expanded += uncompressed;
    if (expanded > MAX_UNCOMPRESSED_BYTES) throw new Error('Распакованный размер XLSX больше 20 МБ');
    offset += 46 + view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
  }
}

/** Refuse formula cells so cached values are never mistaken for their computed results. */
export function assertNoServiceWorkbookFormulas(sheets: Array<Record<string, { f?: unknown }>>): void {
  if (sheets.some((sheet) => Object.values(sheet).some((cell) => typeof cell?.f === 'string' && cell.f.length > 0))) {
    throw new Error('Формулы в файле услуг не поддерживаются. Замените их готовыми значениями.');
  }
}
