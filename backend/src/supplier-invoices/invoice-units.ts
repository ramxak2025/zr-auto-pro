import { BadRequestException, ConflictException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { InvoiceResult } from './invoice-parser';

/** Presets + legacy catalog aliases. This compares units; it never converts quantity. */
export function normalizeInvoiceUnit(value: string | null | undefined): string {
  const unit = (value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[.\s]+/g, '');
  const aliases: Record<string, string> = {
    pcs: 'шт',
    pc: 'шт',
    piece: 'шт',
    pieces: 'шт',
    штука: 'шт',
    штуки: 'шт',
    штук: 'шт',
    m: 'м',
    метр: 'м',
    метры: 'м',
    метров: 'м',
    kg: 'кг',
    килограмм: 'кг',
    килограммы: 'кг',
    g: 'г',
    грамм: 'г',
    l: 'л',
    литр: 'л',
    литры: 'л',
    литров: 'л',
    ml: 'мл',
    миллилитр: 'мл',
    set: 'компл',
    комплект: 'компл',
    комплекты: 'компл',
    pack: 'уп',
    upak: 'уп',
    упак: 'уп',
    упаковка: 'уп',
    упаковки: 'уп',
  };
  return aliases[unit] ?? unit;
}

export interface InvoiceUnitConfirmation {
  unitConfirmed?: boolean;
  productUnit?: string;
}
/** Products are already locked by the existing receipt helper. */
export async function validateInvoiceUnitsTx(
  client: PoolClient,
  tenantId: string,
  documentId: string,
  lineIds: string[],
  items: Array<{ productId: string; quantity?: number; price?: number }>,
  confirmations: InvoiceUnitConfirmation[] | undefined,
) {
  const doc = (
    await client.query('SELECT result FROM supplier_invoice_documents WHERE id=$1 AND tenant_id=$2', [
      documentId,
      tenantId,
    ])
  ).rows[0];
  const result = doc?.result as InvoiceResult | undefined;
  if (!result) throw new BadRequestException('Накладная не найдена');
  const products = (
    await client.query(
      `SELECT p.id,p.unit,p.assembly_id,w.kind FROM products p LEFT JOIN warehouses w ON w.id=p.warehouse_id WHERE p.tenant_id=$1 AND p.id=ANY($2::uuid[])`,
      [tenantId, items.map((item) => item.productId)],
    )
  ).rows;
  for (const [index, item] of items.entries()) {
    const line = result.lines.find((line) => line.id === lineIds[index]);
    const product = products.find((product) => product.id === item.productId);
    if (!line || line.excluded || !product)
      throw new BadRequestException('Строка накладной исключена или товар не найден');
    if (product.assembly_id || product.kind === 'used')
      throw new BadRequestException('Товар Б/У и собранные комплекты не принимаются по накладной поставщика');
    const unit = product.unit || 'шт';
    const explicit = confirmations?.[index];
    const expected = explicit?.productUnit ?? line.productUnit;
    if (!expected || normalizeInvoiceUnit(expected) !== normalizeInvoiceUnit(unit))
      throw new ConflictException({
        code: 'INVOICE_PRODUCT_UNIT_CHANGED',
        message: 'Единица товара изменилась. Обновите сопоставление и количество',
      });
    const mismatch = !normalizeInvoiceUnit(line.unit) || normalizeInvoiceUnit(line.unit) !== normalizeInvoiceUnit(unit);
    if (mismatch && explicit?.unitConfirmed !== true && line.unitConfirmed !== true)
      throw new BadRequestException({
        code: 'INVOICE_UNIT_CONFIRMATION_REQUIRED',
        message: `Подтвердите количество и цену строки «${line.name}» в единицах каталога: ${unit}`,
      });
    line.productUnit = unit;
    line.unitMismatch = mismatch;
    line.unitConfirmed = true;
    if (item.quantity !== undefined) line.confirmedQuantity = Number(item.quantity);
    if (item.price !== undefined) line.confirmedPrice = Number(item.price);
  }
  await client.query('UPDATE supplier_invoice_documents SET result=$3 WHERE id=$1 AND tenant_id=$2', [
    documentId,
    tenantId,
    JSON.stringify(result),
  ]);
}
