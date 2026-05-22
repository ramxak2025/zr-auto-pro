import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';

@Injectable()
export class ServicesService {
  constructor(@Inject(PG_POOL) private pool: Pool) {}

  private mapService(row: any) {
    return {
      id: row.id,
      name: row.name,
      category: row.category,
      defaultPrice: parseFloat(row.default_price) || 0,
      masterPercent:
        row.master_percent !== null && row.master_percent !== undefined ? parseFloat(row.master_percent) : null,
      warrantyDays: row.warranty_days !== null && row.warranty_days !== undefined ? parseInt(row.warranty_days) : null,
      createdAt: row.created_at,
    };
  }

  private normalizeWarrantyDays(value: unknown): number | null {
    if (value === undefined || value === null || value === '') return null;
    const n = parseInt(String(value), 10);
    if (!Number.isFinite(n)) return null;
    if (n <= 0) return null;
    return Math.min(n, 36500);
  }

  async getAll(tenantID: string, query: any) {
    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 100;
    const offset = (page - 1) * limit;
    const search = query.search || '';
    const category = query.category || '';

    let where = 'tenant_id = $1';
    const params: any[] = [tenantID];
    let idx = 2;

    if (search) {
      where += ` AND name ILIKE $${idx}`;
      params.push(`%${search}%`);
      idx++;
    }
    if (category) {
      where += ` AND category = $${idx}`;
      params.push(category);
      idx++;
    }

    const countResult = await this.pool.query(`SELECT COUNT(*) as total FROM services WHERE ${where}`, params);
    const total = parseInt(countResult.rows[0].total);

    params.push(limit, offset);
    const { rows } = await this.pool.query(
      `SELECT * FROM services WHERE ${where} ORDER BY name LIMIT $${idx} OFFSET $${idx + 1}`,
      params,
    );

    return { data: rows.map(this.mapService), total, page, limit };
  }

  async getById(id: string, tenantID: string) {
    const { rows } = await this.pool.query('SELECT * FROM services WHERE id=$1 AND tenant_id=$2', [id, tenantID]);
    if (rows.length === 0) throw new NotFoundException({ message: 'Услуга не найдена' });
    return this.mapService(rows[0]);
  }

  async create(tenantID: string, dto: any) {
    const { rows } = await this.pool.query(
      `INSERT INTO services (name, category, default_price, master_percent, warranty_days, tenant_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        dto.name,
        dto.category,
        dto.defaultPrice || 0,
        dto.masterPercent ?? null,
        this.normalizeWarrantyDays(dto.warrantyDays),
        tenantID,
      ],
    );
    return this.mapService(rows[0]);
  }

  async update(id: string, tenantID: string, dto: any) {
    const sets: string[] = [];
    const vals: any[] = [];
    let idx = 1;

    if (dto.name !== undefined) {
      sets.push(`name=$${idx++}`);
      vals.push(dto.name);
    }
    if (dto.category !== undefined) {
      sets.push(`category=$${idx++}`);
      vals.push(dto.category);
    }
    if (dto.defaultPrice !== undefined) {
      sets.push(`default_price=$${idx++}`);
      vals.push(dto.defaultPrice);
    }
    if (dto.masterPercent !== undefined) {
      sets.push(`master_percent=$${idx++}`);
      vals.push(dto.masterPercent);
    }
    if (dto.warrantyDays !== undefined) {
      sets.push(`warranty_days=$${idx++}`);
      vals.push(this.normalizeWarrantyDays(dto.warrantyDays));
    }

    if (sets.length === 0) return this.getById(id, tenantID);

    vals.push(id, tenantID);
    const { rows } = await this.pool.query(
      `UPDATE services SET ${sets.join(', ')} WHERE id=$${idx++} AND tenant_id=$${idx} RETURNING *`,
      vals,
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Услуга не найдена' });
    return this.mapService(rows[0]);
  }

  async remove(id: string, tenantID: string) {
    await this.pool.query('DELETE FROM services WHERE id=$1 AND tenant_id=$2', [id, tenantID]);
    return { message: 'Удалено' };
  }
}
