import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { BaseCheckDto, CheckInstallmentDto, CheckProductLineDto, CheckServiceLineDto } from './check-line.dto';

/**
 * POST /checks body (item 2). See check-line.dto.ts for the validation
 * philosophy (tolerant, whitelist-aware, money-bounded). Field inventory =
 * union of the web CheckCreatePage payload, the mobile CheckCreateScreen
 * payload and every `dto.*` read in ChecksService.create().
 */
export class CreateCheckDto extends BaseCheckDto {
  /**
   * Идемпотентность (офлайн-очередь, round 9): UUID, сгенерированный клиентом
   * один раз на логический чек и повторяемый с каждым ретраем. Сервер держит
   * максимум один чек на (tenant_id, clientRequestId) — уникальный индекс
   * uq_checks_client_request (миграция 111); повтор возвращает уже созданный
   * чек без побочных эффектов. Машинное поле (мастер его не вводит), поэтому
   * без русского сообщения; UUID-форма проверяется в ChecksService.create()
   * с дружелюбным 400.
   */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  clientRequestId?: string;

  /** Рассрочка (mobile shape): `installment: { nextPaymentDate, comment }`. */
  @IsOptional()
  @ValidateNested()
  @Type(() => CheckInstallmentDto)
  installment?: CheckInstallmentDto;

  /** Рассрочка (web flat shape). */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  installmentNextPaymentDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  installmentComment?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => CheckServiceLineDto)
  services?: CheckServiceLineDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => CheckProductLineDto)
  products?: CheckProductLineDto[];
}
