import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';

@Injectable()
export class WarehouseService {
  constructor(@Inject(PG_POOL) private pool: Pool) {}

  /**
   * Resolve which warehouse a category read / write should target.
   *
   *   - explicit warehouseId from caller → verify it lives in tenant;
   *   - null / undefined → fall back to the tenant's "main" warehouse
   *     (matches the pre-migration tenant-scoped behaviour, so callers
   *     that pre-date the per-warehouse split keep their old folders).
   */
  private async resolveWarehouseId(tenantID: string, warehouseId?: string | null): Promise<string | null> {
    if (warehouseId) {
      const { rows } = await this.pool.query('SELECT id FROM warehouses WHERE id=$1 AND tenant_id=$2 LIMIT 1', [
        warehouseId,
        tenantID,
      ]);
      if (rows.length === 0) {
        throw new BadRequestException({ message: 'Склад не найден' });
      }
      return rows[0].id;
    }
    const { rows } = await this.pool.query(`SELECT id FROM warehouses WHERE tenant_id=$1 AND kind='main' LIMIT 1`, [
      tenantID,
    ]);
    return rows.length > 0 ? rows[0].id : null;
  }

  async getCategories(tenantID: string, warehouseId?: string) {
    // After 032_warehouse_categories_per_warehouse.sql every category
    // owns a `warehouse_id`. Filter strictly so brak / used / main
    // never bleed into each other. When no warehouseId is given we
    // fall back to the tenant's main warehouse to preserve the legacy
    // tenant-scoped behaviour for callers that haven't migrated yet.
    const resolvedWarehouseId = await this.resolveWarehouseId(tenantID, warehouseId);
    const { rows } = await this.pool.query(
      // deleted_at filter is forward-compatible; today categories are hard-deleted
      // but the column was added in migration 023 alongside products' trash bin.
      `SELECT id, path, COALESCE(sort_order, 0) as sort_order
         FROM warehouse_categories
        WHERE tenant_id = $1
          AND deleted_at IS NULL
          AND (warehouse_id = $2 OR ($2 IS NULL AND warehouse_id IS NULL))
        ORDER BY sort_order, path`,
      [tenantID, resolvedWarehouseId],
    );
    return rows;
  }

  async createCategory(tenantID: string, path: string, warehouseId?: string) {
    if (!path) throw new BadRequestException({ message: 'Путь обязателен' });
    const resolvedWarehouseId = await this.resolveWarehouseId(tenantID, warehouseId);
    // The unique index (tenant_id, warehouse_id, path) replaces the old
    // (tenant_id, path) constraint, so the same folder name can live in
    // main and Б/У independently. We use a manual upsert because the
    // partial unique index (WHERE warehouse_id IS NOT NULL) is not
    // valid for ON CONFLICT inference — Postgres needs a NOT NULL
    // predicate to match it. The SELECT-then-INSERT below is wrapped
    // in a transaction so a race between two clients can't break the
    // invariant.
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: existing } = await client.query(
        `SELECT id, path, COALESCE(sort_order, 0) as sort_order
           FROM warehouse_categories
          WHERE tenant_id = $1
            AND path = $2
            AND (warehouse_id = $3 OR ($3 IS NULL AND warehouse_id IS NULL))
          LIMIT 1`,
        [tenantID, path, resolvedWarehouseId],
      );
      if (existing.length > 0) {
        await client.query('COMMIT');
        return existing[0];
      }
      const { rows } = await client.query(
        `INSERT INTO warehouse_categories (path, tenant_id, warehouse_id)
              VALUES ($1, $2, $3)
         RETURNING id, path, COALESCE(sort_order, 0) as sort_order`,
        [path, tenantID, resolvedWarehouseId],
      );
      await client.query('COMMIT');
      return rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async removeCategory(id: string, tenantID: string, moveProductsTo?: string, deleteContents?: boolean) {
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

      if (deleteContents) {
        // Soft-delete every live product in this folder (and subfolders).
        // The trash bin keeps them — owner can restore individually if a
        // mistake was made.
        await client.query(
          `UPDATE products SET deleted_at = NOW()
           WHERE tenant_id=$1
             AND deleted_at IS NULL
             AND (category=$2 OR category LIKE $2 || '/%')`,
          [tenantID, deletedPath],
        );
      } else if (moveProductsTo !== undefined) {
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
      await client.query(`DELETE FROM warehouse_categories WHERE tenant_id=$1 AND (path=$2 OR path LIKE $2 || '/%')`, [
        tenantID,
        deletedPath,
      ]);

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    return { message: deleteContents ? 'Папка и товары удалены' : 'Папка удалена' };
  }

  async updateOrder(tenantID: string, orderedIds: string[]) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (let i = 0; i < orderedIds.length; i++) {
        await client.query('UPDATE warehouse_categories SET sort_order=$1 WHERE id=$2 AND tenant_id=$3', [
          i,
          orderedIds[i],
          tenantID,
        ]);
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
      await client.query('UPDATE warehouse_categories SET path=$3 WHERE id=$1 AND tenant_id=$2', [
        id,
        tenantID,
        newPath,
      ]);

      // Rename all subcategories
      await client.query(
        `UPDATE warehouse_categories SET path = $3 || substring(path from length($2) + 1)
         WHERE tenant_id=$1 AND path LIKE $2 || '/%'`,
        [tenantID, oldPath, newPath],
      );

      // Update products category references
      await client.query('UPDATE products SET category=$3 WHERE tenant_id=$1 AND category=$2', [
        tenantID,
        oldPath,
        newPath,
      ]);
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
