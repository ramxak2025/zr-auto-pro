import { IsArray, IsIn, IsString, ArrayMaxSize } from 'class-validator';
import { ALL_FEATURE_KEYS } from '../feature-catalog';

/**
 * PUT /plans/:id/features body — the FULL set of feature keys ENABLED on the
 * plan (replace-semantics). Every key is validated against the authoritative
 * catalog (@IsIn ALL_FEATURE_KEYS), so a stale/garbage key is rejected with 400
 * rather than silently poisoning the plan's `features` JSONB. ArrayMaxSize caps
 * it well above the catalog size as a cheap belt-and-suspenders bound.
 */
export class SetPlanFeaturesDto {
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @IsIn(ALL_FEATURE_KEYS as string[], { each: true })
  features!: string[];
}
