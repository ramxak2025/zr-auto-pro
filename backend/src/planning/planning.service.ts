import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';
import { invalidateReportsForTenant } from '../common/reports-cache';

// Real config ids are uuids. Guard mutating endpoints so a garbage / synthetic id
// resolves to a clean 404 instead of a Postgres "invalid input syntax for type
// uuid" 500 on the `WHERE id=$1` cast (same convention as expenses/reports).
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// Allowed fixed-cost categories. Anything else normalises to 'other' so a
// manipulated DTO can't poison the column.
const FIXED_COST_CATEGORIES = new Set(['rent', 'utilities', 'marketing', 'other']);
// Allowed compensation types (mirror migration 133 + the accrual formula in
// reports.service.computeDashboardV2).
const COMPENSATION_TYPES = new Set(['fixed_monthly', 'pct_turnover', 'pct_profit']);

// Sanity ceiling (mirrors expenses.create): kills 1e308-style overflow abuse
// while staying an order of magnitude above any real автосервис monthly cost.
const AMOUNT_CEILING = 100_000_000;

/**
 * PlanningService — owner-configured «Планирование / Постоянные расходы» that
 * feeds the ACCRUAL net-profit on the owner dashboard (reports v2). Two configs:
 *   • fixed_costs           — planned recurring MONTHLY amounts (rent / utilities /
 *                             marketing / custom), amortised over calendar days.
 *   • employee_compensation — per-employee оклад (fixed_monthly) / % с оборота
 *                             (pct_turnover) / % с прибыли (pct_profit).
 *
 * WRITE side lives here; the READ side (accrual math) is inlined in
 * ReportsService.computeDashboardV2 so the dashboard needs no cross-module dep.
 * Every write invalidates the tenant's cached report aggregates so the smoothed
 * net profit reflects the config change immediately.
 *
 * Access is owner-only, enforced in the controller (@Roles owner-class +
 * @RequirePermission('financial_reports')). All queries are tenant-scoped and
 * parameterised.
 */
@Injectable()
export class PlanningService {
  constructor(@Inject(PG_POOL) private pool: Pool) {}

  // ── helpers ──────────────────────────────────────────────────────────────

  private cleanName(value: unknown): string {
    const s = typeof value === 'string' ? value.trim() : '';
    if (!s) throw new BadRequestException({ message: 'Название обязательно' });
    return s.slice(0, 200);
  }

  /** Parse a money/percent amount: finite, ≥ 0, ≤ ceiling; percents clamped 0..100. */
  private cleanAmount(value: unknown, isPercent: boolean): number {
    const n = parseFloat(String(value));
    if (!Number.isFinite(n) || n < 0) {
      throw new BadRequestException({ message: 'Сумма должна быть неотрицательным числом' });
    }
    if (isPercent) return Math.min(n, 100);
    if (n > AMOUNT_CEILING) throw new BadRequestException({ message: 'Сумма слишком велика' });
    return n;
  }

  private async assertUserInTenant(userID: string, tenantID: string): Promise<void> {
    if (!UUID_RE.test(userID ?? '')) throw new BadRequestException({ message: 'Сотрудник обязателен' });
    const { rows } = await this.pool.query('SELECT 1 FROM users WHERE id = $1 AND tenant_id = $2 LIMIT 1', [
      userID,
      tenantID,
    ]);
    if (rows.length === 0) throw new BadRequestException({ message: 'Сотрудник не найден' });
  }

