import { IsInt, IsOptional, IsPositive, IsString, IsUUID, Max, MaxLength } from 'class-validator';

/** POST /tenants/:id/extend body — extend a subscription by N days. */
export class ExtendSubscriptionDto {
  @IsInt()
  @IsPositive()
  @Max(3650) // cap at ~10 years so a fat-fingered value can't overflow the date math
  days!: number;
}

/** POST /tenants/:id/assign-plan body — switch the tenant to a plan. */
export class AssignPlanDto {
  @IsString()
  @IsUUID()
  planId!: string;
}

/**
 * POST /tenants/:id/suspend body — explicitly suspend a tenant (superadmin).
 * `reason` is an optional human note stored on the tenant and surfaced in the
 * subscription/cabinet status. Unsuspend (POST /tenants/:id/unsuspend) takes no
 * body.
 */
export class SuspendTenantDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
