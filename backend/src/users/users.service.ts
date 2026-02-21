import { Injectable, Inject, BadRequestException, NotFoundException, ForbiddenException, InternalServerErrorException, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import * as bcrypt from 'bcryptjs';
import { PG_POOL } from '../database.module';

@Injectable()
export class UsersService {
  private readonly logger = new Logger('UsersService');

  constructor(@Inject(PG_POOL) private pool: Pool) {}

  private mapUser(row: any) {
    return {
      id: row.id,
      phone: row.phone,
      fullName: row.full_name,
      username: row.username,
      avatar: row.avatar,
      role: row.role,
      salaryPercent: parseFloat(row.salary_percent) || 0,
      permissions: typeof row.permissions === 'string' ? JSON.parse(row.permissions) : (row.permissions || {}),
      isActive: row.is_active,
      tenantId: row.tenant_id,
      createdAt: row.created_at,
    };
  }

  async getAll(tenantID: string) {
    const { rows } = await this.pool.query(
      `SELECT id, phone, full_name, username, avatar, role,
              COALESCE(salary_percent, 0) as salary_percent,
              COALESCE(permissions, '{}') as permissions,
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
              COALESCE(permissions, '{}') as permissions,
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
              COALESCE(permissions, '{}') as permissions,
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

    const { rows: existsRows } = await this.pool.query(
      'SELECT EXISTS(SELECT 1 FROM users WHERE phone=$1) as exists',
      [dto.phone],
    );
    if (existsRows[0].exists) {
      throw new BadRequestException({ message: 'Пользователь с таким телефоном уже существует' });
    }

    const hash = await bcrypt.hash(dto.password, 10);
    const perms = dto.permissions ? JSON.stringify(dto.permissions) : '{}';

    const { rows } = await this.pool.query(
      `INSERT INTO users (phone, password, full_name, role, salary_percent, permissions, is_active, tenant_id)
       VALUES ($1, $2, $3, $4, $5, $6, true, $7)
       RETURNING id, phone, full_name, username, avatar, role, salary_percent, permissions, is_active, tenant_id, created_at`,
      [dto.phone, hash, dto.fullName, dto.role || 'master', dto.salaryPercent || 0, perms, tenantID],
    );
    return this.mapUser(rows[0]);
  }

  async update(id: string, tenantID: string, dto: any) {
    const sets: string[] = [];
    const vals: any[] = [];
    let idx = 1;

    if (dto.phone !== undefined) { sets.push(`phone=$${idx++}`); vals.push(dto.phone); }
    if (dto.fullName !== undefined) { sets.push(`full_name=$${idx++}`); vals.push(dto.fullName); }
    if (dto.role !== undefined) { sets.push(`role=$${idx++}`); vals.push(dto.role); }
    if (dto.salaryPercent !== undefined) { sets.push(`salary_percent=$${idx++}`); vals.push(dto.salaryPercent); }
    if (dto.permissions !== undefined) { sets.push(`permissions=$${idx++}`); vals.push(JSON.stringify(dto.permissions)); }
    if (dto.isActive !== undefined) { sets.push(`is_active=$${idx++}`); vals.push(dto.isActive); }
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
       RETURNING id, phone, full_name, username, avatar, role, salary_percent, permissions, is_active, tenant_id, created_at`,
      vals,
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Пользователь не найден' });
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
}
