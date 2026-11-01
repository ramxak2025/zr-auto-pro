import { assertInventoryFeature } from '../common/inventory-features';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { InvoiceResult } from './invoice-parser';

/** Caller owns the supplier receipt transaction and must link before committing. */
export async function lockInvoiceReceipt(
  client: PoolClient,
  tenantId: string,
  pointId: string | null,
  documentId: string,
  supplierId: string,
  expectedVersion: number | undefined,
  lineIds: string[] | undefined,
  items: Array<{ productId: string }>,
  orderId?: string,
) {
  assertInventoryFeature(tenantId);
  const { rows } = await client.query(
    `SELECT version,status,result,delivery_id,supplier_id,purchase_order_id FROM supplier_invoice_documents
    WHERE id=$1 AND tenant_id=$2 AND ($3::uuid IS NULL OR point_id=$3) FOR UPDATE`,
    [documentId, tenantId, pointId],
  );
  if (!rows.length) throw new BadRequestException('Накладная не найдена');
  const row = rows[0];
  if ((row.purchase_order_id ?? null) !== (orderId ?? null))
    throw new BadRequestException('Накладную нужно принять через связанный заказ');
  if (row.supplier_id !== supplierId) throw new BadRequestException('Поставщик накладной не совпадает');
  if (row.delivery_id || row.status === 'confirmed')
    throw new ConflictException({ code: 'INVOICE_ALREADY_RECEIVED', message: 'Эта накладная уже принята' });
  if (row.status !== 'review' || row.version !== expectedVersion)
    throw new ConflictException({
      code: 'INVOICE_VERSION_CONFLICT',
      message: 'Накладная изменилась. Обновите проверку строк',
    });
  const result = row.result as InvoiceResult;
  if (
    !lineIds ||
    !result.lines.length ||
    lineIds.length !== result.lines.length ||
    items.length !== lineIds.length ||
    new Set(lineIds).size !== lineIds.length
  ) {
    throw new BadRequestException('Проверьте все строки накладной');
  }
  for (const [index, id] of lineIds.entries()) {
    const line = result.lines.find((line) => line.id === id);
    if (!line?.productId || line.productId !== items[index].productId)
      throw new BadRequestException('Подтвердите соответствие каждого товара');
  }
}

export async function linkInvoiceReceipt(
  client: PoolClient,
  tenantId: string,
  documentId: string,
  deliveryId: string,
  documentDate?: string,
) {
  await client.query(
    `UPDATE supplier_invoice_documents SET delivery_id=$3,document_date=$4::date,status='confirmed',version=version+1,updated_at=now()
    WHERE id=$1 AND tenant_id=$2 AND delivery_id IS NULL`,
    [documentId, tenantId, deliveryId, documentDate ?? null],
  );
}
