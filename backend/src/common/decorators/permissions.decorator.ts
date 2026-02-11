import { SetMetadata } from '@nestjs/common';
import { UserPermissions } from '../../modules/users/entities/user.entity';

export const PERMISSIONS_KEY = 'permissions';

export const Permissions = (...permissions: (keyof UserPermissions)[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
