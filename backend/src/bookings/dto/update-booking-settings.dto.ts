import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/** Write DTO for PATCH /bookings/settings (per-tenant booking settings). */
export class UpdateBookingSettingsDto {
  @IsOptional()
  @IsBoolean()
  notifyClientOnCreate?: boolean;

  @IsOptional()
  @IsBoolean()
  reminderEnabled?: boolean;

  @IsOptional()
  @IsInt({ message: 'Часы напоминания должны быть числом' })
  @Min(1)
  @Max(168)
  reminderHours?: number;

  @IsOptional()
  @IsString()
  @IsIn(['auto', 'sms', 'whatsapp'], { message: 'Некорректный канал' })
  channel?: string;
}
