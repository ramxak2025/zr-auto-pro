import {
  Injectable,
  Inject,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';
import { WarehousesService } from '../warehouses/warehouses.service';
import { invalidateReportsForTenant } from '../common/reports-cache';

export type ReturnDestination = 'warehouse' | 'defect';
export type ReturnScope = 'full' | 'partial';

export interface ReturnLineInput {
  productLineId?: string;
  serviceLineId?: string;
  quantity?: number;
}

export interface CreateReturnDto {
  destination: ReturnDestination;
  reason?: string;
  scope: ReturnScope;
  refundAmount?: number;
  lines?: ReturnLineInput[];
}

@Injectable()
export class ReturnsService {
  private readonly logger = new Logger('ReturnsService');

  constructor(
    @Inject(PG_POOL) private pool: Pool,
    private warehouses: WarehousesService,
  ) {}

  /**
   * Create a return against a check. The endpoint accepts either a full
   * return (all lines come back) or a partial return (specific lines).
   *
   * Side effects (inside one transaction):
   *
   *   1. `check_returns` header row gets inserted.
   *   2. For partial scope, one `check_return_lines` row per requested line.
   *   3. The parent `checks` row is marked `is_returned=true` + returned_at,
   *      return_destination, return_scope are persisted.
   *   4. For every product line returned (full → all product lines; partial →
   *      the ones the caller listed), a `stock_movements` row is written.
   *      Destination=warehouse → main warehouse (customer_return, returned to
   *      stock — a distinct type so the journal shows «Возврат клиента», NOT
   *      a supplier «Поступление»; stock still increments exactly as income did).
   *      Destination=defect    → defect warehouse (defect_transfer, stock NOT
   *      added back to main; instead it lands on the defect warehouse
   *      so it shows up in the defect/writeoff report).
   */
  async createReturn(tenantID: string, userID: string, checkId: string, dto: CreateReturnDto) {
    if (!dto || !dto.destination || !dto.scope) {
      throw new BadRequestException({ message: 'destination и scope обязательны' });
    }
    if (dto.destination !== 'warehouse' && dto.destination !== 'defect') {
      throw new BadRequestException({ message: 'Неверное направление возврата' });
    }
    if (dto.scope !== 'full' && dto.scope !== 'partial') {
      throw new BadRequestException({ message: 'Неверный тип возврата' });
    }
    // Reason is required for defect destination — otherwise we lose the
    // diagnostic trail of why the part was junked.
    if (dto.destination === 'defect' && (!dto.reason || !dto.reason.trim())) {
      throw new BadRequestException({ message: 'Для возврата в брак укажите причину' });
    }
    if (dto.scope === 'partial' && (!dto.lines || dto.lines.length === 0)) {
      throw new BadRequestException({ message: 'Укажите позиции для частичного возврата' });
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Verify the check belongs to this tenant + grab basic data.
      const { rows: checkRows } = await client.query(
        `SELECT id, total_revenue, is_returned FROM checks WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        [checkId, tenantID],
      );
      if (checkRows.length === 0) {
        throw new NotFoundException({ message: 'Заказ-наряд не найден' });
      }
      if (checkRows[0].is_returned) {
        throw new BadRequestException({ message: 'Заказ-наряд уже возвращён' });
      }

      const totalRevenue = parseFloat(checkRows[0].total_revenue) || 0;
      const requestedRefund =
        dto.refundAmount !== undefined && dto.refundAmount !== null
          ? Math.max(0, parseFloat(String(dto.refundAmount)))
          : dto.scope === 'full'
            ? totalRevenue
            : 0;
      // A refund can never exceed what was actually charged on the check —
      // otherwise reversing it would drive the check's revenue/cash negative.
      const refundAmount = Math.min(requestedRefund, totalRevenue);

      // Insert the header row first.
      const { rows: retRows } = await client.query(
        `INSERT INTO check_returns
           (check_id, tenant_id, returned_by, destination, reason, refund_amount, scope)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, created_at`,
        [checkId, tenantID, userID || null, dto.destination, dto.reason ?? null, refundAmount, dto.scope],
      );
      const returnId = retRows[0].id;

      // Collect the product lines we need to move stock for.
      const allProductLines = await client.query(
        `SELECT id, product_id, quantity FROM check_product_lines WHERE check_id = $1`,
        [checkId],
      );

      // For full scope we move every product line; for partial we honour caller's list.
      const productMoves: Array<{ productLineId: string | null; productId: string | null; quantity: number }> = [];
      if (dto.scope === 'full') {
        for (const pl of allProductLines.rows) {
          productMoves.push({
            productLineId: pl.id,
            productId: pl.product_id,
            quantity: parseFloat(pl.quantity) || 0,
          });
        }
      } else if (dto.lines) {
        // Resolve each user-provided line back to a product line in this check.
        for (const ln of dto.lines) {
          if (ln.productLineId) {
            const match = allProductLines.rows.find((r) => r.id === ln.productLineId);
            if (!match) {
              throw new BadRequestException({ message: 'Позиция не найдена в заказ-наряде' });
            }
            const lineQty = parseFloat(match.quantity) || 0;
            const requestedQty =
              ln.quantity !== undefined && ln.quantity !== null ? parseFloat(String(ln.quantity)) : 1;
            // Never return more than was sold on that line — a forged quantity
            // would otherwise inflate stock on add-back.
            const qty = Math.max(0, Math.min(requestedQty, lineQty));
            productMoves.push({
              productLineId: match.id,
              productId: match.product_id,
              quantity: qty,
            });
            // Per-line return row.
            await client.query(
              `INSERT INTO check_return_lines (return_id, product_line_id, product_id, quantity, amount)
               VALUES ($1, $2, $3, $4, 0)`,
              [returnId, match.id, match.product_id, qty],
            );
          } else if (ln.serviceLineId) {
            // Services are intangible — no stock move. Still record the line so
            // the partial-return summary can show what was refunded.
            await client.query(
              `INSERT INTO check_return_lines (return_id, service_line_id, quantity, amount)
               VALUES ($1, $2, $3, 0)`,
              [returnId, ln.serviceLineId, ln.quantity ?? 1],
            );
          }
        }
      }

      // Resolve target warehouse once.
      const targetWh =
        dto.destination === 'warehouse'
          ? await this.warehouses.resolveByKind(tenantID, 'main')
          : await this.warehouses.resolveByKind(tenantID, 'defect');

      for (const mv of productMoves) {
        if (!mv.productId || mv.quantity <= 0) continue;
        const { rows: prodRows } = await client.query(
          `SELECT stock FROM products WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
          [mv.productId, tenantID],
        );
        if (prodRows.length === 0) continue; // product deleted — skip stock, but keep the return line
        const stockBefore = parseFloat(prodRows[0].stock) || 0;
        const stockAfter = dto.destination === 'warehouse' ? stockBefore + mv.quantity : stockBefore; // defect destination doesn't add back to main

        if (dto.destination === 'warehouse') {
          await client.query(`UPDATE products SET stock = $1 WHERE id = $2 AND tenant_id = $3`, [
            stockAfter,
            mv.productId,
            tenantID,
          ]);
        }

        await client.query(
          `INSERT INTO stock_movements
             (product_id, type, quantity, stock_before, stock_after, reason,
              tenant_id, user_id, warehouse_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            mv.productId,
            // Customer return to the main warehouse gets its OWN type so the
            // journal classifies it as «Возврат клиента» (not a supplier
            // «Поступление»). Stock still adds back identically (see stockAfter
            // above) — only the type label differs from the old 'income'.
            dto.destination === 'warehouse' ? 'customer_return' : 'defect_transfer',
            mv.quantity,
            stockBefore,
            stockAfter,
            dto.reason ?? `Возврат заказ-наряда`,
            tenantID,
            userID || null,
            targetWh.id,
          ],
        );
      }

      // Mark the check returned AND reverse its realised money so every
      // report (cash-flow, profit, dashboard) is automatically correct from a
      // single source of truth — no aggregation needs to special-case
      // is_returned. Owner policy (2026-06): a returned sale stops counting in
      // its OWN period (full → whole sale removed, partial → by refund amount),
      // while the master KEEPS their accrued salary (service_salary_total /
      // product_salary_total are left untouched), so the labour stays a real
      // cost and the return shows as the genuine loss it is. refundAmount is
      // already capped at total_revenue above, so these never go negative.
      // The card reduction takes whatever the refund couldn't draw from cash
      // (cash first, then card) — a full return zeroes both exactly.
      await client.query(
        `UPDATE checks
            SET is_returned = true,
                returned_at = now(),
                return_destination = $1,
                return_scope = $2,
                total_revenue = GREATEST(COALESCE(total_revenue, 0) - $5, 0),
                profit = COALESCE(profit, 0) - $5,
                cash_amount = GREATEST(COALESCE(cash_amount, 0) - $5, 0),
                card_amount = GREATEST(COALESCE(card_amount, 0) - GREATEST($5 - COALESCE(cash_amount, 0), 0), 0)
          WHERE id = $3 AND tenant_id = $4`,
        [dto.destination, dto.scope, checkId, tenantID, refundAmount],
      );

      await client.query('COMMIT');

      // Returns move the cash position / profit — drop the tenant's cached
      // report aggregates so the dashboard reflects the reversal immediately
      // (mirrors every check/expense write).
      invalidateReportsForTenant(tenantID);

      return {
        id: returnId,
        checkId,
        destination: dto.destination,
        scope: dto.scope,
        reason: dto.reason ?? null,
        refundAmount,
        returnedBy: userID || null,
        createdAt: retRows[0].created_at,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      if (err instanceof BadRequestException || err instanceof NotFoundException) throw err;
      this.logger.error(`Return create error: ${err}`);
      throw new InternalServerErrorException({ message: 'Ошибка сервера' });
    } finally {
      client.release();
    }
  }

  /**
   * List returns for the journal. Joined with checks for number / total / client
   * name. Default window: last 90 days unless explicit from/to are provided.
   */
  async list(tenantID: string, query: { from?: string; to?: string }) {
    const conds: string[] = ['cr.tenant_id = $1'];
    const params: unknown[] = [tenantID];
    let idx = 2;
    if (query.from) {
      conds.push(`cr.created_at >= $${idx++}`);
      params.push(query.from);
    }
    if (query.to) {
      conds.push(`cr.created_at <= ($${idx++}::date + 1)::timestamptz`);
      params.push(query.to);
    }

    const { rows } = await this.pool.query(
      `SELECT cr.id, cr.check_id, cr.destination, cr.reason, cr.refund_amount,
              cr.scope, cr.returned_by, cr.created_at,
              ch.number AS check_number, ch.total_revenue AS check_total,
              cl.full_name AS client_name
         FROM check_returns cr
         JOIN checks ch ON ch.id = cr.check_id
         LEFT JOIN clients cl ON cl.id = ch.client_id
        WHERE ${conds.join(' AND ')}
        ORDER BY cr.created_at DESC
        LIMIT 500`,
      params,
    );

    return rows.map((r) => ({
      id: r.id,
      checkId: r.check_id,
      checkNumber: r.check_number,
      checkTotal: parseFloat(r.check_total) || 0,
      clientName: r.client_name || null,
      destination: r.destination as ReturnDestination,
      reason: r.reason,
      refundAmount: parseFloat(r.refund_amount) || 0,
      scope: r.scope as ReturnScope,
      returnedBy: r.returned_by,
      createdAt: r.created_at,
    }));
  }
}
