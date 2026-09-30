/**
 * Ячейки хранения (172): чистые хелперы без Nest/pg — их зовут и модуль ячеек, и
 * ProductsService (импорт CSV), и тест.
 */

/** Максимум кодов в одном POST /storage-cells/bulk и productIds в POST /products/bulk-assign-cell. */
export const MAX_BULK_CELLS = 2000;

/** Длиннее код — уже не «адрес»; заодно бережёт btree-индекс uq_storage_cells_wh_code от гигантских ключей. */
export const MAX_CELL_CODE_LENGTH = 64;

export const MAX_CELL_NAME_LENGTH = 200;

/**
 * Канонический вид кода ячейки: trim, любые пробельные символы в один пробел,
 * верхний регистр. Зеркало normalizeCellCode из shared/utils/storageCells.ts —
 * backend shared не импортирует, поэтому правила продублированы и ОБЯЗАНЫ совпадать
 * (иначе `skipped` из bulk и предпросмотр сетки на клиенте разойдутся).
 */
export function normalizeCellCode(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  return String(raw).replace(/\s+/g, ' ').trim().toUpperCase();
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuidString(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v.trim());
}
