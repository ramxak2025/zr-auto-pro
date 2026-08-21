import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../database.module';

@Injectable()
export class WarehouseService {
  constructor(@Inject(PG_POOL) private pool: Pool) {}

  /**
   * Escape LIKE metacharacters (%, _, and the escape char \) so a user-created
   * folder path is matched LITERALLY in a subtree `LIKE path || '/%'` pattern.
   * Without this a folder named e.g. «Скидка 50%» or «A_B» would over-match
   * unrelated siblings. Paired with an explicit `ESCAPE '\'` clause in every
   * query that builds the subtree pattern (fix #6). Backslash is escaped in the
   * same single pass, so ordering is safe.
   */
  private static escapeLike(s: string): string {
    return s.replace(/[\\%_]/g, (c) => '\\' + c);
  }

  /**
   * Normalize a user-supplied folder path: trim, collapse repeated '/',
   * strip leading/trailing '/'. Empty input stays '' (= root). Shared by
   * renameCategory and ProductsService.bulkMove so «Цель//Имя/» and
   * «Цель/Имя» always resolve to the same DB path.
   */
  static normalizeFolderPath(raw: string): string {
    return raw
      .trim()
      .replace(/\/{2,}/g, '/')
      .replace(/^\/+|\/+$/g, '');
  }

