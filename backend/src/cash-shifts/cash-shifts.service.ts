import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../database.module';
import { JwtPayload } from '../common/decorators/current-user.decorator';
import { OpenShiftDto } from './dto/open-shift.dto';
import { CloseShiftDto } from './dto/close-shift.dto';
import { CollectCashDto } from './dto/collect-cash.dto';

/** Any pg connection we can run a query on — the Pool or a checked-out client. */
type Queryable = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;

/** Parse a NUMERIC/text money value to a JS number (NULL/garbage → 0). */
function num(v: unknown): number {
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

/** Round to 2 decimals — money is stored NUMERIC(14,2); avoids 0.1+0.2 drift. */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Кассовая смена / Z-отчёт / Инкассация.
 *
 * The Z-report reconciles the PHYSICAL cash drawer against recorded activity
 * for one shift window [opened_at, closed_at ?? now()]. It is built by READING
 * the existing `checks` / `expenses` tables — this service never writes to them.
 *
 * Aggregation (mirrors reports.getCashFlow so the numbers tie out with the
 * existing «Касса по дням» screen):
 *   • cashSales  = SUM(checks.cash_amount)  WHERE is_deferred=false in window
 *   • cardSales  = SUM(checks.card_amount)  WHERE is_deferred=false in window
 *   A split-payment check (paymentMethod='cash_card') stores its cash portion in
 *   cash_amount and its card portion in card_amount, so summing each column
 *   counts only the matching tender — splits are handled for free. A RETURNED
 *   check already had its cash_amount/card_amount reduced in place by
 *   returns.service (cash drawn down first, then card), so refunds are netted
 *   out automatically; a fully-returned check contributes 0.
 *
 *   • cashExpenses = SUM(expenses.amount) for APPROVED expenses in window.
 *     Expenses carry no tender flag, so for drawer reconciliation we treat
 *     every approved expense as paid from the till (cash out). Salary payouts
 *     are NOT excluded here (unlike the P&L report) because cash physically
 *     leaving the drawer must reduce the expected balance.
 *
 *   • collectionsTotal = SUM(cash_collections.amount) for this shift_id.
 *
 *   expected = opening + cashSales − cashExpenses − collectionsTotal
 *   difference = closing (фактический нал) − expected   (>0 излишек, <0 недостача)
 */
@Injectable()
export class CashShiftsService {
  private readonly logger = new Logger('CashShiftsService');

  constructor(@Inject(PG_POOL) private pool: Pool) {}

  // ─── Row mapping ───────────────────────────────────────────────────────
  private mapShift(r: any) {
    return {
      id: r.id,
      tenantId: r.tenant_id,
      openedBy: r.opened_by ?? null,
      openedByName: r.opened_by_name ?? null,
      openedAt: r.opened_at,
      openingAmount: num(r.opening_amount),
      closedBy: r.closed_by ?? null,
      closedByName: r.closed_by_name ?? null,
      closedAt: r.closed_at ?? null,
      closingAmount: r.closing_amount === null || r.closing_amount === undefined ? null : num(r.closing_amount),
      expectedAmount: r.expected_amount === null || r.expected_amount === undefined ? null : num(r.expected_amount),
      difference: r.difference === null || r.difference === undefined ? null : num(r.difference),
      status: r.status,
      note: r.note ?? null,
      createdAt: r.created_at,
    };
  }

  private mapCollection(r: any) {
    return {
      id: r.id,
      tenantId: r.tenant_id,
      shiftId: r.shift_id,
      amount: num(r.amount),
      collectedBy: r.collected_by ?? null,
      collectedByName: r.collected_by_name ?? null,
      collectedAt: r.collected_at,
      note: r.note ?? null,
      createdAt: r.created_at,
    };
  }

  // ─── Single-row fetch with opener/closer names ─────────────────────────
  private async fetchShiftRow(db: Queryable, tenantID: string, id: string): Promise<any | null> {
    const { rows } = await db.query(
      `SELECT cs.*, ob.full_name AS opened_by_name, cb.full_name AS closed_by_name
         FROM cash_shifts cs
         LEFT JOIN users ob ON ob.id = cs.opened_by AND ob.tenant_id = cs.tenant_id
         LEFT JOIN users cb ON cb.id = cs.closed_by AND cb.tenant_id = cs.tenant_id
        WHERE cs.id = $1 AND cs.tenant_id = $2`,
      [id, tenantID],
    );
    return rows[0] ?? null;
  }

  /**
   * Live aggregation over the shift window. `windowEnd` is the closed_at of a
   * closed shift or now() for an open one. Tenant-scoped on every query.
   */
  private async computeFigures(
    db: Queryable,
    tenantID: string,
    shiftId: string,
    openedAt: string,
    windowEnd: string,
  ): Promise<{
    cashSales: number;
    cardSales: number;
    totalRevenue: number;
    checksCount: number;
    cashExpenses: number;
    collectionsTotal: number;
  }> {
    // Sales — mirror reports.getCashFlow exactly: only non-deferred checks,
    // sum cash_amount / card_amount columns (split & return aware). Window is
    // an inclusive timestamptz range on checks.date (the field getCashFlow and
    // the dashboard report on; a draft closed mid-shift has its date rewritten
    // to the activation moment, so it lands in the right window).
    const { rows: salesRows } = await db.query(
      `SELECT COALESCE(SUM(cash_amount), 0)    AS cash_sales,
              COALESCE(SUM(card_amount), 0)    AS card_sales,
              COALESCE(SUM(total_revenue), 0)  AS total_revenue,
              COUNT(*)                         AS checks_count
         FROM checks
        WHERE tenant_id = $1 AND is_deferred = false AND deleted_at IS NULL
          AND date >= $2 AND date <= $3`,
      [tenantID, openedAt, windowEnd],
    );

    // Cash expenses — every APPROVED expense in the window is treated as cash
    // out of the drawer (expenses carry no tender flag). NULL approval_status
    // is legacy-approved.
    const { rows: expRows } = await db.query(
      `SELECT COALESCE(SUM(amount), 0) AS cash_expenses
         FROM expenses
        WHERE tenant_id = $1
          AND COALESCE(approval_status, 'approved') = 'approved'
          AND date >= $2 AND date <= $3`,
      [tenantID, openedAt, windowEnd],
    );

    // Инкассация — keyed by shift_id (always created during this shift).
    const { rows: colRows } = await db.query(
      `SELECT COALESCE(SUM(amount), 0) AS collections
         FROM cash_collections
        WHERE tenant_id = $1 AND shift_id = $2`,
      [tenantID, shiftId],
    );

    return {
      cashSales: num(salesRows[0].cash_sales),
      cardSales: num(salesRows[0].card_sales),
      totalRevenue: num(salesRows[0].total_revenue),
      checksCount: parseInt(salesRows[0].checks_count, 10) || 0,
      cashExpenses: num(expRows[0].cash_expenses),
      collectionsTotal: num(colRows[0].collections),
    };
  }

  /**
   * Build the full Z-report for a shift row. For an OPEN shift everything is
   * computed live (expected = live, factual/difference = null). For a CLOSED
   * shift the headline expected/factual/difference are the values FROZEN at
   * close (a Z-report must stay a stable historical document), while the
   * breakdown is recomputed over the now-frozen window.
   */
  private async assembleReport(db: Queryable, tenantID: string, shiftRow: any) {
    const isClosed = shiftRow.status === 'closed';
    const windowEnd =
      isClosed && shiftRow.closed_at ? new Date(shiftRow.closed_at).toISOString() : new Date().toISOString();
    const openedAt = new Date(shiftRow.opened_at).toISOString();

    const figures = await this.computeFigures(db, tenantID, shiftRow.id, openedAt, windowEnd);

    const { rows: colRows } = await db.query(
      `SELECT cc.*, u.full_name AS collected_by_name
         FROM cash_collections cc
         LEFT JOIN users u ON u.id = cc.collected_by AND u.tenant_id = cc.tenant_id
        WHERE cc.tenant_id = $1 AND cc.shift_id = $2
        ORDER BY cc.collected_at ASC`,
      [tenantID, shiftRow.id],
    );

    const opening = num(shiftRow.opening_amount);
    const expectedLive = round2(opening + figures.cashSales - figures.cashExpenses - figures.collectionsTotal);

    let expectedAmount: number;
    let factualAmount: number | null;
    let difference: number | null;
    if (isClosed) {
      expectedAmount =
        shiftRow.expected_amount === null || shiftRow.expected_amount === undefined
          ? expectedLive
          : num(shiftRow.expected_amount);
      factualAmount =
        shiftRow.closing_amount === null || shiftRow.closing_amount === undefined ? null : num(shiftRow.closing_amount);
      difference =
        shiftRow.difference === null || shiftRow.difference === undefined
          ? factualAmount !== null
            ? round2(factualAmount - expectedAmount)
            : null
          : num(shiftRow.difference);
    } else {
      expectedAmount = expectedLive;
      factualAmount = null;
      difference = null;
    }

    return {
      shift: this.mapShift(shiftRow),
      cashSales: figures.cashSales,
      cardSales: figures.cardSales,
      totalRevenue: figures.totalRevenue,
      cashExpenses: figures.cashExpenses,
      collectionsTotal: figures.collectionsTotal,
      checksCount: figures.checksCount,
      openingAmount: opening,
      expectedAmount,
      factualAmount,
      difference,
      collections: colRows.map((r) => this.mapCollection(r)),
      windowStart: openedAt,
      windowEnd,
    };
  }

  // ─── Open ──────────────────────────────────────────────────────────────
  async open(user: JwtPayload, dto: OpenShiftDto) {
    // App-level guard (fast, friendly error). The partial unique index
    // uq_cash_shifts_one_open_per_tenant is the race-proof backstop below.
    const { rows: existing } = await this.pool.query(
      `SELECT id FROM cash_shifts WHERE tenant_id = $1 AND status = 'open' LIMIT 1`,
      [user.tenantID],
    );
    if (existing.length > 0) {
      throw new ConflictException({ message: 'Смена уже открыта' });
    }

    const opening = round2(num(dto.openingAmount));
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO cash_shifts (tenant_id, opened_by, opening_amount, status, note)
         VALUES ($1, $2, $3, 'open', $4)
         RETURNING id`,
        [user.tenantID, user.userID, opening, dto.note ?? null],
      );
      const row = await this.fetchShiftRow(this.pool, user.tenantID, rows[0].id);
      return this.assembleReport(this.pool, user.tenantID, row);
    } catch (err: any) {
      // 23505 = unique_violation on the partial index → a concurrent open won.
      if (err?.code === '23505') {
        throw new ConflictException({ message: 'Смена уже открыта' });
      }
      this.logger.error(`Cash shift open error: ${err}`);
      throw new InternalServerErrorException({ message: 'Ошибка сервера' });
    }
  }

  // ─── Close ─────────────────────────────────────────────────────────────
  async close(user: JwtPayload, id: string, dto: CloseShiftDto) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Lock the row so two concurrent closes can't both compute & write.
      const { rows } = await client.query(`SELECT * FROM cash_shifts WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [
        id,
        user.tenantID,
      ]);
      if (rows.length === 0) {
        await client.query('ROLLBACK');
        throw new NotFoundException({ message: 'Смена не найдена' });
      }
      const shift = rows[0];
      if (shift.status !== 'open') {
        await client.query('ROLLBACK');
        throw new BadRequestException({ message: 'Смена уже закрыта' });
      }

      const closedAt = new Date().toISOString();
      const openedAt = new Date(shift.opened_at).toISOString();
      const figures = await this.computeFigures(client, user.tenantID, id, openedAt, closedAt);

      const opening = num(shift.opening_amount);
      const expected = round2(opening + figures.cashSales - figures.cashExpenses - figures.collectionsTotal);
      const closing = round2(num(dto.closingAmount));
      const difference = round2(closing - expected);

      await client.query(
        `UPDATE cash_shifts
            SET status = 'closed',
                closed_by = $1,
                closed_at = $2,
                closing_amount = $3,
                expected_amount = $4,
                difference = $5,
                note = COALESCE($6, note)
          WHERE id = $7 AND tenant_id = $8`,
        [user.userID, closedAt, closing, expected, difference, dto.note ?? null, id, user.tenantID],
      );

      await client.query('COMMIT');
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* already rolled back */
      }
      if (err instanceof NotFoundException || err instanceof BadRequestException || err instanceof ConflictException) {
        throw err;
      }
      this.logger.error(`Cash shift close error: ${err}`);
      throw new InternalServerErrorException({ message: 'Ошибка сервера' });
    } finally {
      client.release();
    }

    const row = await this.fetchShiftRow(this.pool, user.tenantID, id);
    if (!row) throw new NotFoundException({ message: 'Смена не найдена' });
    return this.assembleReport(this.pool, user.tenantID, row);
  }

  // ─── Current open shift (or null) with live Z-report ───────────────────
  async current(tenantID: string) {
    const { rows } = await this.pool.query(
      `SELECT cs.*, ob.full_name AS opened_by_name, cb.full_name AS closed_by_name
         FROM cash_shifts cs
         LEFT JOIN users ob ON ob.id = cs.opened_by AND ob.tenant_id = cs.tenant_id
         LEFT JOIN users cb ON cb.id = cs.closed_by AND cb.tenant_id = cs.tenant_id
        WHERE cs.tenant_id = $1 AND cs.status = 'open'
        ORDER BY cs.opened_at DESC
        LIMIT 1`,
      [tenantID],
    );
    if (rows.length === 0) return null;
    return this.assembleReport(this.pool, tenantID, rows[0]);
  }

  // ─── Z-report for a specific shift ─────────────────────────────────────
  async report(tenantID: string, id: string) {
    const row = await this.fetchShiftRow(this.pool, tenantID, id);
    if (!row) throw new NotFoundException({ message: 'Смена не найдена' });
    return this.assembleReport(this.pool, tenantID, row);
  }

  // ─── Paginated list, newest first ──────────────────────────────────────
  async list(tenantID: string, query: any) {
    const page = Math.max(parseInt(query?.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query?.limit, 10) || 20, 1), 100);
    const offset = (page - 1) * limit;

    const { rows: countRows } = await this.pool.query(
      `SELECT COUNT(*) AS total FROM cash_shifts WHERE tenant_id = $1`,
      [tenantID],
    );
    const total = parseInt(countRows[0].total, 10) || 0;

    const { rows } = await this.pool.query(
      `SELECT cs.*, ob.full_name AS opened_by_name, cb.full_name AS closed_by_name
         FROM cash_shifts cs
         LEFT JOIN users ob ON ob.id = cs.opened_by AND ob.tenant_id = cs.tenant_id
         LEFT JOIN users cb ON cb.id = cs.closed_by AND cb.tenant_id = cs.tenant_id
        WHERE cs.tenant_id = $1
        ORDER BY cs.opened_at DESC
        LIMIT $2 OFFSET $3`,
      [tenantID, limit, offset],
    );

    return { data: rows.map((r) => this.mapShift(r)), total, page, limit };
  }

  // ─── Инкассация ────────────────────────────────────────────────────────
  async collect(user: JwtPayload, id: string, dto: CollectCashDto) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT status FROM cash_shifts WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        [id, user.tenantID],
      );
      if (rows.length === 0) {
        await client.query('ROLLBACK');
        throw new NotFoundException({ message: 'Смена не найдена' });
      }
      if (rows[0].status !== 'open') {
        await client.query('ROLLBACK');
        throw new BadRequestException({ message: 'Инкассация возможна только при открытой смене' });
      }

      const amount = round2(num(dto.amount));
      if (!(amount > 0)) {
        await client.query('ROLLBACK');
        throw new BadRequestException({ message: 'Сумма инкассации должна быть положительной' });
      }

      await client.query(
        `INSERT INTO cash_collections (tenant_id, shift_id, amount, collected_by, note)
         VALUES ($1, $2, $3, $4, $5)`,
        [user.tenantID, id, amount, user.userID, dto.note ?? null],
      );

      await client.query('COMMIT');
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* already rolled back */
      }
      if (err instanceof NotFoundException || err instanceof BadRequestException) throw err;
      this.logger.error(`Cash collection error: ${err}`);
      throw new InternalServerErrorException({ message: 'Ошибка сервера' });
    } finally {
      client.release();
    }

    // Echo the refreshed Z-report so the UI sees the new collections total +
    // recomputed expected balance immediately.
    return this.report(user.tenantID, id);
  }
}
