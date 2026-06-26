import {
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/** One requested line on a new purchase order. */
export class PurchaseOrderItemInputDto {
  /** Existing product in the caller's tenant the line is for. */
  @IsUUID('4', { message: 'Некорректный товар' })
  productId!: string;

  /** Ordered quantity — must be positive. */
  @IsNumber({ maxDecimalPlaces: 4 }, { message: 'Некорректное количество' })
  @Min(0.0001, { message: 'Количество должно быть положительным' })
  quantity!: number;

  /** Per-unit purchase price (snapshotted onto the item). */
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Некорректная цена закупки' })
  @Min(0, { message: 'Цена закупки не может быть отрицательной' })
  costPrice!: number;
}

/** Write DTO for POST /purchase-orders → creates a `draft` order. */
export class CreatePurchaseOrderDto {
  /** Supplier the order is placed with — must exist in the caller's tenant. */
  @IsUUID('4', { message: 'Некорректный поставщик' })
  supplierId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'Комментарий слишком длинный' })
  note?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Добавьте хотя бы одну позицию' })
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderItemInputDto)
  items!: PurchaseOrderItemInputDto[];
}
