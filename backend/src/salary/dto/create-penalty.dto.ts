import { IsString, IsNotEmpty, IsNumber, IsOptional, IsPositive, MaxLength, IsDateString } from 'class-validator';

/**
 * Penalty / fine (штраф) applied to an employee — a monetary deduction with a
 * MANDATORY reason. Subtracted from the employee's remaining owed salary in the
 * period aggregation. Issued by director / superadmin only (владелец).
 *
 * The owner requires the reason («за что») to always be present: `description`
 * is REQUIRED here and NOT NULL + non-blank at the DB level
 * (100_salary_payouts_and_fines). The shared contract exposes this field as
 * `comment` via `createFine`.
 */
export class CreatePenaltyDto {
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @IsNumber()
  @IsPositive()
  amount!: number;

  /** Reason «за что» — MANDATORY (non-empty). Stored as salary_penalties.description. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  description!: string;

  /** ISO date/time. Defaults to now() server-side when omitted. */
  @IsOptional()
  @IsDateString()
  date?: string;
}
