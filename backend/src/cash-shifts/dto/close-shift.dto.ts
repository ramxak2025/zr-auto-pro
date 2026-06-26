import { IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/** Write DTO for POST /cash-shifts/:id/close. */
export class CloseShiftDto {
  /** Фактический нал, пересчитанный кассиром при закрытии смены. >= 0. */
  @IsNumber({}, { message: 'Сумма должна быть числом' })
  @Min(0, { message: 'Сумма не может быть отрицательной' })
  closingAmount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'Примечание слишком длинное' })
  note?: string;
}
