import { IsInt, IsOptional, Max, Min, ValidateIf } from 'class-validator';

/**
 * PATCH /admin/settings body — глобальные настройки платформы (superadmin).
 * Все поля опциональны (PATCH-семантика, forward-compat под будущие ключи):
 * сервис обновляет только переданные. `globalFreeVoiceMinutes` — целое ≥ 0
 * (бесплатные минуты голосового ввода для ВСЕХ тенантов). Верхний потолок —
 * защита от опечатки/переполнения при `* 60`.
 *
 * 173 — `managerMaxFreeDays`: максимум дней ОДНОГО бесплатного (пробного)
 * продления, которое может выдать менеджер платформы (целое 1..365, дефолт 30).
 * Необязательность — только «поле не передано»: `null` (в отличие от IsOptional)
 * отклоняется, иначе сервис молча сбросил бы лимит к 30.
 */
export class UpdatePlatformSettingsDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  globalFreeVoiceMinutes?: number;

  @ValidateIf((body: UpdatePlatformSettingsDto) => body.managerMaxFreeDays !== undefined)
  @IsInt()
  @Min(1)
  @Max(365)
  managerMaxFreeDays?: number;
}
