import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
  IsUUID,
  Max,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Rounding rule applied AFTER the percent change, to make prices "nice".
 *   • mode='none' → plain round to 2 decimals.
 *   • mode='up'   → ceil to `step`  (156, step 50 → 200).
 *   • mode='down' → floor to `step` (156, step 50 → 150).
 * `step` must be > 0; it is ignored when mode='none'.
 */
export class BulkAdjustRoundingDto {
  @IsIn(['none', 'up', 'down'], { message: 'Некорректный режим округления' })
  mode!: 'none' | 'up' | 'down';

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Некорректный шаг округления' })
  @IsPositive({ message: 'Шаг округления должен быть больше нуля' })
  @Max(1000000, { message: 'Слишком большой шаг округления' })
  step!: number;
}

/**
 * POST /products/bulk-adjust-price — mass sell-price change (raise / lower by a
 * percent, optional rounding). Owner-class only (see controller @Roles). This
 * only ever touches `sell_price`; cost_price / stock / anything else is left
 * alone. `dryRun` returns a «было → стало» preview WITHOUT writing.
 */
export class BulkAdjustPriceDto {
  /** Which products to touch. */
  @IsIn(['all', 'categories', 'products'], { message: 'Некорректная область применения' })
  scope!: 'all' | 'categories' | 'products';

  /** warehouse_categories ids (scope='categories'). Descendants are included. */
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true, message: 'Некорректная папка' })
  categoryIds?: string[];

  /** products ids (scope='products'). */
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true, message: 'Некорректный товар' })
  productIds?: string[];

  /** Raise or lower the sell price. */
  @IsIn(['increase', 'decrease'], { message: 'Некорректное направление' })
  direction!: 'increase' | 'decrease';

  /** Percent to change by (>0, ≤1000). 10 = ±10%. */
  @IsNumber({ maxDecimalPlaces: 4 }, { message: 'Некорректный процент' })
  @IsPositive({ message: 'Процент должен быть больше нуля' })
  @Max(1000, { message: 'Процент слишком большой' })
  percent!: number;

  /** Optional rounding rule applied after the percent change. */
  @IsOptional()
  @ValidateNested()
  @Type(() => BulkAdjustRoundingDto)
  rounding?: BulkAdjustRoundingDto;

  /** true → preview only (no write); false / omitted → apply. */
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}
