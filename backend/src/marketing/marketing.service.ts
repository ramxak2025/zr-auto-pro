import {
  Injectable,
  Inject,
  BadRequestException,
  NotFoundException,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { Pool } from 'pg';
import * as crypto from 'crypto';
import { PG_POOL } from '../database.module';
import { RUN_BACKGROUND_JOBS } from '../common/run-jobs';
import { phoneSearchKey } from '../common/normalize-phone';

// ─── Messaging Provider Strategy Pattern ─────────────────────────────
interface MessagingProviderAdapter {
  sendMessage(phone: string, message: string): Promise<{ success: boolean; error?: string }>;
}

// ─── Outbound message log / anti-spam gate contract ──────────────────
export type OutboundMessageType = 'review' | 'reminder' | 'car_ready' | 'winback' | 'booking' | 'manual' | 'broadcast';

/** Why a send was refused/failed — surfaced to callers, never persisted verbatim. */
export type GuardSendReason =
  | 'no_phone'
  | 'no_provider'
  | 'error'
  | 'cooldown'
  | 'exact_duplicate'
  | 'rate_cap'
  | 'dedup_key';

export interface GuardSendResult {
  status: 'sent' | 'failed' | 'skipped_dedup';
  reason?: GuardSendReason;
  error?: string;
}

export interface GuardAndLogSendOptions {
  tenantId: string;
  phone: string;
  body: string;
  messageType: OutboundMessageType;
  /** Null for channel-level messages (e.g. Telegram → owner chat). */
  clientId?: string | null;
  /**
   * Idempotency key for auto-types (`review:<checkId>`, `car_ready:<checkId>`,
   * `installment_reminder:<planId>:<date>:<phase>`, …). When omitted a key is
   * synthesized from (type, phone, content_hash, hour bucket) so identical
   * retries within the hour collide but a legitimately-repeated message next
   * hour is allowed.
   */
  dedupKey?: string | null;
  /** Per-(client, type) cooldown in hours. 0/undefined → rely on dedupKey only. */
  cooldownHours?: number;
  /** Choose a specific connected integration; else the tenant's default active one. */
  integrationId?: string | null;
  providerType?: string | null;
  createdBy?: string | null;
  /** Pre-resolved adapter (review-job path already fetched one) — skips a lookup. */
  adapter?: MessagingProviderAdapter | null;
}

// Hard deadline for EVERY outbound provider call (audit round 7, item 7). A
// bare `fetch` has NO timeout — a hung provider (WhatsApp / Telegram / SMS.RU /
// МоиЗвонки) used to pin the request (or the review-job interval) until the
// socket died on its own. AbortSignal.timeout turns that into a normal
// rejection that flows through each adapter's existing catch → the caller gets
// the usual `{ success:false, error: '…сетевая ошибка…' }` shape.
const PROVIDER_TIMEOUT_MS = 10_000;

// ─── WhatsApp Cloud API Real Adapter ─────────────────────────────────
// Sends a plain-text message to the client phone via Meta's WhatsApp Cloud API:
//   POST https://graph.facebook.com/v19.0/{phoneNumberId}/messages
//   Authorization: Bearer {token}        (token = the integration's api_key)
//   { messaging_product:'whatsapp', to, type:'text', text:{ body } }
// Config = phoneNumberId (messaging_integrations.phone_number_id) + token
// (api_key). Inert until BOTH are set: with either missing it reports a clear
// not-configured error instead of calling the API. The Bearer token is NEVER
// logged.
class WhatsAppAdapter implements MessagingProviderAdapter {
  constructor(
    private token: string,
    private phoneNumberId: string,
  ) {}

  async sendMessage(phone: string, message: string): Promise<{ success: boolean; error?: string }> {
    if (!this.token || !this.phoneNumberId) {
      return { success: false, error: 'WhatsApp не настроен: укажите phoneNumberId и токен' };
    }
    try {
      // Cloud API wants the number in international form, digits only (no +).
      const cleanPhone = phone.replace(/[\s\-+()]/g, '');
      const url = `https://graph.facebook.com/v19.0/${encodeURIComponent(this.phoneNumberId)}/messages`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: cleanPhone,
          type: 'text',
          text: { body: message },
        }),
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      });

      const data = await response.json().catch(() => ({}));

      // Log status + phone only — NEVER the token or full request headers.
      Logger.log(`[WhatsApp → ${cleanPhone}] http=${response.status}`, 'WhatsAppAdapter');

      if (response.ok && Array.isArray(data?.messages) && data.messages.length > 0) {
        return { success: true };
      }
      const apiError = data?.error?.message || `HTTP ${response.status}`;
      return { success: false, error: `WhatsApp Cloud API: ${apiError}` };
    } catch (err: any) {
      Logger.error(`[WhatsApp] Network error: ${err.message}`, 'WhatsAppAdapter');
      return { success: false, error: `WhatsApp сетевая ошибка: ${err.message}` };
    }
  }
}

// ─── Telegram Bot API Real Adapter ───────────────────────────────────
// Sends via the Bot API: POST https://api.telegram.org/bot{token}/sendMessage.
//
// IMPORTANT LIMITATION: Telegram bots CANNOT message an arbitrary phone number —
// a user must first /start the bot, after which we'd know their numeric chat_id.
// We therefore model Telegram as an OWNER/STAFF notification channel: every send
// goes to ONE configured chat_id (the shop's owner/staff chat or group), NOT to
// the client's phone. The `phone` argument is intentionally ignored. This is the
// honest behaviour — if a tenant selects Telegram as their active provider, the
// review / win-back / car-ready messages land in the owner's chat, not the
// client's phone. Config = bot token (api_key) + telegram_chat_id. Inert until
// both are set. The bot token is NEVER logged.
class TelegramAdapter implements MessagingProviderAdapter {
  constructor(
    private botToken: string,
    private chatId: string,
  ) {}

  async sendMessage(phone: string, message: string): Promise<{ success: boolean; error?: string }> {
    if (!this.botToken || !this.chatId) {
      return { success: false, error: 'Telegram не настроен: укажите токен бота и chat_id' };
    }
    try {
      // `phone` is ignored on purpose (see class doc) — destination is chat_id.
      const response = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: this.chatId, text: message }),
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      });

      const data = await response.json().catch(() => ({}));

      // Log status only — never the bot token (it lives in the URL we don't log).
      Logger.log(`[Telegram → chat ${this.chatId}] http=${response.status}, ok=${data?.ok}`, 'TelegramAdapter');

      if (response.ok && data?.ok === true) {
        return { success: true };
      }
      return { success: false, error: `Telegram: ${data?.description || `HTTP ${response.status}`}` };
    } catch (err: any) {
      Logger.error(`[Telegram] Network error: ${err.message}`, 'TelegramAdapter');
      return { success: false, error: `Telegram сетевая ошибка: ${err.message}` };
    }
  }
}

// ─── SMS.RU Real Adapter ─────────────────────────────────────────────
class SmsRuAdapter implements MessagingProviderAdapter {
  constructor(
    private apiId: string,
    private senderName: string,
  ) {}

  async sendMessage(phone: string, message: string): Promise<{ success: boolean; error?: string }> {
    try {
      // Normalize phone: remove +, spaces, dashes
      const cleanPhone = phone.replace(/[\s\-\+\(\)]/g, '');

      const params = new URLSearchParams({
        api_id: this.apiId,
        to: cleanPhone,
        msg: message,
        json: '1',
      });
      if (this.senderName) {
        params.set('from', this.senderName);
      }

      const response = await fetch(`https://sms.ru/sms/send?${params.toString()}`, {
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      });
      const data = await response.json();

      Logger.log(
        `[SMS.RU → ${cleanPhone}] status=${data.status_code}, response=${JSON.stringify(data)}`,
        'SmsRuAdapter',
      );

      if (data.status === 'OK' && data.status_code === 100) {
        // Check per-number status
        const numberStatus = data.sms?.[cleanPhone];
        if (numberStatus && numberStatus.status_code === 100) {
          return { success: true };
        }
        // If number-level status not OK
        return {
          success: false,
          error: `SMS.RU: номер ${cleanPhone} — код ${numberStatus?.status_code}: ${numberStatus?.status_text || 'Ошибка'}`,
        };
      }

      return {
        success: false,
        error: `SMS.RU ошибка: код ${data.status_code} — ${data.status_text || data.status}`,
      };
    } catch (err: any) {
      Logger.error(`[SMS.RU] Network error: ${err.message}`, 'SmsRuAdapter');
      return { success: false, error: `SMS.RU сетевая ошибка: ${err.message}` };
    }
  }
}

