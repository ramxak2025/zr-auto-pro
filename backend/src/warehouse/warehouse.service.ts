import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';

@Injectable()
export class WarehouseService {
  constructor(@Inject(PG_POOL) private pool: Pool) {}

  async getCategories(tenantID: string) {
    const { rows } = await this.pool.query(
      'SELECT id, path FROM warehouse_categories WHERE tenant_id=$1 ORDER BY path',
      [tenantID],
    );
    return rows;
  }

  async createCategory(tenantID: string, path: string) {
    if (!path) throw new BadRequestException({ message: 'Путь обязателен' });
    const { rows } = await this.pool.query(
      `INSERT INTO warehouse_categories (path, tenant_id) VALUES ($1, $2)
       ON CONFLICT (path, tenant_id) DO UPDATE SET path=$1
       RETURNING id, path`,
      [path, tenantID],
    );
    return rows[0];
  }

  async removeCategory(id: string, tenantID: string) {
    await this.pool.query(
      'DELETE FROM warehouse_categories WHERE id=$1 AND tenant_id=$2',
      [id, tenantID],
    );
    return { message: 'Удалено' };
  }
}
