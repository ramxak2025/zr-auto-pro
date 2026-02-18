import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.get<string[]>(
      'permissions',
      context.getHandler(),
    );
    if (!requiredPermissions) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user) return false;

    // Superadmin and director bypass permission checks
    if (user.role === 'superadmin' || user.role === 'director') return true;

    const perms = typeof user.permissions === 'string'
      ? JSON.parse(user.permissions)
      : user.permissions || {};

    return requiredPermissions.every((p) => perms[p] === true);
  }
}
