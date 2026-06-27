import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Owner-class partial update of the per-tenant Apple Wallet config.
 *
 * SECURITY: `certPem`, `certKeyPem`, `certKeyPassword` and `wwdrPem` are the raw
 * signing material. They are accepted here (write-only) and stored as-is, but they
 * are NEVER returned to any client — the read endpoint returns only boolean "stored"
 * flags. Like the payments/fiscal secrets, each is overwritten ONLY when a NON-EMPTY
 * string is sent, so re-saving the form (which shows a flag, not the real PEM) never
 * wipes an already-stored certificate or key.
 *
 * The semi-public fields (passTypeId, teamId, organizationName, logoUrl, bgColor)
 * are plain config: sending an empty string clears them, sending a value sets them.
 */
export class UpdateWalletSettingsDto {
  @IsOptional()
  @IsBoolean({ message: 'enabled должно быть булевым' })
  enabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(255, { message: 'passTypeId слишком длинный' })
  passTypeId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64, { message: 'teamId слишком длинный' })
  teamId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255, { message: 'Название организации слишком длинное' })
  organizationName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1024, { message: 'logoUrl слишком длинный' })
  logoUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32, { message: 'Цвет слишком длинный' })
  bgColor?: string;

  // ── Signing material (write-only; never echoed back) ──────────────────────
  @IsOptional()
  @IsString()
  @MaxLength(100000, { message: 'Сертификат слишком большой' })
  certPem?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100000, { message: 'Ключ слишком большой' })
  certKeyPem?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255, { message: 'Пароль ключа слишком длинный' })
  certKeyPassword?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100000, { message: 'Сертификат WWDR слишком большой' })
  wwdrPem?: string;
}
