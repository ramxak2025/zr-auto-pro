/** Parses a user-entered supplier-return quantity without silently changing it. */
export function parseReturnQuantity(value: string, max: number): number | null {
  const text = value.trim().replace(',', '.');
  if (!/^\d+(?:\.\d{1,3})?$/.test(text)) return null;
  const quantity = Number(text);
  if (!Number.isFinite(quantity) || quantity < 0 || quantity > max) return null;
  return quantity;
}

/** Backend rounds each receipt line to cents before summing the invoice. */
export function receiptLineCents(quantity: number, unitPrice: number): number {
  return Math.round(quantity * unitPrice * 100);
}

export function sumReceiptLineCents(lines: ReadonlyArray<{ quantity: number; unitPrice: number }>): number {
  return lines.reduce((sum, line) => sum + receiptLineCents(line.quantity, line.unitPrice), 0);
}
