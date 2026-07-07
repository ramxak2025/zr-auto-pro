import {
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * POST /tenants/:id/extend body — extend a subscription, PAID or FREE.
 *
 * BACKWARD-COMPAT: a legacy `{ days }` body still validates and works. All
 * fields are optional at the DTO level; the business rules (must supply
 * `until` or `days`; paid requires `amount > 0`; `until` must be in the future)
 * are enforced in TenantsService.extend so the error messages can be specific.
 */
export class ExtendSubscriptionDto {
  @IsOptional()
  @IsInt()
  @IsPositive()
  @Max(3650) // cap at ~10 years so a fat-fingered value can't overflow the date math
  days?: number;

  /** 'paid' — records collected revenue (amount required); 'free' — zero-revenue. Omitted ⇒ free. */
  @IsOptional()
  @IsIn(['paid', 'free'])
  type?: 'paid' | 'free';

  /** Payment amount in rubles. Required and > 0 when type='paid'. Capped to NUMERIC(10,2) range. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99999999) // NUMERIC(10,2) max is 99 999 999.99 — stay in range
  amount?: number;

  /** Set the new subscription_end to this date (must be in the future). Wins over `days`. */
  @IsOptional()
  @IsISO8601()
  until?: string;

  /** Optional human note stored on the ledger row. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
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
