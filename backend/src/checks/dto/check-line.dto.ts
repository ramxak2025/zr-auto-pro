import { Type } from 'class-transformer';
import { IsBoolean, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * Money-field validation for POST/PATCH /checks (audit round 7, item 2).
 *
 * Design constraints (LIVE tenant — must never reject a legitimate payload):
 *   • Every field either client (web CheckCreatePage / mobile CheckCreateScreen)
 *     actually sends is declared here; the global ValidationPipe runs with
 *     `whitelist: true`, so an UNDECLARED field would be silently stripped —
 *     e.g. web's derived per-line `total`/`totalSell`/`totalCost` are dropped
 *     (the backend always recomputed them anyway) while `installment{...}` and
 *     the flat `installmentNextPaymentDate`/`installmentComment` variants pass.
 *   • forbidNonWhitelisted stays OFF (unknown extras are stripped, not 400s).
 *   • `@Type(() => Number)` keeps tolerating numeric strings ("100" → 100) the
 *     way the old untyped path did via JS coercion; real garbage ("abc" → NaN)
 *     now fails as a clean 400 instead of a NUMERIC insert 500.
 *   • IDs are plain strings (web legitimately sends '' for "no client" —
 *     @IsUUID would reject it); required-ness of masterId/lines stays enforced
 *     in ChecksService with its existing friendly Russian messages.
 */

/** Upper bound for any single money/quantity/mileage value: 10 million. */
export const MONEY_MAX = 10_000_000;

export class CheckServiceLineDto {
  @IsOptional()
  @IsString()
  serviceId?: string;

  @IsOptional()
  @IsString()
  masterId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  name?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(MONEY_MAX)
  price?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(MONEY_MAX)
  quantity?: number;
}

export class CheckProductLineDto {
  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  name?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(MONEY_MAX)
  sellPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(MONEY_MAX)
  costPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(MONEY_MAX)
  quantity?: number;
}

/** Nested рассрочка block (mobile sends `installment: { nextPaymentDate }`). */
export class CheckInstallmentDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  nextPaymentDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}

/**
 * Field set shared by create and update. Everything optional here — create()
 * / update() keep their existing service-level required checks («Мастер
 * обязателен», «Добавьте хотя бы одну услугу или товар») with friendly 400s.
 */
export class BaseCheckDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  date?: string;

  @IsOptional()
  @IsString()
  masterId?: string;

  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsString()
  carId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(MONEY_MAX)
  mileage?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(MONEY_MAX)
  discount?: number;

  @IsOptional()
  @IsBoolean()
  isDeferred?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  paymentMethod?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(MONEY_MAX)
  cashAmount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(MONEY_MAX)
  cardAmount?: number;
}