// ─── Мои Звонки Adapter ──────────────────────────────────────────────
class MoiZvonkiAdapter implements MessagingProviderAdapter {
  constructor(
    private apiKey: string,
    private userName: string,
    private domain: string,
  ) {}

  async sendMessage(phone: string, message: string): Promise<{ success: boolean; error?: string }> {
    try {
      const cleanPhone = phone.replace(/[\s\-\+\(\)]/g, '');
      const apiUrl = `https://${this.domain}.moizvonki.ru/api/v1`;

      const body = JSON.stringify({
        user_name: this.userName,
        api_key: this.apiKey,
        action: 'calls.send_sms',
        to: cleanPhone,
        text: message,
      });

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      });

      const data = await response.json();

      Logger.log(
        `[МоиЗвонки → ${cleanPhone}] status=${response.status}, response=${JSON.stringify(data)}`,
        'MoiZvonkiAdapter',
      );

      if (response.ok) {
        return { success: true };
      }

      return {
        success: false,
        error: `МоиЗвонки ошибка: ${data.message || data.error || JSON.stringify(data)}`,
      };
    } catch (err: any) {
      Logger.error(`[МоиЗвонки] Network error: ${err.message}`, 'MoiZvonkiAdapter');
      return { success: false, error: `МоиЗвонки сетевая ошибка: ${err.message}` };
    }
  }
}

class SmsGenericAdapter implements MessagingProviderAdapter {
  constructor(
    private apiKey: string,
    private senderName: string,
  ) {}
  async sendMessage(phone: string, message: string) {
    Logger.log(`[SMS → ${phone}] ${message.substring(0, 60)}...`, 'SmsGenericAdapter');
    return { success: true };
  }
}

class EmailAdapter implements MessagingProviderAdapter {
  constructor(
    private apiKey: string,
    private senderName: string,
  ) {}
  async sendMessage(phone: string, message: string) {
    Logger.log(`[Email → ${phone}] ${message.substring(0, 60)}...`, 'EmailAdapter');
    return { success: true };
  }
}

