import { Injectable, Inject, BadRequestException, NotFoundException, ForbiddenException, InternalServerErrorException, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import * as bcrypt from 'bcryptjs';
import { PG_POOL } from '../database.module';
import { normalizePhone } from '../common/normalize-phone';

@Injectable()
export class UsersService {
  private readonly logger = new Logger('UsersService');

  constructor(@Inject(PG_POOL) private pool: Pool) {}

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
      permissions: typeof row.permissions === 'string' ? JSON.parse(row.permissions) : (row.permissions || {}),
      daysOff,
      isActive: row.is_active,
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
              is_active, tenant_id, created_at
       FROM users WHERE tenant_id = $1 ORDER BY created_at`,
      [tenantID],
    );
    return rows.map(this.mapUser);
  }

  async getMasters(tenantID: string) {
    const { rows } = await this.pool.query(
      `SELECT id, phone, full_name, username, avatar, role,
              COALESCE(salary_percent, 0) as salary_percent,
              COALESCE(product_salary_percent, 0) as product_salary_percent,
              COALESCE(permissions, '{}') as permissions,
              COALESCE(days_off, '[]') as days_off,
              is_active, tenant_id, created_at
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
              is_active, tenant_id, created_at
       FROM users WHERE id = $1 AND tenant_id = $2`,
      [id, tenantID],
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Пользователь не найден' });
    return this.mapUser(rows[0]);
  }

  async create(tenantID: string, dto: any) {
    if (!dto.phone || !dto.password || !dto.fullName) {
      throw new BadRequestException({ message: 'Телефон, пароль и имя обязательны' });
    }

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
    const role = dto.role || 'master';

    try {
      const { rows } = await this.pool.query(
        `INSERT INTO users (phone, password, full_name, role, salary_percent, permissions, is_active, tenant_id)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, true, $7)
         RETURNING id, phone, full_name, username, avatar, role, salary_percent, product_salary_percent, permissions, days_off, is_active, tenant_id, created_at`,
        [phone, hash, dto.fullName, role, Number(dto.salaryPercent) || 0, perms, tenantID],
      );
      return this.mapUser(rows[0]);
    } catch (err: any) {
      this.logger.error(`User create error: code=${err.code} detail=${err.detail} message=${err.message}`);
      if (err.code === '23505') {
        throw new BadRequestException({ message: 'Пользователь с таким телефоном уже существует' });
      }
      if (err.code === '23503') {
        throw new BadRequestException({ message: 'Ошибка: автосервис не найден' });
      }
      if (err.code === '23514') {
        throw new BadRequestException({ message: `Недопустимая роль: ${role}` });
      }
      throw new InternalServerErrorException({ message: `Ошибка создания сотрудника: ${err.message}` });
    }
  }

  async update(id: string, tenantID: string, dto: any) {
    const sets: string[] = [];
    const vals: any[] = [];
    let idx = 1;

    if (dto.phone !== undefined) { sets.push(`phone=$${idx++}`); vals.push(normalizePhone(dto.phone)); }
    if (dto.fullName !== undefined) { sets.push(`full_name=$${idx++}`); vals.push(dto.fullName); }
    if (dto.role !== undefined) { sets.push(`role=$${idx++}`); vals.push(dto.role); }
    if (dto.salaryPercent !== undefined) { sets.push(`salary_percent=$${idx++}`); vals.push(dto.salaryPercent); }
    if (dto.productSalaryPercent !== undefined) { sets.push(`product_salary_percent=$${idx++}`); vals.push(dto.productSalaryPercent); }
    if (dto.permissions !== undefined) { sets.push(`permissions=$${idx++}`); vals.push(JSON.stringify(dto.permissions)); }
    if (dto.isActive !== undefined) { sets.push(`is_active=$${idx++}`); vals.push(dto.isActive); }
    if (dto.daysOff !== undefined) { sets.push(`days_off=$${idx++}`); vals.push(JSON.stringify(dto.daysOff)); }
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
       RETURNING id, phone, full_name, username, avatar, role, salary_percent, product_salary_percent, permissions, days_off, is_active, tenant_id, created_at`,
      vals,
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Пользователь не найден' });

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

        await this.pool.query(
          `UPDATE schedule_entries SET is_day_off=$1, shift_start=$2, shift_end=$3 WHERE id=$4`,
          [shouldBeDayOff, shouldBeDayOff ? null : '09:00', shouldBeDayOff ? null : '18:00', entry.id],
        );
      }
    }

    return this.mapUser(rows[0]);
  }

  async remove(id: string, tenantID: string, currentUserID: string, currentRole: string) {
    if (id === currentUserID) {
      throw new BadRequestException({ message: 'Нельзя удалить себя' });
    }

    const { rows } = await this.pool.query(
      'SELECT role FROM users WHERE id=$1 AND tenant_id=$2',
      [id, tenantID],
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Пользователь не найден' });

    if (rows[0].role === 'superadmin' || rows[0].role === 'director') {
      throw new ForbiddenException({ message: 'Нельзя удалить директора или суперадмина' });
    }

    await this.pool.query('DELETE FROM users WHERE id=$1 AND tenant_id=$2', [id, tenantID]);
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
      items: rows.map(r => ({
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
    const { rows: userRows } = await this.pool.query(
      'SELECT id FROM users WHERE id=$1 AND tenant_id=$2',
      [userId, tenantID],
    );
    if (userRows.length === 0) throw new NotFoundException({ message: 'Пользователь не найден' });

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Update global product salary percent
      await client.query(
        'UPDATE users SET product_salary_percent = $1 WHERE id = $2 AND tenant_id = $3',
        [dto.productSalaryPercent || 0, userId, tenantID],
      );

      // Replace all product-specific commissions
      await client.query(
        'DELETE FROM product_commissions WHERE user_id = $1 AND tenant_id = $2',
        [userId, tenantID],
      );

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
