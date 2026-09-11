import { Injectable, UnauthorizedException, Inject } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';
import { ttlCache } from '../common/ttl-cache';
import { authCacheKey, AUTH_CACHE_TTL_MS, NO_TENANT_ID, ValidatedUser } from '../common/auth-cache';
import { mergeEffectivePermissions } from '../common/role-matrix';
import { POINT_SELECT_PURPOSE } from './point-session';
import { SESSION_STALE_MESSAGE, sessionStaleSql, tokenIatOf } from './session-boundary';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

    // ── Промежуточный токен выбора филиала не пускается НИКУДА ──────────────
    // 163: между шагом «телефон + пароль» и шагом «выбрал филиал» клиент держит
    // краткоживущий токен с назначением point_select. Он подписан тем же
    // ключом, поэтому без этой проверки им можно было бы ходить в обычные
    // ручки — то есть работать вообще без филиала, ровно в том режиме «все
    // филиалы», который эта волна и убирает. Отбиваем ДО любых обращений к
    // базе: назначение видно прямо в claims.
    if (payload.purpose === POINT_SELECT_PURPOSE) {
      throw new UnauthorizedException({ message: 'Выберите филиал, чтобы продолжить' });
    }

    // ФИЛИАЛ СЕССИИ — из токена (163). Форму проверяем здесь: мусор в claim'е
    // ушёл бы в uuid-сравнение и дал 22P02 → 500 на каждом запросе вместо
    // честного «войдите заново».
    const rawPoint = payload.pointId;
    const tokenPointId = typeof rawPoint === 'string' && UUID_RE.test(rawPoint) ? rawPoint : null;

    // МОМЕНТ ВЫПУСКА ТОКЕНА (claim `iat`, секунды) — нужен для границы
    // users.sessions_valid_from (165): смена пароля обязана гасить ВСЕ ранее
    // выданные сессии, а списка их jti нигде нет. Токена без `iat` не бывает
    // (jsonwebtoken проставляет его всегда), но если он пришёл — считаем
    // сессию неопределённо старой: fail-closed решает база ниже.
    const tokenIat = tokenIatOf(payload);

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
    //   • Филиал в ключ не добавляется и не должен: он часть ПОДПИСАННОГО
    //     токена, а jti у каждого токена свой — (userID, jti) уже однозначно
    //     определяет филиал сессии.
    if (jti) {
      return ttlCache.wrap(authCacheKey(userID, jti), AUTH_CACHE_TTL_MS, () =>
        this.loadValidatedUser(userID, jti, tokenPointId, tokenIat),
      );
    }

    // Legacy tokens without a jti can't be individually revoked, so we don't
    // cache them — fall through to a live check every time.
    return this.loadValidatedUser(userID, undefined, tokenPointId, tokenIat);
  }

  private async loadValidatedUser(
    userID: string,
    jti: string | undefined,
    tokenPointId: string | null,
    tokenIat: number | null,
  ): Promise<ValidatedUser> {
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
    //
    // 163 — ФИЛИАЛ СЕССИИ проверяется/резолвится ЭТИМ ЖЕ запросом, а не вторым
    // хопом: он и так выполняется на каждом холодном валидейте и кешируется на
    // 30 секунд, поэтому филиал обходится в НОЛЬ дополнительных обращений к БД.
    //   • токен несёт филиал → autexa_point_is_allowed отвечает, жив ли он ещё
    //     и разрешён ли ещё этому сотруднику;
    //   • токен филиала не несёт (сборка/сессия до 163 либо тенант без
    //     филиалов) → autexa_default_point подставляет его сам.
    // ::text — чтобы значение приезжало строкой, как tenant_id (сравнения и
    // ключи кеша строковые).
    //
    // 165 — ГРАНИЦА ЖИЗНИ СЕССИЙ (`session_stale`) считается ТОЖЕ здесь и ТОЖЕ
    // в базе: сравнивать claim `iat` с users.sessions_valid_from в Node значило
    // бы поставить безопасность в зависимость от расхождения часов Node и
    // Postgres. Токен без `iat` при выставленной границе — стухший
    // (fail-closed): проверить его возраст нечем. Само выражение — ОДНО на весь
    // backend (auth/session-boundary.ts): его же подставляют живые проверки
    // /auth/refresh и /auth/switch-point, которые ходят в базу мимо этого кеша.
    //
    // 165 — «ЕСТЬ ЛИ У ТЕНАНТА ЖИВЫЕ ФИЛИАЛЫ» (`tenant_has_points`). Нужно,
    // чтобы отличить законную сессию без филиала (одноточечный автосервис) от
    // сессии сотрудника, которому не доступен НИ ОДИН живой филиал — например
    // потому, что его единственный филиал закрыли. Вторая обязана умереть: без
    // филиала её денежные записи получили бы point_id = NULL и не попали бы ни
    // в один филиальный срез (см. common/point-scope.ts).
    const { rows } = await this.pool.query(
      `SELECT u.is_active, u.tenant_id::text as tenant_id, u.role, u.dismissed_at, u.purged_at,
              r.matrix as role_matrix,
              ${sessionStaleSql('$3')},
              EXISTS (SELECT 1 FROM tenant_points p
                       WHERE p.tenant_id = u.tenant_id AND p.is_active) as tenant_has_points,
              CASE WHEN $2::uuid IS NULL THEN NULL
                   ELSE autexa_point_is_allowed(u.tenant_id, u.id, $2::uuid) END as point_allowed,
              CASE WHEN $2::uuid IS NULL
                   THEN autexa_default_point(u.tenant_id, u.id, u.current_point_id) END::text as default_point_id
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
       WHERE u.id=$1`,
      [userID, tokenPointId, tokenIat],
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

    // ПАРОЛЬ СМЕНИЛИ — ВСЕ ПРЕЖНИЕ СЕССИИ МЕРТВЫ (165). Раньше пароль менялся,
    // а выданные до этого токены жили до 30 суток: украденный или оставшийся на
    // чужом телефоне токен продолжал работать, и сменить пароль «чтобы выгнать
    // чужого» было нельзя в принципе. Ревокация по jti (021) выразить это не
    // может — списка живых jti пользователя не существует, поэтому граница
    // хранится в users.sessions_valid_from и проверяется здесь.
    if (rows[0].session_stale === true) {
      throw new UnauthorizedException({ message: SESSION_STALE_MESSAGE });
    }

    // ФИЛИАЛ БОЛЬШЕ НЕ ДОСТУПЕН — СЕССИЯ ОБЯЗАНА УМЕРЕТЬ (163). Именно этот
    // 401 и есть «снятие доступа обесточивает активные сессии»: владелец убрал
    // сотрудника с филиала (или суперадмин заархивировал филиал), auth-кеш
    // этого сотрудника сброшен, следующий же его запрос приходит сюда и
    // получает отказ. Продолжать пускать нельзя ни в каком виде: молча
    // подставить другой филиал значило бы, что человек дальше пробивает чеки,
    // думая, что работает в прежнем.
    if (tokenPointId && rows[0].point_allowed !== true) {
      throw new UnauthorizedException({ message: 'Филиал больше не доступен — войдите заново' });
    }

    // ФИЛИАЛОВ У ТЕНАНТА НЕТ — законно; ЕСТЬ, НО СОТРУДНИКУ НЕ ДОСТУПЕН НИ
    // ОДИН — нет (165). Второе состояние появилось вместе с разделением
    // «доступ не настроен» и «доступ есть, но филиал закрыт»: сотрудник,
    // назначенный только на заархивированный филиал, больше не проваливается в
    // «доступны все живые». Пустить его дальше было бы хуже отказа — сессия без
    // филиала у тенанта С филиалами штампует денежные строки с point_id = NULL,
    // невидимые в КАЖДОМ филиальном срезе.
    //
    // ДЕРЖАТЕЛЬ ПРАВА УПРАВЛЕНИЯ ПЕРСОНАЛОМ СЮДА НЕ ПОПАДАЕТ (166): ему
    // autexa_default_point возвращает основной сервис, потому что сама
    // autexa_available_points отдаёт его при «назначения есть, живых нет».
    // Проверять это ещё раз здесь НЕЛЬЗЯ — правило доступа одно и живёт в
    // SQL-функции; вторая копия неминуемо отстанет от первой.
    if (!tokenPointId && rows[0].tenant_has_points === true && !rows[0].default_point_id) {
      throw new UnauthorizedException({
        message: 'Вам не назначен ни один действующий филиал — обратитесь к руководителю',
      });
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
      // Филиал сессии: из токена, если он там есть и всё ещё разрешён; иначе
      // подставленный сервером (старая сборка / сессия до 163 / филиал появился
      // у тенанта уже после входа). null — только когда живых филиалов у
      // тенанта нет вовсе.
      currentPointId: tokenPointId ?? (rows[0].default_point_id as string | null) ?? null,
      jti,
    };
  }
}
