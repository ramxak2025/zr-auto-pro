import { SetMetadata } from '@nestjs/common';
import { UserPermissions } from '../../users/entities/user.entity';

export const PERMISSIONS_KEY = 'permissions';

export const RequirePermissions = (...permissions: (keyof UserPermissions)[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
