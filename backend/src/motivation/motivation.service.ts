import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';
import { SetPromoDto } from './dto/set-promo.dto';

/**
 * «Мотивация сотрудников» v1 — акционные товары.
 *
 * Owns the READ + CONFIG side of the motivation programme:
 *   • promo products (tenant-scoped flag + percent per product) — list / upsert /
 *     clear, owner-class gated in the controller;
 *   • accruals ledger — read-only listing for transparency.
 *
 * The accrual WRITE happens on the check payment path (ChecksService) — kept there
 * so the bonus is written in the SAME transaction as the sale. Salary reads the
 * accruals directly (raw SQL in SalaryService), mirroring how it already sums
 * premiums / penalties. PG_POOL is provided globally by DatabaseModule.
 */
@Injectable()
export class MotivationService {
  constructor(@Inject(PG_POOL) private pool: Pool) {}

  // ── Promo products ────────────────────────────────────────────────────────

  /** All promo products for the tenant, joined with the current warehouse price. */
  async listPromos(tenantID: string) {
    const { rows } = await this.pool.query(
      `SELECT mp.*, p.name AS product_name, p.sell_price, p.cost_price, p.photo
         FROM motivation_promo_products mp
         JOIN products p ON p.id = mp.product_id AND p.tenant_id = mp.tenant_id
        WHERE mp.tenant_id = $1
        ORDER BY mp.active DESC, p.name ASC`,
      [tenantID],
    );
    return rows.map((r) => this.mapPromo(r));
  }

  /**
   * Upsert a product's promo config (keyed on tenant+product). Verifies the
   * product belongs to the caller's tenant first, so a known foreign UUID can
   * never seed a promo against another tenant's product.
   */
  async setPromo(tenantID: string, dto: SetPromoDto) {
    const { rows: prod } = await this.pool.query('SELECT 1 FROM products WHERE id = $1 AND tenant_id = $2', [
      dto.productId,
      tenantID,
    ]);
    if (prod.length === 0) {
      throw new BadRequestException({ message: 'Товар не найден' });
    }

    await this.pool.query(
      `INSERT INTO motivation_promo_products (tenant_id, product_id, percent, active, starts_at, ends_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (tenant_id, product_id) DO UPDATE
         SET percent   = EXCLUDED.percent,
             active     = EXCLUDED.active,
             starts_at  = EXCLUDED.starts_at,
             ends_at    = EXCLUDED.ends_at,
             updated_at = now()`,
      [tenantID, dto.productId, dto.percent, dto.active ?? true, dto.startsAt ?? null, dto.endsAt ?? null],
    );

    const { rows } = await this.pool.query(
      `SELECT mp.*, p.name AS product_name, p.sell_price, p.cost_price, p.photo
         FROM motivation_promo_products mp
         JOIN products p ON p.id = mp.product_id AND p.tenant_id = mp.tenant_id
        WHERE mp.tenant_id = $1 AND mp.product_id = $2`,
      [tenantID, dto.productId],
    );
    return this.mapPromo(rows[0]);
  }

  /** Remove a product from the promo programme. Idempotent (no-op if absent). */
  async clearPromo(tenantID: string, productId: string) {
    await this.pool.query('DELETE FROM motivation_promo_products WHERE tenant_id = $1 AND product_id = $2', [
      tenantID,
      productId,
    ]);
    return { message: 'Удалено' };
  }

  // ── Accruals ──────────────────────────────────────────────────────────────

  /**
   * Accruals for the tenant, newest-first. Optional `userId` (one employee) and
   * `dateFrom` / `dateTo` (inclusive, on accrued_at) filters. The controller
   * forces `userId` to self for non-privileged callers.
   */
  async listAccruals(tenantID: string, query: { userId?: string; dateFrom?: string; dateTo?: string }) {
    const conds: string[] = ['ma.tenant_id = $1'];
    const params: unknown[] = [tenantID];
    let idx = 2;
    if (query.userId) {
      conds.push(`ma.employee_id = $${idx++}`);
      params.push(query.userId);
    }
    if (query.dateFrom) {
      conds.push(`ma.accrued_at >= $${idx++}`);
      params.push(query.dateFrom);
    }
    if (query.dateTo) {
      conds.push(`ma.accrued_at <= ($${idx++}::date + 1)::timestamptz`);
      params.push(query.dateTo);
    }
    const { rows } = await this.pool.query(
      `SELECT ma.*, u.full_name AS employee_name, p.name AS product_name, c.number AS check_number
         FROM motivation_accruals ma
         LEFT JOIN users u ON u.id = ma.employee_id
         LEFT JOIN products p ON p.id = ma.product_id
         LEFT JOIN checks c ON c.id = ma.check_id
        WHERE ${conds.join(' AND ')}
        ORDER BY ma.accrued_at DESC
        LIMIT 500`,
      params,
    );
    return rows.map((r) => this.mapAccrual(r));
  }

  // ── Mappers ───────────────────────────────────────────────────────────────

  private mapPromo(r: any) {
    const sellPrice = parseFloat(r.sell_price) || 0;
    const costPrice = parseFloat(r.cost_price) || 0;
    const percent = parseFloat(r.percent) || 0;
    const margin = sellPrice - costPrice;
    return {
      id: r.id,
      productId: r.product_id,
      productName: r.product_name,
      percent,
      active: !!r.active,
      startsAt: r.starts_at ?? null,
      endsAt: r.ends_at ?? null,
      sellPrice,
      costPrice,
      photo: r.photo ?? undefined,
      // Per-unit preview of the bonus the master earns selling one item now.
      estimatedBonusPerUnit: margin > 0 ? Math.round((margin * percent) / 100) : 0,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  private mapAccrual(r: any) {
    return {
      id: r.id,
      employeeId: r.employee_id ?? null,
      employeeName: r.employee_name ?? undefined,
      checkId: r.check_id,
      checkNumber: r.check_number ?? undefined,
      productId: r.product_id ?? null,
      productName: r.product_name ?? undefined,
      qty: parseFloat(r.qty) || 0,
      marginBase: parseFloat(r.margin_base) || 0,
      percent: parseFloat(r.percent) || 0,
      amount: parseFloat(r.amount) || 0,
      accruedAt: r.accrued_at,
    };
  }
}
