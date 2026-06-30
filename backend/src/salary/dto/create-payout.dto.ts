import { IsString, IsNotEmpty, IsNumber, IsPositive, IsOptional, IsIn, MaxLength } from 'class-validator';

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
}
