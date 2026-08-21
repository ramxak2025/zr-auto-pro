import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, Max, Min, ValidateNested } from 'class-validator';
import { CheckInstallmentDto, MONEY_MAX } from './check-line.dto';

/**
 * PATCH /checks/:id/accept-payment (Round 14, роль-пресет «Кассир»).
 *
 * Узкий контракт «принять оплату по отложенному заказ-наряду» под правом
 * `accept_payment` — БЕЗ `checks_edit`. Пресет «Кассир» (CASHIER_ROLE_PRESET:
 * checks.edit='none') не проходит гейт `checks_edit` на PATCH /checks/:id,
 * поэтому единственное его денежное действие живёт на отдельном роуте.
 *
 * Тело — ТОЛЬКО поля закрытия (способ / ноги / скидка): ни строк, ни даты,
 * ни комментария, ни isDeferred — сервис сам жёстко подставляет
 * isDeferred:false и гонит запрос через тот же транзакционный
 * activateDeferred (нормализация ног, скидка «только на товары», склад,
 * гарантии, пуши) — контракт денег байт-в-байт с обычным закрытием.
 *
 * 155: + 'installment' — кассир продаёт в рассрочку при приёме оплаты (гейт
 * sell_installment в сервисе; ноги = первый взнос, остаток — план рассрочки в
 * той же транзакции активации). `installment` — параметры плана (дата
 * следующего платежа + комментарий). 'warranty' по-прежнему не входит.
 */
export class AcceptPaymentDto {
  @IsOptional()
  @IsIn(['cash', 'card', 'cash_card', 'installment'], {
    message: 'Способ оплаты: нал, карта, смешанная или рассрочка',
  })
  paymentMethod?: 'cash' | 'card' | 'cash_card' | 'installment';

  /** Только при paymentMethod='installment': параметры плана рассрочки. */
  @IsOptional()
  @ValidateNested()
  @Type(() => CheckInstallmentDto)
  installment?: CheckInstallmentDto;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'Сумма наличными: введите число' })
  @Min(0, { message: 'Сумма наличными: значение не может быть отрицательным' })
  @Max(MONEY_MAX, { message: 'Сумма наличными: не больше 10 000 000' })
  cashAmount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'Сумма картой: введите число' })
  @Min(0, { message: 'Сумма картой: значение не может быть отрицательным' })
  @Max(MONEY_MAX, { message: 'Сумма картой: не больше 10 000 000' })
  cardAmount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'Скидка: введите число' })
  @Min(0, { message: 'Скидка: значение не может быть отрицательным' })
  @Max(MONEY_MAX, { message: 'Скидка: не больше 10 000 000' })
  discount?: number;
}
