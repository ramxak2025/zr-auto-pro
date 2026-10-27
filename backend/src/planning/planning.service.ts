import { Injectable, Inject, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { createHash } from 'node:crypto';
import { normalizeTimezone } from '../common/timezone';
import { PG_POOL } from '../database.module';
import { invalidateReportsForTenant } from '../common/reports-cache';
import { assertRowPointForWrite, pointFilterSql } from '../common/point-scope';
import { assignedToPointSql } from '../users/user-points-sql';

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

export interface FixedCostState {
  perVehicleDayAmount: number;
  active: boolean;
  archived: boolean;
  effectiveFrom: string;
}
interface FixedCostRow {
  id: string;
  tenant_id: string;
  name: string;
  category: string;
  monthly_amount: string;
  active: boolean;
  point_id: string | null;
  mode?: 'monthly' | 'per_vehicle_day';
  revision: number;
  created_at: string;
  updated_at: string;
  current_state?: FixedCostState | null;
  pending_state?: FixedCostState | null;
}

/**
 * PlanningService — owner-configured «Планирование / Постоянные расходы» that
 * feeds the ACCRUAL net-profit on the owner dashboard (reports v2). Two configs:
 *   • fixed_costs           — planned recurring MONTHLY amounts (rent / utilities /
 *                             marketing / custom), amortised over calendar days,
 *                             or per_vehicle_day with effective-day history.
 *   • employee_compensation — per-employee оклад (fixed_monthly) / % с оборота
 *                             (pct_turnover) / % с прибыли (pct_profit).
 *
 * WRITE side lives here; the READ side (accrual math) is inlined in
 * ReportsService.computeDashboardV2; vehicle-day reports share common/vehicle-day-costs.
 * Every write invalidates the tenant's cached report aggregates so the smoothed
 * net profit reflects the config change immediately.
 *
 * Access is owner-only, enforced in the controller (@Roles owner-class +
 * @RequirePermission('financial_reports')). All queries are tenant-scoped and
 * parameterised.
 *
 * ФИЛИАЛ (167). План постоянных расходов — на каждый автосервис СВОЙ:
 * fixed_costs.point_id штампуется филиалом сессии и режется строгим
 * равенством (common/point-scope), правка/удаление — тем же гейтом записи,
 * что у расходов. Оклады (employee_compensation) остаются конфигом
 * СОТРУДНИКА (одна строка на человека во всей сети), а в срез филиала
 * попадают оклады его КОМАНДЫ — назначения user_points, дефолт 156. Раньше
 * план был один на тенант: аренда филиала вычиталась из прибыли основного
 * сервиса, а на экране филиала лежал план основного — жалоба владельца
 * «постоянные расходы с основной точки в филиале».
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

  private mapFixedCost(r: FixedCostRow) {
    return {
      id: r.id,
      tenantId: r.tenant_id,
      name: r.name,
      category: r.category,
      monthlyAmount: parseFloat(r.monthly_amount) || 0,
      mode: r.mode ?? 'monthly',
      active: r.current_state?.active ?? r.active !== false,
      pointId: r.point_id ?? null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      ...(r.mode === 'per_vehicle_day'
        ? {
            revision: r.revision,
            perVehicleDayAmount: r.current_state?.perVehicleDayAmount ?? 0,
            effectiveFrom: r.current_state?.effectiveFrom,
            archived: r.current_state?.archived ?? false,
            pending: r.pending_state ?? undefined,
          }
        : {}),
    };
  }

  private async readFixedCosts(db: Pool | PoolClient, tenantID: string, pointId: string | null, id?: string) {
    const params: unknown[] = [tenantID];
    const pointFilter = pointFilterSql(null, pointId, params);
    const idFilter = id ? (params.push(id), ` AND id = $${params.length}`) : '';
    const timezone = normalizeTimezone(
      (await db.query('SELECT timezone FROM tenants WHERE id=$1', [tenantID])).rows[0]?.timezone,
    );
    params.push(timezone);
    const timezonePh = `$${params.length}::text`;
    const state = `jsonb_build_object('perVehicleDayAmount', h.amount, 'active', h.active,
      'archived', h.archived, 'effectiveFrom', to_char(h.effective_from, 'YYYY-MM-DD'))`;
    const { rows } = await db.query<FixedCostRow>(
      `WITH parents AS (SELECT * FROM fixed_costs WHERE tenant_id = $1${pointFilter}${idFilter})
       SELECT fc.*, cur.state AS current_state, pending.state AS pending_state
         FROM parents fc
         LEFT JOIN LATERAL (
           SELECT ${state} AS state FROM fixed_cost_vehicle_history h
            WHERE h.tenant_id = $1 AND h.fixed_cost_id = fc.id
              AND h.effective_from <= (statement_timestamp() AT TIME ZONE ${timezonePh})::date
            ORDER BY h.effective_from DESC, h.revision DESC LIMIT 1
         ) cur ON true
         LEFT JOIN LATERAL (
           SELECT ${state} AS state FROM fixed_cost_vehicle_history h
            WHERE h.tenant_id = $1 AND h.fixed_cost_id = fc.id
              AND h.effective_from > (statement_timestamp() AT TIME ZONE ${timezonePh})::date
            ORDER BY h.effective_from ASC, h.revision DESC LIMIT 1
         ) pending ON true
        ORDER BY COALESCE((cur.state->>'active')::boolean, fc.active) DESC, fc.name`,
      params,
    );
    return rows;
  }

  private vehicleAmount(value: unknown): number {
    if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') {
      throw new BadRequestException({ message: 'Укажите сумму за автомобиль в день' });
    }
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > AMOUNT_CEILING || n !== Math.round(n * 100) / 100) {
      throw new BadRequestException({
        message: 'Сумма должна быть от 0 до 100 000 000, не более двух знаков после запятой',
      });
    }
    return Math.round(n * 100) / 100;
  }

  /** Same request ID + canonical payload replays the original success. */
  private async vehicleMutation(
    tenantID: string,
    pointId: string | null,
    operation: 'create' | 'update' | 'archive',
    id: string | null,
    dto: Record<string, unknown>,
  ) {
    if (typeof dto.requestId !== 'string' || !UUID_RE.test(dto.requestId)) {
      throw new BadRequestException({ message: 'requestId обязателен для расхода за автомобиль' });
    }
    if (dto.monthlyAmount !== undefined || dto.effectiveFrom !== undefined || dto.pending !== undefined) {
      throw new BadRequestException({
        message: 'Для этого режима укажите perVehicleDayAmount; дату действия назначает сервер',
      });
    }
    if (dto.mode !== undefined && dto.mode !== 'per_vehicle_day') {
      throw new BadRequestException({ message: 'Изменить режим существующего расхода нельзя' });
    }
    if (dto.active !== undefined && typeof dto.active !== 'boolean') {
      throw new BadRequestException({ message: 'active должно быть логическим значением' });
    }
    const amount =
      dto.perVehicleDayAmount === undefined && operation !== 'create'
        ? undefined
        : this.vehicleAmount(dto.perVehicleDayAmount);
    if (operation !== 'create' && (!Number.isSafeInteger(dto.revision) || Number(dto.revision) < 1)) {
      throw new BadRequestException({ message: 'revision обязателен; обновите список расходов' });
    }
    const input = Object.fromEntries(
      Object.keys(dto)
        .sort()
        .map((key) => [key, dto[key]]),
    );
    const hash = createHash('sha256').update(JSON.stringify({ operation, id, pointId, input })).digest('hex');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Serializes equal request IDs before the parent exists (create retry).
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${tenantID}:${dto.requestId}`]);
      const receipt = await client.query<{ payload_hash: string; result: ReturnType<PlanningService['mapFixedCost']> }>(
        'SELECT payload_hash, result FROM fixed_cost_requests WHERE tenant_id = $1 AND request_id = $2',
        [tenantID, dto.requestId],
      );
      if (receipt.rows[0]) {
        if (receipt.rows[0].payload_hash !== hash)
          throw new ConflictException({ message: 'requestId уже использован для другого изменения' });
        await client.query('COMMIT');
        return receipt.rows[0].result;
      }
      let row: FixedCostRow;
      if (operation === 'create') {
        const { rows } = await client.query<FixedCostRow>(
          `INSERT INTO fixed_costs (tenant_id,name,category,monthly_amount,active,point_id,mode)
           VALUES ($1,$2,$3,0,$4,$5,'per_vehicle_day') RETURNING *`,
          [
            tenantID,
            this.cleanName(dto.name),
            FIXED_COST_CATEGORIES.has(String(dto.category)) ? dto.category : 'other',
            dto.active ?? true,
            pointId,
          ],
        );
        row = rows[0];
      } else {
        const params: unknown[] = [id, tenantID];
        const point = pointFilterSql(null, pointId, params);
        const { rows } = await client.query<FixedCostRow>(
          `SELECT * FROM fixed_costs WHERE id = $1 AND tenant_id = $2${point} FOR UPDATE`,
          params,
        );
        row = rows[0];
        if (!row) throw new NotFoundException({ message: 'Постоянный расход не найден' });
        if (row.mode !== 'per_vehicle_day')
          throw new BadRequestException({ message: 'Изменить режим существующего расхода нельзя' });
        if (row.revision !== dto.revision)
          throw new ConflictException({
            message: 'Расход уже изменён. Обновите список и повторите изменение',
            revision: row.revision,
          });
        const current = (await this.readFixedCosts(client, tenantID, pointId, row.id))[0];
        if (current.current_state?.archived) throw new ConflictException({ message: 'Расход уже архивирован' });
        await client.query(
          `UPDATE fixed_costs SET name=$3, category=$4, revision=revision+1, updated_at=now() WHERE id=$1 AND tenant_id=$2`,
          [
            row.id,
            tenantID,
            dto.name === undefined ? row.name : this.cleanName(dto.name),
            dto.category === undefined
              ? row.category
              : FIXED_COST_CATEGORIES.has(String(dto.category))
                ? dto.category
                : 'other',
          ],
        );
        row = { ...row, revision: row.revision + 1 };
      }
      // Base edits on the latest accepted state, including tomorrow's pending
      // rate. Changing a name must never silently cancel a scheduled rate.
      const { rows: prior } = await client.query<{ amount: string; active: boolean; archived: boolean }>(
        `SELECT amount,active,archived FROM fixed_cost_vehicle_history WHERE tenant_id=$1 AND fixed_cost_id=$2
         ORDER BY effective_from DESC, revision DESC LIMIT 1`,
        [tenantID, row.id],
      );
      const latest = prior[0];
      if (operation !== 'update' || amount !== undefined || dto.active !== undefined) {
        const timezone = normalizeTimezone(
          (await client.query('SELECT timezone FROM tenants WHERE id=$1', [tenantID])).rows[0]?.timezone,
        );
        await client.query(
          `INSERT INTO fixed_cost_vehicle_history (tenant_id,fixed_cost_id,revision,effective_from,amount,active,archived)
           SELECT $1,$2,$3,(statement_timestamp() AT TIME ZONE $8::text)::date + $4::int,$5,$6,$7 FROM tenants t WHERE t.id=$1`,
          [
            tenantID,
            row.id,
            row.revision,
            operation === 'create' ? 0 : 1,
            amount ?? Number(latest?.amount ?? 0),
            operation === 'archive' ? false : (dto.active ?? latest?.active ?? true),
            operation === 'archive' ? true : dto.active === true ? false : (latest?.archived ?? false),
            timezone,
          ],
        );
      }
      const result = this.mapFixedCost((await this.readFixedCosts(client, tenantID, pointId, row.id))[0]);
      await client.query(
        'INSERT INTO fixed_cost_requests(tenant_id,request_id,payload_hash,result) VALUES($1,$2,$3,$4::jsonb)',
        [tenantID, dto.requestId, hash, JSON.stringify(result)],
      );
      await client.query('COMMIT');
      invalidateReportsForTenant(tenantID);
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
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

  /** Гейт записи по филиалу — общий предикат common/point-scope. */
  private assertOwnFixedCost(id: string, tenantID: string, pointId: string | null): Promise<void> {
    return assertRowPointForWrite(this.pool, 'fixed_costs', id, tenantID, pointId, 'Постоянный расход не найден');
  }

  async listFixedCosts(tenantID: string, pointId: string | null = null) {
    return (await this.readFixedCosts(this.pool, tenantID, pointId))
      .filter((r) => !r.current_state?.archived)
      .map((r) => this.mapFixedCost(r));
  }

  async createFixedCost(tenantID: string, dto: any, pointId: string | null = null) {
    if (dto?.mode !== undefined && !['monthly', 'per_vehicle_day'].includes(dto.mode)) {
      throw new BadRequestException({ message: 'Неизвестный режим расхода' });
    }
    if (dto?.mode === 'per_vehicle_day') return this.vehicleMutation(tenantID, pointId, 'create', null, dto);
    if (dto?.perVehicleDayAmount !== undefined)
      throw new BadRequestException({ message: 'Укажите режим per_vehicle_day' });
    const name = this.cleanName(dto?.name);
    const category = FIXED_COST_CATEGORIES.has(dto?.category) ? dto.category : 'other';
    const monthlyAmount = this.cleanAmount(dto?.monthlyAmount, false);
    const active = dto?.active === undefined ? true : !!dto.active;

    // 167 — план рождается в филиале сессии.
    const { rows } = await this.pool.query(
      `INSERT INTO fixed_costs (tenant_id, name, category, monthly_amount, active, point_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [tenantID, name, category, monthlyAmount, active, pointId],
    );
    invalidateReportsForTenant(tenantID);
    return this.mapFixedCost(rows[0]);
  }

  async updateFixedCost(id: string, tenantID: string, dto: any, pointId: string | null = null) {
    if (!UUID_RE.test(id)) throw new NotFoundException({ message: 'Постоянный расход не найден' });
    await this.assertOwnFixedCost(id, tenantID, pointId);
    const existing = (
      await this.pool.query<FixedCostRow>('SELECT * FROM fixed_costs WHERE id=$1 AND tenant_id=$2', [id, tenantID])
    ).rows[0];
    if (!existing) throw new NotFoundException({ message: 'Постоянный расход не найден' });
    if (existing.mode === 'per_vehicle_day') return this.vehicleMutation(tenantID, pointId, 'update', id, dto ?? {});
    if ((dto?.mode !== undefined && dto.mode !== 'monthly') || dto?.perVehicleDayAmount !== undefined) {
      throw new BadRequestException({ message: 'Изменить режим существующего расхода нельзя' });
    }

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

  async removeFixedCost(
    id: string,
    tenantID: string,
    pointId: string | null = null,
    dto: Record<string, unknown> = {},
  ) {
    if (!UUID_RE.test(id)) throw new NotFoundException({ message: 'Постоянный расход не найден' });
    await this.assertOwnFixedCost(id, tenantID, pointId);
    const existing = (
      await this.pool.query<FixedCostRow>('SELECT * FROM fixed_costs WHERE id=$1 AND tenant_id=$2', [id, tenantID])
    ).rows[0];
    if (existing?.mode === 'per_vehicle_day') {
      const fixedCost = await this.vehicleMutation(tenantID, pointId, 'archive', id, dto);
      return { message: 'Будет архивировано со следующего дня', fixedCost };
    }

    const { rows } = await this.pool.query('DELETE FROM fixed_costs WHERE id = $1 AND tenant_id = $2 RETURNING id', [
      id,
      tenantID,
    ]);
    if (rows.length === 0) throw new NotFoundException({ message: 'Постоянный расход не найден' });
    invalidateReportsForTenant(tenantID);
    return { message: 'Удалено' };
  }

  // ── Employee compensation ───────────────────────────────────────────────────

  /** Оклады КОМАНДЫ филиала (user_points, дефолт 156); без филиала — все. */
  async listCompensation(tenantID: string, pointId: string | null = null) {
    const params: unknown[] = [tenantID];
    const teamFilter = assignedToPointSql('u', '$1', pointId, params);
    const { rows } = await this.pool.query(
      `SELECT ec.*, u.full_name AS user_name, u.role AS user_role
         FROM employee_compensation ec
         JOIN users u ON u.id = ec.user_id AND u.tenant_id = ec.tenant_id
        WHERE ec.tenant_id = $1${teamFilter}
        ORDER BY u.full_name`,
      params,
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
