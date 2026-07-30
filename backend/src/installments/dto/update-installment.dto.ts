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

  /**
   * Причина ЯВНОГО переноса даты (Round 13 #7) — пишется в
   * installment_reschedules рядом со «старая → новая». Учитывается только когда
   * в этом же PATCH пришла nextPaymentDate; сама по себе план не меняет.
   * Опциональна — старые клиенты (nextPaymentDate/comment без причины)
   * продолжают работать как раньше.
   */
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Причина переноса слишком длинная' })
  rescheduleReason?: string;
}
