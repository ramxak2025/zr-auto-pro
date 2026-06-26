import { IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

/** Write DTO for POST /debts/payment — client repays (погашение долга). */
export class PaymentDebtDto {
  @IsUUID(undefined, { message: 'Некорректный клиент' })
  clientId!: string;

  /** Positive money amount of this repayment. */
  @IsNumber({}, { message: 'Сумма должна быть числом' })
  @Min(0.01, { message: 'Сумма оплаты должна быть положительной' })
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'Причина слишком длинная' })
  reason?: string;
}
