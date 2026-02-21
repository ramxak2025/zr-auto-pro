import { Injectable, Inject, NotFoundException, InternalServerErrorException, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import * as bcrypt from 'bcryptjs';
import { PG_POOL } from '../database.module';

@Injectable()
export class TenantsService {
  private readonly logger = new Logger('TenantsService');

  constructor(@Inject(PG_POOL) private pool: Pool) {}

  private mapTenant(row: any) {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      phone: row.phone,
      address: row.address,
      email: row.email,
      description: row.description,
      logo: row.logo,
      isActive: row.is_active,
      maxUsers: row.max_users,
      planId: row.plan_id,
      monthlyPrice: parseFloat(row.monthly_price) || 0,
      subscriptionEnd: row.subscription_end,
      subscriptionNote: row.subscription_note,
      userCount: row.user_count !== undefined ? parseInt(row.user_count) : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async getAll() {
    const { rows } = await this.pool.query(
      `SELECT t.*,
              (SELECT COUNT(*) FROM users WHERE tenant_id=t.id) as user_count,
              p.name as plan_name, p.monthly_price as plan_monthly_price, p.max_users as plan_max_users, p.description as plan_description
       FROM tenants t
       LEFT JOIN plans p ON p.id = t.plan_id
       ORDER BY t.created_at DESC`,
    );
    return rows.map((row) => {
      const tenant = this.mapTenant(row);
      if (row.plan_id && row.plan_name) {
        (tenant as any).plan = {
          id: row.plan_id,
          name: row.plan_name,
          monthlyPrice: parseFloat(row.plan_monthly_price) || 0,
          maxUsers: row.plan_max_users,
          description: row.plan_description,
        };
      }
      return tenant;
    });
  }

  async getStats() {
    const { rows } = await this.pool.query(
      `SELECT
         (SELECT COUNT(*) FROM tenants) as total_tenants,
         (SELECT COUNT(*) FROM tenants WHERE is_active=true) as active_tenants,
         (SELECT COUNT(*) FROM users) as total_users`,
    );
    const r = rows[0];
    return {
      totalTenants: parseInt(r.total_tenants),
      activeTenants: parseInt(r.active_tenants),
      totalUsers: parseInt(r.total_users),
    };
  }

  async getById(id: string) {
    const { rows } = await this.pool.query(
      `SELECT t.*,
              (SELECT COUNT(*) FROM users WHERE tenant_id=t.id) as user_count
       FROM tenants t WHERE t.id = $1`,
      [id],
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Тенант не найден' });

    const tenant = this.mapTenant(rows[0]);

    const { rows: userRows } = await this.pool.query(
      `SELECT id, phone, full_name, username, avatar, role,
              COALESCE(salary_percent,0) as salary_percent,
              COALESCE(permissions,'{}') as permissions,
              is_active, tenant_id, created_at
       FROM users WHERE tenant_id=$1 ORDER BY created_at`,
      [id],
    );
    (tenant as any).users = userRows.map((u) => ({
      id: u.id,
      phone: u.phone,
      fullName: u.full_name,
      username: u.username,
      avatar: u.avatar,
      role: u.role,
      salaryPercent: parseFloat(u.salary_percent) || 0,
      permissions: typeof u.permissions === 'string' ? JSON.parse(u.permissions) : u.permissions,
      isActive: u.is_active,
      tenantId: u.tenant_id,
      createdAt: u.created_at,
    }));

    // Load plan
    if (rows[0].plan_id) {
      const { rows: planRows } = await this.pool.query('SELECT * FROM plans WHERE id=$1', [rows[0].plan_id]);
      if (planRows.length > 0) {
        const p = planRows[0];
        (tenant as any).plan = {
          id: p.id, name: p.name, monthlyPrice: parseFloat(p.monthly_price) || 0,
          description: p.description, features: p.features || [],
          maxUsers: p.max_users, isActive: p.is_active, sortOrder: p.sort_order, createdAt: p.created_at,
        };
      }
    }

    return tenant;
  }

  async create(dto: any) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: tenantRows } = await client.query(
        `INSERT INTO tenants (name, phone, address, email, description, is_active, max_users, plan_id, monthly_price, subscription_end, subscription_note)
         VALUES ($1,$2,$3,$4,$5,COALESCE($6,true),$7,$8,$9,$10,$11)
         RETURNING *`,
        [dto.name, dto.phone, dto.address, dto.email, dto.description,
         dto.isActive, dto.maxUsers || 10, dto.planId, dto.monthlyPrice || 0,
         dto.subscriptionEnd, dto.subscriptionNote],
      );

      const tenant = this.mapTenant(tenantRows[0]);

      // Create director user if provided
      if (dto.directorPhone && dto.directorPassword && dto.directorName) {
        const hash = await bcrypt.hash(dto.directorPassword, 10);
        const allPerms = '{"checks_view":true,"checks_create":true,"checks_edit":true,"checks_delete":true,"profit_view":true,"clients_view":true,"clients_edit":true,"warehouse_access":true,"suppliers_access":true,"financial_reports":true,"export_data":true,"user_management":true}';
        await client.query(
          `INSERT INTO users (phone, password, full_name, role, is_active, tenant_id, permissions)
           VALUES ($1, $2, $3, 'director', true, $4, $5)`,
          [dto.directorPhone, hash, dto.directorName, tenant.id, allPerms],
        );
      }

      await client.query('COMMIT');
      return tenant;
    } catch (err) {
      await client.query('ROLLBACK');
      this.logger.error(`Tenant create error: ${err}`);
      throw new InternalServerErrorException({ message: 'Ошибка сервера' });
    } finally {
      client.release();
    }
  }

  async update(id: string, dto: any) {
    const sets: string[] = [];
    const vals: any[] = [];
    let idx = 1;

    if (dto.name !== undefined) { sets.push(`name=$${idx++}`); vals.push(dto.name); }
    if (dto.phone !== undefined) { sets.push(`phone=$${idx++}`); vals.push(dto.phone); }
    if (dto.address !== undefined) { sets.push(`address=$${idx++}`); vals.push(dto.address); }
    if (dto.email !== undefined) { sets.push(`email=$${idx++}`); vals.push(dto.email); }
    if (dto.description !== undefined) { sets.push(`description=$${idx++}`); vals.push(dto.description); }
    if (dto.isActive !== undefined) { sets.push(`is_active=$${idx++}`); vals.push(dto.isActive); }
    if (dto.maxUsers !== undefined) { sets.push(`max_users=$${idx++}`); vals.push(dto.maxUsers); }
    if (dto.planId !== undefined) { sets.push(`plan_id=$${idx++}`); vals.push(dto.planId); }
    if (dto.monthlyPrice !== undefined) { sets.push(`monthly_price=$${idx++}`); vals.push(dto.monthlyPrice); }
    if (dto.subscriptionEnd !== undefined) { sets.push(`subscription_end=$${idx++}`); vals.push(dto.subscriptionEnd); }
    if (dto.subscriptionNote !== undefined) { sets.push(`subscription_note=$${idx++}`); vals.push(dto.subscriptionNote); }

    if (sets.length === 0) return this.getById(id);

    sets.push(`updated_at=now()`);
    vals.push(id);

    const { rows } = await this.pool.query(
      `UPDATE tenants SET ${sets.join(', ')} WHERE id=$${idx++} RETURNING *`,
      vals,
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Тенант не найден' });
    return this.mapTenant(rows[0]);
  }

  async remove(id: string) {
    // Full cascade delete — all related data (users, clients, cars, checks,
    // products, services, suppliers, deliveries, schedule, shifts, expenses, etc.)
    // will be removed via ON DELETE CASCADE foreign keys in the database schema.
    const { rowCount } = await this.pool.query('DELETE FROM tenants WHERE id=$1', [id]);
    if (rowCount === 0) throw new NotFoundException({ message: 'Тенант не найден' });
    return { message: 'Удалено' };
  }

  async getSubscription(tenantID: string) {
    const { rows } = await this.pool.query(
      `SELECT t.name, t.monthly_price, t.subscription_end, t.subscription_note,
              t.max_users, t.plan_id,
              (SELECT COUNT(*) FROM users WHERE tenant_id=t.id) as current_users
       FROM tenants t WHERE t.id=$1`,
      [tenantID],
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Тенант не найден' });

    const r = rows[0];

    let planName = null;
    if (r.plan_id) {
      const { rows: planRows } = await this.pool.query('SELECT name FROM plans WHERE id=$1', [r.plan_id]);
      if (planRows.length > 0) planName = planRows[0].name;
    }

    const { rows: plans } = await this.pool.query(
      'SELECT * FROM plans WHERE is_active=true ORDER BY sort_order, monthly_price',
    );

    return {
      tenantName: r.name,
      planName,
      monthlyPrice: parseFloat(r.monthly_price) || 0,
      subscriptionEnd: r.subscription_end,
      subscriptionNote: r.subscription_note,
      maxUsers: r.max_users,
      currentUsers: parseInt(r.current_users),
      plans: plans.map((p) => ({
        id: p.id, name: p.name, monthlyPrice: parseFloat(p.monthly_price) || 0,
        description: p.description, features: p.features || [],
        maxUsers: p.max_users, isActive: p.is_active, sortOrder: p.sort_order, createdAt: p.created_at,
      })),
    };
  }
}
