import { IsArray, IsIn, IsNumber, IsOptional, IsUUID, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

/** One line being received in a receive operation. */
export class ReceivePurchaseOrderItemDto {
  /** purchase_order_items.id of the line being received. */
  @IsUUID('4', { message: 'Некорректная позиция' })
  itemId!: string;

  /**
   * Quantity received in THIS operation (a delta, not a cumulative total).
   * Added to the line's received_quantity and credited to product stock.
   */
  @IsNumber({ maxDecimalPlaces: 4 }, { message: 'Некорректное количество' })
  @Min(0.0001, { message: 'Количество должно быть положительным' })
  receivedQuantity!: number;

  /**
   * Actual purchase price (закупочная цена) for this line at receiving. Optional
   * — when omitted the ordered cost_price snapshot is used. Drives BOTH the
   * product cost basis update and the supply invoice total. Only honoured when
   * `paymentMode` is present on the body (the new supply flow); legacy receives
   * without `paymentMode` ignore it and stay stock-only.
   */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Некорректная цена закупки' })
  @Min(0, { message: 'Цена закупки не может быть отрицательной' })
  purchasePrice?: number;
}

/**
 * Write DTO for POST /purchase-orders/:id/receive.
 *
 * Omit `items` entirely to receive the FULL outstanding quantity of every line
 * (quantity − received_quantity). Provide `items` to receive specific lines /
 * partial amounts.
 *
 * `paymentMode` opts the receive into the FULL supply cycle (owner spec v1):
 * the receipt becomes a SUPPLY (a deliveries row linked to the order), each
 * line's purchase price updates the product cost basis, and the invoice total
 * either becomes supplier DEBT (`'debt'` / «Без оплаты») or is auto-paid
 * (`'paid'` / «Оплатить сразу»). When `paymentMode` is omitted the endpoint
 * keeps its legacy behaviour: stock income only — no supply, debt, payment or
 * cost-basis change (backward compatible).
 */
export class ReceivePurchaseOrderDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceivePurchaseOrderItemDto)
  items?: ReceivePurchaseOrderItemDto[];

  @IsOptional()
  @IsIn(['debt', 'paid'], { message: 'Некорректный режим оплаты' })
  paymentMode?: 'debt' | 'paid';
}
