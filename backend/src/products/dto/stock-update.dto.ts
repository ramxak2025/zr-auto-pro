import { IsString, IsNumber, IsOptional, IsIn, IsBoolean, Min } from 'class-validator';

export class StockUpdateDto {
  // Per-product stock endpoint stays on the simple 4-type set. Compound
  // operations (defect/used transfer + supplier return) go through the
  // dedicated /stock-movements endpoint so the body shape stays predictable.
  @IsString()
  @IsIn(['income', 'expense', 'writeoff', 'inventory'])
  type!: string;

  // Дробные количества (120): 0.5 м шланга — валидно; не глубже 3 знаков,
  // ровно как NUMERIC(12,3) у stock_movements.quantity.
  // @Min(0): отрицательное quantity раньше проходило и давало минусовой
  // остаток / скрытый приход через writeoff / отрицательный расход в expenses.
  // Ноль допустим только для inventory (сервис дожимает qty > 0 для остальных).
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  quantity!: number;

  @IsString()
  @IsOptional()
  reason?: string;

  @IsOptional()
  @IsBoolean()
  recordAsExpense?: boolean;
}
