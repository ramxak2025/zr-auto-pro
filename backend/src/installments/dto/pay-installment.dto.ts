import { IsNumber, IsOptional, IsString, MaxLength, Min, IsDateString } from 'class-validator';

/** Write DTO for POST /installments/:planId/pay — record a partial repayment. */
export class PayInstallmentDto {
  /** Positive money amount of this payment. */
  @IsNumber({}, { message: 'Сумма должна быть числом' })
  @Min(0.01, { message: 'Сумма платежа должна быть положительной' })
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'Комментарий слишком длинный' })
  comment?: string;

  /** Optionally move the next-payment date forward when recording this payment. */
  @IsOptional()
  @IsDateString({}, { message: 'Некорректная дата следующего платежа' })
  nextPaymentDate?: string;
}
