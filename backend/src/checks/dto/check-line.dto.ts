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
 *   • Every message is RUSSIAN — HttpExceptionFilter flattens class-validator
 *     arrays to msg[0] and shows it to the master verbatim (a live master hit
 *     the raw English «mileage must not be greater than 10000000»).
 */

/** Upper bound for any single money/quantity/mileage value: 10 million. */
export const MONEY_MAX = 10_000_000;
const MAX_TXT = '10 000 000';

/** Decorator option packs — one Russian message per (label, rule). */
const num = (label: string) => ({ message: `${label}: введите число` });
/**
 * Количество ТОВАРА: дробное разрешено (шланг метровый → 0.5), но не глубже
 * 3 знаков после запятой — ровно как NUMERIC(12,3) в
 * 120_fractional_quantities.sql. Старые клиенты шлют целые — проходят как
 * раньше. Количество УСЛУГИ — только целое (см. CheckServiceLineDto):
 * колонка check_service_lines.quantity осталась INT, дробь упала бы 500-кой
 * на insert'е.
 */
const qty = (label: string) => ({ message: `${label}: введите число (до 3 знаков после запятой)` });
const min0 = (label: string) => ({ message: `${label}: значение не может быть отрицательным` });
const maxM = (label: string) => ({ message: `${label}: не больше ${MAX_TXT}` });
const maxLen = (label: string, n: number) => ({ message: `${label}: слишком длинный текст (максимум ${n} символов)` });

export class CheckServiceLineDto {
  @IsOptional()
  @IsString()
  serviceId?: string;

  @IsOptional()
  @IsString()
  masterId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000, maxLen('Название услуги', 2000))
  name?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, num('Цена услуги'))
  @Min(0, min0('Цена услуги'))
  @Max(MONEY_MAX, maxM('Цена услуги'))
  price?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 0 }, { message: 'Количество услуги: введите целое число' })
  @Min(0, min0('Количество услуги'))
  @Max(MONEY_MAX, maxM('Количество услуги'))
  quantity?: number;
}

export class CheckProductLineDto {
  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000, maxLen('Название товара', 2000))
  name?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, num('Цена товара'))
  @Min(0, min0('Цена товара'))
  @Max(MONEY_MAX, maxM('Цена товара'))
  sellPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, num('Закупочная цена'))
  @Min(0, min0('Закупочная цена'))
  @Max(MONEY_MAX, maxM('Закупочная цена'))
  costPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 }, qty('Количество товара'))
  @Min(0, min0('Количество товара'))
  @Max(MONEY_MAX, maxM('Количество товара'))
  quantity?: number;
}

/** Nested рассрочка block (mobile sends `installment: { nextPaymentDate }`). */
export class CheckInstallmentDto {
  @IsOptional()
  @IsString()
  @MaxLength(64, maxLen('Дата платежа рассрочки', 64))
  nextPaymentDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000, maxLen('Комментарий рассрочки', 2000))
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
  @MaxLength(64, maxLen('Дата', 64))
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
  @IsNumber({}, num('Пробег'))
  @Min(0, min0('Пробег'))
  @Max(MONEY_MAX, { message: `Пробег: не больше ${MAX_TXT} км — проверьте, нет ли лишних цифр` })
  mileage?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000, maxLen('Комментарий', 2000))
  comment?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, num('Скидка'))
  @Min(0, min0('Скидка'))
  @Max(MONEY_MAX, maxM('Скидка'))
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
  @IsNumber({}, num('Сумма наличными'))
  @Min(0, min0('Сумма наличными'))
  @Max(MONEY_MAX, maxM('Сумма наличными'))
  cashAmount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, num('Сумма картой'))
  @Min(0, min0('Сумма картой'))
  @Max(MONEY_MAX, maxM('Сумма картой'))
  cardAmount?: number;
}
