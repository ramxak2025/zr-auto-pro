import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

// Mirrors the CHECK constraint on messaging_integrations.provider_type
// (007 + 008 migrations).
export const PROVIDER_TYPES = ['whatsapp', 'sms', 'smsru', 'moizvonki', 'email'] as const;

/**
 * Write DTO for POST /marketing/integrations. Before this DTO the endpoint
 * took `any`, so the global ValidationPipe whitelist had nothing to strip —
 * arbitrary keys and unbounded payloads reached the service layer.
 */
export class UpsertIntegrationDto {
  @IsOptional()
  @IsUUID('4', { message: 'Некорректный идентификатор интеграции' })
  id?: string;

  @IsIn(PROVIDER_TYPES, { message: 'Неизвестный тип провайдера' })
  providerType!: string;

  /**
   * Either the real API key or the sentinel `'_existing_'` — clients send the
   * sentinel when editing an integration without re-entering the key, and
   * MarketingService.upsertIntegration resolves it to the stored value.
   * Any future validation here must keep accepting that sentinel.
   */
  @IsString({ message: 'API ключ должен быть строкой' })
  @MaxLength(500, { message: 'API ключ слишком длинный' })
  apiKey!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120, { message: 'Имя отправителя слишком длинное' })
  senderName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32, { message: 'Телефон отправителя слишком длинный' })
  senderPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Webhook URL слишком длинный' })
  webhookUrl?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
