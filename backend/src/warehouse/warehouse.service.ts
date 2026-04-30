import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';

@Injectable()
export class WarehouseService {
  constructor(@Inject(PG_POOL) private pool: Pool) {}

  async getCategories(tenantID: string) {
    const { rows } = await this.pool.query(
      // deleted_at filter is forward-compatible; today categories are hard-deleted
      // but the column was added in migration 023 alongside products' trash bin.
      'SELECT id, path, COALESCE(sort_order, 0) as sort_order FROM warehouse_categories WHERE tenant_id=$1 AND deleted_at IS NULL ORDER BY sort_order, path',
      [tenantID],
    );
    return rows;
  }

  async createCategory(tenantID: string, path: string) {
    if (!path) throw new BadRequestException({ message: 'Путь обязателен' });
    const { rows } = await this.pool.query(
      `INSERT INTO warehouse_categories (path, tenant_id) VALUES ($1, $2)
       ON CONFLICT (path, tenant_id) DO UPDATE SET path=$1
       RETURNING id, path, COALESCE(sort_order, 0) as sort_order`,
      [path, tenantID],
    );
    return rows[0];
  }

  async removeCategory(id: string, tenantID: string, moveProductsTo?: string) {
    // Find the path of the category being deleted
    const { rows: catRows } = await this.pool.query(
      'SELECT path FROM warehouse_categories WHERE id=$1 AND tenant_id=$2',
      [id, tenantID],
    );
    if (catRows.length === 0) return { message: 'Не найдено' };
    const deletedPath = catRows[0].path;

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Move products that were in this category (or subcategories)
      if (moveProductsTo !== undefined) {
        // Move to specific target folder (or root if empty string)
        const target = moveProductsTo || null;
        await client.query(
          `UPDATE products SET category=$3
           WHERE tenant_id=$1 AND (category=$2 OR category LIKE $2 || '/%')`,
          [tenantID, deletedPath, target],
        );
      } else {
        // Default: clear category (move to root)
        await client.query(
          `UPDATE products SET category=NULL
           WHERE tenant_id=$1 AND (category=$2 OR category LIKE $2 || '/%')`,
          [tenantID, deletedPath],
        );
      }

      // Delete the category and all subcategories
      await client.query(
        `DELETE FROM warehouse_categories WHERE tenant_id=$1 AND (path=$2 OR path LIKE $2 || '/%')`,
        [tenantID, deletedPath],
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    return { message: 'Удалено' };
  }

  async updateOrder(tenantID: string, orderedIds: string[]) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (let i = 0; i < orderedIds.length; i++) {
        await client.query(
          'UPDATE warehouse_categories SET sort_order=$1 WHERE id=$2 AND tenant_id=$3',
          [i, orderedIds[i], tenantID],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    return { message: 'OK' };
  }

  async renameCategory(id: string, tenantID: string, newPath: string) {
    const { rows: catRows } = await this.pool.query(
      'SELECT path FROM warehouse_categories WHERE id=$1 AND tenant_id=$2',
      [id, tenantID],
    );
    if (catRows.length === 0) throw new BadRequestException({ message: 'Категория не найдена' });
    const oldPath = catRows[0].path;

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Rename category itself
      await client.query(
        'UPDATE warehouse_categories SET path=$3 WHERE id=$1 AND tenant_id=$2',
        [id, tenantID, newPath],
      );

      // Rename all subcategories
      await client.query(
        `UPDATE warehouse_categories SET path = $3 || substring(path from length($2) + 1)
         WHERE tenant_id=$1 AND path LIKE $2 || '/%'`,
        [tenantID, oldPath, newPath],
      );

      // Update products category references
      await client.query(
        'UPDATE products SET category=$3 WHERE tenant_id=$1 AND category=$2',
        [tenantID, oldPath, newPath],
      );
      await client.query(
        `UPDATE products SET category = $3 || substring(category from length($2) + 1)
         WHERE tenant_id=$1 AND category LIKE $2 || '/%'`,
        [tenantID, oldPath, newPath],
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    return { message: 'OK' };
  }
}
