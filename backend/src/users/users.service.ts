import {
  Injectable,
  Inject,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { Pool } from 'pg';
import * as bcrypt from 'bcryptjs';
import { PG_POOL } from '../database.module';
import { normalizePhone } from '../common/normalize-phone';
import { invalidateAuthUser } from '../common/auth-cache';

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
              tenant_id, created_at
       FROM users WHERE tenant_id = $1 ORDER BY sort_order, created_at`,
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
              tenant_id, created_at
       FROM users
       WHERE tenant_id = $1 AND is_active = true AND role IN ('master','admin')
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
              tenant_id, created_at
       FROM users WHERE id = $1 AND tenant_id = $2`,
      [id, tenantID],
    );
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
         RETURNING id, phone, full_name, username, avatar, role, salary_percent, product_salary_percent, permissions, days_off, is_active, team, can_add_expenses, daily_expense_limit, hidden_from_schedule, hidden_everywhere, tenant_id, created_at`,
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
    const { rows: targetRows } = await this.pool.query('SELECT role FROM users WHERE id=$1 AND tenant_id=$2', [
      id,
      tenantID,
    ]);
    if (targetRows.length === 0) throw new NotFoundException({ message: 'Пользователь не найден' });
    const targetRole = targetRows[0].role as string;

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
    if (dto.password) {
      const hash = await bcrypt.hash(dto.password, 10);
      sets.push(`password=$${idx++}`);
      vals.push(hash);
    }

    if (sets.length === 0) {
      return this.getById(id, tenantID);
    }

    sets.push(`updated_at=now()`);
    vals.push(id, tenantID);

    const { rows } = await this.pool.query(
      `UPDATE users SET ${sets.join(', ')} WHERE id=$${idx++} AND tenant_id=$${idx}
       RETURNING id, phone, full_name, username, avatar, role, salary_percent, product_salary_percent, permissions, days_off, is_active, team, can_add_expenses, daily_expense_limit, hidden_from_schedule, hidden_everywhere, tenant_id, created_at`,
      vals,
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Пользователь не найден' });

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

    return this.mapUser(rows[0]);
  }

  async remove(id: string, tenantID: string, currentUserID: string, currentRole: string) {
    if (id === currentUserID) {
      throw new BadRequestException({ message: 'Нельзя удалить себя' });
    }

    const { rows } = await this.pool.query('SELECT role FROM users WHERE id=$1 AND tenant_id=$2', [id, tenantID]);
    if (rows.length === 0) throw new NotFoundException({ message: 'Пользователь не найден' });

    if (rows[0].role === 'superadmin' || rows[0].role === 'director') {
      throw new ForbiddenException({ message: 'Нельзя удалить директора или суперадмина' });
    }

    await this.pool.query('DELETE FROM users WHERE id=$1 AND tenant_id=$2', [id, tenantID]);
    // Purge the deleted user's cached JWT validations so any still-signed token
    // is rejected (user-not-found) on the next request instead of cache-served.
    invalidateAuthUser(id);
    return { message: 'Удалено' };
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

      await client.query('COMMIT');
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
