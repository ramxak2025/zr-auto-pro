import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { OneCService } from './one-c.service';
@Injectable()
export class OneCKeyGuard implements CanActivate {
  constructor(private service: OneCService) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const header = request.headers?.authorization;
    if (typeof header !== 'string' || !header.startsWith('Bearer '))
      throw new UnauthorizedException('Требуется ключ обмена');
    const connection = await this.service.authenticate(header.slice(7));
    request.oneCConnection = connection;
    // Guards precede global interceptors. Publishing the authenticated tenant
    // here activates the existing TenantContextInterceptor/RLS/subscription gate.
    request.user = {
      userID: connection.created_by,
      tenantID: connection.tenant_id,
      currentPointId: connection.point_id,
      role: 'director',
      permissions: {},
    };
    return true;
  }
}
