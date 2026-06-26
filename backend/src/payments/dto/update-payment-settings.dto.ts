import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Owner-class partial update of the per-tenant acquiring config.
 *
 * SECURITY: `secretKey` is the raw ЮKassa secret. It is accepted here (write-only)
 * and stored as-is, but it is NEVER returned to any client — the read endpoint
 * masks it. The service only overwrites the stored key when a NON-EMPTY string is
 * sent, so re-saving the form (which shows a mask, not the real key) does not wipe
 * an existing secret.
 */
export class UpdatePaymentSettingsDto {
  @IsOptional()
  @IsIn(['yookassa', 'tinkoff'], { message: 'Неизвестный провайдер' })
  provider?: 'yookassa' | 'tinkoff';

  @IsOptional()
  @IsBoolean({ message: 'enabled должно быть булевым' })
  enabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(255, { message: 'shopId слишком длинный' })
  shopId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255, { message: 'Ключ слишком длинный' })
  secretKey?: string;
}
