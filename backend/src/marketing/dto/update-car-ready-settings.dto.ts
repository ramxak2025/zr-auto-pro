import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Write DTO for PATCH /marketing/car-ready — the «машина готова» auto-notification
 * settings (car_ready_settings, migration 087). Both fields optional: the service
 * COALESCEs missing values against the stored row, so clients can send partial
 * updates (e.g. only the toggle).
 */
export class UpdateCarReadySettingsDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'Шаблон сообщения слишком длинный' })
  messageTemplate?: string;
}
