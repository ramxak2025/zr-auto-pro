import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/** Одна строка ПОЛНОГО нового набора позиций поставки (154). */
export class UpdateDeliveryItemInputDto {
  @IsUUID('4', { message: 'Некорректный товар' })
  productId!: string;

  @IsNumber({ maxDecimalPlaces: 4 }, { message: 'Некорректное количество' })
  @Min(0.0001, { message: 'Количество должно быть положительным' })
  quantity!: number;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Некорректная цена' })
  @Min(0, { message: 'Цена не может быть отрицательной' })
  price!: number;
}

/**
 * Write DTO для PATCH /suppliers/deliveries/:id — корректировка поставки (154).
 * Все поля опциональны; `items` (если передан) ЗАМЕНЯЕТ весь набор строк —
 * сервер считает дельты к текущим и двигает остатки корректирующими
 * stock_movements, долг поставщику — на Δ суммы.
 */
export class UpdateDeliveryDto {
  @IsOptional()
  @IsDateString({}, { message: 'Некорректная дата' })
  date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'Комментарий слишком длинный' })
  comment?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'Добавьте хотя бы одну позицию' })
  @ValidateNested({ each: true })
  @Type(() => UpdateDeliveryItemInputDto)
  items?: UpdateDeliveryItemInputDto[];
}
