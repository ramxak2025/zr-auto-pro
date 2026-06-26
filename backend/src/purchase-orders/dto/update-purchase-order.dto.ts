import { ArrayMinSize, IsArray, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { PurchaseOrderItemInputDto } from './create-purchase-order.dto';

/**
 * Write DTO for PATCH /purchase-orders/:id. Editing is only allowed while the
 * order is still a `draft`; every field is optional (partial edit). When `items`
 * is present it REPLACES the whole line set (and total is recomputed).
 */
export class UpdatePurchaseOrderDto {
  @IsOptional()
  @IsUUID('4', { message: 'Некорректный поставщик' })
  supplierId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'Комментарий слишком длинный' })
  note?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'Добавьте хотя бы одну позицию' })
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderItemInputDto)
  items?: PurchaseOrderItemInputDto[];
}
