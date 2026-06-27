import { IsOptional, IsString, MaxLength, IsDateString } from 'class-validator';

/** Write DTO for PATCH /installments/:planId — reschedule / re-comment a plan. */
export class UpdateInstallmentDto {
  /** New next-payment date (reschedule). */
  @IsOptional()
  @IsDateString({}, { message: 'Некорректная дата следующего платежа' })
  nextPaymentDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'Комментарий слишком длинный' })
  comment?: string;
}
