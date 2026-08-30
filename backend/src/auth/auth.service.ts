import {
  Injectable,
  Inject,
  UnauthorizedException,
  ForbiddenException,
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
import { runWithTenant } from '../common/tenant-context';
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
  u.is_active, u.dismissed_at, u.purged_at, u.tenant_id, u.current_point_id, u.created_at,
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
    // 156 — мульти-точки: текущая выбранная точка (undefined в путях, которые
    // колонку не выбирают — аддитивно, клиенты делают fallback на GET /points).
    currentPointId: row.current_point_id ?? null,
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

/**
 * Grace-окно доживания старого токена после успешного /auth/refresh.
 *
 * Немедленная ревокация рвала бы in-flight запросы клиента, ушедшие со старым
 * bearer'ом до того, как AuthContext атомарно применил новый токен через
 * sessionRuntime.commit. Схема 021 уже хранит `revoked_at` — используем его как
 * «момент, С КОТОРОГО ревокация действует» (отложенная ревокация): строка в
 * blacklist создаётся сразу (это атомарный claim обмена), но проверка в
 * JwtStrategy отбивает токен только когда revoked_at <= now(). 2 минут хватает
 * любому параллельному запросу с запасом; альтернатива «expires_at = now()+2м»
 * не годится — присутствие строки блокирует токен сразу, а её очистка (раз в
 * сутки кроном) наоборот РАЗблокировала бы его.
 */
const REFRESH_ROTATE_GRACE_MS = 120_000;

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

  /**
   * ЕДИНСТВЕННАЯ точка записи в blacklist (logout И refresh-claim).
   *
   * mode 'force' (logout) — ревокация НЕМЕДЛЕННО (graceMs=0). Upsert: если по
   *   jti уже лежит строка ОТЛОЖЕННОЙ ревокации (refresh-claim с grace-окном),
   *   LEAST() подтягивает момент ревокации к now() — выход всегда побеждает
   *   grace и никогда его не продлевает. Возвращает true.
   *
   * mode 'claim' (refresh) — атомарный «обмен» токена. ON CONFLICT DO NOTHING
   *   + rowCount: строка вставилась → линия наша, можно чеканить новый токен;
   *   конфликт (строка уже есть: токен ревокирован logout'ом ИЛИ уже обменян
   *   ранее) → false, refresh отвечает 401. Один INSERT одновременно является
   *   и живой проверкой blacklist МИМО auth-кэша, и арбитром гонки двух
   *   параллельных refresh одним токеном — claim выигрывает ровно один.
   *
   * RLS-ремень: ревокация — инвариант, запись обязана попасть в blacklist из
   * ЛЮБОГО контекста. Обычный путь идёт текущим пулом (тенантный запрос →
   * app-пул; WITH CHECK политики 112 проходит для строки со своим tenant_id).
   * ЛЮБОЙ сбой — 23503 (FK на умерший тенант), 42501 (WITH CHECK отбивает
   * NULL-tenant строку tenant-scoped сессии — прежний 23503-ремень этого не
   * ловил и logout 500-ил), либо иной — повторяет тот же statement через
   * admin-пул с tenant_id NULL: runWithTenant('') кладёт пустой tenantId в
   * CLS, TenantAwarePool на falsy-контекст маршрутизирует в admin-пул
   * (superuser, RLS обходится). tenant_id в этой таблице — бухгалтерия,
   * NULL допустим. Ошибка admin-повтора ПРОБРАСЫВАЕТСЯ: молча съесть сбой =
   * вернуть 200 при живом токене — запрещено.
   */
  private async blacklistToken(opts: {
    jti: string;
    userId: string;
    tenantId: string | null;
    graceMs: number;
    expiresAt: Date;
    mode: 'force' | 'claim';
  }): Promise<boolean> {
    const conflictClause =
      opts.mode === 'force'
        ? `ON CONFLICT (jti) DO UPDATE SET
             revoked_at = LEAST(revoked_tokens.revoked_at, EXCLUDED.revoked_at),
             expires_at = GREATEST(revoked_tokens.expires_at, EXCLUDED.expires_at)`
        : `ON CONFLICT (jti) DO NOTHING`;
    // revoked_at считается ЧАСАМИ БАЗЫ (now() + grace) — сравнение в
    // JwtStrategy тоже идёт по now() базы, расхождение часов Node/PG не влияет.
    const sql = `INSERT INTO revoked_tokens (jti, user_id, tenant_id, revoked_at, expires_at)
                 VALUES ($1, $2, $3, now() + ($4::int * interval '1 millisecond'), $5)
                 ${conflictClause}`;
    try {
      const res = await this.pool.query(sql, [opts.jti, opts.userId, opts.tenantId, opts.graceMs, opts.expiresAt]);
      return opts.mode === 'force' ? true : (res.rowCount ?? 0) > 0;
    } catch (err) {
      const code = (err as { code?: string } | null)?.code ?? 'unknown';
      this.logger.warn(
        `revoked_tokens write failed (code=${code}) — retrying via admin pool: ${err instanceof Error ? err.message : err}`,
      );
      const res = await runWithTenant('', () =>
        this.pool.query(sql, [opts.jti, opts.userId, null, opts.graceMs, opts.expiresAt]),
      );
      return opts.mode === 'force' ? true : (res.rowCount ?? 0) > 0;
    }
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
    // Сбои политики RLS / FK ловит admin-ремень внутри blacklistToken.
    const tenantForRow = tenantId && tenantId !== NO_TENANT_ID ? tenantId : null;
    await this.blacklistToken({ jti, userId, tenantId: tenantForRow, graceMs: 0, expiresAt: exp, mode: 'force' });
    // Drop the cached JWT validation immediately so the next request with this
    // token re-checks revoked_tokens (and is rejected) instead of being served
    // a stale "valid" result for up to the cache TTL. Reached on BOTH
    // successful insert paths (normal and the admin-pool retry).
    invalidateAuthToken(userId, jti);
  }

  /**
   * Тихое продление сессии (mobile): обменять живой bearer на СВЕЖИЙ токен.
   *
   * Линия токенов после этой правки — ЦЕПЬ, а не дерево (Round 14
   * adversarial-ревью, линза auth — 3 находки закрыты здесь):
   *
   * • Атомарный claim: старый jti пишется в revoked_tokens (ON CONFLICT DO
   *   NOTHING) С ОТЛОЖЕННЫМ revoked_at = now()+2мин ДО чеканки нового токена.
   *   Строка уже существует (logout ИЛИ более ранний обмен) → 401, нового
   *   токена нет. Тем самым: (а) отозванный токен НЕ может продлиться даже в
   *   30-секундном окне позитивного auth-кэша JwtStrategy — INSERT бьёт в базу
   *   напрямую, мимо кэша и на любой реплике; (б) каждый токен обменивается
   *   РОВНО один раз — «бесконечный форк» скомпрометированного bearer'а
   *   невозможен, у активной сессии всегда ровно один живой токен (плюс
   *   предыдущий, доживающий ≤2 минут); (в) logout типа продолжает быть kill
   *   switch: он ревокирует jti в руках клиента немедленно, а вся его линия
   *   либо уже мертва, либо умирает по своему grace.
   * • Grace 2 минуты (см. REFRESH_ROTATE_GRACE_MS): in-flight запросы со
   *   старым токеном доживают, клиент применяет новый токен атомарно через
   *   sessionRuntime.commit. Потолок доживания = grace + TTL auth-кэша (30с).
   * • Impersonation НЕ продлевается — СЕРВЕРНЫЙ гейт: 30-минутный токен
   *   «войти как владелец» (tenants.service.impersonate, claim impersonatedBy)
   *   получает 403, а не полноценный 30-дневный директорский токен без следа
   *   impersonation. Клиентский гейт в AuthContext остаётся, но больше не
   *   является единственной защитой.
   * • Живая перепроверка users.is_active/dismissed/purged мимо auth-кэша —
   *   деактивированный аккаунт не чеканит новый токен даже в 30с окне.
   * • Rate-limit: /auth/refresh метится обычным write-бакетом глобального
   *   RateLimitGuard (150/мин на ip+токен); claim-семантика дополнительно
   *   ограничивает обмен одним разом на токен.
   * • Sentinel-тенант (NO_TENANT_ID — tenant-less superadmin) НЕ зашивается в
   *   новый токен: generateToken получает undefined, ровно как при login, и
   *   JwtStrategy снова подставит sentinel при валидации.
   */
  async refresh(
    user: { userID: string; tenantID: string; jti?: string },
    rawToken: string,
  ): Promise<{ token: string }> {
    const oldJti = user.jti;
    if (!oldJti) {
      // Токен без jti нельзя ревокировать → его линию нельзя оборвать. Такие
      // токены не выпускаются с 021 и давно истекли — fail-closed.
      throw new UnauthorizedException({ message: 'Сессия устарела — войдите заново' });
    }

    // rawToken — тот же bearer, что прошёл JwtAuthGuard (подпись уже проверена
    // стратегией); decode без verify достаточен, чтобы прочитать claims,
    // которые guard не прокидывает в ValidatedUser: impersonatedBy и exp.
    const decoded = rawToken ? (this.jwtService.decode(rawToken) as Record<string, unknown> | null) : null;
    if (!decoded || decoded.jti !== oldJti) {
      throw new UnauthorizedException({ message: 'Неверный токен' });
    }
    if (decoded.impersonatedBy) {
      throw new ForbiddenException({ message: 'Сессия входа под пользователем не продлевается' });
    }

    // Живая проверка аккаунта МИМО 30с auth-кэша. Под RLS запрос идёт app-пулом
    // и видит собственную строку тенантного пользователя; аномальный
    // non-superadmin без тенанта не увидит ничего и получит 401 — fail-closed,
    // идентично его же /auth/me.
    const { rows } = await this.pool.query(`SELECT is_active, dismissed_at, purged_at FROM users WHERE id=$1`, [
      user.userID,
    ]);
    if (rows.length === 0 || rows[0].dismissed_at || rows[0].purged_at || !rows[0].is_active) {
      throw new UnauthorizedException({ message: 'Аккаунт недоступен' });
    }

    // Атомарный claim обмена (подробности — doc-комментарий выше и
    // blacklistToken). expires_at строки = НАСТОЯЩИЙ exp старого токена, чтобы
    // строка пережила токен, который она ревокирует.
    const exp = typeof decoded.exp === 'number' ? new Date(decoded.exp * 1000) : new Date(Date.now() + 30 * 86400000);
    const tenantForRow = user.tenantID && user.tenantID !== NO_TENANT_ID ? user.tenantID : null;
    const claimed = await this.blacklistToken({
      jti: oldJti,
      userId: user.userID,
      tenantId: tenantForRow,
      graceMs: REFRESH_ROTATE_GRACE_MS,
      expiresAt: exp,
      mode: 'claim',
    });
    if (!claimed) {
      throw new UnauthorizedException({ message: 'Токен отозван' });
    }

    const tenantID = user.tenantID && user.tenantID !== NO_TENANT_ID ? user.tenantID : undefined;
    return { token: this.generateToken(user.userID, tenantID) };
  }

  async isTokenRevoked(jti: string): Promise<boolean> {
    // «Ревокирован СЕЙЧАС»: строка с будущим revoked_at (grace-окно после
    // refresh) токен ещё не блокирует — зеркало проверки в JwtStrategy.
    const { rows } = await this.pool.query(
      `SELECT 1 FROM revoked_tokens WHERE jti=$1 AND (revoked_at IS NULL OR revoked_at <= now()) LIMIT 1`,
      [jti],
    );
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
