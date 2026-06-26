import { IsBoolean, IsNumber, IsOptional, Max, Min } from 'class-validator';

/**
 * Write DTO for PATCH /loyalty/settings — partial update of the per-tenant
 * loyalty config. Every field is optional; only the provided ones are written.
 * Percentages are clamped to 0..100 (NUMERIC(5,2) on the column).
 */
export class UpdateLoyaltySettingsDto {
  @IsOptional()
  @IsBoolean({ message: 'enabled должно быть булевым' })
  enabled?: boolean;

  /** % of a check total credited as bonus on accrual. */
  @IsOptional()
  @IsNumber({}, { message: 'Процент начисления должен быть числом' })
  @Min(0, { message: 'Процент начисления не может быть отрицательным' })
  @Max(100, { message: 'Процент начисления не может превышать 100' })
  accrualPercent?: number;

  /** Max % of a single check payable with bonus on redemption. */
  @IsOptional()
  @IsNumber({}, { message: 'Лимит списания должен быть числом' })
  @Min(0, { message: 'Лимит списания не может быть отрицательным' })
  @Max(100, { message: 'Лимит списания не может превышать 100' })
  redeemMaxPercent?: number;
}
