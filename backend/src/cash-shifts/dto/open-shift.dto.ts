import { IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/** Write DTO for POST /cash-shifts/open. */
export class OpenShiftDto {
  /**
   * Cash counted in the drawer at open (разменная касса / float). >= 0.
   * 155 — опционально: без поля сервис подставляет carryover_amount последней
   * закрытой смены (размен, оставленный при закрытии; 0, если смен ещё не было).
   */
  @IsOptional()
  @IsNumber({}, { message: 'Сумма должна быть числом' })
  @Min(0, { message: 'Сумма не может быть отрицательной' })
  openingAmount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'Примечание слишком длинное' })
  note?: string;
}
