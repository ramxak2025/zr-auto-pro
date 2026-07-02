import {
  Injectable,
  Inject,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import * as bcrypt from 'bcryptjs';
import { PG_POOL } from '../database.module';
import { normalizePhone } from '../common/normalize-phone';
import { invalidateAuthUser } from '../common/auth-cache';
import { CANONICAL_PERMISSION_KEYS, mergeEffectivePermissions } from '../common/role-matrix';
import { userHasPermission } from '../common/guards/permissions.guard';
import { invalidateReportsForTenant } from '../common/reports-cache';
import { SECTION_KEYS, SectionKey } from './dto/section-visibility.dto';
import { ALL_ITEM_KEYS, OWNER_PROTECTED_ITEM_KEYS } from './dto/item-visibility.dto';

// Roles that may be assigned through this service. Anything outside this set
// is rejected up front so a manipulated DTO can't sneak a role string past
// the DB CHECK constraint (which would still reject it, but the early throw
// gives a clearer error and avoids relying on the DB layer alone).
const ALLOWED_ROLES = new Set(['master', 'admin', 'director', 'superadmin']);

// Only `superadmin` may mint or grant the `superadmin` role. A `director`
// cannot escalate themselves or anyone else to `superadmin`.
const SUPERADMIN_ONLY_ROLES = new Set(['superadmin']);

@Injectable()
export class UsersService {
  private readonly logger = new Logger('UsersService');

  constructor(@Inject(PG_POOL) private pool: Pool) {}

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

  async getAll(tenantID: string) {
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
       WHERE tenant_id = $1 AND dismissed_at IS NULL AND purged_at IS NULL
       ORDER BY sort_order, created_at`,
      [tenantID],
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

  async getMasters(tenantID: string) {
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
       FROM users
       WHERE tenant_id = $1 AND is_active = true AND role IN ('master','admin')
         AND dismissed_at IS NULL AND purged_at IS NULL
       ORDER BY full_name`,
      [tenantID],
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

  async create(tenantID: string, actorRole: string, dto: any) {
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
    const perms = dto.permissions ? JSON.stringify(dto.permissions) : '{}';

    try {
      const { rows } = await this.pool.query(
        `INSERT INTO users (phone, password, full_name, role, salary_percent, permissions, is_active, tenant_id)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, true, $7)
         RETURNING id, phone, full_name, username, avatar, role, salary_percent, product_salary_percent, permissions, days_off, is_active, team, can_add_expenses, daily_expense_limit, hidden_from_schedule, hidden_everywhere, dismissed_at, purged_at, role_id, tenant_id, created_at`,
        [phone, hash, dto.fullName, role, Number(dto.salaryPercent) || 0, perms, tenantID],
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

  async update(id: string, tenantID: string, actorRole: string, actorID: string, dto: any) {
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
    }

    if (dto.password !== undefined && typeof dto.password === 'string') {
      if (dto.password.length < 8) {
        throw new BadRequestException({ message: 'Пароль должен быть не менее 8 символов' });
      }
    }

    // Self-lockout guard for the LEGACY permissions path (mirrors the dedicated
    // PATCH /users/:id/permissions). A user editing their OWN account must not
    // be able to strip their own `user_management` — an `admin` would otherwise
    // brick their access to Users/Employees (their client gate checks this key).
    // superadmin/director are excluded: their client bypass is unconditional so
    // they cannot self-lock, and excluding them avoids over-blocking an
    // owner-class self profile-edit whose stored map happens to omit the key.
    if (
      dto.permissions !== undefined &&
      id === actorID &&
      actorRole !== 'superadmin' &&
      actorRole !== 'director' &&
      dto.permissions.user_management !== true
    ) {
      throw new BadRequestException({ message: 'Нельзя снять у себя право «Управление пользователями»' });
    }

    // ── 114 — назначение роли (roleId) ──────────────────────────────────
    // undefined → поле не трогаем; null → снять роль (возврат к легаси-дефолтам
    // строковой роли — сегодняшнее поведение); uuid → роль обязана быть ВИДИМОЙ
    // тенанту: системная (tenant_id IS NULL) или своя. Чужая → 400, id другого
    // тенанта не различим от несуществующего.
    if (dto.roleId !== undefined && dto.roleId !== null) {
      const { rows: roleRows } = await this.pool.query(
        `SELECT COALESCE(matrix, '{}') AS matrix FROM roles WHERE id=$1 AND (tenant_id=$2 OR tenant_id IS NULL)`,
        [dto.roleId, tenantID],
      );
      if (roleRows.length === 0) throw new BadRequestException({ message: 'Роль не найдена' });

      // Самолокаут-guard (зеркало правила для dto.permissions выше, но по
      // ЭФФЕКТИВНОМУ результату): назначая роль СЕБЕ, нельзя получить
      // user_management=false после «flatten(матрицы) ⊕ персональные overrides».
      // superadmin/director исключены по той же причине, что и выше — их
      // клиентский обход безусловный, самолокаут для них невозможен.
      if (id === actorID && actorRole !== 'superadmin' && actorRole !== 'director') {
        const roleMatrix = typeof roleRows[0].matrix === 'string' ? JSON.parse(roleRows[0].matrix) : roleRows[0].matrix;
        const storedPermsRaw = targetRows[0].permissions;
        const storedPerms = (
          typeof storedPermsRaw === 'string' ? JSON.parse(storedPermsRaw) : storedPermsRaw || {}
        ) as Record<string, boolean>;
        const resultingOwnPerms =
          dto.permissions !== undefined ? (dto.permissions as Record<string, boolean>) : storedPerms;
        const effective = mergeEffectivePermissions(roleMatrix, resultingOwnPerms);
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
    if (dto.permissions !== undefined) {
      sets.push(`permissions=$${idx++}`);
      vals.push(JSON.stringify(dto.permissions));
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
        await this.recomputeCurrentMonthSalary(client, tenantID, id, {
          service: servicePctChanged,
          product: productPctChanged,
        });
        await client.query('COMMIT');
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch {
          /* already rolled back */
        }
        client.release();
        throw err;
      }
      client.release();
      // Current-month check salary / profit moved — drop cached report aggregates.
      invalidateReportsForTenant(tenantID);
    } else {
      const { rows } = await this.pool.query(updateSql, vals);
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

  /**
   * #62 — re-bake the CURRENT calendar month's non-deferred checks for `userId`
   * after their salary percent changed, so the current month reflects the new
   * percent while PAST months keep their historical (already-baked) percent.
   * Runs INSIDE the caller's transaction (same one that persisted the percent),
   * so the change is atomic. Current-month + tenant + user scoped; a no-op when
   * neither flag is set. Mirrors the baking formulas in ChecksService.
   *
   *  - service: re-bake this user's own service lines (skipping lines whose
   *    service carries its own `master_percent` override — that percent is
   *    independent of the user percent), then refresh each affected check's
   *    service_salary_total + total_cost + profit.
   *  - product: re-bake product_salary_total for checks this user CREATED,
   *    honouring per-product commission overrides (else the user's global
   *    product %), then refresh total_cost + profit.
   */
  private async recomputeCurrentMonthSalary(
    client: PoolClient,
    tenantID: string,
    userId: string,
    opts: { service: boolean; product: boolean },
  ): Promise<void> {
    if (!opts.service && !opts.product) return;

    // Half-open [monthStart, nextMonthStart) in UTC — same convention as the
    // per-employee monthly salary card (SalaryService.getEmployeeMonth).
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const nextMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();

    if (opts.service) {
      // 1) Re-bake per-line salary for the lines THIS user executes (no override).
      await client.query(
        `UPDATE check_service_lines sl
            SET salary_amount = ROUND(COALESCE(sl.total, 0)::numeric * COALESCE(u.salary_percent, 0) / 100.0, 2)
           FROM checks c, users u
          WHERE sl.check_id = c.id
            AND u.id = $2 AND u.tenant_id = $1
            AND c.tenant_id = $1 AND c.is_deferred = false AND c.deleted_at IS NULL
            AND c.date >= $3 AND c.date < $4
            AND COALESCE(sl.master_id, c.master_id) = $2
            AND NOT EXISTS (
              SELECT 1 FROM services s
               WHERE s.id = sl.service_id AND s.tenant_id = $1 AND s.master_percent IS NOT NULL
            )`,
        [tenantID, userId, monthStart, nextMonthStart],
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

    if (opts.product) {
      // Re-bake product_salary_total for checks this user created, honouring
      // per-product commission overrides (else the user's global product %),
      // then refresh total_cost + profit. Same profit>0 gate as ChecksService.
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
                                * COALESCE(pc.percent, u.product_salary_percent, 0) / 100.0
                           ELSE 0 END
                    ), 0)::numeric AS pst
               FROM check_product_lines pl
               JOIN checks cc ON cc.id = pl.check_id
                    AND cc.master_id = $2 AND cc.tenant_id = $1 AND cc.is_deferred = false
                    AND cc.deleted_at IS NULL
                    AND cc.date >= $3 AND cc.date < $4
               JOIN users u ON u.id = cc.master_id AND u.tenant_id = cc.tenant_id
               LEFT JOIN product_commissions pc
                    ON pc.product_id = pl.product_id AND pc.user_id = cc.master_id AND pc.tenant_id = cc.tenant_id
              GROUP BY pl.check_id
           ) agg
          WHERE c.id = agg.check_id
            AND c.tenant_id = $1 AND c.is_deferred = false AND c.deleted_at IS NULL
            AND c.date >= $3 AND c.date < $4`,
        [tenantID, userId, monthStart, nextMonthStart],
      );
    }
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

  // ─── Section Visibility (071) ───────────────────────────────────────
  //
  // Owners (director / admin / superadmin — enforced by the controller's
  // RolesGuard) decide, per employee, which of the five top-level navigation
  // groups that employee may see. We persist ONLY explicit overrides; an absent
  // row means "use the default" (visible). The read materializes all five keys
  // (defaults merged with overrides) so the client always gets a complete map.

  /** Stamp `dismissed_at`/role guard once and return the target's role. */
  private async loadVisibilityTarget(userId: string, tenantID: string) {
    const { rows } = await this.pool.query('SELECT role FROM users WHERE id=$1 AND tenant_id=$2', [userId, tenantID]);
    if (rows.length === 0) throw new NotFoundException({ message: 'Пользователь не найден' });
    return rows[0].role as string;
  }

  /**
   * Resolve the effective visibility map for a user: every one of the five
   * sections, defaulting to `isVisible: true`, with any stored override applied.
   * Always returns all five keys in a stable order so the client never has to
   * know the default itself.
   */
  async getSectionVisibility(userId: string, tenantID: string) {
    // Tenant-scoped existence check — a forged id from another tenant 404s here
    // rather than silently returning a full default map.
    await this.loadVisibilityTarget(userId, tenantID);

    const { rows } = await this.pool.query(
      `SELECT section_key, is_visible
       FROM section_visibility
       WHERE tenant_id = $1 AND user_id = $2`,
      [tenantID, userId],
    );

    const overrides = new Map<string, boolean>(rows.map((r) => [r.section_key as string, !!r.is_visible]));

    return SECTION_KEYS.map((sectionKey) => ({
      sectionKey,
      isVisible: overrides.has(sectionKey) ? (overrides.get(sectionKey) as boolean) : true,
    }));
  }

  /**
   * Upsert the supplied overrides, then return the freshly-materialized map.
   * Business rules (self-lockout protection):
   *  - You can never hide ALL five sections — at least one must stay visible.
   *  - A director / superadmin (owner-class) account must keep the `work`
   *    section visible — that's their floor of access, so a misconfiguration
   *    (theirs or anyone editing them) can't brick the owner out of the app.
   * Both are evaluated against the RESULTING state (existing overrides merged
   * with this request), not just the request body, so partial PATCHes are safe.
   */
  async updateSectionVisibility(
    userId: string,
    tenantID: string,
    sections: Array<{ sectionKey: SectionKey; isVisible: boolean }>,
  ) {
    const targetRole = await this.loadVisibilityTarget(userId, tenantID);

    // Collapse duplicate keys in the body (last write wins) so the resulting
    // map and the upsert are deterministic.
    const requested = new Map<SectionKey, boolean>();
    for (const s of sections) requested.set(s.sectionKey, s.isVisible);

    // Compute the resulting effective map = current stored overrides + request.
    const { rows: existing } = await this.pool.query(
      `SELECT section_key, is_visible FROM section_visibility WHERE tenant_id=$1 AND user_id=$2`,
      [tenantID, userId],
    );
    const effective = new Map<SectionKey, boolean>(SECTION_KEYS.map((k) => [k, true]));
    for (const r of existing) effective.set(r.section_key as SectionKey, !!r.is_visible);
    for (const [k, v] of requested) effective.set(k, v);

    // Rule 1 — never hide every section.
    const anyVisible = SECTION_KEYS.some((k) => effective.get(k) === true);
    if (!anyVisible) {
      throw new BadRequestException({ message: 'Нельзя скрыть все разделы — хотя бы один должен оставаться видимым' });
    }

    // Rule 2 — owner-class accounts keep `work` (the access floor) visible.
    const isOwnerClass = targetRole === 'director' || targetRole === 'superadmin';
    if (isOwnerClass && effective.get('work') !== true) {
      throw new BadRequestException({
        message: 'Раздел «Работа» нельзя скрыть у директора или владельца',
      });
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const [sectionKey, isVisible] of requested) {
        await client.query(
          `INSERT INTO section_visibility (tenant_id, user_id, section_key, is_visible)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (tenant_id, user_id, section_key)
           DO UPDATE SET is_visible = EXCLUDED.is_visible, updated_at = now()`,
          [tenantID, userId, sectionKey, isVisible],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      this.logger.error(`updateSectionVisibility error: ${err}`);
      throw new InternalServerErrorException({ message: 'Ошибка сохранения видимости разделов' });
    } finally {
      client.release();
    }

    // Changing what an employee can see is a permission-ish change — drop their
    // cached auth so the next request reflects it without waiting for the TTL.
    invalidateAuthUser(userId);

    return this.getSectionVisibility(userId, tenantID);
  }

  // ─── Item Visibility (073) ──────────────────────────────────────────
  // Granular per-employee item (sub-section) visibility, ADDITIVE to the
  // group-level section visibility above. Owners hide individual «Ещё» menu rows
  // within an otherwise-visible group. We persist ONLY explicit overrides; the
  // read always materializes the full known set (defaults merged with overrides).

  /**
   * Resolve the effective visibility map for a user: every known item key,
   * defaulting to `isVisible: true`, with any stored override applied. Always
   * returns the full set in canonical order so the client never needs the
   * defaults itself. Overrides for keys no longer in ALL_ITEM_KEYS (a removed
   * menu row) are ignored — only known keys are returned.
   */
  async getItemVisibility(userId: string, tenantID: string) {
    // Tenant-scoped existence check — a forged id from another tenant 404s here
    // rather than silently returning a full default map.
    await this.loadVisibilityTarget(userId, tenantID);

    const { rows } = await this.pool.query(
      `SELECT item_key, is_visible
       FROM item_visibility
       WHERE tenant_id = $1 AND user_id = $2`,
      [tenantID, userId],
    );

    const overrides = new Map<string, boolean>(rows.map((r) => [r.item_key as string, !!r.is_visible]));

    return ALL_ITEM_KEYS.map((itemKey) => ({
      itemKey,
      isVisible: overrides.has(itemKey) ? (overrides.get(itemKey) as boolean) : true,
    }));
  }

  /**
   * Upsert the supplied item overrides, then return the freshly-materialized
   * map. Business rules (self-lockout protection), evaluated against the
   * RESULTING state (existing overrides merged with this request) so partial
   * PATCHes are safe:
   *  - You can never hide EVERY known item — at least one must stay visible.
   *  - A director / superadmin (owner-class) account must keep the protected
   *    items (`users`, `company-settings`) visible — the access floor, so a
   *    misconfiguration can't brick the owner out of user management / company
   *    settings. Mirrors the section-level «work» floor.
   * Unknown item keys in the body are rejected so a typo / removed row can't
   * write a dangling override that the read would silently drop.
   */
  async updateItemVisibility(userId: string, tenantID: string, items: Array<{ itemKey: string; isVisible: boolean }>) {
    const targetRole = await this.loadVisibilityTarget(userId, tenantID);

    const knownKeys = new Set<string>(ALL_ITEM_KEYS);

    // Collapse duplicate keys in the body (last write wins) and reject unknown
    // keys up front so the upsert and resulting map are deterministic.
    const requested = new Map<string, boolean>();
    for (const it of items) {
      if (!knownKeys.has(it.itemKey)) {
        throw new BadRequestException({ message: `Неизвестный пункт меню: ${it.itemKey}` });
      }
      requested.set(it.itemKey, it.isVisible);
    }

    // Compute the resulting effective map = defaults + stored overrides + body.
    const { rows: existing } = await this.pool.query(
      `SELECT item_key, is_visible FROM item_visibility WHERE tenant_id=$1 AND user_id=$2`,
      [tenantID, userId],
    );
    const effective = new Map<string, boolean>(ALL_ITEM_KEYS.map((k) => [k, true]));
    for (const r of existing) {
      // Ignore stored overrides for keys that no longer exist in the menu.
      if (knownKeys.has(r.item_key as string)) effective.set(r.item_key as string, !!r.is_visible);
    }
    for (const [k, v] of requested) effective.set(k, v);

    // Rule 1 — never hide every item.
    const anyVisible = ALL_ITEM_KEYS.some((k) => effective.get(k) === true);
    if (!anyVisible) {
      throw new BadRequestException({ message: 'Нельзя скрыть все пункты — хотя бы один должен оставаться видимым' });
    }

    // Rule 2 — owner-class accounts keep the protected items visible.
    const isOwnerClass = targetRole === 'director' || targetRole === 'superadmin';
    if (isOwnerClass) {
      const lockedOut = OWNER_PROTECTED_ITEM_KEYS.find((k) => effective.get(k) !== true);
      if (lockedOut) {
        throw new BadRequestException({
          message: 'Этот пункт нельзя скрыть у директора или владельца',
        });
      }
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const [itemKey, isVisible] of requested) {
        await client.query(
          `INSERT INTO item_visibility (tenant_id, user_id, item_key, is_visible)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (tenant_id, user_id, item_key)
           DO UPDATE SET is_visible = EXCLUDED.is_visible, updated_at = now()`,
          [tenantID, userId, itemKey, isVisible],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      this.logger.error(`updateItemVisibility error: ${err}`);
      throw new InternalServerErrorException({ message: 'Ошибка сохранения видимости пунктов' });
    } finally {
      client.release();
    }

    // Changing what an employee can see is a permission-ish change — drop their
    // cached auth so the next request reflects it without waiting for the TTL.
    invalidateAuthUser(userId);

    return this.getItemVisibility(userId, tenantID);
  }

  // ─── Action Permissions (server-enforced) ──────────────────────────
  // The owner sets another user's action-permission map (users.permissions).
  // This is the SAME column the legacy PATCH /users/:id already writes via
  // UpdateUserDto.permissions; this dedicated endpoint exists so the
  // permissions editor has a focused, self-lockout-protected path. Reads/writes
  // are tenant-scoped (a foreign id 404s) and the controller restricts the
  // caller to owner-class roles.

  /** Return the user's stored permission map (tenant-scoped). */
  async getPermissions(userId: string, tenantID: string): Promise<Record<string, boolean>> {
    const { rows } = await this.pool.query(
      `SELECT COALESCE(permissions, '{}') as permissions FROM users WHERE id=$1 AND tenant_id=$2`,
      [userId, tenantID],
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Пользователь не найден' });
    const raw = rows[0].permissions;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, boolean>;
  }

  /**
   * Replace a user's action-permission map.
   *
   * Self-lockout protection: a user editing THEIR OWN account cannot drop
   * `user_management` — that's the key that gates the very screen they're using
   * to manage permissions, so removing it from yourself would brick your access
   * to user management (mirrors the section/item visibility «work» floor).
   * Editing someone ELSE's `user_management` is allowed (an owner can demote a
   * sub-admin). Owner-class role gating is enforced by the controller.
   *
   * Every value is coerced to a strict boolean so a forged `"true"`/1/null in
   * the JSON body can't store a non-boolean that the guard would mis-read.
   */
  async updatePermissions(
    userId: string,
    tenantID: string,
    actorUserId: string,
    permissions: Record<string, boolean>,
  ): Promise<Record<string, boolean>> {
    // Tenant-scoped existence check — a forged id from another tenant 404s.
    const { rows: existsRows } = await this.pool.query(`SELECT 1 FROM users WHERE id=$1 AND tenant_id=$2`, [
      userId,
      tenantID,
    ]);
    if (existsRows.length === 0) throw new NotFoundException({ message: 'Пользователь не найден' });

    // Coerce to a clean boolean map.
    const clean: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(permissions || {})) {
      clean[key] = value === true;
    }

    // Self-lockout guard: you can't strip your own user_management.
    if (userId === actorUserId && clean.user_management !== true) {
      throw new BadRequestException({
        message: 'Нельзя снять у себя право «Управление пользователями»',
      });
    }

    const { rows } = await this.pool.query(
      `UPDATE users SET permissions=$1, updated_at=now() WHERE id=$2 AND tenant_id=$3
       RETURNING COALESCE(permissions, '{}') as permissions`,
      [JSON.stringify(clean), userId, tenantID],
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Пользователь не найден' });

    // Permission change must take effect on the user's NEXT request, not after
    // the auth-cache TTL — drop their cached JWT validations (same trigger the
    // legacy PATCH /users/:id path already fires when it touches permissions).
    invalidateAuthUser(userId);

    const raw = rows[0].permissions;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, boolean>;
  }

  /**
   * 114 — ЭФФЕКТИВНЫЕ права пользователя (плоский результат для UI волны 2):
   * ровно то, что ответит userHasPermission на каждый канонический ключ для
   * этого аккаунта. Считается из тех же примитивов, что и enforcement
   * (flatten(матрицы роли) ⊕ персональные overrides → userHasPermission), —
   * ответ физически не может разойтись с реальными решениями guard'ов:
   * owner-class → всё true; master без role_id → сегодняшние дефолты; с
   * role_id → база из матрицы. Явные НЕканонические ключи из users.permissions
   * тоже включаются (их guard видит теми же глазами).
   */
  async getEffectivePermissions(
    userId: string,
    tenantID: string,
  ): Promise<{ role: string; roleId: string | null; permissions: Record<string, boolean> }> {
    const { rows } = await this.pool.query(
      `SELECT u.role, u.role_id, COALESCE(u.permissions, '{}') AS permissions, r.matrix AS role_matrix
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
       WHERE u.id = $1 AND u.tenant_id = $2`,
      [userId, tenantID],
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Пользователь не найден' });

    const rawPerms = rows[0].permissions;
    const ownPerms = (typeof rawPerms === 'string' ? JSON.parse(rawPerms) : rawPerms || {}) as Record<string, boolean>;
    let roleMatrix = rows[0].role_matrix ?? null;
    if (typeof roleMatrix === 'string') {
      try {
        roleMatrix = JSON.parse(roleMatrix);
      } catch {
        roleMatrix = null;
      }
    }

    const actor = { role: rows[0].role as string, permissions: mergeEffectivePermissions(roleMatrix, ownPerms) };
    const keys = new Set<string>([...CANONICAL_PERMISSION_KEYS, ...Object.keys(actor.permissions)]);
    const permissions: Record<string, boolean> = {};
    for (const key of keys) permissions[key] = userHasPermission(actor, key);

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
    // Verify user exists
    const { rows: userRows } = await this.pool.query('SELECT id FROM users WHERE id=$1 AND tenant_id=$2', [
      userId,
      tenantID,
    ]);
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
      await this.recomputeCurrentMonthSalary(client, tenantID, userId, { service: false, product: true });

      await client.query('COMMIT');
      // Current-month product salary / profit moved — drop cached aggregates.
      invalidateReportsForTenant(tenantID);
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
