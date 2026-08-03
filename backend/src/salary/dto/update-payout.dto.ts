import { IsNumber, IsOptional, IsPositive, IsString, MaxLength } from 'class-validator';

/**
 * Round 15 (153) — правка PENDING-выплаты (сумма/комментарий). Принятую
 * выплату сервис отклоняет: её отменяют (cancel) и создают заново.
 */
export class UpdatePayoutDto {
  @IsOptional()
  @IsNumber()
  @IsPositive()
  amount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}
