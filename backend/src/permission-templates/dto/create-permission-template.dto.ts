import { IsObject, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Body for POST /permission-templates — create a named, reusable permission set
 * («роль»). `permissions` mirrors the shape of users.permissions /
 * `UserPermissions` (Record<string,boolean>). Validation on individual keys is
 * intentionally permissive (the permission vocabulary may grow); the service
 * coerces every value to a strict boolean before persisting so a forged
 * non-boolean can't poison the stored JSON.
 */
export class CreatePermissionTemplateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsObject()
  permissions!: Record<string, boolean>;
}
