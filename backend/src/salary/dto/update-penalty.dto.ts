import { IsNumber, IsOptional, IsPositive, IsString, MaxLength } from 'class-validator';

/**
 * Round 15 (153) — правка штрафа (сумма/причина). Причина, если передана, не
 * может быть пустой (сервис дополнительно триммит и отклоняет blank — NOT NULL
 * + non-blank CHECK на БД, 100).
 */
export class UpdatePenaltyDto {
  @IsOptional()
  @IsNumber()
  @IsPositive()
  amount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
