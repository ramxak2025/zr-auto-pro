import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../database.module';

export interface WarrantyClaimRow {
  id: string;
  tenantId: string;
  checkId: string;
  clientId: string | null;
  carId: string | null;
  kind: 'product' | 'service';
  productId: string | null;
  serviceId: string | null;
  itemName: string | null;
  warrantyDays: number;
  startedAt: string;
  expiresAt: string;
  usedAt: string | null;
  usedCheckId: string | null;
  createdAt: string;
}

@Injectable()
export class WarrantyService {
  constructor(@Inject(PG_POOL) private pool: Pool) {}

  private mapRow(row: any): WarrantyClaimRow {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      checkId: row.check_id,
      clientId: row.client_id,
      carId: row.car_id,
      kind: row.kind,
      productId: row.product_id,
      serviceId: row.service_id,
      itemName: row.item_name,
      warrantyDays:
        typeof row.warranty_days === 'number' ? row.warranty_days : parseInt(String(row.warranty_days), 10) || 0,
      startedAt: row.started_at,
      expiresAt: row.expires_at,
      usedAt: row.used_at,
      usedCheckId: row.used_check_id,
      createdAt: row.created_at,
    };
  }

  /**
   * Active = not expired (expires_at > now) AND not redeemed (used_at IS NULL).
   * Either clientId or carId (or both) must be supplied — without a filter
   * the endpoint returns nothing rather than the full tenant list.
   *
   * Returned shape augments the raw claim row with `name` (resolved through
   * product / service / item_name) and `daysLeft` so the cash screen does
   * not need any extra fetches when the master picks a car / client.
   */
  async getActive(
    tenantID: string,
    filters: { clientId?: string; carId?: string },
  ): Promise<Array<WarrantyClaimRow & { name: string; daysLeft: number }>> {
    if (!filters.clientId && !filters.carId) return [];

    const conds: string[] = ['wc.tenant_id = $1', 'wc.used_at IS NULL', 'wc.expires_at > now()'];
    const params: any[] = [tenantID];
    let idx = 2;

    if (filters.clientId) {
      conds.push(`wc.client_id = $${idx++}`);
      params.push(filters.clientId);
    }
    if (filters.carId) {
      conds.push(`wc.car_id = $${idx++}`);
      params.push(filters.carId);
    }

    const { rows } = await this.pool.query(
      `SELECT wc.*,
              p.name as product_name,
              s.name as service_name
         FROM warranty_claims wc
         LEFT JOIN products p ON p.id = wc.product_id
         LEFT JOIN services s ON s.id = wc.service_id
        WHERE ${conds.join(' AND ')}
        ORDER BY wc.expires_at ASC`,
      params,
    );

    const now = Date.now();
    return rows.map((r) => {
      const mapped = this.mapRow(r);
      const productName = r.product_name as string | null;
      const serviceName = r.service_name as string | null;
      const fallbackName = r.item_name as string | null;
      const name = (mapped.kind === 'product' ? productName : serviceName) || fallbackName || 'Без названия';
      const expires = new Date(mapped.expiresAt).getTime();
      const daysLeft = Math.max(0, Math.ceil((expires - now) / (24 * 60 * 60 * 1000)));
      return { ...mapped, name, daysLeft };
    });
  }

  /**
   * All warranty claims raised by a specific check. Used inline in
   * getCheckById to display "Под гарантией: …" next to a finished check.
   */
  async listForCheck(tenantID: string, checkId: string): Promise<WarrantyClaimRow[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM warranty_claims
        WHERE tenant_id = $1 AND check_id = $2
        ORDER BY created_at`,
      [tenantID, checkId],
    );
    return rows.map((r) => this.mapRow(r));
  }

  /**
   * Mark a warranty as redeemed against a newly-created check.
   * Two safety nets:
   *   1) the claim must belong to the caller's tenant;
   *   2) the redeem check must also belong to the tenant.
   * Re-redeeming an already-used claim throws — the FE prevents the call
   * but the server is the authority.
   */
  async redeem(tenantID: string, claimId: string, usedCheckId: string): Promise<WarrantyClaimRow> {
    if (!usedCheckId) {
      throw new BadRequestException({ message: 'Не указан чек, по которому используется гарантия' });
    }

    const { rows: checkRows } = await this.pool.query('SELECT 1 FROM checks WHERE id = $1 AND tenant_id = $2 LIMIT 1', [
      usedCheckId,
      tenantID,
    ]);
    if (checkRows.length === 0) {
      throw new BadRequestException({ message: 'Чек не найден' });
    }

    const { rows } = await this.pool.query(
      `UPDATE warranty_claims
          SET used_at = now(), used_check_id = $1
        WHERE id = $2 AND tenant_id = $3 AND used_at IS NULL
        RETURNING *`,
      [usedCheckId, claimId, tenantID],
    );
    if (rows.length === 0) {
      // Either does not exist or already used — distinguish for the FE.
      const { rows: existsRows } = await this.pool.query(
        'SELECT used_at FROM warranty_claims WHERE id=$1 AND tenant_id=$2',
        [claimId, tenantID],
      );
      if (existsRows.length === 0) {
        throw new NotFoundException({ message: 'Гарантия не найдена' });
      }
      throw new BadRequestException({ message: 'Гарантия уже использована' });
    }
    return this.mapRow(rows[0]);
  }

  /**
   * Insert warranty rows for the lines of a newly-created check.
   * Called from inside ChecksService.create — receives the open
   * transaction client so everything commits atomically.
   *
   * The product / service warranty_days values are looked up via JOIN
   * scoped to the tenant — no need to re-validate cross-tenant ids here,
   * the caller already did it for the underlying lines.
   */
  async createFromCheckLines(
    client: PoolClient,
    tenantID: string,
    checkId: string,
    checkDate: string,
    clientId: string | null,
    carId: string | null,
    lines: Array<{
      kind: 'product' | 'service';
      productId?: string | null;
      serviceId?: string | null;
      itemName?: string | null;
    }>,
  ): Promise<void> {
    if (lines.length === 0) return;

    // Pull warranty_days for all referenced products + services in one go.
    const productIds = Array.from(
      new Set(lines.filter((l) => l.kind === 'product' && l.productId).map((l) => l.productId!)),
    );
    const serviceIds = Array.from(
      new Set(lines.filter((l) => l.kind === 'service' && l.serviceId).map((l) => l.serviceId!)),
    );

    const productWarranty = new Map<string, number>();
    if (productIds.length > 0) {
      const { rows } = await client.query(
        `SELECT id, warranty_days FROM products
          WHERE id = ANY($1) AND tenant_id = $2 AND warranty_days IS NOT NULL AND warranty_days > 0`,
        [productIds, tenantID],
      );
      for (const r of rows) productWarranty.set(r.id, parseInt(r.warranty_days));
    }

    const serviceWarranty = new Map<string, number>();
    if (serviceIds.length > 0) {
      const { rows } = await client.query(
        `SELECT id, warranty_days FROM services
          WHERE id = ANY($1) AND tenant_id = $2 AND warranty_days IS NOT NULL AND warranty_days > 0`,
        [serviceIds, tenantID],
      );
      for (const r of rows) serviceWarranty.set(r.id, parseInt(r.warranty_days));
    }

    if (productWarranty.size === 0 && serviceWarranty.size === 0) return;

    for (const line of lines) {
      const warrantyDays =
        line.kind === 'product'
          ? line.productId
            ? productWarranty.get(line.productId)
            : undefined
          : line.serviceId
            ? serviceWarranty.get(line.serviceId)
            : undefined;

      if (!warrantyDays || warrantyDays <= 0) continue;

      await client.query(
        `INSERT INTO warranty_claims (
           tenant_id, check_id, client_id, car_id, kind,
           product_id, service_id, item_name, warranty_days,
           started_at, expires_at
         ) VALUES (
           $1, $2, $3, $4, $5,
           $6, $7, $8, $9,
           $10::timestamptz, ($10::timestamptz + ($9 || ' days')::interval)
         )`,
        [
          tenantID,
          checkId,
          clientId,
          carId,
          line.kind,
          line.kind === 'product' ? (line.productId ?? null) : null,
          line.kind === 'service' ? (line.serviceId ?? null) : null,
          line.itemName ?? null,
          warrantyDays,
          checkDate,
        ],
      );
    }
  }
}
