import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';

export interface InvoiceLine {
  origin?: 'ocr' | 'manual';
  excluded?: boolean;
  sourcePageIndex?: number;
  sourceRowIndex?: number;
  sourceTableIndex?: number;
  manualRequestId?: string;
  manualFingerprint?: string;
  id: string;
  name: string;
  sku: string;
  unit: string;
  quantity: number | null;
  price: number | null;
  productId: string | null;
  suggestedProductId: string | null;
  warnings: string[];
  quantityRaw?: string;
  priceRaw?: string;
  productUnit?: string;
  unitMismatch?: boolean;
  unitConfirmed?: boolean;
  confirmedQuantity?: number;
  confirmedPrice?: number;
}
export interface InvoiceResult {
  date: string | null;
  lines: InvoiceLine[];
  warnings: string[];
}
interface OcrCell {
  rowIndex: string;
  columnIndex: string;
  rowSpan?: string;
  columnSpan?: string;
  text: string;
  rawText?: string;
  confidence?: number;
  warnings?: string[];
}
export interface OcrAnnotation {
  warnings?: string[];
  fullText?: string;
  rotate?: string;
  tables?: Array<{ cells?: OcrCell[] }>;
}

export const normalizeAlias = (value: string) =>
  value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
export const invoiceAliasKey = (line: Pick<InvoiceLine, 'name' | 'sku'>) =>
  line.sku.trim() ? `sku:${normalizeAlias(line.sku)}` : `name:${normalizeAlias(line.name)}`;

/** Parse only a complete decimal cell, never extract a plausible substring. */
export function invoiceNumber(value: string, decimals: number, positive: boolean): number | null {
  const raw = value.trim().replace(/[\u00a0\u202f]/g, ' ');
  if (!new RegExp(`^(?:\\d+|\\d{1,3}(?: \\d{3})+)(?:[.,]\\d{1,${decimals}})?$`).test(raw)) return null;
  const normalized = raw.replace(/ /g, '').replace(',', '.');
  const number = Number(normalized);
  return Number.isFinite(number) && number <= 999999999 && (positive ? number > 0 : number >= 0) ? number : null;
}

export function parseInvoiceTables(pages: OcrAnnotation[]): InvoiceResult {
  const lines: InvoiceLine[] = [];
  const dates = new Set<string>();
  for (const [sourcePageIndex, page] of pages.entries()) {
    for (const match of (page.fullText ?? '').matchAll(/\b(\d{2})[./-](\d{2})[./-](\d{4})\b/g)) {
      const date = `${match[3]}-${match[2]}-${match[1]}`;
      const parsed = new Date(`${date}T00:00:00Z`);
      if (Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date) dates.add(date);
    }
    for (const [sourceTableIndex, table] of (page.tables ?? []).entries()) {
      const rows = new Map<number, Map<number, string>>();
      const evidence = new Map<string, OcrCell>();
      for (const cell of table.cells ?? []) {
        const row = Number(cell.rowIndex),
          col = Number(cell.columnIndex);
        if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || row > 1000 || col < 0 || col > 100) continue;
        if (!rows.has(row)) rows.set(row, new Map());
        rows.get(row)!.set(col, String(cell.text ?? '').slice(0, 2000));
        evidence.set(`${row}:${col}`, cell);
      }
      let header: { row: number; name: number; qty: number; price: number; unit: number; sku: number } | null = null;
      for (const [row, cells] of [...rows].sort((a, b) => a[0] - b[0])) {
        const columns = [...cells].map(([col, text]) => ({ col, text: normalizeAlias(text) }));
        const column = (pattern: RegExp) => columns.find((c) => pattern.test(c.text))?.col ?? -1;
        if (!header) {
          const name = column(/наимен|номенклат|название|товар|description/);
          const qty = column(/колич|кол во|quantity|qty/);
          const price = column(/^(?:цена|цен[аы] за|price|стоимость единиц|закупочная)/);
          if (name >= 0 && qty >= 0 && price >= 0)
            header = { row, name, qty, price, unit: column(/^(?:ед|единиц|unit)/), sku: column(/артикул|sku|^код/) };
          continue;
        }
        const name = (cells.get(header.name) ?? '').trim();
        if (!name || /^(?:итого|всего|total|наименование)(?:$|\s|:)/i.test(name)) continue;
        const quantity = invoiceNumber(cells.get(header.qty) ?? '', 3, true),
          price = invoiceNumber(cells.get(header.price) ?? '', 2, false);
        lines.push({
          origin: 'ocr',
          excluded: false,
          sourcePageIndex,
          sourceTableIndex,
          sourceRowIndex: row,
          id: randomUUID(),
          name,
          sku: (cells.get(header.sku) ?? '').trim(),
          unit: (cells.get(header.unit) ?? '').trim(),
          quantity,
          price,
          productId: null,
          suggestedProductId: null,
          quantityRaw: evidence.get(`${row}:${header.qty}`)?.rawText ?? cells.get(header.qty) ?? '',
          priceRaw: evidence.get(`${row}:${header.price}`)?.rawText ?? cells.get(header.price) ?? '',
          unitConfirmed: false,
          warnings: [
            ...new Set([
              ...(evidence.get(`${row}:${header.qty}`)?.warnings ?? []),
              ...(evidence.get(`${row}:${header.price}`)?.warnings ?? []),
            ]),
            ...(quantity === null ? ['Проверьте количество'] : []),
            ...(price === null ? ['Проверьте закупочную цену за единицу'] : []),
          ],
        });
        if (lines.length > 500)
          throw new BadRequestException({
            code: 'INVOICE_TOO_MANY_LINES',
            message: 'В накладной не должно быть больше 500 строк',
          });
      }
    }
  }
  return {
    date: dates.size === 1 ? [...dates][0] : null,
    lines,
    warnings: [
      ...new Set(
        pages.flatMap((page) =>
          Array.isArray(page.warnings)
            ? page.warnings
                .filter((value) => typeof value === 'string')
                .slice(0, 20)
                .map((value) => value.slice(0, 200))
            : [],
        ),
      ),
      ...(dates.size !== 1 ? ['Проверьте дату накладной'] : []),
      ...(!lines.length ? ['Не удалось надёжно определить таблицу товаров. Заполните поставку вручную'] : []),
      'Перед приёмкой проверьте каждую строку, количество и закупочную цену за единицу',
    ],
  };
}
