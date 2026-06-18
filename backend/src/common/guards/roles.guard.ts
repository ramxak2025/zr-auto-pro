import { Injectable, CanActivate, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles) return true;
    const { user } = context.switchToHttp().getRequest();
    // Superadmin (platform owner) bypasses every role gate — mirrors the
    // client-side FeatureGate. Today every @Roles(...) list already includes
    // 'superadmin', so this is behaviour-preserving; it also future-proofs
    // against a new @Roles(...) that forgets superadmin and would otherwise
    // silently lock the platform owner out of a tenant-scoped endpoint.
    if (user?.role === 'superadmin') return true;
    return requiredRoles.includes(user?.role);
  }
}