  private mapFixedCost(r: any) {
    return {
      id: r.id,
      tenantId: r.tenant_id,
      name: r.name,
      category: r.category,
      monthlyAmount: parseFloat(r.monthly_amount) || 0,
      active: r.active !== false,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  private mapCompensation(r: any) {
    return {
      id: r.id,
      tenantId: r.tenant_id,
      userId: r.user_id,
      userName: r.user_name ?? undefined,
      userRole: r.user_role ?? undefined,
      type: r.type,
      amount: parseFloat(r.amount) || 0,
      active: r.active !== false,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  // ── Fixed costs ────────────────────────────────────────────────────────────

  async listFixedCosts(tenantID: string) {
    const { rows } = await this.pool.query(
      'SELECT * FROM fixed_costs WHERE tenant_id = $1 ORDER BY active DESC, name',
      [tenantID],
    );
    return rows.map((r) => this.mapFixedCost(r));
  }

  async createFixedCost(tenantID: string, dto: any) {
    const name = this.cleanName(dto?.name);
    const category = FIXED_COST_CATEGORIES.has(dto?.category) ? dto.category : 'other';
    const monthlyAmount = this.cleanAmount(dto?.monthlyAmount, false);
    const active = dto?.active === undefined ? true : !!dto.active;

    const { rows } = await this.pool.query(
      `INSERT INTO fixed_costs (tenant_id, name, category, monthly_amount, active)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [tenantID, name, category, monthlyAmount, active],
    );
    invalidateReportsForTenant(tenantID);
    return this.mapFixedCost(rows[0]);
  }

  async updateFixedCost(id: string, tenantID: string, dto: any) {
    if (!UUID_RE.test(id)) throw new NotFoundException({ message: 'Постоянный расход не найден' });
    const sets: string[] = [];
    const vals: any[] = [];
    let idx = 1;
    if (dto?.name !== undefined) {
      sets.push(`name = $${idx++}`);
      vals.push(this.cleanName(dto.name));
    }
    if (dto?.category !== undefined) {
      sets.push(`category = $${idx++}`);
      vals.push(FIXED_COST_CATEGORIES.has(dto.category) ? dto.category : 'other');
    }
    if (dto?.monthlyAmount !== undefined) {
      sets.push(`monthly_amount = $${idx++}`);
      vals.push(this.cleanAmount(dto.monthlyAmount, false));
    }
    if (dto?.active !== undefined) {
      sets.push(`active = $${idx++}`);
      vals.push(!!dto.active);
    }
    if (sets.length === 0) {
      const { rows } = await this.pool.query('SELECT * FROM fixed_costs WHERE id = $1 AND tenant_id = $2', [
        id,
        tenantID,
      ]);
      if (rows.length === 0) throw new NotFoundException({ message: 'Постоянный расход не найден' });
      return this.mapFixedCost(rows[0]);
    }
    sets.push(`updated_at = now()`);
    vals.push(id, tenantID);
    const { rows } = await this.pool.query(
      `UPDATE fixed_costs SET ${sets.join(', ')} WHERE id = $${idx++} AND tenant_id = $${idx} RETURNING *`,
      vals,
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Постоянный расход не найден' });
    invalidateReportsForTenant(tenantID);
    return this.mapFixedCost(rows[0]);
  }

  async removeFixedCost(id: string, tenantID: string) {
    if (!UUID_RE.test(id)) throw new NotFoundException({ message: 'Постоянный расход не найден' });
    const { rows } = await this.pool.query('DELETE FROM fixed_costs WHERE id = $1 AND tenant_id = $2 RETURNING id', [
      id,
      tenantID,
    ]);
    if (rows.length === 0) throw new NotFoundException({ message: 'Постоянный расход не найден' });
    invalidateReportsForTenant(tenantID);
    return { message: 'Удалено' };
  }

  // ── Employee compensation ───────────────────────────────────────────────────

  async listCompensation(tenantID: string) {
    const { rows } = await this.pool.query(
      `SELECT ec.*, u.full_name AS user_name, u.role AS user_role
         FROM employee_compensation ec
         JOIN users u ON u.id = ec.user_id AND u.tenant_id = ec.tenant_id
        WHERE ec.tenant_id = $1
        ORDER BY u.full_name`,
      [tenantID],
    );
    return rows.map((r) => this.mapCompensation(r));
  }

  /**
   * Upsert the single compensation config for one employee (UNIQUE tenant+user).
   * A second call for the same employee replaces the previous type/amount rather
   * than erroring, matching the «один конфиг на сотрудника» v1 model.
   */
  async upsertCompensation(tenantID: string, dto: any) {
    await this.assertUserInTenant(dto?.userId, tenantID);
    const type = COMPENSATION_TYPES.has(dto?.type) ? dto.type : 'fixed_monthly';
    const isPercent = type !== 'fixed_monthly';
    const amount = this.cleanAmount(dto?.amount, isPercent);
    const active = dto?.active === undefined ? true : !!dto.active;

    const { rows } = await this.pool.query(
      `INSERT INTO employee_compensation (tenant_id, user_id, type, amount, active)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT ON CONSTRAINT employee_compensation_tenant_user_uniq
       DO UPDATE SET type = EXCLUDED.type, amount = EXCLUDED.amount,
                     active = EXCLUDED.active, updated_at = now()
       RETURNING *`,
      [tenantID, dto.userId, type, amount, active],
    );
    invalidateReportsForTenant(tenantID);
    // Re-read with the user join for a consistent shape (name/role) on the way out.
    const { rows: joined } = await this.pool.query(
      `SELECT ec.*, u.full_name AS user_name, u.role AS user_role
         FROM employee_compensation ec
         JOIN users u ON u.id = ec.user_id AND u.tenant_id = ec.tenant_id
        WHERE ec.id = $1 AND ec.tenant_id = $2`,
      [rows[0].id, tenantID],
    );
    return this.mapCompensation(joined[0] ?? rows[0]);
  }

  async updateCompensation(id: string, tenantID: string, dto: any) {
    if (!UUID_RE.test(id)) throw new NotFoundException({ message: 'Мотивация не найдена' });
    // Resolve the current type so an amount-only update knows whether to clamp
    // as a percent.
    const { rows: current } = await this.pool.query(
      'SELECT type FROM employee_compensation WHERE id = $1 AND tenant_id = $2',
      [id, tenantID],
    );
    if (current.length === 0) throw new NotFoundException({ message: 'Мотивация не найдена' });
    const nextType = dto?.type !== undefined && COMPENSATION_TYPES.has(dto.type) ? dto.type : current[0].type;
    const isPercent = nextType !== 'fixed_monthly';

    const sets: string[] = [];
    const vals: any[] = [];
    let idx = 1;
    if (dto?.type !== undefined) {
      sets.push(`type = $${idx++}`);
      vals.push(nextType);
    }
    if (dto?.amount !== undefined) {
      sets.push(`amount = $${idx++}`);
      vals.push(this.cleanAmount(dto.amount, isPercent));
    }
    if (dto?.active !== undefined) {
      sets.push(`active = $${idx++}`);
      vals.push(!!dto.active);
    }
    if (sets.length === 0) {
      return this.updateCompensationReadBack(id, tenantID);
    }
    sets.push(`updated_at = now()`);
    vals.push(id, tenantID);
    const { rows } = await this.pool.query(
      `UPDATE employee_compensation SET ${sets.join(', ')} WHERE id = $${idx++} AND tenant_id = $${idx} RETURNING id`,
      vals,
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Мотивация не найдена' });
    invalidateReportsForTenant(tenantID);
    return this.updateCompensationReadBack(id, tenantID);
  }

  private async updateCompensationReadBack(id: string, tenantID: string) {
    const { rows } = await this.pool.query(
      `SELECT ec.*, u.full_name AS user_name, u.role AS user_role
         FROM employee_compensation ec
         JOIN users u ON u.id = ec.user_id AND u.tenant_id = ec.tenant_id
        WHERE ec.id = $1 AND ec.tenant_id = $2`,
      [id, tenantID],
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Мотивация не найдена' });
    return this.mapCompensation(rows[0]);
  }

  async removeCompensation(id: string, tenantID: string) {
    if (!UUID_RE.test(id)) throw new NotFoundException({ message: 'Мотивация не найдена' });
    const { rows } = await this.pool.query(
      'DELETE FROM employee_compensation WHERE id = $1 AND tenant_id = $2 RETURNING id',
      [id, tenantID],
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Мотивация не найдена' });
    invalidateReportsForTenant(tenantID);
    return { message: 'Удалено' };
  }
}