// ─── Service ─────────────────────────────────────────────────────────
@Injectable()
export class MarketingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('MarketingService');
  private jobInterval: ReturnType<typeof setInterval> | null = null;
  private scanInterval: ReturnType<typeof setInterval> | null = null;

  constructor(@Inject(PG_POOL) private pool: Pool) {}

  onModuleInit() {
    if (!RUN_BACKGROUND_JOBS) {
      this.logger.log('Review job processor disabled on this replica (RUN_BACKGROUND_JOBS=false)');
      return;
    }
    // Process review jobs every 60 seconds
    this.jobInterval = setInterval(() => this.processReviewJobs(), 60_000);
    // Also scan for new completed checks every 5 minutes
    this.scanInterval = setInterval(() => this.scanCompletedChecks(), 300_000);
    this.logger.log('Review job processor started');
  }

  onModuleDestroy() {
    if (this.jobInterval) clearInterval(this.jobInterval);
    if (this.scanInterval) clearInterval(this.scanInterval);
  }

  // ─── Messaging Provider Factory ──────────────────────────────────
  private createAdapter(row: any): MessagingProviderAdapter {
    switch (row.provider_type) {
      case 'whatsapp':
        // WhatsApp Cloud API: api_key = Bearer token, phone_number_id = sender id.
        return new WhatsAppAdapter(row.api_key, row.phone_number_id || '');
      case 'telegram':
        // Telegram Bot API: api_key = bot token, telegram_chat_id = target chat
        // (owner/staff notifications — see TelegramAdapter doc for the limitation).
        return new TelegramAdapter(row.api_key, row.telegram_chat_id || '');
      case 'smsru':
        return new SmsRuAdapter(row.api_key, row.sender_name || '');
      case 'moizvonki':
        return new MoiZvonkiAdapter(row.api_key, row.sender_name || '', row.webhook_url || '');
      case 'sms':
        return new SmsGenericAdapter(row.api_key, row.sender_name || '');
      case 'email':
        return new EmailAdapter(row.api_key, row.sender_name || '');
      default:
        return new SmsGenericAdapter(row.api_key, row.sender_name || '');
    }
  }

  private async getAdapter(tenantId: string): Promise<MessagingProviderAdapter | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM messaging_integrations WHERE tenant_id=$1 AND is_active=true ORDER BY created_at LIMIT 1`,
      [tenantId],
    );
    return rows.length > 0 ? this.createAdapter(rows[0]) : null;
  }

  /**
   * Resolve the messaging_integrations ROW for a send: an explicit integration,
   * else the first active integration of a requested provider type, else the
   * tenant's default (oldest active) integration. Returns null when nothing
   * matches → callers treat as `no_provider` (never throws).
   */
  private async getAdapterRowFor(
    tenantId: string,
    opts: { integrationId?: string | null; providerType?: string | null },
  ): Promise<any | null> {
    if (opts.integrationId) {
      const { rows } = await this.pool.query(
        `SELECT * FROM messaging_integrations WHERE id=$1 AND tenant_id=$2 AND is_active=true LIMIT 1`,
        [opts.integrationId, tenantId],
      );
      return rows[0] ?? null;
    }
    if (opts.providerType) {
      const { rows } = await this.pool.query(
        `SELECT * FROM messaging_integrations
          WHERE tenant_id=$1 AND provider_type=$2 AND is_active=true ORDER BY created_at LIMIT 1`,
        [tenantId, opts.providerType],
      );
      return rows[0] ?? null;
    }
    const { rows } = await this.pool.query(
      `SELECT * FROM messaging_integrations WHERE tenant_id=$1 AND is_active=true ORDER BY created_at LIMIT 1`,
      [tenantId],
    );
    return rows[0] ?? null;
  }

  // ─── Anti-spam / no-duplicate gate (sent_messages, migration 124) ─────
  // Owner's hard rule: «НЕ ДУБЛИРОВАТЬ SMS и НЕ СПАМИТЬ клиентов». Every
  // outbound client message flows through guardAndLogSend, which refuses a send
  // that would be a duplicate and logs every real attempt. Values below are the
  // documented judgement calls — one-line constants, easy for the owner to tune.

  /** Global ceiling: max messages to ONE client per rolling 24h, across ALL types. */
  private static readonly PER_CLIENT_24H_CAP = 3;
  /** Exact-duplicate window: same phone + identical body inside this many hours → skip. */
  private static readonly EXACT_DUP_WINDOW_HOURS = 1;

  private contentHash(body: string): string {
    return crypto
      .createHash('sha1')
      .update(body ?? '', 'utf8')
      .digest('hex');
  }

  /** UTC hour bucket (YYYYMMDDHH) folded into synthesized dedup keys. */
  private hourStamp(d = new Date()): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}`;
  }

  /**
   * THE single anti-spam gate. Order matters:
   *   0. no phone → fail (never charge for an empty number).
   *   1. resolve the channel FIRST — no provider → fail WITHOUT logging (so we
   *      don't burn a dedup_key before we can ever send; preserves the existing
   *      "stop on no_provider" behaviour of win-back / reminders).
   *   2. soft ceilings (best-effort SELECTs): per-(client,type) cooldown →
   *      exact-duplicate (phone+content within EXACT_DUP_WINDOW_HOURS) →
   *      per-client 24h cap. Any hit → skipped_dedup (counted, NOT logged as a
   *      row: a skip must not occupy a dedup_key).
   *   3. CLAIM the dedup_key by inserting the log row (status='sent') with
   *      ON CONFLICT (tenant_id, dedup_key) DO NOTHING. Empty RETURNING = another
   *      send already claimed this exact key (concurrent retry / prior send) →
   *      skipped_dedup, WITHOUT sending. This is the race-safe, money-exact
   *      "one SMS exactly once" guarantee (TenantAwarePool runs each query in its
   *      own tx, so a unique index — not FOR UPDATE — is the correct primitive).
   *   4. send; on provider failure downgrade the row to status='failed'.
   *
   * Judgement call: a failed send keeps its 'failed' row, so a retry with the
   * SAME explicit dedup_key is blocked (bias to never-double-send over always-
   * retry — the owner pays per SMS). Synthesized keys fold an hour bucket, so a
   * genuine next-hour retry is allowed.
   */
  async guardAndLogSend(opts: GuardAndLogSendOptions): Promise<GuardSendResult> {
    const phoneRaw = (opts.phone || '').trim();
    const phoneKey = phoneSearchKey(phoneRaw);
    if (!phoneKey) return { status: 'failed', reason: 'no_phone' };

    const body = opts.body ?? '';
    const hash = this.contentHash(body);
    const { tenantId, messageType } = opts;
    const clientId = opts.clientId ?? null;
    const cooldownHours = opts.cooldownHours && opts.cooldownHours > 0 ? opts.cooldownHours : 0;

    // 1. Resolve channel first (no key burned on a missing provider).
    const providerRow = opts.adapter ? null : await this.getAdapterRowFor(tenantId, opts);
    const adapter = opts.adapter ?? (providerRow ? this.createAdapter(providerRow) : null);
    if (!adapter) return { status: 'failed', reason: 'no_provider' };
    const providerType = opts.providerType ?? providerRow?.provider_type ?? null;

    // 2a. Per-(client, type) cooldown.
    if (clientId && cooldownHours > 0) {
      const { rows } = await this.pool.query(
        `SELECT 1 FROM sent_messages
          WHERE tenant_id=$1 AND client_id=$2 AND message_type=$3 AND status='sent'
            AND sent_at > now() - ($4 * interval '1 hour') LIMIT 1`,
        [tenantId, clientId, messageType, cooldownHours],
      );
      if (rows.length > 0) return { status: 'skipped_dedup', reason: 'cooldown' };
    }

    // 2b. Exact-duplicate: identical body to the same phone within the window.
    {
      const { rows } = await this.pool.query(
        `SELECT 1 FROM sent_messages
          WHERE tenant_id=$1 AND phone=$2 AND content_hash=$3 AND status='sent'
            AND sent_at > now() - ($4 * interval '1 hour') LIMIT 1`,
        [tenantId, phoneKey, hash, MarketingService.EXACT_DUP_WINDOW_HOURS],
      );
      if (rows.length > 0) return { status: 'skipped_dedup', reason: 'exact_duplicate' };
    }

    // 2c. Global per-client 24h cap (all types).
    if (clientId) {
      const { rows } = await this.pool.query(
        `SELECT count(*)::int AS n FROM sent_messages
          WHERE tenant_id=$1 AND client_id=$2 AND status='sent'
            AND sent_at > now() - interval '24 hours'`,
        [tenantId, clientId],
      );
      if ((rows[0]?.n ?? 0) >= MarketingService.PER_CLIENT_24H_CAP) {
        return { status: 'skipped_dedup', reason: 'rate_cap' };
      }
    }

    // 3. Claim the dedup_key + write the log row atomically.
    const dedupKey =
      opts.dedupKey && opts.dedupKey.trim()
        ? opts.dedupKey.trim()
        : `${messageType}:${phoneKey}:${hash}:${this.hourStamp()}`;
    const claim = await this.pool.query(
      `INSERT INTO sent_messages
         (tenant_id, client_id, message_type, provider_type, phone, content_hash, status, dedup_key, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,'sent',$7,$8)
       ON CONFLICT (tenant_id, dedup_key) DO NOTHING
       RETURNING id`,
      [tenantId, clientId, messageType, providerType, phoneKey, hash, dedupKey, opts.createdBy ?? null],
    );
    if (claim.rows.length === 0) return { status: 'skipped_dedup', reason: 'dedup_key' };
    const logId = claim.rows[0].id;

    // 4. Send; downgrade the row on failure.
    try {
      const result = await adapter.sendMessage(phoneRaw, body);
      if (result.success) return { status: 'sent' };
      await this.pool
        .query(`UPDATE sent_messages SET status='failed', error=$2 WHERE id=$1`, [
          logId,
          (result.error ?? 'send failed').slice(0, 500),
        ])
        .catch(() => undefined);
      return { status: 'failed', reason: 'error', error: result.error };
    } catch (err: any) {
      await this.pool
        .query(`UPDATE sent_messages SET status='failed', error=$2 WHERE id=$1`, [
          logId,
          String(err?.message ?? err).slice(0, 500),
        ])
        .catch(() => undefined);
      return { status: 'failed', reason: 'error', error: err?.message || String(err) };
    }
  }

  /**
   * Public messaging reuse point for other modules (e.g. Bookings). Sends a
   * one-off message to a client phone using the tenant's configured messaging
   * provider (the same `messaging_integrations` adapter the review/reminder
   * flows use). When no provider is configured it returns
   * `{ sent: false, reason: 'no_provider' }` so callers can skip silently —
   * it never throws on a missing provider.
   *
   * `sent: true` means the adapter reported success; `sent: false` with
   * `reason: 'error'` means a provider exists but the send failed (network /
   * provider error) — the caller decides whether to retry.
   */
  async sendClientMessage(
    tenantId: string,
    phone: string,
    message: string,
    opts?: {
      clientId?: string | null;
      messageType?: OutboundMessageType;
      dedupKey?: string | null;
      cooldownHours?: number;
      integrationId?: string | null;
      providerType?: string | null;
      createdBy?: string | null;
    },
  ): Promise<{ sent: boolean; reason?: 'no_provider' | 'no_phone' | 'error'; error?: string }> {
    // Now routed through the anti-spam gate (guardAndLogSend). Existing 3-arg
    // callers keep the old `{ sent, reason }` contract; the gate still applies
    // exact-duplicate + (when a clientId/type is passed) cooldown + 24h cap.
    const r = await this.guardAndLogSend({
      tenantId,
      phone,
      body: message,
      messageType: opts?.messageType ?? 'manual',
      clientId: opts?.clientId ?? null,
      dedupKey: opts?.dedupKey ?? null,
      cooldownHours: opts?.cooldownHours ?? 0,
      integrationId: opts?.integrationId ?? null,
      providerType: opts?.providerType ?? null,
      createdBy: opts?.createdBy ?? null,
    });
    if (r.status === 'sent') return { sent: true };
    if (r.reason === 'no_phone') return { sent: false, reason: 'no_phone' };
    if (r.reason === 'no_provider') return { sent: false, reason: 'no_provider' };
    // skipped_dedup or provider error → not sent; surface as a benign 'error'
    // so best-effort callers (bookings) just log-and-move-on, never retry-loop.
    return { sent: false, reason: 'error', error: r.error ?? r.reason };
  }

  // ─── «Машина готова» (car-ready) auto-notification ───────────────
  // Per-tenant settings (car_ready_settings, migration 087): a master switch +
  // a message template with {number}/{car}/{clientName} placeholders. Disabled
  // by default → fully inert until the owner turns it on.

  private static readonly CAR_READY_DEFAULT_TEMPLATE =
    'Здравствуйте! Ваш автомобиль {car} готов. Заказ-наряд №{number}. Будем рады видеть вас!';

  async getCarReadySettings(tenantId: string): Promise<{ enabled: boolean; messageTemplate: string }> {
    const { rows } = await this.pool.query(
      `SELECT enabled, message_template FROM car_ready_settings WHERE tenant_id=$1`,
      [tenantId],
    );
    if (rows.length === 0) {
      // Upsert-on-read default row (mirrors getSettings / loyalty pattern).
      await this.pool.query(`INSERT INTO car_ready_settings (tenant_id) VALUES ($1) ON CONFLICT DO NOTHING`, [
        tenantId,
      ]);
      return { enabled: false, messageTemplate: MarketingService.CAR_READY_DEFAULT_TEMPLATE };
    }
    return {
      enabled: rows[0].enabled,
      messageTemplate: rows[0].message_template ?? MarketingService.CAR_READY_DEFAULT_TEMPLATE,
    };
  }

  async updateCarReadySettings(
    tenantId: string,
    dto: { enabled?: boolean; messageTemplate?: string },
  ): Promise<{ enabled: boolean; messageTemplate: string }> {
    await this.pool.query(
      `INSERT INTO car_ready_settings (tenant_id, enabled, message_template)
       VALUES ($1, COALESCE($2, false), COALESCE($3, $4))
       ON CONFLICT (tenant_id) DO UPDATE SET
         enabled=COALESCE($2, car_ready_settings.enabled),
         message_template=COALESCE($3, car_ready_settings.message_template),
         updated_at=now()`,
      [
        tenantId,
        typeof dto.enabled === 'boolean' ? dto.enabled : null,
        typeof dto.messageTemplate === 'string' ? dto.messageTemplate : null,
        MarketingService.CAR_READY_DEFAULT_TEMPLATE,
      ],
    );
    return this.getCarReadySettings(tenantId);
  }

  /**
   * Fire the «машина готова» notification for one check. Called fire-and-forget
   * by ChecksService.setWorkStatus AFTER a successful transition INTO 'ready'.
   * NEVER throws to the caller's critical path — every failure path returns a
   * `{ sent:false, reason }` shape; the caller additionally wraps it in .catch().
   *
   * Tenant-scoped: every query is filtered by tenantId, so a check / client /
   * car from another tenant can never be read or messaged. Sends nothing when
   * the feature is disabled, the check has no client, or the client has no phone.
   * Reuses the shared `sendClientMessage` adapter path — no new send logic.
   */
  async notifyCarReady(
    tenantId: string,
    checkId: string,
  ): Promise<{
    sent: boolean;
    reason?: 'disabled' | 'not_found' | 'no_phone' | 'no_provider' | 'error';
    error?: string;
  }> {
    const settings = await this.getCarReadySettings(tenantId);
    if (!settings.enabled) return { sent: false, reason: 'disabled' };

    const { rows } = await this.pool.query(
      `SELECT ch.number, ch.client_id,
              cl.full_name AS client_name, cl.phone AS client_phone,
              ca.make_model, ca.plate_number
       FROM checks ch
       LEFT JOIN clients cl ON cl.id = ch.client_id AND cl.tenant_id = ch.tenant_id
       LEFT JOIN cars ca ON ca.id = ch.car_id AND ca.tenant_id = ch.tenant_id
       WHERE ch.id=$1 AND ch.tenant_id=$2 AND ch.deleted_at IS NULL`,
      [checkId, tenantId],
    );
    if (rows.length === 0) return { sent: false, reason: 'not_found' };
    const r = rows[0];
    if (!r.client_phone || !String(r.client_phone).trim()) return { sent: false, reason: 'no_phone' };

    const carLabel = [r.make_model, r.plate_number]
      .filter((v) => v && String(v).trim())
      .join(' ')
      .trim();
    const message = (settings.messageTemplate || MarketingService.CAR_READY_DEFAULT_TEMPLATE)
      .replace(/\{number\}/g, r.number != null ? String(r.number) : '')
      .replace(/\{car\}/g, carLabel || 'автомобиль')
      .replace(/\{clientName\}/g, r.client_name || 'клиент');

    // Gate: `car_ready:<checkId>` = exactly one «машина готова» per check, ever.
    // Previously this had NO idempotency — two ready-transitions double-sent.
    const gate = await this.guardAndLogSend({
      tenantId,
      phone: r.client_phone,
      body: message,
      messageType: 'car_ready',
      clientId: r.client_id ?? null,
      dedupKey: `car_ready:${checkId}`,
    });
    if (gate.status === 'sent') return { sent: true };
    if (gate.reason === 'no_phone') return { sent: false, reason: 'no_phone' };
    if (gate.reason === 'no_provider') return { sent: false, reason: 'no_provider' };
    return { sent: false, reason: 'error', error: gate.error ?? gate.reason };
  }

  // ─── Token Generation ────────────────────────────────────────────
  private generateToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  // ─── Integrations CRUD ───────────────────────────────────────────
  /**
   * Clients (mobile IntegrationsScreen) never receive the stored api_key
   * back from getIntegrations(). When the user edits an integration without
   * re-entering the key, the app sends this sentinel meaning «keep the
   * current value». It must never be written to the database verbatim.
   */
  private static readonly KEEP_API_KEY_SENTINEL = '_existing_';

  async getIntegrations(tenantId: string) {
    // NOTE: api_key (the secret: WhatsApp Bearer token / Telegram bot token /
    // SMS api_id) is intentionally NOT selected — it never leaves the server.
    // phone_number_id and telegram_chat_id are non-secret routing config, so the
    // UI can show/edit them.
    const { rows } = await this.pool.query(
      `SELECT id, provider_type, sender_name, sender_phone, webhook_url,
              phone_number_id, telegram_chat_id, is_active, created_at
       FROM messaging_integrations WHERE tenant_id=$1 ORDER BY created_at`,
      [tenantId],
    );
    return rows.map((r) => ({
      id: r.id,
      providerType: r.provider_type,
      senderName: r.sender_name,
      senderPhone: r.sender_phone,
      webhookUrl: r.webhook_url,
      phoneNumberId: r.phone_number_id,
      chatId: r.telegram_chat_id,
      isActive: r.is_active,
      createdAt: r.created_at,
    }));
  }

  async upsertIntegration(tenantId: string, dto: any) {
    if (!dto.providerType || !dto.apiKey) {
      throw new BadRequestException({ message: 'Тип провайдера и API ключ обязательны' });
    }
    if (dto.id) {
      let apiKey = dto.apiKey;
      if (apiKey === MarketingService.KEEP_API_KEY_SENTINEL) {
        // «Оставить текущий ключ» — подставляем сохранённое значение,
        // иначе sentinel перезапишет реальный api_key.
        const { rows } = await this.pool.query(
          `SELECT api_key FROM messaging_integrations WHERE id=$1 AND tenant_id=$2`,
          [dto.id, tenantId],
        );
        if (rows.length === 0) {
          throw new BadRequestException({ message: 'Введите API-ключ' });
        }
        apiKey = rows[0].api_key;
      }
      await this.pool.query(
        `UPDATE messaging_integrations SET provider_type=$1, api_key=$2, sender_name=$3,
         sender_phone=$4, webhook_url=$5, phone_number_id=$6, telegram_chat_id=$7,
         is_active=$8, updated_at=now()
         WHERE id=$9 AND tenant_id=$10`,
        [
          dto.providerType,
          apiKey,
          dto.senderName || null,
          dto.senderPhone || null,
          dto.webhookUrl || null,
          dto.phoneNumberId || null,
          dto.chatId || null,
          dto.isActive !== false,
          dto.id,
          tenantId,
        ],
      );
    } else {
      if (dto.apiKey === MarketingService.KEEP_API_KEY_SENTINEL) {
        // Sentinel без существующей записи — «сохранять» нечего.
        throw new BadRequestException({ message: 'Введите API-ключ' });
      }
      await this.pool.query(
        `INSERT INTO messaging_integrations
           (tenant_id, provider_type, api_key, sender_name, sender_phone, webhook_url, phone_number_id, telegram_chat_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          tenantId,
          dto.providerType,
          dto.apiKey,
          dto.senderName || null,
          dto.senderPhone || null,
          dto.webhookUrl || null,
          dto.phoneNumberId || null,
          dto.chatId || null,
        ],
      );
    }
    return this.getIntegrations(tenantId);
  }

  async removeIntegration(id: string, tenantId: string) {
    await this.pool.query(`DELETE FROM messaging_integrations WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);
    return { message: 'Удалено' };
  }

  // ─── Platform Links CRUD ─────────────────────────────────────────
  async getPlatformLinks(tenantId: string) {
    const { rows } = await this.pool.query(
      `SELECT id, platform, url, is_active FROM review_platform_links WHERE tenant_id=$1 ORDER BY platform`,
      [tenantId],
    );
    return rows.map((r) => ({ id: r.id, platform: r.platform, url: r.url, isActive: r.is_active }));
  }

  async upsertPlatformLink(tenantId: string, dto: any) {
    if (!dto.platform || !dto.url) {
      throw new BadRequestException({ message: 'Платформа и ссылка обязательны' });
    }
    await this.pool.query(
      `INSERT INTO review_platform_links (tenant_id, platform, url, is_active)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (tenant_id, platform) DO UPDATE SET url=$3, is_active=$4`,
      [tenantId, dto.platform, dto.url, dto.isActive !== false],
    );
    return this.getPlatformLinks(tenantId);
  }

  async removePlatformLink(id: string, tenantId: string) {
    await this.pool.query(`DELETE FROM review_platform_links WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);
    return { message: 'Удалено' };
  }

  // ─── Review Settings ─────────────────────────────────────────────
  async getSettings(tenantId: string) {
    const { rows } = await this.pool.query(`SELECT * FROM review_settings WHERE tenant_id=$1`, [tenantId]);
    if (rows.length === 0) {
      await this.pool.query(`INSERT INTO review_settings (tenant_id) VALUES ($1) ON CONFLICT DO NOTHING`, [tenantId]);
      const { rows: newRows } = await this.pool.query(`SELECT * FROM review_settings WHERE tenant_id=$1`, [tenantId]);
      return this.mapSettings(newRows[0]);
    }
    return this.mapSettings(rows[0]);
  }

  async updateSettings(tenantId: string, dto: any) {
    // motivation_message is optional; allow empty string to clear it.
    // We treat `undefined` as "leave unchanged" and `""` as "clear".
    const motivation = typeof dto.motivationMessage === 'string' ? dto.motivationMessage : null;
    await this.pool.query(
      `INSERT INTO review_settings (tenant_id, send_time, feedback_delay_hours, auto_send_enabled, message_template, motivation_message)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, ''))
       ON CONFLICT (tenant_id) DO UPDATE SET
         send_time=COALESCE($2, review_settings.send_time),
         feedback_delay_hours=COALESCE($3, review_settings.feedback_delay_hours),
         auto_send_enabled=COALESCE($4, review_settings.auto_send_enabled),
         message_template=COALESCE($5, review_settings.message_template),
         motivation_message=COALESCE($6, review_settings.motivation_message),
         updated_at=now()`,
      [tenantId, dto.sendTime, dto.feedbackDelayHours, dto.autoSendEnabled, dto.messageTemplate, motivation],
    );
    return this.getSettings(tenantId);
  }

  private mapSettings(r: any) {
    return {
      sendTime: r.send_time,
      feedbackDelayHours: r.feedback_delay_hours,
      autoSendEnabled: r.auto_send_enabled,
      messageTemplate: r.message_template,
      motivationMessage: r.motivation_message ?? '',
    };
  }

  // ─── Public Review Flow ──────────────────────────────────────────
  async getReviewByToken(token: string) {
    const { rows } = await this.pool.query(
      `SELECT rt.*, t.name as tenant_name, cl.full_name as client_name,
              u.full_name as employee_name
       FROM review_tokens rt
       JOIN tenants t ON t.id = rt.tenant_id
       LEFT JOIN clients cl ON cl.id = rt.client_id
       LEFT JOIN users u ON u.id = rt.employee_id
       WHERE rt.token=$1`,
      [token],
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Ссылка не найдена' });
    const r = rows[0];
    if (r.used_at) throw new BadRequestException({ message: 'Отзыв уже оставлен' });
    if (new Date(r.expires_at) < new Date()) throw new BadRequestException({ message: 'Ссылка истекла' });

    const links = await this.getPlatformLinks(r.tenant_id);
    // Surface the owner's motivational message (e.g. "Замена фильтра в
    // подарок за честный отзыв") so the public landing page can render
    // it above the rating stars.
    const { rows: settingsRows } = await this.pool.query(
      `SELECT motivation_message FROM review_settings WHERE tenant_id=$1`,
      [r.tenant_id],
    );
    const motivationMessage = settingsRows[0]?.motivation_message ?? '';
    return {
      tenantName: r.tenant_name,
      clientName: r.client_name,
      employeeName: r.employee_name,
      platformLinks: links,
      motivationMessage,
    };
  }

  async submitReview(token: string, dto: { rating: number; comment?: string; redirectedTo?: string }) {
    if (!dto.rating || dto.rating < 1 || dto.rating > 5) {
      throw new BadRequestException({ message: 'Оценка должна быть от 1 до 5' });
    }

    const { rows } = await this.pool.query(`SELECT * FROM review_tokens WHERE token=$1`, [token]);
    if (rows.length === 0) throw new NotFoundException({ message: 'Ссылка не найдена' });
    const rt = rows[0];
    if (rt.used_at) throw new BadRequestException({ message: 'Отзыв уже оставлен' });
    if (new Date(rt.expires_at) < new Date()) throw new BadRequestException({ message: 'Ссылка истекла' });

    // Save review
    await this.pool.query(
      `INSERT INTO review_responses (tenant_id, check_id, client_id, employee_id, rating, comment, redirected_to)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        rt.tenant_id,
        rt.check_id,
        rt.client_id,
        rt.employee_id,
        dto.rating,
        dto.comment || null,
        dto.redirectedTo || null,
      ],
    );

    // Mark token as used
    await this.pool.query(`UPDATE review_tokens SET used_at=now() WHERE id=$1`, [rt.id]);

    // Check alerts
    await this.checkAlerts(rt.tenant_id, rt.employee_id, rt.client_id, dto.rating);

    return { success: true };
  }

  // ─── Alerts ──────────────────────────────────────────────────────
  private async checkAlerts(tenantId: string, employeeId: string | null, clientId: string | null, rating: number) {
    // 1. Consecutive negative check (3 in a row <= 3)
    if (employeeId && rating <= 3) {
      const { rows } = await this.pool.query(
        `SELECT rating FROM review_responses
         WHERE employee_id=$1 AND tenant_id=$2
         ORDER BY created_at DESC LIMIT 3`,
        [employeeId, tenantId],
      );
      if (rows.length >= 3 && rows.every((r) => r.rating <= 3)) {
        const { rows: existing } = await this.pool.query(
          `SELECT 1 FROM review_alerts WHERE employee_id=$1 AND tenant_id=$2
           AND alert_type='consecutive_negative' AND created_at > now() - interval '7 days'`,
          [employeeId, tenantId],
        );
        if (existing.length === 0) {
          await this.pool.query(
            `INSERT INTO review_alerts (tenant_id, employee_id, alert_type, details)
             VALUES ($1,$2,'consecutive_negative',$3)`,
            [tenantId, employeeId, JSON.stringify({ ratings: rows.map((r) => r.rating) })],
          );
        }
      }
    }

    // 2. Churn risk: rating <= 3 + customer has > 2 visits
    if (clientId && rating <= 3) {
      const { rows } = await this.pool.query(
        `SELECT COUNT(*) as visits FROM checks WHERE client_id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
        [clientId, tenantId],
      );
      if (parseInt(rows[0].visits) > 2) {
        await this.pool.query(
          `INSERT INTO review_alerts (tenant_id, client_id, alert_type, details)
           VALUES ($1,$2,'churn_risk',$3)`,
          [tenantId, clientId, JSON.stringify({ rating, totalVisits: rows[0].visits })],
        );
      }
    }
  }

  async getAlerts(tenantId: string) {
    const { rows } = await this.pool.query(
      `SELECT ra.*, u.full_name as employee_name, cl.full_name as client_name
       FROM review_alerts ra
       LEFT JOIN users u ON u.id = ra.employee_id
       LEFT JOIN clients cl ON cl.id = ra.client_id
       WHERE ra.tenant_id=$1 ORDER BY ra.created_at DESC LIMIT 50`,
      [tenantId],
    );
    return rows.map((r) => ({
      id: r.id,
      alertType: r.alert_type,
      employeeName: r.employee_name,
      clientName: r.client_name,
      details: r.details,
      isRead: r.is_read,
      createdAt: r.created_at,
    }));
  }

  async markAlertRead(id: string, tenantId: string) {
    await this.pool.query(`UPDATE review_alerts SET is_read=true WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);
    return { success: true };
  }

  // ─── Reviews List ────────────────────────────────────────────────
  async getReviews(tenantId: string, query: any) {
    const employeeId = query.employeeId;
    const minRating = query.minRating ? parseInt(query.minRating) : null;
    const maxRating = query.maxRating ? parseInt(query.maxRating) : null;
    const month = query.month; // format: "2026-02"

    let sql = `SELECT rr.*, u.full_name as employee_name, cl.full_name as client_name,
                       ca.make_model as car_make_model, ca.plate_number as car_plate
               FROM review_responses rr
               LEFT JOIN users u ON u.id = rr.employee_id
               LEFT JOIN clients cl ON cl.id = rr.client_id
               LEFT JOIN checks ch ON ch.id = rr.check_id
               LEFT JOIN cars ca ON ca.id = ch.car_id
               WHERE rr.tenant_id=$1`;
    const params: any[] = [tenantId];
    let idx = 2;

    if (employeeId) {
      sql += ` AND rr.employee_id=$${idx++}`;
      params.push(employeeId);
    }
    if (minRating) {
      sql += ` AND rr.rating >= $${idx++}`;
      params.push(minRating);
    }
    if (maxRating) {
      sql += ` AND rr.rating <= $${idx++}`;
      params.push(maxRating);
    }
    if (month) {
      sql += ` AND to_char(rr.created_at, 'YYYY-MM') = $${idx++}`;
      params.push(month);
    }

    sql += ` ORDER BY rr.created_at DESC LIMIT 200`;
    const { rows } = await this.pool.query(sql, params);
    return rows.map((r) => ({
      id: r.id,
      checkId: r.check_id,
      clientId: r.client_id,
      clientName: r.client_name,
      employeeName: r.employee_name,
      employeeId: r.employee_id,
      rating: r.rating,
      comment: r.comment,
      carMakeModel: r.car_make_model || null,
      carPlate: r.car_plate || null,
      redirectedTo: r.redirected_to,
      createdAt: r.created_at,
    }));
  }

  // ─── Dashboard Analytics ─────────────────────────────────────────
  async getDashboard(tenantId: string) {
    // Total reviews and avg rating
    const {
      rows: [stats],
    } = await this.pool.query(
      `SELECT COUNT(*) as total, COALESCE(AVG(rating),0) as avg_rating,
              COUNT(*) FILTER (WHERE rating <= 3) as negative,
              COUNT(*) FILTER (WHERE rating >= 4) as positive,
              COUNT(*) FILTER (WHERE redirected_to IS NOT NULL) as redirected
       FROM review_responses WHERE tenant_id=$1`,
      [tenantId],
    );

    // Total tokens sent
    const {
      rows: [tokenStats],
    } = await this.pool.query(
      `SELECT COUNT(*) as sent, COUNT(*) FILTER (WHERE used_at IS NOT NULL) as responded
       FROM review_tokens WHERE tenant_id=$1`,
      [tenantId],
    );

    // Per-employee ratings
    const { rows: employeeRatings } = await this.pool.query(
      `SELECT rr.employee_id, u.full_name as employee_name,
              COUNT(*) as review_count, AVG(rr.rating) as avg_rating,
              COUNT(*) FILTER (WHERE rr.rating <= 3) as negative_count
       FROM review_responses rr
       JOIN users u ON u.id = rr.employee_id
       WHERE rr.tenant_id=$1 AND rr.employee_id IS NOT NULL
       GROUP BY rr.employee_id, u.full_name
       ORDER BY avg_rating DESC`,
      [tenantId],
    );

    // Unread alerts count
    const {
      rows: [alertCount],
    } = await this.pool.query(`SELECT COUNT(*) as count FROM review_alerts WHERE tenant_id=$1 AND is_read=false`, [
      tenantId,
    ]);

    return {
      totalReviews: parseInt(stats.total),
      avgRating: parseFloat(parseFloat(stats.avg_rating).toFixed(1)),
      negativeReviews: parseInt(stats.negative),
      positiveReviews: parseInt(stats.positive),
      publicRedirects: parseInt(stats.redirected),
      tokensSent: parseInt(tokenStats.sent),
      tokensResponded: parseInt(tokenStats.responded),
      responseRate: tokenStats.sent > 0 ? Math.round((tokenStats.responded / tokenStats.sent) * 100) : 0,
      conversionRate:
        stats.positive > 0 && stats.redirected > 0 ? Math.round((stats.redirected / stats.positive) * 100) : 0,
      unreadAlerts: parseInt(alertCount.count),
      employeeRatings: employeeRatings.map((r) => ({
        employeeId: r.employee_id,
        employeeName: r.employee_name,
        reviewCount: parseInt(r.review_count),
        avgRating: parseFloat(parseFloat(r.avg_rating).toFixed(1)),
        negativeRate: r.review_count > 0 ? Math.round((r.negative_count / r.review_count) * 100) : 0,
      })),
    };
  }

  // ─── Win-back segment («давно не приезжал») ──────────────────────
  private static readonly WINBACK_DEFAULT_DAYS = 90;
  private static readonly WINBACK_MAX_ROWS = 500;
  /** Anti-spam: no win-back to the same client more than once per ~day. */
  private static readonly WINBACK_COOLDOWN_HOURS = 20;
  /** Manual segment broadcast recipient ceiling (money guard, mirrors win-back). */
  private static readonly BROADCAST_MAX_ROWS = 500;

  private normalizeWinbackDays(days?: number): number {
    const n = Math.floor(Number(days));
    if (!Number.isFinite(n) || n < 1) return MarketingService.WINBACK_DEFAULT_DAYS;
    return Math.min(n, 3650);
  }

  /**
   * Clients to win back: those whose most recent NON-deferred check is older
   * than `days` days, PLUS clients who never had a (non-deferred) check at all.
   * Tenant-scoped. Excludes the pinned retail buyer (053 — `is_retail`, no
   * follow-up by design) and anyone without a phone (can't message them).
   * Never-visited clients sort first (treated as the longest-absent). Row count
   * is capped so a huge tenant can't return an unbounded list.
   */
  async getWinbackSegment(
    tenantId: string,
    days?: number,
  ): Promise<Array<{ clientId: string; name: string; phone: string; lastVisit: string | null; totalChecks: number }>> {
    const n = this.normalizeWinbackDays(days);
    const { rows } = await this.pool.query(
      `SELECT cl.id, cl.full_name, cl.phone,
              MAX(ch.date) AS last_visit,
              COUNT(ch.id) AS total_checks
       FROM clients cl
       LEFT JOIN checks ch
         ON ch.client_id = cl.id
        AND ch.tenant_id = $1
        AND ch.is_deferred = false
        AND ch.deleted_at IS NULL
       WHERE cl.tenant_id = $1
         AND cl.is_retail = false
         AND cl.phone IS NOT NULL
         AND btrim(cl.phone) <> ''
       GROUP BY cl.id, cl.full_name, cl.phone
       HAVING MAX(ch.date) IS NULL
           OR MAX(ch.date) <= now() - ($2 * interval '1 day')
       ORDER BY MAX(ch.date) ASC NULLS FIRST
       LIMIT $3`,
      [tenantId, n, MarketingService.WINBACK_MAX_ROWS],
    );
    return rows.map((r) => ({
      clientId: r.id,
      name: r.full_name,
      phone: r.phone,
      lastVisit: r.last_visit ?? null,
      totalChecks: parseInt(r.total_checks, 10) || 0,
    }));
  }

  /**
   * Send `message` to every client in the win-back segment via the EXISTING
   * messaging path — `sendClientMessage`, the same tenant adapter the review /
   * reminder flows use. No new send logic: we just loop the shared single-send.
   * When the tenant has no messaging provider configured, the first send
   * reports `no_provider`; we stop early (avoids N pointless adapter lookups)
   * and return clear counts instead of throwing.
   */
  async winbackSend(
    tenantId: string,
    days: number,
    message: string,
  ): Promise<{ sent: number; failed: number; skippedDedup: number; total: number }> {
    const text = (message || '').trim();
    if (!text) throw new BadRequestException({ message: 'Сообщение не может быть пустым' });

    const segment = await this.getWinbackSegment(tenantId, days);
    const total = segment.length;
    const dayStamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    let sent = 0;
    let failed = 0;
    let skippedDedup = 0;

    for (const client of segment) {
      // Gate: `winback:<clientId>:<day>` = one win-back per client per day
      // (idempotent retries); cooldown 20h additionally blocks a same-client
      // re-blast within the day. Anti-spam: «давно не приезжал» must not spam.
      const result = await this.guardAndLogSend({
        tenantId,
        phone: client.phone,
        body: text,
        messageType: 'winback',
        clientId: client.clientId,
        dedupKey: `winback:${client.clientId}:${dayStamp}`,
        cooldownHours: MarketingService.WINBACK_COOLDOWN_HOURS,
      });
      if (result.status === 'sent') {
        sent++;
      } else if (result.status === 'skipped_dedup') {
        skippedDedup++;
      } else {
        failed++;
        // No provider configured → the same holds for every remaining client.
        // Count the rest as not-sent and stop. Clear counts, no throw.
        if (result.reason === 'no_provider') {
          failed = total - sent - skippedDedup;
          break;
        }
      }
    }

    return { sent, failed, skippedDedup, total };
  }

  // ─── Manual segment broadcast («Рассылки») ───────────────────────
  /**
   * Resolve a segment definition to a de-duplicated recipient list (clientId +
   * phone). Tenant-scoped, excludes the pinned retail buyer and phoneless
   * clients, and is HARD-capped at BROADCAST_MAX_ROWS so one call can never
   * fan out unbounded (money guard). Criteria AND-combine; reuses the same
   * "last visit older than N days OR never" shape as the win-back segment.
   */
  private async resolveSegment(
    tenantId: string,
    segment: { lastVisitDays?: number; source?: string; hasDebt?: boolean; clientIds?: string[] },
  ): Promise<Array<{ clientId: string; phone: string }>> {
    const params: unknown[] = [tenantId];
    let idx = 2;
    const where: string[] = [
      `cl.tenant_id = $1`,
      `cl.is_retail = false`,
      `cl.phone IS NOT NULL`,
      `btrim(cl.phone) <> ''`,
    ];
    const having: string[] = [];

    if (Array.isArray(segment.clientIds) && segment.clientIds.length > 0) {
      where.push(`cl.id = ANY($${idx}::uuid[])`);
      params.push(segment.clientIds);
      idx++;
    }
    if (segment.source && String(segment.source).trim()) {
      where.push(`cl.source = $${idx}`);
      params.push(String(segment.source).trim());
      idx++;
    }
    if (segment.hasDebt) {
      // «Есть долг» = положительный баланс client_debts ИЛИ открытая рассрочка с остатком.
      where.push(`(
        COALESCE((SELECT SUM(CASE WHEN d.type='charge' THEN d.amount ELSE -d.amount END)
                  FROM client_debts d WHERE d.tenant_id = $1 AND d.client_id = cl.id), 0) > 0
        OR EXISTS (SELECT 1 FROM installment_plans ip
                    WHERE ip.tenant_id = $1 AND ip.client_id = cl.id
                      AND ip.status = 'open' AND ip.remaining > 0)
      )`);
    }
    if (segment.lastVisitDays != null && Number.isFinite(Number(segment.lastVisitDays))) {
      const n = Math.max(0, Math.floor(Number(segment.lastVisitDays)));
      having.push(`(MAX(ch.date) IS NULL OR MAX(ch.date) <= now() - ($${idx} * interval '1 day'))`);
      params.push(n);
      idx++;
    }

    const sql = `
      SELECT cl.id, cl.phone
        FROM clients cl
        LEFT JOIN checks ch
          ON ch.client_id = cl.id AND ch.tenant_id = $1
         AND ch.is_deferred = false AND ch.deleted_at IS NULL
       WHERE ${where.join(' AND ')}
       GROUP BY cl.id, cl.phone
       ${having.length ? 'HAVING ' + having.join(' AND ') : ''}
       ORDER BY cl.id
       LIMIT ${MarketingService.BROADCAST_MAX_ROWS}`;
    const { rows } = await this.pool.query(sql, params);
    return rows.map((r) => ({ clientId: r.id, phone: r.phone }));
  }

  /**
   * Owner-initiated blast to a resolved segment via a chosen channel. Every
   * recipient goes through the anti-spam gate, so nobody is double-charged even
   * on a request retry: with an explicit `idempotencyKey` (or, absent one, a
   * content+hour-derived run key) the per-recipient dedup_key
   * `broadcast:<runKey>:<clientId>` collapses identical retries onto the same
   * claimed rows. Fails fast with a clear message if the chosen channel isn't
   * connected. Returns exact counts.
   */
  async sendSegmentBroadcast(
    tenantId: string,
    dto: {
      segment?: { lastVisitDays?: number; source?: string; hasDebt?: boolean; clientIds?: string[] };
      message: string;
      providerType?: string | null;
      integrationId?: string | null;
      idempotencyKey?: string | null;
    },
    createdBy?: string | null,
  ): Promise<{ sent: number; skippedDedup: number; failed: number; total: number }> {
    const text = (dto.message || '').trim();
    if (!text) throw new BadRequestException({ message: 'Сообщение не может быть пустым' });

    // Resolve the channel ONCE and fail fast if nothing is connected.
    const adapterRow = await this.getAdapterRowFor(tenantId, {
      integrationId: dto.integrationId,
      providerType: dto.providerType,
    });
    if (!adapterRow) {
      throw new BadRequestException({ message: 'Нет подключённого канала для выбранной рассылки' });
    }
    const adapter = this.createAdapter(adapterRow);
    const providerType = adapterRow.provider_type;

    const recipients = await this.resolveSegment(tenantId, dto.segment || {});
    const contentHash = this.contentHash(text);
    const runKey =
      dto.idempotencyKey && dto.idempotencyKey.trim()
        ? dto.idempotencyKey.trim()
        : `${contentHash.slice(0, 12)}:${this.hourStamp()}`;

    const seen = new Set<string>();
    let sent = 0;
    let skippedDedup = 0;
    let failed = 0;
    let total = 0;

    for (const rcpt of recipients) {
      if (seen.has(rcpt.clientId)) continue; // each client at most once per blast
      seen.add(rcpt.clientId);
      total++;
      const result = await this.guardAndLogSend({
        tenantId,
        phone: rcpt.phone,
        body: text,
        messageType: 'broadcast',
        clientId: rcpt.clientId,
        dedupKey: `broadcast:${runKey}:${rcpt.clientId}`,
        providerType,
        createdBy: createdBy ?? null,
        adapter,
      });
      if (result.status === 'sent') sent++;
      else if (result.status === 'skipped_dedup') skippedDedup++;
      else failed++;
    }

    return { sent, skippedDedup, failed, total };
  }

  // ─── Auto-mailings overview (read-only surface for the «Рассылки» UI) ─
  /**
   * Aggregate the AUTO mailing settings so the UI can list them + deep-link to
   * the existing per-type settings editors. Read-only: editing stays on the
   * dedicated endpoints referenced by `settingsRef`.
   */
  async getAutoMailings(
    tenantId: string,
  ): Promise<Array<{ type: string; enabled: boolean; summary: string; settingsRef: string }>> {
    const review = await this.getSettings(tenantId);
    const carReady = await this.getCarReadySettings(tenantId);

    const { rows: svcRows } = await this.pool.query(
      `SELECT enabled, months_interval FROM reminder_settings WHERE tenant_id=$1`,
      [tenantId],
    );
    const svc = svcRows[0] ?? { enabled: false, months_interval: null };

    const { rows: instRows } = await this.pool.query(
      `SELECT mode, days_before, on_due, on_overdue FROM installment_reminder_settings WHERE tenant_id=$1`,
      [tenantId],
    );
    const inst = instRows[0] ?? { mode: 'off', days_before: null, on_due: false, on_overdue: false };

    return [
      {
        type: 'review',
        enabled: !!review.autoSendEnabled,
        summary: review.autoSendEnabled
          ? `Запрос отзыва авто-отправкой в ${review.sendTime ?? ''}`.trim()
          : 'Запрос отзыва выключен',
        settingsRef: 'marketing/settings',
      },
      {
        type: 'car_ready',
        enabled: !!carReady.enabled,
        summary: carReady.enabled ? '«Машина готова» при переводе в статус «готов»' : '«Машина готова» выключена',
        settingsRef: 'marketing/car-ready',
      },
      {
        type: 'installment_reminder',
        enabled: inst.mode === 'auto',
        summary:
          inst.mode === 'auto'
            ? `Напоминания рассрочки: за ${inst.days_before ?? 0} дн.${inst.on_due ? ', в день' : ''}${inst.on_overdue ? ', просрочка' : ''}`
            : inst.mode === 'manual'
              ? 'Напоминания рассрочки: только вручную'
              : 'Напоминания рассрочки выключены',
        settingsRef: 'installments/reminder-settings',
      },
      {
        type: 'service_reminder',
        enabled: !!svc.enabled,
        summary: svc.enabled
          ? `Напоминание «давно не обслуживались»: каждые ${svc.months_interval ?? 0} мес.`
          : 'Напоминание «давно не обслуживались» выключено',
        settingsRef: 'marketing/reminders',
      },
    ];
  }

  // ─── Job Processor: Scan for completed checks ────────────────────
  private async scanCompletedChecks() {
    try {
      // Find recently completed (non-deferred) checks that don't have review jobs yet
      const { rows } = await this.pool.query(
        `SELECT c.id as check_id, c.tenant_id, c.master_id, c.client_id, cl.phone as client_phone
         FROM checks c
         LEFT JOIN clients cl ON cl.id = c.client_id
         WHERE c.is_deferred = false
           AND c.deleted_at IS NULL
           AND c.created_at > now() - interval '7 days'
           AND c.client_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM review_jobs rj WHERE rj.check_id = c.id)
           AND EXISTS (SELECT 1 FROM review_settings rs WHERE rs.tenant_id = c.tenant_id AND rs.auto_send_enabled = true)`,
      );

      for (const row of rows) {
        if (!row.client_phone) continue;

        // Get tenant settings for schedule time
        const { rows: settingsRows } = await this.pool.query(
          `SELECT send_time, feedback_delay_hours FROM review_settings WHERE tenant_id=$1`,
          [row.tenant_id],
        );
        const settings = settingsRows[0] || { send_time: '20:00', feedback_delay_hours: 2 };

        // Schedule for today at send_time, or delay_hours from now
        const now = new Date();
        const [hh, mm] = (settings.send_time || '20:00').split(':').map(Number);
        const scheduledAt = new Date(now);
        scheduledAt.setHours(hh, mm, 0, 0);
        if (scheduledAt <= now) {
          scheduledAt.setTime(now.getTime() + (settings.feedback_delay_hours || 2) * 3600000);
        }

        await this.pool.query(
          `INSERT INTO review_jobs (tenant_id, check_id, client_id, employee_id, client_phone, scheduled_at)
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (check_id) DO NOTHING`,
          [row.tenant_id, row.check_id, row.client_id, row.master_id, row.client_phone, scheduledAt],
        );
      }
    } catch (err) {
      this.logger.error(`Scan completed checks error: ${err}`);
    }
  }

  // ─── Job Processor: Send pending review requests ─────────────────
  private async processReviewJobs() {
    try {
      const { rows: jobs } = await this.pool.query(
        `UPDATE review_jobs SET status='processing', attempts=attempts+1
         WHERE id IN (
           SELECT id FROM review_jobs
           WHERE status='pending' AND scheduled_at <= now() AND attempts < 3
           ORDER BY scheduled_at LIMIT 10
           FOR UPDATE SKIP LOCKED
         ) RETURNING *`,
      );

      for (const job of jobs) {
        try {
          const adapter = await this.getAdapter(job.tenant_id);
          if (!adapter) {
            await this.pool.query(
              `UPDATE review_jobs SET status='skipped', error='Нет настроенного провайдера' WHERE id=$1`,
              [job.id],
            );
            continue;
          }

          // Create review token
          const token = this.generateToken();
          const expiresAt = new Date(Date.now() + 7 * 24 * 3600000); // 7 days

          await this.pool.query(
            `INSERT INTO review_tokens (tenant_id, check_id, client_id, employee_id, token, expires_at)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [job.tenant_id, job.check_id, job.client_id, job.employee_id, token, expiresAt],
          );

          // Build message from template
          const { rows: settingsRows } = await this.pool.query(
            `SELECT message_template, motivation_message FROM review_settings WHERE tenant_id=$1`,
            [job.tenant_id],
          );
          const { rows: tenantRows } = await this.pool.query(`SELECT name FROM tenants WHERE id=$1`, [job.tenant_id]);
          const { rows: clientRows } = await this.pool.query(`SELECT full_name FROM clients WHERE id=$1`, [
            job.client_id,
          ]);

          const template = settingsRows[0]?.message_template || 'Оцените обслуживание: {reviewLink}';
          const motivationMessage = settingsRows[0]?.motivation_message || '';
          // Public review URL must be served by our own domain so clients
          // don't see a placeholder like "crm.app" in their SMS / WhatsApp.
          // Honour an explicit override (`APP_URL`) for any per-environment
          // tweak (staging, dev), but fall back to the production domain.
          const reviewLink = `${process.env.APP_URL || 'https://autexa.pw'}/review/${token}`;
          const message = template
            .replace(/\{clientName\}/g, clientRows[0]?.full_name || 'клиент')
            .replace(/\{tenantName\}/g, tenantRows[0]?.name || '')
            .replace(/\{reviewLink\}/g, reviewLink)
            // {motivation} — owner's "gift for review" sentence. If the
            // template doesn't reference it, the substitution is a no-op.
            .replace(/\{motivation\}/g, motivationMessage);

          // Route through the anti-spam gate. `review:<checkId>` = one review
          // request per check, ever (belt-and-suspenders over review_jobs' own
          // ON CONFLICT (check_id)); reuse the already-resolved adapter.
          await this.guardAndLogSend({
            tenantId: job.tenant_id,
            phone: job.client_phone,
            body: message,
            messageType: 'review',
            clientId: job.client_id ?? null,
            dedupKey: `review:${job.check_id}`,
            adapter,
          });
          await this.pool.query(`UPDATE review_jobs SET status='sent' WHERE id=$1`, [job.id]);
        } catch (err: any) {
          this.logger.error(`Review job ${job.id} failed: ${err.message}`);
          const newStatus = job.attempts >= 3 ? 'failed' : 'pending';
          await this.pool.query(`UPDATE review_jobs SET status=$1, error=$2 WHERE id=$3`, [
            newStatus,
            err.message,
            job.id,
          ]);
        }
      }
    } catch (err) {
      this.logger.error(`Process review jobs error: ${err}`);
    }
  }
}
