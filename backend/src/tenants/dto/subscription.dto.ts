import { IsInt, IsPositive, IsString, IsUUID, Max } from 'class-validator';

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
