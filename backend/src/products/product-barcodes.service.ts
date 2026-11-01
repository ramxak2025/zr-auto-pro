import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomInt } from 'crypto';
import { isUUID } from 'class-validator';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';
import { JwtPayload } from '../common/decorators/current-user.decorator';
import { actorPointId, warehousePointFilterSql } from '../common/point-scope';
import { ProductsService } from './products.service';

@Injectable()
export class ProductBarcodesService {
  private readonly logger = new Logger('ProductBarcodesService');

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly products: ProductsService,
  ) {}

  async generate(tenantID: string, productIds: unknown, actor: JwtPayload) {
    if (
      !Array.isArray(productIds) ||
      !productIds.length ||
      productIds.length > 200 ||
      productIds.some((id) => typeof id !== 'string' || !isUUID(id))
    ) {
      throw new BadRequestException({ message: 'Укажите от 1 до 200 товаров' });
    }
    const ids = [...new Set(productIds as string[])];
    const db = await this.pool.connect();
    try {
      await db.query('BEGIN');
      const params: unknown[] = [tenantID, ids];
      const point = warehousePointFilterSql('p', actorPointId(actor), params);
      // Lock every target in UUID order before the namespace lock (same order as factory edits).
      const { rows } = await db.query<{ id: string; internal_barcode: string | null }>(
        `SELECT p.id,p.internal_barcode FROM products p
          WHERE p.tenant_id=$1 AND p.id=ANY($2::uuid[]) AND p.deleted_at IS NULL ${point}
          ORDER BY p.id FOR UPDATE OF p`,
        params,
      );
      if (rows.length !== ids.length) throw new NotFoundException({ message: 'Товар не найден' });
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended('internal-barcodes:'||$1::uuid::text,0))", [
        tenantID,
      ]);
      const codes = new Map<string, string>();
      for (const row of rows) {
        if (row.internal_barcode) {
          codes.set(row.id, row.internal_barcode);
          continue;
        }
        let allocated: string | undefined;
        // Same product may have a durable reservation even after an interrupted/retried caller.
        const existing = await db.query<{ code: string }>(
          'SELECT code FROM product_internal_barcode_allocations WHERE tenant_id=$1 AND product_id=$2',
          [tenantID, row.id],
        );
        allocated = existing.rows[0]?.code;
        for (let attempt = 0; !allocated && attempt < 32; attempt++) {
          const code = `AX${randomInt(0, 100000000).toString().padStart(8, '0')}`;
          // Includes soft-deleted products and every warehouse in this tenant.
          const result = await db.query<{ code: string }>(
            `INSERT INTO product_internal_barcode_allocations(tenant_id,code,product_id,created_by)
             SELECT $1,$2,$3,$4 WHERE NOT EXISTS(SELECT 1 FROM products WHERE tenant_id=$1 AND barcode=$2)
             ON CONFLICT DO NOTHING RETURNING code`,
            [tenantID, code, row.id, actor.userID],
          );
          allocated = result.rows[0]?.code;
        }
        if (!allocated)
          throw new ConflictException({
            code: 'BARCODE_ALLOCATION_RETRY',
            message: 'Не удалось назначить штрихкод. Повторите попытку',
          });
        await db.query("SELECT set_config('app.internal_barcode_assignment','true',true)");
        await db.query(
          'UPDATE products SET internal_barcode=$1 WHERE id=$2 AND tenant_id=$3 AND internal_barcode IS NULL',
          [allocated, row.id, tenantID],
        );
        codes.set(row.id, allocated);
      }
      await db.query('COMMIT');
      return { products: ids.map((id) => ({ id, internalBarcode: codes.get(id) as string })) };
    } catch (error) {
      try {
        await db.query('ROLLBACK');
      } catch (rollbackError) {
        this.logger.warn(`Barcode rollback failed: ${String(rollbackError)}`);
      }
      throw error;
    } finally {
      db.release();
    }
  }

  async lookup(
    tenantID: string,
    query: { barcode?: unknown; warehouseId?: unknown; page?: unknown; limit?: unknown },
    actor: JwtPayload,
  ) {
    if (typeof query.barcode !== 'string' || !query.barcode.trim() || query.barcode.length > 256)
      throw new BadRequestException({ message: 'Укажите штрихкод не длиннее 256 символов' });
    if (query.warehouseId !== undefined && (typeof query.warehouseId !== 'string' || !isUUID(query.warehouseId)))
      throw new BadRequestException({ message: 'Склад не найден' });
    const page = this.pageNumber(query.page, 1, 1000000);
    const limit = this.pageNumber(query.limit, 50, 200);
    const params: unknown[] = [tenantID, query.barcode.trim()];
    let where = 'p.tenant_id=$1 AND p.deleted_at IS NULL AND (p.internal_barcode=$2 OR p.barcode=$2)';
    where += warehousePointFilterSql('p', actorPointId(actor), params);
    if (query.warehouseId) {
      params.push(query.warehouseId);
      where += ` AND p.warehouse_id=$${params.length}`;
    }
    params.push(limit, (page - 1) * limit);
    const { rows } = await this.pool.query<{ total: number; matches: Record<string, unknown>[] }>(
      `WITH matched AS MATERIALIZED (
         SELECT p.*,s.name AS supplier_name,sc.code AS storage_cell_code,sc.name AS storage_cell_name
           FROM products p LEFT JOIN suppliers s ON s.id=p.supplier_id AND s.tenant_id=p.tenant_id
           LEFT JOIN storage_cells sc ON sc.id=p.storage_cell_id AND sc.tenant_id=p.tenant_id
          WHERE ${where}
       ), paged AS (SELECT * FROM matched ORDER BY name,id LIMIT $${params.length - 1} OFFSET $${params.length})
       SELECT (SELECT count(*) FROM matched)::int AS total,
              COALESCE((SELECT jsonb_agg(to_jsonb(paged)) FROM paged),'[]'::jsonb) AS matches`,
      params,
    );
    const { total, matches } = rows[0];
    return {
      status: total === 0 ? ('not_found' as const) : total === 1 ? ('found' as const) : ('ambiguous' as const),
      matches: matches.map((row) => this.products.projectProductForActor(row, actor)),
      total,
      page,
      limit,
    };
  }

  private pageNumber(value: unknown, fallback: number, max: number): number {
    if (value === undefined || value === '') return fallback;
    if (typeof value !== 'string' && typeof value !== 'number')
      throw new BadRequestException({ message: 'Проверьте параметры страницы' });
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max)
      throw new BadRequestException({ message: 'Проверьте параметры страницы' });
    return parsed;
  }
}
