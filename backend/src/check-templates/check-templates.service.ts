import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';

@Injectable()
export class CheckTemplatesService {
  constructor(@Inject(PG_POOL) private pool: Pool) {}

  private mapRow(r: any) {
    return {
      id: r.id,
      name: r.name,
      services: r.services || [],
      products: r.products || [],
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  async getAll(tenantId: string) {
    const { rows } = await this.pool.query(
      `SELECT id, name, services, products, created_at, updated_at
       FROM check_templates WHERE tenant_id=$1 ORDER BY name ASC`,
      [tenantId],
    );
    return rows.map(this.mapRow);
  }

  async create(tenantId: string, dto: { name: string; services: any[]; products: any[] }) {
    const { rows } = await this.pool.query(
      `INSERT INTO check_templates (tenant_id, name, services, products)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, services, products, created_at, updated_at`,
      [tenantId, dto.name, JSON.stringify(dto.services || []), JSON.stringify(dto.products || [])],
    );
    return this.mapRow(rows[0]);
  }

  async update(id: string, tenantId: string, dto: { name?: string; services?: any[]; products?: any[] }) {
    const sets: string[] = [];
    const vals: any[] = [];
    let idx = 1;

    if (dto.name !== undefined) {
      sets.push(`name=$${idx++}`);
      vals.push(dto.name);
    }
    if (dto.services !== undefined) {
      sets.push(`services=$${idx++}`);
      vals.push(JSON.stringify(dto.services));
    }
    if (dto.products !== undefined) {
      sets.push(`products=$${idx++}`);
      vals.push(JSON.stringify(dto.products));
    }
    sets.push(`updated_at=now()`);

    if (sets.length === 1) {
      // Only updated_at — just return current
      const { rows } = await this.pool.query(
        `SELECT id, name, services, products, created_at, updated_at FROM check_templates WHERE id=$1 AND tenant_id=$2`,
        [id, tenantId],
      );
      if (rows.length === 0) throw new NotFoundException({ message: 'Шаблон не найден' });
      return this.mapRow(rows[0]);
    }

    vals.push(id, tenantId);
    const { rows } = await this.pool.query(
      `UPDATE check_templates SET ${sets.join(', ')}
       WHERE id=$${idx++} AND tenant_id=$${idx}
       RETURNING id, name, services, products, created_at, updated_at`,
      vals,
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Шаблон не найден' });
    return this.mapRow(rows[0]);
  }

  async remove(id: string, tenantId: string) {
    const { rows } = await this.pool.query(`DELETE FROM check_templates WHERE id=$1 AND tenant_id=$2 RETURNING id`, [
      id,
      tenantId,
    ]);
    if (rows.length === 0) throw new NotFoundException({ message: 'Шаблон не найден' });
    return { message: 'Удалено' };
  }
}
