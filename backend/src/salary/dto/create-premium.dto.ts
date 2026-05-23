import { IsString, IsNotEmpty, IsNumber, IsOptional, IsIn, MaxLength } from 'class-validator';

/**
 * Premium awarded by the owner. Either `amount` (for type='cash') or
 * `bonusPercent` (for type='rate_bonus') must be set; service validates
 * the conjunction.
 */
export class CreatePremiumDto {
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @IsString()
  @IsIn(['cash', 'rate_bonus'])
  type!: 'cash' | 'rate_bonus';

  @IsOptional()
  @IsNumber()
  amount?: number;

  @IsOptional()
  @IsNumber()
  bonusPercent?: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(7)
  periodMonthYear?: string;
}
