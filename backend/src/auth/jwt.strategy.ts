import { Injectable, UnauthorizedException, Inject } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';
import { ttlCache } from '../common/ttl-cache';
import { authCacheKey, AUTH_CACHE_TTL_MS, NO_TENANT_ID, ValidatedUser } from '../common/auth-cache';
import { mergeEffectivePermissions } from '../common/role-matrix';

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
    // Check if token has been revoked (via POST /auth/logout or exchanged via
    // POST /auth/refresh). `revoked_at` — момент, С КОТОРОГО ревокация
    // действует: logout пишет now() (немедленно), refresh-claim — now()+2мин
    // (grace-окно доживания старого токена для in-flight запросов, см.
    // AuthService.REFRESH_ROTATE_GRACE_MS). Строка с будущим revoked_at токен
    // ещё НЕ блокирует; NULL (легаси-строки без default) трактуем как
    // «ревокирован сразу» — fail-closed. Запрос всегда идёт admin-пулом
    // (guards выполняются до TenantContextInterceptor — CLS-контекста ещё
    // нет), поэтому видит и NULL-tenant строки, записанные admin-ремнём.
    if (jti) {
      const { rows: revoked } = await this.pool.query(
        `SELECT 1 FROM revoked_tokens WHERE jti=$1 AND (revoked_at IS NULL OR revoked_at <= now()) LIMIT 1`,
        [jti],
      );
      if (revoked.length > 0) {
        throw new UnauthorizedException({ message: 'Токен отозван' });
      }
    }

    // 114 — LEFT JOIN подтягивает матрицу назначенной роли тем же запросом
    // (нулевой дополнительный DB-hop). ROLE-ONLY (консолидация 2026-07): матрица
    // роли — единственный источник прав; users.permissions больше не читаются.
    // role_id NULL (аномалия после cutover-миграции 126) → role_matrix NULL →
    // deny-by-default для мастера падает на MASTER_PERMISSION_DEFAULTS в guard.
    const { rows } = await this.pool.query(
      `SELECT u.is_active, u.tenant_id::text as tenant_id, u.role, u.dismissed_at, u.purged_at,
              r.matrix as role_matrix
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
       WHERE u.id=$1`,
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

    // ── ROLE-ONLY (консолидация 2026-07) — источник прав только матрица роли ──
    // Назначена роль (role_id → матрица) → actor.permissions = flatten(матрицы).
    // Персональные users.permissions УДАЛЕНЫ из модели прав (миграция 126
    // мигрирует любые расхождения в кастомные роли). Все guards/сервисы
    // по-прежнему спрашивают userHasPermission(actor, key) — меняется только
    // источник карты. Матрицы нет (role_id NULL — аномалия после cutover) →
    // mergeEffectivePermissions возвращает {} (deny-by-default); мастер
    // добирает базу из MASTER_PERMISSION_DEFAULTS в guard, owner-class обходит
    // гейты по строковой роли.
    let roleMatrix = rows[0].role_matrix ?? null;
    if (typeof roleMatrix === 'string') {
      try {
        roleMatrix = JSON.parse(roleMatrix);
      } catch {
        roleMatrix = null; // fail-closed до deny-by-default, а не 500 на каждый запрос
      }
    }
    const permissions: Record<string, boolean> = mergeEffectivePermissions(roleMatrix);

    return {
      userID,
      // NULL tenant (a global superadmin) → nil-UUID sentinel, never '' — an
      // empty string would crash every `WHERE tenant_id = $1` on a uuid column.
      // See NO_TENANT_ID for the full rationale.
      tenantID: rows[0].tenant_id ?? NO_TENANT_ID,
      role: rows[0].role,
      permissions,
      jti,
    };
  }
}
