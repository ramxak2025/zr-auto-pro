import { IsIn, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

/** Write DTO for POST /payments/create. */
export class CreatePaymentDto {
  /** Amount in RUB (major units). Must be > 0. */
  @IsNumber({}, { message: 'Сумма должна быть числом' })
  @Min(0.01, { message: 'Сумма должна быть больше нуля' })
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(255, { message: 'Описание слишком длинное' })
  description?: string;

  /** 'sbp' → СБП-QR, 'card' → card redirect. Omit ⇒ provider default (card). */
  @IsOptional()
  @IsIn(['sbp', 'card'], { message: 'Неизвестный метод оплаты' })
  method?: 'sbp' | 'card';

  /** Optional link to the заказ-наряд this payment settles. */
  @IsOptional()
  @IsUUID('4', { message: 'Некорректный идентификатор чека' })
  checkId?: string;

  /** Where to send the client back after a card redirect (optional). */
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  returnUrl?: string;
}
