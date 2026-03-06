import { IsString, IsNotEmpty, IsNumber, IsOptional, IsIn } from 'class-validator';

export class StockUpdateDto {
  @IsString()
  @IsIn(['income', 'expense', 'writeoff', 'inventory'])
  type: string;

  @IsNumber()
  quantity: number;

  @IsString()
  @IsOptional()
  reason?: string;
}
