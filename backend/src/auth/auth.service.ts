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
import { actorPointId } from '../common/point-scope';
import { RUN_BACKGROUND_JOBS } from '../common/run-jobs';
import { CANONICAL_PERMISSION_KEYS, mergeEffectivePermissions } from '../common/role-matrix';
import { userHasPermission } from '../common/guards/permissions.guard';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { SelectPointDto } from './dto/select-point.dto';
import { SwitchPointDto } from './dto/switch-point.dto';
import { POINT_SELECT_PURPOSE, POINT_SELECT_TTL_SECONDS } from './point-session';
import { SESSION_STALE_MESSAGE, sessionStaleSql, tokenIatOf } from './session-boundary';

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
      -- 157 — часовой пояс автосервиса едет вместе с профилем: иначе КАЖДОМУ
      -- клиенту пришлось бы дёргать GET /my-company, который закрыт ключом
      -- company_manage (мастер получил бы 403 и остался без пояса). Поле
      -- аддитивное — старые сборки его просто игнорируют.
      'timezone',COALESCE(NULLIF(btrim(t.timezone),''),'Europe/Moscow'),
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

/**
 * Map a raw DB row to a camelCase user object with parsed tenant.
 *
 * `sessionPointId` (163) — филиал ЭТОЙ сессии. Передаётся явно, потому что
 * users.current_point_id перестал быть филиалом работы и стал лишь подсказкой
 * «где человек был в прошлый раз»: отдать её клиенту значило бы показать вебу
 * филиал, выбранный в телефоне, — ровно та ошибка, из-за которой эту волну и
 * делали. undefined = путь, где филиала сессии нет (register).
 */
