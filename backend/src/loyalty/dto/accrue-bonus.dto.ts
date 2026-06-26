import { IsNumber, IsOptional, IsUUID, Min } from 'class-validator';

/**
 * Write DTO for POST /loyalty/accrue — credit bonus to a client.
 *
 * Either `amount` is given explicitly, or `checkId` is given and the service
 * computes amount = round(checkTotal * accrualPercent / 100). At least one of
 * the two must be present (validated in the service). Accrual is a no-op / 422
 * when loyalty is disabled for the tenant.
 */
export class AccrueBonusDto {
  @IsUUID(undefined, { message: 'Некорректный клиент' })
  clientId!: string;

  /** Optional soft link to the originating check; also the basis for auto-amount. */
  @IsOptional()
  @IsUUID(undefined, { message: 'Некорректный чек' })
  checkId?: string;

  /** Explicit accrual amount. Omit to auto-compute from the linked check total. */
  @IsOptional()
  @IsNumber({}, { message: 'Сумма должна быть числом' })
  @Min(0.01, { message: 'Сумма начисления должна быть положительной' })
  amount?: number;
}
