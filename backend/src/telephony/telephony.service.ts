import { Inject, Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';
import { PushService } from '../push/push.service';
import { UpdateTelephonySettingsDto } from './dto/update-telephony-settings.dto';
import { getTelephonyProvider, TelephonyCallEvent, TelephonyProviderConfig, TelephonyProviderName } from './providers';

/** Internal, secret-bearing config row. NEVER returned to a client as-is. */
interface RawConfig {
  provider: TelephonyProviderName;
  enabled: boolean;
  apiKey: string | null;
  apiSalt: string | null;
  updatedAt: string | null;
}

@Injectable()
export class TelephonyService {
  private readonly logger = new Logger('TelephonyService');

  constructor(
    @Inject(PG_POOL) private pool: Pool,
    private readonly push: PushService,
  ) {}

  // ─── Config ──────────────────────────────────────────────────────────────

  /** Load the raw (secret-bearing) config, or sane defaults when no row exists. */
  private async loadConfig(tenantId: string): Promise<RawConfig> {
    const { rows } = await this.pool.query(
      `SELECT provider, enabled, api_key, api_salt, updated_at
         FROM telephony_integrations WHERE tenant_id = $1`,
      [tenantId],
    );
    if (rows.length === 0) {
      return { provider: 'mango', enabled: false, apiKey: null, apiSalt: null, updatedAt: null };
    }
    const r = rows[0];
    return {
      provider: (r.provider as TelephonyProviderName) ?? 'mango',
      enabled: r.enabled === true,
      apiKey: r.api_key ?? null,
      apiSalt: r.api_salt ?? null,
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
  private maskedSettings(cfg: RawConfig) {
    return {
      provider: cfg.provider,
      enabled: cfg.enabled,
      apiKeyMask: this.mask(cfg.apiKey),
      hasApiKey: !!cfg.apiKey,
      apiSaltMask: this.mask(cfg.apiSalt),
      hasApiSalt: !!cfg.apiSalt,
      updatedAt: cfg.updatedAt,
    };
  }

  async getSettings(tenantId: string) {
    return this.maskedSettings(await this.loadConfig(tenantId));
  }

  async updateSettings(tenantId: string, dto: UpdateTelephonySettingsDto) {
    // Ensure a config row exists (all columns have DB defaults), then UPDATE only
    // the columns the caller actually sent — keeps SET placeholders aligned with
    // their values (a single ON CONFLICT upsert can't express "touch only provided
    // columns" without misaligning $-params).
    await this.pool.query(
      `INSERT INTO telephony_integrations (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING`,
      [tenantId],
    );

    const sets: string[] = [];
    const vals: unknown[] = [];
    let idx = 1;

    if (dto.provider !== undefined) {
      sets.push(`provider = $${idx++}`);
      vals.push(dto.provider);
    }
    if (dto.enabled !== undefined) {
      sets.push(`enabled = $${idx++}`);
      vals.push(dto.enabled);
    }
    // Secrets are overwritten ONLY when a non-empty string is sent, so re-saving the
    // form (which shows a mask, not the real key) never wipes an existing secret.
    const newKey = typeof dto.apiKey === 'string' ? dto.apiKey.trim() : '';
    if (newKey) {
      sets.push(`api_key = $${idx++}`);
      vals.push(newKey);
    }
    const newSalt = typeof dto.apiSalt === 'string' ? dto.apiSalt.trim() : '';
    if (newSalt) {
      sets.push(`api_salt = $${idx++}`);
      vals.push(newSalt);
    }

    sets.push(`updated_at = now()`);
    vals.push(tenantId);

    await this.pool.query(`UPDATE telephony_integrations SET ${sets.join(', ')} WHERE tenant_id = $${idx}`, vals);

    return this.getSettings(tenantId);
  }

  // ─── Webhook ───────────────────────────────────────────────────────────────

  /**
   * Process an inbound Mango callback for `tenantId`. NEVER throws to the caller —
   * the controller must answer 200 fast so Mango stops retrying. The body is NOT
   * trusted until its signature verifies against the tenant's stored salt.
   */
  async handleWebhook(tenantId: string, body: unknown): Promise<void> {
    try {
      const cfg = await this.loadConfig(tenantId);
      // Inert until configured: no keys / disabled ⇒ nothing to do.
      if (!cfg.enabled || !cfg.apiKey || !cfg.apiSalt) return;

      const provider = getTelephonyProvider(cfg.provider);
      const providerCfg: TelephonyProviderConfig = {
        provider: cfg.provider,
        apiKey: cfg.apiKey,
        apiSalt: cfg.apiSalt,
      };

      // 1) Verify the signature BEFORE trusting anything in the body.
      if (!provider.verifySignature(providerCfg, body)) {
        // No secrets in the log — just that a callback failed verification.
        this.logger.warn(`Telephony webhook signature mismatch for tenant ${tenantId}`);
        return;
      }

      // 2) Normalize.
      const event = provider.parseEvent(body);
      if (!event || event.kind === 'ignore') return;

      if (event.kind === 'ringing') {
        await this.onRinging(tenantId, event);
      } else if (event.kind === 'summary') {
        await this.onSummary(tenantId, event);
      } else if (event.kind === 'recording') {
        await this.onRecording(tenantId, event);
      }
    } catch (err) {
      // Best-effort. Log without ever touching secrets, never rethrow.
      this.logger.warn(`Telephony webhook failed for tenant ${tenantId}: ${err instanceof Error ? err.message : err}`);
    }
  }

  /** A call started ringing → persist a 'ringing' row; on inbound, push staff. */
  private async onRinging(tenantId: string, event: TelephonyCallEvent): Promise<void> {
    const match = await this.matchClient(tenantId, event.clientNumber);

    // Upsert the call row. A duplicate 'Appeared' for the same call_id keeps the
    // existing status (never downgrades an already answered/missed row).
    await this.pool.query(
      `INSERT INTO calls
         (tenant_id, provider, provider_call_id, direction, from_number, to_number,
          client_phone, client_id, status, started_at)
       VALUES ($1, 'mango', $2, $3, $4, $5, $6, $7, 'ringing', now())
       ON CONFLICT (tenant_id, provider_call_id) DO UPDATE SET
         direction   = EXCLUDED.direction,
         from_number = EXCLUDED.from_number,
         to_number   = EXCLUDED.to_number,
         client_phone = EXCLUDED.client_phone,
         client_id   = COALESCE(calls.client_id, EXCLUDED.client_id),
         updated_at  = now()`,
      [
        tenantId,
        event.callId,
        event.direction,
        event.fromNumber || null,
        event.toNumber || null,
        event.clientNumber || null,
        match?.id ?? null,
      ],
    );

    // Only inbound calls are a customer-facing alert worth a banner.
    if (event.direction !== 'inbound') return;

    const who = match?.fullName?.trim() || this.prettyPhone(event.clientNumber);
    await this.notifyStaff(tenantId, 'Входящий звонок', `Входящий звонок: ${who}`, {
      type: 'incoming_call',
      callId: event.callId,
      phone: event.clientNumber,
      clientId: match?.id ?? null,
    });
  }

  /** A call ended → set answered/missed + duration; push a missed-call alert. */
  private async onSummary(tenantId: string, event: TelephonyCallEvent): Promise<void> {
    const match = await this.matchClient(tenantId, event.clientNumber);
    const status = event.answered ? 'answered' : 'missed';

    // Upsert: if we never saw the 'ringing' event (e.g. only the summary callback
    // is subscribed), this still records the call. COALESCE keeps an already-known
    // client / recording reference.
    await this.pool.query(
      `INSERT INTO calls
         (tenant_id, provider, provider_call_id, direction, from_number, to_number,
          client_phone, client_id, status, answered, duration, ended_at)
       VALUES ($1, 'mango', $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
       ON CONFLICT (tenant_id, provider_call_id) DO UPDATE SET
         status     = EXCLUDED.status,
         answered   = EXCLUDED.answered,
         duration   = EXCLUDED.duration,
         direction  = EXCLUDED.direction,
         client_id  = COALESCE(calls.client_id, EXCLUDED.client_id),
         ended_at   = now(),
         updated_at = now()`,
      [
        tenantId,
        event.callId,
        event.direction,
        event.fromNumber || null,
        event.toNumber || null,
        event.clientNumber || null,
        match?.id ?? null,
        status,
        !!event.answered,
        Math.max(0, Math.round(event.duration ?? 0)),
      ],
    );

    // A MISSED inbound call is the actionable follow-up: it surfaces in the calls
    // list as "не перезвонили" (computed in CallsService), and we push staff so
    // someone calls back. We deliberately do NOT auto-create a booking — a booking
    // needs a real scheduled_at (a fake appointment time) and defaults to SMSing
    // the client (notify_on_create); the missed-call row + push is the correct,
    // side-effect-free follow-up primitive here.
    if (event.direction === 'inbound' && status === 'missed') {
      const who = match?.fullName?.trim() || this.prettyPhone(event.clientNumber);
      await this.notifyStaff(tenantId, 'Пропущенный звонок', `Пропущенный звонок: ${who}`, {
        type: 'missed_call',
        callId: event.callId,
        phone: event.clientNumber,
        clientId: match?.id ?? null,
      });
    }
  }

  /** A recording became available → attach its provider reference to the call. */
  private async onRecording(tenantId: string, event: TelephonyCallEvent): Promise<void> {
    if (!event.recordingRef) return;
    await this.pool.query(
      `UPDATE calls SET recording_url = $3, updated_at = now()
         WHERE tenant_id = $1 AND provider_call_id = $2`,
      [tenantId, event.callId, event.recordingRef],
    );
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  /**
   * Match a client by phone, tenant-scoped, normalized to the last 10 digits — the
   * same normalization the МоиЗвонки matcher uses (strip spaces/dashes/+/parens).
   */
  private async matchClient(tenantId: string, clientNumber: string): Promise<{ id: string; fullName: string } | null> {
    const digits = (clientNumber || '').replace(/\D/g, '');
    if (digits.length < 6) return null;
    const last10 = digits.length >= 10 ? digits.slice(-10) : digits;
    const { rows } = await this.pool.query(
      `SELECT id, full_name
         FROM clients
        WHERE tenant_id = $1
          AND right(translate(phone, E' \\t\\n\\r-+()', ''), 10) = $2
        LIMIT 1`,
      [tenantId, last10],
    );
    if (rows.length === 0) return null;
    return { id: rows[0].id, fullName: rows[0].full_name };
  }

  /**
   * Fan a VISIBLE push out to the tenant's front-desk staff (director / admin /
   * master who are active). Reuses PushService.sendToUser (always-deliver) — an
   * incoming call is time-sensitive. Best-effort: push failure never propagates.
   */
  private async notifyStaff(
    tenantId: string,
    title: string,
    bodyText: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const { rows } = await this.pool.query(
      `SELECT id FROM users
        WHERE tenant_id = $1
          AND role IN ('director', 'admin', 'master')
          AND is_active = true
          AND dismissed_at IS NULL`,
      [tenantId],
    );
    await Promise.all(rows.map((r: { id: string }) => this.push.sendToUser(r.id, title, bodyText, data)));
  }

  /** Format a digit string as a readable +7 phone for the push body. */
  private prettyPhone(num: string): string {
    const d = (num || '').replace(/\D/g, '');
    if (d.length === 11 && (d[0] === '7' || d[0] === '8')) {
      return `+7 ${d.slice(1, 4)} ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9)}`;
    }
    if (d.length === 10) {
      return `+7 ${d.slice(0, 3)} ${d.slice(3, 6)}-${d.slice(6, 8)}-${d.slice(8)}`;
    }
    return num || 'неизвестный номер';
  }
}
