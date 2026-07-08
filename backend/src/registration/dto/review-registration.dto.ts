import { IsInt, IsISO8601, IsOptional, IsPositive, IsString, Max, MaxLength } from 'class-validator';

/**
 * POST /admin/registration-requests/:id/approve body (superadmin).
 *
 * Trial length: default 14 days FREE if neither field is given. `until` (an
 * explicit future ISO date) WINS over `trialDays` when both are present — same
 * precedence as TenantsService.extend. Business rules ("until must be in the
 * future") are enforced in the service so the error message can be specific.
 */
export class ApproveRegistrationDto {
  /** Set the new tenant's subscription_end to this ISO date (must be future). Wins over trialDays. */
  @IsOptional()
  @IsISO8601()
  until?: string;

  /** Free-trial length in days (default 14). Capped at ~10 years to avoid date overflow. */
  @IsOptional()
  @IsInt()
  @IsPositive()
  @Max(3650)
  trialDays?: number;
}

/** POST /admin/registration-requests/:id/reject body (superadmin). */
export class RejectRegistrationDto {
  /** Optional human reason stored on the request + shown to the operator. */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
