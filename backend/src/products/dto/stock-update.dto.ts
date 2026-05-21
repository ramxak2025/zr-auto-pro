import { IsString, IsNumber, IsOptional, IsIn, IsBoolean } from 'class-validator';

export class StockUpdateDto {
  // Per-product stock endpoint stays on the simple 4-type set. Compound
  // operations (defect/used transfer + supplier return) go through the
  // dedicated /stock-movements endpoint so the body shape stays predictable.
  @IsString()
  @IsIn(['income', 'expense', 'writeoff', 'inventory'])
  type!: string;

  @IsNumber()
  quantity!: number;

  @IsString()
  @IsOptional()
  reason?: string;

  @IsOptional()
  @IsBoolean()
  recordAsExpense?: boolean;
}
