import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Owner-class partial update of the per-tenant telephony (VPBX) config.
 *
 * SECURITY: `apiKey` and `apiSalt` are raw Mango secrets. They are accepted here
 * (write-only) and stored as-is, but are NEVER returned to any client — the read
 * endpoint masks them. The service overwrites a stored secret ONLY when a NON-EMPTY
 * string is sent, so re-saving the form (which shows a mask, not the real value)
 * does not wipe an existing secret.
 */
export class UpdateTelephonySettingsDto {
  @IsOptional()
  @IsIn(['mango'], { message: 'Неизвестный провайдер телефонии' })
  provider?: 'mango';

  @IsOptional()
  @IsBoolean({ message: 'enabled должно быть булевым' })
  enabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(255, { message: 'API-ключ слишком длинный' })
  apiKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255, { message: 'Соль слишком длинная' })
  apiSalt?: string;
}
