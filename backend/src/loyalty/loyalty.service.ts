import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../database.module';
import { isTenantLess } from '../common/auth-cache';
import { JwtPayload } from '../common/decorators/current-user.decorator';
import { UpdateLoyaltySettingsDto } from './dto/update-loyalty-settings.dto';
import { AccrueBonusDto } from './dto/accrue-bonus.dto';
import { RedeemBonusDto } from './dto/redeem-bonus.dto';
import { AdjustBonusDto } from './dto/adjust-bonus.dto';

/** Parse a NUMERIC/text money value to a JS number (NULL/garbage → 0). */
function num(v: unknown): number {
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

/** Round to 2 decimals — money is stored NUMERIC(14,2); avoids float drift. */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export interface ResolvedSettings {
  enabled: boolean;
  accrualPercent: number;
  redeemMaxPercent: number;
  updatedAt: string | null;
}

/**
 * Программа лояльности / бонусы / кешбэк — a single-sided bonus ledger per
 * client plus a per-tenant config row.
 *
 * Every ledger row is one explicit movement:
 *   • type='accrual'    — бонус начислен (cashback on a paid check, manual credit).
 *   • type='redemption' — бонус списан (paid part of a sale, manual debit).
 *
 * Per-client balance = Σaccrual − Σredemption and is NEVER allowed to go
 * negative: a redemption that would overdraw is rejected (400) before insert.
 *
 * This service OWNS `loyalty_settings` and `client_bonuses`. It READS `clients`
 * (tenant guard + names) and READS `checks` read-only (total for auto-amount and
 * per-check redeem cap, check_id validation). It NEVER writes to `checks` or any
 * other module's table — accrual/redemption are EXPLICIT actions the cash UI
 * invokes, not a side effect of creating/updating a check.
 */
@Injectable()
export class LoyaltyService {
  constructor(@Inject(PG_POOL) private pool: Pool) {}

  // ─── Row mapping ───────────────────────────────────────────────────────
  private mapEntry(r: any) {
    return {
      id: r.id as string,
      tenantId: r.tenant_id as string,
      clientId: r.client_id as string,
      amount: num(r.amount),
      type: r.type as 'accrual' | 'redemption',
      reason: r.reason ?? null,
      checkId: r.check_id ?? null,
      checkNumber: r.check_number ?? null,
      createdBy: r.created_by ?? null,
      createdByName: r.created_by_name ?? null,
      createdAt: r.created_at as string,
    };
  }

  private mapSettings(r: any): ResolvedSettings {
    return {
      enabled: !!r.enabled,
      accrualPercent: num(r.accrual_percent),
      redeemMaxPercent: num(r.redeem_max_percent),
      updatedAt: r.updated_at ?? null,
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

  /**
   * Assert the check exists in this tenant; return its total. Used for the
   * auto-accrual basis and the per-check redeem cap. Read-only.
   */
  private async requireCheckTotal(tenantID: string, checkId: string): Promise<number> {
    const { rows } = await this.pool.query(
      'SELECT total_revenue FROM checks WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL',
      [checkId, tenantID],
    );
    if (rows.length === 0) throw new BadRequestException({ message: 'Чек не найден' });
    return num(rows[0].total_revenue);
  }

  /**
   * Σaccrual − Σredemption for one client (never below 0 by construction). Runs on
   * the supplied executor — pass a transaction connection (PoolClient) so the read
   * sits inside the same transaction + row lock as the debit it guards.
   */
  private async balanceOf(executor: Pool | PoolClient, tenantID: string, clientId: string): Promise<number> {
    const { rows } = await executor.query(
      `SELECT COALESCE(SUM(CASE WHEN type = 'accrual' THEN amount ELSE -amount END), 0) AS balance
         FROM client_bonuses WHERE tenant_id = $1 AND client_id = $2`,
      [tenantID, clientId],
    );
    return round2(num(rows[0].balance));
  }

  /**
   * Overdraw-safe debit. Locks the client's row (FOR UPDATE), re-reads the balance
   * ON THE SAME connection — so it reflects every committed redemption a concurrent
   * debit we waited on already wrote — rejects if it would push the balance below
   * zero, then inserts the redemption. All in ONE transaction, so two concurrent
   * debits serialize on the client row instead of racing read-then-write to a
   * negative balance. Tenant-scoped throughout.
   */
  private async redeemGuarded(
    tenantID: string,
    clientId: string,
    amount: number,
    reason: string | null,
    checkId: string | null,
    createdBy: string,
  ): Promise<void> {
    const conn = await this.pool.connect();
    try {
      await conn.query('BEGIN');
      const locked = await conn.query('SELECT id FROM clients WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [
        clientId,
        tenantID,
      ]);
      if (locked.rows.length === 0) {
        throw new NotFoundException({ message: 'Клиент не найден' });
      }
      const balance = await this.balanceOf(conn, tenantID, clientId);
      if (amount > balance) {
        throw new BadRequestException({ message: 'Недостаточно бонусов для списания' });
      }
      await conn.query(
        `INSERT INTO client_bonuses (tenant_id, client_id, amount, type, reason, check_id, created_by)
         VALUES ($1, $2, $3, 'redemption', $4, $5, $6)`,
        [tenantID, clientId, amount, reason, checkId, createdBy],
      );
      await conn.query('COMMIT');
    } catch (err) {
      await conn.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      conn.release();
    }
  }

  // ─── Settings ──────────────────────────────────────────────────────────

  /** Upsert-on-read: create the default row the first time, then return it. */
  async getSettings(tenantID: string): Promise<ResolvedSettings> {
    // Tenant-less caller (superadmin, nil-UUID sentinel): return the column
    // defaults WITHOUT seeding — the upsert-on-read below would FK-violate
    // loyalty_settings_tenant_id_fkey (no such tenant) → 500 on GET
    // /loyalty/settings. Shape mirrors a fresh row (redeem_max_percent DEFAULT 50).
    if (isTenantLess(tenantID)) {
      return { enabled: false, accrualPercent: 0, redeemMaxPercent: 50, updatedAt: null };
    }
    await this.pool.query('INSERT INTO loyalty_settings (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING', [
      tenantID,
    ]);
    const { rows } = await this.pool.query('SELECT * FROM loyalty_settings WHERE tenant_id = $1', [tenantID]);
    return this.mapSettings(rows[0]);
  }

  /** Partial update of the tenant's loyalty config (owner-class, gated in controller). */
  async updateSettings(tenantID: string, dto: UpdateLoyaltySettingsDto): Promise<ResolvedSettings> {
    // Ensure the row exists so the UPDATE below always hits.
    await this.pool.query('INSERT INTO loyalty_settings (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING', [
      tenantID,
    ]);

    const sets: string[] = [];
    const vals: any[] = [];
    let idx = 1;

    if (dto.enabled !== undefined) {
      sets.push(`enabled = $${idx++}`);
      vals.push(dto.enabled);
    }
    if (dto.accrualPercent !== undefined) {
      sets.push(`accrual_percent = $${idx++}`);
      vals.push(round2(dto.accrualPercent));
    }
    if (dto.redeemMaxPercent !== undefined) {
      sets.push(`redeem_max_percent = $${idx++}`);
      vals.push(round2(dto.redeemMaxPercent));
    }

    if (sets.length === 0) return this.getSettings(tenantID);

    sets.push(`updated_at = now()`);
    vals.push(tenantID);
    const { rows } = await this.pool.query(
      `UPDATE loyalty_settings SET ${sets.join(', ')} WHERE tenant_id = $${idx} RETURNING *`,
      vals,
    );
    return this.mapSettings(rows[0]);
  }

  // ─── Reads ─────────────────────────────────────────────────────────────

  /** Per-client bonus summary: balance + full ledger (newest-first). */
  async clientSummary(tenantID: string, clientId: string) {
    const client = await this.requireClient(tenantID, clientId);
    const settings = await this.getSettings(tenantID);

    const { rows: ledgerRows } = await this.pool.query(
      `SELECT cb.*, u.full_name AS created_by_name, ch.number AS check_number
         FROM client_bonuses cb
         LEFT JOIN users u ON u.id = cb.created_by AND u.tenant_id = cb.tenant_id
         LEFT JOIN checks ch ON ch.id = cb.check_id AND ch.tenant_id = cb.tenant_id
        WHERE cb.tenant_id = $1 AND cb.client_id = $2
        ORDER BY cb.created_at DESC, cb.id DESC`,
      [tenantID, clientId],
    );

    let totalAccrued = 0;
    let totalRedeemed = 0;
    for (const r of ledgerRows) {
      if (r.type === 'accrual') totalAccrued += num(r.amount);
      else totalRedeemed += num(r.amount);
    }

    return {
      clientId,
      clientName: client.name,
      clientPhone: client.phone,
      enabled: settings.enabled,
      balance: round2(totalAccrued - totalRedeemed),
      totalAccrued: round2(totalAccrued),
      totalRedeemed: round2(totalRedeemed),
      ledger: ledgerRows.map((r) => this.mapEntry(r)),
    };
  }

  // ─── Mutations ─────────────────────────────────────────────────────────

  /**
   * Credit bonus. If `amount` is omitted and `checkId` is given, the amount is
   * computed as round(checkTotal * accrualPercent / 100). No-op (returns the
   * unchanged summary) when the computed amount rounds to 0. 422 when loyalty is
   * disabled for the tenant.
   */
  async accrue(user: JwtPayload, dto: AccrueBonusDto) {
    await this.requireClient(user.tenantID, dto.clientId);
    const settings = await this.getSettings(user.tenantID);

    if (!settings.enabled) {
      throw new UnprocessableEntityException({ message: 'Программа лояльности отключена' });
    }

    let checkId: string | null = null;
    let checkTotal = 0;
    if (dto.checkId) {
      checkTotal = await this.requireCheckTotal(user.tenantID, dto.checkId);
      checkId = dto.checkId;

      // Idempotency: at most ONE cashback accrual per заказ-наряд. A repeated call
      // (UI retry, double-tap, re-close of the same check) is a no-op that returns
      // the unchanged summary — never a second credit. The partial UNIQUE index from
      // migration 090 enforces this even under a race; the INSERT below also carries
      // ON CONFLICT DO NOTHING so a duplicate is a no-op, not a 500.
      const existing = await this.pool.query(
        `SELECT 1 FROM client_bonuses
          WHERE tenant_id = $1 AND check_id = $2 AND type = 'accrual' LIMIT 1`,
        [user.tenantID, checkId],
      );
      if (existing.rows.length > 0) {
        return this.clientSummary(user.tenantID, dto.clientId);
      }
    }

    let amount: number;
    let reason: string | null = null;
    if (dto.amount !== undefined) {
      amount = round2(dto.amount);
    } else if (dto.checkId) {
      amount = round2((checkTotal * settings.accrualPercent) / 100);
      reason = `Кешбэк ${settings.accrualPercent}% за заказ-наряд`;
    } else {
      throw new BadRequestException({ message: 'Укажите сумму или чек для начисления' });
    }

    // Auto-computed amounts can round to 0 (0% accrual / tiny check) — that is a
    // legitimate no-op, not an error. The amount>0 CHECK constraint would reject
    // a 0 insert, so we short-circuit and return the unchanged summary.
    if (amount <= 0) {
      return this.clientSummary(user.tenantID, dto.clientId);
    }

    // ON CONFLICT closes the last race window: if a concurrent accrual for the same
    // check committed between the pre-check above and here, the partial UNIQUE index
    // (migration 090) makes this a silent no-op instead of a duplicate credit / 500.
    await this.pool.query(
      `INSERT INTO client_bonuses (tenant_id, client_id, amount, type, reason, check_id, created_by)
       VALUES ($1, $2, $3, 'accrual', $4, $5, $6)
       ON CONFLICT (tenant_id, check_id) WHERE type = 'accrual' AND check_id IS NOT NULL DO NOTHING`,
      [user.tenantID, dto.clientId, amount, reason, checkId, user.userID],
    );

    return this.clientSummary(user.tenantID, dto.clientId);
  }

  /**
   * Spend bonus. Rejected (400) if `amount` exceeds the available balance, or —
   * when `checkId` is given — exceeds the per-check cap (checkTotal *
   * redeemMaxPercent / 100). Redemption is allowed even while loyalty is
   * disabled so a client can always spend an already-accrued balance.
   */
  async redeem(user: JwtPayload, dto: RedeemBonusDto) {
    await this.requireClient(user.tenantID, dto.clientId);
    const settings = await this.getSettings(user.tenantID);

    const amount = round2(dto.amount);

    // Per-check redeem cap is a read-only pre-check (does not touch the balance).
    let checkId: string | null = null;
    let reason: string | null = null;
    if (dto.checkId) {
      const checkTotal = await this.requireCheckTotal(user.tenantID, dto.checkId);
      const cap = round2((checkTotal * settings.redeemMaxPercent) / 100);
      if (amount > cap) {
        throw new BadRequestException({
          message: `Бонусами можно оплатить не более ${settings.redeemMaxPercent}% чека (${cap})`,
        });
      }
      checkId = dto.checkId;
      reason = 'Оплата бонусами';
    }

    // Balance-check + insert run atomically under the client row lock so two
    // concurrent redemptions can't both pass the check and overdraw to negative.
    await this.redeemGuarded(user.tenantID, dto.clientId, amount, reason, checkId, user.userID);

    return this.clientSummary(user.tenantID, dto.clientId);
  }

  /**
   * Owner-class manual correction. `type='accrual'` credits; `type='redemption'`
   * debits and is rejected (400) if it would overdraw the balance. Returns the
   * refreshed per-client summary.
   */
  async adjust(user: JwtPayload, dto: AdjustBonusDto) {
    await this.requireClient(user.tenantID, dto.clientId);
    const amount = round2(dto.amount);

    if (dto.type === 'redemption') {
      // Same overdraw-safe path as redeem: lock the client, re-check the balance,
      // insert — atomically — so a manual debit can never drive the balance negative.
      await this.redeemGuarded(user.tenantID, dto.clientId, amount, dto.reason, null, user.userID);
    } else {
      await this.pool.query(
        `INSERT INTO client_bonuses (tenant_id, client_id, amount, type, reason, created_by)
         VALUES ($1, $2, $3, 'accrual', $4, $5)`,
        [user.tenantID, dto.clientId, amount, dto.reason, user.userID],
      );
    }

    return this.clientSummary(user.tenantID, dto.clientId);
  }
}
