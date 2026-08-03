import { Injectable, Inject, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';
import { Sentry, isSentryEnabled } from '../common/sentry';
import * as https from 'https';

/**
 * Apple-like shaping for a single visible push (#55). All optional — omitting
 * every field reproduces the pre-#55 message exactly.
 */
export interface PushOptions {
  /**
   * APNs `category` identifier — drives actionable buttons and is read by the
   * iOS Notification Service Extension (a separate native task) as the
   * content.categoryIdentifier. Defaults to the gating category for
   * sendToUserCategory and to 'broadcast' for sendBroadcastToUser.
   */
  categoryId?: string;
  /**
   * iOS `thread-id` for GROUPING related notifications. Expo's send API has no
   * top-level thread-id field, so it is mirrored into `data.threadId` for the
   * NSE to apply as content.threadIdentifier. Defaults to the category.
   */
  threadId?: string;
  /** iOS app-icon badge count. Only emitted when a real count is supplied. */
  badge?: number;
  /**
   * false ⇒ deliver SILENTLY (Expo `sound: null` → APNs without a sound, so the
   * banner still appears but the phone stays quiet). Driven by the user's
   * notification_settings.sound (151). Default (undefined/true) = 'default'.
   */
  sound?: boolean;
}

/** One ticket as returned by Expo's /push/send. */
export interface ExpoTicket {
  status?: string;
  id?: string;
  message?: string;
  details?: { error?: string };
}

/** Outcome of ONE POST to Expo. Never thrown — always returned. */
export interface ExpoSendOutcome {
  /** HTTP status, or null when the request never completed (transport error). */
  status: number | null;
  ok: boolean;
  tickets: ExpoTicket[];
  errors: unknown[];
  transportError: string | null;
}

/** One delivery receipt (the ONLY place real APNs/FCM errors surface). */
export interface ExpoReceipt {
  id: string;
  status: string;
  message?: string;
  error?: string;
}

/** Per-user gate state — why a category push would or would not be delivered. */
export interface PushGateState {
  masterEnabled: boolean;
  soundEnabled: boolean;
  quietHoursActive: boolean;
  quietFrom: string | null;
  quietTo: string | null;
  tzOffsetMinutes: number | null;
  mutedCategories: string[];
}

/** Everything POST /push/test returns — the whole 10-second diagnosis. */
export interface PushDiagnostics {
  tokenCount: number;
  tokens: { platform: string; masked: string; createdAt: string | null }[];
  sent: number;
  status: number | null;
  ok: boolean;
  tickets: ExpoTicket[];
  errors: unknown[];
  transportError: string | null;
  receipts: ExpoReceipt[];
  gate: PushGateState;
  /** Russian, human-readable вердикт для владельца. */
  hint: string;
  /**
   * true ONLY on positive evidence: Expo accepted every ticket AND at least one
   * delivery receipt came back 'ok'. An empty receipt list is NOT success.
   */
  delivered: boolean;
  /**
   * Accepted by Expo, verdict not in yet (receipts still pending). Neither
   * success nor failure — the UI must not paint this green.
   */
  pending: boolean;
}

/** Result of registering a device token. */
export interface PushRegisterResult {
  token: string;
  platform: 'ios' | 'android';
  /**
   * false ⇒ the row was NOT written (the token belongs to an active user of a
   * DIFFERENT tenant). The client used to get a 200 here and believe it was
   * subscribed forever — see the hijack guard in upsertToken.
   */
  registered: boolean;
  reason?: 'token_owned_by_another_user';
}

/**
 * Timezone assumed for quiet hours when the client never sent its offset
 * (pre-151 clients / manual DB rows). Every tenant is Russian; Moscow (UTC+3)
 * is the least-wrong default and is documented in migration 151.
 */
const QUIET_HOURS_DEFAULT_TZ_OFFSET_MIN = 180;

/** Delay before the background receipt sweep. Expo needs a few seconds. */
const RECEIPT_CHECK_DELAY_MS = 15_000;

/** How long POST /push/test waits before reading receipts inline. */
const RECEIPT_TEST_DELAY_MS = 4_000;

/**
 * Minimum gap between two test pushes BY THE SAME USER.
 *
 * The global RateLimitGuard meters this route in the generic `write` bucket
 * (150/min), which is far too generous for an endpoint that holds a request
 * open for ~4s and sends a real push each time: a stuck retry loop would spam
 * the owner's lock screen and burn our Expo rate budget (MessageRateExceeded)
 * for everyone. A 10s per-user cooldown is invisible to a human pressing a
 * button and removes the abuse case entirely. Kept HERE rather than in
 * rate-limit.guard.ts, which is a protected shared-auth file.
 */
const TEST_PUSH_COOLDOWN_MS = 10_000;

@Injectable()
export class PushService {
  private readonly logger = new Logger('PushService');

  /**
   * userId → last test-push instant, for TEST_PUSH_COOLDOWN_MS. In-memory and
   * therefore per-replica (worst case: one extra test per replica) — a
   * diagnostic button does not justify a Redis round-trip. Pruned on write so
   * it cannot grow without bound.
   */
  private readonly lastTestPushAt = new Map<string, number>();

  constructor(@Inject(PG_POOL) private pool: Pool) {}

  /** Record a test push and evict entries that are past their cooldown. */
  private rememberTestPush(userId: string, now: number): void {
    for (const [key, at] of this.lastTestPushAt) {
      if (now - at >= TEST_PUSH_COOLDOWN_MS) this.lastTestPushAt.delete(key);
    }
    this.lastTestPushAt.set(userId, now);
  }

  /**
   * Build ONE Expo push message with Apple-like metadata (#55). `categoryId` and
   * `badge` are real top-level Expo fields (→ APNs category / badge). `threadId`
   * has no Expo top-level field, so category + threadId are ALSO mirrored into
   * `data` where the iOS Notification Service Extension can read them to set
   * content.threadIdentifier / categoryIdentifier — that's what makes iOS stack
   * related notifications. The mirrored keys are harmless to the JS data handlers.
   */
  private buildExpoMessage(
    token: string,
    title: string,
    body: string,
    data: Record<string, unknown> | undefined,
    opts: PushOptions = {},
  ): Record<string, unknown> {
    const message: Record<string, unknown> = {
      to: token,
      // sound:null is Expo's documented "deliver without a sound" — NOT the same
      // as omitting the key (which would fall back to the platform default).
      sound: opts.sound === false ? null : 'default',
      title,
      body,
    };
    if (opts.categoryId) message.categoryId = opts.categoryId;
    if (typeof opts.badge === 'number' && Number.isFinite(opts.badge) && opts.badge >= 0) {
      message.badge = Math.trunc(opts.badge);
    }
    const mergedData: Record<string, unknown> = { ...(data ?? {}) };
    if (opts.categoryId) mergedData.category = opts.categoryId;
    if (opts.threadId) mergedData.threadId = opts.threadId;
    message.data = mergedData;
    return message;
  }

  async upsertToken(
    userId: string,
    tenantId: string,
    token: string,
    platform: 'ios' | 'android',
  ): Promise<PushRegisterResult> {
    // Token-hijack guard: ON CONFLICT used to blindly reassign the token to
    // whoever posted it, letting any authenticated user capture another
    // user's device token (their pushes then route to the victim's device).
    // Reassignment is now allowed only when:
    //   - the token already belongs to the caller (normal re-registration);
    //   - the current owner is in the SAME tenant (shared workshop device,
    //     another employee logs in on it);
    //   - the current owner row is stale (deactivated or dismissed user).
    // Tokens of devices that were wiped/reinstalled are pruned independently
    // by the DeviceNotRegistered cleanup in handleExpoResponse.
    const result = await this.pool.query(
      `INSERT INTO push_tokens (user_id, token, platform)
       VALUES ($1, $2, $3)
       ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform
       WHERE push_tokens.user_id = EXCLUDED.user_id
          OR EXISTS (
               SELECT 1 FROM users owner
                WHERE owner.id = push_tokens.user_id
                  AND (owner.tenant_id = $4 OR owner.is_active = false OR owner.dismissed_at IS NOT NULL)
             )`,
      [userId, token, platform, tenantId],
    );
    if (result.rowCount === 0) {
      // Round 14: the client used to receive a plain 200 here and cache
      // "registration succeeded", so a device in this state NEVER got a push
      // and nobody could tell why. Say it out loud instead.
      this.logger.warn(
        `Push token re-registration rejected for user=${userId}: token owned by another tenant's active user`,
      );
      this.captureIssue('push_token_registration_rejected', {
        userId,
        tenantId,
        platform,
      });
      return { token, platform, registered: false, reason: 'token_owned_by_another_user' };
    }
    return { token, platform, registered: true };
  }

  async deleteToken(userId: string, token: string) {
    await this.pool.query(`DELETE FROM push_tokens WHERE token=$1 AND user_id=$2`, [token, userId]);
    return { message: 'Токен удалён' };
  }

  /** This user's registered devices, token masked (diagnostics surface). */
  async listTokens(userId: string): Promise<{ platform: string; masked: string; createdAt: string | null }[]> {
    const { rows } = await this.pool.query(
      `SELECT token, platform, created_at FROM push_tokens WHERE user_id=$1 ORDER BY created_at DESC NULLS LAST`,
      [userId],
    );
    return rows.map((r: { token: string; platform: string; created_at: Date | null }) => ({
      platform: r.platform,
      masked: PushService.maskToken(r.token),
      createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
    }));
  }

  /**
   * `ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]` → `ExponentPushToken[…xxxx]`.
   * A push token is a device address: enough to identify a row for support, not
   * enough to be copied out of a screenshot and used.
   */
  private static maskToken(token: string): string {
    if (token.length <= 12) return '…';
    return `${token.slice(0, 6)}…${token.slice(-6)}`;
  }

  /**
   * Redact push tokens embedded in a raw Expo response before it reaches logs
   * or Sentry. Expo quotes the offending token inside its error text
   * (`"ExponentPushToken[…]" is not a registered push notification recipient`),
   * which would otherwise leak in full the very value maskToken protects.
   */
  private static redactTokens(text: string): string {
    return text.replace(/(Expo(?:nent)?PushToken\[)[^\]]*(\])/g, '$1…$2');
  }

  async sendToUser(
    userId: string,
    title: string,
    body: string,
    data?: Record<string, unknown>,
    opts: PushOptions = {},
  ): Promise<void> {
    try {
      const { rows } = await this.pool.query(`SELECT token FROM push_tokens WHERE user_id=$1`, [userId]);
      if (rows.length === 0) return;

      const messages = rows.map((r: { token: string }) => this.buildExpoMessage(r.token, title, body, data, opts));

      await this.postToExpo(messages);
    } catch (err) {
      this.logger.error(`sendToUser failed for userId=${userId}: ${err}`);
    }
  }

  /**
   * Category-gated variant of {@link sendToUser}. Identical delivery, but the
   * push is suppressed when the user opted out. THREE independent gates, all
   * user-controlled from «Уведомления» (mobile NotificationSettingsScreen):
   *
   *   1. notification_mutes (066, opt-out) — this exact `category` is OFF;
   *   2. notification_settings.master_enabled (151) — «Все уведомления» OFF;
   *   3. notification_settings.quiet_from/quiet_to (151) — inside quiet hours
   *      we do NOT send at all (deliberately: a silent banner on a locked
   *      screen at 03:00 is still a notification the user asked not to get).
   *
   * notification_settings.sound=false does NOT suppress — it downgrades the
   * message to `sound: null` so the banner arrives quietly.
   *
   * Use this for every USER-FACING alert tied to a toggle in «Уведомления».
   * NOT for silent cache-invalidation pushes (sendDataToTenant) and NOT for
   * superadmin broadcasts (sendBroadcastToUser must always deliver).
   *
   * Best-effort: any failure is swallowed (push is never the source of truth).
   */
  async sendToUserCategory(
    userId: string,
    category: string,
    title: string,
    body: string,
    data?: Record<string, unknown>,
    opts: PushOptions = {},
  ): Promise<void> {
    try {
      const gate = await this.loadGateState(userId);
      if (!this.isCategoryAllowed(gate, category)) return;

      const { rows } = await this.pool.query(`SELECT token FROM push_tokens WHERE user_id=$1`, [userId]);
      if (rows.length === 0) return;

      // categoryId is always the gating category; thread by category (so all
      // "salary" / "check_closed" notifications stack on iOS) unless overridden.
      const messages = rows.map((r: { token: string }) =>
        this.buildExpoMessage(r.token, title, body, data, {
          categoryId: category,
          threadId: opts.threadId ?? category,
          badge: opts.badge,
          sound: gate.soundEnabled,
        }),
      );

      await this.postToExpo(messages);
    } catch (err) {
      this.logger.error(`sendToUserCategory failed for userId=${userId} category=${category}: ${err}`);
    }
  }

  /** Read every per-user gate input in ONE round-trip. */
  private async loadGateState(userId: string): Promise<PushGateState> {
    const { rows } = await this.pool.query(
      `SELECT COALESCE(ns.master_enabled, true)            AS master_enabled,
              COALESCE(ns.sound, true)                     AS sound,
              to_char(ns.quiet_from, 'HH24:MI')            AS quiet_from,
              to_char(ns.quiet_to,   'HH24:MI')            AS quiet_to,
              ns.tz_offset_minutes                         AS tz_offset_minutes,
              COALESCE(
                (SELECT array_agg(m.category) FROM notification_mutes m WHERE m.user_id = $1),
                ARRAY[]::text[]
              )                                            AS muted
         FROM (SELECT $1::uuid AS uid) probe
         LEFT JOIN notification_settings ns ON ns.user_id = probe.uid`,
      [userId],
    );
    const row = rows[0] as
      | {
          master_enabled: boolean;
          sound: boolean;
          quiet_from: string | null;
          quiet_to: string | null;
          tz_offset_minutes: number | null;
          muted: string[] | null;
        }
      | undefined;

    const quietFrom = row?.quiet_from ?? null;
    const quietTo = row?.quiet_to ?? null;
    const tzOffsetMinutes = row?.tz_offset_minutes ?? null;
    return {
      masterEnabled: row?.master_enabled ?? true,
      soundEnabled: row?.sound ?? true,
      quietFrom,
      quietTo,
      tzOffsetMinutes,
      quietHoursActive: PushService.isWithinQuietHours(new Date(), quietFrom, quietTo, tzOffsetMinutes),
      mutedCategories: row?.muted ?? [],
    };
  }

  private isCategoryAllowed(gate: PushGateState, category: string): boolean {
    if (!gate.masterEnabled) return false;
    if (gate.quietHoursActive) return false;
    return !gate.mutedCategories.includes(category);
  }

  /**
   * Is `now` inside the user's quiet window? The window is LOCAL wall-clock, so
   * we shift UTC by the offset the device reported. `from > to` means the window
   * crosses midnight (22:00 → 07:00). `from == to` is treated as DISABLED rather
   * than "silent for 24h" — otherwise a mis-tap would mute a user forever with
   * no visible cause.
   *
   * Static + pure so it is trivially reasoned about (and unit-testable).
   */
  static isWithinQuietHours(
    now: Date,
    from: string | null,
    to: string | null,
    tzOffsetMinutes: number | null,
  ): boolean {
    if (!from || !to) return false;
    const fromMin = PushService.parseHhMm(from);
    const toMin = PushService.parseHhMm(to);
    if (fromMin === null || toMin === null || fromMin === toMin) return false;

    const offset = typeof tzOffsetMinutes === 'number' ? tzOffsetMinutes : QUIET_HOURS_DEFAULT_TZ_OFFSET_MIN;
    const localMinutes = (((Math.floor(now.getTime() / 60_000) + offset) % 1440) + 1440) % 1440;

    return fromMin < toMin
      ? localMinutes >= fromMin && localMinutes < toMin
      : localMinutes >= fromMin || localMinutes < toMin;
  }

  /** 'HH:MM' / 'HH:MM:SS' → minutes since midnight, or null when unparseable. */
  private static parseHhMm(value: string): number | null {
    const m = /^(\d{1,2}):(\d{2})/.exec(value.trim());
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (!Number.isInteger(h) || !Number.isInteger(min) || h > 23 || min > 59) return null;
    return h * 60 + min;
  }

  /**
   * Deliver a single visible push to ONE user, ALWAYS (never category-gated).
   * Used for superadmin → director broadcasts, which must reach every owner
   * regardless of their «Уведомления» toggles. Callers fan this out across the
   * recipient list (see NotificationsService.broadcast), chunking the Expo send
   * at 100 messages per request — same chunk loop as sendDataToTenant.
   *
   * Best-effort: failure is swallowed and logged.
   */
  async sendBroadcastToUser(
    userId: string,
    title: string,
    body: string,
    data?: Record<string, unknown>,
    opts: PushOptions = {},
  ): Promise<void> {
    try {
      const { rows } = await this.pool.query(`SELECT token FROM push_tokens WHERE user_id=$1`, [userId]);
      if (rows.length === 0) return;

      const messages = rows.map((r: { token: string }) =>
        this.buildExpoMessage(r.token, title, body, data, {
          categoryId: opts.categoryId ?? 'broadcast',
          threadId: opts.threadId ?? 'broadcast',
          badge: opts.badge,
        }),
      );

      for (let i = 0; i < messages.length; i += 100) {
        await this.postToExpo(messages.slice(i, i + 100));
      }
    } catch (err) {
      this.logger.error(`sendBroadcastToUser failed for userId=${userId}: ${err}`);
    }
  }

  /**
   * Fan out a SILENT, DATA-ONLY push to every device of every OTHER user in a
   * tenant (the actor is excluded). Used for live cross-device cache
   * invalidation — e.g. `{ type: 'cash-changed', tenantId }` so other open
   * apps refetch money queries the moment a sale/expense lands.
   *
   * Data-only contract: NO title / body / sound, plus `_contentAvailable:true`
   * so iOS delivers it as a background content-available push (no banner) and
   * Android treats it as a data message. This MUST NOT show a visible
   * notification — it's an accelerator, not an alert.
   *
   * iOS only WAKES the app for these when the build declares the
   * `remote-notification` UIBackgroundMode — added in Round 14 via the
   * expo-notifications plugin's enableBackgroundRemoteNotifications (app.config.js).
   *
   * Best-effort: any failure is swallowed (push is never the source of truth).
   * Callers should fire-and-forget AFTER their DB commit so push latency never
   * blocks the API response.
   */
  async sendDataToTenant(tenantID: string, excludeUserId: string | null, data: Record<string, unknown>): Promise<void> {
    try {
      const { rows } = await this.pool.query(
        `SELECT pt.token
           FROM push_tokens pt
           JOIN users u ON u.id = pt.user_id
          WHERE u.tenant_id = $1
            AND ($2::uuid IS NULL OR pt.user_id <> $2)`,
        [tenantID, excludeUserId],
      );
      if (rows.length === 0) return;

      // Expo accepts up to 100 messages per request — chunk to stay safe even
      // for large tenants.
      const messages = rows.map((r: { token: string }) => ({
        to: r.token,
        // Silent: no title/body/sound, content-available so it doesn't banner.
        _contentAvailable: true,
        priority: 'high',
        data,
      }));

      for (let i = 0; i < messages.length; i += 100) {
        // skipReceiptSweep: this is the highest-frequency push path in the
        // system (every sale, expense, booking, payout). Sweeping receipts here
        // would roughly DOUBLE our outbound Expo API calls for zero diagnostic
        // value — these are invisible accelerators, not alerts, and dead tokens
        // are still pruned by the ticket-level DeviceNotRegistered check.
        await this.postToExpo(messages.slice(i, i + 100), { skipReceiptSweep: true });
      }
    } catch (err) {
      this.logger.error(`sendDataToTenant failed for tenant=${tenantID}: ${err}`);
    }
  }

  // ─── Diagnostics ────────────────────────────────────────────────────────────

  /**
   * Send a test push TO THE CALLER and report what actually happened — the whole
   * point being that "тикет ok" is NOT delivery. We therefore:
   *   1. list the caller's tokens (0 tokens is itself the answer);
   *   2. send, bypassing every gate (a diagnostic must not be muted by the very
   *      setting the user is trying to debug) — but REPORT the gate state so a
   *      muted user understands why real pushes are silent;
   *   3. wait a few seconds and read the DELIVERY RECEIPTS, where APNs errors
   *      (DeviceNotRegistered / InvalidCredentials) finally become visible.
   */
  async sendTestPush(userId: string): Promise<PushDiagnostics> {
    try {
      return await this.runTestPush(userId);
    } catch (err) {
      // A diagnostic that answers 500 is worse than useless — it tells the
      // owner nothing and looks like the push system itself is down. Every
      // other push entry point honours the same best-effort contract.
      this.logger.error(`sendTestPush failed for userId=${userId}: ${err}`);
      return {
        tokenCount: 0,
        tokens: [],
        sent: 0,
        status: null,
        ok: false,
        tickets: [],
        errors: [],
        transportError: null,
        receipts: [],
        gate: {
          masterEnabled: true,
          soundEnabled: true,
          quietHoursActive: false,
          quietFrom: null,
          quietTo: null,
          tzOffsetMinutes: null,
          mutedCategories: [],
        },
        delivered: false,
        pending: false,
        hint: 'Не удалось выполнить проверку на сервере. Повторите позже — это сбой диагностики, а не обязательно самих уведомлений.',
      };
    }
  }

  private async runTestPush(userId: string): Promise<PushDiagnostics> {
    const gate = await this.loadGateState(userId);
    const tokens = await this.listTokens(userId);

    const now = Date.now();
    const lastRun = this.lastTestPushAt.get(userId);
    if (typeof lastRun === 'number' && now - lastRun < TEST_PUSH_COOLDOWN_MS) {
      const wait = Math.ceil((TEST_PUSH_COOLDOWN_MS - (now - lastRun)) / 1000);
      return {
        tokenCount: tokens.length,
        tokens,
        sent: 0,
        status: null,
        ok: false,
        tickets: [],
        errors: [],
        transportError: null,
        receipts: [],
        gate,
        delivered: false,
        pending: false,
        hint: `Слишком часто. Подождите ${wait} с и повторите проверку.`,
      };
    }
    const { rows } = await this.pool.query(`SELECT token FROM push_tokens WHERE user_id=$1`, [userId]);
    if (rows.length === 0) {
      // No cooldown burned here: nothing was sent, and the user is about to fix
      // the registration and press again — making them wait would be hostile.
      return {
        tokenCount: 0,
        tokens,
        sent: 0,
        status: null,
        ok: false,
        tickets: [],
        errors: [],
        transportError: null,
        receipts: [],
        gate,
        delivered: false,
        pending: false,
        hint: 'Устройство не зарегистрировано на сервере: токена нет. Разрешите уведомления в настройках iPhone и перезайдите в приложение.',
      };
    }

    // From here on we really do hit Expo — start the cooldown.
    this.rememberTestPush(userId, now);

    const messages = rows.map((r: { token: string }) =>
      this.buildExpoMessage(
        r.token,
        'Проверка уведомлений',
        'Если вы это видите — пуши работают.',
        { type: 'push_test' },
        { categoryId: 'push_test', threadId: 'push_test' },
      ),
    );

    // skipReceiptSweep: this call reads the receipts itself, below.
    const outcome = await this.postToExpo(messages, { skipReceiptSweep: true });

    // Tickets come back in the SAME ORDER as the messages we sent, so index i
    // correlates ticket → token. Needed to prune a device the receipt declares
    // dead without waiting for the background sweep.
    const idToToken = new Map<string, string>();
    outcome.tickets.forEach((ticket, i) => {
      const to = (messages[i] as { to?: unknown } | undefined)?.to;
      if (ticket.id && typeof to === 'string') idToToken.set(ticket.id, to);
    });
    const ticketIds = [...idToToken.keys()];

    let receipts: ExpoReceipt[] = [];
    if (ticketIds.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, RECEIPT_TEST_DELAY_MS));
      receipts = await this.fetchReceipts(ticketIds);
      const deadTokens = receipts
        .filter((r) => r.error === 'DeviceNotRegistered')
        .map((r) => idToToken.get(r.id))
        .filter((t): t is string => typeof t === 'string');
      if (deadTokens.length > 0) await this.pruneDeadTokens(deadTokens);
    }

    // `delivered` requires POSITIVE evidence, never an absence of bad news.
    // The naive form (`receipts.every(ok)`) is TRUE for an empty array, so the
    // common case — Expo has not produced a receipt within our short wait —
    // would have painted a green "Доставлено" on a device APNs is about to
    // reject. That is precisely the lie this whole feature exists to kill.
    // Same for tickets: a 200 with an unparseable body yields tickets: [].
    const delivered =
      outcome.ok &&
      outcome.errors.length === 0 &&
      outcome.tickets.length > 0 &&
      outcome.tickets.every((t) => t.status === 'ok') &&
      receipts.length > 0 &&
      receipts.every((r) => r.status === 'ok');

    // Third state: accepted by Expo, verdict not in yet. Not a success and not
    // a failure — saying either would be a guess.
    const pending =
      !delivered && outcome.ok && outcome.errors.length === 0 && ticketIds.length > 0 && receipts.length === 0;

    return {
      tokenCount: tokens.length,
      tokens,
      sent: messages.length,
      status: outcome.status,
      ok: outcome.ok,
      tickets: outcome.tickets,
      errors: outcome.errors,
      transportError: outcome.transportError,
      receipts,
      gate,
      delivered,
      pending,
      hint: PushService.buildHint(outcome, receipts, gate, delivered),
    };
  }

  /** Turn the raw Expo verdict into ONE Russian sentence the owner can act on. */
  private static buildHint(
    outcome: ExpoSendOutcome,
    receipts: ExpoReceipt[],
    gate: PushGateState,
    delivered: boolean,
  ): string {
    if (outcome.transportError) {
      return `Сервер не смог достучаться до Expo (${outcome.transportError}). Проблема на стороне сети сервера, не телефона.`;
    }
    if (!outcome.ok) {
      return `Expo ответил HTTP ${outcome.status ?? '?'} — запрос отклонён. Если включён Enhanced Security, серверу нужен EXPO_ACCESS_TOKEN.`;
    }
    const errorCodes = [
      ...outcome.tickets.filter((t) => t.status === 'error').map((t) => t.details?.error),
      ...receipts.filter((r) => r.status !== 'ok').map((r) => r.error),
    ].filter((c): c is string => typeof c === 'string');

    if (errorCodes.includes('DeviceNotRegistered')) {
      return 'Expo принял, но APNs отверг токен (DeviceNotRegistered). Обычная причина — сборка зарегистрирована в sandbox APNs, а пуш ушёл в production (aps-environment). Токен удалён; после сборки с правильным aps-environment перезайдите в приложение.';
    }
    if (errorCodes.includes('InvalidCredentials')) {
      return 'Expo не может подписать запрос к APNs (InvalidCredentials): в EAS не загружен или отозван APNs-ключ. Проверьте `eas credentials`.';
    }
    if (errorCodes.includes('MismatchSenderId')) {
      return 'MismatchSenderId: FCM-ключ в EAS не совпадает с google-services.json (Android).';
    }
    if (errorCodes.includes('MessageRateExceeded')) {
      return 'MessageRateExceeded: слишком часто. Подождите минуту и повторите.';
    }
    if (errorCodes.length > 0) {
      return `Expo вернул ошибку: ${errorCodes.join(', ')}.`;
    }
    if (receipts.length === 0) {
      return 'Expo принял сообщение (тикет ok), квитанция ещё не готова. Если баннер не пришёл за минуту — повторите проверку.';
    }
    if (delivered) {
      const notes: string[] = ['Доставлено: Expo и APNs подтвердили отправку.'];
      if (!gate.masterEnabled)
        notes.push('Внимание: мастер-тумблер «Все уведомления» выключен — обычные уведомления не приходят.');
      if (gate.quietHoursActive) notes.push('Внимание: сейчас тихие часы — обычные уведомления не приходят.');
      if (gate.mutedCategories.length > 0) notes.push(`Выключены категории: ${gate.mutedCategories.join(', ')}.`);
      return notes.join(' ');
    }
    return 'Отправлено, но подтверждения доставки нет. Повторите проверку через минуту.';
  }

  // ─── Expo transport ─────────────────────────────────────────────────────────

  /**
   * POST a chunk of Expo push messages and READ the response so per-ticket
   * failures stop being invisible. Expo returns one ticket per message in the
   * SAME ORDER sent: `{ data: [{ status: 'ok'|'error', id?, message?, details? }] }`,
   * or on a top-level failure `{ errors: [...] }`.
   *
   * For every `status: 'error'` ticket we log message + details.error. When the
   * error is `DeviceNotRegistered` we self-heal: correlate ticket index → the
   * token we POSTed (`messages[i].to`) and prune it from `push_tokens`.
   *
   * Accepted tickets are followed up asynchronously by a RECEIPT sweep — the
   * only place where the real APNs/FCM verdict shows up (Round 14: without it a
   * fully broken configuration looked 100% healthy in the logs).
   *
   * STRICTLY non-fatal: the returned Promise always resolves, never rejects.
   * Network errors, non-2xx status, unparseable bodies and prune failures are
   * logged and swallowed — push is never the source of truth for any caller.
   */
  private postToExpo(messages: unknown[], opts: { skipReceiptSweep?: boolean } = {}): Promise<ExpoSendOutcome> {
    // Extract the token we sent for each message so we can correlate Expo's
    // ordered tickets back to a row in push_tokens. Each message is built with
    // `to: r.token` at every call site.
    const tokens: (string | undefined)[] = messages.map((m) => {
      const to = (m as { to?: unknown }).to;
      return typeof to === 'string' ? to : undefined;
    });

    return new Promise((resolve) => {
      const payload = JSON.stringify(messages);
      const req = https.request(this.expoRequestOptions('/--/api/v2/push/send', payload), (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          const rawBody = Buffer.concat(chunks).toString('utf8');

          // Always resolve at the very end; handle the body best-effort so a
          // parse/prune problem can never throw out of this Promise.
          void this.handleExpoResponse(status, rawBody, tokens, opts.skipReceiptSweep === true)
            .then((outcome) => resolve(outcome))
            .catch(() =>
              resolve({ status, ok: status >= 200 && status < 300, tickets: [], errors: [], transportError: null }),
            );
        });
      });

      req.on('error', (err) => {
        this.logger.error(`Expo push request error: ${err.message}`);
        // don't throw — push failure is non-fatal
        resolve({ status: null, ok: false, tickets: [], errors: [], transportError: err.message });
      });

      // 10s hard deadline (audit round 7, item 7): a hung exp.host connection
      // must not pin this Promise (and whatever awaits it) forever. destroy()
      // surfaces through the 'error' handler above → logged, resolved, done.
      req.setTimeout(10_000, () => req.destroy(new Error('push timeout')));

      req.write(payload);
      req.end();
    });
  }

  /**
   * Shared request shape for both Expo push endpoints.
   *
   * Authorization (Round 14): Expo's "Enhanced Security for Push Notifications"
   * makes an access token MANDATORY — with it enabled and no header, EVERY send
   * starts failing 400/403 at once. We send the bearer whenever
   * EXPO_ACCESS_TOKEN is configured, so enabling that switch is a no-op for us
   * instead of a total outage. Unset ⇒ header omitted ⇒ today's behaviour.
   */
  private expoRequestOptions(path: string, payload: string): https.RequestOptions {
    const headers: Record<string, string | number> = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
      Accept: 'application/json',
      'Accept-Encoding': 'gzip, deflate',
    };
    const accessToken = process.env.EXPO_ACCESS_TOKEN;
    if (accessToken && accessToken.trim().length > 0) {
      headers.Authorization = `Bearer ${accessToken.trim()}`;
    }
    return { hostname: 'exp.host', path, method: 'POST', headers };
  }

  /**
   * Inspect a single Expo response: log status/body on non-2xx, log every error
   * ticket, prune tokens whose ticket error is `DeviceNotRegistered`, and queue
   * the receipt sweep for the accepted ones.
   * Best-effort — every branch is guarded so it never throws.
   */
  private async handleExpoResponse(
    status: number,
    rawBody: string,
    tokens: (string | undefined)[],
    skipReceiptSweep: boolean,
  ): Promise<ExpoSendOutcome> {
    const outcome: ExpoSendOutcome = {
      status,
      ok: status >= 200 && status < 300,
      tickets: [],
      errors: [],
      transportError: null,
    };
    try {
      if (!outcome.ok) {
        // Surface the failure into pino/Sentry with the raw body for triage.
        const safeBody = PushService.redactTokens(rawBody);
        this.logger.error(`Expo push non-2xx status=${status} body=${safeBody.slice(0, 2000)}`);
        this.captureIssue('expo_push_non_2xx', { status, body: safeBody.slice(0, 500) });
      } else {
        this.logger.log(`Expo push response status: ${status}`);
      }

      let parsed: unknown;
      try {
        parsed = rawBody ? JSON.parse(rawBody) : undefined;
      } catch (parseErr) {
        this.logger.warn(`Expo push response not JSON (status=${status}): ${String(parseErr)}`);
        return outcome;
      }

      const root = parsed as { data?: ExpoTicket[]; errors?: unknown[] } | undefined;

      // Top-level failure shape: { errors: [...] }
      if (root?.errors && Array.isArray(root.errors) && root.errors.length > 0) {
        outcome.errors = root.errors;
        const safeErrors = PushService.redactTokens(JSON.stringify(root.errors));
        this.logger.error(`Expo push top-level errors: ${safeErrors.slice(0, 2000)}`);
        this.captureIssue('expo_push_top_level_error', { errors: safeErrors.slice(0, 500) });
      }

      const data = root?.data;
      if (!Array.isArray(data)) return outcome;
      outcome.tickets = data;

      const deadTokens: string[] = [];
      const acceptedIds: string[] = [];
      const idToToken = new Map<string, string>();
      /** error code → count, aggregated so Sentry gets ONE event per batch. */
      const errorTally = new Map<string, number>();
      for (let i = 0; i < data.length; i++) {
        const ticket = data[i];
        if (!ticket) continue;
        const token = tokens[i];

        if (ticket.status === 'ok') {
          if (ticket.id) {
            acceptedIds.push(ticket.id);
            if (token) idToToken.set(ticket.id, token);
          }
          continue;
        }
        if (ticket.status !== 'error') continue;

        const errorCode = ticket.details?.error;
        this.logger.warn(
          `Expo push ticket error: ${ticket.message ?? 'unknown'}` +
            (errorCode ? ` (${errorCode})` : '') +
            (token ? ` token=${PushService.maskToken(token)}` : ''),
        );
        errorTally.set(errorCode ?? 'unknown', (errorTally.get(errorCode ?? 'unknown') ?? 0) + 1);

        // Only DeviceNotRegistered means the token is permanently dead. Other
        // errors (InvalidCredentials, MessageTooBig, MismatchSenderId, …) are
        // NOT token-ownership problems, so we log them but keep the token.
        if (errorCode === 'DeviceNotRegistered' && token) {
          deadTokens.push(token);
        }
      }

      // ONE Sentry event per batch, with counts — not one per device. Right
      // after this round ships, every legacy iOS token is sandbox-registered
      // and will fail; per-device reporting would bury the issue tracker under
      // thousands of identical events on the first broadcast.
      if (errorTally.size > 0) {
        this.captureIssue('expo_push_ticket_error', {
          errors: Object.fromEntries(errorTally),
          batchSize: data.length,
        });
      }

      if (deadTokens.length > 0) {
        await this.pruneDeadTokens(deadTokens);
      }
      if (!skipReceiptSweep && acceptedIds.length > 0) {
        this.scheduleReceiptSweep(acceptedIds, idToToken);
      }
    } catch (err) {
      // Absolute backstop: response handling must never propagate.
      this.logger.error(`Expo push response handling failed: ${String(err)}`);
    }
    return outcome;
  }

  /**
   * Read the DELIVERY RECEIPTS for accepted tickets ~15s later.
   *
   * Why this exists (Round 14 root cause #4): a ticket only says "Expo queued
   * it". Everything that actually breaks delivery — a sandbox-vs-production
   * APNs mismatch, a revoked APNs key, an uninstalled app — is reported ONLY in
   * the receipt. Without this sweep a 100%-broken push setup produced a
   * perfectly clean log, which is exactly why the outage lasted.
   *
   * Fire-and-forget, unref'd so it can never hold the process open on shutdown.
   */
  private scheduleReceiptSweep(ids: string[], idToToken: Map<string, string>): void {
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const receipts = await this.fetchReceipts(ids);
          const dead: string[] = [];
          const tally = new Map<string, number>();
          for (const receipt of receipts) {
            if (receipt.status === 'ok') continue;
            this.logger.warn(
              `Expo push receipt error: ${receipt.message ?? 'unknown'}` + (receipt.error ? ` (${receipt.error})` : ''),
            );
            const code = receipt.error ?? 'unknown';
            tally.set(code, (tally.get(code) ?? 0) + 1);
            if (receipt.error === 'DeviceNotRegistered') {
              const token = idToToken.get(receipt.id);
              if (token) dead.push(token);
            }
          }
          // Aggregated, same reasoning as the ticket tally above.
          if (tally.size > 0) {
            this.captureIssue('expo_push_receipt_error', {
              errors: Object.fromEntries(tally),
              batchSize: receipts.length,
            });
          }
          if (dead.length > 0) await this.pruneDeadTokens(dead);
        } catch (err) {
          this.logger.warn(`Expo receipt sweep failed: ${String(err)}`);
        }
      })();
    }, RECEIPT_CHECK_DELAY_MS);
    // Node keeps the event loop alive for pending timers; a push must never
    // delay a graceful shutdown.
    timer.unref?.();
  }

  /**
   * POST /--/api/v2/push/getReceipts. Returns a flat list; ids Expo does not
   * know about are simply absent. Never throws.
   */
  private fetchReceipts(ids: string[]): Promise<ExpoReceipt[]> {
    // Expo accepts up to 1000 ids per call; our chunks are ≤100 messages, so a
    // single request is always enough.
    const payload = JSON.stringify({ ids: ids.slice(0, 1000) });
    return new Promise((resolve) => {
      const req = https.request(this.expoRequestOptions('/--/api/v2/push/getReceipts', payload), (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
              data?: Record<string, { status?: string; message?: string; details?: { error?: string } }>;
            };
            const out: ExpoReceipt[] = [];
            for (const [id, receipt] of Object.entries(parsed?.data ?? {})) {
              out.push({
                id,
                status: receipt?.status ?? 'unknown',
                message: receipt?.message,
                error: receipt?.details?.error,
              });
            }
            resolve(out);
          } catch {
            resolve([]);
          }
        });
      });
      req.on('error', (err) => {
        this.logger.warn(`Expo getReceipts request error: ${err.message}`);
        resolve([]);
      });
      // Deliberately shorter than the send deadline: POST /push/test holds an
      // HTTP request open across send + wait + this call, and the mobile client
      // must not time out on a healthy diagnosis (see pushApi.test).
      req.setTimeout(6_000, () => req.destroy(new Error('receipts timeout')));
      req.write(payload);
      req.end();
    });
  }

  /**
   * Delete dead (DeviceNotRegistered) tokens from push_tokens. Best-effort:
   * wrapped in its own try/catch so a prune failure breaks nothing.
   */
  private async pruneDeadTokens(tokens: string[]): Promise<void> {
    try {
      await this.pool.query(`DELETE FROM push_tokens WHERE token = ANY($1::text[])`, [tokens]);
      this.logger.log(`Pruned ${tokens.length} dead push token(s) (DeviceNotRegistered)`);
    } catch (err) {
      this.logger.error(`Failed to prune dead push tokens: ${String(err)}`);
    }
  }

  /**
   * Push failures are logged with logger.error, but the backend Sentry init
   * uses `integrations: []` — so pino/Nest logs do NOT reach Sentry and every
   * push error stayed invisible. Report the ones that matter explicitly.
   * Never throws (Sentry disabled ⇒ no-op).
   */
  private captureIssue(kind: string, extra: Record<string, unknown>): void {
    if (!isSentryEnabled) return;
    try {
      Sentry.captureMessage(`push: ${kind}`, {
        level: 'warning',
        tags: { area: 'push', kind },
        extra,
      });
    } catch {
      /* diagnostics must never break delivery */
    }
  }
}
