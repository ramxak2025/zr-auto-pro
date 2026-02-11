import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserPermissions } from '../../users/entities/user.entity';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<
      (keyof UserPermissions)[]
    >(PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();

    if (!user || !user.permissions) {
      throw new ForbiddenException('No permissions assigned to this user');
    }

    const hasAllPermissions = requiredPermissions.every(
      (permission) => user.permissions[permission] === true,
    );

    if (!hasAllPermissions) {
      throw new ForbiddenException(
        'You do not have the required permissions to perform this action',
      );
    }

    return true;
  }
}
