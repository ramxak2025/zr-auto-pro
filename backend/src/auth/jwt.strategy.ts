import { Injectable, UnauthorizedException, Inject } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';
import { ttlCache } from '../common/ttl-cache';
import { authCacheKey, AUTH_CACHE_TTL_MS, ValidatedUser } from '../common/auth-cache';

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

  async validate(payload: Record<string, unknown>): Promise<ValidatedUser> {
    const userID = payload.sub as string | undefined;
    const jti = payload.jti as string | undefined;
    if (!userID) {
      throw new UnauthorizedException({ message: 'Неверный токен' });
    }

    // ── Auth-hop cache ───────────────────────────────────────────────────
    // validate() runs on EVERY authenticated request and otherwise pays 2 DB
    // hops (revoked_tokens + users). A burst of parallel requests from one
    // client would each pay both. We cache the SUCCESS result for a short TTL
    // keyed by (userID, jti) so a burst collapses to one pair of hops.
    //
    // Security invariants:
    //   • Only positive results are cached — a freshly-revoked or deactivated
    //     token is NEVER served from cache because the entry is dropped on the
    //     revoke / user-update path (see AuthService.logout, UsersService
    //     .update/.remove), and the 30s TTL bounds any race.
    //   • The key embeds userID so role/permission/active changes can purge
    //     ALL of a user's cached tokens via prefix in one call.
    //   • The cached value carries its own tenantID/role/userID — no value is
    //     ever shared across tenants or users.
    //   • In-flight de-dup in TtlCache.wrap() means even the first cold burst
    //     issues exactly one DB round-trip, not one per concurrent request.
    if (jti) {
      return ttlCache.wrap(authCacheKey(userID, jti), AUTH_CACHE_TTL_MS, () => this.loadValidatedUser(userID, jti));
    }

    // Legacy tokens without a jti can't be individually revoked, so we don't
    // cache them — fall through to a live check every time.
    return this.loadValidatedUser(userID, undefined);
  }

  private async loadValidatedUser(userID: string, jti: string | undefined): Promise<ValidatedUser> {
    // Check if token has been revoked (via POST /auth/logout)
    if (jti) {
      const { rows: revoked } = await this.pool.query(`SELECT 1 FROM revoked_tokens WHERE jti=$1 LIMIT 1`, [jti]);
      if (revoked.length > 0) {
        throw new UnauthorizedException({ message: 'Токен отозван' });
      }
    }

    const { rows } = await this.pool.query(
      `SELECT is_active, COALESCE(tenant_id::text, '') as tenant_id, role, dismissed_at, purged_at FROM users WHERE id=$1`,
      [userID],
    );

    if (rows.length === 0) {
      throw new UnauthorizedException({ message: 'Пользователь не найден' });
    }

    // 065_users_dismissed — a dismissed («Уволенные») or purged user must not be
    // able to authenticate. The row is kept only so historical checks/shifts
    // resolve their name; the person can no longer use the app.
    if (rows[0].dismissed_at || rows[0].purged_at) {
      throw new UnauthorizedException({ message: 'Аккаунт уволен' });
    }

    if (!rows[0].is_active) {
      throw new UnauthorizedException({ message: 'Аккаунт деактивирован' });
    }

    return {
      userID,
      tenantID: rows[0].tenant_id,
      role: rows[0].role,
      jti,
    };
  }
}
