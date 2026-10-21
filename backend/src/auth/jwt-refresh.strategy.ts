import { BadRequestException, Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { JwtStrategy } from './jwt.strategy';
import { REFRESH_KEY_HEADER, refreshKeyHash } from './refresh-recovery';

function verificationSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret === 'change-me-in-production') throw new Error('FATAL: JWT_SECRET must be configured');
  return secret;
}

/** A separate Passport entry point: general API requests never recover revoked tokens. */
@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor(private readonly sessions: JwtStrategy) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: verificationSecret(), // JwtStrategy has already validated configuration.
      passReqToCallback: true,
    });
  }

  validate(req: Request, payload: Record<string, unknown>) {
    return this.sessions.validateRefresh(payload, refreshKeyHash(req.headers[REFRESH_KEY_HEADER]));
  }
}

/** Revoke-only route can cancel a receipt even after its child was consumed. */
@Injectable()
export class JwtLogoutStrategy extends PassportStrategy(Strategy, 'jwt-logout') {
  constructor(private readonly sessions: JwtStrategy) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: verificationSecret(),
      passReqToCallback: true,
    });
  }
  validate(req: Request, payload: Record<string, unknown>) {
    return this.sessions.validateLogout(payload, refreshKeyHash(req.headers[REFRESH_KEY_HEADER]));
  }
}

@Injectable()
export class JwtSwitchPointStrategy extends PassportStrategy(Strategy, 'jwt-switch-point') {
  constructor(private readonly sessions: JwtStrategy) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: verificationSecret(),
      passReqToCallback: true,
    });
  }
  validate(req: Request, payload: Record<string, unknown>) {
    const target: unknown = (req.body as { pointId?: unknown } | undefined)?.pointId;
    if (typeof target !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(target))
      throw new BadRequestException({ message: 'Неверный филиал' });
    return this.sessions.validateSwitchPoint(payload, refreshKeyHash(req.headers[REFRESH_KEY_HEADER]), target);
  }
}
