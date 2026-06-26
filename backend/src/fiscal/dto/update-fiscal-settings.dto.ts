import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Owner-class partial update of the per-tenant АТОЛ фискализация config.
 *
 * SECURITY: `password` is the raw АТОЛ API password. It is accepted here
 * (write-only) and stored as-is, but it is NEVER returned to any client — the read
 * endpoint masks it. The service overwrites the stored password ONLY when a
 * NON-EMPTY string is sent, so re-saving the form (which shows a mask, not the real
 * password) does not wipe an existing secret.
 */
export class UpdateFiscalSettingsDto {
  @IsOptional()
  @IsIn(['atol'], { message: 'Неизвестный провайдер фискализации' })
  provider?: 'atol';

  @IsOptional()
  @IsBoolean({ message: 'enabled должно быть булевым' })
  enabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(255, { message: 'login слишком длинный' })
  login?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255, { message: 'Пароль слишком длинный' })
  password?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255, { message: 'group_code слишком длинный' })
  groupCode?: string;

  @IsOptional()
  @IsIn(['osn', 'usn_income', 'usn_income_outcome', 'envd', 'esn', 'patent'], {
    message: 'Неизвестная система налогообложения',
  })
  sno?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20, { message: 'ИНН слишком длинный' })
  inn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255, { message: 'Адрес расчётов слишком длинный' })
  paymentAddress?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255, { message: 'Email слишком длинный' })
  companyEmail?: string;

  @IsOptional()
  @IsIn(['none', 'vat0', 'vat10', 'vat20', 'vat110', 'vat120'], { message: 'Неизвестная ставка НДС' })
  vat?: string;
}
