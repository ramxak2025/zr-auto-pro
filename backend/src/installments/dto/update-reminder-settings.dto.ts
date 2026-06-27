import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/** Write DTO for PATCH /installments/reminder-settings — owner-class. */
export class UpdateInstallmentReminderSettingsDto {
  /** 'off' | 'auto' | 'manual'. */
  @IsOptional()
  @IsIn(['off', 'auto', 'manual'], { message: 'Некорректный режим напоминаний' })
  mode?: 'off' | 'auto' | 'manual';

  /** Days before the next payment date to send a pre-reminder. */
  @IsOptional()
  @IsInt({ message: 'Количество дней должно быть целым числом' })
  @Min(0, { message: 'Количество дней не может быть отрицательным' })
  @Max(60, { message: 'Слишком большой интервал' })
  daysBefore?: number;

  @IsOptional()
  @IsBoolean()
  onDue?: boolean;

  @IsOptional()
  @IsBoolean()
  onOverdue?: boolean;

  /** Template with {clientName} / {amount} / {date} placeholders. */
  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'Шаблон слишком длинный' })
  template?: string;
}