  /**
   * Resolve which warehouse a category read / write should target.
   *
   *   - explicit warehouseId from caller → verify it lives in tenant;
   *   - null / undefined → fall back to the tenant's "main" warehouse
   *     (matches the pre-migration tenant-scoped behaviour, so callers
   *     that pre-date the per-warehouse split keep their old folders).
   *
   * Public: reused by ProductsService.bulkMove to scope the mass move
   * to the same warehouse the folder tree lives in.
   */
  async resolveWarehouseId(tenantID: string, warehouseId?: string | null): Promise<string | null> {
    // Мусор от битых клиентов (' ', 'undefined', 'null', '' после trim) раньше
    // проходил truthy-проверку и падал в pg 22P02 «invalid input syntax for
    // type uuid» → 500 в Sentry (AUTEXA-BACKEND-2..7, 04.07). Не-UUID теперь
    // трактуем как «склад не указан» → мягкий фолбэк на основной склад.
    const isUuid =
      typeof warehouseId === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(warehouseId.trim());
    warehouseId = isUuid ? warehouseId!.trim() : null;
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
      // A LIVE folder with this path already exists → return it (idempotent).
      const { rows: existing } = await client.query(
        `SELECT id, path, COALESCE(sort_order, 0) as sort_order
           FROM warehouse_categories
          WHERE tenant_id = $1
            AND path = $2
            AND deleted_at IS NULL
            AND (warehouse_id = $3 OR ($3 IS NULL AND warehouse_id IS NULL))
          LIMIT 1`,
        [tenantID, path, resolvedWarehouseId],
      );
      if (existing.length > 0) {
        await client.query('COMMIT');
        return existing[0];
      }
      // A soft-deleted folder with this path exists → REVIVE it instead of
      // inserting a duplicate. This makes "re-create a trashed folder by name"
      // behave as a restore (keeps its id + sort_order) and avoids the unique
      // index (which after migration 105 covers live rows only).
      const { rows: revived } = await client.query(
        `UPDATE warehouse_categories SET deleted_at = NULL
          WHERE id = (
            SELECT id FROM warehouse_categories
             WHERE tenant_id = $1
               AND path = $2
               AND deleted_at IS NOT NULL
               AND (warehouse_id = $3 OR ($3 IS NULL AND warehouse_id IS NULL))
             LIMIT 1
          )
         RETURNING id, path, COALESCE(sort_order, 0) as sort_order`,
        [tenantID, path, resolvedWarehouseId],
      );
      if (revived.length > 0) {
        await client.query('COMMIT');
        return revived[0];
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

  /**
   * Soft-delete a folder — EMPTY or FULL — reversibly (#60).
   *
   * The category row (and every subfolder row) is stamped with `deleted_at`
   * instead of being physically removed, so a folder delete is never a
   * hard-delete and can be undone. Product handling depends on the caller's
   * intent, and NOTHING is ever hard-deleted here:
   *
   *   • deleteContents=true → cascade soft-delete every live product in the
   *     folder/subfolders to the Корзина. Folder + products go to trash TOGETHER
   *     (same transaction timestamp). Reversible: restoring the products from
   *     the trash brings the folder back too (the picker derives folders from
   *     each product's `category` path), and re-creating the folder by name
   *     revives its row (see createCategory). No product is lost.
   *   • moveProductsTo provided → move the live products to that folder (or to
   *     root when empty), then soft-delete the now-empty folder row.
   *   • neither → move the live products to root, then soft-delete the folder row.
   *
   * Empty folders simply have their row soft-deleted (nothing to cascade).
   */
  async removeCategory(id: string, tenantID: string, moveProductsTo?: string, deleteContents?: boolean) {
    // Find the path of the (live) category being deleted. An already-trashed
    // folder is a no-op — keeps the endpoint idempotent.
    // Resolve the folder's warehouse_id too (fix #2): a single folder id maps to
    // exactly one (path, warehouse_id), and every product move / soft-delete below
    // must stay scoped to THAT warehouse so a same-named folder in Б/У / брак is
    // never touched.
    const { rows: catRows } = await this.pool.query(
      'SELECT path, warehouse_id FROM warehouse_categories WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL',
      [id, tenantID],
    );
    if (catRows.length === 0) return { message: 'Не найдено' };
    const deletedPath = catRows[0].path;
    const deletedWarehouseId = (catRows[0].warehouse_id as string | null) ?? null;
    // Subtree LIKE pattern, metacharacters escaped (fix #6). The folder itself is
    // matched by exact equality (category=$2); only descendants use LIKE.
    const subtreeLike = WarehouseService.escapeLike(deletedPath) + '/%';

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      if (deleteContents) {
        // Soft-delete this folder + subfolders + all their live products to the
        // Корзина, in ONE reusable step (shared with softDeleteCategories so the
        // cascade SQL lives in exactly one place). Return early — the shared
        // helper already soft-deletes the folder rows, so the trailing
        // folder-soft-delete below must not run twice.
        await this.softDeleteFolderCascade(client, tenantID, deletedPath, deletedWarehouseId);
        await client.query('COMMIT');
        return { message: 'Папка и товары удалены' };
      } else if (moveProductsTo !== undefined) {
        // Move to specific target folder (or root if empty string)
        const target = moveProductsTo || null;
        await client.query(
          `UPDATE products SET category=$3
           WHERE tenant_id=$1 AND deleted_at IS NULL
             AND warehouse_id IS NOT DISTINCT FROM $5
             AND (category=$2 OR category LIKE $4 ESCAPE '\\')`,
          [tenantID, deletedPath, target, subtreeLike, deletedWarehouseId],
        );
      } else {
        // Default: clear category (move to root)
        await client.query(
          `UPDATE products SET category=NULL
           WHERE tenant_id=$1 AND deleted_at IS NULL
             AND warehouse_id IS NOT DISTINCT FROM $4
             AND (category=$2 OR category LIKE $3 ESCAPE '\\')`,
          [tenantID, deletedPath, subtreeLike, deletedWarehouseId],
        );
      }

      // Soft-delete the folder and all subfolders (reversible — never a hard
      // DELETE). Products were moved (not deleted) in the branches above, so
      // only the folder rows go to trash here.
      await this.softDeleteFolderRows(client, tenantID, deletedPath, deletedWarehouseId);

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    return { message: 'Папка удалена' };
  }

  /**
   * Soft-delete just the folder row + every subfolder row for `path` (reversible,
   * never a hard DELETE). Only touches LIVE rows so a re-run stays a no-op. Runs
   * on the caller-provided transaction client. Single source of the folder
   * soft-delete SQL.
   *
   * Scoped by `warehouseId` (fix #2): after migration 032 the same path (e.g.
   * «Тормоза») can live in main + Б/У + брак independently, so a delete must only
   * touch rows in the SAME warehouse as the resolved folder. `IS NOT DISTINCT
   * FROM` matches a real warehouse id exactly AND groups the legacy NULL bucket
   * (folders that pre-date the per-warehouse split) with NULL-warehouse products.
   */
  private async softDeleteFolderRows(
    client: PoolClient,
    tenantID: string,
    path: string,
    warehouseId: string | null,
  ): Promise<void> {
    await client.query(
      `UPDATE warehouse_categories SET deleted_at = NOW()
       WHERE tenant_id=$1 AND deleted_at IS NULL
         AND warehouse_id IS NOT DISTINCT FROM $4
         AND (path=$2 OR path LIKE $3 ESCAPE '\\')`,
      [tenantID, path, WarehouseService.escapeLike(path) + '/%', warehouseId],
    );
  }

  /**
   * FULL folder cascade: soft-delete every LIVE product under `path` (folder +
   * subfolders) to the Корзина, then soft-delete the folder rows themselves.
   * Runs on the caller-provided transaction client. This is the single source of
   * the "delete folder with contents" SQL — reused by removeCategory(deleteContents)
   * and by softDeleteCategories (bulk-delete). Returns the number of products moved.
   *
   * Scoped by `warehouseId` (fix #2) so deleting a folder chosen in ONE warehouse
   * can't cascade into same-named folders/products in the others.
   */
  private async softDeleteFolderCascade(
    client: PoolClient,
    tenantID: string,
    path: string,
    warehouseId: string | null,
  ): Promise<number> {
    const res = await client.query(
      `UPDATE products SET deleted_at = NOW()
       WHERE tenant_id=$1
         AND deleted_at IS NULL
         AND warehouse_id IS NOT DISTINCT FROM $4
         AND (category=$2 OR category LIKE $3 ESCAPE '\\')`,
      [tenantID, path, WarehouseService.escapeLike(path) + '/%', warehouseId],
    );
    await this.softDeleteFolderRows(client, tenantID, path, warehouseId);
    return res.rowCount ?? 0;
  }

  /**
   * Bulk soft-delete of folders BY ID (used by POST /products/bulk-delete).
   * Resolves the given live folder ids → paths (tenant-scoped), then runs the
   * shared folder cascade for each path on the caller's transaction client — so
   * this participates in the SAME transaction as the product bulk-delete and
   * never duplicates the cascade SQL.
   *
   * Returns { deletedProducts, deletedCategories }:
   *   • deletedProducts   = live products soft-deleted across all folder cascades.
   *   • deletedCategories = number of resolved top-level folder ids acted upon
   *     (each id fans out to its own subtree; subfolder rows are counted inside
   *     the cascade but not returned separately).
   * Idempotent: already-trashed / unknown ids resolve to nothing → no-op.
   */
  async softDeleteCategories(
    ids: string[],
    tenantID: string,
    client: PoolClient,
  ): Promise<{ deletedProducts: number; deletedCategories: number }> {
    if (!ids || ids.length === 0) return { deletedProducts: 0, deletedCategories: 0 };
    // Keep each folder's warehouse_id (fix #2) so the cascade below stays scoped
    // to the warehouse the folder actually lives in — never the same-named folder
    // in a sibling warehouse (Б/У / брак).
    const { rows } = await client.query(
      `SELECT path, warehouse_id FROM warehouse_categories
        WHERE tenant_id=$1 AND deleted_at IS NULL AND id = ANY($2::uuid[])`,
      [tenantID, ids],
    );
    let deletedProducts = 0;
    for (const row of rows) {
      deletedProducts += await this.softDeleteFolderCascade(
        client,
        tenantID,
        row.path as string,
        (row.warehouse_id as string | null) ?? null,
      );
    }
    return { deletedProducts, deletedCategories: rows.length };
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
    // Only a live folder can be renamed (trashed rows now exist after #60's
    // soft-delete and must not be reachable through rename).
    // The folder's warehouse_id is resolved too: a single folder id maps to
    // exactly one (path, warehouse_id), and every subtree UPDATE below must stay
    // scoped to THAT warehouse (same-named paths in Б/У / брак are untouched).
    const { rows: catRows } = await this.pool.query(
      'SELECT path, warehouse_id FROM warehouse_categories WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL',
      [id, tenantID],
    );
    if (catRows.length === 0) throw new BadRequestException({ message: 'Категория не найдена' });
    const oldPath = catRows[0].path;
    const warehouseId = (catRows[0].warehouse_id as string | null) ?? null;

    newPath = WarehouseService.normalizeFolderPath(newPath);
    if (!newPath) throw new BadRequestException({ message: 'Название папки не может быть пустым' });
    // The UI also uses rename as «перенос папки» (newPath = 'Цель/Имя'), so a
    // cycle must be rejected: moving a folder into its own subtree would make
    // the substring() re-prefix below rewrite paths into an infinite nesting.
    if (newPath === oldPath) return { message: 'OK' };
    if (newPath.startsWith(oldPath + '/')) {
      throw new BadRequestException({ message: 'Нельзя переместить папку внутрь неё самой' });
    }
    const { rows: clashRows } = await this.pool.query(
      `SELECT id FROM warehouse_categories
        WHERE tenant_id=$1 AND path=$2 AND deleted_at IS NULL
          AND warehouse_id IS NOT DISTINCT FROM $3
        LIMIT 1`,
      [tenantID, newPath, warehouseId],
    );
    if (clashRows.length > 0) {
      throw new BadRequestException({ message: 'Папка с таким именем уже существует в целевой папке' });
    }
    // Subtree LIKE pattern with metacharacters escaped (fix #6). $2 (oldPath) stays
    // UNescaped — the `substring(... from length($2)+1)` re-prefix math depends on
    // its true length; only the LIKE match uses the escaped pattern ($4).
    const subtreeLike = WarehouseService.escapeLike(oldPath) + '/%';

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Rename category itself
      await client.query('UPDATE warehouse_categories SET path=$3 WHERE id=$1 AND tenant_id=$2', [
        id,
        tenantID,
        newPath,
      ]);

      // Rename all subcategories (scoped to the folder's warehouse)
      await client.query(
        `UPDATE warehouse_categories SET path = $3 || substring(path from length($2) + 1)
         WHERE tenant_id=$1 AND warehouse_id IS NOT DISTINCT FROM $5 AND path LIKE $4 ESCAPE '\\'`,
        [tenantID, oldPath, newPath, subtreeLike, warehouseId],
      );

      // Update products category references (scoped to the folder's warehouse)
      await client.query(
        `UPDATE products SET category=$3
         WHERE tenant_id=$1 AND warehouse_id IS NOT DISTINCT FROM $4 AND category=$2`,
        [tenantID, oldPath, newPath, warehouseId],
      );
      await client.query(
        `UPDATE products SET category = $3 || substring(category from length($2) + 1)
         WHERE tenant_id=$1 AND warehouse_id IS NOT DISTINCT FROM $5 AND category LIKE $4 ESCAPE '\\'`,
        [tenantID, oldPath, newPath, subtreeLike, warehouseId],
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
