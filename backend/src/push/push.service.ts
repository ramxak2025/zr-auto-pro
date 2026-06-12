import { Injectable, Inject, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';
import * as https from 'https';

@Injectable()
export class PushService {
  private readonly logger = new Logger('PushService');

  constructor(@Inject(PG_POOL) private pool: Pool) {}

  async upsertToken(userId: string, tenantId: string, token: string, platform: 'ios' | 'android') {
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
      this.logger.warn(
        `Push token re-registration rejected for user=${userId}: token owned by another tenant's active user`,
      );
    }
    return { token, platform };
  }

  async deleteToken(userId: string, token: string) {
    await this.pool.query(`DELETE FROM push_tokens WHERE token=$1 AND user_id=$2`, [token, userId]);
    return { message: 'Токен удалён' };
  }

  async sendToUser(userId: string, title: string, body: string, data?: Record<string, unknown>): Promise<void> {
    try {
      const { rows } = await this.pool.query(`SELECT token FROM push_tokens WHERE user_id=$1`, [userId]);
      if (rows.length === 0) return;

      const messages = rows.map((r: { token: string }) => ({
        to: r.token,
        sound: 'default',
        title,
        body,
        data: data || {},
      }));

      await this.postToExpo(messages);
    } catch (err) {
      this.logger.error(`sendToUser failed for userId=${userId}: ${err}`);
    }
  }

  /**
   * Category-gated variant of {@link sendToUser}. Identical delivery, but a
   * device only receives the push when the user has NOT muted `category`
   * (notification_mutes, migration 066 — opt-out model: absence of a row ==
   * subscribed). Use this for every USER-FACING alert tied to a toggle in
   * «Уведомления»: salary / penalty / check_assigned / check_closed / knowledge.
   *
   * NOT for silent cache-invalidation pushes (those stay on sendDataToTenant)
   * and NOT for superadmin broadcasts (those must always deliver — see
   * sendBroadcastToUser).
   *
   * Best-effort: any failure is swallowed (push is never the source of truth).
   */
  async sendToUserCategory(
    userId: string,
    category: string,
    title: string,
    body: string,
    data?: Record<string, unknown>,
  ): Promise<void> {
    try {
      const { rows } = await this.pool.query(
        `SELECT pt.token
           FROM push_tokens pt
          WHERE pt.user_id = $1
            AND NOT EXISTS (
              SELECT 1 FROM notification_mutes m
               WHERE m.user_id = $1 AND m.category = $2
            )`,
        [userId, category],
      );
      if (rows.length === 0) return;

      const messages = rows.map((r: { token: string }) => ({
        to: r.token,
        sound: 'default',
        title,
        body,
        data: { ...(data || {}), category },
      }));

      await this.postToExpo(messages);
    } catch (err) {
      this.logger.error(`sendToUserCategory failed for userId=${userId} category=${category}: ${err}`);
    }
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
  ): Promise<void> {
    try {
      const { rows } = await this.pool.query(`SELECT token FROM push_tokens WHERE user_id=$1`, [userId]);
      if (rows.length === 0) return;

      const messages = rows.map((r: { token: string }) => ({
        to: r.token,
        sound: 'default',
        title,
        body,
        data: data || {},
      }));

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
        await this.postToExpo(messages.slice(i, i + 100));
      }
    } catch (err) {
      this.logger.error(`sendDataToTenant failed for tenant=${tenantID}: ${err}`);
    }
  }

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
   * STRICTLY non-fatal: the returned Promise always resolves, never rejects.
   * Network errors, non-2xx status, unparseable bodies and prune failures are
   * logged and swallowed — push is never the source of truth for any caller.
   */
  private postToExpo(messages: unknown[]): Promise<void> {
    // Extract the token we sent for each message so we can correlate Expo's
    // ordered tickets back to a row in push_tokens. Each message is built with
    // `to: r.token` at every call site.
    const tokens: (string | undefined)[] = messages.map((m) => {
      const to = (m as { to?: unknown }).to;
      return typeof to === 'string' ? to : undefined;
    });

    return new Promise((resolve) => {
      const payload = JSON.stringify(messages);
      const options: https.RequestOptions = {
        hostname: 'exp.host',
        path: '/--/api/v2/push/send',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          Accept: 'application/json',
          'Accept-Encoding': 'gzip, deflate',
        },
      };

      const req = https.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          const rawBody = Buffer.concat(chunks).toString('utf8');

          // Always resolve at the very end; handle the body best-effort so a
          // parse/prune problem can never throw out of this Promise.
          void this.handleExpoResponse(status, rawBody, tokens).finally(() => resolve());
        });
      });

      req.on('error', (err) => {
        this.logger.error(`Expo push request error: ${err.message}`);
        resolve(); // don't throw — push failure is non-fatal
      });

      req.write(payload);
      req.end();
    });
  }

  /**
   * Inspect a single Expo response: log status/body on non-2xx, log every error
   * ticket, and prune tokens whose ticket error is `DeviceNotRegistered`.
   * Best-effort — every branch is guarded so it never throws.
   */
  private async handleExpoResponse(status: number, rawBody: string, tokens: (string | undefined)[]): Promise<void> {
    try {
      const ok2xx = status >= 200 && status < 300;
      if (!ok2xx) {
        // Surface the failure into pino/Sentry with the raw body for triage.
        this.logger.error(`Expo push non-2xx status=${status} body=${rawBody.slice(0, 2000)}`);
      } else {
        this.logger.log(`Expo push response status: ${status}`);
      }

      let parsed: unknown;
      try {
        parsed = rawBody ? JSON.parse(rawBody) : undefined;
      } catch (parseErr) {
        this.logger.warn(`Expo push response not JSON (status=${status}): ${String(parseErr)}`);
        return;
      }

      const root = parsed as
        | {
            data?: { status?: string; id?: string; message?: string; details?: { error?: string } }[];
            errors?: unknown[];
          }
        | undefined;

      // Top-level failure shape: { errors: [...] }
      if (root?.errors && Array.isArray(root.errors) && root.errors.length > 0) {
        this.logger.error(`Expo push top-level errors: ${JSON.stringify(root.errors).slice(0, 2000)}`);
      }

      const data = root?.data;
      if (!Array.isArray(data)) return;

      const deadTokens: string[] = [];
      for (let i = 0; i < data.length; i++) {
        const ticket = data[i];
        if (!ticket || ticket.status !== 'error') continue;

        const errorCode = ticket.details?.error;
        const token = tokens[i];
        this.logger.warn(
          `Expo push ticket error: ${ticket.message ?? 'unknown'}` +
            (errorCode ? ` (${errorCode})` : '') +
            (token ? ` token=${token}` : ''),
        );

        // Only DeviceNotRegistered means the token is permanently dead. Other
        // errors (InvalidCredentials, MessageTooBig, MismatchSenderId, …) are
        // NOT token-ownership problems, so we log them but keep the token.
        if (errorCode === 'DeviceNotRegistered' && token) {
          deadTokens.push(token);
        }
      }

      if (deadTokens.length > 0) {
        await this.pruneDeadTokens(deadTokens);
      }
    } catch (err) {
      // Absolute backstop: response handling must never propagate.
      this.logger.error(`Expo push response handling failed: ${String(err)}`);
    }
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
}
