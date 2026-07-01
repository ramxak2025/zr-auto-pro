import { Inject, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';
import { JwtPayload } from '../common/decorators/current-user.decorator';
import { UpdateFiscalSettingsDto } from './dto/update-fiscal-settings.dto';
import { FiscalizeDto } from './dto/fiscalize.dto';
import {
  FiscalProviderConfig,
  FiscalProviderName,
  FiscalReceiptInput,
  FiscalReceiptItem,
  FiscalReceiptPayment,
  FiscalStatus,
  getFiscalProvider,
} from './providers';

/** Internal, secret-bearing config row. NEVER returned to a client as-is. */
interface RawFiscalConfig {
  provider: FiscalProviderName;
  enabled: boolean;
  login: string | null;
  password: string | null;
  groupCode: string | null;
  sno: string | null;
  inn: string | null;
  paymentAddress: string | null;
  companyEmail: string | null;
  vat: string;
  updatedAt: string | null;
}

function num(v: unknown): number {
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

@Injectable()
export class FiscalService {
  private readonly logger = new Logger('FiscalService');

  constructor(@Inject(PG_POOL) private pool: Pool) {}

  // ─── Config ──────────────────────────────────────────────────────────────

  /** Load the raw (secret-bearing) config, or sane defaults when no row exists. */
  private async loadConfig(tenantId: string): Promise<RawFiscalConfig> {
    const { rows } = await this.pool.query(
      `SELECT provider, enabled, login, password, group_code, sno, inn,
              payment_address, company_email, vat, updated_at
         FROM fiscal_integrations WHERE tenant_id = $1`,
      [tenantId],
    );
    if (rows.length === 0) {
      return {
        provider: 'atol',
        enabled: false,
        login: null,
        password: null,
        groupCode: null,
        sno: null,
        inn: null,
        paymentAddress: null,
        companyEmail: null,
        vat: 'none',
        updatedAt: null,
      };
    }
    const r = rows[0];
    return {
      provider: (r.provider as FiscalProviderName) ?? 'atol',
      enabled: r.enabled === true,
      login: r.login ?? null,
      password: r.password ?? null,
      groupCode: r.group_code ?? null,
      sno: r.sno ?? null,
      inn: r.inn ?? null,
      paymentAddress: r.payment_address ?? null,
      companyEmail: r.company_email ?? null,
      vat: r.vat ?? 'none',
      updatedAt: r.updated_at ?? null,
    };
  }

  /** Mask a stored secret to '••••1234' (last 4). Never reveals the full value. */
  private mask(secret: string | null): string | null {
    if (!secret) return null;
    const tail = secret.length >= 4 ? secret.slice(-4) : secret;
    return `••••${tail}`;
  }

  /** Public (masked) settings shape returned to owner-class clients. */
  private maskedSettings(cfg: RawFiscalConfig) {
    return {
      provider: cfg.provider,
      enabled: cfg.enabled,
      login: cfg.login,
      passwordMask: this.mask(cfg.password),
      hasPassword: !!cfg.password,
      groupCode: cfg.groupCode,
      sno: cfg.sno,
      inn: cfg.inn,
      paymentAddress: cfg.paymentAddress,
      companyEmail: cfg.companyEmail,
      vat: cfg.vat,
      updatedAt: cfg.updatedAt,
    };
  }

  async getSettings(tenantId: string) {
    return this.maskedSettings(await this.loadConfig(tenantId));
  }

  async updateSettings(tenantId: string, dto: UpdateFiscalSettingsDto) {
    // Ensure a config row exists (all columns have DB defaults), then UPDATE only
    // the columns the caller actually sent. Two steps keeps the SET placeholders
    // perfectly aligned with their values (mirrors the payments settings path).
    await this.pool.query(
      `INSERT INTO fiscal_integrations (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING`,
      [tenantId],
    );

    const sets: string[] = [];
    const vals: any[] = [];
    let idx = 1;

    const pushTrimmed = (col: string, value: string | undefined) => {
      if (value !== undefined) {
        sets.push(`${col} = $${idx++}`);
        vals.push(value.trim() || null);
      }
    };

    if (dto.provider !== undefined) {
      sets.push(`provider = $${idx++}`);
      vals.push(dto.provider);
    }
    if (dto.enabled !== undefined) {
      sets.push(`enabled = $${idx++}`);
      vals.push(dto.enabled);
    }
    pushTrimmed('login', dto.login);
    pushTrimmed('group_code', dto.groupCode);
    pushTrimmed('sno', dto.sno);
    pushTrimmed('inn', dto.inn);
    pushTrimmed('payment_address', dto.paymentAddress);
    pushTrimmed('company_email', dto.companyEmail);
    if (dto.vat !== undefined) {
      sets.push(`vat = $${idx++}`);
      vals.push(dto.vat);
    }
    // The password is overwritten ONLY when a non-empty string is sent, so
    // re-saving the form (which shows a mask, not the real value) never wipes it.
    const newPassword = typeof dto.password === 'string' ? dto.password.trim() : '';
    if (newPassword) {
      sets.push(`password = $${idx++}`);
      vals.push(newPassword);
    }

    sets.push(`updated_at = now()`);
    vals.push(tenantId);

    await this.pool.query(`UPDATE fiscal_integrations SET ${sets.join(', ')} WHERE tenant_id = $${idx}`, vals);

    return this.getSettings(tenantId);
  }

  // ─── Ledger mapping ────────────────────────────────────────────────────────

  private mapReceipt(r: any) {
    return {
      id: r.id,
      tenantId: r.tenant_id,
      provider: r.provider as FiscalProviderName,
      checkId: r.check_id ?? null,
      externalId: r.external_id,
      providerUuid: r.provider_uuid ?? null,
      status: r.status as FiscalStatus,
      fiscalDocNumber: r.fiscal_doc_number ?? null,
      fiscalSign: r.fiscal_sign ?? null,
      ofdReceiptUrl: r.ofd_receipt_url ?? null,
      error: r.error ?? null,
      createdAt: r.created_at,
      doneAt: r.done_at ?? null,
    };
  }

  // ─── Receipt building (read-only over checks) ────────────────────────────────

  /**
   * Read the tenant-scoped check + its lines and build a normalized, discount-
   * reconciled receipt. PURELY READS `checks` / `check_*_lines` — never writes.
   *
   * Discount handling: each line's gross total (price × qty) is scaled by
   * total_revenue / grossTotal so the receipt total equals what the client
   * actually owes (net of the check-level discount). A final rounding residual is
   * folded into the last item so Σ items.sum == total exactly — АТОЛ rejects a
   * receipt whose item sums / payments don't reconcile to the total.
   */
  private async buildReceipt(tenantId: string, dto: FiscalizeDto): Promise<FiscalReceiptInput> {
    const { rows: checkRows } = await this.pool.query(
      `SELECT ch.*, cl.phone AS client_phone
         FROM checks ch
         LEFT JOIN clients cl ON cl.id = ch.client_id AND cl.tenant_id = ch.tenant_id
        WHERE ch.id = $1 AND ch.tenant_id = $2 AND ch.deleted_at IS NULL`,
      [dto.checkId, tenantId],
    );
    if (checkRows.length === 0) {
      throw new NotFoundException({ message: 'Заказ-наряд не найден' });
    }
    const check = checkRows[0];

    if (check.is_deferred === true) {
      throw new UnprocessableEntityException({
        message: 'Нельзя фискализировать отложенный (незакрытый) заказ-наряд',
      });
    }

    const { rows: svcRows } = await this.pool.query(
      `SELECT name, price, quantity, total FROM check_service_lines WHERE check_id = $1`,
      [dto.checkId],
    );
    const { rows: prodRows } = await this.pool.query(
      `SELECT name, sell_price, quantity, total_sell FROM check_product_lines WHERE check_id = $1`,
      [dto.checkId],
    );

    // Gross lines (pre-discount), keeping the kind so we set payment_object right.
    const gross: Array<{
      name: string;
      price: number;
      quantity: number;
      lineTotal: number;
      obj: 'service' | 'commodity';
    }> = [];
    for (const s of svcRows) {
      const qty = num(s.quantity) || 1;
      const price = num(s.price);
      gross.push({
        name: s.name || 'Услуга',
        price,
        quantity: qty,
        lineTotal: num(s.total) || price * qty,
        obj: 'service',
      });
    }
    for (const p of prodRows) {
      const qty = num(p.quantity) || 1;
      const price = num(p.sell_price);
      gross.push({
        name: p.name || 'Товар',
        price,
        quantity: qty,
        lineTotal: num(p.total_sell) || price * qty,
        obj: 'commodity',
      });
    }

    if (gross.length === 0) {
      throw new UnprocessableEntityException({ message: 'В чеке нет позиций для фискализации' });
    }

    const grossTotal = round2(gross.reduce((acc, it) => acc + it.lineTotal, 0));
    const targetTotal = round2(num(check.total_revenue));
    const effectiveTotal = targetTotal > 0 ? targetTotal : grossTotal;
    if (effectiveTotal <= 0) {
      throw new UnprocessableEntityException({ message: 'Сумма чека равна нулю — нечего фискализировать' });
    }
    // Scale gross lines down to the net total when a discount applies.
    const factor = grossTotal > 0 ? effectiveTotal / grossTotal : 1;

    const items: FiscalReceiptItem[] = gross.map((it) => {
      const sum = round2(it.lineTotal * factor);
      const qty = it.quantity > 0 ? it.quantity : 1;
      return { name: it.name, price: round2(sum / qty), quantity: qty, sum, paymentObject: it.obj };
    });
    // Fold the rounding residual into the last item so Σ items.sum == effectiveTotal.
    const itemsSum = round2(items.reduce((acc, it) => acc + it.sum, 0));
    const residual = round2(effectiveTotal - itemsSum);
    if (residual !== 0 && items.length > 0) {
      const last = items[items.length - 1];
      last.sum = round2(last.sum + residual);
      last.price = round2(last.sum / last.quantity);
    }
    const total = round2(items.reduce((acc, it) => acc + it.sum, 0));

    // Tender split: keep Σ payments.sum == total. For cash_card use the check's
    // cash/card amounts clamped to the total; cash → all cash; everything else
    // (card / warranty / default) → electronic.
    const payments: FiscalReceiptPayment[] = [];
    const method = String(check.payment_method || 'cash');
    if (method === 'cash') {
      payments.push({ type: 'cash', sum: total });
    } else if (method === 'cash_card') {
      const cash = round2(Math.min(num(check.cash_amount), total));
      const card = round2(total - cash);
      if (cash > 0) payments.push({ type: 'cash', sum: cash });
      if (card > 0) payments.push({ type: 'electronic', sum: card });
      if (payments.length === 0) payments.push({ type: 'electronic', sum: total });
    } else {
      payments.push({ type: 'electronic', sum: total });
    }

    // 54-ФЗ requires a delivery target for the electronic receipt: client email or
    // phone. Prefer the explicitly-supplied contact, fall back to the check's
    // client phone. Without either, refuse with a clear 422.
    const email = dto.email?.trim() || null;
    const phone = dto.phone?.trim() || (check.client_phone ? String(check.client_phone) : null);
    if (!email && !phone) {
      throw new UnprocessableEntityException({
        message: 'Укажите email или телефон клиента для отправки чека',
      });
    }

    return {
      // Placeholder — fiscalize() overwrites this with the ledger row's own id once
      // the attempt is persisted, so external_id is a stable, deterministic
      // idempotence key for that attempt (АТОЛ dedups a retried /sell on it).
      externalId: '',
      email,
      phone,
      items,
      payments,
      total,
    };
  }

  private toProviderConfig(cfg: RawFiscalConfig): FiscalProviderConfig {
    // Caller guarantees login/password/groupCode are present before calling.
    return {
      provider: cfg.provider,
      login: cfg.login as string,
      password: cfg.password as string,
      groupCode: cfg.groupCode as string,
      sno: cfg.sno,
      inn: cfg.inn,
      paymentAddress: cfg.paymentAddress,
      companyEmail: cfg.companyEmail,
      vat: cfg.vat || 'none',
    };
  }

  // ─── Fiscalize ──────────────────────────────────────────────────────────────

  async fiscalize(user: JwtPayload, dto: FiscalizeDto) {
    const cfg = await this.loadConfig(user.tenantID);

    // ── Idempotency: ONE 54-ФЗ receipt per заказ-наряд ─────────────────────────
    // АТОЛ registers a legal fiscal document on every accepted /sell, so a check
    // must NEVER be sent twice. We serialize the look-up-and-create per check with a
    // tenant-scoped advisory lock (xact-scoped — auto-released on COMMIT/ROLLBACK)
    // so a double-tap / concurrent retry can't slip two attempts past the guard. The
    // slow operator call is made AFTER the lock is released (we never hold a DB lock
    // across the network round-trip).
    let receiptRow!: any;
    let receipt!: FiscalReceiptInput;
    const lockClient = await this.pool.connect();
    try {
      await lockClient.query('BEGIN');
      await lockClient.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`fiscal:${user.tenantID}:${dto.checkId}`]);

      const { rows: priorRows } = await lockClient.query(
        `SELECT * FROM fiscal_receipts
          WHERE tenant_id = $1 AND check_id = $2
          ORDER BY created_at DESC LIMIT 1`,
        [user.tenantID, dto.checkId],
      );
      const last = priorRows[0];

      // Already fiscalized → return the existing receipt, NEVER re-send to АТОЛ.
      if (last && last.status === 'done') {
        await lockClient.query('COMMIT');
        return this.mapReceipt(last);
      }
      // In flight → re-sync from the operator (poll-based, no webhook) instead of
      // creating a duplicate attempt.
      if (last && last.status === 'pending') {
        await lockClient.query('COMMIT');
        const refreshed = last.provider_uuid ? await this.reconcile(user.tenantID, last) : null;
        return this.mapReceipt(refreshed ?? last);
      }

      // No attempt yet, or the latest one FAILED → create a fresh attempt. The
      // config + receipt validation runs INSIDE the lock so the insert below is
      // atomic with the look-up (the row is what a concurrent caller then sees as
      // 'pending'). buildReceipt validates the check exists before we insert, so a
      // bad request never leaves a dangling ledger row / FK violation.
      if (!cfg.enabled) {
        throw new UnprocessableEntityException({
          message: 'Фискализация отключена. Включите онлайн-кассу в настройках.',
        });
      }
      if (!cfg.login || !cfg.password || !cfg.groupCode) {
        throw new UnprocessableEntityException({
          message: 'Касса не настроена: укажите login, пароль и group_code АТОЛ в настройках.',
        });
      }

      receipt = await this.buildReceipt(user.tenantID, dto);

      // Record the attempt in the ledger BEFORE the operator call so a failed
      // fiscalization is durably auditable (status='failed' + error), not lost.
      const { rows: insertRows } = await lockClient.query(
        `INSERT INTO fiscal_receipts (tenant_id, provider, check_id, external_id, status)
         VALUES ($1, $2, $3, gen_random_uuid()::text, 'pending') RETURNING *`,
        [user.tenantID, cfg.provider, dto.checkId],
      );
      // external_id = the ledger row's own id → a retried /sell of THIS attempt
      // dedups at АТОЛ, while a fresh attempt after a failure gets a new id and is
      // therefore never blocked by АТОЛ's idempotence on a previous failed one.
      const { rows: idRows } = await lockClient.query(
        `UPDATE fiscal_receipts SET external_id = id::text WHERE id = $1 RETURNING *`,
        [insertRows[0].id],
      );
      receiptRow = idRows[0];
      receipt.externalId = receiptRow.external_id;
      await lockClient.query('COMMIT');
    } catch (err) {
      await lockClient.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      lockClient.release();
    }

    const provider = getFiscalProvider(cfg.provider);
    const providerCfg = this.toProviderConfig(cfg);

    try {
      const result = await provider.fiscalize(providerCfg, receipt);
      const { rows } = await this.pool.query(
        `UPDATE fiscal_receipts SET provider_uuid = $1, status = $2
           WHERE id = $3 RETURNING *`,
        [result.providerUuid, result.status, receiptRow.id],
      );
      return this.mapReceipt(rows[0]);
    } catch (err) {
      // Operator/network failure: mark the ledger row failed (audit) and surface
      // the clean message. Never log credentials.
      const message = err instanceof Error ? err.message : 'Ошибка фискализации';
      await this.pool.query(
        `UPDATE fiscal_receipts SET status = 'failed', error = $1, done_at = now()
           WHERE id = $2`,
        [message.slice(0, 500), receiptRow.id],
      );
      this.logger.warn(`Fiscalize failed for tenant ${user.tenantID}, check ${dto.checkId}: ${message}`);
      // Re-throw the original (a BadGateway/422) so the client gets the right code.
      throw err;
    }
  }

  // ─── Read / poll ─────────────────────────────────────────────────────────────

  /**
   * Latest fiscal receipt for a check (tenant-scoped). While still 'pending' AND
   * an operator uuid exists, re-read the authoritative status from the operator
   * and persist any transition — so the UI sees 'done' even though АТОЛ is
   * poll-based (no webhook).
   */
  async getReceiptForCheck(tenantId: string, checkId: string) {
    const { rows } = await this.pool.query(
      `SELECT * FROM fiscal_receipts
        WHERE tenant_id = $1 AND check_id = $2
        ORDER BY created_at DESC LIMIT 1`,
      [tenantId, checkId],
    );
    if (rows.length === 0) {
      throw new NotFoundException({ message: 'Чек ещё не фискализирован' });
    }
    let row = rows[0];

    if (row.status === 'pending' && row.provider_uuid) {
      const refreshed = await this.reconcile(tenantId, row);
      if (refreshed) row = refreshed;
    }

    return this.mapReceipt(row);
  }

  /**
   * Re-read a PENDING ledger row from the operator and move it forward. Returns
   * the updated row, or null when nothing changed / config is gone. Never throws
   * to the caller — a poll that can't reach the operator just keeps the row pending.
   */
  private async reconcile(tenantId: string, row: any): Promise<any | null> {
    if (row.status !== 'pending' || !row.provider_uuid) return null;
    const cfg = await this.loadConfig(tenantId);
    if (!cfg.login || !cfg.password || !cfg.groupCode) return null;

    const provider = getFiscalProvider(cfg.provider);
    const providerCfg = this.toProviderConfig(cfg);

    let result;
    try {
      result = await provider.getStatus(providerCfg, row.provider_uuid);
    } catch (err) {
      this.logger.warn(
        `Fiscal reconcile failed for tenant ${tenantId}, receipt ${row.id}: ${
          err instanceof Error ? err.message : err
        }`,
      );
      return null;
    }

    if (result.status === 'pending') return null;

    if (result.status === 'done') {
      const { rows } = await this.pool.query(
        `UPDATE fiscal_receipts
            SET status = 'done', fiscal_doc_number = $1, fiscal_sign = $2,
                ofd_receipt_url = $3, error = NULL, done_at = now()
          WHERE id = $4 AND status = 'pending' RETURNING *`,
        [result.fiscalDocNumber ?? null, result.fiscalSign ?? null, result.ofdReceiptUrl ?? null, row.id],
      );
      return rows[0] ?? null;
    }

    // failed
    const { rows } = await this.pool.query(
      `UPDATE fiscal_receipts SET status = 'failed', error = $1, done_at = now()
         WHERE id = $2 AND status = 'pending' RETURNING *`,
      [(result.error ?? 'Фискализация не выполнена').slice(0, 500), row.id],
    );
    return rows[0] ?? null;
  }
}
