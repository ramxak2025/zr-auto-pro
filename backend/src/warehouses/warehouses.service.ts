import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';

export type WarehouseKind = 'main' | 'defect' | 'used';

export interface WarehouseRow {
  id: string;
  tenantId: string;
  name: string;
  kind: WarehouseKind;
  sortOrder: number;
}

@Injectable()
export class WarehousesService {
  constructor(@Inject(PG_POOL) private pool: Pool) {}

  private mapRow(row: any): WarehouseRow {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      name: row.name,
      kind: row.kind as WarehouseKind,
      sortOrder: row.sort_order ?? 0,
    };
  }

  /**
   * Return all warehouses for the tenant. Always three (main / defect / used)
   * because they are seeded at tenant creation and on the 028 migration for
   * every pre-existing tenant. Order is `sort_order` then name so callers
   * can present them deterministically.
   */
  async listByTenant(tenantID: string): Promise<WarehouseRow[]> {
    const { rows } = await this.pool.query(
      `SELECT id, tenant_id, name, kind, sort_order
         FROM warehouses
        WHERE tenant_id = $1
        ORDER BY sort_order, name`,
      [tenantID],
    );

    // If a tenant created before migration 028 somehow missed a kind, seed
    // the missing ones lazily — keeps the FE invariant of "always three".
    const kinds = new Set(rows.map((r) => r.kind));
    const defaults: Array<{ kind: WarehouseKind; name: string; sort: number }> = [
      { kind: 'main', name: 'Основной склад', sort: 0 },
      { kind: 'defect', name: 'Склад брака', sort: 1 },
      { kind: 'used', name: 'Склад Б/У', sort: 2 },
    ];
    const missing = defaults.filter((d) => !kinds.has(d.kind));
    if (missing.length > 0) {
      for (const d of missing) {
        await this.pool.query(
          `INSERT INTO warehouses (tenant_id, name, kind, sort_order)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (tenant_id, kind) DO NOTHING`,
          [tenantID, d.name, d.kind, d.sort],
        );
      }
      return this.listByTenant(tenantID);
    }

    return rows.map((r) => this.mapRow(r));
  }

  /**
   * Resolve the warehouse of a given kind for the tenant. Used by services
   * that need to anchor a movement (or product backfill) to a specific
   * well-known warehouse — defect-return endpoints rely on this to never
   * accidentally target main or used.
   */
  async resolveByKind(tenantID: string, kind: WarehouseKind): Promise<WarehouseRow> {
    const { rows } = await this.pool.query(
      `SELECT id, tenant_id, name, kind, sort_order FROM warehouses
        WHERE tenant_id = $1 AND kind = $2 LIMIT 1`,
      [tenantID, kind],
    );
    if (rows.length === 0) {
      // Self-heal — seed the missing kind, then retry.
      const seedName = kind === 'main' ? 'Основной склад' : kind === 'defect' ? 'Склад брака' : 'Склад Б/У';
      const sort = kind === 'main' ? 0 : kind === 'defect' ? 1 : 2;
      await this.pool.query(
        `INSERT INTO warehouses (tenant_id, name, kind, sort_order)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (tenant_id, kind) DO NOTHING`,
        [tenantID, seedName, kind, sort],
      );
      const { rows: retry } = await this.pool.query(
        `SELECT id, tenant_id, name, kind, sort_order FROM warehouses
          WHERE tenant_id = $1 AND kind = $2 LIMIT 1`,
        [tenantID, kind],
      );
      if (retry.length === 0) {
        throw new NotFoundException({ message: `Склад "${kind}" не найден` });
      }
      return this.mapRow(retry[0]);
    }
    return this.mapRow(rows[0]);
  }

  /**
   * Rename a warehouse. The kind is immutable — the FE never sends it on
   * update — so callers can only adjust the display name (and sortOrder).
   */
  async update(tenantID: string, id: string, dto: { name?: string; sortOrder?: number }): Promise<WarehouseRow> {
    const sets: string[] = [];
    const vals: any[] = [];
    let idx = 1;

    if (dto.name !== undefined) {
      const trimmed = String(dto.name).trim();
      if (!trimmed) throw new BadRequestException({ message: 'Название не может быть пустым' });
      sets.push(`name = $${idx++}`);
      vals.push(trimmed);
    }
    if (dto.sortOrder !== undefined) {
      sets.push(`sort_order = $${idx++}`);
      vals.push(dto.sortOrder);
    }

    if (sets.length === 0) {
      const { rows } = await this.pool.query(
        `SELECT id, tenant_id, name, kind, sort_order FROM warehouses
          WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        [id, tenantID],
      );
      if (rows.length === 0) throw new NotFoundException({ message: 'Склад не найден' });
      return this.mapRow(rows[0]);
    }

    vals.push(id, tenantID);
    const { rows } = await this.pool.query(
      `UPDATE warehouses SET ${sets.join(', ')}
         WHERE id = $${idx++} AND tenant_id = $${idx}
         RETURNING id, tenant_id, name, kind, sort_order`,
      vals,
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Склад не найден' });
    return this.mapRow(rows[0]);
  }

  /**
   * Cross-tenant guard helper used by other modules that accept a
   * client-supplied warehouseId on writes (stock movements, product create
   * / update). Throws BadRequest if the id does not belong to the caller.
   */
  async assertInTenant(tenantID: string, warehouseId: string): Promise<WarehouseRow> {
    const { rows } = await this.pool.query(
      `SELECT id, tenant_id, name, kind, sort_order FROM warehouses
        WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [warehouseId, tenantID],
    );
    if (rows.length === 0) {
      throw new BadRequestException({ message: 'Склад не найден' });
    }
    return this.mapRow(rows[0]);
  }
}
