import { IsString, IsNotEmpty, IsNumber, IsPositive, IsOptional, IsIn, MaxLength, Matches } from 'class-validator';
import { MONTH_KEY_RE } from '../../common/period-membership';

/**
 * Payout-with-confirmation (100_salary_payouts_and_fines). The owner
 * (director + superadmin) issues an arbitrary salary / advance amount to one
 * employee; it starts `pending` and the employee accepts or rejects it.
 * On accept an expense («Зарплата») is written; on reject nothing is recorded.
 */
export class CreatePayoutDto {
  @IsString()
  @IsNotEmpty()
  employeeId!: string;

  @IsString()
  @IsIn(['salary', 'advance'])
  type!: 'salary' | 'advance';

  @IsNumber()
  @IsPositive()
  amount!: number;

  /** Optional owner note (unlike a fine, a payout comment is NOT required). */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;

  /**
   * «За какой месяц» выплата ('YYYY-MM', месяц 01–12). Помесячная карточка,
   * экран «Зарплата», отчёты («По зарплатам», «Сводный», «По расходам») и P&L
   * относят выплату к этому месяцу; касса и «Движение денег» — по дате выдачи.
   * С 2026-09-30 месяц ВСЕГДА записывается: не передан — сервис подставит месяц
   * факта в часовом поясе автосервиса (в БД больше не NULL). Месяц, который ещё
   * не наступил, сервис отклоняет (400).
   */
  @IsOptional()
  @Matches(MONTH_KEY_RE, { message: 'periodMonth должен быть в формате YYYY-MM' })
  periodMonth?: string;
}
