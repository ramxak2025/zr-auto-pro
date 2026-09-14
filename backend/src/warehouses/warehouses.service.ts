import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';
import { NO_TENANT_ID } from '../common/auth-cache';
import { PointScopeQueryable } from '../common/point-scope';

export type WarehouseKind = 'main' | 'defect' | 'used';

export interface WarehouseRow {
  id: string;
  tenantId: string;
  name: string;
  kind: WarehouseKind;
  sortOrder: number;
  /** Филиал склада (169); null у тенанта без филиалов. */
  pointId: string | null;
  /** Название филиала — только в `scope=all` (перемещение между филиалами). */
  pointName?: string | null;
}

/**
 * НАБОР СКЛАДОВ ФИЛИАЛА (169): у каждого живого филиала СВОИ три склада
 * (основной / брак / Б/У). `pointId` null — тенант без филиалов (прежние три
 * склада на тенант). Идемпотентно по ключу (tenant_id, point_id, kind)
 * NULLS NOT DISTINCT. Один и тот же SQL зовут: посев тенанта, самолечение
 * списка/резолва и PointsService при заведении филиала — чтобы форма набора
 * была ровно одна.
 */
export async function seedWarehousesForPoint(
  db: PointScopeQueryable,
  tenantID: string,
  pointId: string | null,
): Promise<void> {
  await db.query(
    `INSERT INTO warehouses (tenant_id, point_id, name, kind, sort_order) VALUES
       ($1, $2, 'Основной склад', 'main',   0),
       ($1, $2, 'Склад брака',    'defect', 1),
       ($1, $2, 'Склад Б/У',      'used',   2)
     ON CONFLICT (tenant_id, point_id, kind) DO NOTHING`,
    [tenantID, pointId],
  );
}

/**
 * Посеять наборы складов ВСЕМ живым филиалам тенанта, у которых их ещё нет
 * (заведение / разархивация филиала). Тот же SEED-BLOCK, что в миграции 169.
 */
