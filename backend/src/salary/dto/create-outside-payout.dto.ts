import { IsString, IsNotEmpty, IsNumber, IsPositive, IsOptional, Matches, MaxLength, IsISO8601 } from 'class-validator';
import { MONTH_KEY_RE } from '../../common/period-membership';

/**
 * Round 14 (149) — «Выплата вне программы»: выплата получателю БЕЗ аккаунта в
 * системе (маркетолог, уборщица) — свободное имя + сумма + ОБЯЗАТЕЛЬНЫЙ месяц
 * отнесения. Пишется approved-расходом под категорией «Выплаты вне программы»
 * (НЕ «Зарплата»): прибыль назначенного месяца уменьшается, касса — по дате
 * факта (`date`, дефолт «сейчас»).
 */
export class CreateOutsidePayoutDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  recipientName!: string;

  @IsNumber()
  @IsPositive()
  amount!: number;

  /** 'YYYY-MM' (месяц 01–12) — месяц, к которому относится выплата (обязателен). */
  @IsString()
  @Matches(MONTH_KEY_RE, { message: 'periodMonth должен быть в формате YYYY-MM' })
  periodMonth!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;

  /** Дата кассового факта (ISO). Отсутствует → сейчас. */
  @IsOptional()
  @IsISO8601()
  date?: string;
}