function mapUserRow(row: any, sessionPointId?: string | null) {
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
    // 163 — филиал СЕССИИ (из токена), а не колонка пользователя. null =
    // у тенанта нет живых филиалов (одноточечный автосервис).
    currentPointId: sessionPointId ?? null,
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

  /**
   * ТОКЕН СЕССИИ. Филиал (163) едет claim'ом `pointId` и живёт ровно столько,
   * сколько живёт сессия: две сессии одного человека (телефон и веб) могут
   * работать в РАЗНЫХ филиалах и не мешают друг другу. Раньше филиал лежал в
   * users.current_point_id — одной колонке на все устройства, — и переключение
   * на телефоне молча уводило веб в чужой автосервис.
   *
   * pointId = null означает РОВНО ОДНО: у тенанта нет ни одного живого филиала
   * (одноточечный автосервис). Рабочего режима «все филиалы» больше нет.
   */
  private generateToken(userID: string, tenantID: string | undefined, pointId: string | null): string {
    const jti = randomUUID();
    return this.jwtService.sign({ sub: userID, tenantId: tenantID, jti, pointId });
  }

  /**
   * ДОСТУПНЫЕ СОТРУДНИКУ ЖИВЫЕ ФИЛИАЛЫ, в порядке пикера (основной сервис →
   * sort_order → имя → id). Предикат доступа — ОДИН на весь монорепо, функция
   * autexa_available_points из миграции 163; порядок задаёт вызывающий, потому
   * что планировщик волен инлайнить функцию и потерять внутренний ORDER BY.
   *
   * Тенанта нет (глобальный суперадмин) → пусто: филиалов у него не бывает.
   */
  private async availablePoints(
    tenantID: string | null,
    userID: string,
  ): Promise<Array<{ id: string; name: string; address: string | null; isMain: boolean }>> {
    if (!tenantID || tenantID === NO_TENANT_ID) return [];
    const { rows } = await this.pool.query(
      `SELECT a.id::text as id, a.name, a.address, a.is_main
         FROM autexa_available_points($1::uuid, $2::uuid) a
        ORDER BY a.is_main DESC, a.sort_order ASC, lower(a.name) ASC, a.id ASC`,
      [tenantID, userID],
    );
    return rows.map((r) => ({
      id: r.id as string,
      name: r.name as string,
      address: (r.address as string | null) ?? null,
      isMain: !!r.is_main,
    }));
  }

  /**
   * ЗАПОМНИТЬ ПОСЛЕДНИЙ ВЫБРАННЫЙ ФИЛИАЛ. users.current_point_id перестал быть
   * механизмом переключения (163) и остался РОВНО подсказкой «куда этот человек
   * заходил в прошлый раз»: её honours autexa_default_point при входе старого
   * клиента и при подстановке филиала сессии без claim'а. Ни одна выборка
   * данных на эту колонку больше не опирается.
   *
   * Ошибку глотаем СОЗНАТЕЛЬНО: это подсказка для следующего входа, а не часть
   * авторизации. Уронить успешный вход из-за неё — обменять удобство на отказ
   * в работе.
   */
  private async rememberPoint(userID: string, pointId: string | null): Promise<void> {
    if (!pointId) return;
    try {
      await this.pool.query(`UPDATE users SET current_point_id=$1 WHERE id=$2`, [pointId, userID]);
    } catch (err) {
      this.logger.warn(`current_point_id remember failed for ${userID}: ${err instanceof Error ? err.message : err}`);
    }
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
    user: { userID: string; tenantID: string; currentPointId?: string | null; jti?: string },
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
    //
    // ГРАНИЦА «ПАРОЛЬ ИЗМЕНЁН» (165) — ТЕМ ЖЕ ЗАПРОСОМ И ТОЖЕ МИМО КЭША. Без
    // неё смена пароля переставала выгонять вора: проверка границы живёт в
    // JwtStrategy, но её результат кешируется на 30 секунд, а кеш
    // внутрипроцессный — в docker-compose реплик backend несколько, у каждой
    // свой. В этом окне украденный токен продлевался, и вор получал СВЕЖИЙ
    // токен, выписанный уже ПОСЛЕ смены пароля: дальше он проходит границу
    // законно и живёт ещё 30 суток. Выражение — общее с JwtStrategy
    // (auth/session-boundary.ts), чтобы две редакции правила не разъехались;
    // сравнение считает база, а не часы Node.
    const tokenIat = tokenIatOf(decoded);
    const { rows } = await this.pool.query(
      `SELECT u.is_active, u.dismissed_at, u.purged_at,
              ${sessionStaleSql('$2')}
         FROM users u
        WHERE u.id=$1`,
      [user.userID, tokenIat],
    );
    if (rows.length === 0 || rows[0].dismissed_at || rows[0].purged_at || !rows[0].is_active) {
      throw new UnauthorizedException({ message: 'Аккаунт недоступен' });
    }
    if (rows[0].session_stale === true) {
      throw new UnauthorizedException({ message: SESSION_STALE_MESSAGE });
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
    // ФИЛИАЛ ПЕРЕЕЗЖАЕТ В НОВЫЙ ТОКЕН (163). Иначе тихое продление сессии
    // молча перекидывало бы человека в филиал по умолчанию: он продолжает
    // работать, думая, что сидит в прежнем, а чеки уходят в другой автосервис.
    // Филиал уже проверен на живость и доступность JwtStrategy этого же
    // запроса — второй проверки не нужно.
    return { token: this.generateToken(user.userID, tenantID, user.currentPointId ?? null) };
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
  // Пояс крона — «тихий час», а НЕ бизнес-граница суток: строки отбираются по
  // `expires_at < now()`, это одно и то же для тенанта в Калининграде и на
  // Камчатке. Переводить джоб на пояс тенанта нечего — календарного дня в нём
  // нет.
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

    // ── ШАГ 1 ЗАКОНЧЕН: пароль верен, решаем, нужен ли выбор филиала ────────
    const points = await this.availablePoints(row.tenant_id ?? null, row.id);

    // ДОСТУПНЫХ ФИЛИАЛОВ НЕТ, А У ТЕНАНТА ОНИ ЕСТЬ — ЭТО ОТКАЗ, А НЕ ВХОД БЕЗ
    // ФИЛИАЛА (165). Состояние появилось вместе с разделением «доступ не
    // настроен» и «доступ есть, но филиал закрыт»: сотрудник, назначенный
    // только на заархивированный филиал, раньше молча проваливался в ветку
    // «доступны все живые» и получал доступ ко всей сети, включая основной
    // сервис. Теперь список пуст — и пускать его нельзя ни в каком виде:
    // сессия без филиала у тенанта С филиалами рождает денежные строки с
    // point_id = NULL, невидимые в каждом филиальном срезе (см.
    // common/point-scope.ts). Запрос выполняется ТОЛЬКО в этой редкой ветке,
    // поэтому вход одноточечного тенанта не дорожает.
    //
    // КОГО СЮДА БОЛЬШЕ НЕ ЗАНОСИТ (166): держателя права управления персоналом
    // (владелец, директор, админ сети). Он и так распоряжается филиалами и
    // назначениями, поэтому запереть его закрытием филиала — значит лишить
    // единственного человека, который вправе это починить, возможности войти.
    // Ему autexa_available_points отдаёт основной сервис, список непустой, и
    // до этой ветки он просто не доходит. Правило целиком живёт в SQL-функции
    // (миграция 166) — ВТОРОЙ КОПИИ ЗДЕСЬ БЫТЬ НЕ ДОЛЖНО: вход, обмен на
    // сессию, проверка на каждом запросе и подстановка филиала по умолчанию
    // обязаны отвечать на «кому что доступно» одинаково.
    if (points.length === 0 && row.tenant_id) {
      const { rows: live } = await this.pool.query(
        `SELECT EXISTS(SELECT 1 FROM tenant_points WHERE tenant_id=$1 AND is_active) as has_points`,
        [row.tenant_id],
      );
      if (live[0]?.has_points === true) {
        this.logger.warn(`Login FAILED: phone=${phone} — no accessible point`);
        throw new ForbiddenException({
          message: 'Вам не назначен ни один действующий филиал — обратитесь к руководителю',
        });
      }
    }

    // Ноль или один доступный филиал — выбора не существует. Одноточечный
    // автосервис (филиалов нет вовсе) получает pointId = null и не замечает
    // этой волны вообще; сотрудник, приписанный к одному филиалу, входит в
    // него молча, ровно как раньше.
    if (points.length <= 1) {
      const pointId = points[0]?.id ?? null;
      await this.rememberPoint(row.id, pointId);
      const token = this.generateToken(row.id, row.tenant_id, pointId);
      return { token, user: mapUserRow(row, pointId) };
    }

    // ── СТАРАЯ СБОРКА (3.5 / 3.6) — ВХОДИТ ПО-СТАРОМУ ───────────────────────
    // В проде стоят приложения, которые про второй шаг ничего не знают и ждут
    // токен сразу. Ответ без `token` они прочитать не смогут — это пустой экран
    // у живого автосервиса. Поэтому филиал за них выбирает СЕРВЕР: последний
    // использованный, иначе основной сервис (autexa_default_point). Ключ к
    // ветке — явный признак поддержки в запросе, а не догадка по User-Agent.
    if (dto.supportsPointSelect !== true) {
      const { rows: fallback } = await this.pool.query(
        `SELECT autexa_default_point($1::uuid, $2::uuid, $3::uuid)::text as point_id`,
        [row.tenant_id, row.id, row.current_point_id ?? null],
      );
      const pointId = (fallback[0]?.point_id as string | null) ?? points[0].id;
      await this.rememberPoint(row.id, pointId);
      const token = this.generateToken(row.id, row.tenant_id, pointId);
      return { token, user: mapUserRow(row, pointId) };
    }

    // ── ШАГ 2 ВПЕРЕДИ: отдаём список и промежуточный токен ──────────────────
    // Полноценного токена здесь НЕТ и быть не может: сессия без филиала — это
    // ровно тот режим «все филиалы», из-за которого деньги записывались в
    // никуда. Пароль во втором шаге больше не участвует, поэтому промежуточный
    // токен живёт минуты и помечен назначением, с которым JwtStrategy не
    // пускает его ни в одну обычную ручку.
    const selectToken = this.jwtService.sign(
      { sub: row.id, tenantId: row.tenant_id, jti: randomUUID(), purpose: POINT_SELECT_PURPOSE },
      { expiresIn: POINT_SELECT_TTL_SECONDS },
    );
    const { rows: preferred } = await this.pool.query(
      `SELECT autexa_default_point($1::uuid, $2::uuid, $3::uuid)::text as point_id`,
      [row.tenant_id, row.id, row.current_point_id ?? null],
    );
    return {
      pointSelectionRequired: true as const,
      selectToken,
      expiresIn: POINT_SELECT_TTL_SECONDS,
      points,
      // Куда человек заходил в прошлый раз — чтобы клиент подсветил пункт, а не
      // заставлял вспоминать. Выбор всё равно делает человек.
      defaultPointId: (preferred[0]?.point_id as string | null) ?? points[0].id,
    };
  }

  /**
   * ШАГ 2 ВХОДА: обменять промежуточный токен + выбранный филиал на токен
   * сессии. Пароль здесь НЕ участвует — он уже проверен на шаге 1.
   *
   * ПОЧЕМУ ЭТО ОТДЕЛЬНАЯ ПУБЛИЧНАЯ РУЧКА, А НЕ ЗАЩИЩЁННАЯ JwtAuthGuard'ом:
   * промежуточный токен намеренно НЕ проходит guard (JwtStrategy отбивает его
   * по назначению). Иначе им можно было бы ходить в обычные ручки — работать
   * без филиала.
   *
   * ОДИН ОБМЕН НА ТОКЕН. jti промежуточного токена атомарно уходит в
   * revoked_tokens тем же claim-механизмом, что и ротация /auth/refresh
   * (INSERT ... ON CONFLICT DO NOTHING + rowCount): выигрывает ровно один
   * запрос. Поэтому повторный обмен — хоть случайный ретрай, хоть перехваченный
   * токен — получает 401, а не второй живой токен в другой филиал.
   *
   * ЖИВЫЕ ПРОВЕРКИ ЗАНОВО. Между шагами проходят минуты: сотрудника могли
   * уволить, деактивировать или снять с филиала. Проверяем аккаунт и
   * доступность филиала ещё раз — промежуточный токен не консервирует права.
   */
  async selectPoint(dto: SelectPointDto) {
    let decoded: Record<string, unknown>;
    try {
      decoded = this.jwtService.verify(dto.selectToken) as Record<string, unknown>;
    } catch {
      // Истёк / подделан / подписан другим ключом — все три означают одно:
      // начинать вход заново. Различать их клиенту нечем и незачем.
      throw new UnauthorizedException({ message: 'Время выбора филиала истекло — войдите заново' });
    }
    if (decoded.purpose !== POINT_SELECT_PURPOSE) {
      throw new UnauthorizedException({ message: 'Неверный токен' });
    }
    const userID = decoded.sub as string | undefined;
    const jti = decoded.jti as string | undefined;
    if (!userID || !jti) {
      throw new UnauthorizedException({ message: 'Неверный токен' });
    }

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
    const row = rows[0];
    if (row.dismissed_at || row.purged_at) {
      throw new UnauthorizedException({ message: 'Аккаунт уволен' });
    }
    if (!row.is_active) {
      throw new UnauthorizedException({ message: 'Аккаунт деактивирован' });
    }

    // Филиал обязан быть доступен ИМЕННО ЭТОМУ сотруднику: без проверки любой
    // сотрудник тенанта подставил бы в шаг 2 чужой филиал и получил бы законный
    // токен в чужой автосервис.
    const points = await this.availablePoints(row.tenant_id ?? null, userID);
    const chosen = points.find((p) => p.id === dto.pointId);
    if (!chosen) {
      throw new ForbiddenException({ message: 'Филиал недоступен' });
    }

    // Атомарный claim: промежуточный токен становится недействительным ДО
    // выдачи сессионного. expires_at = настоящий exp промежуточного токена,
    // чтобы строка blacklist пережила токен, который она гасит.
    const exp = typeof decoded.exp === 'number' ? new Date(decoded.exp * 1000) : new Date(Date.now() + 600_000);
    const tenantForRow = row.tenant_id && row.tenant_id !== NO_TENANT_ID ? row.tenant_id : null;
    const claimed = await this.blacklistToken({
      jti,
      userId: userID,
      tenantId: tenantForRow,
      graceMs: 0,
      expiresAt: exp,
      mode: 'claim',
    });
    if (!claimed) {
      throw new UnauthorizedException({ message: 'Выбор филиала уже использован — войдите заново' });
    }

    await this.rememberPoint(userID, chosen.id);
    this.logger.log(`Login OK (point): user=${userID} point=${chosen.id}`);
    const token = this.generateToken(userID, row.tenant_id, chosen.id);
    return { token, user: mapUserRow(row, chosen.id) };
  }

  /**
   * МГНОВЕННАЯ СМЕНА ФИЛИАЛА ЖИВОЙ СЕССИЕЙ — ТОЛЬКО РУКОВОДИТЕЛЮ (167).
   *
   * ТРЕБОВАНИЕ ВЛАДЕЛЬЦА ДОСЛОВНО: «чтобы владелец автосервиса мог
   * переключаться между филиалами без суеты с вводом заново паролей — просто
   * нажал, переключился». Для СОТРУДНИКА прежний сценарий остаётся дословно:
   * выйти и войти, выбрав филиал (163). У мастера филиал определяет, куда
   * уходят его деньги, и случайное переключение дороже неудобства.
   *
   * ЭТО НЕ ВХОД БЕЗ ПАРОЛЯ И НЕ ПОВЫШЕНИЕ ПРАВ. Личность подтверждена ЖИВОЙ
   * сессией (JwtAuthGuard пропустил запрос), а филиал меняется только на тот,
   * к которому у актора УЖЕ есть доступ, — то есть ровно на тот, в который он
   * и так вошёл бы, выйдя и войдя заново. Новых возможностей не появляется,
   * исчезает только перезаход.
   *
   * ТЕХНИЧЕСКИ ЭТО ПЕРЕВЫПУСК СЕССИИ, А НЕ ПРАВКА ТОКЕНА. Филиал лежит в
   * ПОДПИСАННОМ токене (163) — поменять его в выданном токене физически
   * нельзя. Поэтому: чеканим новый токен с новым филиалом и ГАСИМ старый тем
   * же claim-механизмом, что ротация /auth/refresh. Старый токен обязан
   * умереть НЕМЕДЛЕННО (graceMs = 0, без grace-окна refresh'а) по двум
   * причинам: (а) перехваченный прежний токен не должен остаться рабочим;
   * (б) он привязан к ПРЕЖНЕМУ филиалу, и его доживание означало бы запросы в
   * старый филиал из интерфейса, который уже показывает новый, — то есть
   * деньги не в том автосервисе. Обрыв in-flight запросов при этом безопасен:
   * оба клиента гасят сессию только на 401 со СВОИМ текущим bearer'ом
   * (mobile — сверка epoch'а, web — только /auth/me и «филиал больше не
   * доступен»), а здесь у них уже новый.
   *
   * ПРАВО РЕШАЕТ БАЗА, А НЕ TypeScript. «Кто вправе управлять персоналом» —
   * autexa_can_manage_staff (миграция 166), та же функция, которой пользуется
   * правило доступных филиалов. Второй копии правила в коде быть не должно:
   * отставшая копия — это либо запертый владелец, либо мастер, мгновенно
   * прыгающий по чужим кассам.
   *
   * ДОСТУП К ЦЕЛЕВОМУ ФИЛИАЛУ — тоже существующий предикат
   * autexa_point_is_allowed (163/165/166). Одним вызовом закрыты все три
   * вопроса: филиал жив, принадлежит тому же тенанту и разрешён этому актору.
   * Поэтому архивный, чужой и несуществующий филиал получают ОДИН и тот же
   * отказ — по ответу нельзя выяснить, существует ли филиал в чужой сети.
   *
   * RATE-LIMIT — глобальный write-бакет RateLimitGuard, как у /auth/refresh и
   * /auth/select-point (см. комментарий у ручки в auth.controller.ts).
   */
  async switchPoint(
    actor: { userID: string; tenantID: string; currentPointId?: string | null; jti?: string },
    rawToken: string,
    dto: SwitchPointDto,
  ) {
    const oldJti = actor.jti;
    if (!oldJti) {
      // Токен без jti нельзя ревокировать → старый филиал остался бы рабочим
      // параллельно с новым. Такие токены не выпускаются с 021 — fail-closed.
      throw new UnauthorizedException({ message: 'Сессия устарела — войдите заново' });
    }

    // rawToken — тот же bearer, что прошёл JwtAuthGuard (подпись проверена
    // стратегией); decode без verify достаточен ради claims, которые guard не
    // прокидывает в актор: impersonatedBy и exp.
    const decoded = rawToken ? (this.jwtService.decode(rawToken) as Record<string, unknown> | null) : null;
    if (!decoded || decoded.jti !== oldJti) {
      throw new UnauthorizedException({ message: 'Неверный токен' });
    }
    // ВХОД ПОД ПОЛЬЗОВАТЕЛЕМ НЕ ПЕРЕКЛЮЧАЕТСЯ — серверный гейт, зеркало
    // /auth/refresh. Иначе 30-минутный impersonation-токен обменивался бы на
    // полноценный 30-дневный директорский БЕЗ следа impersonation: отмывание
    // прав через кнопку смены филиала.
    if (decoded.impersonatedBy) {
      throw new ForbiddenException({ message: 'Сессия входа под пользователем не переключает филиал' });
    }

    // Живая проверка аккаунта МИМО 30с auth-кэша — тем же запросом, которым
    // берётся профиль для ответа (клиенту не нужно отдельно звать /auth/me).
    // Уволенный минуту назад руководитель не должен получить свежий
    // 30-дневный токен внутри окна кэша.
    //
    // ГРАНИЦА «ПАРОЛЬ ИЗМЕНЁН» (165) — ТЕМ ЖЕ ЗАПРОСОМ. Ровно тот же пробел,
    // что закрыт в /auth/refresh: JwtStrategy сверяет границу, но кеширует
    // результат на 30 секунд, и кеш внутрипроцессный — реплик backend в
    // docker-compose несколько. Владелец меняет пароль, чтобы выбить вора с
    // угнанного телефона, а вор в этом окне жмёт «сменить филиал» и получает
    // СВЕЖИЙ 30-дневный токен, выписанный уже ПОСЛЕ смены пароля, — такой токен
    // границу проходит законно, и смена пароля не выгоняет никого. Выражение —
    // общее с JwtStrategy (auth/session-boundary.ts): вторая редакция правила
    // рано или поздно отстанет от первой, а отставание здесь и есть дыра.
    const tokenIat = tokenIatOf(decoded);
    const { rows } = await this.pool.query(
      `SELECT ${USER_WITH_TENANT_COLUMNS},
              ${sessionStaleSql('$2')}
       FROM users u
       LEFT JOIN tenants t ON t.id = u.tenant_id
       ${ROLE_JOIN}
       WHERE u.id = $1`,
      [actor.userID, tokenIat],
    );
    if (rows.length === 0) {
      throw new UnauthorizedException({ message: 'Пользователь не найден' });
    }
    const row = rows[0];
    if (row.dismissed_at || row.purged_at) {
      throw new UnauthorizedException({ message: 'Аккаунт уволен' });
    }
    if (!row.is_active) {
      throw new UnauthorizedException({ message: 'Аккаунт деактивирован' });
    }
    // ДО ветки «уже в этом филиале»: стухшая сессия не имеет права получить ни
    // токен, ни профиль в ответе — ни в одной ветке ручки.
    if (row.session_stale === true) {
      throw new UnauthorizedException({ message: SESSION_STALE_MESSAGE });
    }

    // УЖЕ В ЭТОМ ФИЛИАЛЕ — НЕ ОШИБКА. Повторный тап по текущему филиалу и
    // ретрай после обрыва сети обязаны быть безобидными: ничего не выпускаем,
    // ничего не гасим, отдаём состояние как есть. Токен в ответе — ТОТ ЖЕ, что
    // прислал клиент: так commit на клиенте безопасен в обеих ветках, а
    // `token: null` в этой ветке обнулял бы живую сессию у клиента, который
    // сохраняет ответ не глядя.
    const current = actorPointId(actor);
    if (current && current === dto.pointId) {
      return { token: rawToken, user: mapUserRow(row, current), currentPointId: current, switched: false as const };
    }

    // ОДИН ЗАПРОС НА ОБА ПРЕДИКАТА: право управления персоналом (166) и доступ
    // к целевому филиалу (163/165/166). Оба ответа считает база — правило
    // доступа в монорепо ровно одно.
    const { rows: gate } = await this.pool.query(
      `SELECT autexa_can_manage_staff($2::uuid) as can_manage,
              autexa_point_is_allowed($1::uuid, $2::uuid, $3::uuid) as point_allowed`,
      [row.tenant_id ?? null, actor.userID, dto.pointId],
    );

    // ОТКАЗ СОТРУДНИКУ — ЭТО ПРАВИЛО, А НЕ ПОЛОМКА, и текст обязан это
    // объяснять: человек должен понять, что делать дальше, а не решить, что
    // приложение сломалось. Проверяем ДО доступа к филиалу — мастер не должен
    // по ответу выяснять, какие филиалы ему разрешены.
    if (gate[0]?.can_manage !== true) {
      throw new ForbiddenException({
        message:
          'Мгновенное переключение филиала доступно только руководителю. ' +
          'Чтобы работать в другом филиале, выйдите из приложения и войдите заново, выбрав нужный филиал.',
      });
    }
    if (gate[0]?.point_allowed !== true) {
      throw new ForbiddenException({ message: 'Филиал недоступен' });
    }

    // Атомарный claim: старый токен становится недействительным ДО чеканки
    // нового. Строка уже есть (logout, ротация refresh'а или ПАРАЛЛЕЛЬНОЕ
    // переключение тем же токеном) → 401 и никакого второго токена: у сессии
    // всегда ровно одна живая линия. expires_at = настоящий exp старого
    // токена, чтобы строка blacklist пережила токен, который она гасит.
    const exp = typeof decoded.exp === 'number' ? new Date(decoded.exp * 1000) : new Date(Date.now() + 30 * 86400000);
    const tenantForRow = row.tenant_id && row.tenant_id !== NO_TENANT_ID ? row.tenant_id : null;
    const claimed = await this.blacklistToken({
      jti: oldJti,
      userId: actor.userID,
      tenantId: tenantForRow,
      graceMs: 0,
      expiresAt: exp,
      mode: 'claim',
    });
    if (!claimed) {
      throw new UnauthorizedException({ message: 'Токен отозван' });
    }
    // Без сброса позитивного auth-кэша старый токен прожил бы ещё до 30
    // секунд — ровно то окно, в котором перехваченный токен работает.
    invalidateAuthToken(actor.userID, oldJti);

    await this.rememberPoint(actor.userID, dto.pointId);
    this.logger.log(`Point switch: user=${actor.userID} ${current ?? 'none'} -> ${dto.pointId}`);
    // Sentinel-тенант (tenant-less суперадмин) в токен не зашивается — ровно
    // как при login: стратегия подставит его снова при валидации.
    const tenantID = row.tenant_id && row.tenant_id !== NO_TENANT_ID ? row.tenant_id : undefined;
    const token = this.generateToken(actor.userID, tenantID, dto.pointId);
    return {
      token,
      user: mapUserRow(row, dto.pointId),
      currentPointId: dto.pointId,
      switched: true as const,
    };
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

      // Тенант только что создан — филиалов у него нет по построению, поэтому
      // филиал сессии null: одноточечный режим, поведение прежнее.
      const token = this.generateToken(userRows[0].id, tenantID, null);
      return { token, user: mapUserRow(userRows[0], null) };
    } catch (err) {
      await client.query('ROLLBACK');
      this.logger.error(`Register error: ${err}`);
      throw new InternalServerErrorException({ message: 'Ошибка сервера' });
    } finally {
      client.release();
    }
  }

  /**
   * Профиль владельца ЭТОЙ сессии. Филиал берётся из актора (то есть из
   * токена), а не из users.current_point_id: /auth/me — то место, откуда
   * клиент узнаёт свой филиал на старте, и колонка отдала бы вебу филиал,
   * выбранный в телефоне.
   */
  async me(actor: { userID: string; currentPointId?: string | null }) {
    const { rows } = await this.pool.query(
      `SELECT ${USER_WITH_TENANT_COLUMNS}
       FROM users u
       LEFT JOIN tenants t ON t.id = u.tenant_id
       ${ROLE_JOIN}
       WHERE u.id = $1`,
      [actor.userID],
    );

    if (rows.length === 0) {
      throw new UnauthorizedException({ message: 'Пользователь не найден' });
    }

    return mapUserRow(rows[0], actor.currentPointId ?? null);
  }

  async updateAvatar(userID: string, avatar: string) {
    await this.pool.query('UPDATE users SET avatar=$1 WHERE id=$2', [avatar, userID]);
    return { avatar };
  }
}
