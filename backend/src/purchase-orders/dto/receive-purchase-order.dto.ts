import { IsArray, IsNumber, IsOptional, IsUUID, Min, ValidateNested } from 'class-validator';
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
}

/**
 * Write DTO for POST /purchase-orders/:id/receive.
 *
 * Omit `items` entirely to receive the FULL outstanding quantity of every line
 * (quantity − received_quantity). Provide `items` to receive specific lines /
 * partial amounts.
 */
export class ReceivePurchaseOrderDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceivePurchaseOrderItemDto)
  items?: ReceivePurchaseOrderItemDto[];
}
