import { IsNumber, IsOptional, IsUUID, Min } from 'class-validator';

/**
 * Write DTO for POST /loyalty/redeem — spend bonus on a sale.
 *
 * `amount` is required and is validated server-side against the available
 * balance (never overdrawn) and, when `checkId` is given, against the per-check
 * redeem cap (checkTotal * redeemMaxPercent / 100).
 */
export class RedeemBonusDto {
  @IsUUID(undefined, { message: 'Некорректный клиент' })
  clientId!: string;

  /** Optional soft link to the check being paid; enables the per-check cap check. */
  @IsOptional()
  @IsUUID(undefined, { message: 'Некорректный чек' })
  checkId?: string;

  /** Positive bonus amount to spend. */
  @IsNumber({}, { message: 'Сумма должна быть числом' })
  @Min(0.01, { message: 'Сумма списания должна быть положительной' })
  amount!: number;
}
