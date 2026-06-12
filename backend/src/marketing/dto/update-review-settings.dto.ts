import { IsBoolean, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

/**
 * Write DTO for PATCH /marketing/settings. Every field is optional — the
 * service COALESCEs missing values against the stored row, and clients send
 * partial updates (mobile sends only `motivationMessage`).
 */
export class UpdateReviewSettingsDto {
  // <input type="time"> shape: HH:MM (seconds tolerated).
  @IsOptional()
  @Matches(/^\d{1,2}:\d{2}(:\d{2})?$/, { message: 'Некорректное время отправки' })
  sendTime?: string;

  @IsOptional()
  @IsInt({ message: 'Задержка должна быть числом' })
  @Min(0)
  @Max(720)
  feedbackDelayHours?: number;

  @IsOptional()
  @IsBoolean()
  autoSendEnabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'Шаблон сообщения слишком длинный' })
  messageTemplate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'Текст мотивации слишком длинный' })
  motivationMessage?: string;
}
