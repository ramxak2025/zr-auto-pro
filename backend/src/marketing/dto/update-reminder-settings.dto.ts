import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/** Write DTO for POST /marketing/reminders (per-tenant reminder settings). */
export class UpdateReminderSettingsDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt({ message: 'Интервал должен быть числом' })
  @Min(1)
  @Max(120)
  monthsInterval?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'Шаблон сообщения слишком длинный' })
  messageTemplate?: string;
}
