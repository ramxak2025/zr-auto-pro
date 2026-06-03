import { IsString, IsNotEmpty, IsNumber, IsOptional, IsPositive, MaxLength, IsDateString } from 'class-validator';

/**
 * Penalty (штраф) applied to an employee — a monetary deduction with a
 * description. Subtracted from the employee's remaining owed salary in the
 * period aggregation. Managed by director / admin / superadmin only.
 */
export class CreatePenaltyDto {
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  /** ISO date/time. Defaults to now() server-side when omitted. */
  @IsOptional()
  @IsDateString()
  date?: string;
}
