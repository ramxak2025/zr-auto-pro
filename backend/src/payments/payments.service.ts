import { Inject, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { PG_POOL } from '../database.module';
import { JwtPayload } from '../common/decorators/current-user.decorator';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { UpdatePaymentSettingsDto } from './dto/update-payment-settings.dto';
import { getProvider, PaymentProviderConfig, PaymentProviderName, PaymentStatus } from './providers';

/** Internal, secret-bearing config row. NEVER returned to a client as-is. */
interface RawConfig {
  provider: PaymentProviderName;
  enabled: boolean;
  shopId: string | null;
  secretKey: string | null;
  updatedAt: string | null;
}

function num(v: unknown): number {
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger('PaymentsService');

  constructor(@Inject(PG_POOL) private pool: Pool) {}

  // ─── Config ──────────────────────────────────────────────────────────────

  /** Load the raw (secret-bearing) config, or sane defaults when no row exists. */
  private async loadConfig(tenantId: string): Promise<RawConfig> {
    const { rows } = await this.pool.query(
      `SELECT provider, enabled, shop_id, secret_key, updated_at
         FROM payment_integrations WHERE tenant_id = $1`,
      [tenantId],
    );
    if (rows.length === 0) {
      return { provider: 'yookassa', enabled: false, shopId: null, secretKey: null, updatedAt: null };
    }
    const r = rows[0];
    return {
      provider: (r.provider as PaymentProviderName) ?? 'yookassa',
      enabled: r.enabled === true,
      shopId: r.shop_id ?? null,
      secretKey: r.secret_key ?? null,
      updatedAt: r.updated_at ?? null,
    };
  }

  /** Mask a stored secret to '••••1234' (last 4). Never reveals the full key. */
  private mask(secret: string | null): string | null {
    if (!secret) return null;
    const tail = secret.length >= 4 ? secret.slice(-4) : secret;
    return `••••${tail}`;
  }

  /** Public (masked) settings shape returned to owner-class clients. */
  private maskedSettings(cfg: RawConfig) {
    return {
      provider: cfg.provider,
      enabled: cfg.enabled,
      shopId: cfg.shopId,
      secretKeyMask: this.mask(cfg.secretKey),
      hasSecretKey: !!cfg.secretKey,
      updatedAt: cfg.updatedAt,
    };
  }

  async getSettings(tenantId: string) {
    return this.maskedSettings(await this.loadConfig(tenantId));
  }

  async updateSettings(tenantId: string, dto: UpdatePaymentSettingsDto) {
    // Ensure a config row exists (all columns have DB defaults), then UPDATE only
    // the columns the caller actually sent. Two steps keeps the SET placeholders
    // perfectly aligned with their values — a single ON CONFLICT upsert can't
    // express "touch only provided columns" without misaligning $-params.
    await this.pool.query(
      `INSERT INTO payment_integrations (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING`,
      [tenantId],
    );

    const sets: string[] = [];
    const vals: any[] = [];
    let idx = 1;

    if (dto.provider !== undefined) {
      sets.push(`provider = $${idx++}`);
      vals.push(dto.provider);
    }
    if (dto.enabled !== undefined) {
      sets.push(`enabled = $${idx++}`);
      vals.push(dto.enabled);
    }
    if (dto.shopId !== undefined) {
      sets.push(`shop_id = $${idx++}`);
      vals.push(dto.shopId.trim() || null);
    }
    // The secret is overwritten ONLY when a non-empty string is sent, so re-saving
    // the form (which shows a mask, not the real key) never wipes an existing key.
    const newSecret = typeof dto.secretKey === 'string' ? dto.secretKey.trim() : '';
    if (newSecret) {
      sets.push(`secret_key = $${idx++}`);
      vals.push(newSecret);
    }

    sets.push(`updated_at = now()`);
    vals.push(tenantId);

    await this.pool.query(`UPDATE payment_integrations SET ${sets.join(', ')} WHERE tenant_id = $${idx}`, vals);

    return this.getSettings(tenantId);
  }

  // ─── Ledger mapping ────────────────────────────────────────────────────────

  private mapPayment(r: any) {
    return {
      id: r.id,
      tenantId: r.tenant_id,
      provider: r.provider,
      providerPaymentId: r.provider_payment_id ?? null,
      amount: num(r.amount),
      currency: r.currency,
      description: r.description ?? null,
      method: r.method ?? null,
      status: r.status as PaymentStatus,
      confirmationUrl: r.confirmation_url ?? null,
      checkId: r.check_id ?? null,
      createdBy: r.created_by ?? null,
      createdAt: r.created_at,
      paidAt: r.paid_at ?? null,
    };
  }

  // ─── Create ──────────────────────────────────────────────────────────────

  async create(user: JwtPayload, dto: CreatePaymentDto) {
    const cfg = await this.loadConfig(user.tenantID);

    // Inert until configured: a clear 422 instead of a silent no-charge.
    if (!cfg.enabled) {
      throw new UnprocessableEntityException({
        message: 'Приём онлайн-оплат отключён. Включите эквайринг в настройках.',
      });
    }
    if (!cfg.shopId || !cfg.secretKey) {
      throw new UnprocessableEntityException({
        message: 'Эквайринг не настроен: добавьте shopId и секретный ключ в настройках.',
      });
    }

    const provider = getProvider(cfg.provider);
    const providerCfg: PaymentProviderConfig = {
      provider: cfg.provider,
      shopId: cfg.shopId,
      secretKey: cfg.secretKey,
    };

    const amount = Math.round((dto.amount + Number.EPSILON) * 100) / 100;
    const description = dto.description?.trim() || 'Оплата услуг автосервиса';

    // The provider call may throw a clean 502 (network / acquirer error). We do
    // NOT persist a ledger row unless the acquirer accepted the payment, so a
    // failed create leaves no dangling 'pending'.
    const result = await provider.createPayment(providerCfg, {
      amount,
      currency: 'RUB',
      description,
      method: dto.method,
      returnUrl: dto.returnUrl,
      idempotenceKey: randomUUID(),
    });

    const { rows } = await this.pool.query(
      `INSERT INTO payments
         (tenant_id, provider, provider_payment_id, amount, currency, description,
          method, status, confirmation_url, check_id, created_by)
       VALUES ($1,$2,$3,$4,'RUB',$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        user.tenantID,
        cfg.provider,
        result.providerPaymentId || null,
        amount,
        description,
        dto.method ?? null,
        result.status,
        result.confirmationUrl ?? null,
        dto.checkId ?? null,
        user.userID,
      ],
    );

    const payment = this.mapPayment(rows[0]);
    // `qr` is ephemeral (SBP QR payload) — returned now, not persisted.
    return { ...payment, qr: result.qr ?? null };
  }

  // ─── Read / poll ───────────────────────────────────────────────────────────

  async getById(tenantId: string, id: string) {
    const { rows } = await this.pool.query(`SELECT * FROM payments WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
    if (rows.length === 0) throw new NotFoundException({ message: 'Платёж не найден' });
    let row = rows[0];

    // Active reconciliation for polling: while still pending, re-read the
    // authoritative status from the provider so the cash screen sees 'succeeded'
    // even when the public webhook can't reach this server (e.g. local/dev).
    if (row.status === 'pending' && row.provider_payment_id) {
      const refreshed = await this.reconcileFromProvider(tenantId, row);
      if (refreshed) row = refreshed;
    }

    return this.mapPayment(row);
  }

  // ─── Webhook ───────────────────────────────────────────────────────────────

  /**
   * Process an inbound provider webhook for `tenantId`. NEVER throws to the
   * caller — the controller must answer 200 fast so the acquirer stops retrying.
   * The webhook body is NOT authoritative: we look up our ledger row, re-verify
   * against the provider, and reconcile the amount before changing status.
   */
  async handleWebhook(tenantId: string, body: unknown, headers: Record<string, unknown>): Promise<void> {
    try {
      const cfg = await this.loadConfig(tenantId);
      if (!cfg.shopId || !cfg.secretKey) return; // not configured → nothing to do

      const provider = getProvider(cfg.provider);
      const providerCfg: PaymentProviderConfig = {
        provider: cfg.provider,
        shopId: cfg.shopId,
        secretKey: cfg.secretKey,
      };

      let parsed: { providerPaymentId: string; status: PaymentStatus; amount?: number };
      try {
        parsed = provider.parseWebhook(providerCfg, body, headers);
      } catch {
        return; // unrecognizable body → swallow, 200 no-op
      }

      const { rows } = await this.pool.query(
        `SELECT * FROM payments WHERE provider_payment_id = $1 AND tenant_id = $2`,
        [parsed.providerPaymentId, tenantId],
      );
      if (rows.length === 0) return; // unknown payment → ignore
      const row = rows[0];

      await this.reconcileFromProvider(tenantId, row, parsed.status);
    } catch (err) {
      // Best-effort. Log without ever touching secrets, never rethrow.
      this.logger.warn(`Webhook reconcile failed for tenant ${tenantId}: ${err instanceof Error ? err.message : err}`);
    }
  }

  /**
   * Re-read the payment from the provider (source of truth) and move a PENDING
   * ledger row forward. Returns the updated row, or null when nothing changed.
   *
   * `webhookStatus` is an optional fallback used only if the provider re-read is
   * unavailable. Amount is reconciled against the STORED amount before a payment
   * is ever marked 'succeeded' — the webhook/provider amount is never trusted on
   * its own to credit money.
   */
  private async reconcileFromProvider(tenantId: string, row: any, webhookStatus?: PaymentStatus): Promise<any | null> {
    // Terminal already — never downgrade succeeded/canceled.
    if (row.status !== 'pending') return null;

    const cfg = await this.loadConfig(tenantId);
    if (!cfg.shopId || !cfg.secretKey || !row.provider_payment_id) return null;
    const provider = getProvider(cfg.provider);
    const providerCfg: PaymentProviderConfig = {
      provider: cfg.provider,
      shopId: cfg.shopId,
      secretKey: cfg.secretKey,
    };

    let status: PaymentStatus | undefined;
    let providerAmount: number | undefined;
    // Did we get an AUTHORITATIVE, authenticated read from the provider? Only such a
    // read may ever flip a payment to 'succeeded' — the webhook body is NEVER trusted
    // to credit money on its own.
    let providerRead = false;

    if (provider.getPayment) {
      try {
        const fresh = await provider.getPayment(providerCfg, row.provider_payment_id);
        status = fresh.status;
        providerAmount = fresh.amount;
        providerRead = true;
      } catch {
        // Authoritative re-read failed → do NOT fall back to the untrusted webhook
        // status to mark money received. Leave the row 'pending'; the next poll
        // (GET /payments/:id) reconciles once the provider is reachable again.
        return null;
      }
    } else {
      // Provider exposes no authoritative read API. The webhook may still move the
      // row to a non-crediting terminal state (canceled) below, but never to
      // 'succeeded' — that path requires providerRead.
      status = webhookStatus;
    }

    if (!status || status === 'pending') return null;

    if (status === 'succeeded') {
      // Credit money ONLY on a successful, authenticated provider read whose amount
      // reconciles with what we charged. No provider read (or no provider amount) ⇒
      // never marked paid — defends against a forged webhook and against marking
      // succeeded on an unverifiable amount.
      if (!providerRead || providerAmount === undefined) return null;
      const stored = num(row.amount);
      if (Math.abs(providerAmount - stored) >= 0.01) {
        this.logger.warn(
          `Amount mismatch for payment ${row.id}: stored ${stored} vs provider ${providerAmount} — not marking paid`,
        );
        return null;
      }
      const { rows } = await this.pool.query(
        `UPDATE payments SET status = 'succeeded', paid_at = now()
           WHERE id = $1 AND status = 'pending' RETURNING *`,
        [row.id],
      );
      return rows[0] ?? null;
    }

    if (status === 'canceled') {
      const { rows } = await this.pool.query(
        `UPDATE payments SET status = 'canceled'
           WHERE id = $1 AND status = 'pending' RETURNING *`,
        [row.id],
      );
      return rows[0] ?? null;
    }

    return null;
  }
}
