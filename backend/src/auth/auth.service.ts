import {
  Injectable,
  Inject,
  UnauthorizedException,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { JwtService } from '@nestjs/jwt';
import { Pool } from 'pg';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { PG_POOL } from '../database.module';
import { normalizePhone } from '../common/normalize-phone';
import { invalidateAuthToken, NO_TENANT_ID } from '../common/auth-cache';
import { RUN_BACKGROUND_JOBS } from '../common/run-jobs';
import { CANONICAL_PERMISSION_KEYS, mergeEffectivePermissions } from '../common/role-matrix';
import { userHasPermission } from '../common/guards/permissions.guard';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

// Shared SQL fragment for fetching user with tenant info.
// ROLE-ONLY (волна «права как в Битрикс24», 2026-07): permissions клиенту
// строятся из МАТРИЦЫ назначенной роли (LEFT JOIN roles — тот же источник, что
// enforcement в jwt.strategy), а не из легаси-колонки users.permissions
// (заморожена cutover-миграцией 126: у новых сотрудников '{}'). role_name —
// для бэйджа роли на клиенте.
const USER_WITH_TENANT_COLUMNS = `
  u.id, u.phone, u.full_name, u.avatar, u.role, u.role_id,
  r.name as role_name, r.matrix as role_matrix,
  COALESCE(u.salary_percent, 0) as salary_percent,
  u.is_active, u.dismissed_at, u.purged_at, u.tenant_id, u.created_at,
  CASE WHEN t.id IS NOT NULL THEN
    json_build_object('id',t.id,'name',t.name,'slug',COALESCE(t.slug,''),
      'phone',COALESCE(t.phone,''),'address',COALESCE(t.address,''),
      'email',COALESCE(t.email,''),'isActive',t.is_active,
      'maxUsers',t.max_users,
      'subscriptionEnd',t.subscription_end,
      'subscriptionNote',COALESCE(t.subscription_note,''),
      'createdAt',t.created_at,'updatedAt',t.updated_at)::text
  ELSE NULL END as tenant_json`;

/** LEFT JOIN матрицы роли — парный к USER_WITH_TENANT_COLUMNS (алиас r). */
const ROLE_JOIN = `LEFT JOIN roles r ON r.id = u.role_id`;

/**
 * ЭФФЕКТИВНЫЕ права клиенту — ровно та же логика, что серверный enforcement
 * (GET /users/:id/effective-permissions делает то же самое): flatten(матрицы
 * роли) прогоняется через userHasPermission по каждому каноническому ключу.
 * Директор/суперадмин получают карту «всё true» (owner-class байпас в
 * userHasPermission — клиентские гейты owner-bypass не знают и читают карту);
 * master/admin без матрицы (role_id NULL) падают на свои дефолты в guard'е.
 */
function effectivePermissionsFor(role: string | undefined, rawMatrix: unknown): Record<string, boolean> {
  let matrix: unknown = rawMatrix ?? null;
  if (typeof matrix === 'string') {
    try {
      matrix = JSON.parse(matrix);
    } catch {
      matrix = null; // fail-closed: кривой jsonb → дефолты строковой роли
    }
  }
  const probe = { role, permissions: mergeEffectivePermissions(matrix) };
  const effective: Record<string, boolean> = {};
  for (const key of CANONICAL_PERMISSION_KEYS) {
    effective[key] = userHasPermission(probe, key);
  }
  return effective;
}

/** Map a raw DB row to a camelCase user object with parsed tenant */
function mapUserRow(row: any) {
  const user: any = {
    id: row.id,
    phone: row.phone,
    fullName: row.full_name,
    avatar: row.avatar,
    role: row.role,
    // 114 — назначенная роль: id + имя для бэйджа на клиенте.
    roleId: row.role_id ?? null,
    roleName: row.role_name ?? null,
    salaryPercent: parseFloat(row.salary_percent) || 0,
    permissions: effectivePermissionsFor(row.role, row.role_matrix),
    isActive: row.is_active,
    tenantId: row.tenant_id,
    createdAt: row.created_at,
  };

  if (row.tenant_json) {
    try {
      user.tenant = JSON.parse(row.tenant_json);
    } catch {
      /* ignore malformed tenant JSON */
    }
  }

  return user;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger('AuthService');

  constructor(
    @Inject(PG_POOL) private pool: Pool,
    private jwtService: JwtService,
  ) {}

  private generateToken(userID: string, tenantID?: string): string {
    const jti = randomUUID();
    return this.jwtService.sign({ sub: userID, tenantId: tenantID, jti });
  }

  async logout(jti: string, userId: string, tenantId: string): Promise<void> {
    // Derive `expires_at` from a JWT `exp` claim, not a hardcoded window, so the
    // revocation row lives at least as long as the token it revokes — a row that
    // expired first would silently un-revoke a still-valid token. Re-signing a
    // throwaway token makes it inherit JwtModule's configured `expiresIn` (now
    // 30d), so the derived expiry tracks the real token TTL automatically and
    // needs no edit here if the TTL changes again. The fallback mirrors that TTL
    // (30 days, not a stale 7) and only fires if decode yields no `exp`.
    const decoded = this.jwtService.decode(this.jwtService.sign({ sub: userId, jti })) as Record<
      string,
      unknown
    > | null;
    const exp = decoded?.exp ? new Date((decoded.exp as number) * 1000) : new Date(Date.now() + 30 * 86400000);
    // Tenant-less superadmin: JwtStrategy substitutes the NO_TENANT_ID
    // sentinel for users.tenant_id IS NULL. No `tenants` row ever owns the
    // nil-UUID, so inserting it here FK-violates revoked_tokens_tenant_id_fkey
    // (23503) → logout 500s and the token is NEVER revoked (confirmed Sentry
    // issue). The column is nullable (021) — store NULL for "no tenant".
    const tenantForRow = tenantId && tenantId !== NO_TENANT_ID ? tenantId : null;
    try {
      await this.pool.query(
        `INSERT INTO revoked_tokens (jti, user_id, tenant_id, expires_at) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [jti, userId, tenantForRow, exp],
      );
    } catch (err) {
      // Second belt: ANY other FK violation on tenant_id (e.g. a token minted
      // for a since-deleted tenant) must still revoke the token — tenant_id on
      // this row is bookkeeping, revocation is the invariant. Retry with NULL.
      // Every non-23503 error RETHROWS: a silently swallowed failure here
      // would return 200 while the token stays valid — forbidden.
      if ((err as { code?: string } | null)?.code === '23503') {
        await this.pool.query(
          `INSERT INTO revoked_tokens (jti, user_id, tenant_id, expires_at) VALUES ($1, $2, NULL, $3) ON CONFLICT DO NOTHING`,
          [jti, userId, exp],
        );
      } else {
        throw err;
      }
    }
    // Drop the cached JWT validation immediately so the next request with this
    // token re-checks revoked_tokens (and is rejected) instead of being served
    // a stale "valid" result for up to the cache TTL. Reached on BOTH
    // successful insert paths (normal and the 23503 NULL retry).
    invalidateAuthToken(userId, jti);
  }

  /**
   * Тихое продление сессии (mobile): выдать СВЕЖИЙ токен по живому bearer'у.
   *
   * • Вызывается только под JwtAuthGuard — токен уже прошёл проверку подписи,
   *   ревокации и is_active; никакой дополнительной валидации здесь не нужно.
   * • Старый jti сознательно НЕ ревокируется: немедленная ревокация убивала бы
   *   in-flight запросы, идущие со старым токеном. Безопасность не хуже
   *   текущей — оба токена и так живут до своего exp, а logout ревокирует тот
   *   jti, который клиент держит в руках на момент выхода.
   * • Sentinel-тенант (NO_TENANT_ID — tenant-less superadmin) НЕ зашивается в
   *   новый токен: generateToken получает undefined, ровно как при login, и
   *   JwtStrategy снова подставит sentinel при валидации.
   */
  refresh(user: { userID: string; tenantID: string }): { token: string } {
    const tenantID = user.tenantID && user.tenantID !== NO_TENANT_ID ? user.tenantID : undefined;
    return { token: this.generateToken(user.userID, tenantID) };
  }

  async isTokenRevoked(jti: string): Promise<boolean> {
    const { rows } = await this.pool.query(`SELECT 1 FROM revoked_tokens WHERE jti=$1 LIMIT 1`, [jti]);
    return rows.length > 0;
  }

  /**
   * Purge already-expired entries from the revoked-tokens table. The
   * revocation check only runs while a token would still be valid by
   * signature, so rows older than `expires_at` are dead weight. Wiring
   * this as a daily cron keeps the table from growing forever in a
   * tenant with churny logins.
   */
  @Cron('17 3 * * *', { timeZone: 'Europe/Moscow' })
  async cleanExpiredTokens(): Promise<void> {
    if (!RUN_BACKGROUND_JOBS) return;
    try {
      const { rowCount } = await this.pool.query(`DELETE FROM revoked_tokens WHERE expires_at < now()`);
      if (rowCount && rowCount > 0) {
        this.logger.log(`Purged ${rowCount} expired revoked tokens`);
      }
    } catch (err) {
      this.logger.error(`cleanExpiredTokens failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  async login(dto: LoginDto) {
    if (!dto.phone || !dto.password) {
      throw new BadRequestException({ message: 'Телефон и пароль обязательны' });
    }

    const phone = normalizePhone(dto.phone);

    const { rows } = await this.pool.query(
      `SELECT u.password, ${USER_WITH_TENANT_COLUMNS}
       FROM users u
       LEFT JOIN tenants t ON t.id = u.tenant_id
       ${ROLE_JOIN}
       WHERE u.phone = $1 OR u.phone = $2
       LIMIT 1`,
      [phone, dto.phone],
    );

    if (rows.length === 0) {
      this.logger.warn(`Login FAILED: phone=${phone} — not found`);
      throw new UnauthorizedException({ message: 'Неверный телефон или пароль' });
    }

    const row = rows[0];

    // 065_users_dismissed — a dismissed («Уволенные») or purged employee can no
    // longer log in. Their row is retained only so historical checks/shifts keep
    // resolving the name; the person has no access to the app.
    if (row.dismissed_at || row.purged_at) {
      this.logger.warn(`Login FAILED: phone=${phone} — dismissed`);
      throw new UnauthorizedException({ message: 'Аккаунт уволен' });
    }

    if (!row.is_active) {
      this.logger.warn(`Login FAILED: phone=${phone} — account deactivated`);
      throw new UnauthorizedException({ message: 'Аккаунт деактивирован' });
    }

    const passwordMatch = await bcrypt.compare(dto.password, row.password);
    if (!passwordMatch) {
      this.logger.warn(`Login FAILED: phone=${phone} — wrong password`);
      throw new UnauthorizedException({ message: 'Неверный телефон или пароль' });
    }

    this.logger.log(`Login OK: phone=${phone} role=${row.role} tenant=${row.tenant_id || 'none'}`);

    const token = this.generateToken(row.id, row.tenant_id);
    return { token, user: mapUserRow(row) };
  }

  async register(dto: RegisterDto) {
    if (!dto.phone || !dto.password || !dto.fullName) {
      throw new BadRequestException({ message: 'Телефон, пароль и имя обязательны' });
    }

    if (dto.password.length < 8) {
      throw new BadRequestException({ message: 'Пароль должен быть не менее 8 символов' });
    }
    if (!/[A-ZА-Я]/.test(dto.password) || !/[0-9]/.test(dto.password)) {
      throw new BadRequestException({ message: 'Пароль должен содержать заглавную букву и цифру' });
    }

    const phone = normalizePhone(dto.phone);

    const { rows: existsRows } = await this.pool.query('SELECT EXISTS(SELECT 1 FROM users WHERE phone=$1) as exists', [
      phone,
    ]);
    if (existsRows[0].exists) {
      throw new BadRequestException({ message: 'Пользователь с таким телефоном уже существует' });
    }

    const hash = await bcrypt.hash(dto.password, 12);
    const tenantName = dto.tenantName || 'Мой автосервис';

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: tenantRows } = await client.query(
        `INSERT INTO tenants (name, is_active, max_users) VALUES ($1, true, 10) RETURNING id`,
        [tenantName],
      );
      const tenantID = tenantRows[0].id;

      // ROLE-ONLY: новому директору назначается СИСТЕМНАЯ роль «Директор» (по
      // system_key, как UsersService.create) — права живут в матрице роли;
      // легаси-колонка users.permissions больше не сеется ('{}'). Тенант только
      // что создан — override'ов у него нет, глобальный шаблон единственный.
      // Если шаблона вдруг нет (не должно случаться — сеется миграцией 114/121),
      // не блокируем регистрацию: role_id NULL, директор и так owner-class.
      const { rows: dirRoleRows } = await client.query(
        `SELECT id FROM roles WHERE system_key = 'director' AND tenant_id IS NULL LIMIT 1`,
      );
      const directorRoleId = dirRoleRows.length > 0 ? dirRoleRows[0].id : null;

      const { rows: userRows } = await client.query(
        `INSERT INTO users (phone, password, full_name, role, is_active, tenant_id, permissions, role_id)
         VALUES ($1, $2, $3, 'director', true, $4, '{}'::jsonb, $5)
         RETURNING id, phone, full_name, role, role_id, salary_percent, is_active, tenant_id, created_at`,
        [phone, hash, dto.fullName, tenantID, directorRoleId],
      );

      // Seed the three default warehouses for this self-registered tenant —
      // mirrors TenantsService.create so registration and admin-created
      // tenants behave identically. Without this a self-registered tenant had
      // NO warehouses, so `resolveWarehouseId` returned null and every product
      // (manual create AND CSV import) landed with warehouse_id = NULL, hidden
      // from the default warehouse view. Idempotent via the (tenant_id, kind)
      // unique constraint.
      await client.query(
        `INSERT INTO warehouses (tenant_id, name, kind, sort_order) VALUES
           ($1, 'Основной склад', 'main',   0),
           ($1, 'Склад брака',    'defect', 1),
           ($1, 'Склад Б/У',      'used',   2)
         ON CONFLICT (tenant_id, kind) DO NOTHING`,
        [tenantID],
      );

      await client.query('COMMIT');

      const token = this.generateToken(userRows[0].id, tenantID);
      return { token, user: mapUserRow(userRows[0]) };
    } catch (err) {
      await client.query('ROLLBACK');
      this.logger.error(`Register error: ${err}`);
      throw new InternalServerErrorException({ message: 'Ошибка сервера' });
    } finally {
      client.release();
    }
  }

  async me(userID: string) {
    const { rows } = await this.pool.query(
      `SELECT ${USER_WITH_TENANT_COLUMNS}
       FROM users u
       LEFT JOIN tenants t ON t.id = u.tenant_id
       ${ROLE_JOIN}
       WHERE u.id = $1`,
      [userID],
    );

    if (rows.length === 0) {
      throw new UnauthorizedException({ message: 'Пользователь не найден' });
    }

    return mapUserRow(rows[0]);
  }

  async updateAvatar(userID: string, avatar: string) {
    await this.pool.query('UPDATE users SET avatar=$1 WHERE id=$2', [avatar, userID]);
    return { avatar };
  }
}
