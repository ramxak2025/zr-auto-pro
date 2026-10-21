import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Injectable()
export class JwtRefreshGuard extends AuthGuard('jwt-refresh') {
  handleRequest<TUser>(err: unknown, user: TUser, info: unknown, context: ExecutionContext): TUser {
    // Keep infrastructure failures as 503, never misreport an outage as expired credentials.
    return JwtAuthGuard.prototype.handleRequest(err, user, info, context);
  }
}

@Injectable()
export class JwtLogoutGuard extends AuthGuard('jwt-logout') {
  handleRequest<TUser>(err: unknown, user: TUser, info: unknown, context: ExecutionContext): TUser {
    return JwtAuthGuard.prototype.handleRequest(err, user, info, context);
  }
}

@Injectable()
export class JwtSwitchPointGuard extends AuthGuard('jwt-switch-point') {
  handleRequest<TUser>(err: unknown, user: TUser, info: unknown, context: ExecutionContext): TUser {
    return JwtAuthGuard.prototype.handleRequest(err, user, info, context);
  }
}
