import {
  Injectable,
  Inject,
  BadRequestException,
  ConflictException,
  NotFoundException,
  ForbiddenException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import * as bcrypt from 'bcryptjs';
import { PG_POOL } from '../database.module';
import { PushService } from '../push/push.service';
import { normalizePhone } from '../common/normalize-phone';
import { invalidateAuthUser, NO_TENANT_ID } from '../common/auth-cache';
import { assignedToPointSql } from './user-points-sql';
import { CANONICAL_PERMISSION_KEYS, mergeEffectivePermissions } from '../common/role-matrix';
import { userHasPermission } from '../common/guards/permissions.guard';
import { assertRoleAssignable } from '../roles/privilege-ceiling';
import {
  DEFAULT_TIMEZONE,
  getTenantTimezone,
  listTenantTimezones,
  zonedMidnight,
  zonedMonthKey,
} from '../common/timezone';
import { invalidateReportsForTenant } from '../common/reports-cache';

// Roles that may be assigned through this service. Anything outside this set
// is rejected up front so a manipulated DTO can't sneak a role string past
// the DB CHECK constraint (which would still reject it, but the early throw
// gives a clearer error and avoids relying on the DB layer alone).
const ALLOWED_ROLES = new Set(['master', 'admin', 'director', 'superadmin']);

// Only `superadmin` may mint or grant the `superadmin` role. A `director`
// cannot escalate themselves or anyone else to `superadmin`.
const SUPERADMIN_ONLY_ROLES = new Set(['superadmin']);

// Roles allowed to hand out «Директор» (строковую роль ИЛИ role_id роли с
// system_key='director'). Без этого admin с user_management назначал бы
// директора себе/любому мастеру и получал owner-class навсегда (эскалация,
// карта 6.3).
const DIRECTOR_GRANTING_ROLES = new Set(['director', 'superadmin']);

@Injectable()
export class UsersService {
  private readonly logger = new Logger('UsersService');

  constructor(
    @Inject(PG_POOL) private pool: Pool,
    // Round 15 — разрыв инвалидации: смена ставки перепекает salary/profit
    // чеков месяца и сбрасывает СЕРВЕРНЫЕ кэши (invalidateReportsForTenant),
    // но ДРУГИЕ устройства о money-change не узнавали (в отличие от
    // decidePayout / expenses, которые шлют data-push 'cash-changed').
    // PushService — из глобального PushModule.
    private push: PushService,
  ) {}

  /**
   * Round 15 — после пересчёта денег месяца (смена ставки / комиссий) будим
   * остальные устройства тенанта обновить денежные экраны. Fire-and-forget:
   * пуш никогда не источник истины и не валит основную операцию.
   */
  private notifyMoneyChanged(tenantID: string, excludeUserId: string | null): void {
    this.push.sendDataToTenant(tenantID, excludeUserId, { type: 'cash-changed', tenantId: tenantID }).catch(() => {
      /* best-effort */
    });
  }

  /**
   * Reject any role-assignment that the actor is not allowed to perform.
   * Throws ForbiddenException — caller does NOT need to catch this; Nest
   * will turn it into a 403 response.
   */
  private assertCanAssignRole(actorRole: string, requestedRole: string | undefined) {
    if (!requestedRole) return;
    if (!ALLOWED_ROLES.has(requestedRole)) {
      throw new BadRequestException({ message: `Недопустимая роль: ${requestedRole}` });
    }
    if (SUPERADMIN_ONLY_ROLES.has(requestedRole) && actorRole !== 'superadmin') {
      throw new ForbiddenException({ message: 'Только суперадмин может назначить эту роль' });
    }
    // «Директора» выдаёт только директор/суперадмин — admin с user_management
    // не может самоповыситься (или повысить сообщника) до owner-class.
    if (requestedRole === 'director' && !DIRECTOR_GRANTING_ROLES.has(actorRole)) {
      throw new ForbiddenException({ message: 'Только директор может назначить роль «Директор»' });
    }
  }

  /**
   * Назначение role_id роли с system_key='director' — та же прерогатива
   * директора/суперадмина, что и строковая роль 'director' (карта 6.3): иначе
   * admin обошёл бы assertCanAssignRole, выдав СИСТЕМНУЮ роль «Директор» через
   * roleId (клиент шлёт role и roleId независимо).
   */
  private assertCanAssignRoleId(actorRole: string, roleSystemKey: string | null | undefined) {
    if (roleSystemKey === 'director' && !DIRECTOR_GRANTING_ROLES.has(actorRole)) {
      throw new ForbiddenException({ message: 'Только директор может назначить роль «Директор»' });
    }
  }

  /**
   * Смена телефона на уже занятый: create() проверяет дубль заранее, а update()
   * ловит гонку/пропуск на уникальном индексе users(phone) — 23505 переводится
   * в понятный 409 вместо генерик-500 (передача волны A).
   */
  private mapDuplicatePhone(err: unknown): unknown {
    if ((err as { code?: string }).code === '23505') {
      return new ConflictException({ message: 'Пользователь с таким телефоном уже существует' });
    }
    return err;
  }

  /** jsonb-матрица приходит объектом (node-pg) или строкой (легаси text) —
   *  нормализуем к объекту (кривой JSON → {}, fail-closed). */
  private parseRoleMatrix(raw: unknown): unknown {
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw);
      } catch {
        return {};
      }
    }
    return raw;
  }

  /**
   * Resolve which tenant a per-user-by-id operation must run inside.
   *
   * WHY: every per-employee mutation/read in this service is scoped by
   * `WHERE id=$ AND tenant_id=$`. For a director/admin that guard IS the tenant
   * boundary — they may only touch rows in their OWN tenant. But a `superadmin`
   * has no real tenant of their own: `jwt.strategy` maps their NULL tenant_id to
   * the NO_TENANT_ID nil-UUID sentinel, so passing `actor.tenantID` would run
   * `AND tenant_id=<nil-uuid>` and match NOTHING → a spurious «Пользователь не
   * найден» when the admin cabinet edits an employee of a MANAGED tenant.
   *
   * Resolution:
   *   • non-superadmin → return `actor.tenantID` UNCHANGED. Behaviour is
   *     byte-identical to before; the caller's `AND tenant_id=$` still pins them
   *     to their own tenant, and (when the RLS dual-pool is active) the
   *     TenantContextInterceptor independently forces every query through the
   *     app-pool under `tenant_id = app.tenant_id`. A director can never reach
   *     another tenant's user through this path.
   *   • superadmin → look up the TARGET user's OWN tenant_id and act inside it.
   *     Superadmin requests legitimately bypass the tenant CLS (they run on the
   *     admin pool, no RLS — see TenantContextInterceptor), so this cross-tenant
   *     lookup is intended and safe. A missing id 404s cleanly (never a 500).
   *
   * A tenant-less target (another superadmin, tenant_id NULL) collapses to the
   * nil-UUID → downstream `AND tenant_id=$` matches nothing → clean 404, which
   * is correct: such accounts are not managed through the tenant employee cabinet.
   */
  async resolveTenantForTarget(actor: { role: string; tenantID: string }, targetUserId: string): Promise<string> {
    if (actor.role !== 'superadmin') return actor.tenantID;
    const { rows } = await this.pool.query('SELECT tenant_id FROM users WHERE id=$1', [targetUserId]);
    if (rows.length === 0) throw new NotFoundException({ message: 'Пользователь не найден' });
    return (rows[0].tenant_id as string | null) ?? NO_TENANT_ID;
  }

  private mapUser(row: any) {
    let daysOff: number[] = [];
    if (row.days_off) {
      daysOff = typeof row.days_off === 'string' ? JSON.parse(row.days_off) : row.days_off;
    }
    return {
      id: row.id,
      phone: row.phone,
      fullName: row.full_name,
      username: row.username,
      avatar: row.avatar,
      role: row.role,
      // 114 — назначенная роль (Bitrix24-style). NULL = легаси-дефолты строковой роли.
      roleId: row.role_id ?? null,
      salaryPercent: parseFloat(row.salary_percent) || 0,
      productSalaryPercent: parseFloat(row.product_salary_percent) || 0,
      permissions: typeof row.permissions === 'string' ? JSON.parse(row.permissions) : row.permissions || {},
      daysOff,
      sortOrder: parseInt(row.sort_order) || 0,
      isActive: row.is_active,
      team: row.team || null,
      // 047_expenses_by_employee added these — they may be NULL on legacy rows.
      canAddExpenses: !!row.can_add_expenses,
      dailyExpenseLimit:
        row.daily_expense_limit === null || row.daily_expense_limit === undefined
          ? null
          : parseFloat(row.daily_expense_limit) || 0,
      // 055_user_visibility_flags — FE filters by context, server never hides.
      hiddenFromSchedule: !!row.hidden_from_schedule,
      hiddenEverywhere: !!row.hidden_everywhere,
      // 065_users_dismissed — «Уволенные» recycle bin. NULL on every active
      // employee. dismissed_at set → in the bin (restorable). purged_at set →
      // "deleted completely" but row kept so FKs / historical names resolve.
      dismissedAt: row.dismissed_at ?? null,
      purgedAt: row.purged_at ?? null,
      tenantId: row.tenant_id,
      createdAt: row.created_at,
    };
  }

  /**
   * Сотрудники тенанта.
   *
   * 161 — ФИЛИАЛЬНЫЙ СКОУП ОПЦИОНАЛЕН И ВКЛЮЧАЕТСЯ ЯВНО (`?scope=point`), а не
   * применяется ко всем вызовам. Причина: этим же списком питаются экраны, где
   * филиальный срез был бы вреден или прямо опасен —
   *   • справочник «Сотрудники» и назначение людей на точки (иначе владелец
   *     не смог бы назначить на филиал того, кто на нём ещё не работает);
   *   • резолв ИМЁН в журнале, расходах, зарплате и истории (автор чека с
   *     другого филиала превратился бы в «—»).
   * Явно скоупится ровно то, где чужой сотрудник ведёт к неверным ДЕНЬГАМ:
   * пикер мастера в Кассе — заказ-наряд филиала А не должен оформляться на
   * мастера филиала Б.
   *
   * Предикат — общий с графиком (user_points): сотрудник без назначений виден
   * везде (безопасный дефолт 156).
   */
  async getAll(tenantID: string, pointId: string | null = null) {
    const params: unknown[] = [tenantID];
    const pointFilter = assignedToPointSql('u', '$1', pointId, params);
    const { rows } = await this.pool.query(
      `SELECT id, phone, full_name, username, avatar, role,
              COALESCE(salary_percent, 0) as salary_percent,
              COALESCE(product_salary_percent, 0) as product_salary_percent,
              COALESCE(permissions, '{}') as permissions,
              COALESCE(days_off, '[]') as days_off,
              COALESCE(sort_order, 0) as sort_order,
              is_active, team,
              COALESCE(can_add_expenses, false) as can_add_expenses,
              daily_expense_limit,
              COALESCE(hidden_from_schedule, false) as hidden_from_schedule,
              COALESCE(hidden_everywhere, false) as hidden_everywhere,
              dismissed_at, purged_at, role_id,
              tenant_id, created_at
       FROM users u
       WHERE tenant_id = $1 AND dismissed_at IS NULL AND purged_at IS NULL${pointFilter}
       ORDER BY sort_order, created_at`,
      params,
    );
    return rows.map(this.mapUser);
  }

  async updateOrder(tenantID: string, orderedIds: string[]) {
    // Update sort_order for each user based on position in array
    for (let i = 0; i < orderedIds.length; i++) {
      await this.pool.query(`UPDATE users SET sort_order = $1 WHERE id = $2 AND tenant_id = $3`, [
        i,
        orderedIds[i],
        tenantID,
      ]);
    }
    return { message: 'Порядок обновлён' };
  }

  /** Мастера и админы. `pointId` — тот же опциональный скоуп, что в getAll (161). */
  async getMasters(tenantID: string, pointId: string | null = null) {
    const params: unknown[] = [tenantID];
    const pointFilter = assignedToPointSql('u', '$1', pointId, params);
    const { rows } = await this.pool.query(
      `SELECT id, phone, full_name, username, avatar, role,
              COALESCE(salary_percent, 0) as salary_percent,
              COALESCE(product_salary_percent, 0) as product_salary_percent,
              COALESCE(permissions, '{}') as permissions,
              COALESCE(days_off, '[]') as days_off,
              is_active, team,
              COALESCE(can_add_expenses, false) as can_add_expenses,
              daily_expense_limit,
              COALESCE(hidden_from_schedule, false) as hidden_from_schedule,
              COALESCE(hidden_everywhere, false) as hidden_everywhere,
              dismissed_at, purged_at, role_id,
              tenant_id, created_at
       FROM users u
       WHERE tenant_id = $1 AND is_active = true AND role IN ('master','admin')
         AND dismissed_at IS NULL AND purged_at IS NULL${pointFilter}
       ORDER BY full_name`,
      params,
    );
    return rows.map(this.mapUser);
  }

  async getById(id: string, tenantID: string) {
    const { rows } = await this.pool.query(
      `SELECT id, phone, full_name, username, avatar, role,
              COALESCE(salary_percent, 0) as salary_percent,
              COALESCE(product_salary_percent, 0) as product_salary_percent,
              COALESCE(permissions, '{}') as permissions,
              COALESCE(days_off, '[]') as days_off,
              is_active, team,
              COALESCE(can_add_expenses, false) as can_add_expenses,
              daily_expense_limit,
              COALESCE(hidden_from_schedule, false) as hidden_from_schedule,
              COALESCE(hidden_everywhere, false) as hidden_everywhere,
              dismissed_at, purged_at, role_id,
              tenant_id, created_at
       FROM users WHERE id = $1 AND tenant_id = $2`,
      [id, tenantID],
    );
    // NOTE: intentionally NOT filtered by dismissed_at / purged_at. A dismissed
    // (or purged) user is still referenced by historical checks/shifts, so this
    // must resolve their name. The mapped `dismissedAt` / `purgedAt` tell the
    // client to render «Уволен» read-only and block navigation/editing.
    if (rows.length === 0) throw new NotFoundException({ message: 'Пользователь не найден' });
    return this.mapUser(rows[0]);
  }

  async create(tenantID: string, actorRole: string, dto: any, actorPermissions?: Record<string, boolean>) {
    if (!dto.phone || !dto.password || !dto.fullName) {
      throw new BadRequestException({ message: 'Телефон, пароль и имя обязательны' });
    }

    // Enforce reasonable password strength on creation (matches /auth/register).
    if (typeof dto.password !== 'string' || dto.password.length < 8) {
      throw new BadRequestException({ message: 'Пароль должен быть не менее 8 символов' });
    }

    const role = dto.role || 'master';
    this.assertCanAssignRole(actorRole, role);

    const phone = normalizePhone(dto.phone);

    // Check duplicate phone — both normalized and original format
    const { rows: existsRows } = await this.pool.query(
      `SELECT EXISTS(SELECT 1 FROM users WHERE phone = $1 OR phone = $2) as exists`,
      [phone, dto.phone],
    );
    if (existsRows[0].exists) {
      throw new BadRequestException({ message: 'Пользователь с таким телефоном уже существует' });
    }

    const hash = await bcrypt.hash(dto.password, 10);

    // ROLE-ONLY: personal permissions are gone — always write an empty map.
    // Права задаёт назначенная роль (roleId). Если roleId передан — он обязан быть
    // ВИДИМ тенанту (своя роль или глобальная системная). Если roleId НЕ передан —
    // мы НЕ оставляем сотрудника без роли: жёстко проставляем СИСТЕМНУЮ роль по
    // строковой роли (master→«Мастер», admin→«Администратор», director→«Директор»),
    // предпочитая per-tenant override (roles WHERE tenant_id=<tenant> AND
    // system_key=<role>), иначе глобальный шаблон (tenant_id IS NULL AND
    // system_key=<role>). Иначе новый сотрудник получил бы role_id NULL →
    // role_matrix NULL → эффективные права {} на клиенте (пустое меню), при этом
    // backend-guard всё равно применил бы master-дефолты — рассинхрон + баг
    // «новый сотрудник видит пустое приложение». superadmin (без тенанта) роли не
    // требует — он обходит все гейты по строковой роли, ему role_id не нужен.
    let roleId: string | null = null;
    let assignedMatrix: unknown = null;
    if (dto.roleId) {
      const { rows: roleRows } = await this.pool.query(
        `SELECT system_key, COALESCE(matrix, '{}') AS matrix FROM roles WHERE id=$1 AND (tenant_id=$2 OR tenant_id IS NULL)`,
        [dto.roleId, tenantID],
      );
      if (roleRows.length === 0) throw new BadRequestException({ message: 'Роль не найдена' });
      // system_key='director' → только директор/суперадмин (карта 6.3).
      this.assertCanAssignRoleId(actorRole, roleRows[0].system_key as string | null);
      roleId = dto.roleId;
      assignedMatrix = roleRows[0].matrix;
    } else if (role !== 'superadmin') {
      // Дефолт роли по строковой роли: сначала per-tenant override с этим
      // system_key, иначе глобальный системный шаблон. Один запрос: ORDER BY
      // (tenant_id IS NOT NULL) DESC ставит тенантный override перед глобальным.
      const { rows: sysRoleRows } = await this.pool.query(
        `SELECT id, COALESCE(matrix, '{}') AS matrix FROM roles
          WHERE system_key = $1 AND (tenant_id = $2 OR tenant_id IS NULL)
          ORDER BY (tenant_id IS NOT NULL) DESC
          LIMIT 1`,
        [role, tenantID],
      );
      // Если системная роль-шаблон почему-то отсутствует (не должно случаться —
      // 3 глобальные строки сидятся миграцией 114/121), не блокируем создание:
      // роль остаётся NULL, и guard применит легаси-дефолты строковой роли.
      if (sysRoleRows.length > 0) {
        roleId = sysRoleRows[0].id as string;
        assignedMatrix = sysRoleRows[0].matrix;
      }
    }

    // E-6 доводка — ПОТОЛОК НАЗНАЧЕНИЯ роли (см. assertRoleAssignable): не-owner
    // держатель user_management не может выдать новому сотруднику роль (в т.ч.
    // системного «Администратора» или дефолт по строковой роли) с правами ВЫШЕ
    // собственных эффективных — иначе поднял бы аккаунт с известным паролем до
    // всех финансов в обход потолка ролей. Owner-class (director/superadmin) — без
    // потолка. roleId=null (роль не разрешилась) — проверять нечего: guard
    // применит легаси-дефолты строковой роли (⊆ прав любого актора).
    // assertCanAssignRole/assertCanAssignRoleId (запрет назначать 'director') —
    // дополняющая проверка, сохранена выше.
    if (assignedMatrix !== null) {
      assertRoleAssignable(this.parseRoleMatrix(assignedMatrix), { role: actorRole, permissions: actorPermissions });
    }

    try {
      const { rows } = await this.pool.query(
        `INSERT INTO users (phone, password, full_name, role, salary_percent, permissions, role_id, is_active, tenant_id)
         VALUES ($1, $2, $3, $4, $5, '{}'::jsonb, $6, true, $7)
         RETURNING id, phone, full_name, username, avatar, role, salary_percent, product_salary_percent, permissions, days_off, is_active, team, can_add_expenses, daily_expense_limit, hidden_from_schedule, hidden_everywhere, dismissed_at, purged_at, role_id, tenant_id, created_at`,
        [phone, hash, dto.fullName, role, Number(dto.salaryPercent) || 0, roleId, tenantID],
      );
      return this.mapUser(rows[0]);
    } catch (err: any) {
      this.logger.error(`User create error: code=${err.code} detail=${err.detail}`);
      if (err.code === '23505') {
        throw new BadRequestException({ message: 'Пользователь с таким телефоном уже существует' });
      }
      if (err.code === '23503') {
        throw new BadRequestException({ message: 'Ошибка: автосервис не найден' });
      }
      if (err.code === '23514') {
        throw new BadRequestException({ message: `Недопустимая роль: ${role}` });
      }
      // Do not leak the raw driver/Postgres error to the client — it can
      // reveal column names, hint text, etc. The full error is already in
      // server logs above (with code + detail), so support can debug.
      throw new InternalServerErrorException({ message: 'Ошибка создания сотрудника' });
    }
  }

  async update(
    id: string,
    tenantID: string,
    actorRole: string,
    actorID: string,
    dto: any,
    actorPermissions?: Record<string, boolean>,
  ) {
    // Confirm the target lives in the actor's tenant. Without this the
    // surrounding `WHERE id=$ AND tenant_id=$` only protects mutation;
    // we'd still leak existence via different error paths.
    const { rows: targetRows } = await this.pool.query(
      `SELECT role, COALESCE(salary_percent, 0) AS salary_percent,
              COALESCE(product_salary_percent, 0) AS product_salary_percent,
              COALESCE(permissions, '{}') AS permissions
         FROM users WHERE id=$1 AND tenant_id=$2`,
      [id, tenantID],
    );
    if (targetRows.length === 0) throw new NotFoundException({ message: 'Пользователь не найден' });
    const targetRole = targetRows[0].role as string;
    // #62: capture the pre-edit percents so we can tell whether a percent
    // ACTUALLY changed (and only then recompute the current month — a same-value
    // save, or an unrelated profile edit, stays a no-op and byte-identical).
    const oldSalaryPercent = parseFloat(targetRows[0].salary_percent) || 0;
    const oldProductSalaryPercent = parseFloat(targetRows[0].product_salary_percent) || 0;

    // No one — not even superadmin — can demote the only director left in a
    // tenant, and a non-superadmin cannot edit a superadmin / director other
    // than themselves. This protects against a freshly-promoted admin turning
    // around and bricking the owner's account.
    const editingPrivilegedTarget =
      targetRole === 'superadmin' || (targetRole === 'director' && actorRole !== 'superadmin');
    if (editingPrivilegedTarget && id !== actorID) {
      throw new ForbiddenException({ message: 'Недостаточно прав для редактирования этого пользователя' });
    }

    if (dto.role !== undefined) {
      this.assertCanAssignRole(actorRole, dto.role);
      // Do not let a non-superadmin strip the superadmin role off anyone
      // (in case the target tenant has one).
      if (targetRole === 'superadmin' && actorRole !== 'superadmin') {
        throw new ForbiddenException({ message: 'Только суперадмин может менять роль суперадмина' });
      }
      // Симметрично назначению (карта 6.3): МЕНЯТЬ роль существующего директора
      // может только директор/суперадмин. Для чужого директора это уже отбито
      // editingPrivilegedTarget выше; явный guard закрывает остаточные пути
      // (самоправка и будущие рефакторинги privileged-логики) fail-closed.
      if (targetRole === 'director' && dto.role !== 'director' && !DIRECTOR_GRANTING_ROLES.has(actorRole)) {
        throw new ForbiddenException({ message: 'Только директор может менять роль директора' });
      }
    }

    if (dto.password !== undefined && typeof dto.password === 'string') {
      if (dto.password.length < 8) {
        throw new BadRequestException({ message: 'Пароль должен быть не менее 8 символов' });
      }
    }

    // ── ROLE-ONLY (консолидация 2026-07) — назначение роли (roleId) ──────────
    // Персональные users.permissions удалены из модели прав: единственный способ
    // изменить права сотрудника — назначить роль (dto.roleId). dto.permissions
    // больше не принимается (снят из UpdateUserDto).
    // undefined → поле не трогаем; null → снять роль (возврат к легаси-дефолтам
    // строковой роли); uuid → роль обязана быть ВИДИМОЙ тенанту: системная
    // (tenant_id IS NULL) или своя. Чужая → 400, id другого тенанта не различим
    // от несуществующего.
    if (dto.roleId !== undefined && dto.roleId !== null) {
      const { rows: roleRows } = await this.pool.query(
        `SELECT COALESCE(matrix, '{}') AS matrix, system_key FROM roles WHERE id=$1 AND (tenant_id=$2 OR tenant_id IS NULL)`,
        [dto.roleId, tenantID],
      );
      if (roleRows.length === 0) throw new BadRequestException({ message: 'Роль не найдена' });
      // system_key='director' → только директор/суперадмин (карта 6.3).
      this.assertCanAssignRoleId(actorRole, roleRows[0].system_key as string | null);

      const roleMatrix = this.parseRoleMatrix(roleRows[0].matrix);

      // E-6 доводка — ПОТОЛОК НАЗНАЧЕНИЯ роли (см. assertRoleAssignable): не-owner
      // держатель user_management не может назначить (СЕБЕ или другому) роль с
      // правами ВЫШЕ собственных эффективных — иначе назначил бы себе/сообщнику
      // системного «Администратора» (profit_view / cashflow_view_all…) и получил
      // все финансы в обход потолка ролей. Owner-class (director/superadmin) — без
      // потолка (assertRoleAssignable сам это учитывает).
      assertRoleAssignable(roleMatrix, { role: actorRole, permissions: actorPermissions });

      // Самолокаут-guard по ЭФФЕКТИВНОМУ результату (теперь только flatten(matrix)):
      // назначая роль СЕБЕ, нельзя получить user_management=false. superadmin/
      // director исключены — их клиентский обход безусловный, самолокаут невозможен.
      if (id === actorID && actorRole !== 'superadmin' && actorRole !== 'director') {
        const effective = mergeEffectivePermissions(roleMatrix);
        if (effective.user_management !== true) {
          throw new BadRequestException({ message: 'Нельзя снять у себя право «Управление пользователями»' });
        }
      }
    }

    const sets: string[] = [];
    const vals: any[] = [];
    let idx = 1;

    if (dto.phone !== undefined) {
      sets.push(`phone=$${idx++}`);
      vals.push(normalizePhone(dto.phone));
    }
    if (dto.fullName !== undefined) {
      sets.push(`full_name=$${idx++}`);
      vals.push(dto.fullName);
    }
    if (dto.role !== undefined) {
      sets.push(`role=$${idx++}`);
      vals.push(dto.role);
    }
    if (dto.salaryPercent !== undefined) {
      sets.push(`salary_percent=$${idx++}`);
      vals.push(dto.salaryPercent);
    }
    if (dto.productSalaryPercent !== undefined) {
      sets.push(`product_salary_percent=$${idx++}`);
      vals.push(dto.productSalaryPercent);
    }
    if (dto.isActive !== undefined) {
      sets.push(`is_active=$${idx++}`);
      vals.push(dto.isActive);
    }
    if (dto.daysOff !== undefined) {
      sets.push(`days_off=$${idx++}`);
      vals.push(JSON.stringify(dto.daysOff));
    }
    if (dto.team !== undefined) {
      // Empty string → store NULL so users without a team aren't grouped under "" on the FE.
      sets.push(`team=$${idx++}`);
      vals.push(dto.team === '' ? null : dto.team);
    }
    if (dto.canAddExpenses !== undefined) {
      sets.push(`can_add_expenses=$${idx++}`);
      vals.push(!!dto.canAddExpenses);
    }
    if (dto.dailyExpenseLimit !== undefined) {
      sets.push(`daily_expense_limit=$${idx++}`);
      const lim = dto.dailyExpenseLimit;
      vals.push(lim === null || lim === '' ? null : Number(lim));
    }
    if (dto.hiddenFromSchedule !== undefined) {
      sets.push(`hidden_from_schedule=$${idx++}`);
      vals.push(!!dto.hiddenFromSchedule);
    }
    if (dto.hiddenEverywhere !== undefined) {
      sets.push(`hidden_everywhere=$${idx++}`);
      vals.push(!!dto.hiddenEverywhere);
    }
    if (dto.roleId !== undefined) {
      // null снимает роль; uuid уже провалидирован выше (видимость тенанту).
      sets.push(`role_id=$${idx++}`);
      vals.push(dto.roleId);
    }
    if (dto.password) {
      const hash = await bcrypt.hash(dto.password, 10);
      sets.push(`password=$${idx++}`);
      vals.push(hash);
    }

    if (sets.length === 0) {
      return this.getById(id, tenantID);
    }

    // #62: did a salary percent actually change value? Only then do we recompute
    // the current month (past months stay at their historical baked percent).
    const servicePctChanged = dto.salaryPercent !== undefined && (Number(dto.salaryPercent) || 0) !== oldSalaryPercent;
    const productPctChanged =
      dto.productSalaryPercent !== undefined && (Number(dto.productSalaryPercent) || 0) !== oldProductSalaryPercent;
    const pctChanged = servicePctChanged || productPctChanged;

    sets.push(`updated_at=now()`);
    vals.push(id, tenantID);

    const updateSql = `UPDATE users SET ${sets.join(', ')} WHERE id=$${idx++} AND tenant_id=$${idx}
       RETURNING id, phone, full_name, username, avatar, role, salary_percent, product_salary_percent, permissions, days_off, is_active, team, can_add_expenses, daily_expense_limit, hidden_from_schedule, hidden_everywhere, dismissed_at, purged_at, role_id, tenant_id, created_at`;

    let updatedRow: any;
    if (pctChanged) {
      // Пояс тенанта — ДО открытия транзакции: брать вторую коннекцию из пула,
      // уже держа одну, значит рисковать взаимной блокировкой.
      const tz = await getTenantTimezone(this.pool, tenantID);
      // Persist the new percent AND re-bake the current month's checks in ONE
      // transaction so the percent and the recomputed salary commit atomically.
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(updateSql, vals);
        if (rows.length === 0) {
          await client.query('ROLLBACK');
          throw new NotFoundException({ message: 'Пользователь не найден' });
        }
        updatedRow = rows[0];
        // Round 14 (150): обычная смена ставки в карточке = ставка «с текущего
        // месяца» — автоматически фиксируем полный снапшот в истории ставок
        // (история копится сама, без отдельного действия владельца).
        const currentMonth = zonedMonthKey(new Date(), tz);
        const newServicePct = servicePctChanged ? Number(dto.salaryPercent) || 0 : oldSalaryPercent;
        const newProductPct = productPctChanged ? Number(dto.productSalaryPercent) || 0 : oldProductSalaryPercent;
        await this.upsertRateHistory(client, tenantID, id, currentMonth, newServicePct, newProductPct, actorID);
        // Пересчёт ТЕКУЩЕГО месяца новой ставкой — прежнее поведение #62,
        // теперь через обобщённый recomputeMonthSalary (границы месяца в поясе
        // тенанта).
        await this.recomputeMonthSalary(
          client,
          tenantID,
          id,
          currentMonth,
          {
            servicePct: servicePctChanged ? newServicePct : undefined,
            productPct: productPctChanged ? newProductPct : undefined,
          },
          tz,
        );
        await client.query('COMMIT');
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch {
          /* already rolled back */
        }
        client.release();
        throw this.mapDuplicatePhone(err);
      }
      client.release();
      // Current-month check salary / profit moved — drop cached report aggregates
      // + wake other devices (Round 15: тот же контракт, что decidePayout).
      invalidateReportsForTenant(tenantID);
      this.notifyMoneyChanged(tenantID, actorID ?? null);
    } else {
      let rows: any[];
      try {
        ({ rows } = await this.pool.query(updateSql, vals));
      } catch (err) {
        throw this.mapDuplicatePhone(err);
      }
      if (rows.length === 0) throw new NotFoundException({ message: 'Пользователь не найден' });
      updatedRow = rows[0];
    }

    // Any update may have changed role / permissions / is_active — drop this
    // user's cached JWT validations so the change takes effect on their next
    // request rather than after the auth-cache TTL.
    invalidateAuthUser(id);

    // When daysOff changed, update future schedule entries accordingly
    if (dto.daysOff !== undefined) {
      const today = new Date().toISOString().split('T')[0];
      const newDaysOff: number[] = dto.daysOff || [];

      // Get future schedule entries for this user
      const { rows: futureEntries } = await this.pool.query(
        `SELECT id, date FROM schedule_entries WHERE user_id=$1 AND tenant_id=$2 AND date >= $3`,
        [id, tenantID, today],
      );

      for (const entry of futureEntries) {
        const entryDate = new Date(entry.date);
        const dayOfWeek = entryDate.getDay();
        const shouldBeDayOff = newDaysOff.includes(dayOfWeek);

        await this.pool.query(`UPDATE schedule_entries SET is_day_off=$1, shift_start=$2, shift_end=$3 WHERE id=$4`, [
          shouldBeDayOff,
          shouldBeDayOff ? null : '09:00',
          shouldBeDayOff ? null : '18:00',
          entry.id,
        ]);
      }
    }

    return this.mapUser(updatedRow);
  }

  private static readonly MONTH_RE = /^\d{4}-\d{2}$/;

  /** Следующий календарный месяц после 'YYYY-MM' (с переходом через год). */
  private static nextMonthKey(month: string): string {
    const [y, m] = month.split('-').map((v) => parseInt(v, 10));
    const d = new Date(Date.UTC(y, m, 1)); // m 1-based → индекс m = следующий месяц
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  /**
   * Полуинтервал [monthStart, nextMonthStart) месяца 'YYYY-MM' в бизнес-
   * таймзоне ТЕНАНТА, ISO-инстантами. Конвенция обязана совпадать с
   * SalaryService.getEmployeeMonth / periodPredicate до миллисекунды: иначе
   * чеки первых часов месяца пересчитываются в «чужой» месяц относительно
   * карточки зарплаты.
   */
  private static monthBoundsInZone(month: string, tz: string): { monthStart: string; nextMonthStart: string } {
    const [y, m] = month.split('-').map((v) => parseInt(v, 10));
    return {
      monthStart: zonedMidnight(tz, y, m - 1, 1).toISOString(),
      nextMonthStart: zonedMidnight(tz, y, m, 1).toISOString(),
    };
  }

  /**
   * 150 — effective-проценты месяца `month`: последняя строка master_rate_history
   * с month <= запрошенного (лексикографика 'YYYY-MM' корректна); NULL-колонка /
   * отсутствие строк → fallback текущие users.*.
   */
  async effectiveRateForMonth(
    tenantID: string,
    userId: string,
    month: string,
    executor: Pool | PoolClient = this.pool,
  ): Promise<{ salaryPercent: number; productSalaryPercent: number }> {
    const { rows: userRows } = await executor.query(
      `SELECT COALESCE(salary_percent, 0) AS salary_percent,
              COALESCE(product_salary_percent, 0) AS product_salary_percent
         FROM users WHERE id = $1 AND tenant_id = $2`,
      [userId, tenantID],
    );
    if (userRows.length === 0) throw new NotFoundException({ message: 'Пользователь не найден' });
    const { rows: histRows } = await executor.query(
      `SELECT salary_percent, product_salary_percent
         FROM master_rate_history
        WHERE tenant_id = $1 AND user_id = $2 AND month <= $3
        ORDER BY month DESC
        LIMIT 1`,
      [tenantID, userId, month],
    );
    const h = histRows[0];
    return {
      salaryPercent:
        h && h.salary_percent !== null
          ? parseFloat(h.salary_percent) || 0
          : parseFloat(userRows[0].salary_percent) || 0,
      productSalaryPercent:
        h && h.product_salary_percent !== null
          ? parseFloat(h.product_salary_percent) || 0
          : parseFloat(userRows[0].product_salary_percent) || 0,
    };
  }

  /**
   * 150 — upsert строки истории ставок за месяц. Пишем ПОЛНЫЙ снапшот (обе
   * колонки), чтобы резолв effective-процента был одной строкой.
   */
  private async upsertRateHistory(
    executor: Pool | PoolClient,
    tenantID: string,
    userId: string,
    month: string,
    salaryPercent: number,
    productSalaryPercent: number,
    createdBy: string | null,
  ): Promise<void> {
    await executor.query(
      `INSERT INTO master_rate_history (tenant_id, user_id, month, salary_percent, product_salary_percent, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (tenant_id, user_id, month)
       DO UPDATE SET salary_percent = EXCLUDED.salary_percent,
                     product_salary_percent = EXCLUDED.product_salary_percent,
                     created_by = EXCLUDED.created_by,
                     created_at = now()`,
      [tenantID, userId, month, salaryPercent, productSalaryPercent, createdBy],
    );
  }

  /**
   * #62, обобщённый Round 14 (150) — re-bake ОДНОГО календарного месяца
   * (`month`, 'YYYY-MM', границы в поясе тенанта — см. monthBoundsInZone) для `userId`
   * с ЯВНО переданными процентами, so the chosen month reflects the new percent
   * while OTHER months keep their historical (already-baked) percent.
   * Runs INSIDE the caller's transaction (same one that persisted the percent),
   * so the change is atomic. Month + tenant + user scoped; a no-op when neither
   * percent is passed. Mirrors the baking formulas in ChecksService.
   *
   *  - servicePct: re-bake this user's own service lines. ПРИОРИТЕТЫ СОХРАНЕНЫ:
   *    lines whose service carries its own `master_percent` override (мигр. 019)
   *    are SKIPPED — that percent is independent of the personal rate. Then
   *    refresh each affected check's service_salary_total + total_cost + profit.
   *  - productPct: re-bake product_salary_total for checks this user CREATED.
   *    ПРИОРИТЕТЫ СОХРАНЕНЫ: per-product commission overrides (product_commissions,
   *    мигр. 009) win via COALESCE(pc.percent, <productPct>); only lines without
   *    an override take the passed percent. Then refresh total_cost + profit.
   */
  private async recomputeMonthSalary(
    client: PoolClient,
    tenantID: string,
    userId: string,
    month: string,
    pct: { servicePct?: number; productPct?: number },
    tz: string,
  ): Promise<void> {
    if (pct.servicePct === undefined && pct.productPct === undefined) return;

    const { monthStart, nextMonthStart } = UsersService.monthBoundsInZone(month, tz);

    if (pct.servicePct !== undefined) {
      // 1) Re-bake per-line salary for the lines THIS user executes (no override).
      //    Процент — литеральный параметр $5 (НЕ users.salary_percent): для
      //    прошлого месяца это его историческая/новая ставка, не текущая.
      await client.query(
        `UPDATE check_service_lines sl
            SET salary_amount = ROUND(COALESCE(sl.total, 0)::numeric * $5::numeric / 100.0, 2)
           FROM checks c
          WHERE sl.check_id = c.id
            AND c.tenant_id = $1 AND c.is_deferred = false AND c.deleted_at IS NULL
            AND c.date >= $3 AND c.date < $4
            AND COALESCE(sl.master_id, c.master_id) = $2
            AND NOT EXISTS (
              SELECT 1 FROM services s
               WHERE s.id = sl.service_id AND s.tenant_id = $1 AND s.master_percent IS NOT NULL
            )`,
        [tenantID, userId, monthStart, nextMonthStart, pct.servicePct],
      );
      // 2) Refresh service_salary_total (+ cost / profit) for the affected checks
      //    from the sum of ALL their (now-updated) service lines.
      await client.query(
        `UPDATE checks c
            SET service_salary_total = agg.svc,
                total_cost = COALESCE(c.product_cost_total, 0) + agg.svc + COALESCE(c.product_salary_total, 0),
                profit = COALESCE(c.total_revenue, 0)
                         - (COALESCE(c.product_cost_total, 0) + agg.svc + COALESCE(c.product_salary_total, 0))
           FROM (
             SELECT sl.check_id, COALESCE(SUM(COALESCE(sl.salary_amount, 0)), 0)::numeric AS svc
               FROM check_service_lines sl
               JOIN checks cc ON cc.id = sl.check_id
              WHERE cc.tenant_id = $1 AND cc.is_deferred = false AND cc.deleted_at IS NULL
                AND cc.date >= $3 AND cc.date < $4
              GROUP BY sl.check_id
           ) agg
          WHERE c.id = agg.check_id
            AND c.tenant_id = $1 AND c.is_deferred = false AND c.deleted_at IS NULL
            AND c.date >= $3 AND c.date < $4
            AND EXISTS (
              SELECT 1 FROM check_service_lines sl2
               WHERE sl2.check_id = c.id AND COALESCE(sl2.master_id, c.master_id) = $2
            )`,
        [tenantID, userId, monthStart, nextMonthStart],
      );
    }

    if (pct.productPct !== undefined) {
      // Re-bake product_salary_total for checks this user created, honouring
      // per-product commission overrides (else the PASSED product %), then
      // refresh total_cost + profit. Same profit>0 gate as ChecksService.
      await client.query(
        `UPDATE checks c
            SET product_salary_total = agg.pst,
                total_cost = COALESCE(c.product_cost_total, 0) + COALESCE(c.service_salary_total, 0) + agg.pst,
                profit = COALESCE(c.total_revenue, 0)
                         - (COALESCE(c.product_cost_total, 0) + COALESCE(c.service_salary_total, 0) + agg.pst)
           FROM (
             SELECT pl.check_id,
                    COALESCE(SUM(
                      CASE WHEN (COALESCE(pl.total_sell, 0) - COALESCE(pl.total_cost, 0)) > 0
                           THEN (COALESCE(pl.total_sell, 0) - COALESCE(pl.total_cost, 0))
                                * COALESCE(pc.percent, $5::numeric, 0) / 100.0
                           ELSE 0 END
                    ), 0)::numeric AS pst
               FROM check_product_lines pl
               JOIN checks cc ON cc.id = pl.check_id
                    AND cc.master_id = $2 AND cc.tenant_id = $1 AND cc.is_deferred = false
                    AND cc.deleted_at IS NULL
                    AND cc.date >= $3 AND cc.date < $4
               LEFT JOIN product_commissions pc
                    ON pc.product_id = pl.product_id AND pc.user_id = cc.master_id AND pc.tenant_id = cc.tenant_id
              GROUP BY pl.check_id
           ) agg
          WHERE c.id = agg.check_id
            AND c.tenant_id = $1 AND c.is_deferred = false AND c.deleted_at IS NULL
            AND c.date >= $3 AND c.date < $4`,
        [tenantID, userId, monthStart, nextMonthStart, pct.productPct],
      );
    }
  }

  /**
   * Round 14 (150) — смена ставки «за месяц»: PATCH /users/:id/rate.
   * Транзакция: (1) upsert master_rate_history за месяц X полным снапшотом
   * (недостающая колонка добирается из effective-процента X до правки);
   * (2) если X — ТЕКУЩИЙ московский месяц, также UPDATE users.* (источник
   * запекания НОВЫХ чеков — ChecksService читает users при проведении);
   * (3) recomputeMonthSalary ТОЛЬКО для X — прошлый месяц пересчитывается
   * новой ставкой, остальные месяцы не трогаются. Будущий месяц X: истории
   * достаточно (чеков в X ещё нет, пересчёт — no-op); в users.* ставку
   * перенесёт RateRollforwardService, когда X наступит.
   *
   * СНАПШОТ-ЩИТ для ретро-правки (adversarial-ревью Round 14, HIGH):
   * семантика истории — «действует С месяца X», поэтому одинокая строка за
   * ПРОШЛЫЙ месяц протекала бы вперёд: effective-процент текущего/будущих
   * месяцев резолвился бы в ретро-ставку, и ночной rollForwardDueRates
   * перенёс бы её в users.* + перепёк ТЕКУЩИЙ месяц — вопреки обещанию UI
   * «остальные месяцы не изменятся». Лечение: при X < текущего месяца, если
   * за X+1 ещё нет строки, СНАЧАЛА фиксируем за X+1 снапшот процентов,
   * действовавших ДО правки (effective X+1) — он экранирует X+1 и всё дальше
   * (более поздние месяцы либо накрыты им же, либо своими строками). Ретро-
   * правка строго ограничена месяцем X; cron видит latest-строку = снапшот =
   * users.* и остаётся no-op.
   */
  async setRate(
    id: string,
    tenantID: string,
    actorID: string,
    dto: { month: string; salaryPercent?: number; productSalaryPercent?: number },
  ) {
    if (!UsersService.MONTH_RE.test(dto?.month ?? '')) {
      throw new BadRequestException({ message: 'Месяц — формат YYYY-MM' });
    }
    if (dto.salaryPercent === undefined && dto.productSalaryPercent === undefined) {
      throw new BadRequestException({ message: 'Укажите хотя бы один процент' });
    }
    const month = dto.month;
    // Пояс тенанта — ДО транзакции (см. update).
    const tz = await getTenantTimezone(this.pool, tenantID);
    const currentMonth = zonedMonthKey(new Date(), tz);

    const client = await this.pool.connect();
    let result: { salaryPercent: number; productSalaryPercent: number };
    try {
      await client.query('BEGIN');

      // Тенант-скоуп + недостающая сторона снапшота из effective-процента X.
      const eff = await this.effectiveRateForMonth(tenantID, id, month, client);
      const newService = dto.salaryPercent !== undefined ? Number(dto.salaryPercent) || 0 : eff.salaryPercent;
      const newProduct =
        dto.productSalaryPercent !== undefined ? Number(dto.productSalaryPercent) || 0 : eff.productSalaryPercent;

      // Снапшот-щит (см. docstring): ретро-правка прошлого месяца не должна
      // протекать в X+1 и дальше. Считаем effective X+1 ДО записи строки X и
      // фиксируем его за X+1, если владелец не назначал ставку за X+1 сам.
      // ON CONFLICT DO NOTHING (а не upsert) — существующая явная строка X+1
      // всегда важнее автоснапшота.
      if (month < currentMonth) {
        const shieldMonth = UsersService.nextMonthKey(month);
        const preEdit = await this.effectiveRateForMonth(tenantID, id, shieldMonth, client);
        await client.query(
          `INSERT INTO master_rate_history (tenant_id, user_id, month, salary_percent, product_salary_percent, created_by)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (tenant_id, user_id, month) DO NOTHING`,
          [tenantID, id, shieldMonth, preEdit.salaryPercent, preEdit.productSalaryPercent, actorID],
        );
      }

      await this.upsertRateHistory(client, tenantID, id, month, newService, newProduct, actorID);

      if (month === currentMonth) {
        const sets: string[] = [];
        const vals: any[] = [];
        let i = 1;
        if (dto.salaryPercent !== undefined) {
          sets.push(`salary_percent=$${i++}`);
          vals.push(newService);
        }
        if (dto.productSalaryPercent !== undefined) {
          sets.push(`product_salary_percent=$${i++}`);
          vals.push(newProduct);
        }
        vals.push(id, tenantID);
        await client.query(
          `UPDATE users SET ${sets.join(', ')}, updated_at=now() WHERE id=$${i++} AND tenant_id=$${i}`,
          vals,
        );
      }

      // Пересчитываем ТОЛЬКО затронутые компоненты месяца X (приоритеты
      // services.master_percent / product_commissions сохраняются внутри).
      await this.recomputeMonthSalary(
        client,
        tenantID,
        id,
        month,
        {
          servicePct: dto.salaryPercent !== undefined ? newService : undefined,
          productPct: dto.productSalaryPercent !== undefined ? newProduct : undefined,
        },
        tz,
      );

      await client.query('COMMIT');
      result = { salaryPercent: newService, productSalaryPercent: newProduct };
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* already rolled back */
      }
      throw err;
    } finally {
      client.release();
    }

    // Начисления/profit месяца X сдвинулись — сброс кэшей отчётов + пуш другим
    // устройствам обновить денежные экраны (Round 15 — контракт decidePayout).
    invalidateReportsForTenant(tenantID);
    this.notifyMoneyChanged(tenantID, actorID ?? null);
    return { userId: id, month, ...result };
  }

  /**
   * Round 14 (150) — ROLL-FORWARD ставок «с будущего месяца». Владелец мог
   * назначить ставку «с сентября»; запекание НОВЫХ чеков читает users.*
   * (ChecksService — вне зоны правки), поэтому когда назначенный месяц
   * НАСТУПАЕТ, users.* надо синхронизировать с effective-процентом истории.
   * Вызывается ежедневным cron-ом (RateRollforwardService) и идемпотентен:
   * находит пользователей, у которых effective-процент ТЕКУЩЕГО месяца
   * расходится с users.*, переносит значение и пересчитывает ТОЛЬКО текущий
   * месяц (чеки первых часов месяца, запечённые старой ставкой, доводятся).
   * Ручные правки ставки сами пишут строку истории за текущий месяц
   * (update/setRate), так что история всегда ≥ users.* по свежести — цикл
   * «cron против ручной правки» невозможен.
   *
   * Ретро-правка прошлого месяца НЕ триггерит roll-forward: setRate ставит
   * снапшот-щит за X+1 (см. setRate), поэтому latest-строка ≤ текущего месяца
   * — это щит с прежними процентами (= users.*), а не ретро-строка; cron
   * остаётся no-op. Одинокая прошломесячная строка «подхватывается» только
   * если она легитимно последняя (назначение «с месяца X» без правок после) —
   * это и есть заявленная семантика «действует с X».
   */
  async rollForwardDueRates(): Promise<number> {
    // Свип идёт по ВСЕМ тенантам сразу, а «текущий месяц» у каждого свой:
    // назначение «с сентября» обязано включаться по календарю АВТОСЕРВИСА.
    // Группируем тенантов по их местному месяцу — у российских поясов групп
    // почти всегда одна, поэтому это один-два запроса, а не запрос на тенанта.
    const now = new Date();
    const tzByTenant = await listTenantTimezones(this.pool);
    const tenantsByMonth = new Map<string, string[]>();
    for (const [tenantID, tz] of tzByTenant) {
      const month = zonedMonthKey(now, tz);
      const bucket = tenantsByMonth.get(month);
      if (bucket) bucket.push(tenantID);
      else tenantsByMonth.set(month, [tenantID]);
    }

    const rows: Array<{
      tenant_id: string;
      user_id: string;
      eff_service: string | null;
      eff_product: string | null;
      cur_service: string;
      cur_product: string;
      current_month: string;
    }> = [];
    for (const [currentMonth, tenantIds] of tenantsByMonth) {
      const { rows: monthRows } = await this.pool.query(
        `SELECT h.tenant_id, h.user_id,
                h.salary_percent AS eff_service, h.product_salary_percent AS eff_product,
                COALESCE(u.salary_percent, 0) AS cur_service,
                COALESCE(u.product_salary_percent, 0) AS cur_product
           FROM (
             SELECT DISTINCT ON (tenant_id, user_id)
                    tenant_id, user_id, salary_percent, product_salary_percent
               FROM master_rate_history
              WHERE month <= $1 AND tenant_id = ANY($2::uuid[])
              ORDER BY tenant_id, user_id, month DESC
           ) h
           JOIN users u ON u.id = h.user_id AND u.tenant_id = h.tenant_id
          WHERE (h.salary_percent IS NOT NULL
                 AND h.salary_percent IS DISTINCT FROM COALESCE(u.salary_percent, 0))
             OR (h.product_salary_percent IS NOT NULL
                 AND h.product_salary_percent IS DISTINCT FROM COALESCE(u.product_salary_percent, 0))`,
        [currentMonth, tenantIds],
      );
      for (const r of monthRows) rows.push({ ...r, current_month: currentMonth });
    }

    let applied = 0;
    for (const r of rows) {
      const currentMonth = r.current_month;
      const tz = tzByTenant.get(r.tenant_id) ?? DEFAULT_TIMEZONE;
      const effService = r.eff_service === null ? null : parseFloat(r.eff_service) || 0;
      const effProduct = r.eff_product === null ? null : parseFloat(r.eff_product) || 0;
      const serviceDiffers = effService !== null && effService !== (parseFloat(r.cur_service) || 0);
      const productDiffers = effProduct !== null && effProduct !== (parseFloat(r.cur_product) || 0);
      if (!serviceDiffers && !productDiffers) continue;

      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        const sets: string[] = [];
        const vals: any[] = [];
        let i = 1;
        if (serviceDiffers) {
          sets.push(`salary_percent=$${i++}`);
          vals.push(effService);
        }
        if (productDiffers) {
          sets.push(`product_salary_percent=$${i++}`);
          vals.push(effProduct);
        }
        vals.push(r.user_id, r.tenant_id);
        await client.query(
          `UPDATE users SET ${sets.join(', ')}, updated_at=now() WHERE id=$${i++} AND tenant_id=$${i}`,
          vals,
        );
        await this.recomputeMonthSalary(
          client,
          r.tenant_id,
          r.user_id,
          currentMonth,
          {
            servicePct: serviceDiffers ? (effService as number) : undefined,
            productPct: productDiffers ? (effProduct as number) : undefined,
          },
          tz,
        );
        await client.query('COMMIT');
        applied += 1;
        invalidateReportsForTenant(r.tenant_id);
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch {
          /* already rolled back */
        }
        this.logger.error(`Rate roll-forward failed for user ${r.user_id}: ${err}`);
      } finally {
        client.release();
      }
    }
    return applied;
  }

  /**
   * 150 — история ставок сотрудника (новые месяцы первыми). Для UI карточки
   * «ставка по месяцам». Тенант-скоуп; отсутствие строк = ставка никогда не
   * менялась через новый поток (действует users.*).
   */
  async listRateHistory(id: string, tenantID: string) {
    const { rows: userRows } = await this.pool.query('SELECT 1 FROM users WHERE id=$1 AND tenant_id=$2', [
      id,
      tenantID,
    ]);
    if (userRows.length === 0) throw new NotFoundException({ message: 'Пользователь не найден' });
    const { rows } = await this.pool.query(
      `SELECT h.id, h.month, h.salary_percent, h.product_salary_percent, h.created_by, h.created_at,
              c.full_name AS creator_name
         FROM master_rate_history h
         LEFT JOIN users c ON c.id = h.created_by
        WHERE h.tenant_id = $1 AND h.user_id = $2
        ORDER BY h.month DESC`,
      [tenantID, id],
    );
    return rows.map((r) => ({
      id: r.id,
      month: r.month,
      salaryPercent: r.salary_percent === null ? null : parseFloat(r.salary_percent) || 0,
      productSalaryPercent: r.product_salary_percent === null ? null : parseFloat(r.product_salary_percent) || 0,
      createdBy: r.created_by ?? null,
      creatorName: r.creator_name ?? null,
      createdAt: r.created_at,
    }));
  }

  /**
   * SOFT-DISMISS — the "delete" action from the FE. We NEVER hard-delete a
   * users row: historical checks / shifts / salary / equipment reference it by
   * FK, and old order-narjads must keep resolving the master's name. Instead we
   * stamp `dismissed_at`, which moves the user into «Уволенные» (recycle bin):
   * hidden from every active list, restorable within the year, but the row —
   * and every relation that points at it — stays intact.
   *
   * `is_active` is a SEPARATE concern (the active/inactive toggle); dismissal
   * does not touch it so a restored user keeps their previous active flag.
   */
  async remove(id: string, tenantID: string, currentUserID: string, _currentRole: string) {
    if (id === currentUserID) {
      throw new BadRequestException({ message: 'Нельзя удалить себя' });
    }

    const { rows } = await this.pool.query(
      'SELECT role, dismissed_at, purged_at FROM users WHERE id=$1 AND tenant_id=$2',
      [id, tenantID],
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Пользователь не найден' });

    if (rows[0].role === 'superadmin' || rows[0].role === 'director') {
      throw new ForbiddenException({ message: 'Нельзя удалить директора или суперадмина' });
    }

    if (rows[0].dismissed_at || rows[0].purged_at) {
      // Already in / past the recycle bin — nothing to do, keep it idempotent.
      return { message: 'Сотрудник уже уволен' };
    }

    await this.pool.query(`UPDATE users SET dismissed_at = now(), updated_at = now() WHERE id=$1 AND tenant_id=$2`, [
      id,
      tenantID,
    ]);
    // Drop the dismissed user's cached JWT validations so their token starts
    // being re-checked against the DB on the next request.
    invalidateAuthUser(id);
    return { message: 'Сотрудник перемещён в «Уволенные»' };
  }

  /**
   * List the «Уволенные» — dismissed but not yet purged, tenant-scoped, newest
   * dismissal first. Returns the full mapped User (with `dismissedAt`) so the
   * UI can render name, role, avatar and the dismissal date.
   */
  async listDismissed(tenantID: string) {
    const { rows } = await this.pool.query(
      `SELECT id, phone, full_name, username, avatar, role,
              COALESCE(salary_percent, 0) as salary_percent,
              COALESCE(product_salary_percent, 0) as product_salary_percent,
              COALESCE(permissions, '{}') as permissions,
              COALESCE(days_off, '[]') as days_off,
              COALESCE(sort_order, 0) as sort_order,
              is_active, team,
              COALESCE(can_add_expenses, false) as can_add_expenses,
              daily_expense_limit,
              COALESCE(hidden_from_schedule, false) as hidden_from_schedule,
              COALESCE(hidden_everywhere, false) as hidden_everywhere,
              dismissed_at, purged_at, role_id,
              tenant_id, created_at
       FROM users
       WHERE tenant_id = $1 AND dismissed_at IS NOT NULL AND purged_at IS NULL
       ORDER BY dismissed_at DESC`,
      [tenantID],
    );
    return rows.map(this.mapUser);
  }

  /**
   * Restore a dismissed user back to active — clears `dismissed_at`. Only valid
   * while the user is currently dismissed and NOT purged (a purged user is
   * permanently retired for history and cannot return).
   */
  async restore(id: string, tenantID: string) {
    const { rows } = await this.pool.query('SELECT dismissed_at, purged_at FROM users WHERE id=$1 AND tenant_id=$2', [
      id,
      tenantID,
    ]);
    if (rows.length === 0) throw new NotFoundException({ message: 'Пользователь не найден' });
    if (rows[0].purged_at) {
      throw new BadRequestException({ message: 'Сотрудник удалён навсегда и не может быть восстановлен' });
    }
    if (!rows[0].dismissed_at) {
      throw new BadRequestException({ message: 'Сотрудник не находится в «Уволенных»' });
    }

    await this.pool.query(`UPDATE users SET dismissed_at = NULL, updated_at = now() WHERE id=$1 AND tenant_id=$2`, [
      id,
      tenantID,
    ]);
    // Role / active flag may matter again immediately — flush the auth cache.
    invalidateAuthUser(id);
    return this.getById(id, tenantID);
  }

  /**
   * "Delete completely" (purge) — stamps `purged_at` but KEEPS THE ROW so every
   * FK (checks, shifts, salary, equipment) stays resolvable and old documents
   * still show the name. The user vanishes from «Уволенные» too and can no
   * longer be restored. This is the closest thing to a hard delete we allow.
   * Only a dismissed user can be purged (you delete-completely from the bin).
   */
  async purge(id: string, tenantID: string, currentUserID: string) {
    if (id === currentUserID) {
      throw new BadRequestException({ message: 'Нельзя удалить себя' });
    }

    const { rows } = await this.pool.query(
      'SELECT role, dismissed_at, purged_at FROM users WHERE id=$1 AND tenant_id=$2',
      [id, tenantID],
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Пользователь не найден' });

    if (rows[0].role === 'superadmin' || rows[0].role === 'director') {
      throw new ForbiddenException({ message: 'Нельзя удалить директора или суперадмина' });
    }
    if (rows[0].purged_at) {
      // Already purged — idempotent no-op.
      return { message: 'Сотрудник уже удалён' };
    }
    if (!rows[0].dismissed_at) {
      throw new BadRequestException({ message: 'Сначала переместите сотрудника в «Уволенные»' });
    }

    await this.pool.query(`UPDATE users SET purged_at = now(), updated_at = now() WHERE id=$1 AND tenant_id=$2`, [
      id,
      tenantID,
    ]);
    // The user can never authenticate again — drop any cached validations.
    invalidateAuthUser(id);
    return { message: 'Сотрудник удалён навсегда' };
  }

  // Per-user section/item visibility (071/073) удалена в консолидации Round 12
  // (2026-07): видимость разделов теперь определяется ТОЛЬКО матрицей роли
  // (roles.matrix → hasPermission на клиенте, @RequirePermission на сервере).
  // Таблицы section_visibility / item_visibility остаются в БД до следующего
  // релиза (безопасность отката) — их больше никто не читает и не пишет.

  // ─── Effective permissions (server-enforced, ROLE-ONLY) ─────────────
  // Персональные users.permissions удалены (консолидация 2026-07). Права
  // сотрудника задаёт назначенная роль. Осталось только ЧТЕНИЕ эффективных прав
  // для UI (экран роли / карточка сотрудника). Запись прав — назначение роли
  // (update(..., { roleId })).

  /**
   * ЭФФЕКТИВНЫЕ права пользователя (плоский результат): ровно то, что ответит
   * userHasPermission на каждый канонический ключ. Считается из тех же
   * примитивов, что и enforcement (flatten(матрицы роли) → userHasPermission), —
   * ответ физически не может разойтись с реальными решениями guard'ов:
   * owner-class → всё true; master без role_id → дефолты строковой роли; с
   * role_id → база из матрицы.
   */
  async getEffectivePermissions(
    userId: string,
    tenantID: string,
  ): Promise<{ role: string; roleId: string | null; permissions: Record<string, boolean> }> {
    const { rows } = await this.pool.query(
      `SELECT u.role, u.role_id, r.matrix AS role_matrix
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
       WHERE u.id = $1 AND u.tenant_id = $2`,
      [userId, tenantID],
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Пользователь не найден' });

    let roleMatrix = rows[0].role_matrix ?? null;
    if (typeof roleMatrix === 'string') {
      try {
        roleMatrix = JSON.parse(roleMatrix);
      } catch {
        roleMatrix = null;
      }
    }

    const actor = { role: rows[0].role as string, permissions: mergeEffectivePermissions(roleMatrix) };
    const permissions: Record<string, boolean> = {};
    for (const key of CANONICAL_PERMISSION_KEYS) permissions[key] = userHasPermission(actor, key);

    return { role: actor.role, roleId: rows[0].role_id ?? null, permissions };
  }

  // ─── Product Commissions ────────────────────────────────────────────

  async getProductCommissions(userId: string, tenantID: string) {
    // Get global product salary percent
    const { rows: userRows } = await this.pool.query(
      'SELECT COALESCE(product_salary_percent, 0) as product_salary_percent FROM users WHERE id=$1 AND tenant_id=$2',
      [userId, tenantID],
    );
    if (userRows.length === 0) throw new NotFoundException({ message: 'Пользователь не найден' });

    const productSalaryPercent = parseFloat(userRows[0].product_salary_percent) || 0;

    // Get product-specific commissions
    const { rows } = await this.pool.query(
      `SELECT pc.id, pc.product_id, pc.percent, p.name as product_name, p.sell_price, p.cost_price
       FROM product_commissions pc
       JOIN products p ON p.id = pc.product_id
       WHERE pc.user_id = $1 AND pc.tenant_id = $2
       ORDER BY p.name`,
      [userId, tenantID],
    );

    return {
      productSalaryPercent,
      items: rows.map((r) => ({
        id: r.id,
        productId: r.product_id,
        percent: parseFloat(r.percent) || 0,
        productName: r.product_name,
        sellPrice: parseFloat(r.sell_price) || 0,
        costPrice: parseFloat(r.cost_price) || 0,
      })),
    };
  }

  async setProductCommissions(
    userId: string,
    tenantID: string,
    dto: { productSalaryPercent: number; items: Array<{ productId: string; percent: number }> },
  ) {
    // Verify user exists (+ текущий сервисный процент для снапшота истории 150).
    const { rows: userRows } = await this.pool.query(
      'SELECT id, COALESCE(salary_percent, 0) AS salary_percent FROM users WHERE id=$1 AND tenant_id=$2',
      [userId, tenantID],
    );
    if (userRows.length === 0) throw new NotFoundException({ message: 'Пользователь не найден' });

    // Verify every referenced product belongs to the caller's tenant before
    // we open a transaction — refuses a forged item.productId that points
    // to a product in another tenant.
    if (dto.items && dto.items.length > 0) {
      const productIds = Array.from(new Set(dto.items.map((i) => i.productId).filter((x): x is string => !!x)));
      if (productIds.length > 0) {
        const { rows: prodRows } = await this.pool.query(
          'SELECT id FROM products WHERE id = ANY($1) AND tenant_id = $2',
          [productIds, tenantID],
        );
        if (prodRows.length !== productIds.length) {
          throw new BadRequestException({ message: 'Товар не найден или принадлежит другому автосервису' });
        }
      }
    }

    // Пояс тенанта — ДО транзакции (см. update).
    const tz = await getTenantTimezone(this.pool, tenantID);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Update global product salary percent
      await client.query('UPDATE users SET product_salary_percent = $1 WHERE id = $2 AND tenant_id = $3', [
        dto.productSalaryPercent || 0,
        userId,
        tenantID,
      ]);

      // Replace all product-specific commissions
      await client.query('DELETE FROM product_commissions WHERE user_id = $1 AND tenant_id = $2', [userId, tenantID]);

      if (dto.items && dto.items.length > 0) {
        for (const item of dto.items) {
          if (item.productId && item.percent > 0) {
            await client.query(
              `INSERT INTO product_commissions (tenant_id, user_id, product_id, percent)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT (tenant_id, user_id, product_id) DO UPDATE SET percent = $4`,
              [tenantID, userId, item.productId, item.percent],
            );
          }
        }
      }

      // #62: changing the global product % and/or per-product commissions must
      // recompute the CURRENT month's product salary for checks this user
      // created (past months keep their historical baked values). Runs in this
      // same transaction so config + recompute commit atomically.
      // Round 14 (150): снапшот в историю ставок за текущий месяц (товарный
      // процент сменился этим экраном; сервисный — текущий users.*), затем
      // обобщённый пересчёт МЕСТНОГО месяца новым процентом. Per-product
      // overrides (product_commissions) по-прежнему в приоритете внутри пересчёта.
      const currentMonth = zonedMonthKey(new Date(), tz);
      const newProductPct = dto.productSalaryPercent || 0;
      await this.upsertRateHistory(
        client,
        tenantID,
        userId,
        currentMonth,
        parseFloat(userRows[0].salary_percent) || 0,
        newProductPct,
        null,
      );
      await this.recomputeMonthSalary(client, tenantID, userId, currentMonth, { productPct: newProductPct }, tz);

      await client.query('COMMIT');
      // Current-month product salary / profit moved — drop cached aggregates
      // + wake other devices (Round 15). Актор здесь неизвестен — без exclude.
      invalidateReportsForTenant(tenantID);
      this.notifyMoneyChanged(tenantID, null);
      return this.getProductCommissions(userId, tenantID);
    } catch (err) {
      await client.query('ROLLBACK');
      this.logger.error(`setProductCommissions error: ${err}`);
      throw new InternalServerErrorException({ message: 'Ошибка сохранения комиссий' });
    } finally {
      client.release();
    }
  }
}
