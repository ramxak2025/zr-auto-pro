import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';
import { JwtPayload } from '../common/decorators/current-user.decorator';
import { ChargeDebtDto } from './dto/charge-debt.dto';
import { PaymentDebtDto } from './dto/payment-debt.dto';

/** Parse a NUMERIC/text money value to a JS number (NULL/garbage → 0). */
function num(v: unknown): number {
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

/** Round to 2 decimals — money is stored NUMERIC(14,2); avoids float drift. */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Дебиторка / долги клиентов — a plain double-sided ledger per client.
 *
 * Every row is one explicit movement recorded by an owner-class user:
 *   • type='charge'  — client owes more (work done on credit, etc.).
 *   • type='payment' — repayment of the debt.
 *
 * Balance is computed PLAINLY as Σcharge − Σpayment and is NEVER clamped: an
 * overpayment drives the balance negative (the client has credit / shop owes
 * them). We deliberately ALLOW overpayment rather than rejecting or clamping —
 * a partial/whole repayment must always be recordable, and a small negative is
 * a meaningful "client has credit" signal the UI can surface.
 *
 * This service OWNS only `client_debts`. It READS `clients` (tenant guard +
 * debtor names) and READS `checks` read-only (is_deferred context + check_id
 * validation). It NEVER writes to `checks` or any other module's table.
 */
@Injectable()
export class DebtsService {
  constructor(@Inject(PG_POOL) private pool: Pool) {}

  // ─── Row mapping ───────────────────────────────────────────────────────
  private mapEntry(r: any) {
    return {
      id: r.id as string,
      tenantId: r.tenant_id as string,
      clientId: r.client_id as string,
      amount: num(r.amount),
      type: r.type as 'charge' | 'payment',
      reason: r.reason ?? null,
      checkId: r.check_id ?? null,
      checkNumber: r.check_number ?? null,
      createdBy: r.created_by ?? null,
      createdByName: r.created_by_name ?? null,
      createdAt: r.created_at as string,
    };
  }

  /** Assert the client exists in this tenant; return its name/phone. */
  private async requireClient(tenantID: string, clientId: string): Promise<{ name: string; phone: string | null }> {
    const { rows } = await this.pool.query('SELECT full_name, phone FROM clients WHERE id = $1 AND tenant_id = $2', [
      clientId,
      tenantID,
    ]);
    if (rows.length === 0) throw new NotFoundException({ message: 'Клиент не найден' });
    return { name: rows[0].full_name as string, phone: (rows[0].phone as string) ?? null };
  }

  // ─── Reads ─────────────────────────────────────────────────────────────

  /**
   * Per-client debt summary: plain balance + full ledger (newest-first) +
   * read-only `deferredChecks` context. `deferredChecks` is NOT counted in
   * `balance` — it is purely informational (unpaid/deferred orders) so the UI
   * can show outstanding checks alongside the manual ledger.
   */
  async clientLedger(tenantID: string, clientId: string) {
    const client = await this.requireClient(tenantID, clientId);

    const { rows: ledgerRows } = await this.pool.query(
      `SELECT cd.*, u.full_name AS created_by_name, ch.number AS check_number
         FROM client_debts cd
         LEFT JOIN users u ON u.id = cd.created_by AND u.tenant_id = cd.tenant_id
         LEFT JOIN checks ch ON ch.id = cd.check_id AND ch.tenant_id = cd.tenant_id
        WHERE cd.tenant_id = $1 AND cd.client_id = $2
        ORDER BY cd.created_at DESC, cd.id DESC`,
      [tenantID, clientId],
    );

    const balance = round2(
      ledgerRows.reduce((acc, r) => acc + (r.type === 'charge' ? num(r.amount) : -num(r.amount)), 0),
    );

    // Read-only context: outstanding deferred (unpaid) checks for this client.
    const { rows: deferredRows } = await this.pool.query(
      `SELECT id, number, date, total_revenue
         FROM checks
        WHERE tenant_id = $1 AND client_id = $2 AND is_deferred = true AND deleted_at IS NULL
        ORDER BY date DESC`,
      [tenantID, clientId],
    );

    return {
      clientId,
      clientName: client.name,
      clientPhone: client.phone,
      balance,
      ledger: ledgerRows.map((r) => this.mapEntry(r)),
      deferredChecks: deferredRows.map((r) => ({
        id: r.id as string,
        number: r.number as string,
        date: r.date as string,
        totalRevenue: num(r.total_revenue),
      })),
    };
  }

  /**
   * Debtors overview: every client with a POSITIVE balance, ordered by balance
   * desc. One GROUP BY + HAVING over the tenant's ledger, joined to clients for
   * name/phone. Clients with zero or negative (credit) balance are excluded.
   */
  async debtors(tenantID: string) {
    const { rows } = await this.pool.query(
      `SELECT cd.client_id,
              c.full_name AS name,
              c.phone     AS phone,
              SUM(CASE WHEN cd.type = 'charge' THEN cd.amount ELSE -cd.amount END) AS balance
         FROM client_debts cd
         JOIN clients c ON c.id = cd.client_id AND c.tenant_id = cd.tenant_id
        WHERE cd.tenant_id = $1
        GROUP BY cd.client_id, c.full_name, c.phone
       HAVING SUM(CASE WHEN cd.type = 'charge' THEN cd.amount ELSE -cd.amount END) > 0
        ORDER BY balance DESC`,
      [tenantID],
    );
    return rows.map((r) => ({
      clientId: r.client_id as string,
      name: r.name as string,
      phone: (r.phone as string) ?? null,
      balance: round2(num(r.balance)),
    }));
  }

  // ─── Mutations (owner-class only — gated in the controller) ────────────

  /** Record a 'charge' (client owes more) and return the refreshed summary. */
  async charge(user: JwtPayload, dto: ChargeDebtDto) {
    await this.requireClient(user.tenantID, dto.clientId);

    let checkId: string | null = null;
    if (dto.checkId) {
      const { rows } = await this.pool.query(
        'SELECT 1 FROM checks WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL',
        [dto.checkId, user.tenantID],
      );
      if (rows.length === 0) throw new BadRequestException({ message: 'Чек не найден' });
      checkId = dto.checkId;
    }

    await this.pool.query(
      `INSERT INTO client_debts (tenant_id, client_id, amount, type, reason, check_id, created_by)
       VALUES ($1, $2, $3, 'charge', $4, $5, $6)`,
      [user.tenantID, dto.clientId, round2(dto.amount), dto.reason ?? null, checkId, user.userID],
    );

    return this.clientLedger(user.tenantID, dto.clientId);
  }

  /**
   * Record a 'payment' (repayment) and return the refreshed summary. Overpayment
   * is ALLOWED — we never clamp; the balance simply goes negative (client credit).
   */
  async payment(user: JwtPayload, dto: PaymentDebtDto) {
    await this.requireClient(user.tenantID, dto.clientId);

    await this.pool.query(
      `INSERT INTO client_debts (tenant_id, client_id, amount, type, reason, created_by)
       VALUES ($1, $2, $3, 'payment', $4, $5)`,
      [user.tenantID, dto.clientId, round2(dto.amount), dto.reason ?? null, user.userID],
    );

    return this.clientLedger(user.tenantID, dto.clientId);
  }

  /**
   * Delete a single ledger entry (admin correction) and return the refreshed
   * summary for the affected client.
   */
  async remove(tenantID: string, id: string) {
    const { rows } = await this.pool.query(
      'DELETE FROM client_debts WHERE id = $1 AND tenant_id = $2 RETURNING client_id',
      [id, tenantID],
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Запись не найдена' });
    return this.clientLedger(tenantID, rows[0].client_id as string);
  }
}