export async function seedWarehousesForTenantPoints(db: PointScopeQueryable, tenantID: string): Promise<void> {
  await db.query(
    `INSERT INTO warehouses (tenant_id, point_id, name, kind, sort_order)
     SELECT tp.tenant_id, tp.id, d.name, d.kind, d.sort_order
       FROM tenant_points tp
       CROSS JOIN (VALUES ('Основной склад', 'main', 0),
                          ('Склад брака',    'defect', 1),
                          ('Склад Б/У',      'used', 2)) AS d(name, kind, sort_order)
      WHERE tp.tenant_id = $1 AND tp.is_active
        AND NOT EXISTS (SELECT 1 FROM warehouses w
                         WHERE w.tenant_id = tp.tenant_id AND w.point_id = tp.id AND w.kind = d.kind)
     ON CONFLICT (tenant_id, point_id, kind) DO NOTHING`,
    [tenantID],
  );
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
      pointId: row.point_id ?? null,
      pointName: row.point_name ?? null,
    };
  }

  /**
   * Филиал, чьи склады считаются «своими» для сессии без точки: у тенанта без
   * филиалов — null (склады с point_id IS NULL), у тенанта с филиалами —
   * основной сервис. Нужен ТОЛЬКО внутренним вызовам без актора; обычный
   * запрос всегда несёт филиал сессии (инвариант 163).
   */
  private async effectivePointId(tenantID: string, pointId: string | null): Promise<string | null> {
    if (pointId) return pointId;
    const { rows } = await this.pool.query(
      `SELECT id::text AS id FROM tenant_points WHERE tenant_id = $1 AND is_main AND is_active LIMIT 1`,
      [tenantID],
    );
    return rows.length > 0 ? (rows[0].id as string) : null;
  }

  /**
   * Склады филиала сессии (169) — всегда три (основной / брак / Б/У): набор
   * сеется при заведении тенанта/филиала и досеивается здесь лениво, если у
   * филиала вдруг не хватает вида. `scope = 'all'` — склады ВСЕЙ сети с
   * названием филиала: только для перемещения товара в другой филиал
   * (контроллер отдаёт его любому — список складов не секрет, а товар чужого
   * филиала по нему всё равно не прочитать: чтение режется точкой склада).
   */
  async listByTenant(
    tenantID: string,
    pointId: string | null = null,
    scope: 'point' | 'all' = 'point',
  ): Promise<WarehouseRow[]> {
    // A tenant-less caller (superadmin, tenant_id = nil-UUID sentinel) has no
    // warehouses and must NOT trigger the lazy seed below — inserting a
    // warehouse with the sentinel tenant_id FK-violates warehouses_tenant_id_fkey
    // (no such tenant) → 500 on GET /warehouses. Return empty, same spirit as
    // the NO_TENANT_ID handling in jwt.strategy.
    if (tenantID === NO_TENANT_ID) return [];

    if (scope === 'all') {
      const { rows } = await this.pool.query(
        `SELECT w.id, w.tenant_id, w.name, w.kind, w.sort_order, w.point_id, tp.name AS point_name
           FROM warehouses w
           LEFT JOIN tenant_points tp ON tp.id = w.point_id
          WHERE w.tenant_id = $1 AND (w.point_id IS NULL OR tp.is_active)
          ORDER BY COALESCE(tp.is_main, true) DESC, tp.sort_order NULLS FIRST, lower(COALESCE(tp.name, '')),
                   w.sort_order, w.name`,
        [tenantID],
      );
      return rows.map((r) => this.mapRow(r));
    }

    const effectivePoint = await this.effectivePointId(tenantID, pointId);
    const { rows } = await this.pool.query(
      `SELECT id, tenant_id, name, kind, sort_order, point_id
         FROM warehouses
        WHERE tenant_id = $1 AND point_id IS NOT DISTINCT FROM $2::uuid
        ORDER BY sort_order, name`,
      [tenantID, effectivePoint],
    );

    // Самолечение: у филиала (или у тенанта без филиалов) не хватает вида —
    // досеять НЕДОСТАЮЩИЕ, тем же ключом (tenant_id, point_id, kind).
    const kinds = new Set(rows.map((r) => r.kind));
    if (!['main', 'defect', 'used'].every((k) => kinds.has(k))) {
      await seedWarehousesForPoint(this.pool, tenantID, effectivePoint);
      return this.listByTenant(tenantID, effectivePoint, scope);
    }

    return rows.map((r) => this.mapRow(r));
  }

  /**
   * Склад данного вида В ФИЛИАЛЕ (169). Раньше был «вид на тенант» — с
   * набором на каждый филиал такой запрос отдавал бы склад случайного
   * филиала: перемещение в брак уезжало бы в чужой автосервис. Без точки —
   * см. effectivePointId. Самолечение — досев набора филиала.
   */
  async resolveByKind(tenantID: string, kind: WarehouseKind, pointId: string | null = null): Promise<WarehouseRow> {
    const effectivePoint = await this.effectivePointId(tenantID, pointId);
    const select = `SELECT id, tenant_id, name, kind, sort_order, point_id FROM warehouses
        WHERE tenant_id = $1 AND kind = $2 AND point_id IS NOT DISTINCT FROM $3::uuid LIMIT 1`;
    const { rows } = await this.pool.query(select, [tenantID, kind, effectivePoint]);
    if (rows.length > 0) return this.mapRow(rows[0]);
    // Tenant-less caller (nil-UUID sentinel) can't own a warehouse and the
    // seed would FK-violate — surface a clean 404 instead of a 500.
    if (tenantID === NO_TENANT_ID) {
      throw new NotFoundException({ message: `Склад "${kind}" не найден` });
    }
    await seedWarehousesForPoint(this.pool, tenantID, effectivePoint);
    const { rows: retry } = await this.pool.query(select, [tenantID, kind, effectivePoint]);
    if (retry.length === 0) {
      throw new NotFoundException({ message: `Склад "${kind}" не найден` });
    }
    return this.mapRow(retry[0]);
  }

  /**
   * Rename a warehouse. The kind is immutable — the FE never sends it on
   * update — so callers can only adjust the display name (and sortOrder).
   */
  async update(
    tenantID: string,
    id: string,
    dto: { name?: string; sortOrder?: number },
    pointId: string | null = null,
  ): Promise<WarehouseRow> {
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
        `SELECT id, tenant_id, name, kind, sort_order, point_id FROM warehouses
          WHERE id = $1 AND tenant_id = $2 AND ($3::uuid IS NULL OR point_id = $3::uuid) LIMIT 1`,
        [id, tenantID, pointId],
      );
      if (rows.length === 0) throw new NotFoundException({ message: 'Склад не найден' });
      return this.mapRow(rows[0]);
    }

    // 169 — переименовать можно только склад СВОЕГО филиала.
    vals.push(id, tenantID, pointId);
    const { rows } = await this.pool.query(
      `UPDATE warehouses SET ${sets.join(', ')}
         WHERE id = $${idx++} AND tenant_id = $${idx++} AND ($${idx}::uuid IS NULL OR point_id = $${idx}::uuid)
         RETURNING id, tenant_id, name, kind, sort_order, point_id`,
      vals,
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Склад не найден' });
    return this.mapRow(rows[0]);
  }

  /**
   * Cross-tenant guard helper used by other modules that accept a
   * client-supplied warehouseId on writes (stock movements, product create
   * / update). Throws BadRequest if the id does not belong to the caller.
   *
   * 169 — по умолчанию склад обязан принадлежать ФИЛИАЛУ сессии (`pointId`);
   * `anyPoint` снимает это требование — единственный законный случай:
   * целевой склад перемещения товара В ДРУГОЙ ФИЛИАЛ (держатель
   * user_management, см. StockMovementsService.applyTransfer).
   */
  async assertInTenant(
    tenantID: string,
    warehouseId: string,
    pointId: string | null = null,
    anyPoint = false,
  ): Promise<WarehouseRow> {
    const { rows } = await this.pool.query(
      `SELECT id, tenant_id, name, kind, sort_order, point_id FROM warehouses
        WHERE id = $1 AND tenant_id = $2 AND ($3::uuid IS NULL OR point_id = $3::uuid) LIMIT 1`,
      [warehouseId, tenantID, anyPoint ? null : pointId],
    );
    if (rows.length === 0) {
      throw new BadRequestException({ message: 'Склад не найден' });
    }
    return this.mapRow(rows[0]);
  }
}
