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

// ─── Messaging Provider Strategy Pattern ─────────────────────────────
interface MessagingProviderAdapter {
  sendMessage(phone: string, message: string): Promise<{ success: boolean; error?: string }>;
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
  ): Promise<{ sent: boolean; reason?: 'no_provider' | 'no_phone' | 'error'; error?: string }> {
    if (!phone || !phone.trim()) return { sent: false, reason: 'no_phone' };
    const adapter = await this.getAdapter(tenantId);
    if (!adapter) return { sent: false, reason: 'no_provider' };
    try {
      const result = await adapter.sendMessage(phone, message);
      return result.success ? { sent: true } : { sent: false, reason: 'error', error: result.error };
    } catch (err: any) {
      return { sent: false, reason: 'error', error: err?.message || String(err) };
    }
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
      `SELECT ch.number,
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

    return this.sendClientMessage(tenantId, r.client_phone, message);
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
  ): Promise<{ sent: number; failed: number; total: number }> {
    const text = (message || '').trim();
    if (!text) throw new BadRequestException({ message: 'Сообщение не может быть пустым' });

    const segment = await this.getWinbackSegment(tenantId, days);
    const total = segment.length;
    let sent = 0;
    let failed = 0;

    for (const client of segment) {
      const result = await this.sendClientMessage(tenantId, client.phone, text);
      if (result.sent) {
        sent++;
      } else {
        failed++;
        // No provider configured → the same holds for every remaining client.
        // Count the rest as not-sent and stop. Clear counts, no throw.
        if (result.reason === 'no_provider') {
          failed = total - sent;
          break;
        }
      }
    }

    return { sent, failed, total };
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

          await adapter.sendMessage(job.client_phone, message);
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
