import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';

@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('No user found');
    }

    if (user.role === 'superadmin') {
      // Superadmin can optionally specify a tenantId via header
      const headerTenantId = request.headers['x-tenant-id'];
      if (headerTenantId) {
        request.tenantId = headerTenantId;
      }
      return true;
    }

    if (!user.tenantId) {
      throw new ForbiddenException('User not assigned to any organization');
    }

    request.tenantId = user.tenantId;
    return true;
  }
}
