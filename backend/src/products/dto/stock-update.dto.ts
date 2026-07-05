import { IsString, IsNumber, IsOptional, IsIn, IsBoolean } from 'class-validator';

export class StockUpdateDto {
  // Per-product stock endpoint stays on the simple 4-type set. Compound
  // operations (defect/used transfer + supplier return) go through the
  // dedicated /stock-movements endpoint so the body shape stays predictable.
  @IsString()
  @IsIn(['income', 'expense', 'writeoff', 'inventory'])
  type!: string;

  // Дробные количества (120): 0.5 м шланга — валидно; не глубже 3 знаков,
  // ровно как NUMERIC(12,3) у stock_movements.quantity.
  @IsNumber({ maxDecimalPlaces: 3 })
  quantity!: number;

  @IsString()
  @IsOptional()
  reason?: string;

  @IsOptional()
  @IsBoolean()
  recordAsExpense?: boolean;
}
