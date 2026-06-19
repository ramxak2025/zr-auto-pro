import { IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Body for PATCH /permission-templates/:id — both fields optional so a caller
 * can rename without resending the whole map, or replace the map without
 * touching the name. An omitted field is left unchanged; a provided
 * `permissions` REPLACES the stored map (same replace-semantics as the user
 * permissions editor). Values are coerced to strict booleans in the service.
 */
export class UpdatePermissionTemplateDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsObject()
  permissions?: Record<string, boolean>;
}
