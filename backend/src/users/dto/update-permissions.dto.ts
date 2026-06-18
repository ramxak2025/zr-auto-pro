import { IsObject } from 'class-validator';

/**
 * Body for PATCH /users/:id/permissions — an owner sets another user's
 * action-permission map. The map is the SAME shape as users.permissions and
 * `UserPermissions` in shared/types/index.ts. We accept the full map and
 * persist it as-is (it replaces the stored map), so the client sends the
 * complete desired state, exactly like the existing UpdateUserDto.permissions.
 *
 * Validation is intentionally permissive on individual keys (the permission
 * vocabulary may grow); the service coerces every value to a boolean before
 * storing so a forged non-boolean can't poison the JSON.
 */
export class UpdatePermissionsDto {
  @IsObject()
  permissions!: Record<string, boolean>;
}
