import { Injectable, UnauthorizedException, Inject } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(@Inject(PG_POOL) private pool: Pool) {
    const secret = process.env.JWT_SECRET;
    if (!secret || secret === 'change-me-in-production') {
      throw new Error('FATAL: JWT_SECRET environment variable must be set in production');
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: any) {
    const userID = payload.sub;
    if (!userID) {
      throw new UnauthorizedException({ message: 'Неверный токен' });
    }

    const { rows } = await this.pool.query(
      `SELECT is_active, COALESCE(tenant_id::text, '') as tenant_id, role FROM users WHERE id=$1`,
      [userID],
    );

    if (rows.length === 0) {
      throw new UnauthorizedException({ message: 'Пользователь не найден' });
    }

    if (!rows[0].is_active) {
      throw new UnauthorizedException({ message: 'Аккаунт деактивирован' });
    }

    return {
      userID,
      tenantID: rows[0].tenant_id,
      role: rows[0].role,
    };
  }
}
