import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * PATCH /admin/settings body — глобальные настройки платформы (superadmin).
 * Все поля опциональны (PATCH-семантика, forward-compat под будущие ключи):
 * сервис обновляет только переданные. `globalFreeVoiceMinutes` — целое ≥ 0
 * (бесплатные минуты голосового ввода для ВСЕХ тенантов). Верхний потолок —
 * защита от опечатки/переполнения при `* 60`.
 */
export class UpdatePlatformSettingsDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  globalFreeVoiceMinutes?: number;
}
