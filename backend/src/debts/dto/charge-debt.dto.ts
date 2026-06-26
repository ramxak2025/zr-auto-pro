import { IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

/** Write DTO for POST /debts/charge — client owes more (долг вырос). */
export class ChargeDebtDto {
  @IsUUID(undefined, { message: 'Некорректный клиент' })
  clientId!: string;

  /** Positive money amount of this charge. */
  @IsNumber({}, { message: 'Сумма должна быть числом' })
  @Min(0.01, { message: 'Сумма долга должна быть положительной' })
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'Причина слишком длинная' })
  reason?: string;

  /** Optional soft link to the originating check. */
  @IsOptional()
  @IsUUID(undefined, { message: 'Некорректный чек' })
  checkId?: string;
}
