import { IsString, IsIn } from 'class-validator';

/**
 * The employee's decision on a pending payout (100_salary_payouts_and_fines).
 * 'accept' → payout is recorded as paid and an expense is written; 'reject' →
 * the payout is voided and nothing is recorded.
 */
export class DecidePayoutDto {
  @IsString()
  @IsIn(['accept', 'reject'])
  decision!: 'accept' | 'reject';
}
