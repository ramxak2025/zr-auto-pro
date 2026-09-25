import { IsBoolean, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * PATCH /vin/settings (company_manage) — зеркало UpdateVinSettingsRequest из
 * shared/types/index.ts.
 *
 *   • enabled     — опция «VIN-код автомобиля»;
 *   • provider    — id платного сервиса из VinSettings.providers, либо null
 *                   (только бесплатные источники);
 *   • credentials — объект «поле → значение» по `fields` провайдера: сохранить/
 *                   заменить; null — удалить сохранённые; undefined — не трогать.
 *
 * @IsOptional пропускает и undefined, и null, поэтому `provider: null` и
 * `credentials: null` проходят валидацию без отдельного ValidateIf. Состав
 * ключей credentials проверяет сервис по описанию провайдера (whitelist
 * ValidationPipe вложенные ключи Record не трогает).
 */
export class UpdateVinSettingsDto {
  @IsOptional()
  @IsBoolean({ message: 'enabled должно быть булевым' })
  enabled?: boolean;

  @IsOptional()
  @IsString({ message: 'Некорректный провайдер' })
  @MaxLength(64, { message: 'Некорректный провайдер' })
  provider?: string | null;

  @IsOptional()
  @IsObject({ message: 'credentials должен быть объектом' })
  credentials?: Record<string, string> | null;
}
